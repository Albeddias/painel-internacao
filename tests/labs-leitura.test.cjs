const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// Leitura de resultados de laboratório: número, texto colado e faixas de referência.

test('labNumber: "0.xxx" é decimal, não milhar', () => {
  assert.strictEqual(PainelCore.labNumber('0.034'), 0.034);
  assert.strictEqual(PainelCore.labNumber('0.500'), 0.5);
  assert.strictEqual(PainelCore.labNumber('<0.012'), 0.012);
  assert.strictEqual(PainelCore.labNumber('-0.250'), -0.25);
});

test('labNumber: milhar brasileiro continua valendo fora do "0.xxx"', () => {
  assert.strictEqual(PainelCore.labNumber('7.350'), 7350);
  assert.strictEqual(PainelCore.labNumber('10.034'), 10034);
  assert.strictEqual(PainelCore.labNumber('1.250.000'), 1250000);
});

test('labNumber: valor negativo, inclusive com o sinal tipográfico (−)', () => {
  assert.strictEqual(PainelCore.labNumber('-2,5'), -2.5);
  assert.strictEqual(PainelCore.labNumber('−2,5'), -2.5);
});

test('parseLabText: "Nome valor" aceita valor negativo', () => {
  const r = PainelCore.parseLabText('BE -2,5\nBE −3\nLactato 1,8');
  assert.deepStrictEqual(r.results, [
    { name: 'BE', value: '-2,5' }, { name: 'BE', value: '−3' }, { name: 'Lactato', value: '1,8' },
  ]);
  assert.deepStrictEqual(r.ignored, []);
});

test('parseLabText: número com hífen no nome do exame (CA 19-9) fica no nome', () => {
  const r = PainelCore.parseLabText('CA 19-9 35\nCA 15-3 20,5 U/mL\nCA 19-9: 40');
  assert.deepStrictEqual(r.results, [
    { name: 'CA 19-9', value: '35' }, { name: 'CA 15-3', value: '20,5 U/mL' }, { name: 'CA 19-9', value: '40' },
  ]);
});

test('parseLabText: intervalo sozinho continua sendo o valor', () => {
  const r = PainelCore.parseLabText('Hemácias 10-15\nLeucócitos 10-15 por campo\nVitamina B12 350');
  assert.deepStrictEqual(r.results, [
    { name: 'Hemácias', value: '10-15' }, { name: 'Leucócitos', value: '10-15 por campo' }, { name: 'Vitamina B12', value: '350' },
  ]);
});

test('parseLabRanges: mínimo negativo', () => {
  const r = PainelCore.parseLabRanges('BE: -2-2\nBE2: -3 - 3\nX: -5--1\nY: −2,5–2,5');
  assert.deepStrictEqual(r['be'], { min: -2, max: 2 });
  assert.deepStrictEqual(r['be2'], { min: -3, max: 3 });
  assert.deepStrictEqual(r['x'], { min: -5, max: -1 });
  assert.deepStrictEqual(r['y'], { min: -2.5, max: 2.5 });
});

test('parseLabRanges: faixas positivas seguem como antes (com unidade depois, travessão, espaços)', () => {
  const r = PainelCore.parseLabRanges('Hb: 12 - 17 g/dL\nNa: 135–145\nPlaquetas: 150.000-450.000');
  assert.deepStrictEqual(r['hb'], { min: 12, max: 17 });
  assert.deepStrictEqual(r['na'], { min: 135, max: 145 });
  assert.deepStrictEqual(r['plaquetas'], { min: 150000, max: 450000 });
});

test('classifyLab: valor negativo contra faixa com mínimo negativo', () => {
  const ranges = PainelCore.parseLabRanges('BE: -2-2');
  assert.strictEqual(PainelCore.classifyLab('BE', '-6,4', ranges), 'low');
  assert.strictEqual(PainelCore.classifyLab('BE', '-1', ranges), null);
  assert.strictEqual(PainelCore.classifyLab('BE', '3', ranges), 'high');
});
