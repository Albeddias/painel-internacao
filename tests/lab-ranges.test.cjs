const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

test('parseLabRanges: "Nome: min-max" com vírgula decimal e ponto de milhar', () => {
  const r = PainelCore.parseLabRanges('Hb: 12-17\nCr: 0,6-1,3\nLeucócitos: 4.000-11.000');
  assert.deepStrictEqual(r['hb'], { min: 12, max: 17 });
  assert.deepStrictEqual(r['cr'], { min: 0.6, max: 1.3 });
  assert.deepStrictEqual(r['leucócitos'], { min: 4000, max: 11000 });
});

test('parseLabRanges: linhas inválidas ou vazias são ignoradas', () => {
  const r = PainelCore.parseLabRanges('Hb: 12-17\n\nsó texto\nK: alto\nNa: 135-145');
  assert.deepStrictEqual(Object.keys(r).sort(), ['hb', 'na']);
});

test('classifyLab: alto, baixo, normal, sem faixa e sem número', () => {
  const ranges = PainelCore.parseLabRanges('Hb: 12-17\nPCR: 0-5');
  assert.strictEqual(PainelCore.classifyLab('Hb', '9,5', ranges), 'low');
  assert.strictEqual(PainelCore.classifyLab('hb', '18', ranges), 'high');
  assert.strictEqual(PainelCore.classifyLab('Hb', '14', ranges), null);
  assert.strictEqual(PainelCore.classifyLab('PCR', '80', ranges), 'high');
  assert.strictEqual(PainelCore.classifyLab('FAN', '1/320', ranges), null);
  assert.strictEqual(PainelCore.classifyLab('Hb', 'aguardando', ranges), null);
});

test('faixas padrão: existem, parseiam e cobrem os exames fixados de fábrica', () => {
  const ranges = PainelCore.parseLabRanges(PainelCore.DEFAULT_LAB_RANGES_TEXT);
  ['hb', 'cr', 'k', 'pcr', 'leucócitos', 'plaquetas'].forEach(name => {
    assert.ok(ranges[name], `faixa padrão ausente: ${name}`);
  });
});

test('estado: labRangesText nasce com o padrão e sobrevive à migração', () => {
  assert.ok(typeof PainelCore.DEFAULT_LAB_RANGES_TEXT === 'string' && PainelCore.DEFAULT_LAB_RANGES_TEXT.length > 0);
  assert.strictEqual(PainelCore.defaultState('2026-08-27').labRangesText, PainelCore.DEFAULT_LAB_RANGES_TEXT);
  const migrated = PainelCore.migrateState({ beds: [] }, '2026-08-27');
  assert.strictEqual(migrated.labRangesText, PainelCore.DEFAULT_LAB_RANGES_TEXT);
  const custom = PainelCore.migrateState({ beds: [], labRangesText: 'Hb: 10-20' }, '2026-08-27');
  assert.strictEqual(custom.labRangesText, 'Hb: 10-20');
});
