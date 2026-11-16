const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// O nome completo só existe no aparelho onde foi digitado; os outros recebem o paciente com
// as iniciais ("AB") no lugar do nome. Esse aparelho NÃO sabe o nome: deve devolver ao banco
// as mesmas iniciais, nunca recalculá-las a partir de "AB" (o que dava "A" — e o aparelho
// seguinte recebia o paciente com uma letra só).

function row(over) {
  return Object.assign({
    id: 'p1', bed_number: '1012-A', initials: 'AB', age: null, admit_date: null, hpp: '', anamnese_inicial: '',
    discharge_forecast: null, status: 'internado', alergias: '', medicacoes_previas: '', person_id: null,
    discharge_date: null, queda_orientada: false,
  }, over || {});
}
function pulled(rows) {
  return {
    patients: rows,
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
    notes: [], raw_texts: [], generated_docs: [], evolucoes: [],
  };
}
const empty = () => PainelCore.migrateState({ beds: [] }, '2026-11-15');
function withBed(bedOver) {
  const state = PainelCore.migrateState({ beds: [
    Object.assign(PainelCore.migrateBed({ patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga' }), bedOver || {}),
  ] }, '2026-11-15');
  state.syncedPatientIds = ['p1'];
  state.syncBase = PainelCore.buildSyncBase(state);
  return state;
}
const pushed = (state, id) => PainelCore.buildPushPayload(state).patients.find(p => p.id === (id || 'p1')).initials;
// Leito como as versões anteriores gravavam: sem a marca de "nome = iniciais".
function legacy(name) {
  const state = withBed({ patientName: name });
  delete state.beds[0].initialsPlaceholder;
  return state;
}

test('aparelho que recebe o paciente do banco devolve as mesmas iniciais', () => {
  const state = empty();
  PainelCore.mergeStates(state, pulled([row()]));
  assert.strictEqual(state.beds[0].patientName, 'AB');
  assert.strictEqual(pushed(state), 'AB');
});

test('três aparelhos em cadeia: as iniciais não encolhem', () => {
  // celular (tem o nome) -> computador 1 -> computador 2
  const db = { initials: PainelCore.buildPushPayload(withBed()).patients[0].initials };
  assert.strictEqual(db.initials, 'AB');
  const pc1 = empty();
  PainelCore.mergeStates(pc1, pulled([row({ initials: db.initials })]));
  db.initials = pushed(pc1);
  const pc2 = empty();
  PainelCore.mergeStates(pc2, pulled([row({ initials: db.initials })]));
  assert.strictEqual(pc2.beds[0].patientName, 'AB');
  assert.strictEqual(pushed(pc2), 'AB');
});

test('aparelho sem o nome acompanha as iniciais do banco quando elas mudam', () => {
  const state = empty();
  PainelCore.mergeStates(state, pulled([row()]));
  PainelCore.mergeStates(state, pulled([row({ initials: 'ABS' })]));
  assert.strictEqual(state.beds[0].patientName, 'ABS');
  assert.strictEqual(pushed(state), 'ABS');
});

test('digitar o nome completo no aparelho que só tinha as iniciais passa a valer', () => {
  const state = empty();
  PainelCore.mergeStates(state, pulled([row()]));
  state.beds[0].patientName = 'Ana Braga Souza';
  assert.strictEqual(pushed(state), 'ABS');
  PainelCore.mergeStates(state, pulled([row({ initials: 'AB' })]));
  assert.strictEqual(state.beds[0].patientName, 'Ana Braga Souza', 'o banco nunca troca um nome digitado');
  assert.strictEqual(pushed(state), 'ABS');
});

test('aparelho com o nome completo ignora iniciais diferentes no banco e as corrige', () => {
  const state = withBed();
  PainelCore.mergeStates(state, pulled([row({ initials: 'A' })]));
  assert.strictEqual(state.beds[0].patientName, 'Ana Braga');
  assert.strictEqual(pushed(state), 'AB');
});

test('leito antigo com "AB" e banco encolhido para "A": mantém "AB" e conserta o banco', () => {
  const state = legacy('AB');
  PainelCore.mergeStates(state, pulled([row({ initials: 'A' })]));
  assert.strictEqual(state.beds[0].patientName, 'AB');
  assert.strictEqual(pushed(state), 'AB');
});

test('leito antigo que ficou só com "A": recupera as iniciais do banco', () => {
  const state = legacy('A');
  PainelCore.mergeStates(state, pulled([row({ initials: 'AB' })]));
  assert.strictEqual(state.beds[0].patientName, 'AB');
  assert.strictEqual(pushed(state), 'AB');
});

test('leito antigo com "AB" igual ao banco: devolve "AB"', () => {
  const state = legacy('AB');
  PainelCore.mergeStates(state, pulled([row()]));
  assert.strictEqual(pushed(state), 'AB');
});

test('leito antigo com nome completo: nada muda, e o nome não vira "iniciais" depois', () => {
  const state = legacy('Ana Braga');
  PainelCore.mergeStates(state, pulled([row({ initials: 'A' })]));
  assert.strictEqual(state.beds[0].patientName, 'Ana Braga');
  assert.strictEqual(pushed(state), 'AB');
  PainelCore.mergeStates(state, pulled([row({ initials: 'XY' })]));
  assert.strictEqual(state.beds[0].patientName, 'Ana Braga');
});

test('leito antigo com nome curto sem relação com as iniciais do banco não é tratado como iniciais', () => {
  const state = legacy('LIA');
  PainelCore.mergeStates(state, pulled([row({ initials: 'AB' })]));
  assert.strictEqual(state.beds[0].patientName, 'LIA');
  assert.strictEqual(pushed(state), 'L');
});

test('nome nunca é enviado: leito com nome completo manda só as iniciais', () => {
  assert.strictEqual(pushed(withBed({ patientName: 'Maria da Silva Souza' })), 'MSS');
});

test('applyPull ("Resetar e receber"): leito reconstruído devolve as iniciais do banco', () => {
  const state = empty();
  PainelCore.applyPull(state, pulled([row()]));
  assert.strictEqual(state.beds[0].patientName, 'AB');
  assert.strictEqual(pushed(state), 'AB');
});

test('migrateBed: preserva a marca; leito antigo continua sem ela até a próxima sincronização', () => {
  assert.strictEqual(PainelCore.migrateBed({ patientName: 'AB', initialsPlaceholder: 'AB' }).initialsPlaceholder, 'AB');
  assert.strictEqual(PainelCore.migrateBed({ patientName: 'Ana Braga', initialsPlaceholder: '' }).initialsPlaceholder, '');
  assert.strictEqual(PainelCore.migrateBed({ patientName: 'AB' }).initialsPlaceholder, undefined);
});

test('knownPatientName / bedInitials: nome de verdade x iniciais no lugar do nome', () => {
  const real = PainelCore.migrateBed({ patientName: 'Ana Braga', initialsPlaceholder: '' });
  const ph = PainelCore.migrateBed({ patientName: 'AB', initialsPlaceholder: 'AB' });
  assert.strictEqual(PainelCore.knownPatientName(real), 'Ana Braga');
  assert.strictEqual(PainelCore.bedInitials(real), 'AB');
  assert.strictEqual(PainelCore.knownPatientName(ph), '');
  assert.strictEqual(PainelCore.bedInitials(ph), 'AB');
});

test('reinternar a partir de um leito só com iniciais: a internação nova também devolve "AB"', () => {
  const state = empty();
  PainelCore.mergeStates(state, pulled([row()]));
  const { newBed } = PainelCore.buildReadmission(state.beds[0], '2001-B', '2026-11-15');
  state.beds.push(newBed);
  assert.strictEqual(pushed(state, newBed.patientId), 'AB');
});

test('guardar na nuvem: leito só com iniciais não grava as iniciais como "nome" no registro local', () => {
  const state = empty();
  PainelCore.mergeStates(state, pulled([row()]));
  state.syncBase = PainelCore.buildSyncBase(state);
  PainelCore.mergeStates(state, pulled([row({ status: 'nuvem' })]));
  assert.strictEqual(state.beds.length, 0);
  assert.strictEqual(state.cloudArchived.p1.nome, '');
  assert.strictEqual(state.cloudArchived.p1.iniciais, 'AB');
});

test('restaurar da nuvem com registro antigo (iniciais gravadas como nome): devolve "AB"', () => {
  const state = empty();
  state.cloudArchived = { p1: { nome: 'AB', iniciais: 'A', leito: '1012-A', personId: null } };
  PainelCore.mergeStates(state, pulled([row({ initials: 'A' })]));
  assert.strictEqual(state.beds[0].patientName, 'AB');
  assert.strictEqual(pushed(state), 'AB');
});

test('restaurar da nuvem com o nome completo guardado: volta o nome, e as iniciais saem dele', () => {
  const state = empty();
  state.cloudArchived = { p1: { nome: 'Ana Braga', iniciais: 'AB', leito: '1012-A', personId: null } };
  PainelCore.mergeStates(state, pulled([row({ initials: 'A' })]));
  assert.strictEqual(state.beds[0].patientName, 'Ana Braga');
  assert.strictEqual(pushed(state), 'AB');
});

test('reinternação feita em outro aparelho: empresta o nome de quem tem nome, não de quem só tem iniciais', () => {
  const state = empty();
  PainelCore.mergeStates(state, pulled([row({ person_id: 'p1' })]));          // este aparelho só tem "AB"
  PainelCore.mergeStates(state, pulled([row({ person_id: 'p1' }), row({ id: 'p2', person_id: 'p1', bed_number: '2001-B', initials: 'ABS' })]));
  const nova = state.beds.find(b => b.patientId === 'p2');
  assert.strictEqual(nova.patientName, 'ABS', 'usa as iniciais da própria internação');
  assert.strictEqual(pushed(state, 'p2'), 'ABS');
});
