# Painel de Internação (Caderno de Visitas)

App pessoal de um médico internista: `index.html` (offline-first, localStorage) + banco Supabase sincronizado manualmente (botões Enviar/Receber no app). A lógica pura fica em `painel-core.js` (UMD), testada com `node --test` (rode da raiz, sem argumento de caminho).

## Regras de privacidade (INEGOCIÁVEIS)

- O banco NUNCA recebe nome completo de paciente — apenas `painel_patients.initials`.
- Todo documento gerado usa o placeholder literal `[NOME]` no lugar do nome. O app substitui localmente na hora de copiar.
- Nunca grave nomes completos, CPF, telefone ou endereço de pacientes em nenhuma tabela.

## Banco (Supabase)

- Projeto: **Gestão Médica** (`kuhymtikommkoupynhkj`, região sa-east-1). As tabelas do Painel convivem com outro app no mesmo projeto, por isso usam o **prefixo `painel_`**.
- Acesso restrito por RLS ao usuário `__OWNER_EMAIL__` (o projeto tem outros usuários, mas só o dono enxerga as tabelas `painel_*`).

Tabelas: `painel_patients` (status: internado/alta/arquivado), `painel_problems` (status: ativo/resolvido/cronico, com `plano` e `ordem`), `painel_antibiotics`, `painel_cultures`, `painel_devices`, `painel_exams` (tipo: lab/imagem), `painel_condutas`, `painel_notes` (1 linha por paciente, PK = patient_id), `painel_raw_texts` (tipo: evolucao/prescricao/admissao — textos crus colados do prontuário), `painel_doc_templates`, `painel_generated_docs`.

Identifique pacientes por `bed_number` + `initials` (ex.: "leito 1012-A"). Em ambiguidade, pergunte.

## Fluxo 1 — Atualizar a base a partir de texto cru

Quando o usuário colar um texto do prontuário (ou pedir para processar `painel_raw_texts` pendentes):
1. Salve o texto em `painel_raw_texts` (tipo: evolucao/prescricao/admissao) se ainda não estiver lá.
2. Extraia e atualize: `painel_problems` (criar novos, atualizar status/plano dos existentes — não duplique problemas já cadastrados; compare por significado, não por string), `painel_antibiotics` (nome, D1, duração, indicação), `painel_condutas`, `anamnese_inicial` em `painel_patients` (apenas se for texto de admissão e o campo estiver vazio).
3. Gere `id` uuid para linhas novas. Não delete linhas que você não criou, a menos que o texto diga explicitamente (ex.: "suspenso ATB").
4. Resuma para o usuário o que mudou e lembre-o de tocar **Receber** no app.

## Fluxo 2 — Gerar documento

1. Leia o template em `painel_doc_templates` (`sumario_alta`, `receituario`, `laudo`) e siga as INSTRUÇÕES nele.
2. Leia o paciente completo (todas as tabelas `painel_*` + `painel_raw_texts`).
3. Gere o texto com `[NOME]`, mostre no chat E grave em `painel_generated_docs` (`patient_id`, `tipo`, `conteudo`).
4. Lembre o usuário de tocar **Receber** no app para o documento aparecer na seção "Documentos Gerados".

O receituário é gerado a partir do `painel_raw_text` mais recente do tipo `prescricao` — só medicações de uso domiciliar.

## Convenções de sync (não quebre)

- O push do app faz delete+insert dos filhos por paciente (`painel_problems`, `painel_antibiotics`, `painel_cultures`, `painel_devices`, `painel_exams`, `painel_condutas`, `painel_raw_texts`): edições da IA devem ser feitas entre um Enviar e um Receber do usuário (regra: última sincronização vence).
- `painel_notes` é upsert por `patient_id`. `painel_generated_docs` só cresce (o app nunca apaga no push).
- Nunca altere `painel_patients.id`.

## Desenvolvimento

- Testes: `node --test` (sempre rodar após mexer em `painel-core.js`).
- O app deve continuar funcionando 100% offline em `file://` — não introduza ES modules nem dependências de build. A biblioteca supabase-js é carregada sob demanda (lazy) só quando o usuário sincroniza.
- A lógica de sync é prefix-agnóstica em `painel-core.js` (chaves lógicas `patients`, `problems`, ...); o mapeamento para os nomes físicos `painel_*` é feito no `index.html` via a constante `TABLE_PREFIX`.
- Schema: `supabase/migrations/`. Mudanças de schema exigem migration nova + atualização de `buildPushPayload`/`applyPull` + testes.
