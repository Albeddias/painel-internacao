# Design: Múltiplas internações por paciente (Reinternar)

**Data:** 2026-09-08
**Status:** Aprovado pelo usuário (design em chat); spec aguardando revisão final

## Contexto

Hoje um "leito" no app é o registro inteiro do paciente. Na alta, o app guarda uma cópia em
Arquivados (status `alta`) e zera o leito. Quando a mesma pessoa reinterna, o usuário vai em
Arquivados, toca **Restaurar** e reedita data de admissão, HDA e problemas por cima do registro
antigo. Isso destrói a internação anterior: não sobra registro do que aconteceu da outra vez.

Objetivo: cada internação vira um registro próprio, ligado aos anteriores da mesma pessoa, com
HDA e problemas atuais novos e histórico das internações prévias consultável.

### Decisões de requisito (entrevista)

- **Entrada do fluxo:** botão **Reinternar** na lista Arquivados (é o gesto que o usuário já faz
  hoje com Restaurar). Não há detecção por nome ao nomear leito.
- **O que copia para a internação nova:** nome, idade, HPP, exames (lab e imagem), problemas com
  status `cronico`, antibióticos, culturas, dispositivos e procedimentos.
- **O que fica em branco:** HDA (anamnese inicial), data de admissão (preenchida com hoje,
  editável), previsão de alta, problemas `ativo`/`resolvido`, condutas, notas (evolução), textos
  crus, documentos gerados, checks do dia, médico externo, lembrete, visita.
- **Histórico:** seção "Internações anteriores" na tela do paciente; Arquivados mostra só a
  internação mais recente de cada pessoa.
- **Abordagem escolhida:** vínculo leve — cada internação continua sendo uma linha em
  `painel_patients` com seus filhos; uma coluna `person_id` agrupa as internações da mesma
  pessoa. Descartadas: tabela `painel_admissions` normalizada (migrar todas as filhas e
  reescrever o sync, risco alto para ganho que o usuário não sente) e histórico embutido como
  JSON dentro do paciente (não consultável pela IA linha a linha, linhas crescem sem limite).
- A duplicação de HPP/idade/exames entre internações é aceita: volume irrelevante para o
  Postgres e é o que já acontece hoje na prática.

## 1. Modelo de dados

### Migration `supabase/migrations/006_painel_person.sql`

```sql
alter table public.painel_patients
  add column person_id uuid,
  add column discharge_date date;
create index painel_patients_person_id_idx on public.painel_patients (person_id);
```

- `person_id`: nulo para registros existentes. Todas as internações da mesma pessoa compartilham
  o mesmo valor. Na primeira reinternação de um registro sem `person_id`, ele recebe
  `person_id = seu próprio id`; a internação nova herda esse valor. Não há tabela de pessoas.
- `discharge_date`: data da alta. Corresponde ao campo local `dischargedAt`, que já existe mas
  hoje não sobe ao banco. Nulo quando não houve alta (`arquivado`, `internado`, `nuvem`).
- **Sem backfill:** não há como agrupar registros antigos com segurança (banco não tem nome;
  no aparelho nomes iguais podem ser homônimos). Registros sem `person_id` são pessoas com
  internação única e se comportam exatamente como hoje.

### Estado local (`bed`)

`migrateBed` ganha `personId: b.personId || null`. `dischargedAt` já existe. Nada muda nas
coleções filhas.

### Regra de identidade

Internações da mesma pessoa = mesmo `personId` não nulo. Ordem cronológica = `admitDate`
crescente; empate desfeito por `dischargedAt` e, por fim, pela posição em `state.beds`.

## 2. Fluxo "Reinternar"

### Função pura em `painel-core.js`

```
buildReadmission(previousBed, bedNumber, todayStr) -> { newBed, previousPatch }
```

- `previousPatch`: `{ personId }` a aplicar no registro anterior — o `personId` existente ou,
  se nulo, `previousBed.patientId`. O registro anterior não muda em mais nada.
