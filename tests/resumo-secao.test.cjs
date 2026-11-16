const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// Resumo de uma linha no título de cada seção fechada da tela do paciente (spec 3.4).

const HOJE = '2026-11-16';
const MODELO = 'S: (Subjetivo)\n\nO: (Objetivo)\n- SSVV:\n\nA: (Avaliação)\n\nP: (Plano)\n';
const R = (bed, secao, opts) => PainelCore.resumoSecao(bed, secao, Object.assign({ hoje: HOJE }, opts));

test('resumoSecao: problemas mostra os ativos pelo nome e conta os crônicos', () => {
  const p = (descricao, status) => ({ descricao: descricao, status: status });
  assert.strictEqual(R({ problems: [p('PAC', 'ativo'), p('LRA KDIGO 2', 'ativo'), p('DM2', 'cronico'), p('ITU', 'resolvido')] }, 'problemas'), 'PAC · LRA KDIGO 2 · 1 crônico');
  assert.strictEqual(R({ problems: [p('HAS', 'cronico'), p('DM2', 'cronico')] }, 'problemas'), '2 crônicos');
  assert.strictEqual(R({ problems: [p('ITU', 'resolvido')] }, 'problemas'), '');
});

test('resumoSecao: HPP, alergias e anamnese', () => {
  assert.strictEqual(R({ hpp: 'HAS, DM2, DRC G3b' }, 'hpp'), 'HAS · DM2 · DRC G3b');
  assert.strictEqual(R({ alergias: 'Dipirona', medicacoesPrevias: 'x'.repeat(50) }, 'alergias'), 'Dipirona · ' + 'x'.repeat(40) + '…');
  assert.strictEqual(R({ alergias: '  ', medicacoesPrevias: 'AAS' }, 'alergias'), 'Nenhuma alergia registrada · AAS');
  assert.strictEqual(R({ alergias: '', medicacoesPrevias: '' }, 'alergias'), 'Nenhuma alergia registrada');
  assert.strictEqual(R({ anamneseInicial: 'a'.repeat(80) }, 'anamnese'), 'a'.repeat(60) + '…');
  assert.strictEqual(R({ anamneseInicial: 'curta\ncom quebra' }, 'anamnese'), 'curta com quebra');
});

test('resumoSecao: internações anteriores', () => {
  assert.strictEqual(R({}, 'internacoes', { anteriores: [{ dischargedAt: '2026-05-10' }, { dischargedAt: '2026-09-03' }] }), '2 internações · última alta 03/09');
  assert.strictEqual(R({}, 'internacoes', { anteriores: [{ dischargedAt: '' }] }), '1 internação');
  assert.strictEqual(R({}, 'internacoes', { anteriores: [] }), '');
});

test('resumoSecao: controles em uso, primeiro os que alertam', () => {
  const bed = { trackers: [
    { type: 'culture', name: 'HMC', collectionDate: '2026-11-15', result: 'Aguardando' },
    { type: 'atb', name: 'Piperacilina-tazobactam', startDate: '2026-11-10', duration: 7 },
    { type: 'device', kind: 'procedimento', name: 'LE', installDate: '2026-11-14' },
    { type: 'device', name: 'CVC', installDate: '2026-11-08' },
    { type: 'atb', name: 'Cefepime', startDate: '2026-11-01', duration: 7, endDate: '2026-11-07' },
    { type: 'device', name: 'SVD', installDate: '2026-11-01', removalDate: '2026-11-05' },
    { type: 'culture', name: 'URC', collectionDate: '2026-11-10', result: 'Negativa final' },
  ] };
  assert.strictEqual(R(bed, 'controles'), 'Piperacilina-t… D7/7 ⚠ · CVC D9 ⚠ · HMC D2 · LE PO D3');
  assert.strictEqual(R({ trackers: [] }, 'controles'), '');
});

test('resumoSecao: exames usa a linha da última coleta', () => {
  const bed = { exams: [{ type: 'lab', date: '2026-11-16', results: [{ name: 'Hb', value: '9,5' }] }] };
  assert.strictEqual(R(bed, 'exames', { pinnedExams: ['Hb'] }), PainelCore.buildLabsLine(bed, ['Hb']));
});

test('resumoSecao: condutas e anotações', () => {
  const c = (text, done) => ({ text: text, done: done });
  assert.strictEqual(R({ condutas: [c('A', true), c('Solicitar TC de tórax', false), c('C', false)] }, 'condutas'), '1/3 feitas · próxima: Solicitar TC de tórax');
  assert.strictEqual(R({ condutas: [c('A', true), c('B', true)] }, 'condutas'), '2/2 feitas');
  assert.strictEqual(R({ condutas: [] }, 'condutas'), '');
  assert.strictEqual(R({ notes: 'S: (Subjetivo)\ndor torácica há 2 dias\n\nO: (Objetivo)\n- SSVV:' }, 'anotacoes', { notesTemplate: MODELO }), 'dor torácica há 2 dias');
  assert.strictEqual(R({ notes: MODELO }, 'anotacoes', { notesTemplate: MODELO }), '', 'modelo intocado não é resumo');
  assert.strictEqual(R({ notes: 'Sem modelo\nlinha 2' }, 'anotacoes', { notesTemplate: MODELO }), 'Sem modelo');
  assert.strictEqual(R({ notes: 'livre' }, 'anotacoes', {}), 'livre', 'sem modelo nas opções');
  assert.strictEqual(R({ notes: '' }, 'anotacoes', { notesTemplate: MODELO }), '');
});

test('resumoSecao: evolução, textos e documentos', () => {
  assert.strictEqual(R({ evolucoes: [{ data: '2026-11-14' }, { data: HOJE }] }, 'evolucao'), 'Hoje ✓');
  assert.strictEqual(R({ evolucoes: [{ data: '2026-11-10' }, { data: '2026-11-14' }] }, 'evolucao'), 'Última: 14/11');
  assert.strictEqual(R({ evolucoes: [] }, 'evolucao'), 'Nenhuma');
  assert.strictEqual(R({ rawTexts: [{ data: '2026-11-12' }, { data: '2026-11-16' }] }, 'textos'), '2 textos · último 16/11');
  assert.strictEqual(R({ rawTexts: [{ data: '2026-11-12' }] }, 'textos'), '1 texto · último 12/11');
  assert.strictEqual(R({ rawTexts: [] }, 'textos'), '');
  const docs = [{ tipo: 'laudo', createdAt: '2026-11-10T12:00:00Z' }, { tipo: 'sumario_alta', createdAt: '2026-11-16T12:00:00Z' }];
  assert.strictEqual(R({ generatedDocs: docs }, 'documentos', { diaLocal: (s) => s.slice(0, 10) }), 'Sumário de Alta 16/11');
  assert.strictEqual(R({ generatedDocs: [] }, 'documentos', { diaLocal: (s) => s.slice(0, 10) }), '');
});

test('resumoSecao: leito antigo, sem as listas, não quebra', () => {
  ['problemas', 'hpp', 'anamnese', 'internacoes', 'controles', 'exames', 'condutas', 'anotacoes', 'textos', 'documentos', 'inexistente']
    .forEach((s) => assert.strictEqual(R({}, s, {}), '', s));
  assert.strictEqual(R({}, 'alergias', {}), 'Nenhuma alergia registrada');
  assert.strictEqual(R({}, 'evolucao', {}), 'Nenhuma');
});
