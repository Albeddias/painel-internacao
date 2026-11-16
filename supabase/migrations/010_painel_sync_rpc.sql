-- Sincronizar em duas chamadas, cada uma atômica no banco (o app chama por RPC).
--
-- Antes o app lia doze tabelas em requisições separadas (em páginas) e gravava com dezenas
-- de requisições soltas, apagando e reinserindo as linhas-filhas de TODOS os pacientes:
--   * uma escrita da IA no meio da leitura deixava o app com metade de cada estado;
--   * a conexão caindo no meio da gravação deixava paciente sem condutas/exames no banco;
--   * cada Sincronizar regravava o banco inteiro, mesmo com uma linha editada.
--
-- As duas funções rodam com as permissões de QUEM CHAMA (security invoker): o RLS
-- "painel owner only" de cada tabela continua valendo. Só usuário logado executa.
-- Aparelho ainda na versão anterior do app segue funcionando: ele lê e grava as tabelas
-- direto, e estas funções não mudam nada nelas. Idempotente (create or replace).

-- ---------------------------------------------------------------------------------------
-- painel_sync_pull(): tudo o que o Sincronizar lê, de uma vez.
-- Uma consulta só = uma foto só do banco (nenhuma tabela mais nova que a outra).
-- Cada tabela vem em ordem de chave primária, como na leitura antiga.
-- Paciente 'nuvem' (guardado só no banco) vem só com a linha de painel_patients: o app
-- não cria leito para ele, então os filhos seriam baixados à toa.
-- ---------------------------------------------------------------------------------------
create or replace function public.painel_sync_pull()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ativos as (
    select p.id from public.painel_patients p where p.status <> 'nuvem'
  )
  select jsonb_build_object(
    'patients', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                   from public.painel_patients t),
    'problems', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                   from public.painel_problems t where t.patient_id in (select id from ativos)),
    'antibiotics', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                   from public.painel_antibiotics t where t.patient_id in (select id from ativos)),
    'cultures', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                   from public.painel_cultures t where t.patient_id in (select id from ativos)),
    'devices', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                   from public.painel_devices t where t.patient_id in (select id from ativos)),
    'exams', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                   from public.painel_exams t where t.patient_id in (select id from ativos)),
    'condutas', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                   from public.painel_condutas t where t.patient_id in (select id from ativos)),
    'raw_texts', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                   from public.painel_raw_texts t where t.patient_id in (select id from ativos)),
    'evolucoes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                   from public.painel_evolucoes t where t.patient_id in (select id from ativos)),
    'notes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.patient_id), '[]'::jsonb)
                   from public.painel_notes t where t.patient_id in (select id from ativos)),
    'generated_docs', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)
                   from public.painel_generated_docs t where t.patient_id in (select id from ativos)),
    'prefs', (select coalesce(jsonb_agg(to_jsonb(t) order by t.key), '[]'::jsonb)
                   from public.painel_prefs t)
  );
$$;

