const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');
const { clone, CHILD } = require('./helpers/fake-db.cjs');

// O push antigo regravava TODOS os pacientes a cada Sincronizar (apagava e reinseria os filhos
// de cada um). buildPushDiff compara o que o aparelho quer gravar com o que acabou de ler do
// banco e devolve só a diferença: linhas novas/alteradas (upsert) e linhas que saíram (remove).

const TODAY = '2026-11-15';
function ana() {
  return {
    patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga', age: 60, admitDate: '2026-11-10',
    hpp: 'HAS', notes: 'Estável.',
    problems: [{ id: 'pr1', descricao: 'PNM', status: 'ativo', plano: '' }],
    condutas: [{ id: 'c1', text: 'Manter ATB', done: false }, { id: 'c2', text: 'Pedir TC', done: false }],
    trackers: [
      { id: 'a1', type: 'atb', name: 'Ceftriaxona', startDate: '2026-11-10', duration: 7 },
      { id: 'cu1', type: 'culture', name: 'Hemocultura', collectionDate: '2026-11-10', result: 'Aguardando' },
      { id: 'd1', type: 'device', name: 'CVC', installDate: '2026-11-10' },
    ],
    exams: [
      { id: 'l1', type: 'lab', date: '2026-11-12', results: [{ name: 'Hb', value: '9.5' }, { name: 'Cr', value: '1.1' }] },
      { id: 'i1', type: 'image', date: '2026-11-11', name: 'TC Tórax', summary: 'Consolidação' },
    ],
    rawTexts: [{ id: 'r1', tipo: 'evolucao', data: '2026-11-11', texto: 'Texto cru.' }],
    evolucoes: [{ id: 'e1', data: '2026-11-14', problemas: 'PNM', evolucao_atual: 'Melhor.' }],
  };
}
function device(beds) {
  return PainelCore.migrateState({ beds: (beds || [ana()]).map(PainelCore.migrateBed) }, TODAY);
}
function payloadOf(state) { return clone(PainelCore.buildPushPayload(state)); }
// Banco que espelha exatamente o que o aparelho gravaria.
function mirror(payload) {
  const db = clone(payload);
  delete db.deletePatientIds;
  db.generated_docs = [];
  return db;
}
// Operações do diff, só as não vazias: { 'upsert.condutas': 1, 'remove.exams': 2, ... }
function ops(diff) {
  const out = {};
  Object.keys(diff.upsert).forEach(t => { if (diff.upsert[t].length) out['upsert.' + t] = diff.upsert[t].length; });
  Object.keys(diff.remove).forEach(t => { if (diff.remove[t].length) out['remove.' + t] = diff.remove[t].length; });
  if (diff.deletePatientIds.length) out.deletePatientIds = diff.deletePatientIds.length;
  return out;
}

test('banco igual ao aparelho: nada a enviar', () => {
  const payload = payloadOf(device());
  const diff = PainelCore.buildPushDiff(payload, mirror(payload));
  assert.deepStrictEqual(ops(diff), {});
  assert.strictEqual(PainelCore.pushDiffSize(diff), 0);
});

test('banco vazio: tudo é novo, nada a remover', () => {
  const payload = payloadOf(device());
  const diff = PainelCore.buildPushDiff(payload, { patients: [] });
  assert.deepStrictEqual(ops(diff), {
    'upsert.patients': 1, 'upsert.problems': 1, 'upsert.antibiotics': 1, 'upsert.cultures': 1, 'upsert.devices': 1,
    'upsert.exams': 3, 'upsert.condutas': 2, 'upsert.raw_texts': 1, 'upsert.notes': 1, 'upsert.evolucoes': 1, 'upsert.prefs': 1,
  });
  assert.strictEqual(PainelCore.pushDiffSize(diff), 14);
});

test('uma coluna diferente em uma linha: só aquela linha é enviada, inteira', () => {
  const cases = [
    ['patients', 'hpp'], ['problems', 'plano'], ['antibiotics', 'indicacao'], ['cultures', 'resultado'],
    ['devices', 'nome'], ['condutas', 'texto'], ['raw_texts', 'texto'],
  ];
  cases.forEach(([table, col]) => {
    const payload = payloadOf(device());
    const db = mirror(payload);
    db[table][0][col] = 'valor antigo do banco';
    const diff = PainelCore.buildPushDiff(payload, db);
    assert.deepStrictEqual(ops(diff), { ['upsert.' + table]: 1 }, table + '.' + col);
    assert.deepStrictEqual(diff.upsert[table][0], payload[table][0], 'a linha vai como o aparelho a tem');
  });
});

