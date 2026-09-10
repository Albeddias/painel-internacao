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
