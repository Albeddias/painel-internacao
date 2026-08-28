const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

function makeState(labRangesText, prefsBaseHash) {
  const s = PainelCore.migrateState({ beds: [] }, '2026-08-28');
  s.labRangesText = labRangesText;
  if (prefsBaseHash) s.syncBase['#prefs'] = { lab_ranges: prefsBaseHash };
  return s;
}

function pull(prefs) {
  return {
    patients: [], problems: [], antibiotics: [], cultures: [], devices: [],
    exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [],
    prefs: prefs,
  };
}

test('buildPushPayload: envia a preferência lab_ranges', () => {
  const state = makeState('Hb: 10-20');
  const out = PainelCore.buildPushPayload(state);
  assert.deepStrictEqual(out.prefs, [{ key: 'lab_ranges', value: 'Hb: 10-20' }]);
});

test('buildSyncBase: fotografa o hash da preferência em "#prefs"', () => {
  const base = PainelCore.buildSyncBase(makeState('Hb: 10-20'));
  assert.strictEqual(base['#prefs'].lab_ranges, PainelCore.hash8('Hb: 10-20'));
});

test('mergeStates: local intocado adota as faixas do banco', () => {
  const state = makeState('Hb: 10-20', PainelCore.hash8('Hb: 10-20'));
  PainelCore.mergeStates(state, pull([{ key: 'lab_ranges', value: 'Hb: 11-16' }]));
  assert.strictEqual(state.labRangesText, 'Hb: 11-16');
});

test('mergeStates: local editado desde a última foto vence o banco', () => {
  const state = makeState('Hb: 9-21', PainelCore.hash8('Hb: 10-20'));
  PainelCore.mergeStates(state, pull([{ key: 'lab_ranges', value: 'Hb: 11-16' }]));
  assert.strictEqual(state.labRangesText, 'Hb: 9-21');
});

test('mergeStates: sem foto, o padrão de fábrica adota o banco; texto customizado fica', () => {
  const factory = makeState(PainelCore.DEFAULT_LAB_RANGES_TEXT);
  PainelCore.mergeStates(factory, pull([{ key: 'lab_ranges', value: 'Hb: 11-16' }]));
  assert.strictEqual(factory.labRangesText, 'Hb: 11-16');

  const custom = makeState('Hb: 9-21');
  PainelCore.mergeStates(custom, pull([{ key: 'lab_ranges', value: 'Hb: 11-16' }]));
  assert.strictEqual(custom.labRangesText, 'Hb: 9-21');
});

test('mergeStates: pull sem prefs mantém o local', () => {
  const state = makeState('Hb: 10-20', PainelCore.hash8('Hb: 10-20'));
  PainelCore.mergeStates(state, pull([]));
  assert.strictEqual(state.labRangesText, 'Hb: 10-20');
  PainelCore.mergeStates(state, pull(undefined));
  assert.strictEqual(state.labRangesText, 'Hb: 10-20');
});

test('applyPull: pull limpo adota as faixas do banco quando existem', () => {
  const state = makeState('Hb: 10-20');
  PainelCore.applyPull(state, pull([{ key: 'lab_ranges', value: 'Hb: 11-16' }]));
  assert.strictEqual(state.labRangesText, 'Hb: 11-16');
  PainelCore.applyPull(state, pull([]));
  assert.strictEqual(state.labRangesText, 'Hb: 11-16');
});
