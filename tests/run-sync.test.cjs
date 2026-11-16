const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');
const { createFakeDb } = require('./helpers/fake-db.cjs');

// O Sincronizar inteiro (PainelCore.runSync) contra um banco de mentira: uma leitura atômica,
// a mescla, e UMA gravação tudo-ou-nada só com o que mudou. Se algo falha, o aparelho volta
// exatamente ao que era antes — como se o botão não tivesse sido tocado.

const TODAY = '2026-11-15';
const NOW = '2026-11-15T12:00:00.000Z';
function ana() {
  return {
    patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga', age: 60, admitDate: '2026-11-10',
    hpp: 'HAS', notes: 'Estável.',
    problems: [{ id: 'pr1', descricao: 'PNM', status: 'ativo', plano: '' }],
    condutas: [{ id: 'c1', text: 'Manter ATB', done: false }, { id: 'c2', text: 'Pedir TC', done: false }],
    trackers: [{ id: 'a1', type: 'atb', name: 'Ceftriaxona', startDate: '2026-11-10', duration: 7 }],
    exams: [
      { id: 'l1', type: 'lab', date: '2026-11-12', results: [{ name: 'Hb', value: '9.5' }, { name: 'Cr', value: '1.1' }] },
      { id: 'i1', type: 'image', date: '2026-11-11', name: 'TC Tórax', summary: 'Consolidação' },
    ],
    rawTexts: [{ id: 'r1', tipo: 'evolucao', data: '2026-11-11', texto: 'Texto cru.' }],
    evolucoes: [{ id: 'e1', data: '2026-11-14', problemas: 'PNM', evolucao_atual: 'Melhor.' }],
  };
}
function bruno() {
  return {
    patientId: 'p2', bedNumber: '2001-B', patientName: 'Bruno Costa', age: 70, admitDate: '2026-11-09',
    problems: [{ id: 'pr2', descricao: 'ICC', status: 'ativo', plano: 'Furosemida' }],
    condutas: [{ id: 'c9', text: 'Balanço hídrico', done: false }],
    exams: [{ id: 'l9', type: 'lab', date: '2026-11-12', results: [{ name: 'K', value: '4.0' }] }],
  };
}
function device(beds) {
  return PainelCore.migrateState({ beds: (beds || [ana()]).map(PainelCore.migrateBed) }, TODAY);
}
const sync = (state, db) => PainelCore.runSync(state, db, { now: NOW });
function ops(diff) {
  const out = {};
  Object.keys(diff.upsert).forEach(t => { if (diff.upsert[t].length) out['upsert.' + t] = diff.upsert[t].length; });
  Object.keys(diff.remove).forEach(t => { if (diff.remove[t].length) out['remove.' + t] = diff.remove[t].length; });
  if (diff.deletePatientIds.length) out.deletePatientIds = diff.deletePatientIds.length;
  return out;
}
const lastOps = (db) => ops(db.pushes[db.pushes.length - 1]);
const labExam = (state) => state.beds[0].exams.find(e => e.type === 'lab');
// Aparelho e banco já sincronizados uma vez.
async function synced(beds) {
  const db = createFakeDb();
  const state = device(beds);
  await sync(state, db);
  return { db, state };
}

// ---- Enviar só o que mudou ---------------------------------------------------------

test('primeira sincronização grava tudo; a seguinte, sem mudanças, não grava nada', async () => {
  const { db, state } = await synced();
  assert.strictEqual(db.tables.patients.length, 1);
  assert.strictEqual(db.tables.condutas.length, 2);
  assert.strictEqual(db.tables.exams.length, 3);
  assert.strictEqual(db.tables.notes[0].texto, 'Estável.');
  assert.strictEqual(db.pushes.length, 1);
  const r = await sync(state, db);
  assert.strictEqual(db.pushes.length, 1, 'nenhuma requisição de gravação');
  assert.strictEqual(r.sent, 0);
  assert.strictEqual(db.pulls, 2);
});

test('runSync devolve quantas operações enviou', async () => {
  const db = createFakeDb();
  const r = await sync(device(), db);
  assert.strictEqual(r.sent, PainelCore.pushDiffSize(db.pushes[0]));
  assert.ok(r.sent > 0);
});

