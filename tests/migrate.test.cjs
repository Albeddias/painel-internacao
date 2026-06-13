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

test('migrateBed: conduta null/corrompida é descartada sem quebrar a migração', () => {
  const s = PainelCore.migrateState({ beds: [{ ...V14_BED, condutas: [null, { text: 'OK', done: false }, 'lixo'] }] }, '2026-06-12');
  assert.strictEqual(s.beds[0].condutas.length, 1);
  assert.strictEqual(s.beds[0].condutas[0].text, 'OK');
});

test('migrateBed: problems vazio com diagnoses preenchido promove os diagnoses', () => {
  const s = PainelCore.migrateState({ beds: [{ ...V14_BED, problems: [] }] }, '2026-06-12');
  assert.strictEqual(s.beds[0].problems.length, 2);
});

test('migrateBed: arrays não compartilham referência com a entrada', () => {
  const input = { ...V14_BED };
  const s = PainelCore.migrateState({ beds: [input] }, '2026-06-12');
  s.beds[0].trackers.push({ id: 'x', type: 'device', name: 'X', installDate: '2026-06-12' });
  assert.strictEqual(input.trackers.length, 1);
});

test('migrateBed: archiveReason existente é preservado', () => {
  const s = PainelCore.migrateState({ beds: [{ ...V14_BED, isArchived: true, archiveReason: 'alta' }] }, '2026-06-12');
  assert.strictEqual(s.beds[0].archiveReason, 'alta');
});
