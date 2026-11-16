const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PainelCore = require('../painel-core.js');

// Regras de tela que vivem no core para poderem ser testadas: exames fixados sem
// diferenciar caixa, selo do antibiótico e visibilidade do check de Queda.

// ---- Exames fixados ---------------------------------------------------------

test('pinnedExamIndex: acha o fixado ignorando maiúsculas/minúsculas', () => {
  const pinned = ['Hb', 'Leucócitos', 'Cr'];
  assert.strictEqual(PainelCore.pinnedExamIndex(pinned, 'HB'), 0);
  assert.strictEqual(PainelCore.pinnedExamIndex(pinned, 'leucócitos'), 1);
  assert.strictEqual(PainelCore.pinnedExamIndex(pinned, 'Cr'), 2);
  assert.strictEqual(PainelCore.pinnedExamIndex(pinned, 'Na'), -1);
  assert.strictEqual(PainelCore.pinnedExamIndex(null, 'Na'), -1);
});

test('sortExamNames: fixados primeiro, na ordem dos fixados, mesmo com caixa diferente', () => {
  const out = PainelCore.sortExamNames(['Ur', 'CR', 'Albumina', 'HB'], ['Hb', 'Cr']);
  assert.deepStrictEqual(out, ['HB', 'CR', 'Albumina', 'Ur']);
});

test('sortExamNames: não altera a lista recebida', () => {
  const names = ['Ur', 'Hb'];
  PainelCore.sortExamNames(names, ['Hb']);
  assert.deepStrictEqual(names, ['Ur', 'Hb']);
});

test('togglePinnedExam: fixa no topo o que não estava fixado', () => {
  assert.deepStrictEqual(PainelCore.togglePinnedExam(['Hb', 'Cr'], 'Na'), ['Na', 'Hb', 'Cr']);
});

test('togglePinnedExam: desafixa mesmo quando a grafia difere na caixa', () => {
  assert.deepStrictEqual(PainelCore.togglePinnedExam(['Hb', 'Cr'], 'HB'), ['Cr']);
});

test('togglePinnedExam: devolve lista nova', () => {
  const pinned = ['Hb'];
  PainelCore.togglePinnedExam(pinned, 'Cr');
  assert.deepStrictEqual(pinned, ['Hb']);
});

// ---- Selo do antibiótico ------------------------------------------------------

const TODAY = '2026-08-27';
const atb = (patch) => Object.assign({ id: 't1', type: 'atb', name: 'Cefepime', startDate: '2026-08-21' }, patch || {});

test('atbBadge: prazo vencido mostra o dia real, não "D7/7 (Finalizado)"', () => {
  assert.deepStrictEqual(PainelCore.atbBadge(atb({ startDate: '2026-08-19', duration: 7 }), TODAY),
    { label: 'D9/7 (prazo vencido)', tone: 'due' });
});

test('atbBadge: último dia e dentro do prazo', () => {
  assert.deepStrictEqual(PainelCore.atbBadge(atb({ duration: 7 }), TODAY), { label: 'D7/7 (último dia)', tone: 'due' });
  assert.deepStrictEqual(PainelCore.atbBadge(atb({ duration: 10 }), TODAY), { label: 'D7/10', tone: 'normal' });
});

test('atbBadge: suspenso congela a contagem no dia do fim', () => {
  assert.deepStrictEqual(PainelCore.atbBadge(atb({ duration: 7, endDate: '2026-08-25' }), TODAY),
    { label: 'Suspenso D5', tone: 'ended' });
});

test('atbBadge: fim previsto no futuro não suspende', () => {
  assert.deepStrictEqual(PainelCore.atbBadge(atb({ duration: 10, endDate: '2026-08-30' }), TODAY),
    { label: 'D7/10', tone: 'normal' });
});

test('atbBadge: agendado, sem duração, ATB longo e sem data', () => {
  assert.deepStrictEqual(PainelCore.atbBadge(atb({ startDate: '2026-08-29', duration: 7 }), TODAY), { label: 'Agendado', tone: 'scheduled' });
  assert.deepStrictEqual(PainelCore.atbBadge(atb({ startDate: '2026-08-25' }), TODAY), { label: 'D3', tone: 'normal' });
  assert.deepStrictEqual(PainelCore.atbBadge(atb({ startDate: '2026-08-20' }), TODAY), { label: 'D8', tone: 'long' });
  assert.deepStrictEqual(PainelCore.atbBadge(atb({ startDate: '' }), TODAY), { label: 'D-', tone: 'normal' });
});

// ---- Check de Queda -------------------------------------------------------------

