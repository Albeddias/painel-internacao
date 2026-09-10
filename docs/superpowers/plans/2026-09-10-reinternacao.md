# Reinternação (múltiplas internações por paciente) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que uma pessoa tenha várias internações no app, cada uma como registro próprio ligado às anteriores por `person_id`, com botão **Reinternar** em Arquivados e histórico "Internações anteriores" na tela do paciente.

**Architecture:** Vínculo leve: cada internação continua sendo uma linha em `painel_patients` com seus filhos; duas colunas novas (`person_id`, `discharge_date`) agrupam e datam. Toda lógica nova (cópia da reinternação, agrupamento, ordenação, sync dos campos) é função pura em `painel-core.js` com testes em `node --test`; `index.html` só renderiza e chama.

**Tech Stack:** HTML + JS clássico (UMD, sem build, funciona em `file://`), Tailwind pré-compilado (`styles.css`), Supabase (Postgres + supabase-js lazy), `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-08-reinternacao-design.md`

## Global Constraints

- Privacidade: o banco NUNCA recebe nome completo; `person_id` é uuid opaco, nunca derivado do nome.
- Sem ES modules, sem dependências de build; `index.html` deve funcionar 100% offline em `file://`.
- `painel-core.js` é prefix-agnóstico (chaves lógicas `patients`, `problems`...); prefixo `painel_` só em `index.html` via `TABLE_PREFIX`.
- Rode os testes sempre da raiz com `node --test` (sem caminho). Suíte atual: 135 testes passando.
- Nunca altere `painel_patients.id`. Não mude status para/de `'nuvem'` fora dos fluxos já existentes.
- Commits em português, no formato `tipo(escopo): descrição`, terminando com a linha `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Após adicionar classes Tailwind novas em `index.html`, regenerar: `npx tailwindcss@3 -o styles.css --content ./index.html --minify`.

## Mapa de arquivos

| Arquivo | Responsabilidade nesta feature |
|---|---|
| `supabase/migrations/006_painel_person.sql` | Cria `person_id` e `discharge_date` em `painel_patients` + índice |
| `painel-core.js` | `personId` no leito; hash/push/pull dos campos; regra de adoção de `person_id` na mescla; `buildReadmission`; `personAdmissions`, `previousAdmissions`, `groupArchived`, `groupCloudArchived` |
| `tests/readmission.test.cjs` | Todos os testes desta feature |
| `index.html` | Botão Reinternar + modal de destino; seção "Internações anteriores" + faixa; Arquivados e "Na nuvem" agrupados; nuvem/restaurar em grupo |
| `styles.css` | Regenerado |
| `CLAUDE.md`, `docs/ai/claude-ai-project-instructions.md` | Documentam `person_id`/`discharge_date` para a IA |

---

### Task 1: Migration `006_painel_person.sql`

**Files:**
- Create: `supabase/migrations/006_painel_person.sql`
- Modify: `CLAUDE.md:16` (linha "Tabelas:")

**Interfaces:**
- Produces: colunas `painel_patients.person_id uuid null` e `painel_patients.discharge_date date null`, lidas/escritas pelas Tasks 2–3.

- [ ] **Step 1: Criar o arquivo da migration**

```sql
-- Múltiplas internações por pessoa (spec 2026-09-08-reinternacao-design.md).
-- person_id agrupa as internações da mesma pessoa (uuid opaco; NUNCA derivado do nome).
-- Registros antigos ficam com person_id nulo = pessoa com internação única. Sem backfill.
-- discharge_date: data da alta (antes só existia no aparelho, como dischargedAt).

alter table public.painel_patients
  add column person_id uuid,
  add column discharge_date date;

create index painel_patients_person_id_idx on public.painel_patients (person_id);
```

- [ ] **Step 2: Aplicar no projeto Supabase**

Use a ferramenta MCP `apply_migration` do Supabase com `project_id: kuhymtikommkoupynhkj`, `name: painel_person` e o SQL acima. Se a ferramenta não estiver disponível na sessão, avise o usuário para colar o SQL no SQL Editor do projeto "Gestão Médica" e continue as tasks seguintes (elas não dependem do banco para passar nos testes).

Verifique com `execute_sql`:
```sql
select column_name, data_type from information_schema.columns
where table_name = 'painel_patients' and column_name in ('person_id','discharge_date');
```
Esperado: 2 linhas.

- [ ] **Step 3: Documentar no CLAUDE.md**

Na linha 16, troque `` `painel_patients` (status: internado/alta/arquivado/nuvem) `` por:

```
`painel_patients` (status: internado/alta/arquivado/nuvem; `person_id` agrupa as internações da mesma pessoa — nulo = internação única; `discharge_date` = data da alta)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/006_painel_person.sql CLAUDE.md
git commit -m "feat(schema): person_id e discharge_date em painel_patients (reinternação)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `personId` e `dischargedAt` no modelo local e no sync (push, pull, hash)

**Files:**
- Modify: `painel-core.js` — `localScalarsHash` (~linha 158), `migrateBed` (~linha 667), `buildPushPayload` (~linha 756), `applyPatientScalars` (~linha 799)
- Create: `tests/readmission.test.cjs`

**Interfaces:**
- Produces: `bed.personId` (string uuid ou `null`); `bed.dischargedAt` (já existia, string ISO ou `''`) agora sincronizado; payload `patients[i].person_id`, `patients[i].discharge_date`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/readmission.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

function altaBed(over) {
  return PainelCore.migrateBed(Object.assign({
    patientId: 'p-old', bedNumber: '1012-A', patientName: 'Mariana Silva Dias', age: 32,
    admitDate: '2026-06-07', hpp: 'HAS, DM2', anamneseInicial: 'Admitida com dispneia.',
    problems: [
      { id: 'pr1', descricao: 'Pneumonia', status: 'resolvido', plano: '', ordem: 0 },
      { id: 'pr2', descricao: 'DRC 3b', status: 'cronico', plano: 'Nefro ambulatorial', ordem: 1 },
      { id: 'pr3', descricao: 'Anemia', status: 'ativo', plano: '', ordem: 2 },
    ],
    notes: 'Evolução estável.',
    condutas: [{ id: 'c1', text: 'Manter ATB', done: true }],
    trackers: [
      { id: 'a1', type: 'atb', name: 'Ceftriaxona', startDate: '2026-06-07', duration: 7, endDate: '' },
      { id: 'a2', type: 'atb', name: 'Azitromicina', startDate: '2026-06-07', duration: 5, endDate: '2026-06-11' },
      { id: 'c1', type: 'culture', name: 'Hemocultura', collectionDate: '2026-06-08', result: 'KPC' },
      { id: 'd1', type: 'device', name: 'CVC', installDate: '2026-06-07', removalDate: '' },
      { id: 'd2', type: 'device', kind: 'procedimento', name: 'Colecistectomia', installDate: '2026-06-10', removalDate: '' },
    ],
    exams: [
      { id: 'l1', type: 'lab', date: '2026-06-10', results: [{ name: 'Hb', value: '9.5' }] },
      { id: 'i1', type: 'image', date: '2026-06-09', name: 'TC Tórax', summary: 'Consolidação' },
    ],
    rawTexts: [{ id: 'r1', tipo: 'evolucao', data: '2026-06-11', texto: 'Texto cru.' }],
    generatedDocs: [{ id: 'g1', tipo: 'sumario_alta', conteudo: '[NOME] ...', createdAt: '2026-06-12' }],
    isArchived: true, archiveReason: 'alta', dischargedAt: '2026-06-12',
  }, over || {}));
}

