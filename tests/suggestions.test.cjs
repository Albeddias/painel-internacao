const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

test('filterSuggestions: consulta vazia retorna a lista inteira', () => {
  const list = ['Manter ATB', 'Dieta livre'];
  assert.deepStrictEqual(PainelCore.filterSuggestions(list, ''), list);
  assert.deepStrictEqual(PainelCore.filterSuggestions(list, '   '), list);
  assert.deepStrictEqual(PainelCore.filterSuggestions(list, null), list);
});

test('filterSuggestions: busca por substring sem diferenciar maiúsculas', () => {
  const list = ['Manter ATB', 'Solicitar Labs (Rotina)', 'Dieta livre'];
  assert.deepStrictEqual(PainelCore.filterSuggestions(list, 'atb'), ['Manter ATB']);
  assert.deepStrictEqual(PainelCore.filterSuggestions(list, 'LABS'), ['Solicitar Labs (Rotina)']);
});

test('filterSuggestions: ignora acentos na consulta e na sugestão', () => {
  const list = ['Solicitar avaliação da nutrição', 'Dieta livre'];
  assert.deepStrictEqual(PainelCore.filterSuggestions(list, 'avaliacao'), ['Solicitar avaliação da nutrição']);
  assert.deepStrictEqual(PainelCore.filterSuggestions(list, 'nutrição'), ['Solicitar avaliação da nutrição']);
});

test('filterSuggestions: sem correspondência retorna lista vazia', () => {
  assert.deepStrictEqual(PainelCore.filterSuggestions(['Dieta livre'], 'xyz'), []);
});

test('filterSuggestions: lista nula/indefinida retorna lista vazia', () => {
  assert.deepStrictEqual(PainelCore.filterSuggestions(null, 'a'), []);
  assert.deepStrictEqual(PainelCore.filterSuggestions(undefined, ''), []);
});

test('filterSuggestions: não modifica a lista original', () => {
  const list = ['B', 'A'];
  PainelCore.filterSuggestions(list, '');
  assert.deepStrictEqual(list, ['B', 'A']);
});
