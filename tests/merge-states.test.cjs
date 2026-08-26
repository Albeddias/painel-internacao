const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// Estado local A sincronizado, com foto tirada; depois cada lado muda algo.
function syncedFixture() {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed({
      patientId: 'p1015', bedNumber: '1015-A', patientName: 'Ana Braga', age: 60,
      admitDate: '2026-08-20', hpp: 'HAS', problems: [{ id: 'pr1', descricao: 'PNM', status: 'ativo', plano: '', ordem: 0 }],
      exams: [], rawTexts: [], condutas: [], trackers: [], notes: 'Estável.',
    }),
    PainelCore.migrateBed({
      patientId: 'p2001', bedNumber: '2001-B', patientName: 'Bruno Costa', age: 70,
      admitDate: '2026-08-19', hpp: '', problems: [], exams: [], condutas: [], trackers: [],
      rawTexts: [{ id: 'rt-old', tipo: 'evolucao', data: '2026-08-19', texto: 'Antigo.' }], notes: '',
    }),
  ] }, '2026-08-25');
  state.syncedPatientIds = ['p1015', 'p2001'];
  state.syncBase = PainelCore.buildSyncBase(state);
  // O banco espelha o estado sincronizado:
  const pulled = {
    patients: [
      { id: 'p1015', bed_number: '1015-A', initials: 'AB', age: 60, admit_date: '2026-08-20', hpp: 'HAS', anamnese_inicial: '', discharge_forecast: null, status: 'internado' },
      { id: 'p2001', bed_number: '2001-B', initials: 'BC', age: 70, admit_date: '2026-08-19', hpp: '', anamnese_inicial: '', discharge_forecast: null, status: 'internado' },
    ],
    problems: [{ id: 'pr1', patient_id: 'p1015', descricao: 'PNM', status: 'ativo', plano: '', ordem: 0 }],
    antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
    notes: [{ patient_id: 'p1015', texto: 'Estável.' }, { patient_id: 'p2001', texto: '' }],
    raw_texts: [{ id: 'rt-old', patient_id: 'p2001', tipo: 'evolucao', data: '2026-08-19', texto: 'Antigo.' }],
    generated_docs: [],
  };
  return { state, pulled };
}

test('cenário do incidente 1015: exames locais novos + textos novos no banco — nada se perde', () => {
  const { state, pulled } = syncedFixture();
  // Celular insere exames no 1015 (não sincronizados):
  state.beds[0].exams.push({ id: 'lx', type: 'lab', date: '2026-08-25', results: [{ name: 'Hb', value: '9' }] });
  // A IA/outro aparelho colou um texto novo no 2001, direto no banco:
  pulled.raw_texts.push({ id: 'rt-novo', patient_id: 'p2001', tipo: 'evolucao', data: '2026-08-25', texto: 'Novo.' });
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].exams.length, 1, 'exame local do 1015 preservado');
  assert.deepStrictEqual(state.beds[1].rawTexts.map(r => r.id).sort(), ['rt-novo', 'rt-old']);
  const payload = PainelCore.buildPushPayload(state);
  assert.strictEqual(payload.exams.filter(e => e.patient_id === 'p1015').length, 1);
  assert.strictEqual(payload.raw_texts.filter(r => r.patient_id === 'p2001').length, 2, 'push não apagaria o texto novo');
});

test('deleção remota de linha propaga; deleção local sobrevive à mescla', () => {
  const { state, pulled } = syncedFixture();
  pulled.problems = []; // problema pr1 deletado no banco
  state.beds[1].rawTexts = []; // texto rt-old deletado localmente
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].problems.length, 0, 'deleção remota aplicada');
  assert.strictEqual(state.beds[1].rawTexts.length, 0, 'deleção local mantida');
});

test('scalars: HPP editado localmente vence; intocado adota o banco', () => {
  const { state, pulled } = syncedFixture();
  state.beds[0].hpp = 'HAS / DM2';                 // editado aqui
  pulled.patients[0].hpp = 'HAS (banco)';          // editado lá também → local vence
  pulled.patients[1].hpp = 'DPOC (banco)';         // só lá → banco vence
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].hpp, 'HAS / DM2');
  assert.strictEqual(state.beds[1].hpp, 'DPOC (banco)');
});

