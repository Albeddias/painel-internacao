# Sincronização com Mescla + Arquivar na Nuvem — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o sync "última fotografia vence" por mescla three-way por linha (local × banco × última foto sincronizada), com botão único **Sincronizar** e função **Guardar só na nuvem** para pacientes arquivados.

**Architecture:** Toda a lógica de mescla é pura e vive em `painel-core.js` (UMD, sem dependências), testada com `node --test`. O `index.html` só orquestra: baixa → `mergeStates` → grava com o push atual (delete+insert por paciente, inalterado) → tira a "foto" (`buildSyncBase`). A marca "só na nuvem" vive no banco (`status='nuvem'`, migration 003); o nome completo do paciente segue existindo apenas no aparelho.

**Tech Stack:** JavaScript puro (script clássico, roda em `file://`), Supabase (supabase-js lazy), `node --test` + `node:assert`.

**Spec:** `docs/superpowers/specs/2026-08-25-sync-mescla-arquivo-nuvem-design.md`

## Global Constraints

- O app funciona 100% offline em `file://` — sem ES modules, sem passo de build, sem dependências novas.
- `painel-core.js` é prefix-agnóstico (chaves lógicas `patients`, `problems`, ...); o prefixo físico `painel_` fica no `index.html` (`TABLE_PREFIX`).
- Privacidade: nenhum nome completo, CPF, telefone ou endereço vai ao banco. `initials` é o máximo. Documentos usam `[NOME]`.
- Testes: `node --test` rodado da raiz, sem argumento de caminho. Sempre rodar após mexer em `painel-core.js`.
- Textos de UI em pt-BR, estilo dos existentes (Tailwind via classes já usadas no arquivo).
- Commits pequenos por task, mensagens em pt-BR estilo `feat:`/`refactor:`/`docs:`, rodapé `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `hash8`, serializadores de linha e `buildSyncBase`

**Files:**
- Modify: `painel-core.js` (novas funções após `initialsFromName`, ~linha 29; novos campos em `migrateState` ~linha 104 e `resetLocalSync` ~linha 133; novos exports no return ~linha 285)
- Test: `tests/syncbase.test.cjs` (novo)

**Interfaces:**
- Consumes: `uuid()`, `migrateBed`/`migrateState` existentes.
- Produces (usado pelas Tasks 3, 4 e 6):
  - `hash8(s: string) -> string` — 8 hex chars, determinístico.
  - `buildSyncBase(state) -> { [patientId]: { rows: { problems|antibiotics|cultures|devices|condutas|raw_texts|examsImage: {id: hash8}, examsLab: {chave: ''} }, scalars: hash8 } }`
  - Internos (não exportados, usados pela Task 4): `localRowSets(bed)` e `pulledRowSets(rows)` retornam `{ problems, antibiotics, cultures, devices, condutas, raw_texts, examsImage, examsLab }`, cada um array de `{ key, hash, ord, row }` com `row` no formato do banco (sem `patient_id`); `localScalarsHash(bed) -> hash8`.
  - `migrateState` passa a garantir `state.syncBase = state.syncBase || {}` e `state.cloudArchived = state.cloudArchived || {}`.
  - `resetLocalSync` limpa `syncBase` (`{}`) e **preserva** `cloudArchived`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/syncbase.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

function makeBed() {
  return PainelCore.migrateBed({
    patientId: 'p1', bedNumber: '1015-B', patientName: 'Ana Braga', age: 60,
    admitDate: '2026-08-20', hpp: 'HAS', anamneseInicial: 'Admitida por PNM.',
    problems: [{ id: 'pr1', descricao: 'PNM', status: 'ativo', plano: 'ATB', ordem: 0 }],
    notes: 'Estável.',
    condutas: [{ id: 'c1', text: 'Manter ATB', done: false }],
    trackers: [{ id: 'a1', type: 'atb', name: 'Ceftriaxona', startDate: '2026-08-20', duration: 7 }],
    exams: [
      { id: 'l1', type: 'lab', date: '2026-08-21', results: [{ name: 'Hb', value: '10' }] },
      { id: 'i1', type: 'image', date: '2026-08-21', name: 'RX Tórax', summary: 'Consolidação' },
    ],
    rawTexts: [{ id: 'r1', tipo: 'evolucao', data: '2026-08-21', texto: 'Texto.' }],
  });
}

test('hash8: determinístico, 8 hex, sensível ao conteúdo', () => {
  assert.strictEqual(PainelCore.hash8('abc'), PainelCore.hash8('abc'));
  assert.match(PainelCore.hash8('abc'), /^[0-9a-f]{8}$/);
  assert.notStrictEqual(PainelCore.hash8('abc'), PainelCore.hash8('abd'));
});

test('buildSyncBase: mapeia linhas por id com hash e labs por chave de conteúdo', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-08-25');
  const base = PainelCore.buildSyncBase(state);
  const b = base['p1'];
  assert.ok(b, 'paciente presente na foto');
  assert.match(b.rows.problems['pr1'], /^[0-9a-f]{8}$/);
  assert.match(b.rows.antibiotics['a1'], /^[0-9a-f]{8}$/);
  assert.match(b.rows.condutas['c1'], /^[0-9a-f]{8}$/);
  assert.match(b.rows.raw_texts['r1'], /^[0-9a-f]{8}$/);
  assert.match(b.rows.examsImage['i1'], /^[0-9a-f]{8}$/);
  assert.strictEqual(b.rows.examsLab['2026-08-21\u0001Hb\u000110'], '');
  assert.match(b.scalars, /^[0-9a-f]{8}$/);
});

test('buildSyncBase: hash de scalars muda quando um campo corrido muda', () => {
  const s1 = PainelCore.migrateState({ beds: [makeBed()] }, '2026-08-25');
  const s2 = PainelCore.migrateState({ beds: [makeBed()] }, '2026-08-25');
  s2.beds[0].hpp = 'HAS / DM2';
  assert.notStrictEqual(PainelCore.buildSyncBase(s1)['p1'].scalars,
                        PainelCore.buildSyncBase(s2)['p1'].scalars);
});

test('buildSyncBase: hash de linha muda quando o conteúdo muda, id não muda', () => {
  const s1 = PainelCore.migrateState({ beds: [makeBed()] }, '2026-08-25');
  const s2 = PainelCore.migrateState({ beds: [makeBed()] }, '2026-08-25');
  s2.beds[0].problems[0].plano = 'ATB D3';
  const b1 = PainelCore.buildSyncBase(s1)['p1'], b2 = PainelCore.buildSyncBase(s2)['p1'];
  assert.notStrictEqual(b1.rows.problems['pr1'], b2.rows.problems['pr1']);
});

test('migrateState: inicializa syncBase e cloudArchived; resetLocalSync limpa foto e preserva nomes', () => {
  const state = PainelCore.migrateState({}, '2026-08-25');
  assert.deepStrictEqual(state.syncBase, {});
  assert.deepStrictEqual(state.cloudArchived, {});
  state.syncBase = { p1: {} };
  state.cloudArchived = { p1: { nome: 'Ana Braga', iniciais: 'AB', leito: '1015-B' } };
  PainelCore.resetLocalSync(state);
  assert.deepStrictEqual(state.syncBase, {});
  assert.deepStrictEqual(state.cloudArchived, { p1: { nome: 'Ana Braga', iniciais: 'AB', leito: '1015-B' } });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test`