// ---- Task 2: modelo local + sync dos campos --------------------------------

test('migrateBed: personId nasce null e é preservado', () => {
  assert.strictEqual(PainelCore.migrateBed({ patientName: 'X' }).personId, null);
  assert.strictEqual(PainelCore.migrateBed({ patientName: 'X', personId: 'per-1' }).personId, 'per-1');
});

test('buildPushPayload: envia person_id e discharge_date (null quando vazios)', () => {
  const a = altaBed({ personId: 'per-1' });
  const b = altaBed({ patientId: 'p-2', personId: null, dischargedAt: '', isArchived: false, archiveReason: null });
  const state = PainelCore.migrateState({ beds: [a, b] }, '2026-09-10');
  const p = PainelCore.buildPushPayload(state);
  assert.strictEqual(p.patients[0].person_id, 'per-1');
  assert.strictEqual(p.patients[0].discharge_date, '2026-06-12');
  assert.strictEqual(p.patients[1].person_id, null);
  assert.strictEqual(p.patients[1].discharge_date, null);
});

test('applyPull: lê person_id e discharge_date do banco', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-09-10');
  PainelCore.applyPull(state, {
    patients: [{ id: 'p-old', bed_number: '1012-A', initials: 'MSD', age: 32, admit_date: '2026-06-07', hpp: '',
      anamnese_inicial: '', discharge_forecast: null, status: 'alta', person_id: 'per-1', discharge_date: '2026-06-12' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [],
  });
  assert.strictEqual(state.beds[0].personId, 'per-1');
  assert.strictEqual(state.beds[0].dischargedAt, '2026-06-12');
  assert.strictEqual(state.beds[0].archiveReason, 'alta');
});

test('applyPull: person_id/discharge_date ausentes viram null/""', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-09-10');
  PainelCore.applyPull(state, {
    patients: [{ id: 'p-old', bed_number: '1012-A', initials: 'MSD', status: 'arquivado' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [],
  });
  assert.strictEqual(state.beds[0].personId, null);
  assert.strictEqual(state.beds[0].dischargedAt, '');
});

test('syncBase: hash de escalares muda quando personId ou dischargedAt mudam', () => {
  const mk = (over) => PainelCore.migrateState({ beds: [altaBed(over)] }, '2026-09-10');
  const h = (s) => PainelCore.buildSyncBase(s)['p-old'].scalars;
  const base = h(mk({}));
  assert.notStrictEqual(h(mk({ personId: 'per-1' })), base);
  assert.notStrictEqual(h(mk({ dischargedAt: '2026-06-13' })), base);
  assert.strictEqual(h(mk({})), base, 'determinístico');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test`
Esperado: os testes `buildPushPayload: envia person_id...`, `applyPull: lê person_id...`, `syncBase: hash...` falham (`undefined` em vez dos valores). `migrateBed: personId nasce null` também falha (`undefined !== null`).

- [ ] **Step 3: Implementar em `painel-core.js`**

Em `migrateBed`, logo após a linha `patientId: ...`, adicione:

```js
      personId: b.personId || null,   // agrupa internações da mesma pessoa (null = internação única)
```

Em `localScalarsHash`, troque o `return` por:

```js
    return hash8(j(bed.bedNumber, age, bed.admitDate, bed.hpp, bed.anamneseInicial, bed.dischargeForecast, status, bed.notes,
      bed.personId, bed.dischargedAt));
```

Em `buildPushPayload`, dentro de `out.patients.push({ ... })`, após a linha `status: ...,` adicione:

```js
        person_id: b.personId || null,
        discharge_date: b.dischargedAt || null,
```

Em `applyPatientScalars`, após `bed.archiveReason = ...;` adicione:

```js
    bed.personId = p.person_id || null;
    bed.dischargedAt = p.discharge_date || '';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Esperado: 140 testes, 0 falhas. (Se algum teste antigo de `syncbase`/`merge-states` comparar hash literal, ele quebra: atualize o literal, pois a fórmula do hash mudou de propósito.)

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/readmission.test.cjs
git commit -m "feat(sync): personId e dischargedAt entram no push, pull e hash de escalares

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Mescla — adoção de `person_id` remoto e transição de fórmula do hash

**Files:**
- Modify: `painel-core.js` — `mergeStates` (~linhas 284–290 bloco `nuvem`; ~linha 321 após o bloco de scalars)
- Modify: `tests/readmission.test.cjs`

**Interfaces:**
- Consumes: `bed.personId`, `applyPatientScalars` (Task 2).
- Produces: `state.cloudArchived[id].personId`.

Regra: `personId` só nasce pelo botão Reinternar e nunca é editado à mão, então se o banco tem `person_id` e o aparelho não, o aparelho adota SEMPRE, mesmo com scalars locais alterados. Sem isso, um aparelho com foto antiga (ou que editou HPP) sobrescreveria o `person_id` do banco com null no push.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao final de `tests/readmission.test.cjs`:

```js
// ---- Task 3: mescla ---------------------------------------------------------

function pulledFor(bed, over) {
  return {
    patients: [Object.assign({ id: bed.patientId, bed_number: bed.bedNumber, initials: 'MSD', age: bed.age,
      admit_date: bed.admitDate, hpp: bed.hpp, anamnese_inicial: bed.anamneseInicial, discharge_forecast: null,
      status: 'alta', person_id: null, discharge_date: bed.dischargedAt || null }, over || {})],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
    notes: [{ patient_id: bed.patientId, texto: bed.notes }], raw_texts: [], generated_docs: [], prefs: [],
  };
}

test('mergeStates: adota person_id do banco quando local é null, mesmo com scalars locais alterados', () => {
  const bed = altaBed({ problems: [], trackers: [], exams: [], rawTexts: [], condutas: [], generatedDocs: [] });
  const state = PainelCore.migrateState({ beds: [bed] }, '2026-09-10');
  state.syncedPatientIds = ['p-old'];
  state.syncBase = PainelCore.buildSyncBase(state);
  state.beds[0].hpp = 'HAS, DM2, DPOC'; // edição local → scalars "tocados"
  PainelCore.mergeStates(state, pulledFor(bed, { person_id: 'per-1' }));
  assert.strictEqual(state.beds[0].personId, 'per-1');
  assert.strictEqual(state.beds[0].hpp, 'HAS, DM2, DPOC', 'edição local preservada');
});

test('mergeStates: personId recém-criado pelo Reinternar (local tocado) vence o null do banco', () => {
  const bed = altaBed({ problems: [], trackers: [], exams: [], rawTexts: [], condutas: [], generatedDocs: [] });
  const state = PainelCore.migrateState({ beds: [bed] }, '2026-09-10');
  state.syncedPatientIds = ['p-old'];
  state.syncBase = PainelCore.buildSyncBase(state);
  state.beds[0].personId = 'per-1'; // Reinternar aplicou previousPatch depois da última foto
  PainelCore.mergeStates(state, pulledFor(bed, { person_id: null }));
  assert.strictEqual(state.beds[0].personId, 'per-1');
  assert.strictEqual(PainelCore.buildPushPayload(state).patients[0].person_id, 'per-1');
});

test('mergeStates: foto na fórmula antiga (sem personId/dischargedAt) não perde nada quando local = banco', () => {
  const bed = altaBed({ problems: [], trackers: [], exams: [], rawTexts: [], condutas: [], generatedDocs: [] });
  const state = PainelCore.migrateState({ beds: [bed] }, '2026-09-10');
  state.syncedPatientIds = ['p-old'];
  // Simula foto gravada pela versão anterior do app: hash sem os campos novos.
  const old = PainelCore.hash8(['1012-A', '32', '2026-06-07', 'HAS, DM2', 'Admitida com dispneia.', '', 'alta', 'Evolução estável.'].join('\u0001')); // mesmo separador interno de j()
  state.syncBase = { 'p-old': { rows: { problems: {}, antibiotics: {}, cultures: {}, devices: {}, condutas: {}, raw_texts: {}, examsImage: {}, examsLab: {} }, scalars: old } };
  PainelCore.mergeStates(state, pulledFor(bed, { discharge_date: null })); // banco ainda sem discharge_date
  assert.strictEqual(state.beds[0].hpp, 'HAS, DM2');
  assert.strictEqual(state.beds[0].dischargedAt, '2026-06-12', 'data de alta local sobrevive e vai subir');
  assert.strictEqual(PainelCore.buildPushPayload(state).patients[0].discharge_date, '2026-06-12');
});

test('mergeStates: paciente nuvem registra personId em cloudArchived', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-09-10');
  state.cloudArchived = {};
  PainelCore.mergeStates(state, {
    patients: [{ id: 'p-cloud', bed_number: '1012-A', initials: 'MSD', status: 'nuvem', person_id: 'per-1' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [], prefs: [],
  });
  assert.strictEqual(state.cloudArchived['p-cloud'].personId, 'per-1');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test`
Esperado: falham `adota person_id do banco...` (personId fica null) e `paciente nuvem registra personId` (undefined). Os outros dois podem passar já — tudo bem, ficam como regressão.

- [ ] **Step 3: Implementar em `mergeStates`**

No bloco `if (p.status === 'nuvem') {`, adicione `personId: p.person_id || null` nos dois objetos gravados em `state.cloudArchived[p.id]`:

```js
      if (p.status === 'nuvem') {
        if (bed) {
          state.cloudArchived[p.id] = { nome: bed.patientName || '', iniciais: p.initials || '', leito: p.bed_number || bed.bedNumber || '', personId: p.person_id || null };
          state.beds = state.beds.filter(function (b) { return b.patientId !== p.id; });
        } else if (!state.cloudArchived[p.id]) {
          state.cloudArchived[p.id] = { nome: '', iniciais: p.initials || '', leito: p.bed_number || '', personId: p.person_id || null };
        } else {
          state.cloudArchived[p.id].personId = p.person_id || state.cloudArchived[p.id].personId || null;
        }
        return;
      }
```

Logo APÓS o bloco

```js
      if (base && base.scalars === localScalarsHash(bed)) {
        applyPatientScalars(bed, p, remoteNote);
      }
```

adicione:

```js
      // person_id só nasce pelo botão Reinternar e nunca é editado à mão: se o banco
      // tem e o aparelho não, adota sempre (senão o push apagaria o vínculo com null).
      if (!bed.personId && p.person_id) bed.personId = p.person_id;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Esperado: 144 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/readmission.test.cjs
git commit -m "feat(sync): mescla adota person_id do banco e registra personId em cloudArchived

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `buildReadmission` (função pura)

**Files:**
- Modify: `painel-core.js` — nova função após `migrateBed`; export no objeto final
- Modify: `tests/readmission.test.cjs`

**Interfaces:**
- Consumes: `migrateBed`, `uuid`.
- Produces: `buildReadmission(previousBed, bedNumber, todayStr) -> { newBed, previousPatch: { personId } }`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao final de `tests/readmission.test.cjs`:

```js
// ---- Task 4: buildReadmission ----------------------------------------------

test('buildReadmission: copia identidade, HPP, exames, trackers e só problemas crônicos', () => {
  const prev = altaBed();
  const { newBed, previousPatch } = PainelCore.buildReadmission(prev, '2004-B', '2026-09-10');
  assert.ok(newBed.patientId && newBed.patientId !== prev.patientId);
  assert.strictEqual(previousPatch.personId, 'p-old', 'anterior sem personId ganha o próprio id');
  assert.strictEqual(newBed.personId, 'p-old');
  assert.strictEqual(newBed.bedNumber, '2004-B');
  assert.strictEqual(newBed.patientName, 'Mariana Silva Dias');
  assert.strictEqual(newBed.age, 32);
  assert.strictEqual(newBed.hpp, 'HAS, DM2');
  assert.strictEqual(newBed.admitDate, '2026-09-10');
  assert.deepStrictEqual(newBed.problems.map(p => [p.descricao, p.status, p.plano, p.ordem]), [['DRC 3b', 'cronico', 'Nefro ambulatorial', 0]]);
  assert.notStrictEqual(newBed.problems[0].id, 'pr2', 'id novo');
  assert.strictEqual(newBed.exams.length, 2);
  assert.ok(newBed.exams.every(e => e.id !== 'l1' && e.id !== 'i1'), 'exames com ids novos');
  assert.deepStrictEqual(newBed.exams[0].results, [{ name: 'Hb', value: '9.5' }]);
  assert.strictEqual(newBed.trackers.length, 5);
  assert.ok(newBed.trackers.every(t => !['a1', 'a2', 'c1', 'd1', 'd2'].includes(t.id)), 'trackers com ids novos');
});

test('buildReadmission: fecha ATB e dispositivos abertos com a data da alta anterior; cultura intacta', () => {
  const { newBed } = PainelCore.buildReadmission(altaBed(), '2004-B', '2026-09-10');
  const byName = Object.fromEntries(newBed.trackers.map(t => [t.name, t]));
  assert.strictEqual(byName['Ceftriaxona'].endDate, '2026-06-12');
  assert.strictEqual(byName['Azitromicina'].endDate, '2026-06-11', 'já fechado não muda');
  assert.strictEqual(byName['CVC'].removalDate, '2026-06-12');
  assert.strictEqual(byName['Colecistectomia'].removalDate, '2026-06-12');
  assert.strictEqual(byName['Colecistectomia'].kind, 'procedimento');
  assert.strictEqual(byName['Hemocultura'].result, 'KPC');
  assert.strictEqual(byName['Hemocultura'].removalDate, undefined);
});

test('buildReadmission: sem data de alta anterior, fecha com todayStr', () => {
  const { newBed } = PainelCore.buildReadmission(altaBed({ dischargedAt: '', archiveReason: 'arquivado' }), '2004-B', '2026-09-10');
  assert.strictEqual(newBed.trackers.find(t => t.name === 'CVC').removalDate, '2026-09-10');
});

test('buildReadmission: zera o que é da internação (HDA, condutas, notas, textos, docs, flags)', () => {
  const { newBed } = PainelCore.buildReadmission(altaBed(), '2004-B', '2026-09-10');
  assert.strictEqual(newBed.anamneseInicial, '');
  assert.strictEqual(newBed.dischargeForecast, '');
  assert.deepStrictEqual(newBed.condutas, []);
  assert.strictEqual(newBed.notes, '');
  assert.deepStrictEqual(newBed.rawTexts, []);
  assert.deepStrictEqual(newBed.generatedDocs, []);
  assert.strictEqual(newBed.isArchived, false);
  assert.strictEqual(newBed.archiveReason, null);
  assert.strictEqual(newBed.dischargedAt, '');
  assert.strictEqual(newBed.isVisited, false);
  assert.strictEqual(newBed.reminderDate, '');
  assert.deepStrictEqual(newBed.externalDoctor, { active: false, name: '' });
  assert.deepStrictEqual(newBed.checks, { ev: false, p: false, ex: false, tev: false });
  assert.strictEqual(newBed.isAnamneseMinimized, false, 'HDA aberta para preencher');
});

test('buildReadmission: mantém personId existente e não muta o registro anterior', () => {
  const prev = altaBed({ personId: 'per-1' });
  const snapshot = JSON.stringify(prev);
  const { newBed, previousPatch } = PainelCore.buildReadmission(prev, '2004-B', '2026-09-10');
  assert.strictEqual(previousPatch.personId, 'per-1');
  assert.strictEqual(newBed.personId, 'per-1');
  assert.strictEqual(JSON.stringify(prev), snapshot);
  newBed.exams[0].results[0].value = '7'; // cópia profunda
  assert.strictEqual(prev.exams[0].results[0].value, '9.5');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test`
Esperado: os 5 testes novos falham com `PainelCore.buildReadmission is not a function`.

- [ ] **Step 3: Implementar**

Em `painel-core.js`, logo após a função `migrateBed` (antes de `migrateState`), adicione:

```js
  // ---- Reinternação: nova internação da mesma pessoa -------------------------
  // Copia o que é da PESSOA (nome, idade, HPP, exames, trackers, problemas crônicos)
  // e zera o que é da INTERNAÇÃO (HDA, condutas, notas, textos, docs, checks).
  // Trackers abertos são fechados com a data da alta anterior para não nascerem alertando.
  // Não muta previousBed: devolve o patch a aplicar nele (personId).
  function buildReadmission(previousBed, bedNumber, todayStr) {
    const prev = previousBed || {};
    const personId = prev.personId || prev.patientId || uuid();
    const closeDate = prev.dischargedAt || todayStr;
    const problems = (prev.problems || [])
      .filter(function (p) { return p && p.status === 'cronico'; })
      .map(function (p, i) { return { id: uuid(), descricao: p.descricao || '', status: 'cronico', plano: p.plano || '', ordem: i }; });
    const trackers = (prev.trackers || []).filter(Boolean).map(function (t) {
      const c = Object.assign({}, t, { id: uuid() });
      if (c.type === 'atb') { if (!c.endDate) c.endDate = closeDate; }
      else if (c.type !== 'culture') { if (!c.removalDate) c.removalDate = closeDate; }
      return c;
    });
    const exams = (prev.exams || []).filter(Boolean).map(function (e) {
      const c = JSON.parse(JSON.stringify(e));
      c.id = uuid();
      return c;
    });
    const newBed = migrateBed({
      patientId: uuid(), personId: personId, bedNumber: bedNumber || '',
      patientName: prev.patientName || '', age: prev.age, hpp: prev.hpp || '',
      admitDate: todayStr, problems: problems, trackers: trackers, exams: exams,
      isAnamneseMinimized: false,
    });
    return { newBed: newBed, previousPatch: { personId: personId } };
  }
```

No objeto de export ao final do arquivo, após `migrateState: migrateState,` adicione:

```js
    buildReadmission: buildReadmission,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Esperado: 149 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/readmission.test.cjs
git commit -m "feat(core): buildReadmission cria nova internação a partir da anterior

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Agrupamento e ordenação de internações (funções puras)

**Files:**
- Modify: `painel-core.js` — novas funções após `buildReadmission`; exports
- Modify: `tests/readmission.test.cjs`

**Interfaces:**
- Produces:
  - `personAdmissions(beds, personId) -> [{ bed, index }]` mais recente primeiro (`[]` se `personId` falsy).
  - `previousAdmissions(beds, bed) -> [{ bed, index }]` = `personAdmissions` sem o próprio `bed`.
  - `groupArchived(beds, matches?) -> [{ latest, latestIndex, members: [{bed,index}], count, ordinal }]` só arquivados; `matches(bed)` opcional filtra grupos em que algum membro bate.
  - `groupCloudArchived(cloudArchived) -> [{ ids: [], reg, count }]` agrupa o registro `state.cloudArchived` por `personId`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao final de `tests/readmission.test.cjs`:

```js
// ---- Task 5: agrupamento ----------------------------------------------------

function mkBed(over) {
  return PainelCore.migrateBed(Object.assign({ patientName: 'Fulano', problems: [], trackers: [], exams: [] }, over));
}

test('personAdmissions: mais recente primeiro; desempate por alta e depois posição', () => {
  const beds = [
    mkBed({ patientId: 'a', personId: 'P', admitDate: '2026-01-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-01-10' }),
    mkBed({ patientId: 'x', personId: 'Q', admitDate: '2026-05-01' }),
    mkBed({ patientId: 'b', personId: 'P', admitDate: '2026-03-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-03-05' }),
    mkBed({ patientId: 'c', personId: 'P', admitDate: '2026-03-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-03-09' }),
    mkBed({ patientId: 'd', personId: 'P', admitDate: '2026-09-10' }),
  ];
  assert.deepStrictEqual(PainelCore.personAdmissions(beds, 'P').map(x => x.bed.patientId), ['d', 'c', 'b', 'a']);
  assert.deepStrictEqual(PainelCore.personAdmissions(beds, 'P').map(x => x.index), [4, 3, 2, 0]);
  assert.deepStrictEqual(PainelCore.personAdmissions(beds, null), []);
  assert.deepStrictEqual(PainelCore.previousAdmissions(beds, beds[4]).map(x => x.bed.patientId), ['c', 'b', 'a']);
  assert.deepStrictEqual(PainelCore.previousAdmissions(beds, beds[1]), []);
});

test('groupArchived: uma linha por pessoa (mais recente arquivada), sem personId individual, ordinal correto', () => {
  const beds = [
    mkBed({ patientId: 'a', personId: 'P', admitDate: '2026-01-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-01-10' }),
    mkBed({ patientId: 's', admitDate: '2026-02-01', isArchived: true, archiveReason: 'arquivado' }),
    mkBed({ patientId: 'b', personId: 'P', admitDate: '2026-03-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-03-09' }),
    mkBed({ patientId: 'd', personId: 'P', admitDate: '2026-09-10' }), // internado agora: não entra em Arquivados
    mkBed({ patientId: 't', admitDate: '2026-04-01' }),
  ];
  const g = PainelCore.groupArchived(beds);
  assert.strictEqual(g.length, 2);
  assert.strictEqual(g[0].latest.patientId, 'b');
  assert.strictEqual(g[0].latestIndex, 2);
  assert.strictEqual(g[0].count, 2, 'só as arquivadas');
  assert.strictEqual(g[0].ordinal, 2, 'b é a 2ª internação da pessoa (d é a 3ª, ativa)');
  assert.deepStrictEqual(g[0].members.map(m => m.bed.patientId), ['b', 'a']);
  assert.strictEqual(g[1].latest.patientId, 's');
  assert.strictEqual(g[1].count, 1);
  assert.strictEqual(g[1].ordinal, 1);
});

test('groupArchived: filtro bate em qualquer internação do grupo', () => {
  const beds = [
    mkBed({ patientId: 'a', personId: 'P', bedNumber: '1001', admitDate: '2026-01-01', isArchived: true, archiveReason: 'alta' }),
    mkBed({ patientId: 'b', personId: 'P', bedNumber: '2002', admitDate: '2026-03-01', isArchived: true, archiveReason: 'alta' }),
    mkBed({ patientId: 's', bedNumber: '3003', admitDate: '2026-02-01', isArchived: true, archiveReason: 'arquivado' }),
  ];
  const g = PainelCore.groupArchived(beds, b => (b.bedNumber || '').includes('1001'));
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].latest.patientId, 'b');
  assert.strictEqual(PainelCore.groupArchived(beds, () => false).length, 0);
});

test('groupCloudArchived: agrupa por personId e prefere o registro com nome', () => {
  const g = PainelCore.groupCloudArchived({
    'c1': { nome: '', iniciais: 'MSD', leito: '1001', personId: 'P' },
    'c2': { nome: 'Mariana Silva Dias', iniciais: 'MSD', leito: '2002', personId: 'P' },
    'c3': { nome: 'Outro', iniciais: 'O', leito: '3003' },
  });
  assert.strictEqual(g.length, 2);
  assert.deepStrictEqual(g[0].ids, ['c1', 'c2']);
  assert.strictEqual(g[0].reg.nome, 'Mariana Silva Dias');
  assert.strictEqual(g[0].count, 2);
  assert.deepStrictEqual(g[1], { ids: ['c3'], reg: { nome: 'Outro', iniciais: 'O', leito: '3003' }, count: 1 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test`
Esperado: 4 testes novos falham com `is not a function`.

- [ ] **Step 3: Implementar**

Em `painel-core.js`, após `buildReadmission`, adicione:

```js
  // ---- Internações da mesma pessoa -------------------------------------------
  // Ordem cronológica: admitDate, depois dischargedAt, depois posição em state.beds.
  function compareAdmissions(a, b) {
    const c1 = String(a.bed.admitDate || '').localeCompare(String(b.bed.admitDate || ''));
    if (c1) return c1;
    const c2 = String(a.bed.dischargedAt || '').localeCompare(String(b.bed.dischargedAt || ''));
    if (c2) return c2;
    return a.index - b.index;
  }

  // Todas as internações (leitos) de uma pessoa, mais recente primeiro.
  function personAdmissions(beds, personId) {
    if (!personId) return [];
    return (beds || []).map(function (bed, index) { return { bed: bed, index: index }; })
      .filter(function (x) { return x.bed && x.bed.personId === personId; })
      .sort(compareAdmissions).reverse();
  }

  function previousAdmissions(beds, bed) {
    return personAdmissions(beds, bed && bed.personId).filter(function (x) { return x.bed !== bed; });
  }

  // Lista Arquivados agrupada: uma entrada por pessoa (a arquivada mais recente),
  // registros sem personId ficam individuais. matches(bed) opcional: mantém o grupo
  // se qualquer internação dele bater (busca por nome/leito antigo).
  function groupArchived(beds, matches) {
    const seen = {};
    const out = [];
    (beds || []).forEach(function (bed, index) {
      if (!bed || !bed.isArchived) return;
      if (!bed.personId) {
        out.push({ latest: bed, latestIndex: index, members: [{ bed: bed, index: index }], count: 1, ordinal: 1 });
        return;
      }
      if (seen[bed.personId]) return;
      seen[bed.personId] = true;
      const all = personAdmissions(beds, bed.personId);
      const members = all.filter(function (x) { return x.bed.isArchived; });
      const latest = members[0];
      const ordinal = all.length - all.indexOf(latest); // posição cronológica (1 = primeira internação)
      out.push({ latest: latest.bed, latestIndex: latest.index, members: members, count: members.length, ordinal: ordinal });
    });
    return matches ? out.filter(function (g) { return g.members.some(function (m) { return matches(m.bed); }); }) : out;
  }

  // Registro "Na nuvem" (state.cloudArchived) agrupado por personId.
  function groupCloudArchived(cloudArchived) {
    const byKey = {};
    const out = [];
    Object.keys(cloudArchived || {}).forEach(function (id) {
      const reg = cloudArchived[id];
      const key = (reg && reg.personId) ? 'person:' + reg.personId : 'id:' + id;
      if (!byKey[key]) { byKey[key] = { ids: [], reg: reg, count: 0 }; out.push(byKey[key]); }
      const g = byKey[key];
      g.ids.push(id);
      g.count++;
      if (!(g.reg && g.reg.nome) && reg && reg.nome) g.reg = reg;
    });
    return out;
  }
```

No export, após `buildReadmission: buildReadmission,` adicione:

```js
    personAdmissions: personAdmissions,
    previousAdmissions: previousAdmissions,
    groupArchived: groupArchived,
    groupCloudArchived: groupCloudArchived,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Esperado: 153 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/readmission.test.cjs
git commit -m "feat(core): agrupamento e ordenação de internações da mesma pessoa

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: UI — botão Reinternar e modal de destino

**Files:**
- Modify: `index.html` — template `archivedBedTpl` (~linha 510), modal `addBedModal` (~linha 296, inserir novo modal após ele), handler `handleAddNewBed` (~linha 2954, inserir funções após ele), render de Arquivados (~linha 1476, onde `restore-bed-btn` é ligado)

**Interfaces:**
- Consumes: `PainelCore.buildReadmission`, `PainelCore.migrateBed`, `showModal`/`hideModal`, `saveData`, `renderScreenA`, `openPatientDetails`, `todayISO`.
- Produces: `openReadmitModal(prevBed)` (chamada pela Task 8 no card agrupado).

- [ ] **Step 1: Botão no template de arquivado**

Em `archivedBedTpl`, antes do botão `restore-bed-btn`, adicione:

```html
                <button class="readmit-bed-btn text-sm bg-sky-100 text-sky-800 font-medium rounded-lg py-2 px-3 hover:bg-sky-200 transition-all" title="Nova internação da mesma pessoa">Reinternar</button>
```

- [ ] **Step 2: Modal de destino**

Após o `</div>` que fecha `addBedModal` (antes de `<!-- === MODAL DE CONFIRMAÇÃO === -->`), adicione:

```html
  <!-- === MODAL DE REINTERNAR (escolhe o leito de destino) === -->
  <div id="readmitModal" class="hidden fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
      <h3 class="text-lg font-bold text-slate-900">Reinternar</h3>
      <p id="readmitModalWho" class="text-sm text-slate-600 mt-1"></p>
      <p class="text-xs font-semibold text-slate-400 uppercase mt-4 mb-1">Leitos vazios</p>
      <div id="readmitEmptyBeds" class="flex flex-wrap gap-2"></div>
      <p class="text-xs font-semibold text-slate-400 uppercase mt-4 mb-1">Ou um leito novo</p>
      <input id="readmitBedNumberInput" type="text" placeholder="Ex: 1012-A" class="w-full border border-slate-300 rounded-lg px-3 py-3 focus:outline-none focus:ring-2 focus:ring-sky-500">
      <p id="readmitError" class="hidden text-sm text-red-600 mt-2"></p>
      <div class="flex gap-3 mt-5">
        <button id="cancelReadmitBtn" class="w-full bg-slate-100 text-slate-700 font-medium rounded-lg py-3 hover:bg-slate-200 transition-all">Cancelar</button>
        <button id="saveReadmitBtn" class="w-full bg-sky-600 text-white font-medium rounded-lg py-3 hover:bg-sky-700 transition-all">Reinternar</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 3: Lógica do modal**

Após a função `handleAddNewBed`, adicione:

```js
    // --- Reinternar: nova internação da mesma pessoa num leito vazio ou novo ---
    let readmitSource = null;

    function openReadmitModal(prevBed) {
      readmitSource = prevBed;
      document.getElementById('readmitModalWho').textContent = `${prevBed.patientName || '?'} — última internação em ${prevBed.bedNumber || '—'}`;
      const box = document.getElementById('readmitEmptyBeds');
      box.innerHTML = '';
      const empties = state.beds.filter(b => !b.isArchived && !(b.patientName || '').trim());
      if (!empties.length) {
        box.innerHTML = '<span class="text-sm text-slate-400">Nenhum leito vazio.</span>';
      }
      empties.forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'text-sm bg-white border border-slate-300 text-slate-700 font-medium rounded-lg py-2 px-3 hover:bg-sky-50';
        btn.textContent = b.bedNumber || '—';
        btn.addEventListener('click', () => doReadmit(prevBed, b, null));
        box.appendChild(btn);
      });
      const input = document.getElementById('readmitBedNumberInput');
      input.value = '';
      document.getElementById('readmitError').classList.add('hidden');
      showModal('readmitModal');
      if (!empties.length) input.focus();
    }

    function doReadmit(prevBed, targetBed, newNumber) {
      const err = document.getElementById('readmitError');
      if (!targetBed) {
        const v = (newNumber || '').trim();
        if (!v) { err.textContent = 'Escolha um leito vazio ou digite um número.'; err.classList.remove('hidden'); return; }
        const same = state.beds.find(b => !b.isArchived && (b.bedNumber || '').trim().toLowerCase() === v.toLowerCase());
        if (same && (same.patientName || '').trim()) {
          err.textContent = `O leito ${v} já está ocupado por ${same.patientName}.`; err.classList.remove('hidden'); return;
        }
        if (same) targetBed = same; // número de leito vazio existente: usa ele
        newNumber = v;
      }
      const { newBed, previousPatch } = PainelCore.buildReadmission(prevBed, targetBed ? targetBed.bedNumber : newNumber, todayISO());
      prevBed.personId = previousPatch.personId;
      let idx;
      if (targetBed) { idx = state.beds.indexOf(targetBed); state.beds[idx] = newBed; }
      else { state.beds.push(newBed); idx = state.beds.length - 1; }
      saveData(state);
      hideModal('readmitModal');
      readmitSource = null;
      renderScreenA();
      setTimeout(() => openPatientDetails(idx), 100);
    }

    document.getElementById('cancelReadmitBtn').addEventListener('click', () => { hideModal('readmitModal'); readmitSource = null; });
    document.getElementById('saveReadmitBtn').addEventListener('click', () => {
      if (readmitSource) doReadmit(readmitSource, null, document.getElementById('readmitBedNumberInput').value);
    });
    document.getElementById('readmitBedNumberInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && readmitSource) doReadmit(readmitSource, null, e.target.value);
    });
```

- [ ] **Step 4: Ligar o botão no card de Arquivados**

No render de Arquivados, logo antes de `node.querySelector('.restore-bed-btn').addEventListener(...)`, adicione:

```js
            node.querySelector('.readmit-bed-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                openReadmitModal(b);
            });
```

- [ ] **Step 5: Verificação manual**

Abra `index.html` no navegador (duplo clique, `file://`). Crie um leito, nomeie, dê alta. Em Arquivados: toque **Reinternar** → modal lista os leitos vazios; escolha um → abre a tela do paciente novo com nome, HPP e admissão de hoje, HDA vazia e aberta. Volte, confira que o leito vazio virou o paciente e que o arquivado continua em Arquivados. Repita digitando número novo e, num terceiro teste, digitando o número de um leito ocupado (deve mostrar erro em vermelho).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(ui): botão Reinternar em Arquivados com escolha do leito de destino

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: UI — seção "Internações anteriores" e faixa de internação anterior

**Files:**
- Modify: `index.html` — `patientDetailTpl` (~linha 531: faixa no topo do `<article>`; ~linha 596: nova seção antes de `<!-- Seção: Anamnese Inicial -->`), `renderScreenB` (~linha 1555 após criar `art`; ~linha 1671 chamadas de `setupCollapsibleSection`), nova função `renderPrevAdmissionsList` perto de `renderHppList` (~linha 1951)
- Modify: `painel-core.js` — `migrateBed` (flag `isPrevAdmissionsMinimized`)

**Interfaces:**
- Consumes: `PainelCore.previousAdmissions`, `setupCollapsibleSection`, `openPatientDetails`, `formatDate`.

- [ ] **Step 1: Flag de colapso no modelo**

Em `migrateBed`, após `isHppMinimized`/`isAnamneseMinimized` (junto das demais flags `is*Minimized`), adicione:

```js
      isPrevAdmissionsMinimized: b.isPrevAdmissionsMinimized !== undefined ? b.isPrevAdmissionsMinimized : true,
```

Run: `node --test` → continua 153 passando.

- [ ] **Step 2: Faixa e seção no template**

Logo após `<article class="patient-card space-y-4">`, adicione:

```html
      <!-- Faixa: este registro é uma internação anterior de uma pessoa com outras internações -->
      <div class="prev-admission-banner hidden bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium rounded-lg px-3 py-2"></div>
```

Antes de `<!-- Seção: Anamnese Inicial -->`, adicione:

```html
      <!-- Seção: Internações anteriores (só aparece quando há outra internação da mesma pessoa neste aparelho) -->
      <div class="collapsible-section prev-admissions-section hidden bg-white rounded-xl shadow-lg border border-slate-200/50">
        <button class="collapsible-toggle-btn flex justify-between items-center w-full p-4 text-left">
          <span class="text-base font-bold text-slate-900">Internações anteriores <span class="prev-admissions-count text-sm font-medium text-slate-400"></span></span>
          <svg class="toggle-icon w-5 h-5 transition-transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
        </button>
        <div class="collapsible-content p-4 pt-0">
          <div class="prev-admissions-list divide-y divide-slate-100"></div>
        </div>
      </div>
```

- [ ] **Step 3: Render**

Perto de `renderHppList` (antes dela), adicione:

```js
    function formatDateFull(iso) {
      const p = String(iso || '').split('-');
      return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '';
    }

    // Internações anteriores da mesma pessoa (só as que estão neste aparelho).
    function renderPrevAdmissionsList(listEl, bed) {
      listEl.innerHTML = '';
      PainelCore.previousAdmissions(state.beds, bed).forEach(({ bed: p, index }) => {
        const row = document.createElement('button');
        row.className = 'w-full text-left flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-2 hover:bg-slate-50 rounded';
        const left = document.createElement('span');
        left.className = 'text-sm text-slate-800';
        const fim = p.dischargedAt ? formatDateFull(p.dischargedAt) : (p.isArchived ? 'sem alta registrada' : 'internado');
        left.textContent = `${formatDateFull(p.admitDate) || '?'} → ${fim} · leito ${p.bedNumber || '—'}`;
        const right = document.createElement('span');
        right.className = 'text-xs text-slate-500 truncate';
        const dx = (p.problems || []).find(x => x && (x.status || 'ativo') === 'ativo');
        right.textContent = dx ? dx.descricao : '—';
        row.appendChild(left); row.appendChild(right);
        row.addEventListener('click', () => openPatientDetails(index));
        listEl.appendChild(row);
      });
    }
```

Em `renderScreenB`, logo após `const art = node.querySelector('article');`, adicione:

```js
      // Histórico de internações da mesma pessoa
      const prevAdm = PainelCore.previousAdmissions(state.beds, b);
      if (prevAdm.length) {
        art.querySelector('.prev-admissions-section').classList.remove('hidden');
        art.querySelector('.prev-admissions-count').textContent = `(${prevAdm.length})`;
        if (b.isArchived) {
          const banner = art.querySelector('.prev-admission-banner');
          banner.textContent = (b.archiveReason === 'alta' && b.dischargedAt)
            ? `Internação anterior · alta em ${formatDateFull(b.dischargedAt)}`
            : 'Internação anterior (arquivada)';
          banner.classList.remove('hidden');
        }
      }
```

Na lista de `setupCollapsibleSection`, após a linha do `.hpp-list`/`updateHppCount`, adicione:

```js
      if (prevAdm.length) setupCollapsibleSection(art, '.prev-admissions-list', 'isPrevAdmissionsMinimized', b, (el) => renderPrevAdmissionsList(el, b));
```

- [ ] **Step 4: Verificação manual**

No navegador, no paciente reinternado da Task 6: aparece a seção "Internações anteriores (1)" entre HPP e Anamnese; ao expandir, mostra "dd/mm/aaaa → dd/mm/aaaa · leito X" e o problema ativo antigo. Tocar abre o registro antigo com a faixa âmbar "Internação anterior · alta em ..."; nele a seção também lista a internação atual (sem faixa quando você volta para a atual). O botão Voltar retorna à tela anterior. Paciente sem `personId` não mostra seção nem faixa.

- [ ] **Step 5: Commit**

```bash
git add index.html painel-core.js
git commit -m "feat(ui): seção Internações anteriores e faixa de internação anterior

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: UI — Arquivados agrupados, Nuvem/Trazer de volta em grupo

**Files:**
- Modify: `index.html` — render de Arquivados (~linhas 1447–1540), `archiveBedToCloud` (~linha 3385), `restoreBedFromCloud` (~linha 3405)

**Interfaces:**
- Consumes: `PainelCore.groupArchived`, `PainelCore.groupCloudArchived`, `openReadmitModal` (Task 6).
- Produces: `archiveBedsToCloud(beds)` e `restoreBedsFromCloud(ids)` substituem as versões singulares.

- [ ] **Step 1: Substituir a montagem de `bedsToRender` pelo agrupamento**

Troque o bloco

```js
          const bedsToRender = state.beds
            .map((bed, index) => ({ bed, originalIndex: index }))
            .filter(({ bed }) => {
              if (!bed.isArchived) return false; 
              if (!searchTerm) return true;
              const name = (bed.patientName || '').toLowerCase();
              const num = (bed.bedNumber || '').toLowerCase();
              return name.includes(searchTerm) || num.includes(searchTerm);
            });
```

por

```js
          // Uma linha por pessoa (internação arquivada mais recente); busca bate em qualquer internação dela
          const groups = PainelCore.groupArchived(state.beds, searchTerm ? (bed) => {
            const name = (bed.patientName || '').toLowerCase();
            const num = (bed.bedNumber || '').toLowerCase();
            return name.includes(searchTerm) || num.includes(searchTerm);
          } : null);
          const bedsToRender = groups.map(g => ({ bed: g.latest, originalIndex: g.latestIndex, group: g }));
```

e mude `bedsToRender.forEach(({ bed: b, originalIndex: idx }) => {` para `bedsToRender.forEach(({ bed: b, originalIndex: idx, group: g }) => {`.

- [ ] **Step 2: Rótulo de contagem e textos dos botões**

Troque a linha `node.querySelector('.bed-name').textContent = (b.patientName || 'Vazio') + altaInfo;` por:

```js
            const ordinalInfo = g.count > 1 ? ` · ${g.ordinal}ª internação` : '';
            node.querySelector('.bed-name').textContent = (b.patientName || 'Vazio') + altaInfo + ordinalInfo;
```

No handler de `cloud-archive-btn`, substitua o `showConfirm(...)` inteiro por:

```js
                const beds = g.members.map(m => m.bed);
                const msg = beds.length > 1
                  ? `Guardar as ${beds.length} internações de ${b.patientName || b.bedNumber} só na nuvem? Elas saem deste aparelho ` +
                    `(o nome completo fica guardado aqui para quando voltar) e permanecem no banco.`
                  : `Guardar ${b.patientName || b.bedNumber} só na nuvem? O paciente sai deste aparelho ` +
                    `(o nome completo fica guardado aqui para quando voltar) e permanece no banco.`;
                showConfirm(msg, async () => {
                    try { await archiveBedsToCloud(beds); }
                    catch (err) { setSyncStatus('Falha ao guardar na nuvem: ' + err.message, true); }
                  }, 'Guardar só na nuvem', 'bg-indigo-600', 'Guardar');
```

No handler de `delete-bed-btn`, troque a mensagem por:

```js
                const extra = g.count > 1 ? ` As ${g.count - 1} internação(ões) anterior(es) continuam em Arquivados.` : '';
                showConfirm(`Deletar PERMANENTEMENTE o leito ${b.bedNumber}? Todos os dados desta internação serão perdidos.${extra}`, () => {
```

(o corpo do callback continua igual: `markPatientDeleted`, `splice(idx, 1)`, `saveData`, `renderScreenA`).

- [ ] **Step 3: Lista "Na nuvem" agrupada**

Troque o bloco `if (cloudIds.length) { ... }` inteiro por:

```js
          const cloudGroups = PainelCore.groupCloudArchived(state.cloudArchived || {});
          if (cloudGroups.length) {
            const header = document.createElement('p');
            header.className = 'text-xs font-semibold text-slate-400 uppercase mt-4 mb-2 px-1';
            header.textContent = 'Na nuvem (fora deste aparelho)';
            bedsListArea.appendChild(header);
            cloudGroups.forEach(cg => {
              const reg = cg.reg || {};
              const row = document.createElement('div');
              row.className = 'list-card flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-2';
              const label = document.createElement('span');
              label.className = 'text-sm text-slate-600';
              label.textContent = `${reg.leito || '—'} · ${reg.nome || reg.iniciais || '?'}` + (cg.count > 1 ? ` · ${cg.count} internações` : '');
              const btn = document.createElement('button');
              btn.className = 'text-sm font-medium text-indigo-600 hover:underline';
              btn.textContent = 'Trazer de volta';
              btn.addEventListener('click', async () => {
                btn.disabled = true;
                try { await restoreBedsFromCloud(cg.ids); }
                catch (err) { setSyncStatus('Falha ao trazer da nuvem: ' + err.message, true); btn.disabled = false; }
              });
              row.appendChild(label);
              row.appendChild(btn);
              bedsListArea.appendChild(row);
            });
          }
```

e remova a linha `const cloudIds = Object.keys(state.cloudArchived || {});`.

- [ ] **Step 4: Versões em grupo de guardar/trazer da nuvem**

Substitua `archiveBedToCloud` e `restoreBedFromCloud` por:

```js
    // Guardar só na nuvem: sincroniza (garante o banco completo), marca status='nuvem'
    // no banco, remove os leitos do aparelho e guarda o nome completo só localmente.
    // Recebe TODAS as internações da pessoa para o histórico não ficar partido.
    async function archiveBedsToCloud(beds) {
      beds.forEach(bed => { if (!bed.patientId) bed.patientId = PainelCore.uuid(); });
      setSyncStatus('Sincronizando...');
      await doSync();
      const sb = await getSupabaseClient();
      const ids = beds.map(b => b.patientId);
      const r = await sb.from(TABLE_PREFIX + 'patients').update({ status: 'nuvem' }).in('id', ids);
      if (r.error) throw r.error;
      beds.forEach(bed => {
        state.cloudArchived[bed.patientId] = {
          nome: bed.patientName || '',
          iniciais: PainelCore.initialsFromName(bed.patientName),
          leito: bed.bedNumber || '',
          personId: bed.personId || null,
        };
        delete state.syncBase[bed.patientId];
      });
      state.beds = state.beds.filter(b => !ids.includes(b.patientId));
      saveData(state, { fromSync: true });
      flushSave();
      renderScreenA();
      setSyncStatus('Guardado na nuvem ✓');
    }

    async function restoreBedsFromCloud(ids) {
      setSyncStatus('Trazendo da nuvem...');
      const sb = await getSupabaseClient();
      const r = await sb.from(TABLE_PREFIX + 'patients').update({ status: 'arquivado' }).in('id', ids);
      if (r.error) throw r.error;
      await doSync(); // a mescla adota os pacientes e reencaixa os nomes do registro local
      renderScreenA();
      setSyncStatus('Trazido da nuvem ✓');
    }
```

Confirme com `grep -n "archiveBedToCloud\|restoreBedFromCloud" index.html` que não sobrou nenhuma chamada às versões antigas.

- [ ] **Step 5: Verificação manual**

Sem rede (só `file://`): Arquivados mostra uma linha por pessoa com "· 2ª internação" quando houver duas; buscar pelo número do leito da internação antiga acha a pessoa; Restaurar e Reinternar agem na mostrada; Deletar avisa das anteriores. Com rede: Nuvem numa pessoa com 2 internações remove as duas do aparelho e a lista "Na nuvem" mostra uma linha "· 2 internações"; Trazer de volta traz as duas (conferir em Arquivados).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(ui): Arquivados e Na nuvem agrupados por pessoa; nuvem e restauração em grupo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: CSS, instruções da IA e verificação final

**Files:**
- Modify: `styles.css` (regenerado)
- Modify: `docs/ai/claude-ai-project-instructions.md`, `CLAUDE.md` (Fluxo 2)

- [ ] **Step 1: Regenerar o Tailwind**

```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
```

Esperado: `styles.css` muda (classes novas: `bg-amber-50`, `border-amber-200`, `text-amber-800`, `bg-sky-100`, `text-sky-800`, `hover:bg-sky-200`, `hover:bg-sky-50`, `divide-y`, `divide-slate-100`). Abra `index.html` e confira que o botão Reinternar está azul-claro e a faixa âmbar.

- [ ] **Step 2: Instruções da IA**

Em `docs/ai/claude-ai-project-instructions.md`, na linha `BANCO (...)`, troque `painel_patients (status: internado/alta/arquivado)` por:

```
painel_patients (status: internado/alta/arquivado/nuvem; person_id agrupa as internações da mesma pessoa — nulo = internação única; discharge_date = data da alta)
```

E adicione, após o parágrafo "QUANDO EU PEDIR UM DOCUMENTO", o bloco:

```
INTERNAÇÕES ANTERIORES: se painel_patients.person_id do paciente não for nulo, busque as outras internações com
select id, bed_number, admit_date, discharge_date, status from painel_patients where person_id = <person_id> and id <> <id> order by admit_date;
e, ao gerar sumário de alta ou processar texto, cite-as quando relevante ("internação prévia em mês/ano por X", lendo painel_problems daquela internação). NUNCA crie nem altere person_id ou discharge_date: o app gerencia isso.
```

Em `CLAUDE.md`, no "Fluxo 2 — Gerar documento", após o item 2, adicione:

```
   Se `person_id` não for nulo, leia também as outras internações da pessoa (`where person_id = ... and id <> ...`) e cite-as quando relevante. Nunca crie nem altere `person_id`/`discharge_date`.
```

- [ ] **Step 3: Suíte completa e teste manual de ponta a ponta**

```bash
node --test
```
Esperado: 153 testes, 0 falhas.

Roteiro manual em dois navegadores (ex.: Chrome e Edge, ambos logados):
1. Navegador A: paciente internado com ATB aberto, CVC sem retirada, um problema crônico e um ativo. Dar alta. Sincronizar.
2. Navegador A: Reinternar em leito novo. Conferir ATB e CVC fechados com a data da alta, só o crônico copiado, HDA vazia. Preencher HDA. Sincronizar.
3. Navegador B: Sincronizar. Conferir: o paciente novo chegou internado com o nome vindo de A? (Não: o nome não vai ao banco. B mostra as iniciais como nome provisório, comportamento já existente para pacientes criados noutro aparelho.) Conferir que o arquivado antigo em B ganhou `personId` (a seção "Internações anteriores" aparece no paciente novo e a faixa no antigo).
4. Navegador B: editar HPP do paciente novo, sincronizar; navegador A sincronizar e conferir que a edição chegou e o vínculo continua.
5. Navegador A: Arquivados → Nuvem na pessoa (2 internações) → ambas somem; "Na nuvem" mostra "2 internações"; Trazer de volta → ambas voltam em Arquivados agrupadas.

- [ ] **Step 4: Commit**

```bash
git add styles.css docs/ai/claude-ai-project-instructions.md CLAUDE.md
git commit -m "chore: regenera styles.css e documenta person_id para a IA

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
