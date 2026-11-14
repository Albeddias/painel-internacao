const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// painel_condutas.ordem = posição da conduta na lista do paciente. O pull lê a tabela em
// ordem de chave primária (uuid aleatório): sem a coluna, a lista chegava embaralhada em
// todo aparelho que recebesse o paciente do banco.

function patientRow() {
  return { id: 'p1', bed_number: '1012-A', initials: 'AB', age: 60, admit_date: '2026-11-01', hpp: '',
    anamnese_inicial: '', discharge_forecast: null, status: 'internado', alergias: '', medicacoes_previas: '' };
}
function conduta(id, texto, ordem) {
  const row = { id, patient_id: 'p1', texto, done: false, data: null };
  if (ordem !== undefined) row.ordem = ordem;
  return row;
}
function pull(condutas) {
  return {
    patients: [patientRow()],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas,
    notes: [{ patient_id: 'p1', texto: '' }], raw_texts: [], generated_docs: [], evolucoes: [],
  };
}
function syncedState(condutas) {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed({ patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga', age: 60, admitDate: '2026-11-01', condutas }),
  ] }, '2026-11-14');
  state.syncedPatientIds = ['p1'];
  state.syncBase = PainelCore.buildSyncBase(state);
  return state;
}
const textos = (state) => state.beds[0].condutas.map(c => c.text);

test('buildPushPayload: conduta leva ordem = posição na lista', () => {
  const state = syncedState([
    { id: 'c-z', text: 'Primeira', done: false },
    { id: 'c-a', text: 'Segunda', done: true },
    { id: 'c-m', text: 'Terceira', done: false },
  ]);
  const rows = PainelCore.buildPushPayload(state).condutas;
  assert.deepStrictEqual(rows.map(r => [r.texto, r.ordem]), [['Primeira', 0], ['Segunda', 1], ['Terceira', 2]]);
});

test('applyPull: condutas voltam na ordem gravada, não na ordem em que o banco devolve', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-11-14');
  // O banco devolve em ordem de id (c-a, c-m, c-z):
  PainelCore.applyPull(state, pull([conduta('c-a', 'Segunda', 1), conduta('c-m', 'Terceira', 2), conduta('c-z', 'Primeira', 0)]));
  assert.deepStrictEqual(textos(state), ['Primeira', 'Segunda', 'Terceira']);
});

test('mergeStates: paciente recebido do banco chega com as condutas na ordem gravada', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-11-14');
  PainelCore.mergeStates(state, pull([conduta('c-a', 'Segunda', 1), conduta('c-m', 'Terceira', 2), conduta('c-z', 'Primeira', 0)]));
  assert.deepStrictEqual(textos(state), ['Primeira', 'Segunda', 'Terceira']);
});

test('ida e volta: a ordem do aparelho A chega igual no aparelho B', () => {
  const a = syncedState([
    { id: 'c-z', text: 'Primeira', done: false },
    { id: 'c-a', text: 'Segunda', done: false },
    { id: 'c-m', text: 'Terceira', done: false },
    { id: 'c-b', text: 'Quarta', done: false },
  ]);
  const noBanco = PainelCore.buildPushPayload(a).condutas.slice().sort((x, y) => x.id.localeCompare(y.id)); // ordem de PK
  const b = PainelCore.migrateState({ beds: [] }, '2026-11-14');
  PainelCore.mergeStates(b, pull(noBanco));
  assert.deepStrictEqual(textos(b), ['Primeira', 'Segunda', 'Terceira', 'Quarta']);
});

test('applyPull: conduta sem ordem (linha antiga ou criada sem a coluna) vai para o fim', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-11-14');
  PainelCore.applyPull(state, pull([conduta('c-a', 'Sem ordem', null), conduta('c-m', 'Segunda', 1), conduta('c-z', 'Primeira', 0)]));
  assert.deepStrictEqual(textos(state), ['Primeira', 'Segunda', 'Sem ordem']);
});

test('applyPull: condutas todas sem ordem ficam como vieram (nada a reordenar)', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-11-14');
  PainelCore.applyPull(state, pull([conduta('c-a', 'A'), conduta('c-m', 'M'), conduta('c-z', 'Z')]));
  assert.deepStrictEqual(textos(state), ['A', 'M', 'Z']);
});

test('mergeStates: conduta nova do banco entra na posição da sua ordem', () => {
  const state = syncedState([
    { id: 'c1', text: 'Primeira', done: false },
    { id: 'c2', text: 'Segunda', done: false },
  ]);
  PainelCore.mergeStates(state, pull([conduta('c0', 'Nova no meio', 1), conduta('c1', 'Primeira', 0), conduta('c2', 'Segunda', 2)]));
  assert.deepStrictEqual(textos(state), ['Primeira', 'Nova no meio', 'Segunda']);
});

test('mergeStates: conduta nova do banco sem ordem entra no fim da lista', () => {
  const state = syncedState([
    { id: 'c1', text: 'Primeira', done: false },
    { id: 'c2', text: 'Segunda', done: false },
  ]);
  PainelCore.mergeStates(state, pull([conduta('c0', 'Criada pela IA', null), conduta('c1', 'Primeira', 0), conduta('c2', 'Segunda', 1)]));
  assert.deepStrictEqual(textos(state), ['Primeira', 'Segunda', 'Criada pela IA']);
});

test('mergeStates: a ordem do aparelho prevalece sobre a do banco para condutas que ele já tem', () => {
  const state = syncedState([
    { id: 'c1', text: 'Primeira', done: false },
    { id: 'c2', text: 'Segunda', done: false },
  ]);
  PainelCore.mergeStates(state, pull([conduta('c1', 'Primeira', 1), conduta('c2', 'Segunda', 0)]));
  assert.deepStrictEqual(textos(state), ['Primeira', 'Segunda']);
  assert.deepStrictEqual(PainelCore.buildPushPayload(state).condutas.map(r => r.ordem), [0, 1]);
});
