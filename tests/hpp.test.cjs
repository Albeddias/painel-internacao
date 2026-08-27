'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseHpp, joinHpp } = require('../painel-core.js');

test('parseHpp: separa por vírgula', () => {
  assert.deepStrictEqual(parseHpp('HAS, DM2'), ['HAS', 'DM2']);
});

test('parseHpp: vazio/nulo vira lista vazia', () => {
  assert.deepStrictEqual(parseHpp(''), []);
  assert.deepStrictEqual(parseHpp(null), []);
  assert.deepStrictEqual(parseHpp(undefined), []);
  assert.deepStrictEqual(parseHpp('   '), []);
});

test('parseHpp: separa por ponto e vírgula e quebra de linha', () => {
  assert.deepStrictEqual(parseHpp('HAS; DM2\nDPOC'), ['HAS', 'DM2', 'DPOC']);
});

test('parseHpp: vírgula dentro de parênteses não separa', () => {
  assert.deepStrictEqual(
    parseHpp('DM2 (insulina NPH, metformina), HAS'),
    ['DM2 (insulina NPH, metformina)', 'HAS']
  );
});

test('parseHpp: apara espaços e ignora itens vazios', () => {
  assert.deepStrictEqual(parseHpp(' HAS ,, DM2 , '), ['HAS', 'DM2']);
});

test('joinHpp: junta com vírgula e espaço', () => {
  assert.strictEqual(joinHpp(['HAS', 'DM2']), 'HAS, DM2');
  assert.strictEqual(joinHpp([]), '');
});

test('joinHpp: apara e ignora itens vazios', () => {
  assert.strictEqual(joinHpp([' HAS ', '', 'DM2']), 'HAS, DM2');
});

test('parseHpp/joinHpp: ida e volta é estável', () => {
  const txt = 'HAS, DM2 (insulina NPH, metformina), DPOC';
  assert.strictEqual(joinHpp(parseHpp(txt)), txt);
});