- `newBed` (passa por `migrateBed` para garantir campos default):
  - `patientId: uuid()`, `personId` = o mesmo do patch, `bedNumber`, `patientName`, `age`,
    `hpp` copiados; `admitDate: todayStr`; `anamneseInicial: ''`; `dischargeForecast: ''`;
    `isArchived: false`, `archiveReason: null`, `dischargedAt: ''`.
  - `problems`: só os com `status === 'cronico'`, com `id: uuid()` novo, `ordem` reindexada,
    `plano` mantido.
  - `exams`: cópia profunda de todos (lab e imagem), com `id` novo em cada exame de imagem e em
    cada coleta de lab (os resultados de lab dentro da coleta não têm id).
  - `trackers`: cópia de todos com `id` novo. Fechamento dos abertos usando
    `closeDate = previousBed.dischargedAt || todayStr`:
    - `type === 'atb'` sem `endDate` → `endDate = closeDate`.
    - `type === 'device'` (kind device ou procedimento) sem `removalDate` → `removalDate = closeDate`.
    - culturas não mudam.
  - Em branco: `condutas: []`, `notes: ''`, `rawTexts: []`, `generatedDocs: []`,
    `externalDoctor: { active: false, name: '' }`, `checks` zerados, `isVisited: false`,
    `reminderDate: ''`. Flags `is*Minimized` no default, exceto `isAnamneseMinimized: false`
    para a HDA já aparecer aberta.

### UI (`index.html`)

1. Em Arquivados, novo botão **Reinternar** ao lado de **Restaurar** (que continua existindo
   para desfazer um arquivamento errado).
2. Ao tocar, abre um modal de destino reutilizando o campo de número de leito: lista os leitos
   vazios existentes (tocar escolhe) e um campo para digitar um número novo. Número já ocupado
   por paciente internado é recusado com aviso.
3. O app chama `buildReadmission`, aplica `previousPatch` no registro anterior, insere `newBed`
   no leito escolhido (substituindo o leito vazio, ou `push` se for número novo), grava, fecha o
   modal e abre a tela do paciente novo.
4. Nenhuma sincronização automática; o registro novo sobe no próximo **Sincronizar** como
   qualquer paciente novo.

## 3. Telas

### Tela do paciente: "Internações anteriores"

- Seção recolhível nova, entre HPP e HDA, exibida apenas quando existe pelo menos um outro
  leito em `state.beds` com o mesmo `personId` (internações guardadas só na nuvem não aparecem
  aqui; aparecem na lista "Na nuvem" de Arquivados).
- Lista todas as outras internações da pessoa em ordem cronológica decrescente. Cada linha:
  período (`admitDate` a `dischargedAt`, ou "sem alta registrada"), leito da época e o primeiro
  problema `ativo` daquele registro (ou "—").
- Tocar abre o registro pela `openPatientDetails` de hoje. A tela ganha uma faixa fixa no topo:
  "Internação anterior · alta em dd/mm/aaaa" quando `archiveReason === 'alta'`, ou
  "Internação anterior (arquivada)" caso contrário. Não há modo somente leitura: a tela de
  arquivado já é editável hoje, e isso permite corrigir um dado antigo.
- Regra da faixa: aparece em qualquer registro `isArchived` cujo `personId` seja compartilhado
  com outro leito do aparelho, independentemente de como foi aberto. Sem estado de navegação.
- Voltar usa o mecanismo de histórico já existente (`pushScreenState`), então retorna à tela
  de onde veio.

### Lista Arquivados

- Agrupa os arquivados por `personId`. Para cada grupo, mostra só a internação mais recente
  (regra de ordem da seção 1) com o sufixo "· 3ª internação" quando o grupo tem mais de uma.
  Registros sem `personId` continuam individuais.
- Busca: o termo (nome ou leito) bate no grupo se bater em qualquer internação dele.
- Botões da linha:
  - **Restaurar**: age só na internação mostrada (comportamento atual).
  - **Reinternar**: seção 2.
  - **Nuvem**: guarda na nuvem todas as internações do grupo, em sequência, com uma única
    confirmação ("Guardar as N internações de X só na nuvem?"). `archiveBedToCloud` passa a
    aceitar uma lista de leitos: um único `doSync`, um `update ... in (ids)` para
    `status='nuvem'`, remoção local de todos.
  - **Deletar**: deleta só a internação mostrada; o texto de confirmação avisa que as
    anteriores continuam em Arquivados quando houver.
