const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

function makeBed() {
  return PainelCore.migrateBed({
    bedNumber: '1012-A', patientName: 'Mariana Silva Dias', age: 32, admitDate: '2026-06-07',
    hpp: 'HAS / DM2', anamneseInicial: 'Admitida com dispneia.',
    diagnoses: ['Pneumonia Comunitária'],
    notes: 'Evolução estável.',
    condutas: [{ text: 'Manter ATB', done: true }],
    trackers: [
      { id: 'a1', type: 'atb', name: 'Ceftriaxona', startDate: '2026-06-07', duration: 7 },
      { id: 'c1', type: 'culture', name: 'Hemocultura', collectionDate: '2026-06-08', result: 'Aguardando' },
      { id: 'd1', type: 'device', name: 'CVC Subclávia D', installDate: '2026-06-07' },
    ],
    exams: [
      { id: 'l1', type: 'lab', date: '2026-06-10', results: [{ name: 'Hb', value: '9.5' }, { name: 'Cr', value: '1.1' }] },
      { id: 'i1', type: 'image', date: '2026-06-09', name: 'TC Tórax', summary: 'Consolidação em base D' },
    ],
    rawTexts: [{ id: 'r1', tipo: 'evolucao', data: '2026-06-11', texto: 'Texto cru.' }],
  });
}

test('buildPushPayload: envia iniciais e nunca o nome completo', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  const payload = PainelCore.buildPushPayload(state);
  assert.strictEqual(payload.patients[0].initials, 'M.S.D.');
  const json = JSON.stringify(payload);
  assert.ok(!json.includes('Mariana'), 'payload não pode conter o nome');
  assert.ok(!json.includes('patientName'), 'payload não pode ter o campo patientName');
});

test('buildPushPayload: leito vazio (sem patientId) não gera linhas', () => {
  const state = PainelCore.migrateState({ beds: [{ bedNumber: '1015-A' }] }, '2026-06-12');
  const payload = PainelCore.buildPushPayload(state);
  assert.strictEqual(payload.patients.length, 0);
});

test('buildPushPayload: divide trackers e explode labs', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  const p = PainelCore.buildPushPayload(state);
  assert.strictEqual(p.antibiotics.length, 1);
  assert.strictEqual(p.antibiotics[0].nome, 'Ceftriaxona');
  assert.strictEqual(p.cultures.length, 1);
  assert.strictEqual(p.devices.length, 1);
  assert.strictEqual(p.exams.filter(e => e.tipo === 'lab').length, 2);
  assert.strictEqual(p.exams.filter(e => e.tipo === 'imagem').length, 1);
  assert.strictEqual(p.notes.length, 1);
  assert.strictEqual(p.raw_texts.length, 1);
  assert.strictEqual(p.problems.length, 1);
});

test('buildPushPayload: status reflete alta/arquivado', () => {
  const alta = makeBed(); alta.isArchived = true; alta.archiveReason = 'alta';
  const arq = makeBed(); arq.isArchived = true; arq.archiveReason = 'arquivado';
  const state = PainelCore.migrateState({ beds: [alta, arq] }, '2026-06-12');
  const p = PainelCore.buildPushPayload(state);
  assert.strictEqual(p.patients[0].status, 'alta');
  assert.strictEqual(p.patients[1].status, 'arquivado');
});

test('applyPull: round-trip preserva dados e NÃO toca no nome local', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  const pid = state.beds[0].patientId;
  const payload = PainelCore.buildPushPayload(state);
  const pulled = { ...payload, generated_docs: [
    { id: 'g1', patient_id: pid, tipo: 'sumario_alta', conteudo: 'Paciente [NOME]...', created_at: '2026-06-12T10:00:00Z' },
  ]};
  // simula edição da IA no banco
  pulled.problems.push({ id: 'p-novo', patient_id: pid, descricao: 'IRA pré-renal', status: 'ativo', plano: 'Hidratação', ordem: 1 });
  PainelCore.applyPull(state, pulled);
  const bed = state.beds[0];
  assert.strictEqual(bed.patientName, 'Mariana Silva Dias', 'nome local intocado');
  assert.strictEqual(bed.problems.length, 2);
  assert.strictEqual(bed.problems[1].descricao, 'IRA pré-renal');
  assert.strictEqual(bed.generatedDocs.length, 1);
  assert.strictEqual(bed.generatedDocs[0].tipo, 'sumario_alta');
  assert.strictEqual(bed.trackers.find(t => t.type === 'atb').name, 'Ceftriaxona');
  const lab = bed.exams.find(e => e.type === 'lab');
  assert.strictEqual(lab.results.length, 2);
  assert.strictEqual(bed.notes, 'Evolução estável.');
  assert.strictEqual(bed.rawTexts.length, 1);
});

