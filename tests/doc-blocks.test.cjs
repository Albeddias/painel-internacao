const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

test('parseDocBlocks: texto sem marcadores devolve null (sumário antigo segue como está)', () => {
  assert.strictEqual(PainelCore.parseDocBlocks('SUMÁRIO DE ALTA\n\nPaciente: [NOME]\nIdade: 60'), null);
  assert.strictEqual(PainelCore.parseDocBlocks(''), null);
  assert.strictEqual(PainelCore.parseDocBlocks(null), null);
});

test('parseDocBlocks: separa os blocos pelo título "=== ... ==="', () => {
  const text = [
    '=== DIAGNÓSTICOS ===',
    '1. PNM',
    '2. HAS',
    '',
    '=== HISTÓRIA DA INTERNAÇÃO ===',
    'Admitido com febre.',
  ].join('\n');
  assert.deepStrictEqual(PainelCore.parseDocBlocks(text), [
    { title: 'DIAGNÓSTICOS', content: '1. PNM\n2. HAS', conferir: false },
    { title: 'HISTÓRIA DA INTERNAÇÃO', content: 'Admitido com febre.', conferir: false },
  ]);
});

test('parseDocBlocks: marca o bloco PARA CONFERIR', () => {
  const blocks = PainelCore.parseDocBlocks('=== PLANO ===\nRetorno em 7 dias.\n=== PARA CONFERIR (NÃO COLAR NO PRONTUÁRIO) ===\n- Dose da varfarina');
  assert.deepStrictEqual(blocks.map(b => b.conferir), [false, true]);
  assert.strictEqual(blocks[1].title, 'PARA CONFERIR (NÃO COLAR NO PRONTUÁRIO)');
  assert.strictEqual(blocks[1].content, '- Dose da varfarina');
});

test('parseDocBlocks: preserva quebras de linha internas e apara só as bordas do conteúdo', () => {
  const blocks = PainelCore.parseDocBlocks('=== EVOLUÇÃO ===\n\n\nLinha 1\n\n  Linha 3 recuada\n\n\n=== FIM ===\n');
  assert.strictEqual(blocks[0].content, 'Linha 1\n\n  Linha 3 recuada');
  assert.strictEqual(blocks[1].content, '');
});

test('parseDocBlocks: texto antes do primeiro marcador vira bloco sem título', () => {
  const blocks = PainelCore.parseDocBlocks('Sumário de [NOME]\n=== PLANO ===\nRetorno.');
  assert.deepStrictEqual(blocks, [
    { title: '', content: 'Sumário de [NOME]', conferir: false },
    { title: 'PLANO', content: 'Retorno.', conferir: false },
  ]);
});

test('parseDocBlocks: aceita \\r\\n e espaços em volta do marcador', () => {
  const blocks = PainelCore.parseDocBlocks('  ===  PLANO  ===  \r\nRetorno.\r\n');
  assert.deepStrictEqual(blocks, [{ title: 'PLANO', content: 'Retorno.', conferir: false }]);
});

test('parseDocBlocks: "===" no meio de uma linha não é marcador', () => {
  assert.strictEqual(PainelCore.parseDocBlocks('pH === 7,40 === ok no gás\noutra linha'), null);
});
