const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

const TODAY = '2026-08-27';

function bed(patch) {
  return Object.assign({
    patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga',
    isArchived: false, externalDoctor: { active: false, name: '' },
    trackers: [], dischargeForecast: '', reminderDate: '',
  }, patch || {});
}

function pend(beds) {
  return PainelCore.buildPendencias({ beds: beds }, TODAY);
}

test('dayNumber: D1 no dia, futuro = 0, sem data = null', () => {
  assert.strictEqual(PainelCore.dayNumber('2026-08-27', TODAY), 1);
  assert.strictEqual(PainelCore.dayNumber('2026-08-21', TODAY), 7);
  assert.strictEqual(PainelCore.dayNumber('2026-08-28', TODAY), 0);
  assert.strictEqual(PainelCore.dayNumber('', TODAY), null);
  assert.strictEqual(PainelCore.dayNumber(null, TODAY), null);
});

test('pendências: ATB no último dia', () => {
  const out = pend([bed({ trackers: [{ id: 't1', type: 'atb', name: 'Pipe-tazo', startDate: '2026-08-21', duration: 7 }] })]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'atb');
  assert.strictEqual(out[0].bedIndex, 0);
  assert.strictEqual(out[0].bedNumber, '1012-A');
  assert.strictEqual(out[0].label, 'ATB Pipe-tazo: último dia (D7/7)');
});

test('pendências: ATB com prazo vencido', () => {
  const out = pend([bed({ trackers: [{ id: 't1', type: 'atb', name: 'Cefepime', startDate: '2026-08-20', duration: 7 }] })]);
  assert.strictEqual(out[0].label, 'ATB Cefepime: prazo vencido (D8/7)');
});

test('pendências: ATB suspenso ou dentro do prazo não gera pendência', () => {
  const out = pend([bed({ trackers: [
    { id: 't1', type: 'atb', name: 'Cefepime', startDate: '2026-08-20', duration: 7, endDate: '2026-08-26' },
    { id: 't2', type: 'atb', name: 'Vanco', startDate: '2026-08-25', duration: 7 },
  ] })]);
  assert.strictEqual(out.length, 0);
});

test('pendências: cultura sem resultado há 3+ dias', () => {
  const out = pend([bed({ trackers: [
    { id: 't1', type: 'culture', name: 'HMC', collectionDate: '2026-08-24', result: 'Aguardando' },
    { id: 't2', type: 'culture', name: 'URC', collectionDate: '2026-08-24', result: 'Negativa final' },
    { id: 't3', type: 'culture', name: 'HMC2', collectionDate: '2026-08-26', result: '' },
  ] })]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'cultura');
  assert.strictEqual(out[0].label, 'Cultura HMC: sem resultado (D4)');
});

test('pendências: dispositivo 7+ dias sem retirada; removido ou procedimento não contam', () => {
  const out = pend([bed({ trackers: [
    { id: 't1', type: 'device', name: 'CVC', installDate: '2026-08-21' },
    { id: 't2', type: 'device', name: 'SVD', installDate: '2026-08-10', removalDate: '2026-08-20' },
    { id: 't3', type: 'device', kind: 'procedimento', name: 'LE', installDate: '2026-08-10' },
  ] })]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'dispositivo');
  assert.strictEqual(out[0].label, 'CVC: D7, avaliar retirada');
});

test('pendências: alta prevista hoje e atrasada', () => {
  const out = pend([
    bed({ dischargeForecast: '2026-08-27' }),
    bed({ bedNumber: '1013-B', dischargeForecast: '2026-08-25' }),
    bed({ bedNumber: '1014-C', dischargeForecast: '2026-08-30' }),
  ]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].label, 'Alta prevista hoje');
  assert.strictEqual(out[1].label, 'Alta prevista atrasada (25/08)');
  assert.strictEqual(out[1].tipo, 'alta');
});

