const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

function makeBed() {
  return PainelCore.migrateBed({
    patientId: 'p1', bedNumber: '1015-B', patientName: 'Ana Braga', age: 60,
    admitDate: '2026-08-20', hpp: 'HAS', anamneseInicial: 'Admitida por PNM.',
    problems: [{ id: 'pr1', descricao: 'PNM', status: 'ativo', plano: 'ATB', ordem: 0 }],
    notes: 'Estável.',
    condutas: [{ id: 'c1', text: 'Manter ATB', done: false }],
    trackers: [{ id: 'a1', type: 'atb', name: 'Ceftriaxona', startDate: '2026-08-20', duration: 7 }],
    exams: [
      { id: 'l1', type: 'lab', date: '2026-08-21', results: [{ name: 'Hb', value: '10' }] },
      { id: 'i1', type: 'image', date: '2026-08-21', name: 'RX Tórax', summary: 'Consolidação' },
    ],
    rawTexts: [{ id: 'r1', tipo: 'evolucao', data: '2026-08-21', texto: 'Texto.' }],
  });
}

test('hash8: determinístico, 8 hex, sensível ao conteúdo', () => {
  assert.strictEqual(PainelCore.hash8('abc'), PainelCore.hash8('abc'));
  assert.match(PainelCore.hash8('abc'), /^[0-9a-f]{8}$/);
  assert.notStrictEqual(PainelCore.hash8('abc'), PainelCore.hash8('abd'));
});

test('buildSyncBase: mapeia linhas por id com hash e labs por chave de conteúdo', () => {
  const state = PainelCore.migrateState({ beds: [makeBed()] }, '2026-08-25');
  const base = PainelCore.buildSyncBase(state);
  const b = base['p1'];
  assert.ok(b, 'paciente presente na foto');
  assert.match(b.rows.problems['pr1'], /^[0-9a-f]{8}$/);
  assert.match(b.rows.antibiotics['a1'], /^[0-9a-f]{8}$/);
  assert.match(b.rows.condutas['c1'], /^[0-9a-f]{8}$/);
  assert.match(b.rows.raw_texts['r1'], /^[0-9a-f]{8}$/);
  assert.match(b.rows.examsImage['i1'], /^[0-9a-f]{8}$/);
  assert.strictEqual(b.rows.examsLab['2026-08-21Hb10'], '');
  assert.match(b.scalars, /^[0-9a-f]{8}$/);
});

test('buildSyncBase: hash de scalars muda quando um campo corrido muda', () => {
  const s1 = PainelCore.migrateState({ beds: [makeBed()] }, '2026-08-25');
  const s2 = PainelCore.migrateState({ beds: [makeBed()] }, '2026-08-25');
  s2.beds[0].hpp = 'HAS / DM2';
  assert.notStrictEqual(PainelCore.buildSyncBase(s1)['p1'].scalars,
                        PainelCore.buildSyncBase(s2)['p1'].scalars);
});

test('buildSyncBase: hash de linha muda quando o conteúdo muda, id não muda', () => {
  const s1 = PainelCore.migrateState({ beds: [makeBed()] }, '2026-08-25');
  const s2 = PainelCore.migrateState({ beds: [makeBed()] }, '2026-08-25');
  s2.beds[0].problems[0].plano = 'ATB D3';
  const b1 = PainelCore.buildSyncBase(s1)['p1'], b2 = PainelCore.buildSyncBase(s2)['p1'];
  assert.notStrictEqual(b1.rows.problems['pr1'], b2.rows.problems['pr1']);
});

test('migrateState: inicializa syncBase e cloudArchived; resetLocalSync limpa foto e preserva nomes', () => {
  const state = PainelCore.migrateState({}, '2026-08-25');
  assert.deepStrictEqual(state.syncBase, {});
  assert.deepStrictEqual(state.cloudArchived, {});
  state.syncBase = { p1: {} };
  state.cloudArchived = { p1: { nome: 'Ana Braga', iniciais: 'AB', leito: '1015-B' } };
  PainelCore.resetLocalSync(state);
  assert.deepStrictEqual(state.syncBase, {});
  assert.deepStrictEqual(state.cloudArchived, { p1: { nome: 'Ana Braga', iniciais: 'AB', leito: '1015-B' } });
});
