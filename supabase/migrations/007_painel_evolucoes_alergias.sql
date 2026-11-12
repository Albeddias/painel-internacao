-- Evolução Tasy + alergias/medicações prévias.
-- JÁ APLICADO no banco (projeto "Gestão Médica") antes deste arquivo existir: ele só
-- registra o schema no repositório. É idempotente (IF NOT EXISTS) e não destrutivo.
-- Como nas demais tabelas, __OWNER_EMAIL__ é trocado pelo e-mail real ao aplicar.

-- a) Paciente: alergias e medicações em uso antes da internação (texto puro).
alter table public.painel_patients
  add column if not exists alergias text not null default '',
  add column if not exists medicacoes_previas text not null default '';

-- b) Evolução no formato do Tasy: uma linha por paciente por dia, nove campos de texto puro.
--    O app grava por upsert em (patient_id, data) — nunca delete+insert.
create table if not exists public.painel_evolucoes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.painel_patients(id) on delete cascade,
  data date not null,
  problemas text not null default '',
  historia_internacao text not null default '',
  evolucao_atual text not null default '',
  exames_lab text not null default '',
  culturas text not null default '',
  exames_imagem text not null default '',
  atualizacao_problemas text not null default '',
  metas text not null default '',
  acoes text not null default '',
  updated_at timestamptz not null default now(),
  unique (patient_id, data)
);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at' and tgrelid = 'public.painel_evolucoes'::regclass
  ) then
    create trigger set_updated_at before update on public.painel_evolucoes
      for each row execute procedure extensions.moddatetime(updated_at);
  end if;
end $$;

alter table public.painel_evolucoes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'painel_evolucoes' and policyname = 'painel owner only'
  ) then
    create policy "painel owner only" on public.painel_evolucoes for all to authenticated
      using ((auth.jwt()->>'email') = '__OWNER_EMAIL__')
      with check ((auth.jwt()->>'email') = '__OWNER_EMAIL__');
  end if;
end $$;

-- c) painel_doc_templates ganhou a linha nome = 'evolucao_tasy': guia interno da IA para
--    preencher painel_evolucoes (não é documento gerável; o conteúdo vive só no banco).
-- d) O template 'receituario' deixou de ser usado; a linha continua no banco.
