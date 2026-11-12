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
