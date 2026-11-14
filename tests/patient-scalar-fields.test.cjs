const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// Campos corridos do paciente (leito, idade, admissão, HPP, anamnese, previsão de alta,
// status, anotações): três-vias POR CAMPO. Antes era tudo-ou-nada — bastava o aparelho
// editar um deles para o que a IA gravou nos outros ser apagado pelo push.

function patientRow(over) {
  return Object.assign({
    id: 'p1', bed_number: '1012-A', initials: 'AB', age: 60, admit_date: '2026-11-01', hpp: 'HAS',
    anamnese_inicial: '', discharge_forecast: null, status: 'internado', alergias: '', medicacoes_previas: '',
    person_id: null, discharge_date: null,
  }, over || {});
}
function pull(patientOver, notes) {
  return {
    patients: [patientRow(patientOver)],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
    notes: [{ patient_id: 'p1', texto: notes == null ? 'Estável.' : notes }], raw_texts: [], generated_docs: [], evolucoes: [],
  };
}
function syncedState(bedOver) {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed(Object.assign({
      patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga', age: 60, admitDate: '2026-11-01', hpp: 'HAS', notes: 'Estável.',
    }, bedOver || {})),
  ] }, '2026-11-14');
  state.syncedPatientIds = ['p1'];
  state.syncBase = PainelCore.buildSyncBase(state);
  return state;
}
// Foto como a versão anterior do app tirava: hash único dos scalars + alergias/medicações.
function legacyPhoto(state) {
  const f = state.syncBase.p1.fields;
  state.syncBase.p1.fields = { alergias: f.alergias, medicacoes_previas: f.medicacoes_previas };
  return state;
}
const SCALAR_COLS = ['bed_number', 'age', 'admit_date', 'hpp', 'anamnese_inicial', 'discharge_forecast', 'status', 'notes', 'person_id'];

test('buildSyncBase: a foto guarda um hash por campo corrido', () => {
  const fields = syncedState().syncBase.p1.fields;
  SCALAR_COLS.forEach((col) => assert.match(String(fields[col]), /^[0-9a-f]{8}$/, col));
});

test('buildSyncBase: o hash de um campo só muda quando aquele campo muda', () => {
  const antes = syncedState().syncBase.p1.fields;
  const depois = syncedState({ notes: 'Outra nota.' }).syncBase.p1.fields;
  assert.notStrictEqual(antes.notes, depois.notes);
  SCALAR_COLS.filter(c => c !== 'notes').forEach((col) => assert.strictEqual(antes[col], depois[col], col));
});

test('mergeStates: anamnese gravada pela IA entra mesmo com a anotação editada no aparelho', () => {
  const state = syncedState();
  state.beds[0].notes = 'Nota editada hoje.';
  PainelCore.mergeStates(state, pull({ anamnese_inicial: 'Admitida por dispneia há 3 dias.' }));
  const bed = state.beds[0];
  assert.strictEqual(bed.anamneseInicial, 'Admitida por dispneia há 3 dias.');
  assert.strictEqual(bed.notes, 'Nota editada hoje.', 'a nota local não é atropelada');
  assert.strictEqual(PainelCore.buildPushPayload(state).patients[0].anamnese_inicial, 'Admitida por dispneia há 3 dias.',
    'o push não apaga a anamnese do banco');
});

test('mergeStates: HPP editado no aparelho vence; previsão de alta do banco entra', () => {
  const state = syncedState();
  state.beds[0].hpp = 'HAS, DM2';
  PainelCore.mergeStates(state, pull({ hpp: 'HAS (banco)', discharge_forecast: '2026-11-20' }));
  assert.strictEqual(state.beds[0].hpp, 'HAS, DM2');
  assert.strictEqual(state.beds[0].dischargeForecast, '2026-11-20');
});

test('mergeStates: anotação do banco entra mesmo com o HPP editado no aparelho', () => {
  const state = syncedState();
  state.beds[0].hpp = 'HAS, DM2';
  PainelCore.mergeStates(state, pull({}, 'Nota de outro aparelho.'));
  assert.strictEqual(state.beds[0].notes, 'Nota de outro aparelho.');
  assert.strictEqual(state.beds[0].hpp, 'HAS, DM2');
});

test('mergeStates: apagar a anamnese no aparelho propaga (não ressuscita do banco)', () => {
  const state = syncedState({ anamneseInicial: 'Texto antigo.' });
  state.beds[0].anamneseInicial = '';
  PainelCore.mergeStates(state, pull({ anamnese_inicial: 'Texto antigo.' }));
  assert.strictEqual(state.beds[0].anamneseInicial, '');
  assert.strictEqual(PainelCore.buildPushPayload(state).patients[0].anamnese_inicial, '');
});

