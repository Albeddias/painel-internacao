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

test('index.html: remover tarefa aparece no toque e pede confirmação', () => {
  const tpl = html.slice(html.indexOf('id="taskItemTpl"'), html.indexOf('id="patientDetailTpl"'));
  assert.ok(/class="remove-task [^"]*\bopacity-60 \[@media\(hover:hover\)\]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100\b/.test(tpl));
  assert.ok(/class="remove-task [^"]*\bmin-w-\[44px\] min-h-\[44px\]/.test(tpl));
  assert.ok(/class="remove-task [^"]*"[^>]*aria-label="Remover tarefa"/.test(tpl));
  assert.ok(html.includes("|| 'esta tarefa'"), 'tarefa sem texto não vira Remover ""?');
  assert.ok(html.includes("'Remover tarefa', 'bg-red-600', 'Remover'"));
});

test('index.html: sair dos Arquivados está sempre à vista', () => {
  assert.ok(!html.includes('viewArchiveBtn'), 'o botão do painel de filtros saiu');
  assert.ok(html.includes('id="viewActiveBtn"') && html.includes('id="viewArchivedBtn"'));
  assert.ok(html.includes('function setViewArchived('));
  const filtros = html.slice(html.indexOf('id="filtersPanel"'), html.indexOf('</header>'));
  assert.ok(!filtros.includes('viewSegment'), 'o seletor fica fora do painel recolhível');
  ['viewActiveBtn', 'viewArchivedBtn'].forEach((id) => {
    assert.ok(new RegExp('id="' + id + '" class="[^"]*\\bh-11\\b').test(html), id + ' com alvo de toque de 44 px (spec: Restrições)');
  });
});

test('index.html: rodapé do paciente cabe numa linha', () => {
  const rodape = html.slice(html.indexOf('<!-- RODAPÉ FIXO (TELA B) -->'), html.indexOf('id="screen-tasks"'));
  ['+ Conduta', '+ Nota', '+ Controle'].forEach((t) => assert.ok(!rodape.includes(t), t));
  ['Conduta', 'Nota', 'Controle'].forEach((t) => assert.ok(new RegExp('<span[^>]*>' + t + '</span>').test(rodape), t));
  assert.strictEqual((rodape.match(/\bw-14\b/g) || []).length, 2, '‹ e › com 56 px');
  assert.ok(/id="prevPatientBtn"[^>]*aria-label="Paciente anterior"/.test(rodape));
  assert.ok(/id="nextPatientBtn"[^>]*aria-label="Próximo paciente"/.test(rodape));
});

test('index.html: a data da coleta é o botão de editar; apagar fica dentro do formulário', () => {
  assert.ok(!html.includes('delete-collection-btn'), 'o ✕ de 12 px no cabeçalho saiu');
  assert.ok(/<button type="button" class="edit-collection-btn [^"]*\bmin-h-\[44px\]/.test(html));
  assert.ok(/id="delete-lab-entry-btn"[^>]*class="hidden /.test(html) || /class="hidden [^"]*"[^>]*id="delete-lab-entry-btn"/.test(html));
  assert.strictEqual(html.split('Deletar todos os exames da coleta do dia').length - 1, 1, 'mesmo texto de confirmação, uma vez só');
  const apagar = html.slice(html.indexOf("querySelector('#delete-lab-entry-btn').addEventListener"));
  assert.ok(/dataset\.editDate/.test(apagar.slice(0, 600)), 'apaga a coleta da data original, não a do campo de data');
});

// ---- Revisão de UI, Fase 2 ---------------------------------------------------

