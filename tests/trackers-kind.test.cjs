const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

const SEP = '';

function makeState(trackers) {
  return {
    beds: [{
      patientId: 'p1', bedNumber: '1012-A', patientName: 'Ana Braga', age: 60,
      admitDate: '2026-08-20', hpp: '', anamneseInicial: '', dischargeForecast: '',
      isArchived: false, archiveReason: null, notes: '',
      problems: [], trackers: trackers, exams: [], condutas: [], rawTexts: [], generatedDocs: [],
    }],
    deletedPatientIds: [], syncedPatientIds: ['p1'], syncBase: {}, cloudArchived: {},
  };
}

function emptyPull(patch) {
  return Object.assign({
    patients: [{ id: 'p1', bed_number: '1012-A', initials: 'AB', age: 60, admit_date: '2026-08-20', hpp: '', anamnese_inicial: '', discharge_forecast: null, status: 'internado' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [],
  }, patch || {});
}

test('buildPushPayload: dispositivo sem kind envia kind "device"', () => {
  const state = makeState([{ id: 'd1', type: 'device', name: 'CVC', installDate: '2026-08-20' }]);
  const out = PainelCore.buildPushPayload(state);
  assert.strictEqual(out.devices.length, 1);
  assert.strictEqual(out.devices[0].kind, 'device');
});

test('buildPushPayload: procedimento envia kind "procedimento"', () => {
  const state = makeState([{ id: 'd1', type: 'device', kind: 'procedimento', name: 'LE', installDate: '2026-08-20' }]);
  const out = PainelCore.buildPushPayload(state);
  assert.strictEqual(out.devices[0].kind, 'procedimento');
});

test('applyPull: kind do banco chega ao tracker local (default "device" quando ausente)', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-08-27');
  const pulled = emptyPull({
    devices: [
      { id: 'd1', patient_id: 'p1', nome: 'LE', install_date: '2026-08-20', removal_date: null, kind: 'procedimento', ordem: 0 },
      { id: 'd2', patient_id: 'p1', nome: 'CVC', install_date: '2026-08-21', removal_date: null, ordem: 1 },
    ],
  });
  PainelCore.applyPull(state, pulled);
  const trackers = state.beds[0].trackers;
  assert.strictEqual(trackers[0].kind, 'procedimento');
  assert.strictEqual(trackers[1].kind, 'device');
});

test('buildSyncBase: hash de dispositivo comum é o mesmo de antes da coluna kind', () => {
  const state = makeState([{ id: 'd1', type: 'device', name: 'CVC', installDate: '2026-08-20', removalDate: '' }]);
  const base = PainelCore.buildSyncBase(state);
  const expected = PainelCore.hash8(['CVC', '2026-08-20', ''].join(SEP));
  assert.strictEqual(base.p1.rows.devices.d1, expected);
});

test('buildSyncBase: procedimento tem hash diferente do mesmo item como dispositivo', () => {
  const dev = makeState([{ id: 'd1', type: 'device', name: 'LE', installDate: '2026-08-20' }]);
  const proc = makeState([{ id: 'd1', type: 'device', kind: 'procedimento', name: 'LE', installDate: '2026-08-20' }]);
  assert.notStrictEqual(
    PainelCore.buildSyncBase(dev).p1.rows.devices.d1,
    PainelCore.buildSyncBase(proc).p1.rows.devices.d1
  );
});

test('mergeStates: mudança de kind no banco vence sobre linha local intocada', () => {
  const state = makeState([{ id: 'd1', type: 'device', name: 'LE', installDate: '2026-08-20' }]);
  state.syncBase = PainelCore.buildSyncBase(state);
  const pulled = emptyPull({
    devices: [{ id: 'd1', patient_id: 'p1', nome: 'LE', install_date: '2026-08-20', removal_date: null, kind: 'procedimento', ordem: 0 }],
  });
  PainelCore.mergeStates(state, pulled);
  assert.strictEqual(state.beds[0].trackers[0].kind, 'procedimento');
});