test('mergeStates: troca de leito feita em outro aparelho entra mesmo com a nota editada aqui', () => {
  const state = syncedState();
  state.beds[0].notes = 'Nota editada hoje.';
  PainelCore.mergeStates(state, pull({ bed_number: '2040-B' }));
  assert.strictEqual(state.beds[0].bedNumber, '2040-B');
});

test('mergeStates: idade vazia e intocada adota a do banco, com outro campo editado', () => {
  const state = syncedState({ age: '' });
  state.beds[0].hpp = 'HAS, DM2';
  PainelCore.mergeStates(state, pull({ age: 71 }));
  assert.strictEqual(Number(state.beds[0].age), 71);
});

test('mergeStates: alta dada em outro aparelho entra inteira (status + data) com a nota editada aqui', () => {
  const state = syncedState();
  state.beds[0].notes = 'Nota editada hoje.';
  PainelCore.mergeStates(state, pull({ status: 'alta', discharge_date: '2026-11-13' }));
  const bed = state.beds[0];
  assert.strictEqual(bed.isArchived, true);
  assert.strictEqual(bed.archiveReason, 'alta');
  assert.strictEqual(bed.dischargedAt, '2026-11-13');
  assert.strictEqual(bed.notes, 'Nota editada hoje.');
});

test('mergeStates: alta dada neste aparelho vence o status do banco; HPP do banco entra', () => {
  const state = syncedState();
  Object.assign(state.beds[0], { isArchived: true, archiveReason: 'alta', dischargedAt: '2026-11-14' });
  PainelCore.mergeStates(state, pull({ hpp: 'HAS, DM2' }));
  const p = PainelCore.buildPushPayload(state).patients[0];
  assert.strictEqual(p.status, 'alta');
  assert.strictEqual(p.discharge_date, '2026-11-14');
  assert.strictEqual(p.hpp, 'HAS, DM2');
});

test('mergeStates: sync sem mudança em lado nenhum não altera o paciente', () => {
  const state = syncedState({ anamneseInicial: 'Texto.', dischargeForecast: '2026-11-20' });
  const antes = JSON.stringify(PainelCore.buildPushPayload(state).patients);
  PainelCore.mergeStates(state, pull({ anamnese_inicial: 'Texto.', discharge_forecast: '2026-11-20' }));
  assert.strictEqual(JSON.stringify(PainelCore.buildPushPayload(state).patients), antes);
});

test('foto antiga + paciente editado no aparelho: anamnese vazia adota o banco, o resto local fica', () => {
  const state = legacyPhoto(syncedState());
  state.beds[0].notes = 'Nota editada hoje.';
  PainelCore.mergeStates(state, pull({ anamnese_inicial: 'Gravada pela IA.', hpp: 'HAS (banco)', discharge_forecast: '2026-11-20' }));
  const bed = state.beds[0];
  assert.strictEqual(bed.anamneseInicial, 'Gravada pela IA.', 'vazio local adota o banco');
  assert.strictEqual(bed.notes, 'Nota editada hoje.');
  assert.strictEqual(bed.hpp, 'HAS', 'sem hash do campo não dá para saber quem editou: fica o local');
  assert.strictEqual(bed.dischargeForecast, '', 'idem');
});

test('foto antiga + paciente intocado no aparelho: adota o banco em todos os campos', () => {
  const state = legacyPhoto(syncedState());
  PainelCore.mergeStates(state, pull({ hpp: 'HAS, DM2', discharge_forecast: '2026-11-20', age: 61 }, 'Nota do banco.'));
  const bed = state.beds[0];
  assert.strictEqual(bed.hpp, 'HAS, DM2');
  assert.strictEqual(bed.dischargeForecast, '2026-11-20');
  assert.strictEqual(Number(bed.age), 61);
  assert.strictEqual(bed.notes, 'Nota do banco.');
});

test('sem foto alguma: texto local preenchido fica; anamnese vazia adota o banco', () => {
  const state = syncedState();
  state.syncBase = {};
  PainelCore.mergeStates(state, pull({ hpp: 'HAS (banco)', anamnese_inicial: 'Gravada pela IA.' }, 'Nota do banco.'));
  const bed = state.beds[0];
  assert.strictEqual(bed.hpp, 'HAS');
  assert.strictEqual(bed.notes, 'Estável.');
  assert.strictEqual(bed.anamneseInicial, 'Gravada pela IA.');
});
