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
// Template da tela do paciente (Fase 3).
const tplIni = html.indexOf('id="patientDetailTpl"');
const tpl = html.slice(tplIni, html.indexOf('</template>', tplIni));

test('index.html: fixados passam pelo core (nada de includes/indexOf direto em pinnedExams)', () => {
  assert.ok(!/pinnedExams\.(includes|indexOf)\(/.test(html));
  assert.ok(html.includes('PainelCore.sortExamNames('));
  assert.ok(html.includes('PainelCore.togglePinnedExam('));
});

test('index.html: selo do ATB e check de Queda vêm do core', () => {
  assert.ok(!html.includes('(Finalizado)'));
  assert.ok(html.includes('PainelCore.seloControle('));
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
  ['inline-age'].forEach((c) => assert.ok(juntas(c, 'campo-linha'), c));
  assert.ok(/\.grow-wrap\.campo-linha > textarea/.test(html));
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

test('aviso global: falha ao salvar e dados ilegíveis voltam depois de outra mensagem; a faixa segue a tela', () => {
  const corpo = (nome) => { const i = html.indexOf('function ' + nome + '('); assert.ok(i !== -1, nome); return html.slice(i, html.indexOf('\n    }\n', i)); };
  const cond = corpo('condicaoPersistente');
  assert.ok(cond.includes('loadFailure') && cond.includes('saveFailureMsg'), 'as duas condições que duram');
  assert.ok(corpo('fecharAviso').includes('condicaoPersistente()'), 'mensagem que some devolve o aviso que dura');
  assert.ok(!html.includes('saveFailureShown'), 'gravar de novo só fecha o próprio aviso de falha');
  assert.ok(corpo('showScreen').includes('posicionarAviso()') && corpo('adjustListPadding').includes('posicionarAviso()'),
    'o top da faixa acompanha o cabeçalho da tela ativa');
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

// ---- Fase 3: tela do paciente ------------------------------------------------

test('acoesDoRegistro: o menu ⋯ depende do registro', () => {
  const b = (p) => Object.assign({ patientName: 'Paciente Exemplo Um', isArchived: false }, p);
  assert.deepStrictEqual(PainelCore.acoesDoRegistro(b()), ['alta', 'arquivar', 'deletar']);
  assert.deepStrictEqual(PainelCore.acoesDoRegistro(b({ externalDoctor: { active: true, name: 'Dra. Exemplo' } })), ['alta', 'arquivar', 'deletar']);
  assert.deepStrictEqual(PainelCore.acoesDoRegistro(b({ patientName: '  ' })), ['deletar']);
  assert.deepStrictEqual(PainelCore.acoesDoRegistro(b({ isArchived: true })), ['restaurar', 'reinternar', 'deletar']);
  assert.deepStrictEqual(PainelCore.acoesDoRegistro(b({ isArchived: true, patientName: '' })), ['restaurar', 'deletar']);
});

test('index.html: ações do paciente no menu ⋯ do cabeçalho, ligadas uma vez só', () => {
  ['discharge-card', 'archive-bed-btn', 'delete-patient-btn'].forEach((c) => assert.ok(!tpl.includes(c), c + ' saiu do template'));
  const ordem = ['id="patientMenuSheet"', 'id="pmDischarge"', 'id="pmArchive"', 'id="pmRestore"', 'id="pmReadmit"', 'id="pmDelete"'];
  const pos = ordem.map((s) => html.indexOf(s));
  assert.ok(pos.every((p) => p !== -1), 'falta: ' + ordem[pos.indexOf(-1)]);
  assert.deepStrictEqual(pos, pos.slice().sort((a, b) => a - b));
  assert.ok(/id="patientMenuBtn"[^>]*aria-label="Ações do paciente"/.test(html));
  assert.ok(html.includes('id="patientAllergyFlag"') && html.includes('PainelCore.acoesDoRegistro('));
  const rb = html.slice(html.indexOf('function renderScreenB()'), html.indexOf('function setupCollapsibleSection('));
  assert.ok(!/getElementById\('(pm\w+|patientMenuBtn|patientAllergyFlag)'\)\.addEventListener/.test(rb), 'elemento fixo não é religado a cada redesenho');
  ['Dar alta no paciente do leito', 'Arquivar o leito', 'Deletar PERMANENTEMENTE o leito'].forEach((t) => assert.ok(html.includes(t), 'texto de confirmação: ' + t));
});

test('chipAdmissao: data curta e dia de internação', () => {
  const H = '2026-11-16';
  assert.strictEqual(PainelCore.chipAdmissao('2026-11-07', H), 'Adm 07/11 · D10');
  assert.strictEqual(PainelCore.chipAdmissao('2026-11-16', H), 'Adm 16/11 · D1');
  assert.strictEqual(PainelCore.chipAdmissao('2026-11-20', H), 'Adm 20/11', 'admissão futura não tem dia');
  ['', null, undefined].forEach((d) => assert.strictEqual(PainelCore.chipAdmissao(d, H), 'Admissão'));
});

test('index.html: identificação em chips; a previsão de alta mora no cartão', () => {
  assert.ok(!tpl.includes('>Previsão de Alta</label>'), 'a seção solta do fim da página saiu');
  ['inline-age', 'inline-admit', 'inline-discharge-forecast', 'clear-discharge-forecast-btn', 'admit-text', 'alta-text',
    'ext-doc-details', 'ext-doc-summary'].forEach((c) => assert.ok(tpl.includes(c), c));
  assert.ok(/\.chip-nativo > input,\s*\.chip-nativo > select\s*\{[^}]*opacity:\s*0;[^}]*font-size:\s*16px;/.test(html));
  assert.ok(html.includes('PainelCore.chipAdmissao(') && html.includes('function refreshIdChips('));
  assert.ok(tpl.includes('aria-label="Salvar médico na lista de sugestões"'));
  assert.ok(tpl.includes('aria-label="Adicionar a conduta e salvar na lista"'));
  assert.ok(/class="clear-discharge-forecast-btn[^"]*"[^>]*aria-label="Limpar previsão de alta"/.test(tpl));
});

test('index.html: seções do paciente na ordem definida pelo usuário, cada uma com seu atalho', () => {
  const secoes = [...tpl.matchAll(/data-secao="([a-z]+)" data-atalho="([a-z]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(secoes, [
    ['problemas', 'problemas'], ['hpp', 'historico'], ['alergias', 'historico'], ['anamnese', 'historico'],
    ['internacoes', 'historico'], ['controles', 'controles'], ['exames', 'exames'], ['condutas', 'condutas'],
    ['anotacoes', 'condutas'], ['evolucao', 'evolucao'], ['textos', 'docs'], ['documentos', 'docs'],
  ]);
});

test('index.html: barra de atalhos com os sete chips do spec', () => {
  const ini = html.indexOf('id="sectionNav"');
  const nav = html.slice(ini, html.indexOf('</nav>', ini));
  assert.deepStrictEqual([...nav.matchAll(/data-atalho="([a-z]+)">([^<]+)</g)].map((m) => [m[1], m[2]]), [
    ['problemas', 'Problemas'], ['historico', 'Histórico'], ['controles', 'Controles'], ['exames', 'Exames'],
    ['condutas', 'Condutas'], ['evolucao', 'Evolução'], ['docs', 'Docs'],
  ]);
  assert.ok(html.includes('function goToSection(') && html.includes('function observeSections('));
  assert.ok(/scroll-margin-top:\s*var\(--paciente-topo/.test(html));
  assert.ok(/body\.digitando #sectionNav\s*\{\s*display:\s*none/.test(html));
});

test('seloControle: os quatro tipos', () => {
  const T = '2026-08-27';
  const s = (t) => PainelCore.seloControle(t, T);
  const A = (p) => Object.assign({ type: 'atb', name: 'Cefepime' }, p);
  assert.deepStrictEqual(s(A({ startDate: '2026-08-20', duration: 7 })), { tipo: 'atb', rotulo: 'D8/7 prazo vencido', curto: 'D8/7', tom: 'perigo', alerta: true, ativo: true });
  assert.deepStrictEqual(s(A({ startDate: '2026-08-21', duration: 7 })), { tipo: 'atb', rotulo: 'D7/7 último dia', curto: 'D7/7', tom: 'atencao', alerta: true, ativo: true });
  assert.deepStrictEqual(s(A({ startDate: '2026-08-25', duration: 7 })), { tipo: 'atb', rotulo: 'D3/7', curto: 'D3/7', tom: 'neutro', alerta: false, ativo: true });
  assert.deepStrictEqual(s(A({ startDate: '2026-08-20' })), { tipo: 'atb', rotulo: 'D8', curto: 'D8', tom: 'atencao', alerta: true, ativo: true });
  assert.deepStrictEqual(s(A({ startDate: '2026-08-29', duration: 7 })), { tipo: 'atb', rotulo: 'Agendado', curto: 'Agendado', tom: 'neutro', alerta: false, ativo: true });
  assert.deepStrictEqual(s(A({ startDate: '2026-08-20', duration: 7, endDate: '2026-08-26' })), { tipo: 'atb', rotulo: 'Suspenso D7', curto: 'Suspenso D7', tom: 'neutro', alerta: false, ativo: false });
  const C = (p) => Object.assign({ type: 'culture', name: 'HMC' }, p);
  assert.deepStrictEqual(s(C({ collectionDate: '2026-08-24', result: 'Aguardando' })), { tipo: 'cultura', rotulo: 'D4', curto: 'D4', tom: 'atencao', alerta: true, ativo: true });
  assert.deepStrictEqual(s(C({ collectionDate: '2026-08-26', result: '' })), { tipo: 'cultura', rotulo: 'D2', curto: 'D2', tom: 'neutro', alerta: false, ativo: true });
  assert.deepStrictEqual(s(C({ collectionDate: '2026-08-24', result: 'Negativa final' })), { tipo: 'cultura', rotulo: 'D4', curto: 'D4', tom: 'neutro', alerta: false, ativo: false });
  const D = (p) => Object.assign({ type: 'device', name: 'CVC' }, p);
  assert.deepStrictEqual(s(D({ installDate: '2026-08-19' })), { tipo: 'dispositivo', rotulo: 'D9', curto: 'D9', tom: 'atencao', alerta: true, ativo: true });
  assert.deepStrictEqual(s(D({ installDate: '2026-08-10', removalDate: '2026-08-20' })), { tipo: 'dispositivo', rotulo: 'Removido D11', curto: 'Removido D11', tom: 'neutro', alerta: false, ativo: false });
  assert.deepStrictEqual(s(D({ kind: 'procedimento', installDate: '2026-08-23' })), { tipo: 'procedimento', rotulo: 'PO D5', curto: 'PO D5', tom: 'neutro', alerta: false, ativo: true });
});

test('fimPrevistoAtb: data digitada, ou D1 + duração − 1', () => {
  assert.strictEqual(PainelCore.fimPrevistoAtb({ startDate: '2026-11-12', duration: 7 }, '2026-11-18'), '2026-11-18');
  assert.strictEqual(PainelCore.fimPrevistoAtb({ startDate: '2026-11-12', duration: 7, endDate: '2026-11-20' }, '2026-11-18'), '2026-11-20');
  assert.strictEqual(PainelCore.fimPrevistoAtb({ startDate: '2026-08-28', duration: 7 }, '2026-08-28'), '2026-09-03', 'virada de mês');
  assert.strictEqual(PainelCore.fimPrevistoAtb({ startDate: '2026-11-12', duration: 7, endDate: '2026-11-17' }, '2026-11-18'), '', 'já suspenso');
  assert.strictEqual(PainelCore.fimPrevistoAtb({ startDate: '2026-11-12' }, '2026-11-18'), '');
});

test('linhaControle: a segunda linha de cada tipo', () => {
  const T = '2026-08-27';
  const l = (t) => PainelCore.linhaControle(t, T);
  assert.strictEqual(PainelCore.linhaControle({ type: 'atb', startDate: '2026-11-12', duration: 7 }, '2026-11-18'), 'ATB · D1 12/11 · fim previsto 18/11');
  assert.strictEqual(l({ type: 'atb', startDate: '2026-08-20', duration: 7, endDate: '2026-08-26' }), 'ATB · D1 20/08 · fim 26/08');
  assert.strictEqual(l({ type: 'atb', startDate: '2026-08-20' }), 'ATB · D1 20/08 · sem prazo, reavaliar');
  assert.strictEqual(l({ type: 'culture', collectionDate: '2026-08-24', result: 'Aguardando' }), 'Cultura · coleta 24/08 · Aguardando · resultado pendente');
  assert.strictEqual(l({ type: 'culture', collectionDate: '2026-08-26', result: '' }), 'Cultura · coleta 26/08 · Aguardando');
  assert.strictEqual(l({ type: 'culture', collectionDate: '2026-08-24', result: 'Negativa final' }), 'Cultura · coleta 24/08 · Negativa final');
  assert.strictEqual(l({ type: 'device', installDate: '2026-08-19' }), 'Disp · início 19/08 · tempo prolongado');
  assert.strictEqual(l({ type: 'device', installDate: '2026-08-10', removalDate: '2026-08-20' }), 'Disp · início 10/08 · removido 20/08');
  assert.strictEqual(l({ type: 'device', kind: 'procedimento', installDate: '2026-08-23' }), 'Proc · 23/08');
});

test('index.html: controles desenhados a partir do core, sem âmbar para cultura', () => {
  assert.ok(html.includes('PainelCore.seloControle(') && html.includes('PainelCore.linhaControle('));
  const ini = html.indexOf('function renderTrackerList(');
  const corpo = html.slice(ini, html.indexOf('function enableListDrag('));
  assert.ok(!/opacity-60'|amber|dayNumberToday|aguard/.test(corpo), 'a regra saiu de renderTrackerList');
  assert.ok(/data-type="culture"[^>]*teal/.test(html), 'o botão de Cultura do modal é teal');
  assert.ok(/\.tracker-item\[data-tipo="cultura"\]/.test(html));
});

test('index.html: resumo no título de cada seção fechada', () => {
  assert.strictEqual((tpl.match(/class="section-summary /g) || []).length, 11, 'todas as seções menos Exames, que já tem a linha de labs');
  assert.ok(html.includes('PainelCore.resumoSecao(') && html.includes('function refreshSectionSummary('));
  assert.ok(!html.includes('const GENDOC_LABEL') && html.includes('PainelCore.GENDOC_LABEL'));
  assert.ok(juntas('labs-last-line', 'line-clamp-2'));
});

test('umaLinha: quebra de linha vira um espaço', () => {
  assert.strictEqual(PainelCore.umaLinha('Pneumonia\ncomunitária\r\ngrave'), 'Pneumonia comunitária grave');
  assert.strictEqual(PainelCore.umaLinha('a \n\n b'), 'a b');
  assert.strictEqual(PainelCore.umaLinha('sem quebra'), 'sem quebra');
  assert.strictEqual(PainelCore.umaLinha(null), '');
});

test('index.html: campos de lista quebram linha sem inserir quebra; status por seletor', () => {
  // Marcação escrita literalmente (não por growFieldHtml): tests/html-refs.test.cjs só enxerga classes em class="…".
  assert.ok(html.includes('<div class="grow-wrap') && html.includes('function bindGrowField(') && html.includes('PainelCore.umaLinha('));
  ['problem-desc', 'problem-plan', 'hpp-desc', 'conduta-text', 'task-text'].forEach((c) => {
    assert.ok(!new RegExp('<input[^>]*class="[^"]*\\b' + c + '\\b').test(html), c + ' não é mais <input>');
    assert.ok(html.includes(c), c);
  });
  assert.ok(/\.grow-wrap::after\s*\{[^}]*content:\s*attr\(data-espelho\)/.test(html));
  assert.ok(html.includes('problem-status-select') && !html.includes('PROBLEM_STATUS_NEXT'));
});

test('janelaLabs: últimos 7 dias, ou as coletas mais recentes quando não há nenhuma no período', () => {
  const H = '2026-11-16';
  assert.deepStrictEqual(PainelCore.janelaLabs(['2026-11-10', '2026-11-16', '2026-10-01'], H), { inicio: '2026-11-09', fim: H, rotulo: 'Últimos 7 dias' });
  assert.deepStrictEqual(PainelCore.janelaLabs(['2026-10-01', '2026-11-06', '2026-10-20', '2026-11-01'], H), { inicio: '2026-10-20', fim: H, rotulo: 'Últimas 3 coletas' });
  assert.deepStrictEqual(PainelCore.janelaLabs(['2026-10-20', '2026-11-01', '2026-11-01'], H), { inicio: '2026-10-20', fim: H, rotulo: 'Últimas 2 coletas' });
  assert.deepStrictEqual(PainelCore.janelaLabs(['2026-11-01'], H), { inicio: '2026-11-01', fim: H, rotulo: 'Última coleta' });
  assert.deepStrictEqual(PainelCore.janelaLabs([], H), { inicio: '2026-11-09', fim: H, rotulo: 'Últimos 7 dias' });
  assert.deepStrictEqual(PainelCore.janelaLabs(['2026-11-20'], H), { inicio: '2026-11-20', fim: '2026-11-20', rotulo: 'Última coleta' }, 'data futura por erro de digitação continua visível');
});

test('rotuloFiltroLabs: diz o filtro em vigor', () => {
  const padrao = { inicio: '2026-11-09', fim: '2026-11-16', rotulo: 'Últimos 7 dias' };
  assert.strictEqual(PainelCore.rotuloFiltroLabs({ nome: '', inicio: '2026-11-09', fim: '2026-11-16' }, padrao), 'Últimos 7 dias');
  assert.strictEqual(PainelCore.rotuloFiltroLabs({ nome: ' TSH ', inicio: '2026-11-09', fim: '2026-11-16' }, padrao), 'Busca: TSH');
  assert.strictEqual(PainelCore.rotuloFiltroLabs({ nome: '', inicio: '2026-11-01', fim: '2026-11-10' }, padrao), '01/11 a 10/11');
  assert.strictEqual(PainelCore.rotuloFiltroLabs({ nome: '', inicio: '', fim: '' }, padrao), 'Todas as coletas');
});

test('index.html: filtros de labs recolhidos e modo de editar fixados', () => {
  assert.ok(html.includes('PainelCore.janelaLabs(') && html.includes('PainelCore.rotuloFiltroLabs('));
  assert.ok(html.includes('id="lab-filter-summary-btn"') && html.includes('id="toggle-pin-edit-btn"'));
  assert.ok(html.includes('let pinEditMode = false;'));
  assert.ok(!/<svg class="pin-exam-btn/.test(html), 'o alfinete de 14 px deixou de ser o alvo do toque');
  assert.ok(/<button type="button" class="pin-exam-btn [^"]*min-w-\[44px\]/.test(html));
});

test('vizinhosNaLista: dá a volta; fora da lista não há vizinho', () => {
  const v = PainelCore.vizinhosNaLista;
  assert.deepStrictEqual(v([4, 0, 2], 0), { anterior: 4, proximo: 2 });
  assert.deepStrictEqual(v([4, 0, 2], 4), { anterior: 2, proximo: 0 });
  assert.deepStrictEqual(v([4, 0, 2], 2), { anterior: 0, proximo: 4 });
  assert.deepStrictEqual(v([1, 5], 1), { anterior: 5, proximo: 5 });
  assert.deepStrictEqual(v([3], 3), { anterior: null, proximo: null });
  assert.deepStrictEqual(v([4, 0, 2], 7), { anterior: null, proximo: null }, 'paciente aberto de Arquivados');
  assert.deepStrictEqual(v([], 0), { anterior: null, proximo: null });
});

test('index.html: ‹ › mostram o leito vizinho e desabilitam fora da lista', () => {
  assert.ok(html.includes('PainelCore.vizinhosNaLista(renderedBedIndexes, currentPatientIndex)'));
  assert.ok(html.includes('function updateFooterNav('));
  assert.strictEqual((html.match(/class="nav-label /g) || []).length, 2);
  assert.ok(!/% renderedBedIndexes\.length/.test(html), 'a conta do vizinho saiu dos dois listeners');
});
