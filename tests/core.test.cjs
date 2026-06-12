const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

test('initialsFromName: nome completo vira iniciais com pontos', () => {
  assert.strictEqual(PainelCore.initialsFromName('Mariana Silva Dias'), 'M.S.D.');
});

test('initialsFromName: ignora conectivos (de, da, do, das, dos, e)', () => {
  assert.strictEqual(PainelCore.initialsFromName('João de Souza dos Santos'), 'J.S.S.');
});

test('initialsFromName: vazio/nulo vira string vazia', () => {
  assert.strictEqual(PainelCore.initialsFromName(''), '');
  assert.strictEqual(PainelCore.initialsFromName(null), '');
  assert.strictEqual(PainelCore.initialsFromName('   '), '');
});

test('fillPatientName: substitui todas as ocorrências de [NOME]', () => {
  const doc = 'Paciente [NOME], reavaliado. [NOME] recebe alta.';
  assert.strictEqual(
    PainelCore.fillPatientName(doc, 'Carlos Andrade'),
    'Paciente Carlos Andrade, reavaliado. Carlos Andrade recebe alta.'
  );
});

test('fillPatientName: sem nome local, mantém o placeholder', () => {
  assert.strictEqual(PainelCore.fillPatientName('Sr(a). [NOME]', ''), 'Sr(a). [NOME]');
});

test('uuid: gera string no formato uuid', () => {
  assert.match(PainelCore.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
