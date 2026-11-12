const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// Bug: o leito nasce vazio (sem patientId) e o nome é digitado depois, na mesma sessão.
// Só migrateBed (carga do app) dava id a leito com nome; até recarregar, o push pulava
// o paciente em silêncio e a tela dizia "Sincronizado".

const pulledP1 = () => ({
  patients: [{ id: 'p1', bed_number: '1012-A', initials: 'AB', age: null, admit_date: null, hpp: '', anamnese_inicial: '', discharge_forecast: null, status: 'internado', alergias: '', medicacoes_previas: '' }],
  problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
  notes: [{ patient_id: 'p1', texto: '' }], raw_texts: [], generated_docs: [], evolucoes: [],
});

// Estado como a UI o deixa: um paciente já sincronizado + leitos criados por migrateBed({ bedNumber }).
function sessionState() {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed({ patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga' }),
  ] }, '2026-11-11');
  state.syncedPatientIds = ['p1'];
  state.syncBase = PainelCore.buildSyncBase(state);
  return state;
}
function addBedLikeTheUi(state, bedNumber, typedName) {
  const bed = PainelCore.migrateBed({ bedNumber: bedNumber });
  state.beds.push(bed);
  if (typedName != null) bed.patientName = typedName; // handler de input do nome
  return bed;
}

test('leito criado e nomeado na mesma sessão é enviado na primeira sincronização', () => {
  const state = sessionState();
  const bed = addBedLikeTheUi(state, '2001-C', 'Beltrana Nova Souza');
  assert.strictEqual(bed.patientId, null, 'pré-condição: a UI cria o leito sem id');

  PainelCore.mergeStates(state, pulledP1());
  const payload = PainelCore.buildPushPayload(state);

  assert.match(bed.patientId, /^[0-9a-f-]{36}$/);
  const sent = payload.patients.find(p => p.bed_number === '2001-C');
  assert.ok(sent, 'o paciente novo está no push');
  assert.strictEqual(sent.id, bed.patientId);
  assert.strictEqual(sent.initials, 'BNS');
  assert.deepStrictEqual(payload.notes.map(n => n.patient_id).sort(), ['p1', bed.patientId].sort());
});

test('o id dado na sincronização é estável: a segunda sincronização não duplica o paciente', () => {
  const state = sessionState();
  const bed = addBedLikeTheUi(state, '2001-C', 'Beltrana Nova Souza');
  PainelCore.mergeStates(state, pulledP1());
  const firstId = bed.patientId;
  state.syncBase = PainelCore.buildSyncBase(state);
  state.syncedPatientIds = ['p1', firstId];

  const pulled = pulledP1();
  pulled.patients.push(PainelCore.buildPushPayload(state).patients.find(p => p.id === firstId));
  pulled.notes.push({ patient_id: firstId, texto: '' });
  PainelCore.mergeStates(state, pulled);

  assert.strictEqual(bed.patientId, firstId);
  assert.strictEqual(state.beds.length, 2);
  assert.strictEqual(PainelCore.buildPushPayload(state).patients.length, 2);
});

test('paciente novo entra na foto de sincronização', () => {
  const state = sessionState();
  const bed = addBedLikeTheUi(state, '2001-C', 'Beltrana Nova Souza');
  PainelCore.mergeStates(state, pulledP1());
  assert.ok(PainelCore.buildSyncBase(state)[bed.patientId]);
});

test('leito vazio (sem nome, ou só espaços) continua sem id e fora do push', () => {
  const state = sessionState();
  const empty = addBedLikeTheUi(state, '2002-A');
  const blank = addBedLikeTheUi(state, '2003-A', '   ');
  PainelCore.mergeStates(state, pulledP1());
  assert.strictEqual(empty.patientId, null);
  assert.strictEqual(blank.patientId, null);
  assert.deepStrictEqual(PainelCore.buildPushPayload(state).patients.map(p => p.id), ['p1']);
});

test('pull vazio (anômalo) não impede o leito novo de ganhar id', () => {
  const state = sessionState();
  const bed = addBedLikeTheUi(state, '2001-C', 'Beltrana Nova Souza');
  const pulled = pulledP1();
  pulled.patients = []; pulled.notes = [];
  PainelCore.mergeStates(state, pulled);
  assert.match(bed.patientId, /^[0-9a-f-]{36}$/);
});
