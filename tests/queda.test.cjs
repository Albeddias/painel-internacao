const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// Check "Queda": termo de ciência do risco de queda, aplicado uma vez por internação.
// Fica fora de bed.checks (que zera todo dia) e vale até a alta.

test('migrateBed: quedaOrientada nasce false e não entra nos checks diários', () => {
  const bed = PainelCore.migrateBed({ patientName: 'Ana' });
  assert.strictEqual(bed.quedaOrientada, false);
  assert.deepStrictEqual(Object.keys(bed.checks), ['ev', 'p', 'ex', 'tev']);
});

test('migrateBed: quedaOrientada marcado é preservado', () => {
  assert.strictEqual(PainelCore.migrateBed({ patientName: 'Ana', quedaOrientada: true }).quedaOrientada, true);
});

test('buildReadmission: internação nova começa sem o termo de queda', () => {
  const prev = PainelCore.migrateBed({ patientId: 'p1', patientName: 'Ana Braga', quedaOrientada: true });
  const { newBed } = PainelCore.buildReadmission(prev, '2001-B', '2026-11-11');
  assert.strictEqual(newBed.quedaOrientada, false);
  assert.strictEqual(prev.quedaOrientada, true, 'a internação anterior guarda o registro');
});

test('mergeStates: sincronizar não desmarca o termo de queda do leito', () => {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed({ patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga', quedaOrientada: true }),
  ] }, '2026-11-11');
  state.syncedPatientIds = ['p1'];
  state.syncBase = PainelCore.buildSyncBase(state);
  PainelCore.mergeStates(state, {
    patients: [{ id: 'p1', bed_number: '1012-A', initials: 'AB', age: null, admit_date: null, hpp: 'HAS', anamnese_inicial: '', discharge_forecast: null, status: 'internado', alergias: '', medicacoes_previas: '' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
    notes: [{ patient_id: 'p1', texto: '' }], raw_texts: [], generated_docs: [], evolucoes: [],
  });
  assert.strictEqual(state.beds[0].hpp, 'HAS', 'a mescla aconteceu');
  assert.strictEqual(state.beds[0].quedaOrientada, true);
});

// ---- Sincronização entre aparelhos (painel_patients.queda_orientada) ----------------
// Três-vias por campo, como os demais campos do paciente: marcar/desmarcar num aparelho
// chega aos outros; quem mexeu no check desde a última foto vence.

function row(over) {
  return Object.assign({
    id: 'p1', bed_number: '1012-A', initials: 'AB', age: null, admit_date: null, hpp: '', anamnese_inicial: '',
    discharge_forecast: null, status: 'internado', alergias: '', medicacoes_previas: '', person_id: null,
    discharge_date: null, queda_orientada: false,
  }, over || {});
}
function pulled(over) {
  return {
    patients: [row(over)],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
    notes: [{ patient_id: 'p1', texto: '' }], raw_texts: [], generated_docs: [], evolucoes: [],
  };
}
function synced(bedOver) {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed(Object.assign({ patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga' }, bedOver || {})),
  ] }, '2026-11-14');
  state.syncedPatientIds = ['p1'];
  state.syncBase = PainelCore.buildSyncBase(state);
  return state;
}
// Foto tirada antes de o check sincronizar: tem os outros campos, mas não o da queda.
function semHashDaQueda(state) {
  delete state.syncBase.p1.fields.queda_orientada;
  return state;
}

test('buildPushPayload: envia queda_orientada como booleano', () => {
  assert.strictEqual(PainelCore.buildPushPayload(synced({ quedaOrientada: true })).patients[0].queda_orientada, true);
  assert.strictEqual(PainelCore.buildPushPayload(synced()).patients[0].queda_orientada, false);
});

test('buildSyncBase: a foto guarda o hash do check de queda', () => {
  const marcado = synced({ quedaOrientada: true }).syncBase.p1.fields.queda_orientada;
  const pendente = synced().syncBase.p1.fields.queda_orientada;
  assert.match(String(marcado), /^[0-9a-f]{8}$/);
  assert.notStrictEqual(marcado, pendente);
});

test('mergeStates: check marcado em outro aparelho chega a este', () => {
  const state = synced();
  PainelCore.mergeStates(state, pulled({ queda_orientada: true }));
  assert.strictEqual(state.beds[0].quedaOrientada, true);
});

test('mergeStates: check desmarcado em outro aparelho também chega', () => {
  const state = synced({ quedaOrientada: true });
  PainelCore.mergeStates(state, pulled({ queda_orientada: false }));
  assert.strictEqual(state.beds[0].quedaOrientada, false);
});

test('mergeStates: check marcado aqui desde a última sincronização vence o banco', () => {
  const state = synced();
  state.beds[0].quedaOrientada = true;
  PainelCore.mergeStates(state, pulled({ queda_orientada: false }));
  assert.strictEqual(state.beds[0].quedaOrientada, true);
  assert.strictEqual(PainelCore.buildPushPayload(state).patients[0].queda_orientada, true);
});

test('mergeStates: marcar a queda aqui não segura o que o banco mudou em outro campo', () => {
  const state = synced();
  state.beds[0].quedaOrientada = true;
  PainelCore.mergeStates(state, pulled({ hpp: 'HAS\nDM2' }));
  assert.strictEqual(state.beds[0].hpp, 'HAS\nDM2');
  assert.strictEqual(state.beds[0].quedaOrientada, true);
});

test('transição: foto sem o hash da queda nunca desmarca o que está marcado no aparelho', () => {
  const state = semHashDaQueda(synced({ quedaOrientada: true }));
  PainelCore.mergeStates(state, pulled({ queda_orientada: false }));
  assert.strictEqual(state.beds[0].quedaOrientada, true);
});

test('transição: foto antiga (hash único) com paciente intocado também não desmarca', () => {
  const state = synced({ quedaOrientada: true });
  const f = state.syncBase.p1.fields;
  state.syncBase.p1.fields = { alergias: f.alergias, medicacoes_previas: f.medicacoes_previas };
  PainelCore.mergeStates(state, pulled({ queda_orientada: false, hpp: 'HAS' }));
  assert.strictEqual(state.beds[0].hpp, 'HAS', 'paciente intocado adotou o resto do banco');
  assert.strictEqual(state.beds[0].quedaOrientada, true);
});

test('transição: foto sem o hash da queda adota o check já marcado no banco', () => {
  const state = semHashDaQueda(synced());
  PainelCore.mergeStates(state, pulled({ queda_orientada: true }));
  assert.strictEqual(state.beds[0].quedaOrientada, true);
});

test('mergeStates: paciente novo neste aparelho chega com o check do banco', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-11-14');
  PainelCore.mergeStates(state, pulled({ queda_orientada: true }));
  assert.strictEqual(state.beds[0].quedaOrientada, true);
});

test('applyPull: o leito reconstruído do banco traz o check de queda', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-11-14');
  PainelCore.applyPull(state, pulled({ queda_orientada: true }));
  assert.strictEqual(state.beds[0].quedaOrientada, true);
});
