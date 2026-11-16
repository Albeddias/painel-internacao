const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// "Resetar e receber" (applyPull) tratava paciente guardado na nuvem como paciente comum:
// criava um leito para ele e, na sincronização seguinte, a mescla devolvia esse leito ao
// registro local com o nome em branco — apagando o nome completo, que só existe no aparelho.
// A leitura nova (painel_sync_pull) também não traz mais os filhos de quem está na nuvem.

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
    notes: [], raw_texts: [], generated_docs: [], evolucoes: [], prefs: [],
  };
}
const empty = () => PainelCore.migrateState({ beds: [] }, '2026-11-15');

test('applyPull: paciente na nuvem não vira leito; entra no registro local', () => {
  const state = empty();
  PainelCore.applyPull(state, pulled([row(), row({ id: 'p2', initials: 'BC', bed_number: '2001-B', status: 'nuvem', person_id: 'per-2' })]));
  assert.deepStrictEqual(state.beds.map(b => b.patientId), ['p1']);
  assert.deepStrictEqual(state.cloudArchived.p2, { nome: '', iniciais: 'BC', leito: '2001-B', personId: 'per-2' });
});

test('resetar e receber preserva o nome completo de quem está na nuvem', () => {
  const state = empty();
  state.cloudArchived = { p2: { nome: 'Bruno Costa', iniciais: 'BC', leito: '2001-B', personId: null } };
  const db = pulled([row(), row({ id: 'p2', initials: 'BC', bed_number: '2001-B', status: 'nuvem' })]);
  PainelCore.resetLocalSync(state);
  PainelCore.applyPull(state, db);
  state.syncBase = PainelCore.buildSyncBase(state);
  assert.strictEqual(state.cloudArchived.p2.nome, 'Bruno Costa');
  PainelCore.mergeStates(state, db); // a sincronização seguinte
  assert.strictEqual(state.cloudArchived.p2.nome, 'Bruno Costa', 'antes virava ""');
  assert.deepStrictEqual(state.beds.map(b => b.patientId), ['p1']);
});

test('applyPull: registro da nuvem de paciente que sumiu do banco é podado', () => {
  const state = empty();
  state.cloudArchived = { velho: { nome: 'Fulano', iniciais: 'F', leito: '1', personId: null } };
  PainelCore.applyPull(state, pulled([row()]));
  assert.strictEqual(state.cloudArchived.velho, undefined);
});

test('applyPull: leitura vazia (anômala) não apaga o registro da nuvem', () => {
  const state = empty();
  state.cloudArchived = { p2: { nome: 'Bruno Costa', iniciais: 'BC', leito: '2001-B', personId: null } };
  PainelCore.applyPull(state, pulled([]));
  assert.strictEqual(state.cloudArchived.p2.nome, 'Bruno Costa');
});

test('applyPull: paciente na nuvem com leito ainda neste aparelho — o leito sai e o nome vai para o registro', () => {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed({ patientId: 'p2', bedNumber: '2001-B', patientName: 'Bruno Costa' }),
  ] }, '2026-11-15');
  state.syncedPatientIds = ['p2'];
  PainelCore.applyPull(state, pulled([row({ id: 'p2', initials: 'BC', bed_number: '2001-B', status: 'nuvem' })]));
  assert.strictEqual(state.beds.length, 0);
  assert.strictEqual(state.cloudArchived.p2.nome, 'Bruno Costa');
});
