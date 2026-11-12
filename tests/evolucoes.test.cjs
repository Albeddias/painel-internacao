const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

const EMPTY = {
  problemas: '', historia_internacao: '', evolucao_atual: '', exames_lab: '', culturas: '',
  exames_imagem: '', atualizacao_problemas: '', metas: '', acoes: '',
};
function evo(id, data, over) { return Object.assign({ id: id, data: data }, EMPTY, over || {}); }
function evoRow(id, patientId, data, over) { return Object.assign({ id: id, patient_id: patientId, data: data }, EMPTY, over || {}); }

function pull(over) {
  return Object.assign({
    patients: [{ id: 'p1', bed_number: '1012-A', initials: 'AB', age: 60, admit_date: '2026-11-01', hpp: '', anamnese_inicial: '', discharge_forecast: null, status: 'internado' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
    notes: [{ patient_id: 'p1', texto: '' }], raw_texts: [], generated_docs: [], evolucoes: [],
  }, over || {});
}

// Leito sincronizado, com foto, cujo banco espelha as evoluções locais.
function syncedFixture(evolucoes) {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed({ patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga', age: 60, admitDate: '2026-11-01', evolucoes: evolucoes || [] }),
  ] }, '2026-11-11');
  state.syncedPatientIds = ['p1'];
  state.syncBase = PainelCore.buildSyncBase(state);
  const pulled = pull({
    evolucoes: (evolucoes || []).map(function (e) { return Object.assign({ patient_id: 'p1' }, e); }),
  });
  return { state, pulled };
}

test('EVOLUCAO_FIELDS: os nove campos na ordem do Tasy', () => {
  assert.deepStrictEqual(PainelCore.EVOLUCAO_FIELDS, [
    'problemas', 'historia_internacao', 'evolucao_atual', 'exames_lab', 'culturas',
    'exames_imagem', 'atualizacao_problemas', 'metas', 'acoes',
  ]);
});

test('migrateBed: evolucoes nasce vazio e linha sem id ganha uuid', () => {
  assert.deepStrictEqual(PainelCore.migrateBed({ patientName: 'Ana' }).evolucoes, []);
  const bed = PainelCore.migrateBed({ patientName: 'Ana', evolucoes: [{ data: '2026-11-10', problemas: 'PNM' }] });
  assert.match(bed.evolucoes[0].id, /^[0-9a-f-]{36}$/);
  assert.strictEqual(bed.evolucoes[0].problemas, 'PNM');
});

test('buildPushPayload: uma linha por evolução, com patient_id, data e os nove campos', () => {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed({ patientId: 'p1', patientName: 'Ana Braga', evolucoes: [evo('e1', '2026-11-10', { problemas: 'PNM', metas: 'Desmame de O2' })] }),
  ] }, '2026-11-11');
  const out = PainelCore.buildPushPayload(state);
  assert.deepStrictEqual(out.evolucoes, [evoRow('e1', 'p1', '2026-11-10', { problemas: 'PNM', metas: 'Desmame de O2' })]);
});

test('applyPull: evoluções do banco entram no leito em ordem de data', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-11-11');
  PainelCore.applyPull(state, pull({ evolucoes: [
    evoRow('e2', 'p1', '2026-11-11', { evolucao_atual: 'Melhora.' }),
    evoRow('e1', 'p1', '2026-11-10', { evolucao_atual: 'Febril.' }),
  ] }));
  assert.deepStrictEqual(state.beds[0].evolucoes, [
    evo('e1', '2026-11-10', { evolucao_atual: 'Febril.' }),
    evo('e2', '2026-11-11', { evolucao_atual: 'Melhora.' }),
  ]);
});

test('mergeStates: evolução criada no banco chega ao aparelho (foto antiga, sem evoluções)', () => {
  const { state, pulled } = syncedFixture([]);
  delete state.syncBase.p1.rows.evolucoes; // foto tirada antes de a tabela existir
  pulled.evolucoes = [evoRow('e1', 'p1', '2026-11-11', { problemas: 'PNM' })];
  PainelCore.mergeStates(state, pulled);
  assert.deepStrictEqual(state.beds[0].evolucoes, [evo('e1', '2026-11-11', { problemas: 'PNM' })]);
});

test('mergeStates: linha local intocada adota a edição do banco', () => {
  const { state, pulled } = syncedFixture([evo('e1', '2026-11-10', { metas: 'A' })]);
  pulled.evolucoes[0].metas = 'B (IA)';
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].evolucoes[0].metas, 'B (IA)');
});