test('editar uma conduta envia só aquela linha — nem o paciente é regravado', async () => {
  const { db, state } = await synced([ana(), bruno()]);
  state.beds[0].condutas[1].text = 'Pedir TC de tórax';
  await sync(state, db);
  assert.deepStrictEqual(lastOps(db), { 'upsert.condutas': 1 });
  assert.strictEqual(db.tables.condutas.find(c => c.id === 'c2').texto, 'Pedir TC de tórax');
});

test('editar um campo do paciente envia só a linha do paciente', async () => {
  const { db, state } = await synced([ana(), bruno()]);
  state.beds[1].hpp = 'ICC FEr';
  await sync(state, db);
  assert.deepStrictEqual(lastOps(db), { 'upsert.patients': 1 });
  assert.strictEqual(db.pushes[1].upsert.patients[0].id, 'p2');
});

test('apagar uma linha no aparelho remove só ela do banco (e reposiciona as seguintes)', async () => {
  const { db, state } = await synced();
  state.beds[0].condutas = state.beds[0].condutas.filter(c => c.id !== 'c1');
  await sync(state, db);
  assert.deepStrictEqual(db.pushes[1].remove.condutas, ['c1']);
  assert.deepStrictEqual(lastOps(db), { 'remove.condutas': 1, 'upsert.condutas': 1 });
  assert.deepStrictEqual(db.tables.condutas.map(c => [c.id, c.ordem]), [['c2', 0]]);
});

test('anotação e preferências só vão quando mudam', async () => {
  const { db, state } = await synced();
  state.beds[0].notes = 'Piorou.';
  await sync(state, db);
  assert.deepStrictEqual(lastOps(db), { 'upsert.notes': 1 });
  state.labRangesText = 'Hb: 12-16';
  await sync(state, db);
  assert.deepStrictEqual(lastOps(db), { 'upsert.prefs': 1 });
});

test('evolução editada envia só a linha do dia', async () => {
  const { db, state } = await synced();
  state.beds[0].evolucoes[0].metas = 'Alta amanhã';
  await sync(state, db);
  assert.deepStrictEqual(lastOps(db), { 'upsert.evolucoes': 1 });
  assert.strictEqual(db.tables.evolucoes.length, 1);
  assert.strictEqual(db.tables.evolucoes[0].metas, 'Alta amanhã');
});

// ---- Ids estáveis nos exames de laboratório ----------------------------------------

test('labs: sincronizar de novo não troca os ids das linhas do banco', async () => {
  const { db, state } = await synced();
  const before = db.tables.exams.map(e => e.id).sort();
  state.beds[0].hpp = 'HAS, DM2';
  await sync(state, db);
  await sync(state, db);
  assert.deepStrictEqual(db.tables.exams.map(e => e.id).sort(), before);
});

test('labs: resultado novo insere uma linha; as antigas ficam como estão', async () => {
  const { db, state } = await synced();
  const before = db.tables.exams.map(e => e.id);
  labExam(state).results.push({ name: 'K', value: '4.2' });
  await sync(state, db);
  assert.deepStrictEqual(lastOps(db), { 'upsert.exams': 1 });
  assert.strictEqual(db.tables.exams.length, 4);
  before.forEach(id => assert.ok(db.tables.exams.find(e => e.id === id), 'linha antiga preservada'));
});

test('labs: valor corrigido troca só aquela linha', async () => {
  const { db, state } = await synced();
  labExam(state).results.find(r => r.name === 'Hb').value = '10.2';
  await sync(state, db);
  assert.deepStrictEqual(lastOps(db), { 'upsert.exams': 1, 'remove.exams': 1 });
  assert.deepStrictEqual(db.tables.exams.filter(e => e.nome === 'Hb').map(e => e.resultado), ['10.2']);
});

test('labs regravados com ids novos por um aparelho na versão antiga não geram envio', async () => {
  const { db, state } = await synced();
  db.tables.exams.forEach((e, i) => { if (e.tipo === 'lab') e.id = 'regravado-' + i; });
  const r = await sync(state, db);
  assert.strictEqual(r.sent, 0);
  assert.strictEqual(db.pushes.length, 1);
});