- Função pura `groupArchived(beds)` em `painel-core.js` devolve
  `[{ latest, all, count }]` já filtrado e ordenado, para a UI só renderizar.

### Lista "Na nuvem"

- `state.cloudArchived[pid]` ganha `personId`. A lista agrupa por `personId` e mostra uma
  linha por pessoa com "N internações". **Trazer de volta** restaura todos os ids do grupo
  (um `update ... in (ids)` para `status='arquivado'` + um `doSync`).
- Registros na nuvem sem `personId` continuam individuais.

## 4. Sync e IA

- `buildPushPayload`: patients ganha `person_id: b.personId || null` e
  `discharge_date: b.dischargedAt || null`.
- `applyPatientScalars` (pull): `bed.personId = p.person_id || null`;
  `bed.dischargedAt = p.discharge_date || ''`.
- `localScalarsHash` e o hash do banco incluem `person_id` e `discharge_date`, para a mescla
  three-way tratá-los como qualquer escalar (dono da última modificação vence). Na primeira
  sincronização após atualizar o app, a foto (`syncBase`) ainda guarda hashes na fórmula
  antiga, então local e banco parecem "ambos alterados" para todo paciente. Isso é inofensivo:
  quando os dois lados têm o mesmo conteúdo, qualquer vencedor produz o mesmo resultado, e a
  foto é regravada na fórmula nova. Teste cobre esse cenário (base antiga, local = banco).
- Regra "Nunca altere `painel_patients.id`" continua valendo; `person_id` é coluna comum.
- A adoção de pacientes vindos do banco (`applyPull` para ids desconhecidos) já cria leitos
  arquivados; o `personId` vem junto e a UI agrupa sem trabalho extra.
- `cloudArchived` recebe `personId` no momento em que o app marca o paciente como nuvem
  (local) e ao adotar registros `nuvem` no pull (`p.person_id`).
- **IA** (CLAUDE.md e `docs/ai/claude-ai-project-instructions.md`): ao gerar sumário de alta
  ou processar texto cru, buscar internações prévias com
  `select ... from painel_patients where person_id = <person_id do paciente> and id <> <id>` e
  poder citar "internação prévia em mês/ano por X". A IA nunca cria nem altera `person_id` nem
  `discharge_date`.

## 5. Testes

`tests/readmission.test.cjs`:

- `buildReadmission`: copia nome/idade/HPP/exames/trackers com ids novos e distintos dos
  originais; só problemas `cronico`; HDA, condutas, notas, textos crus, docs vazios; antibiótico
  sem término e dispositivo sem retirada recebem `dischargedAt` do anterior (ou `todayStr` se
  não houver); cultura não muda; `admitDate = todayStr`; flags de arquivo limpas.
- `previousPatch`: `personId = patientId` quando nulo; mantém o existente.
- `groupArchived`: mais recente por `personId`, `count` correto, sem `personId` fica
  individual, ordem cronológica, busca bate em internação antiga do grupo.
- `buildPushPayload` ⇄ `applyPull`: ida e volta de `person_id` e `discharge_date`.
- `localScalarsHash` muda quando `personId` ou `dischargedAt` mudam e coincide com o hash da
  linha do banco equivalente.

Além disso: `node --test` completo verde e teste manual em `file://`: dar alta, reinternar em
leito vazio e em leito novo, ver "Internações anteriores", abrir a antiga e voltar, sincronizar
em dois navegadores e conferir que o registro antigo ganhou `person_id` sem perder nada.

## Fora de escopo

- Detecção automática de reinternação ao digitar nome.
- Backfill de `person_id` em registros antigos.
- Modo somente leitura para internações anteriores.
- Botão "deletar pessoa inteira".
- Mesclar ou "desvincular" internações agrupadas por engano (correção manual via SQL se
  acontecer; risco baixo porque o vínculo só nasce pelo botão Reinternar).
