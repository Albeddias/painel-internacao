const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// alergias / medicacoes_previas: campos de texto do paciente com três-vias POR CAMPO
// (fora do hash geral dos scalars, para a atualização do app não apagar o que já está no banco).

function patientRow(over) {
  return Object.assign({
    id: 'p1', bed_number: '1012-A', initials: 'AB', age: 60, admit_date: '2026-11-01', hpp: 'HAS',
    anamnese_inicial: '', discharge_forecast: null, status: 'internado', alergias: '', medicacoes_previas: '',
  }, over || {});
}
function pull(patientOver, notes) {
  return {
    patients: [patientRow(patientOver)],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
    notes: [{ patient_id: 'p1', texto: notes == null ? 'Estável.' : notes }], raw_texts: [], generated_docs: [], evolucoes: [],
  };
}
function syncedState(bedOver) {
  const state = PainelCore.migrateState({ beds: [
    PainelCore.migrateBed(Object.assign({
      patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga', age: 60, admitDate: '2026-11-01', hpp: 'HAS', notes: 'Estável.',
    }, bedOver || {})),
  ] }, '2026-11-11');
  state.syncedPatientIds = ['p1'];
  state.syncBase = PainelCore.buildSyncBase(state);
  return state;
}

test('migrateBed: alergias e medicacoesPrevias nascem vazios', () => {
  const bed = PainelCore.migrateBed({ patientName: 'Ana' });
  assert.strictEqual(bed.alergias, '');
  assert.strictEqual(bed.medicacoesPrevias, '');
});

test('buildPushPayload: paciente leva alergias e medicacoes_previas', () => {
  const state = syncedState({ alergias: 'Dipirona', medicacoesPrevias: 'Losartana 50 mg 12/12h' });
  const p = PainelCore.buildPushPayload(state).patients[0];
  assert.strictEqual(p.alergias, 'Dipirona');
  assert.strictEqual(p.medicacoes_previas, 'Losartana 50 mg 12/12h');
});

test('applyPull: campos do banco entram no leito', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-11-11');
  PainelCore.applyPull(state, pull({ alergias: 'Penicilina', medicacoes_previas: 'AAS 100 mg' }));
  assert.strictEqual(state.beds[0].alergias, 'Penicilina');
  assert.strictEqual(state.beds[0].medicacoesPrevias, 'AAS 100 mg');
});

test('a foto dos scalars não muda com os campos novos (fotos antigas continuam válidas)', () => {
  const sem = syncedState();
  const com = syncedState({ alergias: 'Dipirona', medicacoesPrevias: 'AAS' });
  assert.strictEqual(sem.syncBase.p1.scalars, com.syncBase.p1.scalars);
});

test('mergeStates: 1ª sync após a atualização — vazio local adota o banco mesmo com outros campos editados', () => {
  const state = syncedState();
  delete state.syncBase.p1.fields;           // foto tirada pela versão antiga do app
  state.beds[0].notes = 'Nota editada hoje.'; // scalars locais editados → local vence nos scalars
  PainelCore.mergeStates(state, pull({ alergias: 'Dipirona', medicacoes_previas: 'AAS 100 mg' }));
  const bed = state.beds[0];
  assert.strictEqual(bed.alergias, 'Dipirona');
  assert.strictEqual(bed.medicacoesPrevias, 'AAS 100 mg');
  assert.strictEqual(bed.notes, 'Nota editada hoje.', 'a nota local não é atropelada');
  assert.strictEqual(PainelCore.buildPushPayload(state).patients[0].alergias, 'Dipirona', 'o push não apaga a alergia do banco');
});

test('mergeStates: campo intocado adota o banco, ainda que os scalars locais tenham sido editados', () => {
  const state = syncedState({ alergias: 'Dipirona' });
  state.beds[0].notes = 'Nota editada hoje.';
  PainelCore.mergeStates(state, pull({ alergias: 'Dipirona, AAS' }));
  assert.strictEqual(state.beds[0].alergias, 'Dipirona, AAS');
  assert.strictEqual(state.beds[0].notes, 'Nota editada hoje.');
});

test('mergeStates: campo editado no aparelho vence; o resto do paciente segue adotando o banco', () => {
  const state = syncedState({ alergias: 'Dipirona' });
  state.beds[0].alergias = 'Dipirona, Iodo';
  PainelCore.mergeStates(state, pull({ alergias: 'Dipirona, AAS', hpp: 'HAS, DM2' }));
  assert.strictEqual(state.beds[0].alergias, 'Dipirona, Iodo');
  assert.strictEqual(state.beds[0].hpp, 'HAS, DM2');
});

test('mergeStates: apagar o campo no aparelho propaga (não ressuscita do banco)', () => {
  const state = syncedState({ medicacoesPrevias: 'AAS 100 mg' });
  state.beds[0].medicacoesPrevias = '';
  PainelCore.mergeStates(state, pull({ medicacoes_previas: 'AAS 100 mg' }));
  assert.strictEqual(state.beds[0].medicacoesPrevias, '');
  assert.strictEqual(PainelCore.buildPushPayload(state).patients[0].medicacoes_previas, '');
});

test('mergeStates: sem foto alguma, texto local preenchido fica', () => {
  const state = syncedState({ alergias: 'Iodo' });
  state.syncBase = {};
  PainelCore.mergeStates(state, pull({ alergias: 'Dipirona' }));
  assert.strictEqual(state.beds[0].alergias, 'Iodo');
});

test('mergeStates: paciente novo neste aparelho é adotado com os campos do banco', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-11-11');
  PainelCore.mergeStates(state, pull({ alergias: 'Látex', medicacoes_previas: 'Metformina' }));
  assert.strictEqual(state.beds[0].alergias, 'Látex');
  assert.strictEqual(state.beds[0].medicacoesPrevias, 'Metformina');
});

test('buildReadmission: alergias e medicações prévias acompanham a pessoa', () => {
  const prev = PainelCore.migrateBed({ patientId: 'p1', patientName: 'Ana Braga', alergias: 'Dipirona', medicacoesPrevias: 'AAS 100 mg' });
  const { newBed } = PainelCore.buildReadmission(prev, '2001-B', '2026-11-11');
  assert.strictEqual(newBed.alergias, 'Dipirona');
  assert.strictEqual(newBed.medicacoesPrevias, 'AAS 100 mg');
});