test('ordem diferente (lista reordenada) conta como linha alterada', () => {
  const payload = payloadOf(device());
  const db = mirror(payload);
  db.condutas[0].ordem = 1; db.condutas[1].ordem = 0;
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payload, db)), { 'upsert.condutas': 2 });
});

test('linha que o banco tem e o aparelho não (do mesmo paciente): entra em remove, pelo id', () => {
  CHILD.forEach(table => {
    const payload = payloadOf(device());
    const db = mirror(payload);
    const extra = Object.assign({}, db[table].find(r => r.tipo !== 'lab'), { id: 'x-extra' });
    db[table].push(extra);
    const diff = PainelCore.buildPushDiff(payload, db);
    assert.deepStrictEqual(ops(diff), { ['remove.' + table]: 1 }, table);
    assert.deepStrictEqual(diff.remove[table], ['x-extra']);
  });
});

test('linhas de paciente que o aparelho não tem (na nuvem, de outro aparelho) nunca são removidas', () => {
  const payload = payloadOf(device());
  const db = mirror(payload);
  db.patients.push({ id: 'p-nuvem', bed_number: '9', initials: 'XY', status: 'nuvem' });
  db.problems.push({ id: 'pr-n', patient_id: 'p-nuvem', descricao: 'Algo', status: 'ativo', plano: '', ordem: 0 });
  db.exams.push({ id: 'ex-n', patient_id: 'p-nuvem', tipo: 'lab', nome: 'Hb', data: '2026-01-01', resultado: '10' });
  db.notes.push({ patient_id: 'p-nuvem', texto: 'nota' });
  const diff = PainelCore.buildPushDiff(payload, db);
  assert.deepStrictEqual(ops(diff), {});
});

test('paciente só é apagado por tombstone (deletePatientIds), e o tombstone segue sempre', () => {
  const state = device();
  PainelCore.markPatientDeleted(state, 'p-apagado');
  const payload = payloadOf(state);
  const db = mirror(payload);
  db.patients.push({ id: 'p-outro', bed_number: '9', initials: 'XY', status: 'internado' });
  const diff = PainelCore.buildPushDiff(payload, db);
  assert.deepStrictEqual(diff.deletePatientIds, ['p-apagado']);
  assert.deepStrictEqual(ops(diff), { deletePatientIds: 1 });
});

// ---- Exames de laboratório: a identidade é data + nome + valor, não o id --------------

test('labs: mesmo conteúdo com id diferente no banco não gera envio (o id do banco fica)', () => {
  const payload = payloadOf(device());
  const db = mirror(payload);
  db.exams.filter(e => e.tipo === 'lab').forEach((e, i) => { e.id = 'id-do-banco-' + i; });
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payload, db)), {});
});

test('labs: resultado novo no aparelho insere só ele', () => {
  const state = device();
  const db = mirror(payloadOf(state));
  state.beds[0].exams[0].results.push({ name: 'K', value: '4.2' });
  const diff = PainelCore.buildPushDiff(payloadOf(state), db);
  assert.deepStrictEqual(ops(diff), { 'upsert.exams': 1 });
  assert.strictEqual(diff.upsert.exams[0].nome, 'K');
});

test('labs: valor corrigido = remove a linha antiga (pelo id do banco) e insere a nova', () => {
  const state = device();
  const db = mirror(payloadOf(state));
  const oldId = db.exams.find(e => e.nome === 'Hb').id;
  state.beds[0].exams[0].results[0].value = '10.2';
  const diff = PainelCore.buildPushDiff(payloadOf(state), db);
  assert.deepStrictEqual(ops(diff), { 'upsert.exams': 1, 'remove.exams': 1 });
  assert.deepStrictEqual(diff.remove.exams, [oldId]);
  assert.strictEqual(diff.upsert.exams[0].resultado, '10.2');
});

test('labs: duplicata no banco (mesma data, nome e valor) — remove só o excedente', () => {
  const payload = payloadOf(device());
  const db = mirror(payload);
  const hb = db.exams.find(e => e.nome === 'Hb');
  db.exams.push(Object.assign({}, hb, { id: 'hb-dup' }));
  const diff = PainelCore.buildPushDiff(payload, db);
  assert.deepStrictEqual(ops(diff), { 'remove.exams': 1 });
});