test('showsQuedaCheck: só leito ativo, ocupado e do próprio médico', () => {
  const bed = (patch) => Object.assign({ patientName: 'Ana Braga', isArchived: false, externalDoctor: { active: false, name: '' } }, patch || {});
  assert.strictEqual(PainelCore.showsQuedaCheck(bed()), true);
  assert.strictEqual(PainelCore.showsQuedaCheck(bed({ patientName: '  ' })), false, 'leito vazio');
  assert.strictEqual(PainelCore.showsQuedaCheck(bed({ isArchived: true })), false, 'arquivado');
  assert.strictEqual(PainelCore.showsQuedaCheck(bed({ externalDoctor: { active: true, name: 'Dr. X' } })), false, 'médico externo');
  assert.strictEqual(PainelCore.showsQuedaCheck(bed({ externalDoctor: undefined })), true);
});

// ---- index.html usa as regras do core (sem cópias locais) ------------------------

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('index.html: fixados passam pelo core (nada de includes/indexOf direto em pinnedExams)', () => {
  assert.ok(!/pinnedExams\.(includes|indexOf)\(/.test(html));
  assert.ok(html.includes('PainelCore.sortExamNames('));
  assert.ok(html.includes('PainelCore.togglePinnedExam('));
});

test('index.html: selo do ATB e check de Queda vêm do core', () => {
  assert.ok(!html.includes('(Finalizado)'));
  assert.ok(html.includes('PainelCore.atbBadge('));
  assert.ok(html.includes('PainelCore.showsQuedaCheck('));
});

test('index.html: sem cópias locais dos helpers de data nem do ícone de check', () => {
  assert.ok(!/function getDayNumber\(/.test(html), 'getDayNumber duplicava PainelCore.dayNumber');
  assert.ok(!/formatDate\s*=\s*\(/.test(html), 'formatDate local do renderTrackerList');
  assert.ok(!/function formatDate\(/.test(html), 'formatDate duplicava PainelCore.formatDateBR');
  const checkPath = 'M16.704 4.153a.75.75';
  assert.strictEqual(html.split(checkPath).length - 1, 1, 'o ícone de check deve existir uma vez só');
});

// ---- Revisão de UI, Fase 1 ---------------------------------------------------

const classAttrs = () => [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(/\s+/));
const juntas = (a, b) => classAttrs().some((t) => t.includes(a) && t.includes(b));

test('index.html: leito e nome mantêm o tamanho no celular; campo-linha sem altura mínima', () => {
  assert.ok(/\.inline-bed\s*\{\s*font-size:\s*1\.5rem\s*!important/.test(html));
  assert.ok(/\.inline-name\s*\{\s*font-size:\s*1\.125rem\s*!important/.test(html));
  assert.ok(/input\.campo-linha\s*\{[^}]*min-height:\s*0/.test(html));
  ['inline-age', 'inline-admit', 'problem-plan'].forEach((c) => assert.ok(juntas(c, 'campo-linha'), c));
});

test('DAILY_CHECKS: quatro checks, siglas distintas e nome por extenso', () => {
  assert.deepStrictEqual(PainelCore.DAILY_CHECKS, [
    { key: 'ev', label: 'EV', nome: 'Evolução' },
    { key: 'p', label: 'P', nome: 'Prescrição' },
    { key: 'ex', label: 'EX', nome: 'Exames' },
    { key: 'tev', label: 'TEV', nome: 'Profilaxia de TEV' },
  ]);
});

test('index.html: checks desenhados a partir de DAILY_CHECKS, como botões de 40 px', () => {
  assert.ok(html.includes('PainelCore.DAILY_CHECKS'));
  assert.ok(!html.includes('k.toUpperCase()[0]'), 'a primeira letra sozinha confunde EV com EX');
  assert.ok(/<button type="button" class="dot [^"]*\bw-10 h-10\b[^"]*"[^>]*aria-pressed=/.test(html));
  assert.ok(/<button type="button" class="queda-dot [^"]*\bw-10 h-10\b[^"]*"[^>]*aria-pressed=/.test(html));
  assert.ok(!/class="(dot|queda-dot) [^"]*bg-sky-500/.test(html), '✓ branco sobre sky-500 tem contraste 2,8:1');
});

test('tendenciasLab: compara cada coleta com a anterior que tinha número', () => {
  assert.deepStrictEqual(PainelCore.tendenciasLab([10, 12, 12, 9]), ['', '▲', '', '▼']);
  assert.deepStrictEqual(PainelCore.tendenciasLab([10, null, 8]), ['', '', '▼'], 'um "—" no meio não quebra a comparação');
  assert.deepStrictEqual(PainelCore.tendenciasLab([null, 5]), ['', '']);
  assert.deepStrictEqual(PainelCore.tendenciasLab([7]), ['']);
  assert.deepStrictEqual(PainelCore.tendenciasLab([null, null]), ['', '']);
  assert.deepStrictEqual(PainelCore.tendenciasLab([]), []);
});

test('index.html: a tabela de labs calcula em ordem cronológica e desenha da mais recente para a mais antiga', () => {
  assert.ok(html.includes('PainelCore.tendenciasLab(nums)'));
  assert.ok(html.includes('const columnDates = filteredDates.slice().reverse();'));
  assert.ok(!html.includes('let prevNum = null;'), 'a tendência saiu do laço das colunas');
});