test('mergeStates: linha editada no aparelho vence o banco', () => {
  const { state, pulled } = syncedFixture([evo('e1', '2026-11-10', { metas: 'A' })]);
  state.beds[0].evolucoes[0].metas = 'A editado';
  pulled.evolucoes[0].metas = 'B (IA)';
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].evolucoes[0].metas, 'A editado');
  assert.strictEqual(PainelCore.buildPushPayload(state).evolucoes[0].metas, 'A editado');
});

test('mergeStates: mesmo dia criado nos dois lados vira UMA linha (conteúdo local, id do banco)', () => {
  const { state, pulled } = syncedFixture([]);
  state.beds[0].evolucoes.push(evo('local-id', '2026-11-11', { acoes: 'Solicito TC.' }));
  pulled.evolucoes = [evoRow('banco-id', 'p1', '2026-11-11', { acoes: 'Texto da IA.' })];
  PainelCore.mergeStates(state, pulled);
  assert.deepStrictEqual(state.beds[0].evolucoes, [evo('banco-id', '2026-11-11', { acoes: 'Solicito TC.' })]);
  assert.strictEqual(PainelCore.buildPushPayload(state).evolucoes.length, 1, 'push nunca manda o dia duplicado');
});

test('mergeStates: linha intocada apagada no banco some do aparelho; editada sobrevive', () => {
  const a = syncedFixture([evo('e1', '2026-11-10', { metas: 'A' })]);
  a.pulled.evolucoes = [];
  PainelCore.mergeStates(a.state, a.pulled);
  assert.deepStrictEqual(a.state.beds[0].evolucoes, []);

  const b = syncedFixture([evo('e1', '2026-11-10', { metas: 'A' })]);
  b.state.beds[0].evolucoes[0].metas = 'A editado';
  b.pulled.evolucoes = [];
  PainelCore.mergeStates(b.state, b.pulled);
  assert.strictEqual(b.state.beds[0].evolucoes.length, 1);
});

test('mergeStates: evoluções de outros pacientes não vazam para o leito', () => {
  const { state, pulled } = syncedFixture([]);
  pulled.evolucoes = [evoRow('ex', 'outro-paciente', '2026-11-11', { metas: 'X' })];
  PainelCore.mergeStates(state, pulled);
  assert.deepStrictEqual(state.beds[0].evolucoes, []);
});

test('buildSyncBase: fotografa as evoluções pela data', () => {
  const { state } = syncedFixture([evo('e1', '2026-11-10', { metas: 'A' })]);
  assert.deepStrictEqual(Object.keys(state.syncBase.p1.rows.evolucoes), ['2026-11-10']);
});

test('newEvolucaoForToday: copia os campos cumulativos da linha anterior e zera os diários', () => {
  const bed = PainelCore.migrateBed({ patientName: 'Ana', evolucoes: [
    evo('e0', '2026-11-08', { problemas: 'antigo' }),
    evo('e1', '2026-11-10', {
      problemas: '1. PNM', historia_internacao: 'HDA', evolucao_atual: 'Febril ontem.', exames_lab: 'Hb 9',
      culturas: 'HMC neg', exames_imagem: 'RX: consolidação', atualizacao_problemas: 'Sem novos', metas: 'Meta', acoes: 'Ação',
    }),
  ] });
  const row = PainelCore.newEvolucaoForToday(bed, '2026-11-11');
  assert.match(row.id, /^[0-9a-f-]{36}$/);
  assert.deepStrictEqual(Object.assign({}, row, { id: 'x' }), evo('x', '2026-11-11', {
    problemas: '1. PNM', historia_internacao: 'HDA', exames_lab: 'Hb 9', culturas: 'HMC neg', exames_imagem: 'RX: consolidação',
  }));
  assert.strictEqual(bed.evolucoes.length, 3);
  assert.strictEqual(bed.evolucoes[2], row, 'a linha nova fica no leito');
});

test('newEvolucaoForToday: se hoje já existe, devolve a mesma linha sem duplicar', () => {
  const bed = PainelCore.migrateBed({ patientName: 'Ana', evolucoes: [evo('e1', '2026-11-11', { metas: 'Meta' })] });
  const row = PainelCore.newEvolucaoForToday(bed, '2026-11-11');
  assert.strictEqual(row, bed.evolucoes[0]);
  assert.strictEqual(bed.evolucoes.length, 1);
  assert.strictEqual(row.metas, 'Meta');
});

test('newEvolucaoForToday: sem linha anterior, cria a de hoje toda vazia', () => {
  const bed = PainelCore.migrateBed({ patientName: 'Ana' });
  const row = PainelCore.newEvolucaoForToday(bed, '2026-11-11');
  assert.deepStrictEqual(Object.assign({}, row, { id: 'x' }), evo('x', '2026-11-11'));
});