test('pendências: lembrete ativo', () => {
  const out = pend([bed({ reminderDate: '2026-08-27' }), bed({ bedNumber: '1013-B', reminderDate: '2026-08-30' })]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'lembrete');
  assert.strictEqual(out[0].label, 'Lembrete para hoje');
});

test('pendências: ignora arquivados, leitos vazios e médico externo', () => {
  const tr = [{ id: 't1', type: 'device', name: 'CVC', installDate: '2026-08-10' }];
  const out = pend([
    bed({ isArchived: true, trackers: tr }),
    bed({ patientName: '', trackers: tr }),
    bed({ externalDoctor: { active: true, name: 'Dr. X' }, trackers: tr }),
  ]);
  assert.strictEqual(out.length, 0);
});

test('pendências: bedIndex aponta para o leito original mesmo com leitos pulados', () => {
  const out = pend([
    bed({ isArchived: true }),
    bed({ bedNumber: '1013-B', reminderDate: '2026-08-27' }),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].bedIndex, 1);
  assert.strictEqual(out[0].bedNumber, '1013-B');
});

test('pendências: gravidade e rótulo curto de cada tipo', () => {
  const out = pend([bed({
    trackers: [
      { id: 'a', type: 'atb', name: 'Cefepime', startDate: '2026-08-20', duration: 7 },
      { id: 'b', type: 'atb', name: 'Pipe-tazo', startDate: '2026-08-21', duration: 7 },
      { id: 'c', type: 'culture', name: 'HMC', collectionDate: '2026-08-24', result: 'Aguardando' },
      { id: 'd', type: 'device', name: 'CVC Subclávia D', installDate: '2026-08-19' },
    ],
    dischargeForecast: '2026-08-25', reminderDate: '2026-08-27',
  })]);
  assert.deepStrictEqual(out.map((p) => [p.tipo, p.gravidade, p.curto]), [
    ['atb', 'alerta', 'ATB D8/7'], ['atb', 'atencao', 'ATB D7/7'], ['cultura', 'atencao', 'Cultura D4'],
    ['dispositivo', 'atencao', 'CVC D9'], ['alta', 'alerta', 'Alta atrasada'], ['lembrete', 'atencao', 'Lembrete'],
  ]);
});

test('pendências: alta de hoje é info; dispositivo de nome longo ou sem nome', () => {
  assert.deepStrictEqual(pend([bed({ dischargeForecast: TODAY })]).map((p) => [p.gravidade, p.curto]), [['info', 'Alta hoje']]);
  const disp = (name) => pend([bed({ trackers: [{ id: 'd', type: 'device', name: name, installDate: '2026-08-20' }] })])[0].curto;
  assert.strictEqual(disp('Traqueostomia'), 'Traqueos D8');
  assert.strictEqual(disp(''), 'Disp D8');
  assert.strictEqual(disp('   '), 'Disp D8');
});

test('agruparPendencias: uma entrada por leito, a mais grave primeiro', () => {
  const g = PainelCore.agruparPendencias(pend([
    bed({ bedNumber: '1010', dischargeForecast: TODAY }),
    bed({ bedNumber: '1013', reminderDate: TODAY }),
    bed({ bedNumber: '1012-A', reminderDate: TODAY, dischargeForecast: '2026-08-25' }),
    bed({ bedNumber: '1011', reminderDate: TODAY }),
  ]));
  assert.deepStrictEqual(g.map((x) => [x.bedNumber, x.gravidadeMax, x.itens.length]),
    [['1012-A', 'alerta', 2], ['1011', 'atencao', 1], ['1013', 'atencao', 1], ['1010', 'info', 1]]);
  assert.deepStrictEqual(g[0].itens.map((i) => i.gravidade), ['alerta', 'atencao'], 'dentro do leito, por gravidade');
  assert.strictEqual(g[0].bedIndex, 2);
  assert.deepStrictEqual(PainelCore.agruparPendencias([]), []);
});
