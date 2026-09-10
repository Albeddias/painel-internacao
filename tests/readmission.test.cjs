const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

function altaBed(over) {
  return PainelCore.migrateBed(Object.assign({
    patientId: 'p-old', bedNumber: '1012-A', patientName: 'Mariana Silva Dias', age: 32,
    admitDate: '2026-06-07', hpp: 'HAS, DM2', anamneseInicial: 'Admitida com dispneia.',
    problems: [
      { id: 'pr1', descricao: 'Pneumonia', status: 'resolvido', plano: '', ordem: 0 },
      { id: 'pr2', descricao: 'DRC 3b', status: 'cronico', plano: 'Nefro ambulatorial', ordem: 1 },
      { id: 'pr3', descricao: 'Anemia', status: 'ativo', plano: '', ordem: 2 },
    ],
    notes: 'Evolução estável.',
    condutas: [{ id: 'c1', text: 'Manter ATB', done: true }],
    trackers: [
      { id: 'a1', type: 'atb', name: 'Ceftriaxona', startDate: '2026-06-07', duration: 7, endDate: '' },
      { id: 'a2', type: 'atb', name: 'Azitromicina', startDate: '2026-06-07', duration: 5, endDate: '2026-06-11' },
      { id: 'c1', type: 'culture', name: 'Hemocultura', collectionDate: '2026-06-08', result: 'KPC' },
      { id: 'd1', type: 'device', name: 'CVC', installDate: '2026-06-07', removalDate: '' },
      { id: 'd2', type: 'device', kind: 'procedimento', name: 'Colecistectomia', installDate: '2026-06-10', removalDate: '' },
    ],
    exams: [
      { id: 'l1', type: 'lab', date: '2026-06-10', results: [{ name: 'Hb', value: '9.5' }] },
      { id: 'i1', type: 'image', date: '2026-06-09', name: 'TC Tórax', summary: 'Consolidação' },
    ],
    rawTexts: [{ id: 'r1', tipo: 'evolucao', data: '2026-06-11', texto: 'Texto cru.' }],
    generatedDocs: [{ id: 'g1', tipo: 'sumario_alta', conteudo: '[NOME] ...', createdAt: '2026-06-12' }],
    isArchived: true, archiveReason: 'alta', dischargedAt: '2026-06-12',
  }, over || {}));
}

// ---- Task 2: modelo local + sync dos campos --------------------------------

test('migrateBed: personId nasce null e é preservado', () => {
  assert.strictEqual(PainelCore.migrateBed({ patientName: 'X' }).personId, null);
  assert.strictEqual(PainelCore.migrateBed({ patientName: 'X', personId: 'per-1' }).personId, 'per-1');
});

test('buildPushPayload: envia person_id e discharge_date (null quando vazios)', () => {
  const a = altaBed({ personId: 'per-1' });
  const b = altaBed({ patientId: 'p-2', personId: null, dischargedAt: '', isArchived: false, archiveReason: null });
  const state = PainelCore.migrateState({ beds: [a, b] }, '2026-09-10');
  const p = PainelCore.buildPushPayload(state);
  assert.strictEqual(p.patients[0].person_id, 'per-1');
  assert.strictEqual(p.patients[0].discharge_date, '2026-06-12');
  assert.strictEqual(p.patients[1].person_id, null);
  assert.strictEqual(p.patients[1].discharge_date, null);
});