test('idempotência: mesclar duas vezes com o mesmo pull não muda nada', () => {
  const { state, pulled } = syncedFixture();
  state.beds[0].exams.push({ id: 'lx', type: 'lab', date: '2026-08-25', results: [{ name: 'Hb', value: '9' }] });
  // buildPushPayload gera id novo (uuid) para cada linha de lab a cada chamada —
  // compara-se o payload com os ids de exames neutralizados.
  const snapshot = () => {
    const p = PainelCore.buildPushPayload(state);
    return JSON.stringify(Object.assign({}, p, { exams: p.exams.map(e => Object.assign({}, e, { id: null })) }));
  };
  PainelCore.mergeStates(state, pulled);
  const once = snapshot();
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(snapshot(), once);
});

test('sem foto: união — nada é deletado de lado nenhum', () => {
  const { state, pulled } = syncedFixture();
  state.syncBase = {};
  pulled.problems = []; // sumiu do banco, mas sem foto não dá pra saber se foi deleção
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].problems.length, 1, 'linha local preservada');
});

test('tombstone de paciente continua valendo na mescla', () => {
  const { state, pulled } = syncedFixture();
  PainelCore.markPatientDeleted(state, 'p2001');
  state.beds = state.beds.filter(b => b.patientId !== 'p2001');
  PainelCore.mergeStates(state, pulled);
  assert.ok(!state.beds.find(b => b.patientId === 'p2001'), 'deletado não ressuscita');
  assert.deepStrictEqual(PainelCore.buildPushPayload(state).deletePatientIds, ['p2001']);
});

test('paciente novo no banco é adotado; deletado do banco some do aparelho', () => {
  const { state, pulled } = syncedFixture();
  pulled.patients.push({ id: 'p3', bed_number: '3003-C', initials: 'XY', age: null, admit_date: null, hpp: '', anamnese_inicial: '', discharge_forecast: null, status: 'internado' });
  pulled.patients = pulled.patients.filter(p => p.id !== 'p2001'); // deletado no banco
  PainelCore.mergeStates(state, pulled);
  assert.ok(state.beds.find(b => b.patientId === 'p3'), 'novo adotado');
  assert.ok(!state.beds.find(b => b.patientId === 'p2001'), 'deletado remotamente sai');
});

test("status 'nuvem': leito vira registro local (preserva nome) e não é readotado", () => {
  const { state, pulled } = syncedFixture();
  pulled.patients[1].status = 'nuvem';
  PainelCore.mergeStates(state, pulled);
  assert.ok(!state.beds.find(b => b.patientId === 'p2001'), 'leito removido');
  assert.strictEqual(state.cloudArchived['p2001'].nome, 'Bruno Costa', 'nome completo preservado no aparelho');
  const payload = PainelCore.buildPushPayload(state);
  assert.ok(!payload.patients.find(p => p.id === 'p2001'), 'push não toca paciente na nuvem');
});

test("restauração: status volta a 'arquivado' e a mescla readota com o nome do registro", () => {
  const { state, pulled } = syncedFixture();
  pulled.patients[1].status = 'nuvem';
  PainelCore.mergeStates(state, pulled);           // arquivou na nuvem
  pulled.patients[1].status = 'arquivado';
  PainelCore.mergeStates(state, pulled);           // trouxe de volta
  const bed = state.beds.find(b => b.patientId === 'p2001');
  assert.strictEqual(bed.patientName, 'Bruno Costa');
  assert.strictEqual(bed.isArchived, true);
  assert.ok(!state.cloudArchived['p2001'], 'registro consumido na restauração');
});

test('paciente na nuvem deletado do banco é podado do registro local', () => {
  const { state, pulled } = syncedFixture();
  pulled.patients[1].status = 'nuvem';
  PainelCore.mergeStates(state, pulled);
  pulled.patients = pulled.patients.filter(p => p.id !== 'p2001');
  PainelCore.mergeStates(state, pulled);
  assert.ok(!state.cloudArchived['p2001']);
});

test('privacidade: payload pós-mescla não contém nome completo', () => {
  const { state, pulled } = syncedFixture();
  PainelCore.mergeStates(state, pulled);
  const json = JSON.stringify(PainelCore.buildPushPayload(state));
  assert.ok(!json.includes('Ana Braga') && !json.includes('Bruno Costa'));
});
