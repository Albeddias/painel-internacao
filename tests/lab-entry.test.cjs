const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

test('parseLabText: aceita "Nome: valor", "Nome = valor" e "Nome valor"; ignora o resto', () => {
  const r = PainelCore.parseLabText('Hb: 9.5\nUr = 28\nCr 1,1\n\nPlaq: 120k\nsó texto\n');
  assert.deepStrictEqual(r.results, [
    { name: 'Hb', value: '9.5' }, { name: 'Ur', value: '28' }, { name: 'Cr', value: '1,1' }, { name: 'Plaq', value: '120k' },
  ]);
  assert.deepStrictEqual(r.ignored, ['só texto']);
});

test('parseLabText: texto vazio ou nulo', () => {
  assert.deepStrictEqual(PainelCore.parseLabText(''), { results: [], ignored: [] });
  assert.deepStrictEqual(PainelCore.parseLabText(null), { results: [], ignored: [] });
});

function fixture() {
  return [
    { id: 'img', type: 'image', date: '2026-09-01', name: 'RX', summary: 'ok' },
    { id: 'lab1', type: 'lab', date: '2026-09-01', results: [{ name: 'Hb', value: '9.5' }, { name: 'Cr', value: '1.1' }, { name: 'K', value: '4.0' }] },
  ];
}

test('applyLabEntry (adicionar): data nova cria coleta com id', () => {
  const exams = fixture();
  const entry = PainelCore.applyLabEntry(exams, '2026-09-02', [{ name: 'Hb', value: '10' }]);
  assert.strictEqual(exams.length, 3);
  assert.strictEqual(entry.type, 'lab');
  assert.strictEqual(entry.date, '2026-09-02');
  assert.ok(entry.id);
  assert.deepStrictEqual(entry.results, [{ name: 'Hb', value: '10' }]);
});

test('applyLabEntry (adicionar): mesma data mescla por nome (case-insensitive) e mantém os demais', () => {
  const exams = fixture();
  const entry = PainelCore.applyLabEntry(exams, '2026-09-01', [{ name: 'hb', value: '8.0' }, { name: 'Na', value: '138' }]);
  assert.strictEqual(exams.length, 2);
  assert.strictEqual(entry.id, 'lab1');
  assert.deepStrictEqual(entry.results, [
    { name: 'Hb', value: '8.0' }, { name: 'Cr', value: '1.1' }, { name: 'K', value: '4.0' }, { name: 'Na', value: '138' },
  ]);
});

test('applyLabEntry (editar): a lista vira exatamente o que foi digitado — linha apagada some', () => {
  const exams = fixture();
  const entry = PainelCore.applyLabEntry(exams, '2026-09-01', [{ name: 'Hb', value: '9.5' }, { name: 'K', value: '4.0' }], { editDate: '2026-09-01' });
  assert.strictEqual(exams.length, 2);
  assert.strictEqual(entry.id, 'lab1');
  assert.deepStrictEqual(entry.results, [{ name: 'Hb', value: '9.5' }, { name: 'K', value: '4.0' }]);
});

test('applyLabEntry (editar): mudar a data move a coleta', () => {
  const exams = fixture();
  const entry = PainelCore.applyLabEntry(exams, '2026-09-03', [{ name: 'Hb', value: '9.5' }], { editDate: '2026-09-01' });
  assert.strictEqual(exams.filter(e => e.type === 'lab').length, 1);
  assert.strictEqual(entry.id, 'lab1');
  assert.strictEqual(entry.date, '2026-09-03');
  assert.deepStrictEqual(entry.results, [{ name: 'Hb', value: '9.5' }]);
});

test('applyLabEntry (editar): mover para data que já tem coleta funde na existente', () => {
  const exams = fixture();
  exams.push({ id: 'lab2', type: 'lab', date: '2026-09-02', results: [{ name: 'Hb', value: '10' }, { name: 'PCR', value: '30' }] });
  const entry = PainelCore.applyLabEntry(exams, '2026-09-02', [{ name: 'Hb', value: '9.5' }, { name: 'K', value: '4.0' }], { editDate: '2026-09-01' });
  assert.deepStrictEqual(exams.filter(e => e.type === 'lab').map(e => e.id), ['lab2']);
  assert.strictEqual(entry.id, 'lab2');
  assert.deepStrictEqual(entry.results, [{ name: 'Hb', value: '9.5' }, { name: 'PCR', value: '30' }, { name: 'K', value: '4.0' }]);
});

test('applyLabEntry (editar): lista vazia apaga a coleta', () => {
  const exams = fixture();
  const entry = PainelCore.applyLabEntry(exams, '2026-09-01', [], { editDate: '2026-09-01' });
  assert.strictEqual(entry, null);
  assert.deepStrictEqual(exams.map(e => e.id), ['img']);
});

test('applyLabEntry (adicionar): lista vazia não cria nada', () => {
  const exams = fixture();
  assert.strictEqual(PainelCore.applyLabEntry(exams, '2026-09-05', []), null);
  assert.strictEqual(exams.length, 2);
});