// ---- Tudo ou nada ------------------------------------------------------------------

test('falha na leitura: aparelho intocado, nada gravado', async () => {
  const { db, state } = await synced();
  state.beds[0].hpp = 'HAS, DM2';
  const before = JSON.stringify(state);
  db.failPull = 'sem conexão';
  await assert.rejects(sync(state, db), /sem conexão/);
  assert.strictEqual(JSON.stringify(state), before);
  assert.strictEqual(db.pushes.length, 1);
});

test('falha na gravação: banco intocado e aparelho de volta ao que era antes', async () => {
  const { db, state } = await synced();
  db.tables.problems.push({ id: 'pr-ia', patient_id: 'p1', descricao: 'IRA', status: 'ativo', plano: '', ordem: 1 });
  state.beds[0].condutas = state.beds[0].condutas.filter(c => c.id !== 'c1');
  const before = JSON.stringify(state);
  db.failPush = 'rede caiu';
  await assert.rejects(sync(state, db), /rede caiu/);
  assert.strictEqual(JSON.stringify(state), before, 'nem a mescla fica pela metade');
  assert.ok(db.tables.condutas.find(c => c.id === 'c1'), 'banco como estava');
});

test('depois de uma gravação que falhou, a próxima sincronização fecha certo: a deleção local não ressuscita', async () => {
  const { db, state } = await synced();
  db.tables.problems.push({ id: 'pr-ia', patient_id: 'p1', descricao: 'IRA', status: 'ativo', plano: '', ordem: 1 });
  state.beds[0].condutas = state.beds[0].condutas.filter(c => c.id !== 'c1');
  db.failPush = 'rede caiu';
  await assert.rejects(sync(state, db));
  db.failPush = null;
  await sync(state, db);
  assert.deepStrictEqual(state.beds[0].condutas.map(c => c.id), ['c2'], 'conduta apagada continua apagada');
  assert.deepStrictEqual(db.tables.condutas.map(c => c.id), ['c2']);
  assert.deepStrictEqual(state.beds[0].problems.map(p => p.id), ['pr1', 'pr-ia'], 'o que a IA criou chegou');
});

test('gravação feita mas resposta perdida: aparelho volta atrás e a próxima sincronização não duplica nada', async () => {
  const { db, state } = await synced();
  state.beds[0].condutas.push({ id: 'c3', text: 'Nova', done: false });
  state.beds[0].condutas = state.beds[0].condutas.filter(c => c.id !== 'c1');
  labExam(state).results.push({ name: 'K', value: '4.2' });
  const before = JSON.stringify(state);
  db.loseResponse = true;
  await assert.rejects(sync(state, db), /rede caiu/);
  assert.strictEqual(JSON.stringify(state), before);
  assert.strictEqual(db.tables.condutas.length, 2, 'o banco gravou mesmo assim');
  db.loseResponse = false;
  const r = await sync(state, db);
  assert.strictEqual(r.sent, 0, 'o banco já tinha tudo');
  assert.deepStrictEqual(state.beds[0].condutas.map(c => c.id), ['c2', 'c3']);
  assert.deepStrictEqual(db.tables.condutas.map(c => c.id).sort(), ['c2', 'c3']);
  assert.strictEqual(db.tables.exams.filter(e => e.nome === 'K').length, 1);
  assert.strictEqual(labExam(state).results.filter(x => x.name === 'K').length, 1);
});

test('paciente novo cuja gravação falhou é enviado na tentativa seguinte, com o mesmo id', async () => {
  const db = createFakeDb();
  const state = device([{ bedNumber: '3001', patientName: 'Carla Dias' }]);
  delete state.beds[0].patientId; // leito recém-criado na tela: ainda sem id
  db.failPush = 'rede caiu';
  await assert.rejects(sync(state, db));
  const id = state.beds[0].patientId;
  assert.ok(id, 'o id dado ao leito sobrevive à falha');
  db.failPush = null;
  await sync(state, db);
  assert.deepStrictEqual(db.tables.patients.map(p => p.id), [id]);
});

