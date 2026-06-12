# Painel + Supabase + Fluxos de IA — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evoluir o painel HTML offline-first para sincronizar com Supabase, separar anamnese/lista de problemas, receber textos crus do prontuário e exibir documentos gerados por IA — mantendo nome completo do paciente apenas no aparelho.

**Architecture:** App continua um HTML que funciona 100% offline com `localStorage`; um módulo UMD (`painel-core.js`) concentra a lógica pura (migração de estado, payload de push com iniciais, merge de pull, substituição de `[NOME]`) e é testável em Node. Sync manual (Enviar/Receber) contra tabelas normalizadas no Supabase com RLS; regra de conflito "última sincronização vence" por paciente. IA (Claude Code + Project claude.ai) lê/edita o banco e grava documentos em `generated_docs`, que o app exibe e copia com o nome preenchido localmente.

**Tech Stack:** HTML/JS vanilla + Tailwind CDN (existente), `@supabase/supabase-js@2` via CDN (carregada sob demanda), Supabase (Postgres + Auth + RLS) via MCP, `node:test` para os testes do módulo core, GitHub Pages para hospedagem.

**Spec:** `docs/superpowers/specs/2026-06-12-painel-supabase-ia-design.md`

---

## Contexto essencial para o executor

- O app é `PainelV15(1).html` (renomeado para `index.html` na Tarefa 1): ~2400 linhas, tudo inline. Estado global `state` salvo em `localStorage` (chave antiga `wardBookData_v14_tasks`).
- Forma atual de um leito (v14): `{ bedNumber, patientName, age, admitDate, diagnoses:[], hpp, notes, condutas:[{text,done}], trackers:[{id,type:'atb'|'culture'|'device',...}], exams:[{id,type:'lab',date,results:[{name,value}]} | {id,type:'image',date,name,summary}], externalDoctor:{active,name}, checks:{ev,p,ex,tev}, isVisited, reminderDate, dischargeForecast, isArchived, is*Minimized }`.
- Nova forma (v16) acrescenta: `patientId` (uuid), `anamneseInicial`, `problems:[{id,descricao,status,plano,ordem}]` (substitui `diagnoses`), `rawTexts:[{id,tipo,data,texto}]`, `generatedDocs:[{id,tipo,conteudo,createdAt}]`, `archiveReason:'alta'|'arquivado'|null`, `dischargedAt`, `condutas` ganham `id`, flags `isProblemsMinimized` (renomeia `isDxMinimized`), `isAnamneseMinimized`, `isRawTextsMinimized`, `isDocsMinimized`. No estado raiz: `lastSyncAt`.
- **Regra de ouro de privacidade:** `patientName` NUNCA aparece em nenhum payload enviado ao Supabase. O push envia `initials` calculadas. O pull NUNCA sobrescreve `patientName` local.
- ES modules não funcionam em `file://` — por isso `painel-core.js` é UMD (script clássico no navegador, `require` no Node).
- Pré-requisito: Node.js ≥ 18 instalado (`node --version`). Se não houver, instalar antes da Tarefa 2.
- Os números de linha citados referem-se ao arquivo original; após edições eles deslocam — use as âncoras de texto (old_string) indicadas.

---

### Task 1: Preparação do repositório

**Files:**
- Rename: `PainelV15(1).html` → `index.html`
- Create: `.gitignore`

- [ ] **Step 1: Renomear o arquivo via git**

```bash
cd "c:\Users\albed\Documents\Projetos\Painel"
git mv "PainelV15(1).html" index.html
```

- [ ] **Step 2: Criar `.gitignore`**

```gitignore
node_modules/
*.local.json
backup_caderno_visitas_*.json
```