// Contraste WCAG entre duas cores #rrggbb.
function contraste(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const token = (nome) => (html.match(new RegExp('--c-' + nome + ':\\s*(#[0-9a-f]{6})\\s*;')) || [])[1];

test('tokens de cor: valores do spec 4.1', () => {
  assert.deepStrictEqual(['primary', 'success', 'warn', 'danger'].map(token), ['#0369a1', '#15803d', '#b45309', '#dc2626']);
});

test('tokens de cor: cada tom passa no contraste do seu uso', () => {
  ['primary', 'success', 'warn', 'danger'].forEach((p) => {
    assert.ok(contraste(token(p), '#ffffff') >= 4.5, p + ': texto, ou fundo com texto branco');
    assert.ok(contraste(token(p + '-on-bg'), token(p + '-bg')) >= 4.5, p + ': texto do selo sobre o fundo do selo');
    assert.ok(contraste(token(p + '-mark'), '#ffffff') >= 3, p + ': ícone, bolinha, barra');
  });
  assert.ok(contraste(token('text'), token('surface')) >= 4.5);
  assert.ok(contraste(token('text-muted'), token('surface')) >= 4.5);
  assert.ok(contraste(token('neutral-on-bg'), token('neutral-bg')) >= 4.5);
});

test('index.html: classes de componente existem', () => {
  ['btn', 'btn-primary', 'btn-ghost', 'btn-danger', 'btn-sm', 'chip', 'chip-primary', 'chip-success',
    'chip-warn', 'chip-danger', 'card', 'field', 'mark', 'mark-primary', 'mark-success', 'mark-warn', 'mark-danger']
    .forEach((c) => assert.ok(new RegExp('\\.' + c + '\\s*[{,:]').test(html), c));
});

test('index.html: aviso global no lugar da linha de status do cabeçalho', () => {
  ['id="appNotice"', 'id="appNoticeMsg"', 'id="appNoticeClose"'].forEach((s) => assert.ok(html.includes(s), s));
  assert.ok(html.includes('function avisar(') && html.includes('function fecharAviso('));
  assert.ok(!html.includes('id="syncStatus"'), 'a linha só existia no cabeçalho da lista');
  const i = html.indexOf('function setSyncStatus(');
  assert.ok(html.slice(i, i + 300).includes('avisar('));
  assert.ok(html.includes("avisar('Não foi possível salvar neste aparelho: ' + e.message, { tom: 'perigo', fixo: true })"));
});

test('index.html: menu ⋯ da lista leva as ações do painel de filtros, na ordem do spec', () => {
  const ordem = ['id="listMenuSheet"', 'id="resetChecksBtn"', 'id="exportDataBtn"', 'id="importDataInput"',
    'id="logoutBtn"', 'id="resetLocalBtn"', 'class="sheet-item sheet-cancel"', 'id="appVersionLine"'];
  const pos = ordem.map((s) => html.indexOf(s));
  assert.ok(pos.every((p) => p !== -1), 'falta: ' + ordem[pos.indexOf(-1)]);
  assert.deepStrictEqual(pos, pos.slice().sort((a, b) => a - b));
  assert.ok(/id="listMenuSheet"[^>]*role="dialog"[^>]*aria-modal="true"/.test(html));
  assert.ok(/id="resetLocalBtn"[^>]*class="sheet-item sheet-item-danger"/.test(html) || /class="sheet-item sheet-item-danger"[^>]*id="resetLocalBtn"/.test(html));
  assert.ok(/id="listMenuBtn"[^>]*aria-label="Mais ações"/.test(html));
  assert.ok(!html.includes('id="filter-actions"'));
  assert.ok(html.includes("'Sair? Para entrar de novo é preciso internet.'"));
  assert.ok(html.includes('<title>Caderno de Visitas</title>'));
  ['function openSheet(', 'function closeSheet(', 'function closeAllModals(', 'pendingOverlayPop'].forEach((s) => assert.ok(html.includes(s), s));
});

test('estadoDoSync: legenda e tom de cada estado', () => {
  const HOJE = '2026-11-16';
  const em = (p) => Object.assign({ sujo: false, ultimoSync: { dia: HOJE, hora: '09:22' }, erro: false, emCurso: false }, p);
  const e = (p, hoje) => PainelCore.estadoDoSync(em(p), hoje || HOJE);
  assert.deepStrictEqual(e({}), { tom: 'neutro', legenda: 'hoje 09:22 ✓' });
  assert.deepStrictEqual(e({ ultimoSync: { dia: '2026-11-15', hora: '18:40' } }), { tom: 'neutro', legenda: 'ontem 18:40' });
  assert.deepStrictEqual(e({ ultimoSync: { dia: '2026-11-14', hora: '18:40' } }), { tom: 'neutro', legenda: '14/11 18:40' });
  assert.deepStrictEqual(e({ sujo: true }), { tom: 'atencao', legenda: 'alterações a enviar' });
  assert.deepStrictEqual(e({ ultimoSync: null }), { tom: 'atencao', legenda: 'nunca sincronizado' });
  assert.deepStrictEqual(e({ ultimoSync: null, sujo: true }), { tom: 'atencao', legenda: 'nunca sincronizado' });
  assert.deepStrictEqual(e({ erro: true }), { tom: 'perigo', legenda: 'falhou' });
  assert.deepStrictEqual(e({ erro: true, sujo: true }), { tom: 'perigo', legenda: 'falhou' }, 'editar depois da falha não apaga o "falhou"');
  assert.deepStrictEqual(e({ emCurso: true, erro: true }), { tom: 'neutro', legenda: 'sincronizando…' });
});

test('estadoDoSync: virada do ano e relógio atrasado', () => {
  const em = (dia, hora) => ({ sujo: false, ultimoSync: { dia: dia, hora: hora }, erro: false, emCurso: false });
  assert.strictEqual(PainelCore.estadoDoSync(em('2026-12-31', '23:50'), '2027-01-01').legenda, 'ontem 23:50');
  assert.strictEqual(PainelCore.estadoDoSync(em('2026-11-17', '08:00'), '2026-11-16').legenda, '17/11 08:00', 'sync "no futuro" mostra o dia');
});

test('index.html: Sincronizar mantém a palavra e ganha legenda; gravação local não acende o aviso', () => {
  assert.ok(html.includes('PainelCore.estadoDoSync('));
  assert.ok(html.includes('id="syncCaption"'));
  assert.ok(!html.includes('syncDirtyDot'));
  assert.ok(/id="syncBtn"[\s\S]{0,600}?Sincronizar/.test(html), 'a palavra continua no botão');
  assert.ok(html.includes('if (!(opts && (opts.fromSync || opts.localOnly))) s.lastModifiedAt'));
  assert.ok((html.match(/localOnly: true/g) || []).length >= 17);
  const queda = html.indexOf('function bindQuedaDot(');
  assert.ok(!html.slice(queda, queda + 400).includes('localOnly'), 'a Queda vai para o banco: não é gravação local');
});

test('progressoDoDia: o denominador é ocupados menos externos', () => {
  const leito = (p) => Object.assign({ patientName: 'Paciente Exemplo Um', isArchived: false, isVisited: false, externalDoctor: { active: false, name: '' } }, p);
  const s = {
    beds: [leito({ isVisited: true }), leito({ isVisited: true }), leito(), leito(),
      leito({ externalDoctor: { active: true, name: 'Dra. Exemplo' }, isVisited: true }),
      leito({ patientName: '  ' }), leito({ isArchived: true })],
    generalTasks: [{ done: false }, { done: true }, { done: false }],
  };
  assert.deepStrictEqual(PainelCore.progressoDoDia(s),
    { total: 6, ocupados: 5, aVisitar: 4, visitados: 2, pendentes: 2, externos: 1, vazios: 1, tarefasAbertas: 2 });
  assert.deepStrictEqual(PainelCore.progressoDoDia({ beds: [] }),
    { total: 0, ocupados: 0, aVisitar: 0, visitados: 0, pendentes: 0, externos: 0, vazios: 0, tarefasAbertas: 0 });
});

test('fraseProgresso: plurais, partes zeradas e casos de borda', () => {
  const p = (x) => Object.assign({ total: 6, ocupados: 5, aVisitar: 4, visitados: 2, pendentes: 2, externos: 1, vazios: 1, tarefasAbertas: 0 }, x);
  assert.deepStrictEqual(PainelCore.fraseProgresso(p()), { titulo: '2 de 4 visitados', detalhe: '1 externo · 1 vazio', fracao: 0.5 });
  assert.strictEqual(PainelCore.fraseProgresso(p({ externos: 2, vazios: 3 })).detalhe, '2 externos · 3 vazios');
  assert.strictEqual(PainelCore.fraseProgresso(p({ externos: 0 })).detalhe, '1 vazio');
  assert.strictEqual(PainelCore.fraseProgresso(p({ externos: 0, vazios: 0 })).detalhe, '');
  assert.deepStrictEqual(PainelCore.fraseProgresso(p({ visitados: 4, pendentes: 0 })), { titulo: '4 de 4 visitados ✓', detalhe: '1 externo · 1 vazio', fracao: 1 });
  assert.deepStrictEqual(PainelCore.fraseProgresso(p({ total: 2, ocupados: 1, aVisitar: 0, visitados: 0, pendentes: 0 })),
    { titulo: 'Nenhum paciente para visitar', detalhe: '1 externo · 1 vazio', fracao: null });
  assert.deepStrictEqual(PainelCore.fraseProgresso(PainelCore.progressoDoDia({ beds: [] })), { titulo: 'Nenhum leito', detalhe: '', fracao: null });
});

test('fraseArquivados: plural e nuvem', () => {
  assert.deepStrictEqual(PainelCore.fraseArquivados(12, 3), { titulo: 'Arquivados', detalhe: '12 pacientes · 3 na nuvem' });
  assert.strictEqual(PainelCore.fraseArquivados(1, 0).detalhe, '1 paciente');
  assert.strictEqual(PainelCore.fraseArquivados(0, 2).detalhe, '2 na nuvem');
  assert.strictEqual(PainelCore.fraseArquivados(0, 0).detalhe, 'Nenhum paciente arquivado');
});

test('index.html: cabeçalho da lista em três linhas, com a frase do progresso como título', () => {
  const cab = html.slice(html.indexOf('id="listHeader"'), html.indexOf('</header>'));
  const ordem = ['id="progressTitle"', 'id="progressDetail"', 'id="syncBtn"', 'id="listMenuBtn"', 'id="searchInput"',
    'id="toggleFiltersBtn"', 'id="viewSegment"', 'id="openTasksBtn"', 'id="tasksCount"', 'id="addBedBtn"', 'id="filtersPanel"', 'id="progressBar"'];
  const pos = ordem.map((s) => cab.indexOf(s));
  assert.ok(pos.every((x) => x !== -1), 'falta: ' + ordem[pos.indexOf(-1)]);
  assert.deepStrictEqual(pos, pos.slice().sort((a, b) => a - b));
  assert.ok(!html.includes('progressCounter') && !/Caderno <span/.test(html), 'o título "Caderno v11" e o contador T|V|P|E saíram');
  assert.ok(/id="progressBar"[^>]*role="progressbar"/.test(cab));
  assert.ok(/id="addBedBtn"[^>]*aria-label="Adicionar leito"/.test(cab));
  assert.ok(cab.includes('placeholder="Buscar leito, nome ou diagnóstico"'));
  assert.ok(html.includes('PainelCore.progressoDoDia(state)') && html.includes('PainelCore.fraseProgresso(') && html.includes('PainelCore.fraseArquivados('));
});

test('LIMIARES: os limiares de alerta vivem num lugar só', () => {
  assert.deepStrictEqual(PainelCore.LIMIARES, { culturaDias: 3, dispositivoDias: 7, atbLongoDia: 8 });
  assert.ok(!/cDays >= 3/.test(html) && !/dDays >= 7/.test(html), 'o index.html usa PainelCore.LIMIARES');
  assert.ok(html.includes('PainelCore.agruparPendencias('));
  assert.ok(!html.includes('PENDENCIA_COLORS'), 'a bolinha segue a gravidade, não o tipo');
});

test('statusAltaPrevista: rótulo curto e tom pelo estado', () => {
  const T = '2026-08-27';
  assert.deepStrictEqual(PainelCore.statusAltaPrevista('2026-08-25', T), { status: 'atrasada', rotulo: 'Alta 25/08 ⚠', tom: 'perigo' });
  assert.deepStrictEqual(PainelCore.statusAltaPrevista('2026-08-27', T), { status: 'hoje', rotulo: 'Alta hoje', tom: 'primaria' });
  assert.deepStrictEqual(PainelCore.statusAltaPrevista('2026-08-28', T), { status: 'breve', rotulo: 'Alta 28/08', tom: 'atencao' });
  assert.strictEqual(PainelCore.statusAltaPrevista('2026-08-29', T).status, 'breve');
  assert.deepStrictEqual(PainelCore.statusAltaPrevista('2026-08-30', T), { status: 'futura', rotulo: 'Alta 30/08', tom: 'neutro' });
  ['', null, undefined, 'lixo'].forEach((d) => assert.strictEqual(PainelCore.statusAltaPrevista(d, T), null));
});

test('estadoDoLeito: vazio, externo, concluído e pendente', () => {
  const b = (p) => Object.assign({ patientName: 'Paciente Exemplo Um', isVisited: true, checks: { ev: true, p: true, ex: true, tev: true }, externalDoctor: { active: false, name: '' } }, p);
  assert.strictEqual(PainelCore.estadoDoLeito(b()), 'concluido');
  assert.strictEqual(PainelCore.estadoDoLeito(b({ checks: { ev: true, p: true, ex: true, tev: false } })), 'pendente');
  assert.strictEqual(PainelCore.estadoDoLeito(b({ isVisited: false })), 'pendente');
  assert.strictEqual(PainelCore.estadoDoLeito(b({ checks: undefined })), 'pendente');
  assert.strictEqual(PainelCore.estadoDoLeito(b({ externalDoctor: { active: true, name: 'Dra. Exemplo' } })), 'externo');
  assert.strictEqual(PainelCore.estadoDoLeito(b({ patientName: '  ', externalDoctor: { active: true, name: 'Dra. Exemplo' } })), 'vazio', 'vazio vem antes de externo');
  assert.strictEqual(PainelCore.estadoDoLeito({}), 'vazio');
});

test('selosDoCartao: até N pendências, por gravidade, sem alta nem lembrete', () => {
  const it = (tipo, gravidade, curto) => ({ tipo: tipo, gravidade: gravidade, curto: curto });
  const itens = [it('cultura', 'atencao', 'Cultura D4'), it('atb', 'alerta', 'ATB D8/7'), it('atb', 'alerta', 'ATB D9/7'),
    it('dispositivo', 'atencao', 'CVC D9'), it('alta', 'alerta', 'Alta atrasada'), it('lembrete', 'atencao', 'Lembrete')];
  assert.deepStrictEqual(PainelCore.selosDoCartao(itens, 2),
    { selos: [{ curto: 'ATB D8/7', gravidade: 'alerta' }, { curto: 'ATB D9/7', gravidade: 'alerta' }], resto: 2 });
  assert.deepStrictEqual(PainelCore.selosDoCartao([it('alta', 'alerta', 'Alta atrasada'), it('lembrete', 'atencao', 'Lembrete')], 2), { selos: [], resto: 0 });
  assert.deepStrictEqual(PainelCore.selosDoCartao([], 2), { selos: [], resto: 0 });
});

test('index.html: o cartão usa as regras do core e não usa opacidade para estado', () => {
  ['PainelCore.estadoDoLeito(', 'PainelCore.statusAltaPrevista(', 'PainelCore.selosDoCartao('].forEach((s) => assert.ok(html.includes(s), s));
  assert.ok(!html.includes('function isBedCompleted(') && !html.includes('function getDischargeStatus('));
  assert.ok(!html.includes("card.classList.add('opacity-60')"));
  assert.ok(!html.includes('reminder-list-active'));
  assert.ok(html.includes('id="emptyBedTpl"') && html.includes('Vazio — toque para admitir'));
  assert.ok(html.includes('Nenhum leito neste aparelho. Toque em ＋ para adicionar ou em Sincronizar para receber do banco.'));
  assert.ok(html.includes('class="add-bed-row'));
});