// ---- Convivência com a IA ----------------------------------------------------------

test('linha criada pela IA entre a leitura e a gravação não é apagada, e chega na sincronização seguinte', async () => {
  const { db, state } = await synced();
  state.beds[0].condutas[0].done = true;
  db.beforePush = (d) => {
    d.beforePush = null;
    d.tables.condutas.push({ id: 'c-ia', patient_id: 'p1', texto: 'Solicitar eco', done: false, data: null, ordem: 5 });
  };
  await sync(state, db);
  assert.ok(db.tables.condutas.find(c => c.id === 'c-ia'), 'o push antigo (apaga e reinsere) teria apagado');
  await sync(state, db);
  assert.deepStrictEqual(state.beds[0].condutas.map(c => c.id), ['c1', 'c2', 'c-ia']);
});

test('edições da IA no banco entram pela mescla e não voltam como envio', async () => {
  const { db, state } = await synced();
  db.tables.problems.find(p => p.id === 'pr1').plano = 'Trocar ATB';
  db.tables.patients[0].anamnese_inicial = 'Admitida com dispneia.';
  db.tables.generated_docs.push({ id: 'g1', patient_id: 'p1', tipo: 'laudo', conteudo: 'Paciente [NOME]', created_at: '2026-11-15T10:00:00+00:00' });
  const r = await sync(state, db);
  assert.strictEqual(r.sent, 0);
  assert.strictEqual(state.beds[0].problems[0].plano, 'Trocar ATB');
  assert.strictEqual(state.beds[0].anamneseInicial, 'Admitida com dispneia.');
  assert.strictEqual(state.beds[0].generatedDocs.length, 1);
});

// ---- Conferência do que foi gravado ------------------------------------------------

test('banco que guarda diferente do que recebeu: erro claro, aparelho de volta ao que era', async () => {
  const { db, state } = await synced();
  state.beds[0].problems[0].plano = 'Trocar ATB';
  const before = JSON.stringify(state);
  db.tamper = (stored) => { stored.problems[0].plano = ''; };
  await assert.rejects(sync(state, db), /não conferiu.*problems\.plano/);
  assert.strictEqual(JSON.stringify(state), before);
});

test('banco que não devolve uma linha enviada: erro, aparelho de volta ao que era', async () => {
  const { db, state } = await synced();
  state.beds[0].notes = 'Piorou.';
  const before = JSON.stringify(state);
  db.tamper = (stored) => { stored.notes = []; };
  await assert.rejects(sync(state, db), /não conferiu.*notes/);
  assert.strictEqual(JSON.stringify(state), before);
});

test('verifyPush: aceita o que o banco normaliza (número enviado como texto)', () => {
  const diff = { deletePatientIds: [], remove: {}, upsert: { antibiotics: [{ id: 'a1', patient_id: 'p1', nome: 'X', duration_days: '7', ordem: 0 }] } };
  PainelCore.verifyPush(diff, { antibiotics: [{ id: 'a1', patient_id: 'p1', nome: 'X', duration_days: 7, ordem: 0, updated_at: 'x' }] });
});

// ---- Pacientes: apagar, nuvem, bookkeeping -----------------------------------------

test('paciente apagado no aparelho some do banco com tudo o que é dele', async () => {
  const { db, state } = await synced([ana(), bruno()]);
  PainelCore.markPatientDeleted(state, 'p2');
  state.beds = state.beds.filter(b => b.patientId !== 'p2');
  await sync(state, db);
  assert.deepStrictEqual(db.tables.patients.map(p => p.id), ['p1']);
  ['problems', 'condutas', 'exams', 'notes'].forEach(t => {
    assert.ok(!db.tables[t].some(r => r.patient_id === 'p2'), t);
  });
  assert.deepStrictEqual(state.deletedPatientIds, []);
  assert.deepStrictEqual(state.syncedPatientIds, ['p1']);
});