Expected: os testes novos FALHAM com `PainelCore.hash8 is not a function` / `buildSyncBase is not a function`; os 44 existentes continuam passando.

- [ ] **Step 3: Implementar em `painel-core.js`**

Após `initialsFromName` (linha ~29), inserir:

```js
  // ---- Sync com mescla: hashing e serialização de linhas -----------------

  // Hash curto e determinístico (djb2-xor). Não-criptográfico: serve só para
  // detectar "mudou desde a última foto sincronizada".
  function hash8(s) {
    s = String(s == null ? '' : s);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return ('0000000' + h.toString(16)).slice(-8);
  }

  const SEP = '\u0001';
  // Junta campos normalizando null/undefined para '' — local e banco hasheiam igual.
  function j() {
    return Array.prototype.slice.call(arguments)
      .map(function (x) { return String(x == null ? '' : x); }).join(SEP);
  }

  // Linhas do leito no formato do banco (sem patient_id), com hash de conteúdo e
  // posição original (ord). A identidade dos labs é a própria chave de conteúdo
  // data|nome|valor: editar um valor = deletar a linha antiga + criar uma nova.
  function localRowSets(bed) {
    const out = { problems: [], antibiotics: [], cultures: [], devices: [], condutas: [], raw_texts: [], examsImage: [], examsLab: [] };
    (bed.problems || []).forEach(function (p, i) {
      const row = { id: p.id, descricao: p.descricao || '', status: p.status || 'ativo', plano: p.plano || '' };
      out.problems.push({ key: row.id, hash: hash8(j(row.descricao, row.status, row.plano)), ord: i, row: row });
    });
    (bed.trackers || []).forEach(function (t, i) {
      if (t.type === 'atb') {
        const row = { id: t.id, nome: t.name || '', start_date: t.startDate || null, duration_days: t.duration || null, end_date: t.endDate || null, indicacao: t.indicacao || '' };
        out.antibiotics.push({ key: row.id, hash: hash8(j(row.nome, row.start_date, row.duration_days, row.end_date, row.indicacao)), ord: i, row: row });
      } else if (t.type === 'culture') {
        const row = { id: t.id, tipo: t.name || '', collection_date: t.collectionDate || null, resultado: t.result || '' };
        out.cultures.push({ key: row.id, hash: hash8(j(row.tipo, row.collection_date, row.resultado)), ord: i, row: row });
      } else {
        const row = { id: t.id, nome: t.name || '', install_date: t.installDate || null, removal_date: t.removalDate || null };
        out.devices.push({ key: row.id, hash: hash8(j(row.nome, row.install_date, row.removal_date)), ord: i, row: row });
      }
    });
    (bed.exams || []).forEach(function (e, i) {
      if (e.type === 'lab') {
        (e.results || []).forEach(function (r) {
          const row = { tipo: 'lab', nome: r.name || '', data: e.date || null, resultado: String(r.value == null ? '' : r.value) };
          out.examsLab.push({ key: j(row.data, row.nome, row.resultado), hash: '', ord: i, row: row });
        });
      } else {
        const row = { id: e.id, tipo: 'imagem', nome: e.name || '', data: e.date || null, resultado: e.summary || '' };
        out.examsImage.push({ key: row.id, hash: hash8(j(row.nome, row.data, row.resultado)), ord: i, row: row });
      }
    });
    (bed.condutas || []).forEach(function (c, i) {
      const row = { id: c.id, texto: c.text || '', done: !!c.done, data: null };
      out.condutas.push({ key: row.id, hash: hash8(j(row.texto, row.done)), ord: i, row: row });
    });
    (bed.rawTexts || []).forEach(function (r, i) {
      const row = { id: r.id, tipo: r.tipo || 'evolucao', data: r.data || null, texto: r.texto || '' };
      out.raw_texts.push({ key: row.id, hash: hash8(j(row.tipo, row.data, row.texto)), ord: i, row: row });
    });
    return out;
  }

  // Mesmos conjuntos, a partir das linhas baixadas do banco de UM paciente.
  // rows = { problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], raw_texts: [] }
  function pulledRowSets(rows) {
    const out = { problems: [], antibiotics: [], cultures: [], devices: [], condutas: [], raw_texts: [], examsImage: [], examsLab: [] };
    (rows.problems || []).forEach(function (r) {
      out.problems.push({ key: r.id, hash: hash8(j(r.descricao, r.status, r.plano)), ord: r.ordem, row: r });
    });
    (rows.antibiotics || []).forEach(function (r) {
      out.antibiotics.push({ key: r.id, hash: hash8(j(r.nome, r.start_date, r.duration_days, r.end_date, r.indicacao)), ord: r.ordem, row: r });
    });
    (rows.cultures || []).forEach(function (r) {
      out.cultures.push({ key: r.id, hash: hash8(j(r.tipo, r.collection_date, r.resultado)), ord: r.ordem, row: r });
    });
    (rows.devices || []).forEach(function (r) {
      out.devices.push({ key: r.id, hash: hash8(j(r.nome, r.install_date, r.removal_date)), ord: r.ordem, row: r });
    });
    (rows.exams || []).forEach(function (r, i) {
      if (r.tipo === 'lab') out.examsLab.push({ key: j(r.data, r.nome, r.resultado), hash: '', ord: i, row: r });
      else out.examsImage.push({ key: r.id, hash: hash8(j(r.nome, r.data, r.resultado)), ord: i, row: r });
    });
    (rows.condutas || []).forEach(function (r, i) {
      out.condutas.push({ key: r.id, hash: hash8(j(r.texto, r.done)), ord: i, row: r });
    });
    (rows.raw_texts || []).forEach(function (r, i) {
      out.raw_texts.push({ key: r.id, hash: hash8(j(r.tipo, r.data, r.texto)), ord: i, row: r });
    });
    return out;
  }

  // Hash dos campos "corridos" do paciente, na mesma normalização do push —
  // assim o hash local bate com o que uma versão intocada teria após o pull.
  function localScalarsHash(bed) {
    const status = bed.isArchived ? (bed.archiveReason === 'alta' ? 'alta' : 'arquivado') : 'internado';
    const age = (bed.age === '' || bed.age == null) ? '' : String(Number(bed.age));
    return hash8(j(bed.bedNumber, age, bed.admitDate, bed.hpp, bed.anamneseInicial, bed.dischargeForecast, status, bed.notes));
  }

  const ROW_TABLES = ['problems', 'antibiotics', 'cultures', 'devices', 'condutas', 'raw_texts', 'examsImage', 'examsLab'];

  // A "foto" da última sincronização: chaves + hashes de tudo que foi gravado.
  function buildSyncBase(state) {
    const base = {};
    (state.beds || []).forEach(function (bed) {
      if (!bed.patientId) return;
      const sets = localRowSets(bed);
      const rows = {};
      ROW_TABLES.forEach(function (t) {
        rows[t] = {};
        sets[t].forEach(function (e) { rows[t][e.key] = e.hash; });
      });
      base[bed.patientId] = { rows: rows, scalars: localScalarsHash(bed) };
    });
    return base;
  }
```

Em `migrateState` (após a linha `s.syncedPatientIds = ...`), acrescentar:

