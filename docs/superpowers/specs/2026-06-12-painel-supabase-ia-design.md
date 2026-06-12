# Design: Painel de Internação + Supabase + Fluxos de IA

**Data:** 2026-06-12
**Status:** Aprovado pelo usuário

## Contexto

Médico internista acompanha 7–9 pacientes/dia em unidade de internação (não críticos), usando um app de página única (`PainelV15(1).html`) mobile-first que guarda tudo no `localStorage` do navegador (chave `wardBookData_v14_tasks`), com backup manual via export/import JSON.

Estrutura atual de cada leito: `bedNumber`, `patientName`, `age`, `admitDate`, `diagnoses[]`, `hpp` (texto único onde hoje se misturam anamnese e problemas), `notes` (texto livre SOAP), `condutas[]`, `trackers[]` (antibióticos, culturas, dispositivos), `exams[]` (labs e imagem), previsão de alta, lembretes, checks diários, tarefas gerais.

### Problemas a resolver

1. **Geração de documentos** (sumário de alta, receituário, laudos) pré-formatados com ajuda de IA, a partir de layouts pré-estabelecidos (usuário tem modelos reais).
2. **Preenchimento da base por IA** a partir de texto cru colado do prontuário eletrônico (diagnósticos, antibióticos, condutas) — mantendo app e prontuário alinhados.
3. **Separar "anamnese inicial" da "lista de problemas atuais"** (hoje misturadas no campo HPP/diagnósticos).
4. Dados presos no `localStorage` — nenhuma IA consegue ler ou editar.

### Decisões de requisito (entrevista)

- **Uso:** celular, internet instável → app deve ser **offline-first**; sync manual quando houver sinal.
- **Privacidade:** nome completo do paciente fica **só no aparelho** (`localStorage`); o Supabase recebe apenas **iniciais + leito**; documentos gerados saem com placeholder `[NOME]`.
- **Formato dos documentos:** texto puro pra colar no prontuário do hospital.
- **Templates:** usuário fornece modelos reais (anonimizados) na implementação.
- **Fluxos de IA:** ambos — Claude Code no PC (MCP Supabase já conectado) e Project no claude.ai (conector Supabase) → templates devem viver **no banco**.
- **Formato do app:** manter HTML único; hospedar como página estática (GitHub Pages) para acesso por URL; arquivo local continua funcionando.

## Arquitetura geral

Três peças:

1. **App** (evolução do HTML atual): offline-first com `localStorage` como fonte de verdade local; login Supabase (feito uma vez, sessão lembrada); botões **Enviar** (push) e **Receber** (pull) no cabeçalho com indicador de última sincronização. Export/import JSON mantido como backup.
2. **Banco Supabase**: tabelas normalizadas (abaixo), consultáveis por IA via SQL/MCP.
3. **Fluxos de IA**: Claude Code (PC) e Project claude.ai (celular), ambos lendo templates e dados do banco.

**Regra de conflito do sync:** "última sincronização vence", por paciente (usuário único; conflito real é raro). Todas as tabelas têm `updated_at`.

## Esquema do banco (Supabase / Postgres)

| Tabela | Campos principais |
|---|---|
| `patients` | `id` (uuid), `bed_number`, `initials` (nunca nome completo), `age`, `admit_date`, `hpp` (antecedentes/comorbidades), `anamnese_inicial` (texto), `discharge_forecast`, `status` (internado / alta / arquivado), `updated_at` |
| `problems` | `id`, `patient_id`, `descricao`, `status` (ativo / resolvido / crônico), `plano` (1 linha), `ordem`, `updated_at` |
| `antibiotics` | `id`, `patient_id`, `nome`, `start_date` (D1), `duration_days`, `end_date`, `indicacao`, `updated_at` |
| `cultures` | `id`, `patient_id`, `tipo`, `collection_date`, `resultado`, `updated_at` |
| `devices` | `id`, `patient_id`, `nome`, `install_date`, `removal_date`, `updated_at` |
| `exams` | `id`, `patient_id`, `tipo` (lab / imagem), `nome`, `data`, `resultado` (valor ou resumo do laudo), `updated_at` |
| `condutas` | `id`, `patient_id`, `texto`, `done` (bool), `data`, `updated_at` |
| `notes` | `id`, `patient_id`, `texto` (campo SOAP atual), `updated_at` |
| `raw_texts` | `id`, `patient_id`, `tipo` (evolucao / prescricao / admissao), `data`, `texto`, `updated_at` — matéria-prima da IA |
| `doc_templates` | `id`, `nome` (sumario_alta / receituario / laudo_*), `descricao`, `template` (texto com placeholders + instruções de preenchimento pra IA), `updated_at` |
| `generated_docs` | `id`, `patient_id`, `tipo`, `conteudo` (texto com `[NOME]`), `created_at` |