test('applyPull: paciente desconhecido vira leito novo com iniciais como nome provisório', () => {
  const state = PainelCore.defaultState('2026-06-12');
  PainelCore.applyPull(state, {
    patients: [{ id: 'novo-1', bed_number: '2001-B', initials: 'J.S.', age: 70, admit_date: '2026-06-11', hpp: '', anamnese_inicial: '', discharge_forecast: null, status: 'internado' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [],
  });
  assert.strictEqual(state.beds.length, 1);
  assert.strictEqual(state.beds[0].patientName, 'J.S.');
  assert.strictEqual(state.beds[0].patientId, 'novo-1');
});

test('applyPull: NÃO deleta leito local nunca sincronizado (criado offline, ainda não enviado)', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  // syncedPatientIds vazio => leito é novo local => pull não pode removê-lo
  PainelCore.applyPull(state, { patients: [], problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [] });
  assert.strictEqual(state.beds.length, 1, 'leito novo local deve ser preservado');
});

test('applyPull: REMOVE leito já sincronizado que sumiu do banco (deletado em outro aparelho)', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  const pid = state.beds[0].patientId;
  // simula que esse paciente já foi sincronizado antes
  state.syncedPatientIds = [pid];
  // banco volta vazio => paciente foi deletado em outro aparelho
  PainelCore.applyPull(state, { patients: [], problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [] });
  assert.strictEqual(state.beds.length, 0, 'leito sincronizado ausente do banco deve ser removido');
});

test('applyPull: atualiza syncedPatientIds com os ids vindos do banco', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  const pid = state.beds[0].patientId;
  const payload = PainelCore.buildPushPayload(state);
  PainelCore.applyPull(state, { ...payload, generated_docs: [] });
  assert.deepStrictEqual(state.syncedPatientIds, [pid]);
});

test('applyPull: leito sincronizado E presente no banco permanece (não é removido)', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  const pid = state.beds[0].patientId;
  state.syncedPatientIds = [pid];
  const payload = PainelCore.buildPushPayload(state);
  PainelCore.applyPull(state, { ...payload, generated_docs: [] });
  assert.strictEqual(state.beds.length, 1);
});

// --- Tombstones: deleção de paciente propaga ao banco ---

test('defaultState/migrateState têm deletedPatientIds', () => {
  assert.deepStrictEqual(PainelCore.defaultState('2026-06-12').deletedPatientIds, []);
  const migrated = PainelCore.migrateState({ beds: [] }, '2026-06-12');
  assert.deepStrictEqual(migrated.deletedPatientIds, []);
});

test('markPatientDeleted: registra id, deduplica e ignora vazios', () => {
  const state = PainelCore.defaultState('2026-06-12');
  PainelCore.markPatientDeleted(state, 'pid-1');
  PainelCore.markPatientDeleted(state, 'pid-1'); // duplicado
  PainelCore.markPatientDeleted(state, '');      // ignorado
  PainelCore.markPatientDeleted(state, null);    // ignorado
  PainelCore.markPatientDeleted(state, 'pid-2');
  assert.deepStrictEqual(state.deletedPatientIds, ['pid-1', 'pid-2']);
});

test('buildPushPayload: expõe deletePatientIds para o push apagar no banco', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-06-12');
  PainelCore.markPatientDeleted(state, 'pid-removido');
  const p = PainelCore.buildPushPayload(state);
  assert.deepStrictEqual(p.deletePatientIds, ['pid-removido']);
});

test('applyPull: não ressuscita paciente deletado localmente (tombstone pendente)', () => {
  const state = PainelCore.defaultState('2026-06-12');
  PainelCore.markPatientDeleted(state, 'morto-1');
  PainelCore.applyPull(state, {
    patients: [{ id: 'morto-1', bed_number: '3003-C', initials: 'X.Y.', status: 'arquivado' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [],
  });
  assert.strictEqual(state.beds.length, 0, 'paciente deletado não deve voltar no pull');
});