```js
    s.syncBase = s.syncBase || {};
    s.cloudArchived = s.cloudArchived || {};
```

Em `resetLocalSync`, acrescentar antes do `return`:

```js
    s.syncBase = {};   // cloudArchived é preservado: guarda nomes que só existem no aparelho
```

No objeto retornado no fim do arquivo, acrescentar:

```js
    hash8: hash8,
    buildSyncBase: buildSyncBase,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam (44 antigos + 5 novos).

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/syncbase.test.cjs
git commit -m "feat(core): hash8, serializadores de linha e buildSyncBase (foto da sincronização)"
```

---

### Task 2: Refatorar `applyPull` (extrair `applyRowsToBed`/`applyPatientScalars`) e garantir ids estáveis

Sem mudança de comportamento — os testes existentes são a rede. A mescla (Task 4) vai reutilizar essas funções para não duplicar a conversão banco→leito.

**Files:**
- Modify: `painel-core.js` (`migrateBed` ~linhas 82-84; `applyPull` ~linhas 191-283)

**Interfaces:**
- Produces (internos, usados pela Task 4):
  - `applyPatientScalars(bed, p, notesTexto)` — aplica ao leito os campos corridos vindos do banco (`bed_number`, `age`, `admit_date`, `hpp`, `anamnese_inicial`, `discharge_forecast`, `status`→`isArchived`/`archiveReason`) e `bed.notes = notesTexto`.
  - `applyRowsToBed(bed, rows)` — reconstrói os filhos do leito a partir de linhas no formato do banco; `rows = { problems, antibiotics, cultures, devices, exams, condutas, raw_texts, generated_docs }` (arrays). Ordena problemas e trackers por `ordem`, reagrupa labs por data.
- `migrateBed` passa a garantir `id` em trackers, exams e rawTexts (`x.id || uuid()`), pré-requisito de identidade estável para a mescla.

- [ ] **Step 1: Em `migrateBed`, garantir ids**

Substituir as três linhas de `trackers`/`exams`/`rawTexts`:

```js
      trackers: (b.trackers || []).filter(Boolean).map(function (t) { return Object.assign({}, t, { id: t.id || uuid() }); }),
      exams: (b.exams || []).filter(Boolean).map(function (e) { return Object.assign({}, e, { id: e.id || uuid() }); }),
      rawTexts: (b.rawTexts || []).filter(Boolean).map(function (r) { return Object.assign({}, r, { id: r.id || uuid() }); }),
```

- [ ] **Step 2: Extrair as duas funções de `applyPull`**

Inserir antes de `applyPull`:

```js
  function applyPatientScalars(bed, p, notesTexto) {
    bed.bedNumber = p.bed_number || bed.bedNumber;
    bed.age = p.age == null ? '' : p.age;
    bed.admitDate = p.admit_date || '';
    bed.hpp = p.hpp || '';
    bed.anamneseInicial = p.anamnese_inicial || '';
    bed.dischargeForecast = p.discharge_forecast || '';
    bed.isArchived = p.status !== 'internado';
    bed.archiveReason = p.status === 'internado' ? null : p.status;
    bed.notes = notesTexto || '';
  }

  function applyRowsToBed(bed, rows) {
    bed.problems = (rows.problems || []).slice()
      .sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); })
      .map(function (r) { return { id: r.id, descricao: r.descricao || '', status: r.status || 'ativo', plano: r.plano || '', ordem: r.ordem || 0 }; });

    var mergedTrackers = []
      .concat((rows.antibiotics || []).map(function (r) {
        return { ord: r.ordem, t: { id: r.id, type: 'atb', name: r.nome || '', startDate: r.start_date || '', duration: r.duration_days || null, endDate: r.end_date || '', indicacao: r.indicacao || '' } };
      }))
      .concat((rows.cultures || []).map(function (r) {
        return { ord: r.ordem, t: { id: r.id, type: 'culture', name: r.tipo || '', collectionDate: r.collection_date || '', result: r.resultado || '' } };
      }))
      .concat((rows.devices || []).map(function (r) {
        return { ord: r.ordem, t: { id: r.id, type: 'device', name: r.nome || '', installDate: r.install_date || '', removalDate: r.removal_date || '' } };
      }));
    mergedTrackers.forEach(function (m, i) { if (m.ord == null) m.ord = 1000000 + i; });
    mergedTrackers.sort(function (a, b) { return a.ord - b.ord; });
    bed.trackers = mergedTrackers.map(function (m) { return m.t; });

    const labRows = (rows.exams || []).filter(function (r) { return r.tipo === 'lab'; });
    const labByDate = {};
    labRows.forEach(function (r) {
      const d = r.data || '';
      (labByDate[d] = labByDate[d] || []).push({ name: r.nome, value: r.resultado });
    });
    bed.exams = Object.keys(labByDate).sort().map(function (date) {
      return { id: uuid(), type: 'lab', date: date, results: labByDate[date] };
    }).concat((rows.exams || []).filter(function (r) { return r.tipo === 'imagem'; }).map(function (r) {
      return { id: r.id, type: 'image', date: r.data || '', name: r.nome || '', summary: r.resultado || '' };
    }));

    bed.condutas = (rows.condutas || []).map(function (r) { return { id: r.id, text: r.texto || '', done: !!r.done }; });
    bed.rawTexts = (rows.raw_texts || []).map(function (r) { return { id: r.id, tipo: r.tipo, data: r.data || '', texto: r.texto || '' }; });
    bed.generatedDocs = (rows.generated_docs || []).slice()
      .sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); })
      .map(function (r) { return { id: r.id, tipo: r.tipo, conteudo: r.conteudo, createdAt: r.created_at }; });
  }
```

No corpo de `applyPull`, substituir tudo entre `bed.bedNumber = ...` e a atribuição de `bed.generatedDocs` (linhas ~231-277) por:

```js
      applyPatientScalars(bed, p, (notes[p.id] && notes[p.id][0] && notes[p.id][0].texto) || '');
      applyRowsToBed(bed, {
        problems: problems[p.id] || [], antibiotics: atbs[p.id] || [], cultures: cultures[p.id] || [],
        devices: devices[p.id] || [], exams: exams[p.id] || [], condutas: condutas[p.id] || [],
        raw_texts: rawTexts[p.id] || [], generated_docs: docs[p.id] || [],
      });
```

Atenção: `applyPatientScalars` inclui `bed.notes` — a linha antiga `bed.notes = ...` some junto.

- [ ] **Step 3: Rodar os testes (rede de segurança da refatoração)**

Run: `node --test`
Expected: todos passam, nenhum teste novo — comportamento idêntico.

- [ ] **Step 4: Commit**

```bash
git add painel-core.js
git commit -m "refactor(core): extrai applyRowsToBed/applyPatientScalars e garante ids estáveis em migrateBed"
```

---

### Task 3: `mergeRowSets` — a mescla genérica de uma tabela

**Files:**
- Modify: `painel-core.js` (após `buildSyncBase`)
- Test: `tests/merge-rows.test.cjs` (novo)

**Interfaces:**
- Consumes: entradas no formato `{ key, hash, ord, row }` (Task 1).
- Produces (usado pela Task 4): `mergeRowSets(local, remote, base) -> row[]` — `local`/`remote` são arrays de `{key, hash, ord, row}`, `base` é `{key: hash}` ou `null`; retorna as linhas vencedoras (formato do banco) já na ordem final, cada uma com `ordem` numérico definitivo.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/merge-rows.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