Separação solicitada: **HPP** (comorbidades) ≠ **Anamnese inicial** (história da admissão, escrita uma vez) ≠ **Lista de problemas** (estruturada, viva, com status). A lista de problemas substitui o textarea "Diagnósticos Principais" e é a espinha dorsal do sumário de alta.

Segurança: RLS habilitado, acesso restrito ao usuário autenticado (conta única do médico).

## Mudanças no app

1. **"Diagnósticos Principais" → "Lista de Problemas"**: cada problema é uma linha com chip de status (toque alterna ativo → resolvido → crônico) e campo opcional de plano. Diagnósticos existentes migram como "ativo".
2. **Nova seção colapsável "Anamnese Inicial"** (textarea simples).
3. **Nova seção "Texto do Prontuário"**: colar texto cru no próprio celular (tipo: evolução / prescrição / admissão); vai pra `raw_texts` no sync — alimenta a IA sem precisar do PC.
4. **Nova seção "Documentos Gerados"**: lista os `generated_docs` do paciente (recebidos no pull) com botão **copiar** — ao copiar, o app substitui `[NOME]` pelo nome completo guardado localmente. O documento final ganha o nome sem que ele jamais saia do aparelho.
5. **Sync**: botões Enviar/Receber, indicador de última sincronização, login Supabase via supabase-js (CDN).
6. Push remove o nome completo (envia iniciais); pull traz edições feitas pela IA.

## Fluxos de IA

1. **Texto cru → base**: usuário cola evolução do prontuário (no app ou direto no chat) → IA interpreta e preenche `problems`, `antibiotics`, `condutas`, `anamnese_inicial` etc. no banco, e arquiva o texto em `raw_texts` → usuário dá "Receber" no app.
2. **Gerar documento**: "gere o sumário de alta do leito 1012-A" → IA lê paciente completo + `raw_texts` + template em `doc_templates` → grava em `generated_docs` e devolve o texto no chat. Receituário gerado a partir do texto cru da prescrição.
3. **Instruções da IA**: `CLAUDE.md` neste projeto (PC) e instruções equivalentes no Project do claude.ai (celular). Regras: nunca gravar nome completo; sempre usar `[NOME]`; seguir os templates de `doc_templates`.

## Migração

Export do JSON atual → script popula o Supabase e converte para o novo formato local. `diagnoses[]` viram `problems` com status "ativo"; `hpp` permanece; `anamnese_inicial` nasce vazia (usuário preenche/IA extrai do texto de admissão). Nada se perde.

## Tratamento de erros

- Sync falhou (sem sinal): app avisa e mantém dados locais intactos; tentar de novo é seguro (upsert idempotente).
- Sessão Supabase expirada: app pede login novamente; dados locais não são afetados.
- Pull com paciente deletado localmente: regra "última sincronização vence" — pull traz o estado do banco.

## Testes

- Testes manuais guiados por checklist: criar/editar/arquivar leito offline; push e verificação no banco (iniciais, não nome); edição via IA + pull; geração de documento + cópia com substituição de `[NOME]`; migração do JSON real do usuário.
- Validação dos fluxos de IA com 1–2 casos reais anonimizados antes do uso diário.

## Fora de escopo

- Integração direta do app com IA (chamadas de API de dentro do app).
- Multiusuário / compartilhamento com colegas.
- Função de prontuário eletrônico completo (o app segue sendo caderno de visitas).
