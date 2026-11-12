# Painel de Internação (Caderno de Visitas)

App pessoal de um médico internista: `index.html` (offline-first, localStorage) + banco Supabase sincronizado via botão **Sincronizar** (mescla three-way). A lógica pura fica em `painel-core.js` (UMD), testada com `node --test` (rode da raiz, sem argumento de caminho).

## Regras de privacidade (INEGOCIÁVEIS)

- O banco NUNCA recebe nome completo de paciente — apenas `painel_patients.initials`.
- Todo documento gerado usa o placeholder literal `[NOME]` no lugar do nome. O app substitui localmente na hora de copiar.
- Nunca grave nomes completos, CPF, telefone ou endereço de pacientes em nenhuma tabela.

## Banco (Supabase)

- Projeto: **Gestão Médica** (`kuhymtikommkoupynhkj`, região sa-east-1). As tabelas do Painel convivem com outro app no mesmo projeto, por isso usam o **prefixo `painel_`**.
- Acesso restrito por RLS ao usuário dono do painel (o e-mail real está configurado nas policies do banco; o projeto tem outros usuários, mas só o dono enxerga as tabelas `painel_*`).

Tabelas: `painel_patients` (status: internado/alta/arquivado/nuvem; `person_id` agrupa as internações da mesma pessoa — nulo = internação única; `discharge_date` = data da alta; `alergias` e `medicacoes_previas` = texto puro, '' quando não há), `painel_problems` (status: ativo/resolvido/cronico, com `plano` e `ordem`), `painel_antibiotics`, `painel_cultures`, `painel_devices` (`kind`: device/procedimento — cirurgias contam "PO Dn" e não alertam), `painel_exams` (tipo: lab/imagem), `painel_condutas`, `painel_notes` (1 linha por paciente, PK = patient_id), `painel_raw_texts` (tipo: evolucao/prescricao/admissao — textos crus colados do prontuário), `painel_evolucoes` (evolução no formato do Tasy: UMA linha por paciente por dia, `UNIQUE (patient_id, data)`; nove campos de texto puro: `problemas`, `historia_internacao`, `evolucao_atual`, `exames_lab`, `culturas`, `exames_imagem`, `atualizacao_problemas`, `metas`, `acoes`), `painel_doc_templates` (`sumario_alta`, `laudo`; `evolucao_tasy` é um guia interno para a IA preencher `painel_evolucoes`, não um documento gerável; `receituario` foi aposentado — a linha continua no banco, não use), `painel_generated_docs`, `painel_prefs` (preferências globais do app, PK = key; hoje só `lab_ranges` — upsert por chave no push, três-vias na mescla).

Identifique pacientes por `bed_number` + `initials` (ex.: "leito 1012-A"). Em ambiguidade, pergunte.

## Fluxo 1 — Atualizar a base a partir de texto cru

Quando o usuário colar um texto do prontuário (ou pedir para processar `painel_raw_texts` pendentes):
1. Salve o texto em `painel_raw_texts` (tipo: evolucao/prescricao/admissao) se ainda não estiver lá.
2. Extraia e atualize: `painel_problems` (criar novos, atualizar status/plano dos existentes — não duplique problemas já cadastrados; compare por significado, não por string), `painel_antibiotics` (nome, D1, duração, indicação), `painel_condutas`, `anamnese_inicial` em `painel_patients` (apenas se for texto de admissão e o campo estiver vazio).
3. Gere `id` uuid para linhas novas. Não delete linhas que você não criou, a menos que o texto diga explicitamente (ex.: "suspenso ATB").
4. Resuma para o usuário o que mudou e lembre-o de tocar **Sincronizar** no app.

## Fluxo 2 — Gerar documento

1. Leia o template em `painel_doc_templates` (`sumario_alta`, `laudo`) e siga as INSTRUÇÕES nele.
2. Leia o paciente completo (todas as tabelas `painel_*` + `painel_raw_texts`).
   Se `person_id` não for nulo, leia também as outras internações da pessoa (`where person_id = ... and id <> ...`) e cite-as quando relevante. Nunca crie nem altere `person_id`/`discharge_date`.
3. Gere o texto com `[NOME]`, mostre no chat E grave em `painel_generated_docs` (`patient_id`, `tipo`, `conteudo`).
4. Lembre o usuário de tocar **Sincronizar** no app para o documento aparecer na seção "Documentos Gerados".