function e(key, hash, ord, extra) {
  return { key, hash, ord, row: Object.assign({ id: key, v: hash }, extra || {}) };
}
const ids = rows => rows.map(r => r.id);

test('mergeRowSets: adição dos dois lados vira união', () => {
  const out = PainelCore.mergeRowSets([e('L1', 'h1', 0)], [e('R1', 'h2', 0)], {});
  assert.deepStrictEqual(ids(out).sort(), ['L1', 'R1']);
});

test('mergeRowSets: deleção local (na foto, intocada) some do resultado', () => {
  const out = PainelCore.mergeRowSets([], [e('X', 'h1', 0)], { X: 'h1' });
  assert.deepStrictEqual(ids(out), []);
});

test('mergeRowSets: deleção remota (na foto, intocada) some do resultado', () => {
  const out = PainelCore.mergeRowSets([e('X', 'h1', 0)], [], { X: 'h1' });
  assert.deepStrictEqual(ids(out), []);
});

test('mergeRowSets: edição local vence (linha nos dois lados, local difere da foto)', () => {
  const out = PainelCore.mergeRowSets([e('X', 'h-local', 0)], [e('X', 'h-base', 0)], { X: 'h-base' });
  assert.strictEqual(out[0].v, 'h-local');
});

test('mergeRowSets: edição remota vence quando o local está intocado', () => {
  const out = PainelCore.mergeRowSets([e('X', 'h-base', 0)], [e('X', 'h-remoto', 0)], { X: 'h-base' });
  assert.strictEqual(out[0].v, 'h-remoto');
});

test('mergeRowSets: conflito de edição dos dois lados → local vence', () => {
  const out = PainelCore.mergeRowSets([e('X', 'h-local', 0)], [e('X', 'h-remoto', 0)], { X: 'h-base' });
  assert.strictEqual(out[0].v, 'h-local');
});

test('mergeRowSets: edição vence deleção (dos dois lados)', () => {
  const editLocal = PainelCore.mergeRowSets([e('X', 'h-local', 0)], [], { X: 'h-base' });
  assert.deepStrictEqual(ids(editLocal), ['X']);
  const editRemoto = PainelCore.mergeRowSets([], [e('X', 'h-remoto', 0)], { X: 'h-base' });
  assert.deepStrictEqual(ids(editRemoto), ['X']);
});

test('mergeRowSets: sem foto (base null) → união, nada é deletado', () => {
  const out = PainelCore.mergeRowSets([e('L1', 'h1', 0)], [e('R1', 'h2', 0)], null);
  assert.deepStrictEqual(ids(out).sort(), ['L1', 'R1']);
});

test('mergeRowSets: labs por chave de conteúdo (hash vazio) — deleção remota funciona', () => {
  const out = PainelCore.mergeRowSets([e('2026-08-21\u0001Hb\u000110', '', 0)], [], { '2026-08-21\u0001Hb\u000110': '' });
  assert.deepStrictEqual(out, []);
});

test('mergeRowSets: linhas mantêm ordem local e adotadas entram pela coluna ordem', () => {
  const out = PainelCore.mergeRowSets(
    [e('A', 'h', 0), e('B', 'h', 1)],
    [e('A', 'h', 0), e('B', 'h', 1), e('C', 'h', 1)],
    { A: 'h', B: 'h' });
  assert.deepStrictEqual(ids(out), ['A', 'C', 'B']);
  assert.deepStrictEqual(out.map(r => r.ordem), [0, 1, 2]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test`
Expected: FALHAM com `mergeRowSets is not a function`.

- [ ] **Step 3: Implementar**

Após `buildSyncBase` em `painel-core.js`:

```js
  // Mescla uma tabela de UM paciente. local/remote: [{key, hash, ord, row}];
  // base: {key: hash} da última foto, ou null (sem foto → união, nada deleta).
  // Regras: linha só de um lado e fora da foto = criada → fica; na foto e
  // intocada = deletada no outro lado → some; editada (hash ≠ foto) vence
  // deleção. Linha nos dois lados: local intocado → banco vence; senão local.
  function mergeRowSets(local, remote, base) {
    function inBase(key) { return !!base && Object.prototype.hasOwnProperty.call(base, key); }
    function untouched(entry) { return inBase(entry.key) && entry.hash === base[entry.key]; }
    const remoteByKey = {};
    remote.forEach(function (r) { remoteByKey[r.key] = r; });
    const localKeys = {};
    local.forEach(function (l) { localKeys[l.key] = true; });

    const result = [];
    local.forEach(function (l) {
      const r = remoteByKey[l.key];
      if (r) result.push(untouched(l) ? r.row : l.row);
      else if (!untouched(l)) result.push(l.row);
    });
    remote.forEach(function (r) {
      if (localKeys[r.key] || untouched(r)) return;
      const pos = (r.ord == null) ? result.length : Math.min(r.ord, result.length);
      result.splice(pos, 0, r.row);
    });
    return result.map(function (row, i) { return Object.assign({}, row, { ordem: i }); });
  }
```

Acrescentar `mergeRowSets: mergeRowSets,` aos exports.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/merge-rows.test.cjs
git commit -m "feat(core): mergeRowSets — mescla three-way por linha de uma tabela"
```

---

### Task 4: `mergeStates` — mescla do estado inteiro (inclui status 'nuvem')

**Files:**
- Modify: `painel-core.js` (após `mergeRowSets`; export)
- Test: `tests/merge-states.test.cjs` (novo)

**Interfaces:**
- Consumes: `localRowSets`, `pulledRowSets`, `localScalarsHash`, `mergeRowSets`, `applyRowsToBed`, `applyPatientScalars`, `migrateBed` (Tasks 1-3).
- Produces (usado pela Task 6): `mergeStates(state, pulled) -> state` — muta e retorna o estado mesclado. `pulled` tem o mesmo formato do `applyPull` (`{patients, problems, antibiotics, cultures, devices, exams, condutas, notes, raw_texts, generated_docs}`). Após a chamada: `state.beds` mesclados, `state.syncedPatientIds` atualizado, `state.cloudArchived` atualizado (pacientes `status='nuvem'`), pronto para `buildPushPayload`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/merge-states.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// Estado local A sincronizado, com foto tirada; depois cada lado muda algo.
function syncedFixture() {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed({
      patientId: 'p1015', bedNumber: '1015-A', patientName: 'Ana Braga', age: 60,
      admitDate: '2026-08-20', hpp: 'HAS', problems: [{ id: 'pr1', descricao: 'PNM', status: 'ativo', plano: '', ordem: 0 }],
      exams: [], rawTexts: [], condutas: [], trackers: [], notes: 'Estável.',
    }),
    PainelCore.migrateBed({
      patientId: 'p2001', bedNumber: '2001-B', patientName: 'Bruno Costa', age: 70,
      admitDate: '2026-08-19', hpp: '', problems: [], exams: [], condutas: [], trackers: [],
      rawTexts: [{ id: 'rt-old', tipo: 'evolucao', data: '2026-08-19', texto: 'Antigo.' }], notes: '',
    }),
  ] }, '2026-08-25');
  state.syncedPatientIds = ['p1015', 'p2001'];
  state.syncBase = PainelCore.buildSyncBase(state);
  // O banco espelha o estado sincronizado:
  const pulled = {
    patients: [
      { id: 'p1015', bed_number: '1015-A', initials: 'AB', age: 60, admit_date: '2026-08-20', hpp: 'HAS', anamnese_inicial: '', discharge_forecast: null, status: 'internado' },
      { id: 'p2001', bed_number: '2001-B', initials: 'BC', age: 70, admit_date: '2026-08-19', hpp: '', anamnese_inicial: '', discharge_forecast: null, status: 'internado' },
    ],
    problems: [{ id: 'pr1', patient_id: 'p1015', descricao: 'PNM', status: 'ativo', plano: '', ordem: 0 }],
    antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
    notes: [{ patient_id: 'p1015', texto: 'Estável.' }, { patient_id: 'p2001', texto: '' }],
    raw_texts: [{ id: 'rt-old', patient_id: 'p2001', tipo: 'evolucao', data: '2026-08-19', texto: 'Antigo.' }],
    generated_docs: [],
  };
  return { state, pulled };
}