test('paciente guardado na nuvem: os filhos não são baixados nem tocados', async () => {
  const { db, state } = await synced([ana(), bruno()]);
  db.tables.patients.find(p => p.id === 'p2').status = 'nuvem';
  const pulled = await db.pull();
  assert.ok(!pulled.problems.some(r => r.patient_id === 'p2'), 'a leitura não traz os filhos');
  assert.ok(pulled.patients.some(p => p.id === 'p2'), 'mas traz o paciente');
  await sync(state, db);
  assert.deepStrictEqual(state.beds.map(b => b.patientId), ['p1']);
  assert.strictEqual(state.cloudArchived.p2.nome, 'Bruno Costa');
  state.beds[0].hpp = 'HAS, DM2';
  await sync(state, db);
  assert.strictEqual(db.tables.problems.filter(r => r.patient_id === 'p2').length, 1);
  assert.strictEqual(db.tables.condutas.filter(r => r.patient_id === 'p2').length, 1);
  assert.strictEqual(db.tables.exams.filter(r => r.patient_id === 'p2').length, 1);
  assert.strictEqual(db.tables.patients.find(p => p.id === 'p2').status, 'nuvem');
});

test('depois de sincronizar: foto, pacientes sincronizados e hora ficam em dia', async () => {
  const { state } = await synced([ana(), bruno()]);
  assert.deepStrictEqual(state.syncBase, PainelCore.buildSyncBase(state));
  assert.deepStrictEqual(state.syncedPatientIds.slice().sort(), ['p1', 'p2']);
  assert.strictEqual(state.lastSyncAt, NOW);
});

test('o objeto do estado continua o mesmo (a tela guarda referência a ele)', async () => {
  const db = createFakeDb();
  const state = device();
  const bed = state.beds[0];
  await sync(state, db);
  assert.strictEqual(state.beds[0], bed, 'sem falha, o leito é o mesmo objeto');
});

// ---- Dois aparelhos ----------------------------------------------------------------

test('dois aparelhos: cada um edita uma coisa, os dois convergem e depois ninguém envia mais nada', async () => {
  const db = createFakeDb();
  const celular = device([ana()]);
  await sync(celular, db);
  const pc = device([]);
  await sync(pc, db);
  assert.strictEqual(pc.beds[0].patientName, 'AB', 'o computador só conhece as iniciais');

  celular.beds[0].notes = 'Afebril há 48h.';
  celular.beds[0].condutas.push({ id: 'c3', text: 'Suspender ATB', done: false });
  pc.beds[0].hpp = 'HAS, DM2';
  pc.beds[0].exams.find(e => e.type === 'lab').results.push({ name: 'PCR', value: '12' });
  await sync(celular, db);
  await sync(pc, db);
  await sync(celular, db);

  [celular, pc].forEach(s => {
    const b = s.beds[0];
    assert.strictEqual(b.notes, 'Afebril há 48h.');
    assert.strictEqual(b.hpp, 'HAS, DM2');
    assert.deepStrictEqual(b.condutas.map(c => c.id), ['c1', 'c2', 'c3']);
    assert.deepStrictEqual(b.exams.find(e => e.type === 'lab').results.map(r => r.name).sort(), ['Cr', 'Hb', 'PCR']);
  });
  assert.strictEqual(celular.beds[0].patientName, 'Ana Braga');
  assert.strictEqual(db.tables.patients[0].initials, 'AB');
  const n = db.pushes.length;
  assert.strictEqual((await sync(pc, db)).sent, 0);
  assert.strictEqual((await sync(celular, db)).sent, 0);
  assert.strictEqual(db.pushes.length, n);
  assert.ok(!JSON.stringify(db.pushes).includes('Braga'), 'o nome nunca saiu do celular');
});

test('leitura que não devolve as tabelas (resposta estranha): erro, aparelho intocado, nada gravado', async () => {
  const { db, state } = await synced();
  state.beds[0].hpp = 'HAS, DM2';
  const before = JSON.stringify(state);
  for (const estranha of [null, {}, { patients: null }, 'erro']) {
    db.pull = async () => estranha;
    await assert.rejects(sync(state, db), /resposta inesperada/);
  }
  assert.strictEqual(JSON.stringify(state), before);
  assert.strictEqual(db.pushes.length, 1, 'uma leitura vazia por engano regravaria o banco inteiro');
});