test('applyPull: lê person_id e discharge_date do banco', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-09-10');
  PainelCore.applyPull(state, {
    patients: [{ id: 'p-old', bed_number: '1012-A', initials: 'MSD', age: 32, admit_date: '2026-06-07', hpp: '',
      anamnese_inicial: '', discharge_forecast: null, status: 'alta', person_id: 'per-1', discharge_date: '2026-06-12' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [],
  });
  assert.strictEqual(state.beds[0].personId, 'per-1');
  assert.strictEqual(state.beds[0].dischargedAt, '2026-06-12');
  assert.strictEqual(state.beds[0].archiveReason, 'alta');
});

test('applyPull: person_id/discharge_date ausentes viram null/""', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-09-10');
  PainelCore.applyPull(state, {
    patients: [{ id: 'p-old', bed_number: '1012-A', initials: 'MSD', status: 'arquivado' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [],
  });
  assert.strictEqual(state.beds[0].personId, null);
  assert.strictEqual(state.beds[0].dischargedAt, '');
});

test('syncBase: hash de escalares muda quando personId ou dischargedAt mudam', () => {
  const mk = (over) => PainelCore.migrateState({ beds: [altaBed(over)] }, '2026-09-10');
  const h = (s) => PainelCore.buildSyncBase(s)['p-old'].scalars;
  const base = h(mk({}));
  assert.notStrictEqual(h(mk({ personId: 'per-1' })), base);
  assert.notStrictEqual(h(mk({ dischargedAt: '2026-06-13' })), base);
  assert.strictEqual(h(mk({})), base, 'determinístico');
});

// ---- Task 3: mescla ---------------------------------------------------------

function pulledFor(bed, over) {
  return {
    patients: [Object.assign({ id: bed.patientId, bed_number: bed.bedNumber, initials: 'MSD', age: bed.age,
      admit_date: bed.admitDate, hpp: bed.hpp, anamnese_inicial: bed.anamneseInicial, discharge_forecast: null,
      status: 'alta', person_id: null, discharge_date: bed.dischargedAt || null }, over || {})],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [],
    notes: [{ patient_id: bed.patientId, texto: bed.notes }], raw_texts: [], generated_docs: [], prefs: [],
  };
}

test('mergeStates: adota person_id do banco quando local é null, mesmo com scalars locais alterados', () => {
  const bed = altaBed({ problems: [], trackers: [], exams: [], rawTexts: [], condutas: [], generatedDocs: [] });
  const state = PainelCore.migrateState({ beds: [bed] }, '2026-09-10');
  state.syncedPatientIds = ['p-old'];
  state.syncBase = PainelCore.buildSyncBase(state);
  state.beds[0].hpp = 'HAS, DM2, DPOC'; // edição local → scalars "tocados"
  PainelCore.mergeStates(state, pulledFor(bed, { person_id: 'per-1' }));
  assert.strictEqual(state.beds[0].personId, 'per-1');
  assert.strictEqual(state.beds[0].hpp, 'HAS, DM2, DPOC', 'edição local preservada');
});

test('mergeStates: personId recém-criado pelo Reinternar (local tocado) vence o null do banco', () => {
  const bed = altaBed({ problems: [], trackers: [], exams: [], rawTexts: [], condutas: [], generatedDocs: [] });
  const state = PainelCore.migrateState({ beds: [bed] }, '2026-09-10');
  state.syncedPatientIds = ['p-old'];
  state.syncBase = PainelCore.buildSyncBase(state);
  state.beds[0].personId = 'per-1'; // Reinternar aplicou previousPatch depois da última foto
  PainelCore.mergeStates(state, pulledFor(bed, { person_id: null }));
  assert.strictEqual(state.beds[0].personId, 'per-1');
  assert.strictEqual(PainelCore.buildPushPayload(state).patients[0].person_id, 'per-1');
});

test('mergeStates: foto na fórmula antiga (sem personId/dischargedAt) não perde nada quando local = banco', () => {
  const bed = altaBed({ problems: [], trackers: [], exams: [], rawTexts: [], condutas: [], generatedDocs: [] });
  const state = PainelCore.migrateState({ beds: [bed] }, '2026-09-10');
  state.syncedPatientIds = ['p-old'];
  // Simula foto gravada pela versão anterior do app: hash sem os campos novos.
  const old = PainelCore.hash8(['1012-A', '32', '2026-06-07', 'HAS, DM2', 'Admitida com dispneia.', '', 'alta', 'Evolução estável.'].join('\u0001')); // mesmo separador interno de j()
  state.syncBase = { 'p-old': { rows: { problems: {}, antibiotics: {}, cultures: {}, devices: {}, condutas: {}, raw_texts: {}, examsImage: {}, examsLab: {} }, scalars: old } };
  PainelCore.mergeStates(state, pulledFor(bed, { discharge_date: null })); // banco ainda sem discharge_date
  assert.strictEqual(state.beds[0].hpp, 'HAS, DM2');
  assert.strictEqual(state.beds[0].dischargedAt, '2026-06-12', 'data de alta local sobrevive e vai subir');
  assert.strictEqual(PainelCore.buildPushPayload(state).patients[0].discharge_date, '2026-06-12');
});

test('mergeStates: paciente nuvem registra personId em cloudArchived', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-09-10');
  state.cloudArchived = {};
  PainelCore.mergeStates(state, {
    patients: [{ id: 'p-cloud', bed_number: '1012-A', initials: 'MSD', status: 'nuvem', person_id: 'per-1' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [], prefs: [],
  });
  assert.strictEqual(state.cloudArchived['p-cloud'].personId, 'per-1');
});

test('mergeStates: nuvem sem person_id no banco preserva o personId que o aparelho já tinha', () => {
  const bed = mkBed({ patientId: 'p-1', personId: 'per-1', patientName: 'Fulano de Tal' });
  const state = PainelCore.migrateState({ beds: [bed] }, '2026-09-10');
  state.syncedPatientIds = ['p-1'];
  state.cloudArchived = {};
  PainelCore.mergeStates(state, {
    patients: [{ id: 'p-1', bed_number: '1001', initials: 'FT', status: 'nuvem', person_id: null }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [], prefs: [],
  });
  assert.strictEqual(state.cloudArchived['p-1'].personId, 'per-1');
  assert.strictEqual(state.cloudArchived['p-1'].nome, 'Fulano de Tal');
  assert.ok(!state.beds.some(function (b) { return b.patientId === 'p-1'; }), 'leito removido de state.beds');
});

test('mergeStates: nuvem já conhecida ganha personId do banco sem perder o nome guardado', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-09-10');
  state.cloudArchived = { 'p-2': { nome: 'Ciclana Souza', iniciais: 'CS', leito: '2002', personId: null } };
  PainelCore.mergeStates(state, {
    patients: [{ id: 'p-2', bed_number: '2002', initials: 'CS', status: 'nuvem', person_id: 'per-2' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [], prefs: [],
  });
  assert.strictEqual(state.cloudArchived['p-2'].personId, 'per-2');
  assert.strictEqual(state.cloudArchived['p-2'].nome, 'Ciclana Souza');
});

test('mergeStates: reinternação feita noutro aparelho herda o nome de um leito da mesma pessoa', () => {
  const bed = altaBed({ problems: [], trackers: [], exams: [], rawTexts: [], condutas: [], generatedDocs: [] });
  const state = PainelCore.migrateState({ beds: [bed] }, '2026-09-10');
  state.syncedPatientIds = ['p-old'];
  state.syncBase = PainelCore.buildSyncBase(state);
  const pulled = pulledFor(bed, { person_id: 'p-old' });
  pulled.patients.push({
    id: 'p-new', person_id: 'p-old', status: 'internado', initials: 'MSD', bed_number: '2004-B',
    age: 32, admit_date: '2026-09-10', hpp: '', anamnese_inicial: '', discharge_forecast: null, discharge_date: null,
  });
  pulled.notes.push({ patient_id: 'p-new', texto: '' });
  PainelCore.mergeStates(state, pulled);
  const newBed = state.beds.find(function (b) { return b.patientId === 'p-new'; });
  assert.ok(newBed, 'novo leito adotado');
  assert.strictEqual(newBed.patientName, 'Mariana Silva Dias', 'nome emprestado do leito antigo da mesma pessoa');
  assert.strictEqual(newBed.personId, 'p-old');
});

test('mergeStates: adoção sem leito local da mesma pessoa cai para as iniciais (comportamento antigo preservado)', () => {
  const state = PainelCore.migrateState({ beds: [] }, '2026-09-10');
  state.cloudArchived = {};
  PainelCore.mergeStates(state, {
    patients: [{ id: 'p-new', person_id: 'p-unknown', status: 'internado', initials: 'MSD', bed_number: '2004-B' }],
    problems: [], antibiotics: [], cultures: [], devices: [], exams: [], condutas: [], notes: [], raw_texts: [], generated_docs: [], prefs: [],
  });
  const newBed = state.beds.find(function (b) { return b.patientId === 'p-new'; });
  assert.strictEqual(newBed.patientName, 'MSD');
});

// ---- Task 4: buildReadmission ----------------------------------------------

test('buildReadmission: copia identidade, HPP, exames, trackers e só problemas crônicos', () => {
  const prev = altaBed();
  const { newBed, previousPatch } = PainelCore.buildReadmission(prev, '2004-B', '2026-09-10');
  assert.ok(newBed.patientId && newBed.patientId !== prev.patientId);
  assert.strictEqual(previousPatch.personId, 'p-old', 'anterior sem personId ganha o próprio id');
  assert.strictEqual(newBed.personId, 'p-old');
  assert.strictEqual(newBed.bedNumber, '2004-B');
  assert.strictEqual(newBed.patientName, 'Mariana Silva Dias');
  assert.strictEqual(newBed.age, 32);
  assert.strictEqual(newBed.hpp, 'HAS, DM2');
  assert.strictEqual(newBed.admitDate, '2026-09-10');
  assert.deepStrictEqual(newBed.problems.map(p => [p.descricao, p.status, p.plano, p.ordem]), [['DRC 3b', 'cronico', 'Nefro ambulatorial', 0]]);
  assert.notStrictEqual(newBed.problems[0].id, 'pr2', 'id novo');
  assert.strictEqual(newBed.exams.length, 2);
  assert.ok(newBed.exams.every(e => e.id !== 'l1' && e.id !== 'i1'), 'exames com ids novos');
  assert.deepStrictEqual(newBed.exams[0].results, [{ name: 'Hb', value: '9.5' }]);
  assert.strictEqual(newBed.trackers.length, 5);
  assert.ok(newBed.trackers.every(t => !['a1', 'a2', 'c1', 'd1', 'd2'].includes(t.id)), 'trackers com ids novos');
});

test('buildReadmission: fecha ATB e dispositivos abertos com a data da alta anterior; cultura intacta', () => {
  const { newBed } = PainelCore.buildReadmission(altaBed(), '2004-B', '2026-09-10');
  const byName = Object.fromEntries(newBed.trackers.map(t => [t.name, t]));
  assert.strictEqual(byName['Ceftriaxona'].endDate, '2026-06-12');
  assert.strictEqual(byName['Azitromicina'].endDate, '2026-06-11', 'já fechado não muda');
  assert.strictEqual(byName['CVC'].removalDate, '2026-06-12');
  assert.strictEqual(byName['Colecistectomia'].removalDate, '2026-06-12');
  assert.strictEqual(byName['Colecistectomia'].kind, 'procedimento');
  assert.strictEqual(byName['Hemocultura'].result, 'KPC');
  assert.strictEqual(byName['Hemocultura'].removalDate, undefined);
});

test('buildReadmission: sem data de alta anterior, fecha com todayStr', () => {
  const { newBed } = PainelCore.buildReadmission(altaBed({ dischargedAt: '', archiveReason: 'arquivado' }), '2004-B', '2026-09-10');
  assert.strictEqual(newBed.trackers.find(t => t.name === 'CVC').removalDate, '2026-09-10');
});

test('buildReadmission: zera o que é da internação (HDA, condutas, notas, textos, docs, flags)', () => {
  const { newBed } = PainelCore.buildReadmission(altaBed(), '2004-B', '2026-09-10');
  assert.strictEqual(newBed.anamneseInicial, '');
  assert.strictEqual(newBed.dischargeForecast, '');
  assert.deepStrictEqual(newBed.condutas, []);
  assert.strictEqual(newBed.notes, '');
  assert.deepStrictEqual(newBed.rawTexts, []);
  assert.deepStrictEqual(newBed.generatedDocs, []);
  assert.strictEqual(newBed.isArchived, false);
  assert.strictEqual(newBed.archiveReason, null);
  assert.strictEqual(newBed.dischargedAt, '');
  assert.strictEqual(newBed.isVisited, false);
  assert.strictEqual(newBed.reminderDate, '');
  assert.deepStrictEqual(newBed.externalDoctor, { active: false, name: '' });
  assert.deepStrictEqual(newBed.checks, { ev: false, p: false, ex: false, tev: false });
  assert.strictEqual(newBed.isAnamneseMinimized, false, 'HDA aberta para preencher');
});

test('buildReadmission: mantém personId existente e não muta o registro anterior', () => {
  const prev = altaBed({ personId: 'per-1' });
  const snapshot = JSON.stringify(prev);
  const { newBed, previousPatch } = PainelCore.buildReadmission(prev, '2004-B', '2026-09-10');
  assert.strictEqual(previousPatch.personId, 'per-1');
  assert.strictEqual(newBed.personId, 'per-1');
  assert.strictEqual(JSON.stringify(prev), snapshot);
  newBed.exams[0].results[0].value = '7'; // cópia profunda
  assert.strictEqual(prev.exams[0].results[0].value, '9.5');
});

test('buildReadmission: sem personId nem patientId (leito nomeado e arquivado na mesma sessão), gera personId novo', () => {
  const prev = altaBed({ patientId: null, personId: null });
  const { newBed, previousPatch } = PainelCore.buildReadmission(prev, '2004-B', '2026-09-10');
  assert.strictEqual(typeof previousPatch.personId, 'string');
  assert.ok(previousPatch.personId.length > 0, 'personId não vazio');
  assert.strictEqual(newBed.personId, previousPatch.personId);
  assert.notStrictEqual(newBed.patientId, previousPatch.personId, 'patientId do novo leito é outro uuid');
});

// ---- Task 5: agrupamento ----------------------------------------------------

function mkBed(over) {
  return PainelCore.migrateBed(Object.assign({ patientName: 'Fulano', problems: [], trackers: [], exams: [] }, over));
}

test('personAdmissions: mais recente primeiro; desempate por alta e depois posição', () => {
  const beds = [
    mkBed({ patientId: 'a', personId: 'P', admitDate: '2026-01-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-01-10' }),
    mkBed({ patientId: 'x', personId: 'Q', admitDate: '2026-05-01' }),
    mkBed({ patientId: 'b', personId: 'P', admitDate: '2026-03-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-03-05' }),
    mkBed({ patientId: 'c', personId: 'P', admitDate: '2026-03-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-03-09' }),
    mkBed({ patientId: 'd', personId: 'P', admitDate: '2026-09-10' }),
  ];
  assert.deepStrictEqual(PainelCore.personAdmissions(beds, 'P').map(x => x.bed.patientId), ['d', 'c', 'b', 'a']);
  assert.deepStrictEqual(PainelCore.personAdmissions(beds, 'P').map(x => x.index), [4, 3, 2, 0]);
  assert.deepStrictEqual(PainelCore.personAdmissions(beds, null), []);
  assert.deepStrictEqual(PainelCore.previousAdmissions(beds, beds[4]).map(x => x.bed.patientId), ['c', 'b', 'a']);
  assert.deepStrictEqual(PainelCore.previousAdmissions(beds, beds[1]), []);
});

test('groupArchived: uma linha por pessoa (mais recente arquivada), sem personId individual, ordinal correto', () => {
  const beds = [
    mkBed({ patientId: 'a', personId: 'P', admitDate: '2026-01-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-01-10' }),
    mkBed({ patientId: 's', admitDate: '2026-02-01', isArchived: true, archiveReason: 'arquivado' }),
    mkBed({ patientId: 'b', personId: 'P', admitDate: '2026-03-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-03-09' }),
    mkBed({ patientId: 'd', personId: 'P', admitDate: '2026-09-10' }), // internado agora: não entra em Arquivados
    mkBed({ patientId: 't', admitDate: '2026-04-01' }),
  ];
  const g = PainelCore.groupArchived(beds);
  assert.strictEqual(g.length, 2);
  // Ordem por latestIndex ascendente: 's' (idx1) vem antes do grupo de 'P' (latest 'b', idx2).
  assert.strictEqual(g[0].latest.patientId, 's');
  assert.strictEqual(g[0].count, 1);
  assert.strictEqual(g[0].ordinal, 1);
  assert.strictEqual(g[1].latest.patientId, 'b');
  assert.strictEqual(g[1].latestIndex, 2);
  assert.strictEqual(g[1].count, 2, 'só as arquivadas');
  assert.strictEqual(g[1].ordinal, 2, 'b é a 2ª internação da pessoa (d é a 3ª, ativa)');
  assert.deepStrictEqual(g[1].members.map(m => m.bed.patientId), ['b', 'a']);
});

test('groupArchived: grupo aparece na posição da internação arquivada mais recente, não da mais antiga', () => {
  const beds = [
    mkBed({ patientId: 'a', personId: 'P', admitDate: '2026-01-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-01-10' }), // idx0
    mkBed({ patientId: 's', admitDate: '2026-02-01', isArchived: true, archiveReason: 'arquivado' }), // idx1
    mkBed({ patientId: 'b', personId: 'P', admitDate: '2026-03-01', isArchived: true, archiveReason: 'alta', dischargedAt: '2026-03-09' }), // idx2, readmissão mais recente de P
  ];
  const g = PainelCore.groupArchived(beds);
  assert.deepStrictEqual(g.map(x => x.latest.patientId), ['s', 'b'], 'ordenado por latestIndex, não pelo primeiro encontro');
});

test('groupArchived: filtro bate em qualquer internação do grupo', () => {
  const beds = [
    mkBed({ patientId: 'a', personId: 'P', bedNumber: '1001', admitDate: '2026-01-01', isArchived: true, archiveReason: 'alta' }),
    mkBed({ patientId: 'b', personId: 'P', bedNumber: '2002', admitDate: '2026-03-01', isArchived: true, archiveReason: 'alta' }),
    mkBed({ patientId: 's', bedNumber: '3003', admitDate: '2026-02-01', isArchived: true, archiveReason: 'arquivado' }),
  ];
  const g = PainelCore.groupArchived(beds, b => (b.bedNumber || '').includes('1001'));
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].latest.patientId, 'b');
  assert.strictEqual(PainelCore.groupArchived(beds, () => false).length, 0);
});

test('groupCloudArchived: agrupa por personId e prefere o registro com nome', () => {
  const g = PainelCore.groupCloudArchived({
    'c1': { nome: '', iniciais: 'MSD', leito: '1001', personId: 'P' },
    'c2': { nome: 'Mariana Silva Dias', iniciais: 'MSD', leito: '2002', personId: 'P' },
    'c3': { nome: 'Outro', iniciais: 'O', leito: '3003' },
  });
  assert.strictEqual(g.length, 2);
  assert.deepStrictEqual(g[0].ids, ['c1', 'c2']);
  assert.strictEqual(g[0].reg.nome, 'Mariana Silva Dias');
  assert.strictEqual(g[0].count, 2);
  assert.deepStrictEqual(g[1], { ids: ['c3'], reg: { nome: 'Outro', iniciais: 'O', leito: '3003' }, count: 1 });
});