(`backup_caderno_visitas_*.json` é o padrão de nome do export do app — contém dados de pacientes e jamais deve ser commitado.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: renomeia painel para index.html e adiciona .gitignore"
```

---

### Task 2: Harness de testes + PainelCore (iniciais e [NOME])

**Files:**
- Create: `painel-core.js`
- Create: `tests/core.test.cjs`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/core.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

test('initialsFromName: nome completo vira iniciais com pontos', () => {
  assert.strictEqual(PainelCore.initialsFromName('Mariana Silva Dias'), 'M.S.D.');
});

test('initialsFromName: ignora conectivos (de, da, do, das, dos, e)', () => {
  assert.strictEqual(PainelCore.initialsFromName('João de Souza dos Santos'), 'J.S.S.');
});

test('initialsFromName: vazio/nulo vira string vazia', () => {
  assert.strictEqual(PainelCore.initialsFromName(''), '');
  assert.strictEqual(PainelCore.initialsFromName(null), '');
  assert.strictEqual(PainelCore.initialsFromName('   '), '');
});

test('fillPatientName: substitui todas as ocorrências de [NOME]', () => {
  const doc = 'Paciente [NOME], reavaliado. [NOME] recebe alta.';
  assert.strictEqual(
    PainelCore.fillPatientName(doc, 'Carlos Andrade'),
    'Paciente Carlos Andrade, reavaliado. Carlos Andrade recebe alta.'
  );
});

test('fillPatientName: sem nome local, mantém o placeholder', () => {
  assert.strictEqual(PainelCore.fillPatientName('Sr(a). [NOME]', ''), 'Sr(a). [NOME]');
});

test('uuid: gera string no formato uuid', () => {
  assert.match(PainelCore.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "c:\Users\albed\Documents\Projetos\Painel" && node --test tests/`
Expected: FAIL — `Cannot find module '../painel-core.js'`

- [ ] **Step 3: Implementar `painel-core.js` (UMD)**

```js
/* PainelCore — lógica pura do Caderno de Visitas.
 * UMD: script clássico no navegador (window.PainelCore), CommonJS no Node (testes). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.PainelCore = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function uuid() {
    if (typeof globalThis.crypto === 'object' && globalThis.crypto.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    // fallback para ambientes sem crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  const IGNORED_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

  function initialsFromName(name) {
    const words = String(name || '').trim().split(/\s+/)
      .filter(Boolean)
      .filter(function (w) { return !IGNORED_WORDS.has(w.toLowerCase()); });
    if (words.length === 0) return '';
    return words.map(function (w) { return w[0].toUpperCase(); }).join('.') + '.';
  }

  function fillPatientName(text, fullName) {
    const name = String(fullName || '').trim();
    if (!name) return text;
    return String(text || '').split('[NOME]').join(name);
  }

  return {
    uuid: uuid,
    initialsFromName: initialsFromName,
    fillPatientName: fillPatientName,
  };
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/core.test.cjs
git commit -m "feat: módulo PainelCore com iniciais e substituição de [NOME], com testes"
```

---

### Task 3: PainelCore.migrateState (v14 → v16)

**Files:**
- Modify: `painel-core.js`
- Test: `tests/migrate.test.cjs`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/migrate.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

const V14_BED = {
  bedNumber: '1012-A', patientName: 'Mariana Silva Dias', age: 32, admitDate: '2026-06-07',
  diagnoses: ['Pneumonia Comunitária', 'Insuficiência Respiratória'], hpp: 'HAS / DM2',
  notes: 'Evolução estável.', checks: { ev: true, p: true, ex: true, tev: true },
  condutas: [{ text: 'Manter ATB', done: true }],
  externalDoctor: { active: false, name: '' }, isVisited: true, reminderDate: '',
  trackers: [{ id: 'abc', type: 'atb', name: 'Ceftriaxona', startDate: '2026-06-07', duration: 7 }],
  isDxMinimized: false, isTrackerMinimized: true, isNotesMinimized: true, isCondutaMinimized: true,
  isArchived: false, exams: [], dischargeForecast: ''
};

test('migrateState: diagnoses viram problems com status ativo e ordem', () => {
  const s = PainelCore.migrateState({ beds: [V14_BED] }, '2026-06-12');
  const bed = s.beds[0];
  assert.strictEqual(bed.problems.length, 2);
  assert.strictEqual(bed.problems[0].descricao, 'Pneumonia Comunitária');
  assert.strictEqual(bed.problems[0].status, 'ativo');
  assert.strictEqual(bed.problems[0].ordem, 0);
  assert.strictEqual(bed.problems[1].ordem, 1);
  assert.ok(bed.problems[0].id);
});

test('migrateState: leito ocupado ganha patientId; leito vazio não', () => {
  const empty = { ...V14_BED, patientName: '', diagnoses: [] };
  const s = PainelCore.migrateState({ beds: [V14_BED, empty] }, '2026-06-12');
  assert.ok(s.beds[0].patientId);
  assert.strictEqual(s.beds[1].patientId, null);
});

test('migrateState: novos campos com defaults', () => {
  const s = PainelCore.migrateState({ beds: [V14_BED] }, '2026-06-12');
  const bed = s.beds[0];
  assert.strictEqual(bed.anamneseInicial, '');
  assert.deepStrictEqual(bed.rawTexts, []);
  assert.deepStrictEqual(bed.generatedDocs, []);
  assert.strictEqual(bed.archiveReason, null);
  assert.strictEqual(bed.dischargedAt, '');
  assert.strictEqual(bed.isProblemsMinimized, false); // herda isDxMinimized
  assert.strictEqual(bed.isAnamneseMinimized, true);
  assert.strictEqual(bed.isRawTextsMinimized, true);
  assert.strictEqual(bed.isDocsMinimized, true);
  assert.ok(bed.condutas[0].id, 'condutas ganham id');
  assert.strictEqual(s.lastSyncAt, null);
});

test('migrateState: arquivado sem motivo vira archiveReason=arquivado', () => {
  const s = PainelCore.migrateState({ beds: [{ ...V14_BED, isArchived: true }] }, '2026-06-12');
  assert.strictEqual(s.beds[0].archiveReason, 'arquivado');
});

test('migrateState: é idempotente (rodar duas vezes não muda nada além de manter ids)', () => {
  const once = PainelCore.migrateState({ beds: [V14_BED] }, '2026-06-12');
  const twice = PainelCore.migrateState(JSON.parse(JSON.stringify(once)), '2026-06-12');
  assert.deepStrictEqual(twice, once);
});

test('defaultState: tem a forma esperada', () => {
  const s = PainelCore.defaultState('2026-06-12');
  assert.deepStrictEqual(s.beds, []);
  assert.strictEqual(s.lastReset, '2026-06-12');
  assert.strictEqual(s.lastSyncAt, null);
  assert.ok(Array.isArray(s.commonCondutas));
  assert.ok(Array.isArray(s.pinnedExams));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/`
Expected: FAIL — `PainelCore.migrateState is not a function`

- [ ] **Step 3: Implementar `migrateState`, `migrateBed` e `defaultState`**

Em `painel-core.js`, adicionar antes do `return { ... }` final:

```js
  const GLOBAL_NOTES_TEMPLATE = "S: (Subjetivo)\n\nO: (Objetivo)\n- SSVV:\n- Exame:\n- Labs:\n- Imagem:\n\nA: (Avaliação)\n\nP: (Plano)\n";

  function defaultState(todayStr) {
    return {
      beds: [], lastReset: todayStr, lastSyncAt: null,
      commonCondutas: ['Manter ATB', 'Solicitar Labs (Rotina)', 'Aguardar resultado de cultura', 'Monitorar SSVV', 'Dieta livre'],
      commonExtDocs: [],
      notesTemplate: GLOBAL_NOTES_TEMPLATE,
      generalTasks: [],
      generalExams: [],
      pinnedExams: ['Hb', 'Ht', 'Leucócitos', 'Plaquetas', 'Cr', 'Ur', 'Na', 'K', 'PCR', 'Glicemia']
    };
  }

  function migrateBed(b) {
    b = b || {};
    const hasPatient = !!(b.patientName && String(b.patientName).trim());
    return {
      patientId: b.patientId || (hasPatient ? uuid() : null),
      bedNumber: b.bedNumber || '', patientName: b.patientName || '',
      age: b.age === 0 ? 0 : (b.age || ''), admitDate: b.admitDate || '',
      hpp: b.hpp || '', anamneseInicial: b.anamneseInicial || '',
      problems: b.problems || (b.diagnoses || []).map(function (d, i) {
        return { id: uuid(), descricao: d, status: 'ativo', plano: '', ordem: i };
      }),
      notes: b.notes || '',
      condutas: (b.condutas || []).map(function (c) {
        return { id: c.id || uuid(), text: c.text || '', done: !!c.done };
      }),
      trackers: b.trackers || [],
      exams: b.exams || [],
      rawTexts: b.rawTexts || [],
      generatedDocs: b.generatedDocs || [],
      externalDoctor: b.externalDoctor || { active: false, name: '' },
      checks: b.checks || { ev: false, p: false, ex: false, tev: false },
      isVisited: !!b.isVisited, reminderDate: b.reminderDate || '',
      dischargeForecast: b.dischargeForecast || '',
      isArchived: !!b.isArchived,
      archiveReason: b.archiveReason || (b.isArchived ? 'arquivado' : null),
      dischargedAt: b.dischargedAt || '',
      isProblemsMinimized: b.isProblemsMinimized !== undefined ? b.isProblemsMinimized : (b.isDxMinimized !== undefined ? b.isDxMinimized : false),
      isAnamneseMinimized: b.isAnamneseMinimized !== undefined ? b.isAnamneseMinimized : true,
      isTrackerMinimized: b.isTrackerMinimized !== undefined ? b.isTrackerMinimized : true,
      isExamsMinimized: b.isExamsMinimized !== undefined ? b.isExamsMinimized : true,
      isNotesMinimized: b.isNotesMinimized !== undefined ? b.isNotesMinimized : true,
      isCondutaMinimized: b.isCondutaMinimized !== undefined ? b.isCondutaMinimized : true,
      isRawTextsMinimized: b.isRawTextsMinimized !== undefined ? b.isRawTextsMinimized : true,
      isDocsMinimized: b.isDocsMinimized !== undefined ? b.isDocsMinimized : true,
    };
  }

  function migrateState(parsed, todayStr) {
    const def = defaultState(todayStr);
    const s = Object.assign({}, def, parsed || {});
    s.beds = (s.beds || []).map(migrateBed);
    s.lastSyncAt = s.lastSyncAt || null;
    s.generalTasks = s.generalTasks || [];
    s.generalExams = s.generalExams || [];
    s.pinnedExams = s.pinnedExams || def.pinnedExams;
    delete s.notesTemplate_old;
    return s;
  }
```

E no `return` final do módulo, expor as novas funções:

```js
  return {
    uuid: uuid,
    initialsFromName: initialsFromName,
    fillPatientName: fillPatientName,
    defaultState: defaultState,
    migrateBed: migrateBed,
    migrateState: migrateState,
  };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: PASS (12 testes)

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/migrate.test.cjs
git commit -m "feat: migração de estado v14 -> v16 no PainelCore"
```

---

### Task 4: Integrar PainelCore ao index.html (storage v16)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Carregar o módulo antes do script principal**

Em `index.html`, localizar a linha `  <script>` que abre o script principal (logo após o fechamento do último `</template>`, ~linha 582) e inserir ANTES dela:

```html
  <script src="painel-core.js"></script>
```

- [ ] **Step 2: Trocar a chave de storage e o loadData**

Substituir (âncora exata):

```js
    const STORAGE_KEY = 'wardBookData_v14_tasks'; // v11 -> v14 (erro meu)
```

por:

```js
    const STORAGE_KEY = 'wardBookData_v16';
    const OLD_STORAGE_KEY = 'wardBookData_v14_tasks';
```

Substituir a função `loadData()` inteira (da linha `      function loadData() {` até o `}` que precede `    function saveData(s) {`) por:

```js
    function loadData() {
      try {
        let raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          // migração automática a partir da versão antiga (mesmo navegador)
          raw = localStorage.getItem(OLD_STORAGE_KEY);
          if (!raw) return PainelCore.defaultState(todayISO());
        }
        const migrated = PainelCore.migrateState(JSON.parse(raw), todayISO());
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      } catch (e) { return PainelCore.defaultState(todayISO()); }
    }
```

Atenção: `loadData` usa `todayISO()`, que é declarada como `function` mais abaixo no arquivo (hoisting resolve). A constante `globalNotesTemplate` (~linha 587) continua existindo e não deve ser removida — outros trechos a usam.

- [ ] **Step 3: Importação de backup passa pela migração**

No listener de `importDataInput` (~linha 2340), substituir o corpo do `showConfirm` (entre `showConfirm("Isso substituirá TODOS os dados atuais. Continuar?", () => {` e o fechamento `}, "Importar Backup?", 'bg-green-600', 'Importar');`) por:

```js
            const migrated = PainelCore.migrateState(newState, todayISO());
            state = migrated;
            saveData(state);
            renderScreenA();
```

Como `state` é reatribuído, trocar a declaração `let state = loadData();` — verificar que já é `let` (linha 588: `let state = loadData();` — ok, é `let`).

- [ ] **Step 4: Novo leito nasce no formato v16**

Em `handleAddNewBed()` (~linha 2125), substituir a criação do `bedObj` (o objeto literal completo de `const bedObj = {` até `};`) por:

```js
      const bedObj = PainelCore.migrateBed({ bedNumber: v });
```

- [ ] **Step 5: Remover os leitos de demonstração**

Apagar o bloco de seed (da linha `    if (state.beds.length === 0) {` ~2377 até o `    }` antes de `    // Chama a renderização inicial`), inclusive a função `getPastDate` (~2373-2376) que só era usada ali.

- [ ] **Step 6: Verificação manual**

Abrir `index.html` no navegador (duplo clique). Verificar no console (F12): sem erros. Adicionar um leito, preencher nome, recarregar a página — dados persistem. No console: `JSON.parse(localStorage.getItem('wardBookData_v16')).beds[0].patientId` retorna um uuid.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: app usa PainelCore, storage v16 com migração automática"
```

---

### Task 5: UI — Lista de Problemas (substitui Diagnósticos)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Substituir o template da seção**

No template `patientDetailTpl`, substituir o bloco inteiro:

```html
      <!-- Seção: Diagnósticos -->
      <div class="collapsible-section bg-white rounded-xl shadow-lg border border-slate-200/50">
        <button class="collapsible-toggle-btn flex justify-between items-center w-full p-4 text-left">
          <span class="text-base font-bold text-slate-900">Diagnósticos Principais</span>
          <svg class="toggle-icon w-5 h-5 transition-transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
        </button>
        <div class="collapsible-content p-4 pt-0">
          <textarea class="input-dx-inline w-full text-sm p-3 rounded-md border border-slate-300 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 overflow-hidden" placeholder="Um diagnóstico por linha"></textarea>
          <div class="small disp-dxcount text-xs text-slate-500 mt-1"></div>
        </div>
      </div>
```

por:

```html
      <!-- Seção: Lista de Problemas -->
      <div class="collapsible-section bg-white rounded-xl shadow-lg border border-slate-200/50">
        <button class="collapsible-toggle-btn flex justify-between items-center w-full p-4 text-left">
          <span class="text-base font-bold text-slate-900">Lista de Problemas</span>
          <svg class="toggle-icon w-5 h-5 transition-transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
        </button>
        <div class="collapsible-content p-4 pt-0">
          <div class="problem-list space-y-1"></div>
          <div class="flex gap-2 w-full mt-3">
            <input class="new-problem-input text-sm p-3 rounded-md border border-slate-300 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 flex-1" placeholder="Novo problema">
            <button class="add-problem-btn text-sm bg-white border border-slate-300 text-slate-700 font-medium rounded-lg py-3 px-3 hover:bg-slate-50 transition-all print:hidden">Add</button>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Adicionar `renderProblemList`**

Inserir logo antes de `    function renderCondutaList(listElement, bed, bedIdx) {`:

```js
    const PROBLEM_STATUS_NEXT = { ativo: 'resolvido', resolvido: 'cronico', cronico: 'ativo' };
    const PROBLEM_STATUS_STYLE = {
      ativo: 'bg-amber-100 text-amber-800',
      resolvido: 'bg-green-100 text-green-800',
      cronico: 'bg-slate-200 text-slate-700',
    };
    const PROBLEM_STATUS_LABEL = { ativo: 'Ativo', resolvido: 'Resolvido', cronico: 'Crônico' };

    function renderProblemList(listElement, bed, bedIdx) {
      listElement.innerHTML = '';
      if (!bed.problems || bed.problems.length === 0) {
        listElement.innerHTML = `<p class="text-sm text-slate-500 px-1">Nenhum problema adicionado.</p>`;
      }
      (bed.problems || []).forEach((p, pi) => {
        const it = document.createElement('div');
        it.className = 'problem-item group py-1 border-b border-slate-100 last:border-b-0';
        it.innerHTML = `
          <div class="flex gap-2 items-center">
            <button class="problem-status-chip flex-shrink-0 text-xs font-medium rounded-full px-2 py-1 ${PROBLEM_STATUS_STYLE[p.status] || PROBLEM_STATUS_STYLE.ativo}">${PROBLEM_STATUS_LABEL[p.status] || 'Ativo'}</button>
            <input type="text" class="problem-desc flex-1 min-w-0 text-sm p-2 rounded-md border border-transparent focus:border-slate-300 focus:bg-slate-50 ${p.status === 'resolvido' ? 'line-through text-slate-500' : ''}" placeholder="Descreva o problema">
            <button class="remove-problem flex-shrink-0 text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all print:hidden p-1" title="Remover">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.707-9.293a1 1 0 0 0-1.414-1.414L10 8.586 8.707 7.293a1 1 0 0 0-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 1 0 1.414 1.414L10 11.414l1.293 1.293a1 1 0 0 0 1.414-1.414L11.414 10l1.293-1.293Z" clip-rule="evenodd" /></svg>
            </button>
          </div>
          <input type="text" class="problem-plan w-full text-xs p-1.5 pl-12 rounded-md border border-transparent focus:border-slate-300 focus:bg-slate-50 text-slate-600" placeholder="Plano (opcional)...">
        `;
        it.querySelector('.problem-desc').value = p.descricao || '';
        it.querySelector('.problem-plan').value = p.plano || '';
        it.querySelector('.problem-status-chip').addEventListener('click', () => {
          p.status = PROBLEM_STATUS_NEXT[p.status] || 'ativo';
          saveData(state);
          renderScreenB();
        });
        it.querySelector('.problem-desc').addEventListener('input', (e) => { p.descricao = e.target.value; saveData(state); });
        it.querySelector('.problem-plan').addEventListener('input', (e) => { p.plano = e.target.value; saveData(state); });
        it.querySelector('.remove-problem').addEventListener('click', () => {
          bed.problems.splice(pi, 1);
          saveData(state);
          renderScreenB();
        });
        listElement.appendChild(it);
      });

      const section = listElement.closest('.collapsible-section');
      const addBtn = section.querySelector('.add-problem-btn');
      const input = section.querySelector('.new-problem-input');
      if (!addBtn.dataset.bound) {
        addBtn.dataset.bound = '1';
        const addProblem = () => {
          const v = input.value.trim();
          if (!v) return;
          bed.problems.push({ id: PainelCore.uuid(), descricao: v, status: 'ativo', plano: '', ordem: bed.problems.length });
          input.value = '';
          saveData(state);
          renderScreenB();
        };
        addBtn.addEventListener('click', addProblem);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addProblem(); });
      }
    }
```

- [ ] **Step 3: Atualizar `renderScreenB`**

Substituir a linha:

```js
      setupCollapsibleSection(art, '.input-dx-inline', 'isDxMinimized', b, (el) => autoResizeTextarea(el));
```

por:

```js
      setupCollapsibleSection(art, '.problem-list', 'isProblemsMinimized', b, (el) => renderProblemList(el, b, idx));
```

Apagar o bloco de binding do textarea de diagnósticos (da linha `      const dxInput = art.querySelector('.input-dx-inline');` até a linha `      art.querySelector('.disp-dxcount').textContent = b.diagnoses && b.diagnoses.length ? \`${b.diagnoses.length} diagnóstico(s)\` : '';` inclusive).

Apagar também, no fim de `renderScreenB`, a linha:

```js
      if (!b.isDxMinimized) autoResizeTextarea(dxInput);
```

- [ ] **Step 4: Atualizar a busca e a impressão**

Na busca de `renderScreenA`, substituir:

```js
              const dx = (bed.diagnoses || []).join(' ').toLowerCase();
```

por:

```js
              const dx = (bed.problems || []).map(p => p.descricao).join(' ').toLowerCase();
```

No handler de `printBtn`, substituir:

```js
            item.b.isMinimized = false;
            item.b.isDxMinimized = false; item.b.isTrackerMinimized = false; 
            item.b.isNotesMinimized = false; item.b.isCondutaMinimized = false;
```

por:

```js
            item.b.isMinimized = false;
            item.b.isProblemsMinimized = false; item.b.isTrackerMinimized = false;
            item.b.isNotesMinimized = false; item.b.isCondutaMinimized = false;
            item.b.isAnamneseMinimized = false;
```

(E no restore após a impressão, o objeto `originalStates` usa apenas `min/tmin/nmin/cmin` — manter como está; o efeito colateral de expandir problemas/anamnese após imprimir é aceitável.)

- [ ] **Step 5: Verificação manual**

Abrir `index.html`: criar leito, adicionar 2 problemas, tocar no chip de status (alterna Ativo → Resolvido → Crônico, resolvido fica riscado), preencher plano, recarregar página — tudo persiste. Buscar pelo nome de um problema na tela A encontra o leito.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: lista de problemas estruturada substitui diagnósticos"
```

---

### Task 6: UI — Seção Anamnese Inicial

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Inserir a seção no template**

No `patientDetailTpl`, inserir IMEDIATAMENTE ANTES do comentário `      <!-- Seção: Lista de Problemas -->`:

```html
      <!-- Seção: Anamnese Inicial -->
      <div class="collapsible-section bg-white rounded-xl shadow-lg border border-slate-200/50">
        <button class="collapsible-toggle-btn flex justify-between items-center w-full p-4 text-left">
          <span class="text-base font-bold text-slate-900">Anamnese Inicial</span>
          <svg class="toggle-icon w-5 h-5 transition-transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
        </button>
        <div class="collapsible-content p-4 pt-0">
          <textarea class="input-anamnese-inline w-full text-sm p-3 rounded-md border border-slate-300 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 overflow-hidden" placeholder="História da admissão (escrita uma vez)..." rows="3"></textarea>
        </div>
      </div>
```

- [ ] **Step 2: Binding em `renderScreenB`**

Logo após a linha `      setupCollapsibleSection(art, '.problem-list', 'isProblemsMinimized', b, (el) => renderProblemList(el, b, idx));` adicionar:

```js
      setupCollapsibleSection(art, '.input-anamnese-inline', 'isAnamneseMinimized', b, (el) => autoResizeTextarea(el));
```

E após o binding de `notesInput` (bloco `const notesInput = ...`), adicionar:

```js
      const anamneseInput = art.querySelector('.input-anamnese-inline');
      anamneseInput.value = b.anamneseInicial || '';
      anamneseInput.addEventListener('input', (e) => {
        b.anamneseInicial = e.target.value;
        saveData(state);
        autoResizeTextarea(e.target);
      });
```

- [ ] **Step 3: Verificação manual**

Abrir o app, expandir "Anamnese Inicial", escrever texto, recarregar — persiste e a seção volta colapsada.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: seção separada de anamnese inicial"
```

---

### Task 7: UI — Seção Texto do Prontuário (rawTexts)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Inserir a seção no template**

No `patientDetailTpl`, inserir IMEDIATAMENTE ANTES do bloco `      <!-- Seção: Previsão de Alta -->`:

```html
      <!-- Seção: Texto do Prontuário -->
      <div class="collapsible-section bg-white rounded-xl shadow-lg border border-slate-200/50">
        <button class="collapsible-toggle-btn flex justify-between items-center w-full p-4 text-left">
          <span class="text-base font-bold text-slate-900">Texto do Prontuário</span>
          <svg class="toggle-icon w-5 h-5 transition-transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
        </button>
        <div class="collapsible-content p-4 pt-0">
          <div class="rawtext-list space-y-2"></div>
          <div class="mt-3 space-y-2">
            <div class="flex gap-2">
              <select class="new-rawtext-tipo text-sm p-3 rounded-md border border-slate-300 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 flex-1">
                <option value="evolucao">Evolução</option>
                <option value="prescricao">Prescrição</option>
                <option value="admissao">Admissão</option>
              </select>
              <input class="new-rawtext-date text-sm p-2 rounded-md border border-slate-300 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500" type="date">
            </div>
            <textarea class="new-rawtext-textarea w-full text-sm p-3 rounded-md border border-slate-300 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 overflow-hidden" rows="4" placeholder="Cole aqui o texto cru do prontuário..."></textarea>
            <button class="add-rawtext-btn w-full text-sm bg-sky-50 text-sky-700 font-medium rounded-lg py-2 px-4 hover:bg-sky-100 transition-all print:hidden">Salvar texto</button>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Adicionar `renderRawTextList`**

Inserir logo após a função `renderProblemList` (criada na Tarefa 5):

```js
    const RAWTEXT_LABEL = { evolucao: 'Evolução', prescricao: 'Prescrição', admissao: 'Admissão' };

    function renderRawTextList(listElement, bed, bedIdx) {
      listElement.innerHTML = '';
      if (!bed.rawTexts || bed.rawTexts.length === 0) {
        listElement.innerHTML = `<p class="text-sm text-slate-500 px-1">Nenhum texto salvo. Cole abaixo o texto do prontuário — a IA usa esses textos para preencher a base e gerar documentos.</p>`;
      }
      (bed.rawTexts || []).slice().sort((a, b) => (b.data || '').localeCompare(a.data || '')).forEach((r) => {
        const det = document.createElement('details');
        det.className = 'group text-sm p-2 rounded-md bg-slate-50 border border-slate-200';
        const summary = document.createElement('summary');
        summary.className = 'cursor-pointer flex justify-between items-center gap-2';
        summary.innerHTML = `
          <span class="font-medium text-slate-700">${RAWTEXT_LABEL[r.tipo] || r.tipo} <span class="text-xs text-slate-500 font-normal">${formatDate(r.data)} · ${(r.texto || '').length} caracteres</span></span>
          <button class="remove-rawtext text-slate-400 hover:text-red-600 p-1 print:hidden" title="Remover">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.707-9.293a1 1 0 0 0-1.414-1.414L10 8.586 8.707 7.293a1 1 0 0 0-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 1 0 1.414 1.414L10 11.414l1.293 1.293a1 1 0 0 0 1.414-1.414L11.414 10l1.293-1.293Z" clip-rule="evenodd" /></svg>
          </button>
        `;
        const body = document.createElement('p');
        body.className = 'text-slate-600 whitespace-pre-wrap mt-2 text-xs';
        body.textContent = r.texto || '';
        det.appendChild(summary);
        det.appendChild(body);
        summary.querySelector('.remove-rawtext').addEventListener('click', (e) => {
          e.preventDefault();
          showConfirm('Remover este texto salvo?', () => {
            const i = bed.rawTexts.findIndex(x => x.id === r.id);
            if (i > -1) { bed.rawTexts.splice(i, 1); saveData(state); renderScreenB(); }
          });
        });
        listElement.appendChild(det);
      });

      const section = listElement.closest('.collapsible-section');
      const addBtn = section.querySelector('.add-rawtext-btn');
      if (!addBtn.dataset.bound) {
        addBtn.dataset.bound = '1';
        section.querySelector('.new-rawtext-date').value = todayISO();
        addBtn.addEventListener('click', () => {
          const texto = section.querySelector('.new-rawtext-textarea').value.trim();
          if (!texto) return;
          bed.rawTexts = bed.rawTexts || [];
          bed.rawTexts.push({
            id: PainelCore.uuid(),
            tipo: section.querySelector('.new-rawtext-tipo').value,
            data: section.querySelector('.new-rawtext-date').value || todayISO(),
            texto: texto,
          });
          saveData(state);
          renderScreenB();
        });
      }
    }
```

- [ ] **Step 3: Binding em `renderScreenB`**

Após a linha do `setupCollapsibleSection` das condutas (`'.conduta-list'`), adicionar:

```js
      setupCollapsibleSection(art, '.rawtext-list', 'isRawTextsMinimized', b, (el) => renderRawTextList(el, b, idx));
```

- [ ] **Step 4: Verificação manual**

Colar um texto de teste, salvar, recarregar — persiste; expandir o `<details>` mostra o texto completo; remover funciona.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: seção de textos crus do prontuário por paciente"
```

---

### Task 8: "Dar Alta" preserva o registro

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Substituir o handler de alta**

Em `renderScreenB`, substituir o bloco inteiro do listener `.discharge-card` (de `      art.querySelector('.discharge-card').addEventListener('click', () => {` até o `      });` correspondente, ~linhas 1251-1266) por:

```js
      art.querySelector('.discharge-card').addEventListener('click', () => {
        showConfirm(`Dar alta no paciente do leito ${b.bedNumber}? O registro completo será guardado em Arquivados e o leito ficará livre.`, () => {
          const snapshot = JSON.parse(JSON.stringify(b));
          snapshot.isArchived = true;
          snapshot.archiveReason = 'alta';
          snapshot.dischargedAt = todayISO();
          state.beds.push(snapshot);
          Object.assign(b, PainelCore.migrateBed({ bedNumber: b.bedNumber }));
          saveData(state);
          closePatientDetails();
        }, "Dar Alta", 'bg-amber-600', 'Dar Alta');
      });
```

(O snapshot mantém o `patientId` — o registro no banco vira `status='alta'` no próximo push. O leito original é zerado com `patientId: null`.)

- [ ] **Step 2: Handler de arquivar marca o motivo**

No listener `.archive-bed-btn`, substituir o corpo do callback de confirmação:

```js
          b.isArchived = true;
          saveData(state);
          closePatientDetails();
```

por:

```js
          b.isArchived = true;
          b.archiveReason = 'arquivado';
          saveData(state);
          closePatientDetails();
```

- [ ] **Step 3: Lista de arquivados mostra alta e restaura limpando flags**

Na renderização de arquivados em `renderScreenA`, substituir:

```js
            node.querySelector('.bed-id').textContent = b.bedNumber || '—';
            node.querySelector('.bed-name').textContent = b.patientName || 'Vazio';
            
            node.querySelector('.restore-bed-btn').addEventListener('click', () => {
                b.isArchived = false;
                saveData(state);
                renderScreenA(); 
            });
```

por:

```js
            node.querySelector('.bed-id').textContent = b.bedNumber || '—';
            const altaInfo = b.archiveReason === 'alta' && b.dischargedAt ? ` · Alta em ${formatDate(b.dischargedAt)}` : '';
            node.querySelector('.bed-name').textContent = (b.patientName || 'Vazio') + altaInfo;

            node.querySelector('.restore-bed-btn').addEventListener('click', () => {
                b.isArchived = false;
                b.archiveReason = null;
                b.dischargedAt = '';
                saveData(state);
                renderScreenA(); 
            });
```

- [ ] **Step 4: Verificação manual**

Dar alta num paciente de teste: o leito fica vazio na lista principal; em "Ver Arquivados" o paciente aparece com "Alta em DD/MM"; restaurar traz tudo de volta (problemas, anamnese, textos). O leito vazio original continua existindo.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: dar alta preserva registro completo em arquivados"
```

---

### Task 9: Supabase — projeto, schema, RLS e usuário

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`

- [ ] **Step 1: Criar/identificar o projeto Supabase**

Via MCP: `mcp__claude_ai_Supabase__list_projects`. Se o usuário não tiver um projeto para isso, criar com `mcp__claude_ai_Supabase__list_organizations` → `mcp__claude_ai_Supabase__get_cost` (tipo `project`) → `mcp__claude_ai_Supabase__confirm_cost` → `mcp__claude_ai_Supabase__create_project` (nome sugerido: `painel-internacao`, região `sa-east-1`). Plano gratuito.

- [ ] **Step 2: Escrever a migration**

Criar `supabase/migrations/001_initial_schema.sql`:

```sql
-- Schema do Caderno de Visitas (Painel de Internação)
-- Regra de privacidade: a coluna patients.initials guarda APENAS iniciais.
-- O nome completo do paciente nunca chega a este banco.

create extension if not exists moddatetime schema extensions;

create table public.patients (
  id uuid primary key,
  bed_number text not null default '',
  initials text not null default '',
  age int,
  admit_date date,
  hpp text not null default '',
  anamnese_inicial text not null default '',
  discharge_forecast date,
  status text not null default 'internado' check (status in ('internado','alta','arquivado')),
  updated_at timestamptz not null default now()
);

create table public.problems (
  id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  descricao text not null,
  status text not null default 'ativo' check (status in ('ativo','resolvido','cronico')),
  plano text not null default '',
  ordem int not null default 0,
  updated_at timestamptz not null default now()
);

create table public.antibiotics (
  id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  nome text not null,
  start_date date,
  duration_days int,
  end_date date,
  indicacao text not null default '',
  updated_at timestamptz not null default now()
);

create table public.cultures (
  id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  tipo text not null,
  collection_date date,
  resultado text not null default '',
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  nome text not null,
  install_date date,
  removal_date date,
  updated_at timestamptz not null default now()
);

create table public.exams (
  id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  tipo text not null check (tipo in ('lab','imagem')),
  nome text not null,
  data date,
  resultado text not null default '',
  updated_at timestamptz not null default now()
);

create table public.condutas (
  id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  texto text not null default '',
  done boolean not null default false,
  data date,
  updated_at timestamptz not null default now()
);

create table public.notes (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  texto text not null default '',
  updated_at timestamptz not null default now()
);

create table public.raw_texts (
  id uuid primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  tipo text not null check (tipo in ('evolucao','prescricao','admissao')),
  data date,
  texto text not null,
  updated_at timestamptz not null default now()
);

create table public.doc_templates (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  descricao text not null default '',
  template text not null,
  updated_at timestamptz not null default now()
);

create table public.generated_docs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  tipo text not null,
  conteudo text not null,
  created_at timestamptz not null default now()
);

-- updated_at automático
create trigger set_updated_at before update on public.patients for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.problems for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.antibiotics for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.cultures for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.devices for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.exams for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.condutas for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.notes for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.raw_texts for each row execute procedure extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.doc_templates for each row execute procedure extensions.moddatetime(updated_at);

-- RLS: acesso total apenas para usuário autenticado (conta única do médico)
alter table public.patients enable row level security;
alter table public.problems enable row level security;
alter table public.antibiotics enable row level security;
alter table public.cultures enable row level security;
alter table public.devices enable row level security;
alter table public.exams enable row level security;
alter table public.condutas enable row level security;
alter table public.notes enable row level security;
alter table public.raw_texts enable row level security;
alter table public.doc_templates enable row level security;
alter table public.generated_docs enable row level security;

create policy "auth full access" on public.patients for all to authenticated using (true) with check (true);
create policy "auth full access" on public.problems for all to authenticated using (true) with check (true);
create policy "auth full access" on public.antibiotics for all to authenticated using (true) with check (true);
create policy "auth full access" on public.cultures for all to authenticated using (true) with check (true);
create policy "auth full access" on public.devices for all to authenticated using (true) with check (true);
create policy "auth full access" on public.exams for all to authenticated using (true) with check (true);
create policy "auth full access" on public.condutas for all to authenticated using (true) with check (true);
create policy "auth full access" on public.notes for all to authenticated using (true) with check (true);
create policy "auth full access" on public.raw_texts for all to authenticated using (true) with check (true);
create policy "auth full access" on public.doc_templates for all to authenticated using (true) with check (true);
create policy "auth full access" on public.generated_docs for all to authenticated using (true) with check (true);
```

- [ ] **Step 3: Aplicar a migration**

Via MCP: `mcp__claude_ai_Supabase__apply_migration` com `name: "initial_schema"` e o SQL acima. Confirmar com `mcp__claude_ai_Supabase__list_tables` (deve listar as 11 tabelas).

- [ ] **Step 4: Rodar os advisors de segurança**

Via MCP: `mcp__claude_ai_Supabase__get_advisors` (tipo `security`). Corrigir o que apontar (esperado: nada crítico com RLS habilitado em tudo).

- [ ] **Step 5: PAUSA — usuário cria a conta de login**

Pedir ao usuário: no dashboard do Supabase → Authentication → Users → "Add user" → criar usuário com seu e-mail e uma senha forte, marcando "Auto Confirm User". Essa será a credencial de login do app.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/001_initial_schema.sql
git commit -m "feat: schema Supabase com RLS para sync do painel"
```

---

### Task 10: PainelCore — buildPushPayload e applyPull

**Files:**
- Modify: `painel-core.js`
- Test: `tests/sync.test.cjs`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/sync.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

function makeBed() {
  return PainelCore.migrateBed({
    bedNumber: '1012-A', patientName: 'Mariana Silva Dias', age: 32, admitDate: '2026-06-07',
    hpp: 'HAS / DM2', anamneseInicial: 'Admitida com dispneia.',
    diagnoses: ['Pneumonia Comunitária'],
    notes: 'Evolução estável.',
    condutas: [{ text: 'Manter ATB', done: true }],
    trackers: [
      { id: 'a1', type: 'atb', name: 'Ceftriaxona', startDate: '2026-06-07', duration: 7 },
      { id: 'c1', type: 'culture', name: 'Hemocultura', collectionDate: '2026-06-08', result: 'Aguardando' },
      { id: 'd1', type: 'device', name: 'CVC Subclávia D', installDate: '2026-06-07' },
    ],
    exams: [
      { id: 'l1', type: 'lab', date: '2026-06-10', results: [{ name: 'Hb', value: '9.5' }, { name: 'Cr', value: '1.1' }] },
      { id: 'i1', type: 'image', date: '2026-06-09', name: 'TC Tórax', summary: 'Consolidação em base D' },
    ],
    rawTexts: [{ id: 'r1', tipo: 'evolucao', data: '2026-06-11', texto: 'Texto cru.' }],
  });
}

test('buildPushPayload: envia iniciais e nunca o nome completo', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  const payload = PainelCore.buildPushPayload(state);
  assert.strictEqual(payload.patients[0].initials, 'M.S.D.');
  const json = JSON.stringify(payload);
  assert.ok(!json.includes('Mariana'), 'payload não pode conter o nome');
  assert.ok(!json.includes('patientName'), 'payload não pode ter o campo patientName');
});

test('buildPushPayload: leito vazio (sem patientId) não gera linhas', () => {
  const state = PainelCore.migrateState({ beds: [{ bedNumber: '1015-A' }] }, '2026-06-12');
  const payload = PainelCore.buildPushPayload(state);
  assert.strictEqual(payload.patients.length, 0);
});

test('buildPushPayload: divide trackers e explode labs', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  const p = PainelCore.buildPushPayload(state);
  assert.strictEqual(p.antibiotics.length, 1);
  assert.strictEqual(p.antibiotics[0].nome, 'Ceftriaxona');
  assert.strictEqual(p.cultures.length, 1);
  assert.strictEqual(p.devices.length, 1);
  assert.strictEqual(p.exams.filter(e => e.tipo === 'lab').length, 2);
  assert.strictEqual(p.exams.filter(e => e.tipo === 'imagem').length, 1);
  assert.strictEqual(p.notes.length, 1);
  assert.strictEqual(p.raw_texts.length, 1);
  assert.strictEqual(p.problems.length, 1);
});

test('buildPushPayload: status reflete alta/arquivado', () => {
  const alta = makeBed(); alta.isArchived = true; alta.archiveReason = 'alta';
  const arq = makeBed(); arq.isArchived = true; arq.archiveReason = 'arquivado';
  const state = PainelCore.migrateState({ beds: [alta, arq] }, '2026-06-12');
  const p = PainelCore.buildPushPayload(state);
  assert.strictEqual(p.patients[0].status, 'alta');
  assert.strictEqual(p.patients[1].status, 'arquivado');
});

test('applyPull: round-trip preserva dados e NÃO toca no nome local', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  const pid = state.beds[0].patientId;
  const payload = PainelCore.buildPushPayload(state);
  const pulled = { ...payload, generated_docs: [
    { id: 'g1', patient_id: pid, tipo: 'sumario_alta', conteudo: 'Paciente [NOME]...', created_at: '2026-06-12T10:00:00Z' },
  ]};
  // simula edição da IA no banco
  pulled.problems.push({ id: 'p-novo', patient_id: pid, descricao: 'IRA pré-renal', status: 'ativo', plano: 'Hidratação', ordem: 1 });
  PainelCore.applyPull(state, pulled);
  const bed = state.beds[0];
  assert.strictEqual(bed.patientName, 'Mariana Silva Dias', 'nome local intocado');
  assert.strictEqual(bed.problems.length, 2);
  assert.strictEqual(bed.problems[1].descricao, 'IRA pré-renal');
  assert.strictEqual(bed.generatedDocs.length, 1);
  assert.strictEqual(bed.generatedDocs[0].tipo, 'sumario_alta');
  assert.strictEqual(bed.trackers.find(t => t.type === 'atb').name, 'Ceftriaxona');
  const lab = bed.exams.find(e => e.type === 'lab');
  assert.strictEqual(lab.results.length, 2);
  assert.strictEqual(bed.notes, 'Evolução estável.');
  assert.strictEqual(bed.rawTexts.length, 1);
});

test('applyPull: paciente desconhecido vira leito novo com iniciais como nome provisório', () => {
  const state = PainelCore.defaultState('2026-06-12');
  PainelCore.applyPull(state, {
    patients: [{ id: 'novo-1', bed_number: '2001-B', initials: 'J.S.', age: 70, admit_date: '2026-06-11', hpp: '', anamnese_inicial: '', discharge_forecast: null, status: 'internado' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [],
  });
  assert.strictEqual(state.beds.length, 1);
  assert.strictEqual(state.beds[0].patientName, 'J.S.');
  assert.strictEqual(state.beds[0].patientId, 'novo-1');
});

test('applyPull: não deleta leitos locais ausentes do banco', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  PainelCore.applyPull(state, { patients: [], problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [] });
  assert.strictEqual(state.beds.length, 1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/`
Expected: FAIL — `PainelCore.buildPushPayload is not a function`

- [ ] **Step 3: Implementar no `painel-core.js`**

Adicionar antes do `return` final:

```js
  function buildPushPayload(state) {
    const out = { patients: [], problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [] };
    (state.beds || []).forEach(function (b) {
      if (!b.patientId) return;
      const pid = b.patientId;
      out.patients.push({
        id: pid,
        bed_number: b.bedNumber || '',
        initials: initialsFromName(b.patientName),
        age: (b.age === '' || b.age == null) ? null : Number(b.age),
        admit_date: b.admitDate || null,
        hpp: b.hpp || '',
        anamnese_inicial: b.anamneseInicial || '',
        discharge_forecast: b.dischargeForecast || null,
        status: b.isArchived ? (b.archiveReason === 'alta' ? 'alta' : 'arquivado') : 'internado',
      });
      (b.problems || []).forEach(function (p, i) {
        out.problems.push({ id: p.id, patient_id: pid, descricao: p.descricao || '', status: p.status || 'ativo', plano: p.plano || '', ordem: i });
      });
      (b.trackers || []).forEach(function (t) {
        if (t.type === 'atb') {
          out.antibiotics.push({ id: t.id, patient_id: pid, nome: t.name || '', start_date: t.startDate || null, duration_days: t.duration || null, end_date: t.endDate || null, indicacao: t.indicacao || '' });
        } else if (t.type === 'culture') {
          out.cultures.push({ id: t.id, patient_id: pid, tipo: t.name || '', collection_date: t.collectionDate || null, resultado: t.result || '' });
        } else {
          out.devices.push({ id: t.id, patient_id: pid, nome: t.name || '', install_date: t.installDate || null, removal_date: t.removalDate || null });
        }
      });
      (b.exams || []).forEach(function (e) {
        if (e.type === 'lab') {
          (e.results || []).forEach(function (r) {
            out.exams.push({ id: uuid(), patient_id: pid, tipo: 'lab', nome: r.name || '', data: e.date || null, resultado: String(r.value == null ? '' : r.value) });
          });
        } else {
          out.exams.push({ id: e.id || uuid(), patient_id: pid, tipo: 'imagem', nome: e.name || '', data: e.date || null, resultado: e.summary || '' });
        }
      });
      (b.condutas || []).forEach(function (c) {
        out.condutas.push({ id: c.id || uuid(), patient_id: pid, texto: c.text || '', done: !!c.done, data: null });
      });
      out.notes.push({ patient_id: pid, texto: b.notes || '' });
      (b.rawTexts || []).forEach(function (r) {
        out.raw_texts.push({ id: r.id || uuid(), patient_id: pid, tipo: r.tipo || 'evolucao', data: r.data || null, texto: r.texto || '' });
      });
    });
    return out;
  }

  function applyPull(state, pulled) {
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

    (pulled.patients || []).forEach(function (p) {
      let bed = (state.beds || []).find(function (b) { return b.patientId === p.id; });
      if (!bed) {
        // paciente criado direto no banco (raro): cria leito com iniciais como nome provisório
        bed = migrateBed({ patientName: p.initials || '?', bedNumber: p.bed_number || '' });
        bed.patientId = p.id;
        state.beds.push(bed);
      }
      bed.bedNumber = p.bed_number || bed.bedNumber;
      bed.age = p.age == null ? '' : p.age;
      bed.admitDate = p.admit_date || '';
      bed.hpp = p.hpp || '';
      bed.anamneseInicial = p.anamnese_inicial || '';
      bed.dischargeForecast = p.discharge_forecast || '';
      bed.isArchived = p.status !== 'internado';
      bed.archiveReason = p.status === 'internado' ? null : p.status;

      bed.problems = (problems[p.id] || []).slice()
        .sort(function (a, b) { return (a.ordem || 0) - (b.ordem || 0); })
        .map(function (r) { return { id: r.id, descricao: r.descricao || '', status: r.status || 'ativo', plano: r.plano || '', ordem: r.ordem || 0 }; });

      bed.trackers = []
        .concat((atbs[p.id] || []).map(function (r) {
          return { id: r.id, type: 'atb', name: r.nome || '', startDate: r.start_date || '', duration: r.duration_days || null, endDate: r.end_date || '', indicacao: r.indicacao || '' };
        }))
        .concat((cultures[p.id] || []).map(function (r) {
          return { id: r.id, type: 'culture', name: r.tipo || '', collectionDate: r.collection_date || '', result: r.resultado || '' };
        }))
        .concat((devices[p.id] || []).map(function (r) {
          return { id: r.id, type: 'device', name: r.nome || '', installDate: r.install_date || '', removalDate: r.removal_date || '' };
        }));

      const labRows = (exams[p.id] || []).filter(function (r) { return r.tipo === 'lab'; });
      const labByDate = {};
      labRows.forEach(function (r) {
        const d = r.data || '';
        (labByDate[d] = labByDate[d] || []).push({ name: r.nome, value: r.resultado });
      });
      bed.exams = Object.keys(labByDate).sort().map(function (date) {
        return { id: uuid(), type: 'lab', date: date, results: labByDate[date] };
      }).concat((exams[p.id] || []).filter(function (r) { return r.tipo === 'imagem'; }).map(function (r) {
        return { id: r.id, type: 'image', date: r.data || '', name: r.nome || '', summary: r.resultado || '' };
      }));

      bed.condutas = (condutas[p.id] || []).map(function (r) { return { id: r.id, text: r.texto || '', done: !!r.done }; });
      bed.notes = (notes[p.id] && notes[p.id][0] && notes[p.id][0].texto) || '';
      bed.rawTexts = (rawTexts[p.id] || []).map(function (r) { return { id: r.id, tipo: r.tipo, data: r.data || '', texto: r.texto || '' }; });
      bed.generatedDocs = (docs[p.id] || []).slice()
        .sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); })
        .map(function (r) { return { id: r.id, tipo: r.tipo, conteudo: r.conteudo, createdAt: r.created_at }; });
    });
    return state;
  }
```

E expor no `return` final (forma completa após esta tarefa):

```js
  return {
    uuid: uuid,
    initialsFromName: initialsFromName,
    fillPatientName: fillPatientName,
    defaultState: defaultState,
    migrateBed: migrateBed,
    migrateState: migrateState,
    buildPushPayload: buildPushPayload,
    applyPull: applyPull,
  };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/`
Expected: PASS (todos os testes das 3 suítes)

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/sync.test.cjs
git commit -m "feat: payload de push com iniciais e merge de pull no PainelCore"
```

---

### Task 11: Sync no app (botões, login, Enviar/Receber)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Botões e status no cabeçalho da Tela A**

No header da Tela A, inserir IMEDIATAMENTE ANTES do botão `exportDataBtn` (âncora: `<!-- Botão de Exportar (Seta Cima Azul) -->`):

```html
            <!-- Botões de Sync (Nuvem) -->
            <button id="syncPushBtn" class="p-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-all print:hidden" title="Enviar para a nuvem">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M5.5 17a4.5 4.5 0 0 1-1.44-8.765 4.5 4.5 0 0 1 8.302-3.046 3.5 3.5 0 0 1 4.504 4.272A4 4 0 0 1 15 17H5.5Zm5.25-9.25a.75.75 0 0 0-1.5 0v4.59l-1.95-2.1a.75.75 0 1 0-1.1 1.02l3.25 3.5a.75.75 0 0 0 1.1 0l3.25-3.5a.75.75 0 1 0-1.1-1.02l-1.95 2.1V7.75Z" clip-rule="evenodd" transform="rotate(180 10 11)" /></svg>
            </button>
            <button id="syncPullBtn" class="p-2 bg-indigo-400 text-white font-medium rounded-lg hover:bg-indigo-500 transition-all print:hidden" title="Receber da nuvem">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M5.5 17a4.5 4.5 0 0 1-1.44-8.765 4.5 4.5 0 0 1 8.302-3.046 3.5 3.5 0 0 1 4.504 4.272A4 4 0 0 1 15 17H5.5Zm5.25-9.25a.75.75 0 0 0-1.5 0v4.59l-1.95-2.1a.75.75 0 1 0-1.1 1.02l3.25 3.5a.75.75 0 0 0 1.1 0l3.25-3.5a.75.75 0 1 0-1.1-1.02l-1.95 2.1V7.75Z" clip-rule="evenodd" /></svg>
            </button>
```

E logo após o `<div id="progressCounter" ...></div>`, inserir:

```html
            <div id="syncStatus" class="text-xs text-slate-500"></div>
```

- [ ] **Step 2: Modal de login**

Inserir junto aos outros modais (após o fechamento do `imageExamModal`):

```html
  <!-- === MODAL DE LOGIN (SYNC) === -->
  <div id="syncLoginModal" class="hidden fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
      <h3 class="text-lg font-bold text-slate-900">Login do Sync</h3>
      <p class="text-sm text-slate-600 mt-1">Entre com sua conta do Supabase (feito uma vez por aparelho).</p>
      <input id="syncEmailInput" type="email" placeholder="E-mail" autocomplete="username" class="w-full border border-slate-300 rounded-lg px-3 py-3 mt-4 focus:outline-none focus:ring-2 focus:ring-sky-500">
      <input id="syncPasswordInput" type="password" placeholder="Senha" autocomplete="current-password" class="w-full border border-slate-300 rounded-lg px-3 py-3 mt-3 focus:outline-none focus:ring-2 focus:ring-sky-500">
      <p id="syncLoginError" class="text-sm text-red-600 mt-2 hidden"></p>
      <div class="flex gap-3 mt-5">
        <button id="syncLoginCancelBtn" class="w-full bg-slate-100 text-slate-700 font-medium rounded-lg py-3 hover:bg-slate-200 transition-all">Cancelar</button>
        <button id="syncLoginBtn" class="w-full bg-sky-600 text-white font-medium rounded-lg py-3 hover:bg-sky-700 transition-all">Entrar</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 3: Lógica de sync no script principal**

Inserir antes do bloco `// --- Renderização Inicial ---`:

```js
    // --- Sincronização com Supabase ---
    // A anon key é pública por design; a segurança vem do RLS + login.
    const SUPABASE_URL = 'COLOQUE_AQUI_A_URL_DO_PROJETO';        // obtida na Tarefa 9 (get_project_url)
    const SUPABASE_ANON_KEY = 'COLOQUE_AQUI_A_ANON_KEY';          // obtida na Tarefa 9 (get_publishable_keys)
    const SYNC_CHILD_TABLES = ['problems', 'antibiotics', 'cultures', 'devices', 'exams', 'condutas', 'raw_texts'];
    let sbClient = null;

    function setSyncStatus(msg, isError = false) {
      const el = document.getElementById('syncStatus');
      el.textContent = msg;
      el.className = 'text-xs ' + (isError ? 'text-red-600' : 'text-slate-500');
    }

    async function ensureSupabaseLib() {
      if (window.supabase) return;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('sem conexão (não carregou a biblioteca)'));
        document.head.appendChild(s);
      });
    }

    async function getSupabaseClient() {
      await ensureSupabaseLib();
      if (!sbClient) sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data } = await sbClient.auth.getSession();
      if (!data.session) {
        showModal('syncLoginModal');
        throw new Error('faça login para sincronizar');
      }
      return sbClient;
    }

    document.getElementById('syncLoginCancelBtn').addEventListener('click', () => hideModal('syncLoginModal'));
    document.getElementById('syncLoginBtn').addEventListener('click', async () => {
      const errEl = document.getElementById('syncLoginError');
      errEl.classList.add('hidden');
      try {
        await ensureSupabaseLib();
        if (!sbClient) sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        const { error } = await sbClient.auth.signInWithPassword({
          email: document.getElementById('syncEmailInput').value.trim(),
          password: document.getElementById('syncPasswordInput').value,
        });
        if (error) throw error;
        hideModal('syncLoginModal');
        setSyncStatus('Login OK — toque em Enviar ou Receber.');
      } catch (e) {
        errEl.textContent = 'Erro: ' + e.message;
        errEl.classList.remove('hidden');
      }
    });

    async function pushToSupabase() {
      setSyncStatus('Enviando...');
      try {
        const sb = await getSupabaseClient();
        const payload = PainelCore.buildPushPayload(state);
        if (payload.patients.length === 0) { setSyncStatus('Nada para enviar.'); return; }
        let res = await sb.from('patients').upsert(payload.patients);
        if (res.error) throw res.error;
        const ids = payload.patients.map(p => p.id);
        for (const t of SYNC_CHILD_TABLES) {
          res = await sb.from(t).delete().in('patient_id', ids);
          if (res.error) throw res.error;
          if (payload[t].length) {
            res = await sb.from(t).insert(payload[t]);
            if (res.error) throw res.error;
          }
        }
        res = await sb.from('notes').upsert(payload.notes);
        if (res.error) throw res.error;
        state.lastSyncAt = new Date().toISOString();
        saveData(state);
        setSyncStatus('Enviado ✓ ' + new Date().toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        setSyncStatus('Falha ao enviar: ' + e.message, true);
      }
    }

    async function pullFromSupabase() {
      setSyncStatus('Recebendo...');
      try {
        const sb = await getSupabaseClient();
        const pulled = {};
        for (const t of ['patients', ...SYNC_CHILD_TABLES, 'notes', 'generated_docs']) {
          const { data, error } = await sb.from(t).select('*');
          if (error) throw error;
          pulled[t] = data;
        }
        PainelCore.applyPull(state, pulled);
        state.lastSyncAt = new Date().toISOString();
        saveData(state);
        renderScreenA();
        setSyncStatus('Recebido ✓ ' + new Date().toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        setSyncStatus('Falha ao receber: ' + e.message, true);
      }
    }

    document.getElementById('syncPushBtn').addEventListener('click', pushToSupabase);
    document.getElementById('syncPullBtn').addEventListener('click', pullFromSupabase);
    if (state.lastSyncAt) {
      setSyncStatus('Último sync: ' + new Date(state.lastSyncAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
    }
```

- [ ] **Step 4: Preencher as constantes reais**

Via MCP: `mcp__claude_ai_Supabase__get_project_url` e `mcp__claude_ai_Supabase__get_publishable_keys` do projeto criado na Tarefa 9. Substituir `COLOQUE_AQUI_A_URL_DO_PROJETO` e `COLOQUE_AQUI_A_ANON_KEY` pelos valores reais.

- [ ] **Step 5: Verificação manual do ciclo completo**

1. Abrir o app, criar leito com paciente "Teste da Silva" e 1 problema.
2. Tocar Enviar → modal de login → entrar com a conta criada na Tarefa 9 → tocar Enviar de novo → "Enviado ✓".
3. Verificar no banco (MCP `execute_sql`): `select bed_number, initials, status from patients;` → deve mostrar iniciais `T.S.` e NUNCA "Teste da Silva".
4. Editar algo no banco (MCP): `update problems set plano = 'Plano editado pela IA' where patient_id = '<id>';`
5. Tocar Receber no app → abrir o paciente → plano atualizado, nome completo intacto.

- [ ] **Step 6: Rodar testes (regressão)**

Run: `node --test tests/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: sincronização manual Enviar/Receber com Supabase e login"
```

---

### Task 12: UI — Documentos Gerados (copiar com nome)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Inserir a seção no template**

No `patientDetailTpl`, inserir IMEDIATAMENTE APÓS o fechamento da seção "Texto do Prontuário" (criada na Tarefa 7) e antes de `      <!-- Seção: Previsão de Alta -->`:

```html
      <!-- Seção: Documentos Gerados -->
      <div class="collapsible-section bg-white rounded-xl shadow-lg border border-slate-200/50">
        <button class="collapsible-toggle-btn flex justify-between items-center w-full p-4 text-left">
          <span class="text-base font-bold text-slate-900">Documentos Gerados</span>
          <svg class="toggle-icon w-5 h-5 transition-transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
        </button>
        <div class="collapsible-content p-4 pt-0">
          <div class="gendoc-list space-y-2"></div>
        </div>
      </div>
```

- [ ] **Step 2: Adicionar `renderGeneratedDocsList`**

Inserir logo após a função `renderRawTextList`:

```js
    const GENDOC_LABEL = { sumario_alta: 'Sumário de Alta', receituario: 'Receituário', laudo: 'Laudo' };

    async function copyTextToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      }
    }

    function renderGeneratedDocsList(listElement, bed, bedIdx) {
      listElement.innerHTML = '';
      if (!bed.generatedDocs || bed.generatedDocs.length === 0) {
        listElement.innerHTML = `<p class="text-sm text-slate-500 px-1">Nenhum documento. Peça à IA para gerar (ex.: sumário de alta) e toque em Receber.</p>`;
        return;
      }
      bed.generatedDocs.forEach((doc) => {
        const det = document.createElement('details');
        det.className = 'text-sm p-2 rounded-md bg-slate-50 border border-slate-200';
        const createdStr = doc.createdAt ? new Date(doc.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const summary = document.createElement('summary');
        summary.className = 'cursor-pointer flex justify-between items-center gap-2';
        summary.innerHTML = `
          <span class="font-medium text-slate-700">${GENDOC_LABEL[doc.tipo] || doc.tipo} <span class="text-xs text-slate-500 font-normal">${createdStr}</span></span>
          <button class="copy-gendoc text-xs bg-sky-600 text-white font-medium rounded-lg py-1.5 px-3 hover:bg-sky-700 transition-all print:hidden">Copiar</button>
        `;
        const body = document.createElement('p');
        body.className = 'text-slate-600 whitespace-pre-wrap mt-2 text-xs';
        body.textContent = PainelCore.fillPatientName(doc.conteudo || '', bed.patientName);
        det.appendChild(summary);
        det.appendChild(body);
        summary.querySelector('.copy-gendoc').addEventListener('click', async (e) => {
          e.preventDefault();
          const ok = await copyTextToClipboard(PainelCore.fillPatientName(doc.conteudo || '', bed.patientName));
          e.target.textContent = ok ? 'Copiado ✓' : 'Falhou';
          setTimeout(() => { e.target.textContent = 'Copiar'; }, 2000);
        });
        listElement.appendChild(det);
      });
    }
```

- [ ] **Step 3: Binding em `renderScreenB`**

Após a linha do `setupCollapsibleSection` de rawTexts, adicionar:

```js
      setupCollapsibleSection(art, '.gendoc-list', 'isDocsMinimized', b, (el) => renderGeneratedDocsList(el, b, idx));
```

- [ ] **Step 4: Verificação manual**

Inserir um documento de teste no banco (MCP `execute_sql`):

```sql
insert into generated_docs (patient_id, tipo, conteudo)
values ('<patientId do paciente de teste>', 'sumario_alta', 'SUMÁRIO DE ALTA — Paciente [NOME], internado no leito X.');
```

Tocar Receber no app → abrir o paciente → seção "Documentos Gerados" mostra o doc com o nome completo no preview; "Copiar" coloca o texto com o nome real na área de transferência.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: seção de documentos gerados com cópia preenchendo [NOME]"
```

---

### Task 13: Templates de documentos (doc_templates)

**Files:**
- Create: `supabase/seed/doc_templates.sql`

- [ ] **Step 1: PAUSA — coletar os modelos reais do usuário**

Pedir ao usuário os modelos reais (anonimizados) de: sumário de alta, receituário e laudo(s). Se ele fornecer, usar a estrutura/estilo deles no lugar dos templates padrão abaixo (mantendo os mesmos `nome` e as mesmas instruções de placeholder). Se ainda não tiver em mãos, seguir com os padrões abaixo — eles são funcionais e serão refinados depois com `update doc_templates set template = ... where nome = ...`.

- [ ] **Step 2: Escrever o seed**

Criar `supabase/seed/doc_templates.sql`:

```sql
insert into doc_templates (nome, descricao, template) values
('sumario_alta', 'Sumário de alta hospitalar — texto para colar no prontuário', $tpl$
INSTRUÇÕES PARA A IA: Preencha com os dados do paciente (tabelas patients, problems, antibiotics, cultures, devices, exams, condutas, notes, raw_texts). Use [NOME] no lugar do nome do paciente — NUNCA escreva nome real. Liste cada problema com a evolução e o que foi feito. Datas em DD/MM/AAAA. Linguagem técnica, objetiva, em português.

SUMÁRIO DE ALTA HOSPITALAR

Paciente: [NOME]
Idade: {idade} anos
Data de internação: {data_admissao}
Data de alta: {data_alta}

ANTECEDENTES PESSOAIS:
{hpp}

HISTÓRIA DA INTERNAÇÃO:
{anamnese_inicial_resumida}

DIAGNÓSTICOS E EVOLUÇÃO:
{para cada problema: - DESCRIÇÃO (status): evolução e tratamento realizado, incluindo antibióticos com datas e duração}

EXAMES RELEVANTES:
{exames laboratoriais e de imagem mais relevantes, com datas}

CONDIÇÕES DE ALTA:
{estado clínico na alta}

PLANO PÓS-ALTA:
{orientações, medicações de uso contínuo, retornos e encaminhamentos}
$tpl$),

('receituario', 'Receituário de alta — gerado a partir do texto cru da prescrição', $tpl$
INSTRUÇÕES PARA A IA: Gere a partir do raw_text mais recente do tipo "prescricao" do paciente. Inclua APENAS medicações de uso domiciliar (exclua medicações EV hospitalares, dieta e cuidados de enfermagem). Use [NOME] no lugar do nome. Formato: um item por medicação, numerado, com nome, concentração, posologia e duração quando aplicável.

RECEITUÁRIO

Paciente: [NOME]

Uso oral/domiciliar:
{1. MEDICAÇÃO concentração — posologia — duração}

Orientações:
{orientações relevantes de uso}

Data: {data_de_hoje}
$tpl$),

('laudo', 'Laudo/relatório médico genérico', $tpl$
INSTRUÇÕES PARA A IA: Relatório médico para fins administrativos ou de encaminhamento. Use [NOME] no lugar do nome. Baseie-se nos problemas, evolução e exames do paciente. Pergunte ao usuário a finalidade do laudo se não estiver clara.

RELATÓRIO MÉDICO

Declaro, para os devidos fins, que o paciente [NOME], {idade} anos, esteve internado nesta instituição no período de {data_admissao} a {data_alta_ou_atual}, sob meus cuidados, em razão de:

{diagnósticos principais com CID-10 quando aplicável}

{resumo objetivo da evolução e do estado atual}

{finalidade/observações}

Data: {data_de_hoje}
$tpl$)
on conflict (nome) do update set descricao = excluded.descricao, template = excluded.template;
```

- [ ] **Step 3: Aplicar no banco**

Via MCP: `mcp__claude_ai_Supabase__execute_sql` com o conteúdo do seed. Confirmar: `select nome, descricao from doc_templates;` → 3 linhas.

- [ ] **Step 4: Commit**

```bash
git add supabase/seed/doc_templates.sql
git commit -m "feat: templates de sumário de alta, receituário e laudo"
```

---

### Task 14: Instruções de IA (CLAUDE.md + Project claude.ai)

**Files:**
- Create: `CLAUDE.md`
- Create: `docs/ai/claude-ai-project-instructions.md`

- [ ] **Step 1: Criar `CLAUDE.md`**

```markdown
# Painel de Internação (Caderno de Visitas)

App pessoal de um médico internista: `index.html` (offline-first, localStorage) + banco Supabase sincronizado manualmente (botões Enviar/Receber no app). A lógica pura fica em `painel-core.js` (UMD), testada com `node --test tests/`.

## Regras de privacidade (INEGOCIÁVEIS)

- O banco NUNCA recebe nome completo de paciente — apenas `patients.initials`.
- Todo documento gerado usa o placeholder literal `[NOME]` no lugar do nome. O app substitui localmente na hora de copiar.
- Nunca grave nomes completos, CPF, telefone ou endereço de pacientes em nenhuma tabela.

## Banco (Supabase, projeto painel-internacao)

Tabelas: `patients` (status: internado/alta/arquivado), `problems` (status: ativo/resolvido/cronico, com `plano` e `ordem`), `antibiotics`, `cultures`, `devices`, `exams` (tipo: lab/imagem), `condutas`, `notes` (1 linha por paciente), `raw_texts` (tipo: evolucao/prescricao/admissao — textos crus colados do prontuário), `doc_templates`, `generated_docs`.

Identifique pacientes por `bed_number` + `initials` (ex.: "leito 1012-A"). Em ambiguidade, pergunte.

## Fluxo 1 — Atualizar a base a partir de texto cru

Quando o usuário colar um texto do prontuário (ou pedir para processar `raw_texts` pendentes):
1. Salve o texto em `raw_texts` (tipo: evolucao/prescricao/admissao) se ainda não estiver lá.
2. Extraia e atualize: `problems` (criar novos, atualizar status/plano dos existentes — não duplique problemas já cadastrados; compare por significado, não por string), `antibiotics` (nome, D1, duração, indicação), `condutas`, `anamnese_inicial` (apenas se for texto de admissão e o campo estiver vazio).
3. Gere `id` uuid para linhas novas. Não delete linhas que você não criou, a menos que o texto diga explicitamente (ex.: "suspenso ATB").
4. Resuma para o usuário o que mudou e lembre-o de tocar **Receber** no app.

## Fluxo 2 — Gerar documento

1. Leia o template em `doc_templates` (`sumario_alta`, `receituario`, `laudo`) e siga as INSTRUÇÕES nele.
2. Leia o paciente completo (todas as tabelas + `raw_texts`).
3. Gere o texto com `[NOME]`, mostre no chat E grave em `generated_docs` (`patient_id`, `tipo`, `conteudo`).
4. Lembre o usuário de tocar **Receber** no app para o documento aparecer na seção "Documentos Gerados".

## Convenções de sync (não quebre)

- O push do app faz delete+insert dos filhos por paciente: edições da IA devem ser feitas entre um Enviar e um Receber do usuário (regra: última sincronização vence).
- `notes` é upsert por `patient_id`. `generated_docs` só cresce (o app nunca apaga no push).
- Nunca altere `patients.id`.

## Desenvolvimento

- Testes: `node --test tests/` (sempre rodar após mexer em `painel-core.js`).
- O app deve continuar funcionando 100% offline em `file://` — não introduza ES modules nem dependências de build.
- Schema: `supabase/migrations/`. Mudanças de schema exigem migration nova + atualização de `buildPushPayload`/`applyPull` + testes.
```

- [ ] **Step 2: Criar `docs/ai/claude-ai-project-instructions.md`**

```markdown
# Instruções para o Project no claude.ai (copiar para as Custom Instructions do Project)

Você é o assistente do meu painel de internação. Sou médico internista; o banco Supabase (conector já ligado a este Project) guarda meus pacientes internados de forma pseudonimizada.

REGRAS DE PRIVACIDADE (INEGOCIÁVEIS):
- O banco só tem iniciais (patients.initials). Nunca peça nem grave nome completo, CPF ou contato de paciente.
- Todo documento gerado usa o placeholder literal [NOME] no lugar do nome do paciente.

BANCO: patients (status: internado/alta/arquivado), problems (ativo/resolvido/cronico, com plano e ordem), antibiotics, cultures, devices, exams (lab/imagem), condutas, notes (1 por paciente), raw_texts (evolucao/prescricao/admissao), doc_templates, generated_docs. Identifico pacientes pelo leito (bed_number) e iniciais.

QUANDO EU COLAR TEXTO DO PRONTUÁRIO:
1. Pergunte (se não estiver claro) de qual leito é e o tipo (evolução/prescrição/admissão).
2. Salve em raw_texts e atualize problems, antibiotics, condutas e anamnese_inicial conforme o texto. Não duplique problemas existentes; gere uuid para linhas novas; não delete nada que o texto não mande suspender.
3. Resuma o que mudou e me lembre de tocar "Receber" no app.

QUANDO EU PEDIR UM DOCUMENTO (sumário de alta, receituário, laudo):
1. Leia o template correspondente em doc_templates e siga as instruções internas dele.
2. Leia todos os dados do paciente (incluindo raw_texts).
3. Gere o texto com [NOME], mostre aqui e grave em generated_docs (patient_id, tipo, conteudo). Me lembre de tocar "Receber".

O receituário é gerado a partir do raw_text mais recente do tipo "prescricao" — só medicações de uso domiciliar.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/ai/claude-ai-project-instructions.md
git commit -m "docs: instruções de IA para Claude Code e Project claude.ai"
```

---

### Task 15: Deploy no GitHub Pages

**Files:** nenhum novo (usa o repo existente)

Nota: GitHub Pages gratuito exige repositório **público**. O repositório contém apenas código — nenhum dado de paciente (dados ficam no localStorage e no Supabase). A anon key do Supabase no código é pública por design (RLS + login protegem o banco).

- [ ] **Step 1: Verificar autenticação do gh**

Run: `gh auth status`
Se não autenticado: PAUSA — pedir ao usuário para rodar `gh auth login` (ou criar o repo manualmente no site e informar a URL).

- [ ] **Step 2: Criar o repositório e enviar**

```bash
cd "c:\Users\albed\Documents\Projetos\Painel"
gh repo create painel-internacao --public --source . --push
```

- [ ] **Step 3: Habilitar o Pages**

```bash
gh api "repos/{owner}/painel-internacao/pages" -X POST -F "source[branch]=master" -F "source[path]=/" 2>/dev/null || echo "Se falhar: habilitar manualmente em Settings > Pages > Deploy from branch (master, /)"
```

Run: `gh api "repos/{owner}/painel-internacao/pages" --jq .html_url`
Expected: URL do tipo `https://<usuario>.github.io/painel-internacao/`

- [ ] **Step 4: Verificação manual**

Abrir a URL no navegador (de preferência também no celular): app carrega, criar leito de teste funciona, sync funciona. Atenção: o localStorage da URL é independente do localStorage do arquivo local — os dados reais entram via export/import (Tarefa 16).

---

### Task 16: Verificação fim-a-fim com dados reais

**Files:** nenhum

- [ ] **Step 1: Regressão completa**

Run: `node --test tests/`
Expected: PASS em todas as suítes.

- [ ] **Step 2: PAUSA — migração dos dados reais do usuário**

Guiar o usuário:
1. No app ANTIGO (onde estão os dados reais), tocar Exportar → baixa o JSON.
2. Abrir o app NOVO (URL do Pages, no aparelho que ele vai usar) → Importar → escolher o JSON.
3. Conferir: todos os leitos presentes, diagnósticos viraram "Lista de Problemas" com status Ativo, nomes completos visíveis.

- [ ] **Step 3: PAUSA — checklist fim-a-fim com o usuário**

1. Login + Enviar no app novo → conferir no Supabase que `patients` tem só iniciais.
2. Colar uma evolução real (anonimizada) na seção "Texto do Prontuário" de um paciente → Enviar.
3. No Claude Code (este projeto): "processe os raw_texts pendentes do leito X" → conferir problems/antibiotics atualizados no banco.
4. Receber no app → conferir que as mudanças chegaram e o nome completo continua certo.
5. "Gere o sumário de alta do leito X" no Claude Code → Receber no app → seção "Documentos Gerados" → Copiar → colar em um editor → nome completo preenchido, sem [NOME] sobrando.
6. Dar alta no paciente de teste → conferir em Arquivados ("Alta em DD/MM") → restaurar.

- [ ] **Step 4: Commit final e encerramento**

```bash
git add -A
git commit -m "chore: ajustes finais da verificação fim-a-fim" --allow-empty
```

Lembrar o usuário de configurar o Project no claude.ai com `docs/ai/claude-ai-project-instructions.md` e o conector Supabase, e de fornecer os modelos reais de documentos caso ainda não tenha (Tarefa 13 usa padrões até lá).