test('cenário do incidente 1015: exames locais novos + textos novos no banco — nada se perde', () => {
  const { state, pulled } = syncedFixture();
  // Celular insere exames no 1015 (não sincronizados):
  state.beds[0].exams.push({ id: 'lx', type: 'lab', date: '2026-08-25', results: [{ name: 'Hb', value: '9' }] });
  // A IA/outro aparelho colou um texto novo no 2001, direto no banco:
  pulled.raw_texts.push({ id: 'rt-novo', patient_id: 'p2001', tipo: 'evolucao', data: '2026-08-25', texto: 'Novo.' });
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].exams.length, 1, 'exame local do 1015 preservado');
  assert.deepStrictEqual(state.beds[1].rawTexts.map(r => r.id).sort(), ['rt-novo', 'rt-old']);
  const payload = PainelCore.buildPushPayload(state);
  assert.strictEqual(payload.exams.filter(e => e.patient_id === 'p1015').length, 1);
  assert.strictEqual(payload.raw_texts.filter(r => r.patient_id === 'p2001').length, 2, 'push não apagaria o texto novo');
});

test('deleção remota de linha propaga; deleção local sobrevive à mescla', () => {
  const { state, pulled } = syncedFixture();
  pulled.problems = []; // problema pr1 deletado no banco
  state.beds[1].rawTexts = []; // texto rt-old deletado localmente
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].problems.length, 0, 'deleção remota aplicada');
  assert.strictEqual(state.beds[1].rawTexts.length, 0, 'deleção local mantida');
});

test('scalars: HPP editado localmente vence; intocado adota o banco', () => {
  const { state, pulled } = syncedFixture();
  state.beds[0].hpp = 'HAS / DM2';                 // editado aqui
  pulled.patients[0].hpp = 'HAS (banco)';          // editado lá também → local vence
  pulled.patients[1].hpp = 'DPOC (banco)';         // só lá → banco vence
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].hpp, 'HAS / DM2');
  assert.strictEqual(state.beds[1].hpp, 'DPOC (banco)');
});

test('idempotência: mesclar duas vezes com o mesmo pull não muda nada', () => {
  const { state, pulled } = syncedFixture();
  state.beds[0].exams.push({ id: 'lx', type: 'lab', date: '2026-08-25', results: [{ name: 'Hb', value: '9' }] });
  // buildPushPayload gera id novo (uuid) para cada linha de lab a cada chamada —
  // compara-se o payload com os ids de exames neutralizados.
  const snapshot = () => {
    const p = PainelCore.buildPushPayload(state);
    return JSON.stringify(Object.assign({}, p, { exams: p.exams.map(e => Object.assign({}, e, { id: null })) }));
  };
  PainelCore.mergeStates(state, pulled);
  const once = snapshot();
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(snapshot(), once);
});

test('sem foto: união — nada é deletado de lado nenhum', () => {
  const { state, pulled } = syncedFixture();
  state.syncBase = {};
  pulled.problems = []; // sumiu do banco, mas sem foto não dá pra saber se foi deleção
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].problems.length, 1, 'linha local preservada');
});

test('tombstone de paciente continua valendo na mescla', () => {
  const { state, pulled } = syncedFixture();
  PainelCore.markPatientDeleted(state, 'p2001');
  state.beds = state.beds.filter(b => b.patientId !== 'p2001');
  PainelCore.mergeStates(state, pulled);
  assert.ok(!state.beds.find(b => b.patientId === 'p2001'), 'deletado não ressuscita');
  assert.deepStrictEqual(PainelCore.buildPushPayload(state).deletePatientIds, ['p2001']);
});

test('paciente novo no banco é adotado; deletado do banco some do aparelho', () => {
  const { state, pulled } = syncedFixture();
  pulled.patients.push({ id: 'p3', bed_number: '3003-C', initials: 'XY', age: null, admit_date: null, hpp: '', anamnese_inicial: '', discharge_forecast: null, status: 'internado' });
  pulled.patients = pulled.patients.filter(p => p.id !== 'p2001'); // deletado no banco
  PainelCore.mergeStates(state, pulled);
  assert.ok(state.beds.find(b => b.patientId === 'p3'), 'novo adotado');
  assert.ok(!state.beds.find(b => b.patientId === 'p2001'), 'deletado remotamente sai');
});

test("status 'nuvem': leito vira registro local (preserva nome) e não é readotado", () => {
  const { state, pulled } = syncedFixture();
  pulled.patients[1].status = 'nuvem';
  PainelCore.mergeStates(state, pulled);
  assert.ok(!state.beds.find(b => b.patientId === 'p2001'), 'leito removido');
  assert.strictEqual(state.cloudArchived['p2001'].nome, 'Bruno Costa', 'nome completo preservado no aparelho');
  const payload = PainelCore.buildPushPayload(state);
  assert.ok(!payload.patients.find(p => p.id === 'p2001'), 'push não toca paciente na nuvem');
});

test("restauração: status volta a 'arquivado' e a mescla readota com o nome do registro", () => {
  const { state, pulled } = syncedFixture();
  pulled.patients[1].status = 'nuvem';
  PainelCore.mergeStates(state, pulled);           // arquivou na nuvem
  pulled.patients[1].status = 'arquivado';
  PainelCore.mergeStates(state, pulled);           // trouxe de volta
  const bed = state.beds.find(b => b.patientId === 'p2001');
  assert.strictEqual(bed.patientName, 'Bruno Costa');
  assert.strictEqual(bed.isArchived, true);
  assert.ok(!state.cloudArchived['p2001'], 'registro consumido na restauração');
});

test('paciente na nuvem deletado do banco é podado do registro local', () => {
  const { state, pulled } = syncedFixture();
  pulled.patients[1].status = 'nuvem';
  PainelCore.mergeStates(state, pulled);
  pulled.patients = pulled.patients.filter(p => p.id !== 'p2001');
  PainelCore.mergeStates(state, pulled);
  assert.ok(!state.cloudArchived['p2001']);
});

