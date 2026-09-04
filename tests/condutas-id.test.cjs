const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// Banco simulado: o push é delete+insert por paciente, então basta substituir as tabelas.
function fakeDb() {
  const db = { patients: [], problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [], prefs: [] };
  return {
    db,
    pull() { return JSON.parse(JSON.stringify(db)); },
    push(p) { ['patients', 'problems', 'antibiotics', 'cultures', 'devices', 'exams', 'condutas', 'notes', 'raw_texts', 'prefs'].forEach(function (t) { db[t] = p[t]; }); },
  };
}

// Mesma sequência do doSync do app: mescla → foto → push.
function sync(state, srv) {
  PainelCore.mergeStates(state, srv.pull());
  const base = PainelCore.buildSyncBase(state);
  srv.push(PainelCore.buildPushPayload(state));
  state.syncBase = base;
}

function stateWithIdlessConduta(text) {
  const state = PainelCore.migrateState({ beds: [{ patientName: 'Fulano de Tal', bedNumber: '1012-A' }] }, '2026-09-04');
  // Conduta criada na sessão sem id (comportamento antigo do app).
  state.beds[0].condutas.push({ text: text, done: false });
  return state;
}

test('conduta sem id: sync, marcar como feita, sync — não duplica e mantém o id do banco', () => {
  const srv = fakeDb();
  const state = stateWithIdlessConduta('Manter ATB');
  sync(state, srv);
  const idNoBanco = srv.db.condutas[0].id;
  assert.ok(idNoBanco, 'push deve gravar a conduta com id');
  assert.strictEqual(state.beds[0].condutas[0].id, idNoBanco, 'o id gravado no banco deve ficar no estado local');

  state.beds[0].condutas[0].done = true;
  sync(state, srv);

  assert.deepStrictEqual(srv.db.condutas.map(function (c) { return c.texto + '/' + c.done; }), ['Manter ATB/true']);
  assert.deepStrictEqual(state.beds[0].condutas.map(function (c) { return c.text + '/' + c.done; }), ['Manter ATB/true']);
});

test('conduta sem id: sync, recarregar o app (migrateState), sync — não duplica', () => {
  const srv = fakeDb();
  let state = stateWithIdlessConduta('Dieta livre');
  sync(state, srv);
  state = PainelCore.migrateState(JSON.parse(JSON.stringify(state)), '2026-09-04');
  sync(state, srv);

  assert.deepStrictEqual(srv.db.condutas.map(function (c) { return c.texto; }), ['Dieta livre']);
  assert.deepStrictEqual(state.beds[0].condutas.map(function (c) { return c.text; }), ['Dieta livre']);
});

test('duas condutas sem id no mesmo paciente: sync duas vezes — nenhuma duplica', () => {
  const srv = fakeDb();
  const state = stateWithIdlessConduta('Solicitar labs');
  state.beds[0].condutas.push({ text: 'Avaliar alta', done: false });
  sync(state, srv);
  sync(state, srv);

  assert.deepStrictEqual(srv.db.condutas.map(function (c) { return c.texto; }).sort(), ['Avaliar alta', 'Solicitar labs']);
  assert.strictEqual(state.beds[0].condutas.length, 2);
});
