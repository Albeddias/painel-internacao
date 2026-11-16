const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');
const estadoFicticio = require('../tools/captura/estado-ficticio.js');

const HOJE = '2026-11-16';

test('estado fictício: passa pela migração e cobre os extremos do spec', () => {
  const s = PainelCore.migrateState(estadoFicticio(HOJE), HOJE);
  const ativos = s.beds.filter((b) => !b.isArchived);
  assert.ok(ativos.length >= 7);
  assert.ok(ativos.some((b) => !b.patientName), 'leito vazio');
  assert.ok(ativos.some((b) => b.externalDoctor.active), 'médico externo');
  assert.ok(ativos.some((b) => b.alergias), 'alergia');
  assert.ok(ativos.some((b) => b.bedNumber.length >= 8), 'leito de 8 caracteres');
  assert.ok(ativos.some((b) => b.patientName.length >= 50), 'nome longo');
  assert.ok(ativos.some((b) => b.isVisited && b.checks.ev && b.checks.p && b.checks.ex && b.checks.tev), 'concluído');
  assert.ok(ativos.some((b) => b.initialsPlaceholder && b.initialsPlaceholder === b.patientName), 'só iniciais');
  assert.ok(s.beds.some((b) => b.isArchived && b.archiveReason === 'alta' && b.personId === s.beds[0].personId), 'internação anterior do leito 0');
  const porLeito = {};
  PainelCore.buildPendencias(s, HOJE).forEach((p) => { porLeito[p.bedIndex] = (porLeito[p.bedIndex] || 0) + 1; });
  assert.ok(porLeito[0] >= 5, 'leito 0 com ATB vencido, cultura, dispositivo, alta atrasada e lembrete');
  const labs = s.beds[0].exams.filter((e) => e.type === 'lab');
  assert.ok(labs.length >= 3 && labs.some((e) => e.date === HOJE && e.results.length >= 20), '3 coletas, 20 exames na de hoje');
  assert.ok(s.beds[0].evolucoes.some((e) => e.data === HOJE && /\[NOME\]/.test(e.evolucao_atual)), 'evolução de hoje com [NOME]');
  assert.ok(s.beds[0].generatedDocs.some((d) => d.tipo === 'sumario_alta' && /^=== /m.test(d.conteudo)), 'sumário em blocos');
  assert.ok(s.generalTasks.filter((t) => !t.done).length >= 2 && s.generalTasks.some((t) => t.done));
  assert.ok(Object.keys(s.cloudArchived).length >= 1, 'um paciente na nuvem');
  assert.ok(s.lastSyncAt && s.lastModifiedAt < s.lastSyncAt, 'nasce sincronizado');
});

test('estado fictício: só nomes fictícios', () => {
  const s = estadoFicticio(HOJE);
  s.beds.forEach((b) => {
    const ok = !b.patientName || /^Paciente Exemplo /.test(b.patientName) || b.patientName === b.initialsPlaceholder;
    assert.ok(ok, 'nome fora do padrão: ' + b.patientName);
  });
  Object.values(s.cloudArchived).forEach((r) => assert.ok(/^Paciente Exemplo /.test(r.nome), r.nome));
});