test('privacidade: payload pós-mescla não contém nome completo', () => {
  const { state, pulled } = syncedFixture();
  PainelCore.mergeStates(state, pulled);
  const json = JSON.stringify(PainelCore.buildPushPayload(state));
  assert.ok(!json.includes('Ana Braga') && !json.includes('Bruno Costa'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test`
Expected: FALHAM com `mergeStates is not a function`.

- [ ] **Step 3: Implementar**

Após `mergeRowSets` em `painel-core.js`:

```js
  // Mescla three-way do estado inteiro com o que veio do banco.
  // Muta e retorna state, pronto para buildPushPayload. Ver spec 2026-08-25.
  function mergeStates(state, pulled) {
    function byPatient(rows) {
      const m = {};
      (rows || []).forEach(function (r) { (m[r.patient_id] = m[r.patient_id] || []).push(r); });
      return m;
    }
    const problems = byPatient(pulled.problems), atbs = byPatient(pulled.antibiotics),
      cultures = byPatient(pulled.cultures), devices = byPatient(pulled.devices),
      exams = byPatient(pulled.exams), condutas = byPatient(pulled.condutas),
      notes = byPatient(pulled.notes), rawTexts = byPatient(pulled.raw_texts),
      docs = byPatient(pulled.generated_docs);

    state.syncBase = state.syncBase || {};
    state.cloudArchived = state.cloudArchived || {};

    const deletedPending = {};
    (state.deletedPatientIds || []).forEach(function (id) { deletedPending[id] = true; });
    const pulledIds = {};
    (pulled.patients || []).forEach(function (p) { pulledIds[p.id] = true; });

    // Deleção remota de paciente: mesma regra do applyPull.
    const previouslySynced = {};
    (state.syncedPatientIds || []).forEach(function (id) { previouslySynced[id] = true; });
    state.beds = (state.beds || []).filter(function (b) {
      if (!b.patientId) return true;
      if (!previouslySynced[b.patientId]) return true;
      if (deletedPending[b.patientId]) return true;
      return !!pulledIds[b.patientId];
    });

    (pulled.patients || []).forEach(function (p) {
      if (deletedPending[p.id]) return;
      let bed = (state.beds || []).find(function (b) { return b.patientId === p.id; });

      // Paciente guardado só na nuvem: nunca vira leito; se este aparelho ainda
      // tinha o leito, move-o para o registro local preservando o nome completo.
      if (p.status === 'nuvem') {
        if (bed) {
          state.cloudArchived[p.id] = { nome: bed.patientName || '', iniciais: p.initials || '', leito: p.bed_number || bed.bedNumber || '' };
          state.beds = state.beds.filter(function (b) { return b.patientId !== p.id; });
        } else if (!state.cloudArchived[p.id]) {
          state.cloudArchived[p.id] = { nome: '', iniciais: p.initials || '', leito: p.bed_number || '' };
        }
        return;
      }

      const remoteRows = {
        problems: problems[p.id] || [], antibiotics: atbs[p.id] || [], cultures: cultures[p.id] || [],
        devices: devices[p.id] || [], exams: exams[p.id] || [], condutas: condutas[p.id] || [],
        raw_texts: rawTexts[p.id] || [], generated_docs: docs[p.id] || [],
      };
      const remoteNote = (notes[p.id] && notes[p.id][0] && notes[p.id][0].texto) || '';

      if (!bed) {
        // Novo aqui (criado no banco, ou restaurado da nuvem): adoção integral.
        const reg = state.cloudArchived[p.id];
        bed = migrateBed({ patientName: (reg && reg.nome) || p.initials || '?', bedNumber: p.bed_number || '' });
        bed.patientId = p.id;
        state.beds.push(bed);
        delete state.cloudArchived[p.id];
        applyPatientScalars(bed, p, remoteNote);
        applyRowsToBed(bed, remoteRows);
        return;
      }

      const base = state.syncBase[p.id] || null;
      const local = localRowSets(bed);
      const remote = pulledRowSets(remoteRows);
      function baseRows(t) { return base ? (base.rows[t] || {}) : null; }

      // Scalars antes das linhas: usa o leito ainda intocado para o hash local.
      if (base && base.scalars === localScalarsHash(bed)) {
        applyPatientScalars(bed, p, remoteNote);
      }

      applyRowsToBed(bed, {
        problems: mergeRowSets(local.problems, remote.problems, baseRows('problems')),
        antibiotics: mergeRowSets(local.antibiotics, remote.antibiotics, baseRows('antibiotics')),
        cultures: mergeRowSets(local.cultures, remote.cultures, baseRows('cultures')),
        devices: mergeRowSets(local.devices, remote.devices, baseRows('devices')),
        condutas: mergeRowSets(local.condutas, remote.condutas, baseRows('condutas')),
        raw_texts: mergeRowSets(local.raw_texts, remote.raw_texts, baseRows('raw_texts')),
        exams: mergeRowSets(local.examsLab, remote.examsLab, baseRows('examsLab'))
          .concat(mergeRowSets(local.examsImage, remote.examsImage, baseRows('examsImage'))),
        generated_docs: remoteRows.generated_docs,
      });
    });

    // Registro da nuvem: poda pacientes que sumiram do banco.
    Object.keys(state.cloudArchived).forEach(function (id) {
      if (!pulledIds[id]) delete state.cloudArchived[id];
    });

    state.syncedPatientIds = Object.keys(pulledIds);
    return state;
  }
```

Atenção a um detalhe do `applyPatientScalars` na mescla: quando os scalars locais estão intocados mas o `remoteNote` é adotado, `bed.notes` vem do banco; quando o local venceu, `bed.notes` local fica. É exatamente o comportamento da tabela da spec, porque `notes` faz parte do bloco de scalars.

Acrescentar `mergeStates: mergeStates,` aos exports.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam. Se o teste de idempotência falhar, o suspeito clássico é normalização assimétrica (`null` vs `''`) em algum campo de `localRowSets` × `pulledRowSets` — comparar os hashes dos dois lados para a mesma linha.

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/merge-states.test.cjs
git commit -m "feat(core): mergeStates — mescla three-way do estado com o banco (inclui status nuvem)"
```

---

### Task 5: Migration 003 — status 'nuvem'

**Files:**
- Create: `supabase/migrations/003_painel_status_nuvem.sql`

**Interfaces:**
- Produces: o banco passa a aceitar `painel_patients.status = 'nuvem'` (consumido pelas Tasks 4, 6 e 7).

- [ ] **Step 1: Escrever a migration**

```sql
-- Guardar só na nuvem: paciente sai do aparelho e fica apenas no banco.
-- O app nunca cria leito para status 'nuvem'; restaurar = voltar a 'arquivado'.
alter table public.painel_patients
  drop constraint painel_patients_status_check;
alter table public.painel_patients
  add constraint painel_patients_status_check
  check (status in ('internado','alta','arquivado','nuvem'));
```

- [ ] **Step 2: Aplicar no projeto Supabase**

Aplicar via MCP/SQL editor no projeto **Gestão Médica** (`kuhymtikommkoupynhkj`). Se o nome real do constraint diferir, descobrir com:
`select conname from pg_constraint where conrelid = 'public.painel_patients'::regclass and contype = 'c';`
e ajustar o `drop constraint` na migration para o nome real antes de commitá-la.

- [ ] **Step 3: Verificar**

Rodar no SQL editor: `update painel_patients set status = status where false;` (sanidade) e conferir que um `insert ... status='nuvem'` de teste passa o CHECK (com rollback / delete do registro de teste).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/003_painel_status_nuvem.sql
git commit -m "feat(db): migration 003 — status 'nuvem' em painel_patients"
```

---

### Task 6: `index.html` — botão único Sincronizar

**Files:**
- Modify: `index.html` — cabeçalho (linhas ~144-156: dois botões viram um), funções de sync (linhas ~2931-3055)

**Interfaces:**
- Consumes: `PainelCore.mergeStates`, `PainelCore.buildSyncBase` (Tasks 1 e 4); `buildPushPayload`, `SYNC_CHILD_TABLES`, `TABLE_PREFIX`, `getSupabaseClient`, `saveData`, `flushSave`, `renderScreenA`, `setSyncStatus` existentes.
- Produces (usado pela Task 7): `async function doSync()` — executa pull→merge→push→foto e **lança exceção em falha**; o handler do botão trata erro/status. Botão `id="syncBtn"` substitui `syncPushBtn`/`syncPullBtn` (o dot `syncDirtyDot` continua existindo dentro dele).

- [ ] **Step 1: Substituir os dois botões no HTML (linhas ~145-152)**

```html
            <!-- Botão de Sync (Nuvem): baixa, mescla e envia -->
            <button id="syncBtn" class="relative p-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-all print:hidden" title="Sincronizar com a nuvem">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M5.5 17a4.5 4.5 0 0 1-1.44-8.765 4.5 4.5 0 0 1 8.302-3.046 3.5 3.5 0 0 1 4.504 4.272A4 4 0 0 1 15 17h-3.25v-4.94l1.72 1.72a.75.75 0 1 0 1.06-1.06l-3-3a.75.75 0 0 0-1.06 0l-3 3a.75.75 0 1 0 1.06 1.06l1.72-1.72V17H5.5Z" clip-rule="evenodd" /></svg>
              <span id="syncDirtyDot" class="hidden absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white" title="Alterações locais não sincronizadas"></span>
            </button>
```

(O botão `resetLocalBtn` âmbar fica como está.)

- [ ] **Step 2: Substituir `pushToSupabase`/`pullFromSupabase` (linhas ~2931-3019) por `doSync` + handler**

```js
    // Sincronização completa: baixa tudo, mescla (PainelCore.mergeStates) e grava
    // o resultado com o push de sempre (delete+insert por paciente). Lança em falha.
    async function doSync() {
      const sb = await getSupabaseClient();
      const tables = ['patients', ...SYNC_CHILD_TABLES, 'notes', 'generated_docs'];
      const results = await Promise.all(tables.map(t => sb.from(TABLE_PREFIX + t).select('*')));
      const pulled = {};
      tables.forEach((t, i) => {
        if (results[i].error) throw results[i].error;
        pulled[t] = results[i].data;
      });

      PainelCore.mergeStates(state, pulled);

      const payload = PainelCore.buildPushPayload(state);
      const delIds = payload.deletePatientIds || [];
      let res;
      if (delIds.length) {
        const delResults = await Promise.all([...SYNC_CHILD_TABLES, 'notes', 'generated_docs']
          .map(t => sb.from(TABLE_PREFIX + t).delete().in('patient_id', delIds)));
        for (const r of delResults) { if (r.error) throw r.error; }
        res = await sb.from(TABLE_PREFIX + 'patients').delete().in('id', delIds);
        if (res.error) throw res.error;
      }
      if (payload.patients.length) {
        res = await sb.from(TABLE_PREFIX + 'patients').upsert(payload.patients);
        if (res.error) throw res.error;
        const ids = payload.patients.map(p => p.id);
        // KNOWN: sem transação no cliente — se a conexão cair entre delete e insert,
        // os filhos somem do banco até o próximo sync (estado local é a fonte da verdade).
        await Promise.all([
          ...SYNC_CHILD_TABLES.map(async (t) => {
            let r = await sb.from(TABLE_PREFIX + t).delete().in('patient_id', ids);
            if (r.error) throw r.error;
            if (payload[t].length) {
              r = await sb.from(TABLE_PREFIX + t).insert(payload[t]);
              if (r.error) throw r.error;
            }
          }),
          (async () => {
            const r = await sb.from(TABLE_PREFIX + 'notes').upsert(payload.notes);
            if (r.error) throw r.error;
          })(),
        ]);
      }

      // Gravação confirmada: tira a foto e fecha o bookkeeping.
      state.syncBase = PainelCore.buildSyncBase(state);
      const pushedIds = new Set([...(state.syncedPatientIds || []), ...payload.patients.map(p => p.id)]);
      delIds.forEach(id => pushedIds.delete(id));
      state.syncedPatientIds = [...pushedIds];
      state.deletedPatientIds = [];
      state.lastSyncAt = new Date().toISOString();
      saveData(state, { fromSync: true });
      flushSave();
    }

    async function syncWithSupabase() {
      const btn = document.getElementById('syncBtn');
      if (btn.disabled) return;
      btn.disabled = true;
      setSyncStatus('Sincronizando...');
      try {
        await doSync();
        renderScreenA();
        setSyncStatus('Sincronizado ✓ ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        setSyncStatus('Falha ao sincronizar: ' + e.message, true);
      } finally {
        btn.disabled = false;
      }
    }
```

- [ ] **Step 3: Ajustar listeners e o resetLocalAndPull**

Substituir (linhas ~3054-3055):

```js
    document.getElementById('syncBtn').addEventListener('click', syncWithSupabase);
```

Em `resetLocalAndPull`, após `PainelCore.applyPull(state, pulled);` acrescentar (o estado local agora espelha o banco, então a foto é válida):

```js
        state.syncBase = PainelCore.buildSyncBase(state);
```

- [ ] **Step 4: Procurar referências órfãs**

Grep por `syncPushBtn`, `syncPullBtn`, `pushToSupabase`, `pullFromSupabase` no `index.html` — todas devem ter sumido (checar também a lógica do dot na linha ~1139 e o texto de status nas linhas ~3064-3068, que só usam `syncDirtyDot`/`lastSyncAt` e devem continuar valendo; trocar o texto 'Alterações locais não enviadas' por 'Alterações locais não sincronizadas').

- [ ] **Step 5: Testes + smoke manual**

Run: `node --test` → tudo verde (o core não mudou nesta task).
Manual (abrir `index.html` no navegador): tocar Sincronizar com internet → status "Sincronizado ✓ hh:mm"; criar um leito de teste, sincronizar, conferir no banco (`painel_patients`) que ele chegou; apagar o leito de teste e sincronizar de novo.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(app): botão único Sincronizar — pull + mescla + push com foto de sync"
```

---

### Task 7: `index.html` — Guardar só na nuvem + Trazer de volta

**Files:**
- Modify: `index.html` — template do card arquivado (`archivedBedTpl`) e render dos arquivados (linhas ~1324-1374); novas funções junto ao bloco de sync (~após `syncWithSupabase`)

**Interfaces:**
- Consumes: `doSync()` (Task 6), `state.cloudArchived` (Task 1), `getSupabaseClient`, `TABLE_PREFIX`, `showConfirm`, `saveData`, `renderScreenA`, `PainelCore.buildSyncBase`.
- Produces: ações de UI; nenhum consumidor posterior.

- [ ] **Step 1: Funções de arquivar/restaurar (após `syncWithSupabase`)**

```js
    // Guardar só na nuvem: sincroniza (garante o banco completo), marca status='nuvem'
    // no banco, remove o leito do aparelho e guarda o nome completo só localmente.
    async function archiveBedToCloud(bed) {
      setSyncStatus('Sincronizando...');
      await doSync();
      const sb = await getSupabaseClient();
      const r = await sb.from(TABLE_PREFIX + 'patients').update({ status: 'nuvem' }).eq('id', bed.patientId);
      if (r.error) throw r.error;
      state.cloudArchived[bed.patientId] = {
        nome: bed.patientName || '',
        iniciais: PainelCore.initialsFromName(bed.patientName),
        leito: bed.bedNumber || '',
      };
      state.beds = state.beds.filter(b => b.patientId !== bed.patientId);
      state.syncBase = PainelCore.buildSyncBase(state);
      saveData(state, { fromSync: true });
      flushSave();
      renderScreenA();
      setSyncStatus('Guardado na nuvem ✓');
    }

    async function restoreBedFromCloud(patientId) {
      setSyncStatus('Trazendo da nuvem...');
      const sb = await getSupabaseClient();
      const r = await sb.from(TABLE_PREFIX + 'patients').update({ status: 'arquivado' }).eq('id', patientId);
      if (r.error) throw r.error;
      await doSync(); // a mescla adota o paciente e reencaixa o nome do registro local
      renderScreenA();
      setSyncStatus('Trazido da nuvem ✓');
    }
```

- [ ] **Step 2: Botão no card arquivado**

No template `archivedBedTpl` (procurar `id="archivedBedTpl"`), adicionar ao lado dos botões existentes (`restore-bed-btn`/`delete-bed-btn`), com o mesmo padrão visual deles:

```html
              <button class="cloud-archive-btn p-2 text-indigo-500 hover:bg-indigo-50 rounded-lg" title="Guardar só na nuvem">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M5.5 17a4.5 4.5 0 0 1-1.44-8.765 4.5 4.5 0 0 1 8.302-3.046 3.5 3.5 0 0 1 4.504 4.272A4 4 0 0 1 15 17H5.5Zm5.25-9.25a.75.75 0 0 0-1.5 0v4.59l-1.95-2.1a.75.75 0 1 0-1.1 1.02l3.25 3.5a.75.75 0 0 0 1.1 0l3.25-3.5a.75.75 0 1 0-1.1-1.02l-1.95 2.1V7.75Z" clip-rule="evenodd" /></svg>
              </button>
```

E no loop de render dos arquivados (junto aos listeners existentes, linhas ~1353-1370):

```js
            node.querySelector('.cloud-archive-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                showConfirm(
                  `Guardar ${b.patientName || b.bedNumber} só na nuvem? O paciente sai deste aparelho ` +
                  `(o nome completo fica guardado aqui para quando voltar) e permanece no banco.`,
                  async () => {
                    try { await archiveBedToCloud(b); }
                    catch (err) { setSyncStatus('Falha ao guardar na nuvem: ' + err.message, true); }
                  }, 'Guardar só na nuvem', 'bg-indigo-600', 'Guardar');
            });
```

- [ ] **Step 3: Seção "Na nuvem" na lista de arquivados**

No fim do branch de render dos arquivados (após o `forEach` que monta os cards, linha ~1373), acrescentar:

```js
          const cloudIds = Object.keys(state.cloudArchived || {});
          if (cloudIds.length) {
            const header = document.createElement('p');
            header.className = 'text-xs font-semibold text-slate-400 uppercase mt-4 mb-2 px-1';
            header.textContent = 'Na nuvem (fora deste aparelho)';
            bedsListArea.appendChild(header);
            cloudIds.forEach(pid => {
              const reg = state.cloudArchived[pid];
              const row = document.createElement('div');
              row.className = 'list-card flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-2';
              const label = document.createElement('span');
              label.className = 'text-sm text-slate-600';
              label.textContent = `${reg.leito || '—'} · ${reg.nome || reg.iniciais || '?'}`;
              const btn = document.createElement('button');
              btn.className = 'text-sm font-medium text-indigo-600 hover:underline';
              btn.textContent = 'Trazer de volta';
              btn.addEventListener('click', async () => {
                btn.disabled = true;
                try { await restoreBedFromCloud(pid); }
                catch (err) { setSyncStatus('Falha ao trazer da nuvem: ' + err.message, true); btn.disabled = false; }
              });
              row.appendChild(label);
              row.appendChild(btn);
              bedsListArea.appendChild(row);
            });
          }
```

Atenção: o early-return `if (bedsToRender.length === 0) { ...; return; }` (linha ~1336) precisa passar a mostrar a seção "Na nuvem" também quando não há arquivados locais — trocar o `return` para só pular os cards locais (ex.: renderizar a mensagem "Nenhum leito arquivado." sem `return` quando `cloudIds.length > 0`).

- [ ] **Step 4: Testes + verificação manual completa**

Run: `node --test` → verde.
Manual, com o banco real (paciente de teste, nunca dados reais de paciente):
1. Criar leito de teste "9999-T", arquivar, tocar "Guardar só na nuvem" → some da lista, aparece em "Na nuvem", e no banco `status='nuvem'`.
2. Tocar "Trazer de volta" → reaparece nos arquivados com o nome completo local; banco volta a `status='arquivado'`.
3. Sincronizar num segundo navegador/perfil (simulando outro aparelho) enquanto o paciente está na nuvem → ele não vira leito lá; aparece em "Na nuvem" com iniciais.
4. Deletar o paciente de teste ao final (botão deletar + Sincronizar) e conferir que sumiu do banco.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(app): guardar paciente arquivado só na nuvem e trazer de volta"
```

---

### Task 8: Documentação (CLAUDE.md, memória) e fechamento

**Files:**
- Modify: `CLAUDE.md` (seção "Convenções de sync (não quebre)" e a lista de tabelas — status ganha 'nuvem')
- Modify: `C:\Users\albed\.claude\projects\c--Users-albed-Documents-Projetos-Painel\memory\supabase-backend.md` (se mencionar Enviar/Receber ou os status; ler antes)

**Interfaces:** nenhum código; consolida o contrato para os fluxos de IA.

- [ ] **Step 1: Reescrever a seção de sync do CLAUDE.md**

Substituir a seção "## Convenções de sync (não quebre)" por:

```markdown
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
- `painel_patients.status` inclui `'nuvem'` = paciente guardado só no banco (nenhum aparelho
  tem leito dele). Não mude status para/de `'nuvem'` por conta própria; o app gerencia isso.
```

E na lista de tabelas do topo, atualizar `painel_patients (status: internado/alta/arquivado)` para `painel_patients (status: internado/alta/arquivado/nuvem)`.

- [ ] **Step 2: Atualizar a memória**

Ler `memory/supabase-backend.md` e `memory/project-overview.md`; onde falarem de "Enviar/Receber" ou "última sincronização vence", atualizar para o modelo de mescla + botão único, e registrar o status `'nuvem'`. Atualizar a linha correspondente no `MEMORY.md` apenas se o hook mudar de sentido.

- [ ] **Step 3: Verificação final**

Run: `node --test` → tudo verde.
Grep final por `Enviar`/`Receber` no `index.html` para caçar textos de UI que sobraram (títulos, confirmações, mensagens).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: convenções de sync com mescla e status nuvem"
```
