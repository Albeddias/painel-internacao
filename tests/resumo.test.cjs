const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

const TODAY = '2026-08-27';
const PINNED = ['Hb', 'Cr', 'PCR'];

test('labNumber: decimais com vírgula e ponto', () => {
  assert.strictEqual(PainelCore.labNumber('9,5'), 9.5);
  assert.strictEqual(PainelCore.labNumber('9.5'), 9.5);
  assert.strictEqual(PainelCore.labNumber('1.1'), 1.1);
});

test('labNumber: ponto de milhar brasileiro e sufixo k', () => {
  assert.strictEqual(PainelCore.labNumber('12.300'), 12300);
  assert.strictEqual(PainelCore.labNumber('354.000'), 354000);
  assert.strictEqual(PainelCore.labNumber('120k'), 120000);
});

test('labNumber: comparadores e texto sem número', () => {
  assert.strictEqual(PainelCore.labNumber('<1,0'), 1);
  assert.strictEqual(PainelCore.labNumber('negativo'), null);
  assert.strictEqual(PainelCore.labNumber(''), null);
  assert.strictEqual(PainelCore.labNumber(null), null);
});

test('buildLabsLine: última coleta, fixados primeiro, com tendência vs coleta anterior', () => {
  const bed = { exams: [
    { type: 'lab', date: '2026-08-25', results: [{ name: 'Hb', value: '10,2' }, { name: 'PCR', value: '120' }] },
    { type: 'lab', date: '2026-08-26', results: [{ name: 'K', value: '4,1' }, { name: 'Hb', value: '9,5' }, { name: 'PCR', value: '80' }] },
    { type: 'image', date: '2026-08-26', name: 'TC', summary: 'x' },
  ] };
  assert.strictEqual(
    PainelCore.buildLabsLine(bed, PINNED),
    'Labs 26/08: Hb 9,5 ▼ | PCR 80 ▼ | K 4,1'
  );
});

test('buildLabsLine: sem labs retorna vazio; sem coleta anterior não há setas', () => {
  assert.strictEqual(PainelCore.buildLabsLine({ exams: [] }, PINNED), '');
  const bed = { exams: [{ type: 'lab', date: '2026-08-26', results: [{ name: 'Hb', value: '9,5' }] }] };
  assert.strictEqual(PainelCore.buildLabsLine(bed, PINNED), 'Labs 26/08: Hb 9,5');
});

test('buildDailySummary: paciente completo', () => {
  const bed = {
    bedNumber: '1012-A', patientName: 'Ana Braga', age: 60, admitDate: '2026-08-20',
    problems: [
      { id: 'p1', descricao: 'PNM aspirativa', status: 'ativo', plano: 'desmame de O2' },
      { id: 'p2', descricao: 'DM2', status: 'cronico', plano: '' },
      { id: 'p3', descricao: 'IRA KDIGO 1', status: 'ativo', plano: '' },
      { id: 'p4', descricao: 'Dor torácica', status: 'resolvido', plano: '' },
    ],
    trackers: [
      { id: 't1', type: 'atb', name: 'Pipe-tazo', startDate: '2026-08-23', duration: 7 },
      { id: 't2', type: 'atb', name: 'Vanco', startDate: '2026-08-20', endDate: '2026-08-25' },
      { id: 't3', type: 'device', name: 'CVC', installDate: '2026-08-24' },
      { id: 't4', type: 'device', kind: 'procedimento', name: 'LE', installDate: '2026-08-23' },
      { id: 't5', type: 'device', name: 'SVD', installDate: '2026-08-20', removalDate: '2026-08-24' },
      { id: 't6', type: 'culture', name: 'HMC', collectionDate: '2026-08-24', result: 'Aguardando' },
    ],
    exams: [
      { type: 'lab', date: '2026-08-26', results: [{ name: 'Hb', value: '9,5' }] },
    ],
  };
  assert.strictEqual(
    PainelCore.buildDailySummary(bed, { todayStr: TODAY, pinnedExams: PINNED }),
    [
      'Leito 1012-A — Ana Braga, 60a, DIH D8',
      'Problemas: 1. PNM aspirativa — desmame de O2; 2. IRA KDIGO 1',
      'ATB: Pipe-tazo D5/7 (D1 23/08); Vanco suspenso 25/08 (D6)',
      'Disp: CVC — D4; LE — PO D5',
      'Culturas: HMC 24/08 — Aguardando',
      'Labs 26/08: Hb 9,5',
    ].join('\n')
  );
});

test('buildDailySummary: seções vazias somem e cabeçalho tolera campos faltando', () => {
  const bed = { bedNumber: '', patientName: 'Zé', age: '', admitDate: '', problems: [], trackers: [], exams: [] };
  assert.strictEqual(
    PainelCore.buildDailySummary(bed, { todayStr: TODAY, pinnedExams: PINNED }),
    'Leito — — Zé'
  );
});