test('labs: duplicata no aparelho — insere só o excedente', () => {
  const state = device();
  const db = mirror(payloadOf(state));
  state.beds[0].exams[0].results.push({ name: 'Hb', value: '9.5' });
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payloadOf(state), db)), { 'upsert.exams': 1 });
});

test('labs: sem data no aparelho e data nula no banco são a mesma linha', () => {
  const bed = ana();
  bed.exams = [{ id: 'l1', type: 'lab', date: '', results: [{ name: 'Hb', value: '9.5' }] }];
  const payload = payloadOf(device([bed]));
  const db = mirror(payload);
  db.exams[0].id = 'outro-id';
  assert.strictEqual(db.exams[0].data, null);
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payload, db)), {});
});

test('exame de imagem segue pelo id, como as outras linhas', () => {
  const payload = payloadOf(device());
  const db = mirror(payload);
  db.exams.find(e => e.tipo === 'imagem').resultado = 'laudo antigo';
  const diff = PainelCore.buildPushDiff(payload, db);
  assert.deepStrictEqual(ops(diff), { 'upsert.exams': 1 });
  assert.strictEqual(diff.upsert.exams[0].id, 'i1');
});

// ---- Comparação de valores ---------------------------------------------------------

test('número guardado como texto no aparelho ("7") é igual ao número do banco', () => {
  const bed = ana();
  bed.age = '60';
  bed.trackers[0].duration = '7';
  const payload = payloadOf(device([bed]));
  const db = mirror(payload);
  db.patients[0].age = 60;
  db.antibiotics[0].duration_days = 7;
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payload, db)), {});
});

test('vazio do aparelho x nulo do banco contam como diferentes (o banco é corrigido uma vez)', () => {
  const payload = payloadOf(device());
  const db = mirror(payload);
  db.problems[0].plano = null;
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payload, db)), { 'upsert.problems': 1 });
});

test('coluna que o banco tem a mais (updated_at) não conta', () => {
  const payload = payloadOf(device());
  const db = mirror(payload);
  Object.keys(db).forEach(t => db[t].forEach(r => { r.updated_at = '2026-11-15T10:00:00+00:00'; }));
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payload, db)), {});
});

// ---- Anotação, evolução e preferências ---------------------------------------------

test('anotação: só vai quando muda; a que falta no banco é criada', () => {
  const payload = payloadOf(device());
  let db = mirror(payload);
  db.notes[0].texto = 'antiga';
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payload, db)), { 'upsert.notes': 1 });
  db = mirror(payload);
  db.notes = [];
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payload, db)), { 'upsert.notes': 1 });
});

test('evolução: a linha é o dia — id diferente no banco não gera envio', () => {
  const payload = payloadOf(device());
  const db = mirror(payload);
  db.evolucoes[0].id = 'id-do-banco';
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payload, db)), {});
});

test('evolução: campo alterado envia a linha; evolução nunca é removida', () => {
  const payload = payloadOf(device());
  const db = mirror(payload);
  db.evolucoes[0].metas = 'meta antiga';
  db.evolucoes.push(Object.assign({}, db.evolucoes[0], { id: 'e-banco', data: '2026-11-13' }));
  const diff = PainelCore.buildPushDiff(payload, db);
  assert.deepStrictEqual(ops(diff), { 'upsert.evolucoes': 1 });
  assert.strictEqual(diff.upsert.evolucoes[0].data, '2026-11-14');
  assert.strictEqual(diff.remove.evolucoes, undefined, 'não existe remoção de evolução');
});

test('preferências: só vão quando mudam', () => {
  const payload = payloadOf(device());
  const db = mirror(payload);
  db.prefs[0].value = 'Hb: 12-16';
  assert.deepStrictEqual(ops(PainelCore.buildPushDiff(payload, db)), { 'upsert.prefs': 1 });
});

test('o nome completo nunca aparece no que é enviado', () => {
  const diff = PainelCore.buildPushDiff(payloadOf(device()), { patients: [] });
  const json = JSON.stringify(diff);
  assert.ok(!json.includes('Ana Braga') && !json.includes('Braga'));
  assert.strictEqual(diff.upsert.patients[0].initials, 'AB');
});