-- ---------------------------------------------------------------------------------------
-- painel_sync_push(p): grava a diferença calculada pelo app (PainelCore.buildPushDiff).
-- Tudo ou nada: a função roda inteira na transação da chamada; qualquer erro desfaz tudo.
--
--   p = {
--     "deletePatientIds": [uuid...],              pacientes apagados no aparelho (os filhos
--                                                 saem pelo "on delete cascade")
--     "remove": { "<tabela>": [uuid...] },        linhas-filhas que saíram, pelo id
--     "upsert": { "<tabela>": [ {linha}... ] }    linhas novas ou alteradas, inteiras
--   }
--   <tabela> é o nome sem o prefixo (patients, problems, ...).
--
-- Só as colunas ENVIADAS são gravadas — as chaves da primeira linha de cada tabela, que
-- existam na tabela; updated_at fica com o trigger. Coluna que o app não envia (app antigo,
-- ou coluna que só a IA usa) não é tocada numa linha que já existe e nasce com o default
-- numa nova. Coluna nova no schema não exige mexer aqui.
-- Evolução: conflito em (patient_id, data) — o mesmo dia nunca duplica — e o id da linha
-- que já existe é preservado. Nunca há delete em painel_evolucoes nem em
-- painel_generated_docs (fora o cascade do paciente apagado).
--
-- Devolve { "<tabela>": [linhas como ficaram gravadas] } para o app conferir
-- (PainelCore.verifyPush) antes de tirar a foto da sincronização.
-- ---------------------------------------------------------------------------------------
create or replace function public.painel_sync_push(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  spec record;
  tbl text;
  linhas jsonb;
  ids uuid[];
  cols text[];
  set_cols text[];
  gravadas jsonb;
  saida jsonb := '{}'::jsonb;
begin
  -- 1. Pacientes apagados no aparelho.
  select array_agg(x::uuid) into ids
    from jsonb_array_elements_text(coalesce(p->'deletePatientIds', '[]'::jsonb)) x;
  if ids is not null then
    delete from public.painel_patients where id = any(ids);
  end if;

  -- 2. Linhas-filhas que saíram (só as tabelas desta lista; o nome nunca vem do pedido).
  for spec in
    select t.nome from unnest(array['problems', 'antibiotics', 'cultures', 'devices', 'exams', 'condutas', 'raw_texts']) as t(nome)
  loop
    select array_agg(x::uuid) into ids
      from jsonb_array_elements_text(coalesce(p->'remove'->spec.nome, '[]'::jsonb)) x;
    if ids is not null then
      execute format('delete from public.%I where id = any($1)', 'painel_' || spec.nome) using ids;
    end if;
  end loop;

  -- 3. Linhas novas ou alteradas. Pacientes primeiro (as filhas dependem deles).
  --    conflito = chave do upsert; manter = colunas que não mudam em linha existente.
  for spec in
    select t.nome, t.conflito, t.manter
      from (values
        (1, 'patients', array['id'], array[]::text[]),
        (2, 'problems', array['id'], array[]::text[]),
        (3, 'antibiotics', array['id'], array[]::text[]),
        (4, 'cultures', array['id'], array[]::text[]),
        (5, 'devices', array['id'], array[]::text[]),
        (6, 'exams', array['id'], array[]::text[]),
        (7, 'condutas', array['id'], array[]::text[]),
        (8, 'raw_texts', array['id'], array[]::text[]),
        (9, 'notes', array['patient_id'], array[]::text[]),
        (10, 'evolucoes', array['patient_id', 'data'], array['id']),
        (11, 'prefs', array['key'], array[]::text[])
      ) as t(ord, nome, conflito, manter)
     order by t.ord
  loop
    linhas := p->'upsert'->spec.nome;
    if linhas is null or jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) = 0 then
      continue;
    end if;
    tbl := 'painel_' || spec.nome;

    -- Colunas a gravar: as enviadas que existem na tabela (o catálogo é quem valida o nome).
    select array_agg(a.attname::text order by a.attnum) into cols
      from pg_catalog.pg_attribute a
     where a.attrelid = format('public.%I', tbl)::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname <> 'updated_at'
       and (linhas->0) ? a.attname::text;
    select array_agg(c) into set_cols
      from unnest(cols) c
     where c <> all(spec.conflito) and c <> all(spec.manter);
    if set_cols is null then
      raise exception 'painel_sync_push: nenhuma coluna para gravar em %', tbl;
    end if;

    execute format(
      'with up as ('
      '  insert into public.%1$I as t (%2$s)'
      '  select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)'
      '  on conflict (%3$s) do update set %4$s'
      '  returning t.*'
      ') select coalesce(jsonb_agg(to_jsonb(up)), ''[]''::jsonb) from up',
      tbl,
      (select string_agg(format('%I', c), ', ') from unnest(cols) c),
      (select string_agg(format('%I', c), ', ') from unnest(spec.conflito) c),
      (select string_agg(format('%1$I = excluded.%1$I', c), ', ') from unnest(set_cols) c)
    ) into gravadas using linhas;

    saida := saida || jsonb_build_object(spec.nome, gravadas);
  end loop;

  return saida;
end;
$$;

-- Só usuário logado. (O RLS já barraria: anon leria vazio e não gravaria nada.)
revoke all on function public.painel_sync_pull() from public, anon;
grant execute on function public.painel_sync_pull() to authenticated;
revoke all on function public.painel_sync_push(jsonb) from public, anon;
grant execute on function public.painel_sync_push(jsonb) to authenticated;
