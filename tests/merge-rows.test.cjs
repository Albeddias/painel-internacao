const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

function e(key, hash, ord, extra) {
  return { key, hash, ord, row: Object.assign({ id: key, v: hash }, extra || {}) };
}
const ids = rows => rows.map(r => r.id);

test('mergeRowSets: adição dos dois lados vira união', () => {
  const out = PainelCore.mergeRowSets([e('L1', 'h1', 0)], [e('R1', 'h2', 0)], {});
  assert.deepStrictEqual(ids(out).sort(), ['L1', 'R1']);
});

test('mergeRowSets: deleção local (na foto, intocada) some do resultado', () => {
  const out = PainelCore.mergeRowSets([], [e('X', 'h1', 0)], { X: 'h1' });
  assert.deepStrictEqual(ids(out), []);
});

test('mergeRowSets: deleção remota (na foto, intocada) some do resultado', () => {
  const out = PainelCore.mergeRowSets([e('X', 'h1', 0)], [], { X: 'h1' });
  assert.deepStrictEqual(ids(out), []);
});

test('mergeRowSets: edição local vence (linha nos dois lados, local difere da foto)', () => {
  const out = PainelCore.mergeRowSets([e('X', 'h-local', 0)], [e('X', 'h-base', 0)], { X: 'h-base' });
  assert.strictEqual(out[0].v, 'h-local');
});

test('mergeRowSets: edição remota vence quando o local está intocado', () => {
  const out = PainelCore.mergeRowSets([e('X', 'h-base', 0)], [e('X', 'h-remoto', 0)], { X: 'h-base' });
  assert.strictEqual(out[0].v, 'h-remoto');
});

test('mergeRowSets: conflito de edição dos dois lados → local vence', () => {
  const out = PainelCore.mergeRowSets([e('X', 'h-local', 0)], [e('X', 'h-remoto', 0)], { X: 'h-base' });
  assert.strictEqual(out[0].v, 'h-local');
});

test('mergeRowSets: edição vence deleção (dos dois lados)', () => {
  const editLocal = PainelCore.mergeRowSets([e('X', 'h-local', 0)], [], { X: 'h-base' });
  assert.deepStrictEqual(ids(editLocal), ['X']);
  const editRemoto = PainelCore.mergeRowSets([], [e('X', 'h-remoto', 0)], { X: 'h-base' });
  assert.deepStrictEqual(ids(editRemoto), ['X']);
});

test('mergeRowSets: sem foto (base null) → união, nada é deletado', () => {
  const out = PainelCore.mergeRowSets([e('L1', 'h1', 0)], [e('R1', 'h2', 0)], null);
  assert.deepStrictEqual(ids(out).sort(), ['L1', 'R1']);
});

test('mergeRowSets: labs por chave de conteúdo (hash vazio) — deleção remota funciona', () => {
  const out = PainelCore.mergeRowSets([e('2026-08-21\\u0001Hb\\u000110', '', 0)], [], { '2026-08-21\\u0001Hb\\u000110': '' });
  assert.deepStrictEqual(out, []);
});

test('mergeRowSets: linhas mantêm ordem local e adotadas entram pela coluna ordem', () => {
  const out = PainelCore.mergeRowSets(
    [e('A', 'h', 0), e('B', 'h', 1)],
    [e('A', 'h', 0), e('B', 'h', 1), e('C', 'h', 1)],
    { A: 'h', B: 'h' });
  assert.deepStrictEqual(ids(out), ['A', 'C', 'B']);
  assert.deepStrictEqual(out.map(r => r.ordem), [0, 1, 2]);
});
