const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

test('movePinnedExam: sobe e desce um passo entre os fixados', () => {
  assert.deepStrictEqual(PainelCore.movePinnedExam(['Hb', 'Cr', 'K'], 'K', -1), ['Hb', 'K', 'Cr']);
  assert.deepStrictEqual(PainelCore.movePinnedExam(['Hb', 'Cr', 'K'], 'Hb', 1), ['Cr', 'Hb', 'K']);
});

test('movePinnedExam: nas pontas ou nome desconhecido, não muda nada', () => {
  assert.deepStrictEqual(PainelCore.movePinnedExam(['Hb', 'Cr'], 'Hb', -1), ['Hb', 'Cr']);
  assert.deepStrictEqual(PainelCore.movePinnedExam(['Hb', 'Cr'], 'Cr', 1), ['Hb', 'Cr']);
  assert.deepStrictEqual(PainelCore.movePinnedExam(['Hb', 'Cr'], 'Na', 1), ['Hb', 'Cr']);
});

test('movePinnedExam: com lista de visíveis, pula os fixados escondidos (uma seta = uma linha da tela)', () => {
  // Cr está fixado mas não aparece na tabela; K sobe direto para antes de Hb.
  const out = PainelCore.movePinnedExam(['Hb', 'Cr', 'K'], 'K', -1, ['hb', 'k', 'ur']);
  assert.deepStrictEqual(out, ['K', 'Hb', 'Cr']);
  // Descer Hb pula Cr e vai para depois de K.
  assert.deepStrictEqual(PainelCore.movePinnedExam(['Hb', 'Cr', 'K'], 'Hb', 1, ['Hb', 'K']), ['Cr', 'K', 'Hb']);
});

test('movePinnedExam: não muta a lista original e compara nomes sem diferenciar maiúsculas', () => {
  const orig = ['Hb', 'Cr'];
  const out = PainelCore.movePinnedExam(orig, 'cr', -1);
  assert.deepStrictEqual(orig, ['Hb', 'Cr']);
  assert.deepStrictEqual(out, ['Cr', 'Hb']);
});