O sumário de alta sai em blocos: cada bloco começa com uma linha `=== NOME DO CAMPO ===` e o último é `=== PARA CONFERIR (NÃO COLAR NO PRONTUÁRIO) ===`. O app mostra um botão "Copiar" por bloco (o de conferência é só leitura); sumários antigos, sem marcadores, aparecem inteiros.

Receituário não é mais gerado (os já gravados em `painel_generated_docs` continuam visíveis no histórico do app).

## Fluxo 3 — Evolução Tasy (`painel_evolucoes`)

1. Siga o guia `evolucao_tasy` em `painel_doc_templates`.
2. Uma linha por paciente por dia: se a linha do dia já existe, atualize-a (ou use `insert ... on conflict (patient_id, data) do update`). Nunca crie uma segunda linha para o mesmo dia.
3. Texto puro, sem markdown, e `[NOME]` no lugar do nome — o app troca localmente ao copiar.
4. Lembre o usuário de tocar **Sincronizar**: a evolução aparece na seção "Evolução Tasy" do paciente, com um botão "Copiar" por campo.

## Convenções de sync (não quebre)

- O app tem um único botão **Sincronizar**: baixa tudo, mescla (three-way: local × banco ×
  última foto sincronizada, por linha) e grava com delete+insert dos filhos por paciente
  (`painel_problems`, `painel_antibiotics`, `painel_cultures`, `painel_devices`, `painel_exams`,
  `painel_condutas`, `painel_raw_texts`).
- Edições da IA no banco (criar/editar/deletar linhas) são MESCLADAS na próxima sincronização
  do app — podem ser feitas a qualquer momento. Deleções de linhas pela IA propagam aos
  aparelhos; conflito na mesma linha: a versão do aparelho que sincronizar por último vence.
- `painel_notes` é upsert por `patient_id`. `painel_generated_docs` só cresce (o app nunca
  apaga no push). Nunca altere `painel_patients.id`.
- `painel_evolucoes` entra na mesma mescla three-way, mas a identidade da linha é a **data**
  (não o `id`) e a gravação é upsert em `(patient_id, data)` — o app nunca faz delete nessa
  tabela. O mesmo dia criado pela IA e no aparelho vira uma linha só (conteúdo: regra de
  conflito de sempre; `id`: o do banco).
- `painel_patients.alergias` e `medicacoes_previas` têm three-way POR CAMPO (hash próprio na
  foto, `syncBase[id].fields`), fora do hash geral dos scalars: a IA pode preenchê-los mesmo
  que o aparelho tenha editado outros campos do paciente.
- O pull lê cada tabela INTEIRA, em páginas (`pullAllTables` → `PainelCore.fetchAllRows`:
  ordem por chave primária + contagem exata). A API devolve no máximo ~1000 linhas por
  requisição sem erro, e uma tabela truncada seria lida pela mescla como deleção remota
  (o push então apagaria de verdade). Nunca volte a um `select('*')` simples no sync.
- Leito com nome sempre tem `patientId` na hora do sync (`ensurePatientIds`, no início de
  `mergeStates`): o leito nasce vazio e sem id, e o push pula leito sem id.
- `painel_patients.status` inclui `'nuvem'` = paciente guardado só no banco (nenhum aparelho
  tem leito dele). Não mude status para/de `'nuvem'` por conta própria; o app gerencia isso.

## Desenvolvimento

- Testes: `node --test` (sempre rodar após mexer em `painel-core.js`).
- O app deve continuar funcionando 100% offline em `file://` — não introduza ES modules nem dependências de build. A biblioteca supabase-js é carregada sob demanda (lazy) só quando o usuário sincroniza.
- A lógica de sync é prefix-agnóstica em `painel-core.js` (chaves lógicas `patients`, `problems`, ...); o mapeamento para os nomes físicos `painel_*` é feito no `index.html` via a constante `TABLE_PREFIX`.
- Schema: `supabase/migrations/`. Mudanças de schema exigem migration nova + atualização de `buildPushPayload`/`applyPull` + testes.
- Classes Tailwind novas em `index.html` exigem regenerar o CSS: `npx tailwindcss@3 -o styles.css --content ./index.html --minify`. Ao mudar arquivos do app, suba a versão do cache em `sw.js`.
