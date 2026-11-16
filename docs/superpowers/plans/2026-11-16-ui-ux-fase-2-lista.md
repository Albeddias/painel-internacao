# Revisão de UI/UX, Fase 2: tela inicial — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar peso certo aos elementos da lista de leitos: cabeçalho em três linhas com o progresso como título, botão Sincronizar com estado, menu ⋯ com as ações raras, pendências agrupadas por leito e cartão com estados distintos.

**Architecture:** Três peças de base entram primeiro (tokens de cor, aviso global, folha de ações) e são reaproveitadas pela Fase 3. Toda regra de exibição nova (estado do sync, progresso, gravidade das pendências, estado do leito, selo de alta) é função pura em `painel-core.js`, com teste. O `index.html` só desenha.

**Tech Stack:** HTML + JS clássico (UMD, sem build, funciona em `file://`), Tailwind pré-compilado (`styles.css`), `node --test`, Edge headless para capturas.

**Spec:** `docs/superpowers/specs/2026-11-16-redesign-ui-ux-design.md` (seções "Restrições", "Fase 2", "4.1", "4.2" e "Verificação visual"). Plano 2 de 4. Depende da Fase 1 entregue (`2026-11-16-ui-ux-fase-1-defeitos.md`): usa `tests/html-refs.test.cjs`, `tools/captura/`, o ajudante `juntas` de `tests/tela.test.cjs`, `setViewArchived` e `#viewSegment`.

## Global Constraints

- Funcionar 100% offline em `file://`: sem ES modules e sem dependências de build.
- Nada muda em `runSync`, `buildPushDiff`, migrations, `painel_sync_*`, `[NOME]` ou iniciais. Os flags `is*Minimized` continuam com os mesmos nomes.
- Regra de tela testável mora em `painel-core.js` e entra no objeto exportado. Função que depende de data recebe `hojeISO`; nada de `new Date()` sem argumento dentro do core.
- Testes: `node --test`, da raiz, sem argumento de caminho. Um só: `node --test --test-name-pattern="<trecho>"`. Suíte antes desta fase: cerca de 360 testes, 0 falhas.
- Elemento que muda de lugar leva o `id` e o listener junto. Não reescreva um handler que só precisa mudar de endereço.
- O que fica fora dos templates liga o listener uma vez só, na carga.
- Componente novo: `<button type="button">`, `aria-label` quando só tem ícone, anel de foco, alvo de 44 px, `print:hidden` se for fixo ou flutuante.
- Ação destrutiva que hoje passa por `showConfirm` continua passando, com o mesmo texto. Nesta fase, Sair ganha confirmação.
- Classe Tailwind nova: `npx tailwindcss@3 -o styles.css --content ./index.html --minify`, com o `styles.css` no mesmo commit.
- Larguras de conferência: 360, 390 e 1280 px. Orçamentos: cabeçalho fixo da lista até 170 px com os filtros fechados (hoje: cerca de 135 px); em 360 px, linha 1 = 148 + 128 + 44 + 16 e linha 3 = 154 + 88 + 44 + 16.
- Dados de teste e de captura são sempre fictícios.
- Branch `ui-fase-2`, criada de `master` no próprio diretório (sem worktree). Commits em português, `tipo(escopo): descrição`, terminando com `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Mescla e push só quando o usuário pedir.

## Review Focus

1. Nenhum leito, ou só externos e vazios: a frase do progresso não divide por zero e a barra some. Testes na Task 5.
2. Última sincronização ontem, na virada do ano, ou com o relógio do aparelho atrasado ("no futuro"): a legenda mostra o dia e não quebra. Testes na Task 4.
3. Falha de sincronização seguida de edição: a legenda continua "falhou" até a próxima sincronização dar certo. Teste na Task 4.
4. Dois ATBs alertando no mesmo leito, dispositivo de nome longo ou sem nome: rótulo curto, ordem e "+N" corretos. Testes nas Tasks 6 e 7.
5. Voltar do aparelho com a folha aberta, e item da folha que abre confirmação logo em seguida: a folha fecha, a tela não muda e a confirmação fica. Conferência manual na Task 3, repetida na entrega.

## Mapa de arquivos

| Arquivo | Responsabilidade nesta fase |
|---|---|
| `painel-core.js` | `estadoDoSync`, `progressoDoDia`, `fraseProgresso`, `fraseArquivados`, `LIMIARES`, `gravidade` e `curto` em `buildPendencias`, `agruparPendencias`, `statusAltaPrevista`, `estadoDoLeito`, `selosDoCartao`. |
| `tests/tela.test.cjs` | Testes das regras de tela e asserções de texto sobre o `index.html`. |
| `tests/pendencias.test.cjs` | Gravidade, rótulo curto e agrupamento. |
| `tests/sw.test.cjs` | `APP_VERSION` igual ao número do cache. |
| `index.html` | Tokens e classes, aviso global, folha de ações, cabeçalho, pendências, cartão. |
| `tools/captura/abre-tela.js` | Telas novas: `menu`, `aviso`, `lista:check`, `lista:edicao`, `lista:vazia`, `lista:filtro`. |
| `styles.css` | Regenerado. |
| `sw.js` | Cache `caderno-v11`. |

---

### Task 1: Tokens de cor e classes de componente (spec 2.0, 4.1, 4.2)

**Files:**
- Modify: `index.html` (bloco `<style>`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: variáveis CSS em `:root` e as classes abaixo. Toda marcação nova desta fase e da Fase 3 usa estas classes em vez de cores soltas do Tailwind.

  | Token | Valor | Token | Valor |
  |---|---|---|---|
  | `--c-primary` | `#0369a1` | `--c-success` | `#15803d` |
  | `--c-primary-bg` | `#e0f2fe` | `--c-success-bg` | `#dcfce7` |
  | `--c-primary-on-bg` | `#075985` | `--c-success-on-bg` | `#166534` |
  | `--c-primary-mark` | `#0284c7` | `--c-success-mark` | `#16a34a` |
  | `--c-warn` | `#b45309` | `--c-danger` | `#dc2626` |
  | `--c-warn-bg` | `#fef3c7` | `--c-danger-bg` | `#fee2e2` |
  | `--c-warn-on-bg` | `#92400e` | `--c-danger-on-bg` | `#991b1b` |
  | `--c-warn-mark` | `#d97706` | `--c-danger-mark` | `#dc2626` |
  | `--c-neutral-bg` | `#f1f5f9` | `--c-neutral-on-bg` | `#475569` |
  | `--c-surface` | `#ffffff` | `--c-surface-2` | `#f8fafc` |
  | `--c-border` | `#e2e8f0` | `--c-text` | `#1e293b` |
  | `--c-text-muted` | `#475569` | | |

  | Classe | O que é |
  |---|---|
  | `.btn` | base: 44 px de altura mínima, cantos de 0.5rem, `font-weight: 500`, 0.875rem, anel `:focus-visible` de 2 px em `--c-primary` |
  | `.btn-primary` / `.btn-ghost` / `.btn-danger` | fundo `--c-primary` com texto branco / fundo `--c-surface` com borda `--c-border` / fundo `--c-danger-bg` com texto `--c-danger-on-bg` |
  | `.btn-sm` | 36 px de altura, 0.75rem |
  | `.chip` | selo arredondado, 0.75rem, fundo `--c-neutral-bg`, texto `--c-neutral-on-bg` |
  | `.chip-primary` / `.chip-success` / `.chip-warn` / `.chip-danger` | fundo `-bg` e texto `-on-bg` do papel |
  | `.card` | fundo `--c-surface`, borda `--c-border`, cantos de 0.75rem, sombra `0 1px 2px rgba(15, 23, 42, 0.06)` |
  | `.field` | campo de formulário com borda, fundo `--c-surface-2`, padding de 0.75rem |
  | `.mark` + `.mark-primary` / `-success` / `-warn` / `-danger` | bolinha de 8 px na cor `-mark` do papel |

- [ ] **Step 1: Criar a branch**

```bash
git checkout master && git checkout -b ui-fase-2
```

- [ ] **Step 2: Escrever os testes**

No fim de `tests/tela.test.cjs`:

```js
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test --test-name-pattern="tokens de cor|classes de componente"`
Expected: FAIL, os tokens são `undefined`.

- [ ] **Step 4: Escrever os tokens e as classes**

No `<style>` do `index.html`, um bloco `:root { … }` com os tokens da tabela e, em seguida, as classes da segunda tabela. O `<style>` vem depois do `styles.css`: uma classe de componente vence um utilitário do Tailwind de mesma especificidade. Variação de tamanho é modificador (`.btn-sm`), nunca um `py-1` posto em cima de um `.btn`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/tela.test.cjs
git commit -m "feat(ui): tokens de cor e classes de componente com contraste testado"
```

---

### Task 2: Aviso global (spec 2.0)

**Files:**
- Modify: `index.html` (marcação depois das três telas; `setSyncStatus`, `flushSave`, bloco do `loadFailure`)
- Modify: `tools/captura/abre-tela.js`
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `avisar(msg: string, opts?: { tom?: 'neutro'|'sucesso'|'perigo', fixo?: boolean })` e `fecharAviso()`.
- Produces: `setSyncStatus(msg, isError = false)` continua com a mesma assinatura e passa a chamar `avisar(msg, { tom: isError ? 'perigo' : 'neutro' })`. Nenhuma chamada existente muda.

- [ ] **Step 1: Escrever a asserção**

```js
test('index.html: aviso global no lugar da linha de status do cabeçalho', () => {
  ['id="appNotice"', 'id="appNoticeMsg"', 'id="appNoticeClose"'].forEach((s) => assert.ok(html.includes(s), s));
  assert.ok(html.includes('function avisar(') && html.includes('function fecharAviso('));
  assert.ok(!html.includes('id="syncStatus"'), 'a linha só existia no cabeçalho da lista');
  const i = html.indexOf('function setSyncStatus(');
  assert.ok(html.slice(i, i + 300).includes('avisar('));
  assert.ok(html.includes("avisar('Não foi possível salvar neste aparelho: ' + e.message, { tom: 'perigo', fixo: true })"));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="aviso global"`
Expected: FAIL na primeira asserção.

- [ ] **Step 3: Implementar**

Marcação, depois de `#screen-tasks` e antes dos modais:

```html
<div id="appNotice" class="hidden fixed left-3 right-3 z-30 print:hidden" role="status" aria-live="polite">
  <div class="card flex items-start gap-2 p-3 text-sm">
    <span id="appNoticeMsg" class="flex-1 min-w-0"></span>
    <button type="button" id="appNoticeClose" aria-label="Fechar aviso">✕</button>
  </div>
</div>
```

Comportamento de `avisar`:
- escreve a mensagem, mostra a faixa e a posiciona logo abaixo do cabeçalho da tela ativa (`top` = `offsetHeight` do `header` de `.screen.active` + 8 px);
- `tom: 'perigo'` usa as cores de perigo e troca `role` para `alert`; os outros tons usam `role="status"`;
- some sozinha em 4000 ms, exceto com `tom: 'perigo'` ou `fixo: true`, que ficam até o ✕ ou até o próximo `avisar`;
- `z-30` fica acima dos cabeçalhos (`z-20`) e abaixo da folha de ações (`z-40`) e dos modais (`z-50`).

Chamadas que mudam:
- `flushSave`, no `catch`: a chamada exata do teste. Quando um `flushSave` posterior grava com sucesso, fecha esse aviso (guarde um booleano `saveFailureShown`).
- bloco do `loadFailure`, na carga: `avisar(<mesma mensagem de hoje>, { tom: 'perigo', fixo: true })`.

Sai o elemento `#syncStatus`. As duas chamadas de `setSyncStatus` logo depois do listener de `resetLocalBtn` ("Alterações locais não sincronizadas" e "Último sync: …") continuam por ora e saem na Task 4.

Em `tools/captura/abre-tela.js`, tela `aviso`: abre o paciente 0 e chama `avisar('Não foi possível salvar neste aparelho: QuotaExceededError', { tom: 'perigo', fixo: true })`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs aviso --largura=360
```
Expected: na tela do paciente, a faixa vermelha aparece logo abaixo do cabeçalho, com o texto inteiro e o ✕.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css tools/captura/abre-tela.js tests/tela.test.cjs
git commit -m "feat(ui): aviso global visível nas três telas"
```

---

### Task 3: Folha de ações e menu ⋯ da lista (spec 2.0, 2.1)

**Files:**
- Modify: `index.html` (CSS da folha, marcação de `#listMenuSheet`, botão `#listMenuBtn`, `popstate`, listener do `logoutBtn`, `<title>`)
- Modify: `tools/captura/abre-tela.js`
- Test: `tests/tela.test.cjs`, `tests/sw.test.cjs`

**Interfaces:**
- Produces: `openSheet(id: string, trigger?: HTMLElement)` e `closeSheet()`. Só uma folha aberta por vez. A Fase 3 cria `#patientMenuSheet` com o mesmo contrato.
- Produces: contrato de marcação de uma folha: contêiner `.sheet` com `role="dialog"`, `aria-modal="true"` e `aria-label`; dentro, `.sheet-backdrop[data-sheet-close]` e `.sheet-panel`; itens `.sheet-item` (48 px de altura), `.sheet-item-danger` para o destrutivo, `hr.sheet-sep`, e o último item `.sheet-item.sheet-cancel`.
- Produces: `closeAllModals()`, `currentScreenName(): 'list'|'details'|'tasks'`, `const APP_VERSION = '10';`.

- [ ] **Step 1: Escrever as asserções**

Em `tests/tela.test.cjs`:

```js
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
```

Em `tests/sw.test.cjs`:

```js
test('versão do app: APP_VERSION do index.html é o número do cache do sw.js', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const app = (html.match(/const APP_VERSION = '(\d+)';/) || [])[1];
  const cache = (SW_SRC.match(/const CACHE = 'caderno-v(\d+)';/) || [])[1];
  assert.ok(app, 'APP_VERSION não encontrado no index.html');
  assert.strictEqual(app, cache);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="menu ⋯ da lista|versão do app"`
Expected: 2 falhas.

- [ ] **Step 3: Escrever a marcação**

Depois do `#appNotice`:

```html
<div id="listMenuSheet" class="sheet hidden print:hidden" role="dialog" aria-modal="true" aria-label="Mais ações">
  <div class="sheet-backdrop" data-sheet-close></div>
  <div class="sheet-panel">
    <button type="button" id="resetChecksBtn" class="sheet-item">Resetar dia</button>
    <button type="button" id="exportDataBtn" class="sheet-item">Exportar backup</button>
    <label class="sheet-item">Importar backup<input type="file" id="importDataInput" class="hidden" accept=".json"></label>
    <button type="button" id="logoutBtn" class="sheet-item">Sair</button>
    <hr class="sheet-sep">
    <button type="button" id="resetLocalBtn" class="sheet-item sheet-item-danger">Resetar e receber do servidor</button>
    <button type="button" class="sheet-item sheet-cancel" data-sheet-close>Cancelar</button>
    <p id="appVersionLine" class="sheet-foot"></p>
  </div>
</div>
```

Os cinco elementos com `id` são os de hoje, movidos: saem do `#filter-actions` (que deixa de existir) e do cabeçalho (`#resetLocalBtn`). No cabeçalho, no lugar do `#resetLocalBtn`, entra `<button type="button" id="listMenuBtn" class="btn btn-ghost" aria-label="Mais ações">⋯</button>`, que chama `openSheet('listMenuSheet', este botão)`.

CSS: `.sheet` é `position: fixed; inset: 0; z-index: 40`. `.sheet-panel` fica colado embaixo, com largura total, cantos superiores arredondados e `padding-bottom: env(safe-area-inset-bottom)`; a partir de 640 px de largura, vira um painel centrado de até 24rem, como os modais. `.sheet-item` tem 48 px de altura, texto à esquerda e largura total. Com `prefers-reduced-motion`, sem animação.

`#appVersionLine` é preenchido a cada `openSheet`: `Caderno de Visitas · versão ${APP_VERSION} · ${window.innerWidth} px`. A largura fica ali só durante a revisão, para o usuário ler o valor no aparelho; a Fase 4 a retira.

O `<title>` vira `Caderno de Visitas`. Declare `const APP_VERSION = '10';` junto de `STORAGE_KEY`.

- [ ] **Step 4: Escrever o comportamento**

O ponto delicado é o histórico. A folha ganha uma entrada própria, para o voltar do aparelho só fechá-la; e quando ela é fechada pela tela, o `history.back()` que desfaz essa entrada dispara um `popstate` que não pode fechar a confirmação aberta logo em seguida.

```js
let openSheetId = null;         // folha aberta agora
let sheetTrigger = null;        // quem abriu: recebe o foco de volta
let pendingOverlayPop = false;  // o próximo popstate vem do nosso próprio history.back()

function currentScreenName() {
  if (screenDetails.classList.contains('active')) return 'details';
  return screenTasks.classList.contains('active') ? 'tasks' : 'list';
}
function hideSheetDom() {
  document.getElementById(openSheetId).classList.add('hidden');
  openSheetId = null;
  if (sheetTrigger) sheetTrigger.focus();
  sheetTrigger = null;
}
function openSheet(id, trigger) {
  if (openSheetId) return;
  openSheetId = id;
  sheetTrigger = trigger || null;
  const sheet = document.getElementById(id);
  sheet.classList.remove('hidden');
  history.pushState({ screen: currentScreenName(), overlay: id }, '');
  sheet.querySelector('.sheet-item').focus();
}
function closeSheet() {
  if (!openSheetId) return;
  hideSheetDom();
  if (history.state && history.state.overlay) { pendingOverlayPop = true; history.back(); }
}
```

No começo do handler de `popstate` que já existe, antes de qualquer outra coisa:

```js
if (pendingOverlayPop) { pendingOverlayPop = false; return; }  // fechamos pela tela: nada a fazer
if (openSheetId) { hideSheetDom(); return; }                   // voltar do aparelho: só fecha a folha
closeAllModals();                                              // modal aberto não fica sobre a lista
```

O resto do handler fica como está.

Ligações, uma vez só, na carga:
- em cada `.sheet`, um listener de `click` **na fase de captura** que chama `closeSheet()` quando o alvo está dentro de `.sheet-item` ou de `[data-sheet-close]`. Assim a folha fecha antes de o handler do próprio item rodar, e os handlers de hoje não mudam;
- `keydown` no documento: Esc chama `closeSheet()`.

`closeAllModals()` esconde os seis modais (`addBedModal`, `readmitModal`, `confirmModal`, `reminderModal`, `trackerModal`, `imageExamModal`) e limpa o estado de cada um como os botões "Cancelar" já fazem (`confirmCallback`, `currentReminderIndex`, `resetTrackerModal()`, `currentImageExamEditingId`, `readmitSource`).

`logoutBtn`: o que hoje roda direto no clique passa para dentro de `showConfirm('Sair? Para entrar de novo é preciso internet.', …, 'Sair', 'bg-slate-600', 'Sair')`.

Em `tools/captura/abre-tela.js`, tela `menu`: abre a lista e chama `openSheet('listMenuSheet')`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam, inclusive `html-refs`.

- [ ] **Step 6: Regenerar o CSS, capturar e conferir o voltar**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs menu --largura=360
node tools/captura/capturar.cjs menu --largura=1280
```
Expected: em 360 px, a folha colada embaixo, com os seis itens na ordem do spec, "Resetar e receber do servidor" em vermelho depois da linha, e a versão no rodapé. Em 1280 px, o mesmo painel centrado.

Abra `index.html` no navegador e confira o item 5 do Review Focus:
1. abrir o ⋯ e apertar o voltar do navegador: a folha fecha e a lista continua na tela;
2. abrir o ⋯ e tocar em "Sair": a folha fecha e a confirmação aparece e **fica**;
3. cancelar, abrir um paciente, abrir "+ Controle" e apertar voltar: o modal fecha e a lista aparece sem modal por cima;
4. tocar em "Importar backup": a janela de escolha de arquivo abre.

- [ ] **Step 7: Commit**

```bash
git add index.html styles.css tools/captura/abre-tela.js tests/tela.test.cjs tests/sw.test.cjs
git commit -m "feat(ui): menu ⋯ com as ações raras, Sair com confirmação e versão única"
```

---

### Task 4: Botão Sincronizar com estado (spec 2.1)

**Files:**
- Modify: `painel-core.js` (função nova + export)
- Modify: `index.html` (`#syncBtn`, `updateSyncBadge`, `saveData`, `syncWithSupabase`, chamadas de `saveData` que só tocam dado local)
- Modify: `tools/captura/abre-tela.js`
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `PainelCore.estadoDoSync(info, hojeISO)`, com `info = { sujo: boolean, ultimoSync: { dia: 'AAAA-MM-DD', hora: 'HH:MM' } | null, erro: boolean, emCurso: boolean }`. Devolve `{ tom: 'neutro'|'atencao'|'perigo', legenda: string }`.
- Produces: `saveData(state, { localOnly: true })`, que grava sem avançar `lastModifiedAt`.

- [ ] **Step 1: Escrever os testes**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="estadoDoSync|Sincronizar mantém"`
Expected: FAIL, `PainelCore.estadoDoSync is not a function`.

- [ ] **Step 3: Implementar `estadoDoSync`**

Em `painel-core.js`, exportada. Precedência: `emCurso`, depois `erro`, depois `ultimoSync` nulo, depois `sujo`, depois em dia. "hoje" e "ontem" saem de `dayNumber(ultimoSync.dia, hojeISO)` (1 = hoje, 2 = ontem); qualquer outro valor usa `formatDateBR(dia)`.

- [ ] **Step 4: Implementar no `index.html`**

Botão (o `id` e o listener ficam):

```html
<button type="button" id="syncBtn" class="btn btn-ghost sync-btn print:hidden" data-tom="neutro">
  <span class="flex items-center gap-1.5"><!-- ícone de hoje, 16 px --> Sincronizar</span>
  <span id="syncCaption" class="sync-caption"></span>
</button>
```

128 px de largura, duas linhas, legenda em 11 px. As cores vêm de `data-tom`: `atencao` usa borda `--c-warn-mark` e legenda `--c-warn`; `perigo` usa `--c-danger`.

- `saveData`: a condição do teste (`localOnly` também não avança `lastModifiedAt`).
- `let syncError = false;`. `updateSyncBadge()` é reescrita: monta `info` (`sujo` com a mesma condição de hoje; `ultimoSync` convertendo `state.lastSyncAt` para dia e hora **locais**; `erro: syncError`; `emCurso: syncInFlight`), chama `PainelCore.estadoDoSync(info, todayISO())` e escreve a legenda e o `data-tom`.
- `syncWithSupabase`: `syncError = false` no sucesso, `true` na falha; chama `updateSyncBadge()` no começo e no `finally`. Sai o `setSyncStatus('Sincronizando...')`; a mensagem de falha continua indo para `setSyncStatus(…, true)`.
- Saem as duas chamadas de `setSyncStatus` da carga ("Alterações locais não sincronizadas" e "Último sync: …"): a legenda já diz isso.

`{ localOnly: true }` entra nestas 17 chamadas de `saveData`, que só tocam campos fora de `buildPushPayload`:

| Onde | Quantas |
|---|---|
| `setupCollapsibleSection` (abrir/fechar seção) e o recolher das pendências | 2 |
| círculo de visita; checks diários na lista e no paciente | 3 |
| `ensureDailyReset` e "Resetar dia" | 2 |
| salvar e limpar lembrete | 2 |
| nome do médico externo e "salvar médico na lista" | 2 |
| tarefas: adicionar, marcar, editar, remover | 4 |
| exames fixados: fixar e mover | 2 |

A Queda (`bindQuedaDot`) **não** entra: ela vai para `painel_patients.queda_orientada`. Na dúvida sobre uma chamada, deixe sem `localOnly`: o erro possível é só o aviso aceso sem necessidade, como hoje.

Em `tools/captura/abre-tela.js`:
- `lista:check`: clica no primeiro `.dot` da lista;
- `lista:edicao`: `state.beds[0].problems[0].descricao += ' x'; saveData(state); renderScreenA();`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 6: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs lista --largura=360
node tools/captura/capturar.cjs lista:check --largura=360
node tools/captura/capturar.cjs lista:edicao --largura=360
```
Expected: `lista` e `lista:check` mostram "Sincronizar" com a legenda "hoje 09:22 ✓" em tom neutro (marcar um check não acende o aviso). `lista:edicao` mostra "alterações a enviar" em âmbar.

- [ ] **Step 7: Commit**

```bash
git add painel-core.js index.html styles.css tools/captura/abre-tela.js tests/tela.test.cjs
git commit -m "feat(sync): botão Sincronizar com legenda de estado; gravação local não acende o aviso"
```

---

### Task 5: Cabeçalho em três linhas, com o progresso como título (spec 2.1, 2.2)

**Files:**
- Modify: `painel-core.js` (três funções + export)
- Modify: `index.html` (`#listHeader`, `renderScreenA`, `setViewArchived`, listener do `openTasksBtn`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `PainelCore.progressoDoDia(state)` → `{ total, ocupados, aVisitar, visitados, pendentes, externos, vazios, tarefasAbertas }` (números; só leitos não arquivados).
- Produces: `PainelCore.fraseProgresso(p)` → `{ titulo: string, detalhe: string, fracao: number | null }`.
- Produces: `PainelCore.fraseArquivados(pessoas: number, naNuvem: number)` → `{ titulo: 'Arquivados', detalhe: string }`.
- Produces: `#progressTitle`, `#progressDetail`, `#progressBar` (com `#progressBarFill` dentro), `#tasksCount`.

- [ ] **Step 1: Escrever os testes**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="progressoDoDia|fraseProgresso|fraseArquivados|cabeçalho da lista"`
Expected: FAIL, `PainelCore.progressoDoDia is not a function`.

- [ ] **Step 3: Implementar as três funções no core**

Regras de `progressoDoDia`, iguais às de `renderScreenA` hoje: leito ocupado é o que tem nome depois de `trim()`; externo é ocupado com `externalDoctor.active`; visitado é ocupado, não externo, com `isVisited`; `pendentes = ocupados − visitados − externos`; `aVisitar = ocupados − externos`. `tarefasAbertas` conta `generalTasks` com `done` falso.

- [ ] **Step 4: Reescrever o cabeçalho**

Estrutura de `#listHeader` (os `id` de hoje continuam; a ordem é a do teste):

```
linha 1  [#progressTitle / #progressDetail]              [#syncBtn] [#listMenuBtn]
linha 2  [#searchInput                                 ] [#toggleFiltersBtn "Filtros"]
linha 3  [#viewSegment]                    [#openTasksBtn "Tarefas" #tasksCount] [#addBedBtn ＋]
         #filtersPanel (recolhido; só "Ocultar…" e "Ordenar por")
base     #progressBar > #progressBarFill   (faixa de 3 px, sem linha própria)
```

- `#progressTitle`: `text-base font-semibold`, cortado com reticências. `#progressDetail`: `text-xs`, `--c-text-muted`.
- `#toggleFiltersBtn` ganha o texto "Filtros" ao lado do ícone.
- `#openTasksBtn` vira `.chip` de 36 px de altura com "Tarefas" e o número em `#tasksCount`; com zero, o número some.
- `#addBedBtn` vira `.btn btn-ghost` quadrado de 44 px, com o ícone de mais e `aria-label="Adicionar leito"`.
- `#progressBar`: `role="progressbar"`, `aria-valuemin="0"`, e `aria-valuenow`/`aria-valuemax` atualizados em `renderScreenA`. O preenchimento usa `--c-primary`, e `--c-success` quando a fração é 1. Fica escondida quando `fracao` é `null` e em Arquivados.

`renderScreenA`: sai o bloco que monta "T | V | P | E". Em Ativos, escreve título e detalhe de `fraseProgresso(progressoDoDia(state))`. Em Arquivados, os de `fraseArquivados(PainelCore.groupArchived(state.beds, null).length, PainelCore.groupCloudArchived(state.cloudArchived || {}).length)`. Atualiza `#tasksCount` nos dois casos.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 6: Regenerar o CSS e conferir os orçamentos**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs lista:medir --largura=360
node tools/captura/capturar.cjs lista:medir --largura=390
node tools/captura/capturar.cjs arquivados:medir --largura=360
```
Expected: a etiqueta mostra o cabeçalho com até 170 px. Em 360 px, nenhuma das três linhas quebra nem é cortada. O título lê "2 de 5 visitados" com "1 externo · 1 vazio" embaixo (leitos 0 e 1 visitados; 0, 1, 3, 5 e 6 a visitar). Em Arquivados: "Arquivados" e "2 pacientes · 1 na nuvem", sem barra e sem o ＋. Se o cabeçalho passar de 170 px, reduza os respiros verticais antes de seguir.

- [ ] **Step 7: Commit**

```bash
git add painel-core.js index.html styles.css tests/tela.test.cjs
git commit -m "feat(lista): cabeçalho em três linhas, com o progresso do dia como título"
```

---

### Task 6: Pendências por leito, com gravidade (spec 2.3)

**Files:**
- Modify: `painel-core.js` (`buildPendencias`, `agruparPendencias`, `LIMIARES` + exports)
- Modify: `index.html` (`renderPendenciasPanel`, limiares em `renderTrackerList`)
- Test: `tests/pendencias.test.cjs`, `tests/tela.test.cjs`

**Interfaces:**
- Produces: `PainelCore.LIMIARES = { culturaDias: 3, dispositivoDias: 7, atbLongoDia: 8 }`.
- Produces: cada item de `buildPendencias` ganha `gravidade: 'alerta'|'atencao'|'info'` e `curto: string`. Os campos de hoje (`bedIndex`, `bedNumber`, `patientName`, `tipo`, `label`) não mudam.
- Produces: `PainelCore.agruparPendencias(pend)` → `[{ bedIndex, bedNumber, gravidadeMax, itens }]`.
- Produces: mapa de gravidade para tom, usado aqui e na Task 7: `alerta` → `danger`, `atencao` → `warn`, `info` → `primary`.

- [ ] **Step 1: Escrever os testes**

Em `tests/pendencias.test.cjs` (os ajudantes `bed`, `pend` e `TODAY = '2026-08-27'` já existem):

```js
test('pendências: gravidade e rótulo curto de cada tipo', () => {
  const out = pend([bed({
    trackers: [
      { id: 'a', type: 'atb', name: 'Cefepime', startDate: '2026-08-20', duration: 7 },
      { id: 'b', type: 'atb', name: 'Pipe-tazo', startDate: '2026-08-21', duration: 7 },
      { id: 'c', type: 'culture', name: 'HMC', collectionDate: '2026-08-24', result: 'Aguardando' },
      { id: 'd', type: 'device', name: 'CVC Subclávia D', installDate: '2026-08-19' },
    ],
    dischargeForecast: '2026-08-25', reminderDate: '2026-08-27',
  })]);
  assert.deepStrictEqual(out.map((p) => [p.tipo, p.gravidade, p.curto]), [
    ['atb', 'alerta', 'ATB D8/7'], ['atb', 'atencao', 'ATB D7/7'], ['cultura', 'atencao', 'Cultura D4'],
    ['dispositivo', 'atencao', 'CVC D9'], ['alta', 'alerta', 'Alta atrasada'], ['lembrete', 'atencao', 'Lembrete'],
  ]);
});

test('pendências: alta de hoje é info; dispositivo de nome longo ou sem nome', () => {
  assert.deepStrictEqual(pend([bed({ dischargeForecast: TODAY })]).map((p) => [p.gravidade, p.curto]), [['info', 'Alta hoje']]);
  const disp = (name) => pend([bed({ trackers: [{ id: 'd', type: 'device', name: name, installDate: '2026-08-20' }] })])[0].curto;
  assert.strictEqual(disp('Traqueostomia'), 'Traqueos D8');
  assert.strictEqual(disp(''), 'Disp D8');
  assert.strictEqual(disp('   '), 'Disp D8');
});

test('agruparPendencias: uma entrada por leito, a mais grave primeiro', () => {
  const g = PainelCore.agruparPendencias(pend([
    bed({ bedNumber: '1010', dischargeForecast: TODAY }),
    bed({ bedNumber: '1013', reminderDate: TODAY }),
    bed({ bedNumber: '1012-A', reminderDate: TODAY, dischargeForecast: '2026-08-25' }),
    bed({ bedNumber: '1011', reminderDate: TODAY }),
  ]));
  assert.deepStrictEqual(g.map((x) => [x.bedNumber, x.gravidadeMax, x.itens.length]),
    [['1012-A', 'alerta', 2], ['1011', 'atencao', 1], ['1013', 'atencao', 1], ['1010', 'info', 1]]);
  assert.deepStrictEqual(g[0].itens.map((i) => i.gravidade), ['alerta', 'atencao'], 'dentro do leito, por gravidade');
  assert.strictEqual(g[0].bedIndex, 2);
  assert.deepStrictEqual(PainelCore.agruparPendencias([]), []);
});
```

Em `tests/tela.test.cjs`:

```js
test('LIMIARES: os limiares de alerta vivem num lugar só', () => {
  assert.deepStrictEqual(PainelCore.LIMIARES, { culturaDias: 3, dispositivoDias: 7, atbLongoDia: 8 });
  assert.ok(!/cDays >= 3/.test(html) && !/dDays >= 7/.test(html), 'o index.html usa PainelCore.LIMIARES');
  assert.ok(html.includes('PainelCore.agruparPendencias('));
  assert.ok(!html.includes('PENDENCIA_COLORS'), 'a bolinha segue a gravidade, não o tipo');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="pendências: gravidade|pendências: alta de hoje|agruparPendencias|LIMIARES"`
Expected: 4 falhas.

- [ ] **Step 3: Implementar no core**

- `LIMIARES`, usada por `buildPendencias` e por `atbBadge` no lugar dos números soltos.
- `buildPendencias`: `gravidade` e `curto` conforme a tabela do spec 2.3. No dispositivo, `curto` é a primeira palavra do nome cortada em 8 caracteres, mais `' D' + n`; sem nome, `'Disp'`.
- `agruparPendencias`: ordem dos grupos por gravidade máxima (alerta, atenção, info) e, no empate, por `bedNumber` em minúsculas com `localeCompare`, como a lista. Dentro do grupo, ordenação estável por gravidade.

- [ ] **Step 4: Implementar o painel**

`renderPendenciasPanel`:
- título `Pendências (N leitos, M itens)`, com singular ("1 leito, 1 item");
- uma linha por grupo: `<button class="pendencia-item …" data-bed-index="…">` com `<span class="mark mark-<tom>">`, o leito em negrito e os `curto` dos itens unidos por `' · '`, cortados com reticências;
- o toque abre o paciente, como hoje; o recolhimento continua em `state.isPendenciasMinimized`;
- sai `PENDENCIA_COLORS`.

`renderTrackerList`: os dois números soltos (cultura e dispositivo) viram `PainelCore.LIMIARES.culturaDias` e `.dispositivoDias`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam, inclusive os testes antigos de pendências (os `label` não mudaram).

- [ ] **Step 6: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs lista --largura=360
```
Expected: o painel lê "Pendências (2 leitos, 6 itens)". Primeira linha, com bolinha vermelha: "1012-A · ATB D8/7 · Alta atrasada · Cultura D4 · CVC D9 · Lembrete" (cortada se não couber). Segunda, com bolinha azul: "1030-C · Alta hoje".

- [ ] **Step 7: Commit**

```bash
git add painel-core.js index.html styles.css tests/pendencias.test.cjs tests/tela.test.cjs
git commit -m "feat(lista): pendências agrupadas por leito, com gravidade"
```

---

### Task 7: Cartão do leito (spec 2.4)

**Files:**
- Modify: `painel-core.js` (três funções + export)
- Modify: `index.html` (`patientListTpl`, template novo `emptyBedTpl`, `renderScreenA`, `handleAddNewBed`)
- Modify: `tools/captura/abre-tela.js`
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: `buildPendencias` com `gravidade` e `curto` (Task 6); `.chip`, `.card`, `.mark` (Task 1).
- Produces: `PainelCore.statusAltaPrevista(dataISO, hojeISO)` → `null` ou `{ status: 'atrasada'|'hoje'|'breve'|'futura', rotulo: string, tom: 'perigo'|'primaria'|'atencao'|'neutro' }`. A Fase 3 usa no cartão de identificação.
- Produces: `PainelCore.estadoDoLeito(bed)` → `'vazio'|'externo'|'concluido'|'pendente'`.
- Produces: `PainelCore.selosDoCartao(itens, max)` → `{ selos: [{ curto, gravidade }], resto: number }`.
- Produces: `openAddBedModal()` e `openPatientAndFocusName(bedIndex)`.

- [ ] **Step 1: Escrever os testes**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="statusAltaPrevista|estadoDoLeito|selosDoCartao|cartão usa"`
Expected: 4 falhas.

- [ ] **Step 3: Implementar no core**

- `statusAltaPrevista`: mesma regra de `getDischargeStatus` (atrasada se a data passou; breve se falta 1 ou 2 dias), agora com `hojeISO` como parâmetro.
- `estadoDoLeito`: mesma ordem de `isBedCompleted` (vazio, depois externo, depois visita + quatro checks).
- `selosDoCartao`: descarta os tipos `alta` e `lembrete`, ordena por gravidade de forma estável, devolve os `max` primeiros e quantos sobraram.

- [ ] **Step 4: Reescrever os templates e o desenho**

`patientListTpl` (as classes que o script já procura continuam: `list-card`, `visit-check-circle`, `bed-id`, `reminder-tag`, `ext-tag`, `bed-name`, `inline-los`, `discharge-tag`, `checks`):

```
.list-card.card
  linha 1+2  [button.visit-check-circle 44 px, ocupa as duas linhas]
             linha 1: .bed-id  .reminder-tag  .ext-tag            .inline-los (à direita)
             linha 2: .bed-name (largura inteira, cortado com reticências)
  linha 3    .card-foot (flex-wrap, respiro de 8 px)
             .discharge-tag.chip   .card-selos (os selos e o "+N")   .checks (ml-auto)
```

`emptyBedTpl`: `<button type="button" class="list-card empty-bed card w-full text-left …">`, uma linha com o leito em negrito e " · Vazio — toque para admitir". Sem círculo, sem checks.

`renderScreenA`, para cada leito ativo, conforme `PainelCore.estadoDoLeito(b)`:

| Estado | Desenho |
|---|---|
| `vazio` | `emptyBedTpl`; o toque chama `openPatientAndFocusName(idx)` |
| `externo` | cartão normal, com o chip do médico; `.checks` escondido; o círculo vira um marcador neutro, `disabled`, com "–" e `aria-label="Acompanhado por médico externo"` |
| `concluido` | cartão normal, com a classe `card-done` (fundo `#f0fdf4`, borda `#bbf7d0`) |
| `pendente` | cartão normal |

- O círculo de visita é `<button type="button">` com `aria-pressed` e `aria-label="Visita"`. Visitado: `--c-success-mark` de fundo e ✓ branco.
- `.discharge-tag`: `rotulo` e tom de `statusAltaPrevista` (`perigo` → `.chip-danger`, `primaria` → `.chip-primary`, `atencao` → `.chip-warn`, `neutro` → `.chip`).
- `.card-selos`: `selosDoCartao` sobre as pendências daquele leito (`buildPendencias` é chamada uma vez por `renderScreenA` e filtrada por `bedIndex`), com no máximo 2 selos e o "+N". Gravidade para classe: `alerta` → `.chip-danger`, `atencao` → `.chip-warn`, `info` → `.chip-primary`.
- "Ocultar concluídos" esconde todo leito cujo estado não é `pendente`. Saem `isBedCompleted`, `getDischargeStatus`, a classe `opacity-60` do cartão e `.reminder-list-active` (classe e uso).
- No fim da lista de ativos: `<button type="button" class="add-bed-row …">+ Adicionar leito</button>`, com borda tracejada, que chama `openAddBedModal()`. O listener de `#addBedBtn` passa a chamar a mesma função.
- `handleAddNewBed` passa a usar `openPatientAndFocusName(newIdx)`, que é o que o `setTimeout` de hoje faz.

Lista vazia:
- sem nenhum leito ativo no aparelho: a frase do teste, e a linha "+ Adicionar leito" logo abaixo;
- com leitos, mas nenhum visível: "Nenhum leito com esse filtro." e um botão. Se há texto na busca, o botão é "Limpar busca" e limpa o campo. Se não há, o filtro "Ocultar" é que esvaziou a lista: o botão é "Mostrar todos" e desliga o filtro.

Em `tools/captura/abre-tela.js`:
- `lista:vazia`: `state.beds = []; renderScreenA();`
- `lista:filtro`: escreve "zzz" em `#searchInput` e chama `renderScreenA()`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 6: Regenerar o CSS e conferir a largura**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs lista --largura=360 --cheia
node tools/captura/capturar.cjs lista --largura=390 --cheia
node tools/captura/capturar.cjs lista:vazia --largura=360
node tools/captura/capturar.cjs lista:filtro --largura=360
```
Expected, em 360 px:
- leito 0: o selo de alta em vermelho ("Alta DD/MM ⚠"), depois "ATB D8/7", "Cultura D4" e "+1", com os checks numa quarta linha;
- leito 1: fundo esverdeado, cinco checks marcados, selo de alta neutro ao lado dos checks, sem quarta linha;
- leito 2: chip do médico, marcador neutro no lugar do círculo, sem checks;
- leito 3: o nome longo ocupa a linha inteira e termina em reticências;
- leito 4: uma linha só, "1021 · Vazio — toque para admitir";
- leito 5: "Alta hoje" em azul, na mesma linha dos checks;
- no fim, a linha tracejada "+ Adicionar leito".

Nenhum cartão usa transparência. `lista:vazia` e `lista:filtro` mostram as duas mensagens.

- [ ] **Step 7: Commit**

```bash
git add painel-core.js index.html styles.css tools/captura/abre-tela.js tests/tela.test.cjs
git commit -m "feat(lista): cartão do leito com estados distintos, selos de pendência e leito vazio compacto"
```

---

### Task 8: Entrega da Fase 2

**Files:**
- Modify: `sw.js`, `index.html` (`APP_VERSION`)

- [ ] **Step 1: Subir a versão**

`sw.js`: `'caderno-v11'`. `index.html`: `const APP_VERSION = '11';`. Os dois mudam juntos; o teste da Task 3 confere.

- [ ] **Step 2: Suíte inteira**

Run: `node --test`
Expected: 0 falhas.

- [ ] **Step 3: Capturas finais**

Run, para cada largura em 360, 390 e 1280:
```bash
node tools/captura/capturar.cjs lista:medir --largura=<L> --cheia
node tools/captura/capturar.cjs arquivados --largura=<L>
node tools/captura/capturar.cjs menu --largura=<L>
node tools/captura/capturar.cjs aviso --largura=<L>
node tools/captura/capturar.cjs tarefas --largura=<L>
node tools/captura/capturar.cjs paciente:0:aberto --largura=<L> --cheia
```
Expected: cabeçalho da lista com até 170 px; nenhuma linha quebrada em 360 px; nada cortado nem sobreposto. A tela do paciente está igual à do fim da Fase 1, salvo o aviso global.

- [ ] **Step 4: Checklist de regressão**

Abra `index.html` no navegador e percorra os itens de Lista, Arquivados e Tarefas do checklist do spec. Atenção ao que esta fase moveu: cada um dos cinco itens do menu ⋯ faz o que fazia; "Resetar e receber" e "Importar backup" mostram a confirmação de sempre; a busca acha por leito, nome, problema e HPP; a ordenação e o "Ocultar" funcionam; tocar numa linha de pendência abre o paciente; marcar a visita e os checks atualiza o título do progresso. Repita os quatro passos de conferência do voltar da Task 3.

- [ ] **Step 5: Registrar as convenções no CLAUDE.md**

Na seção "Desenvolvimento", no estilo das linhas que já estão lá:
- a versão: ao subir o cache em `sw.js`, suba `APP_VERSION` no `index.html` junto (`tests/sw.test.cjs` confere);
- cores e componentes: usar os tokens `--c-*` e as classes `.btn`, `.chip`, `.card`, `.field`, `.mark`; variação é modificador, não utilitário por cima;
- gravação que só toca dado local (flags de seção, visita, checks diários, lembrete, médico externo, tarefas, fixados) usa `saveData(state, { localOnly: true })`; na dúvida, sem a opção;
- mensagens ao usuário passam por `avisar` (ou `setSyncStatus`), visível nas três telas; menus usam `openSheet`/`closeSheet`.

Na linha das regras de tela que moram no core, acrescente as funções desta fase (`estadoDoSync`, `progressoDoDia`, `fraseProgresso`, `agruparPendencias`, `statusAltaPrevista`, `estadoDoLeito`, `selosDoCartao`, `LIMIARES`).

- [ ] **Step 6: Commit**

```bash
git add sw.js index.html CLAUDE.md
git commit -m "chore(sw): cache v11 (fase 2 da revisão de UI)"
```

- [ ] **Step 7: Entregar ao usuário para conferir no aparelho**

Mostre as capturas de 360 px e peça, no Galaxy A54: abrir o menu ⋯ e ler a largura no rodapé (anotar o valor); apertar o voltar do aparelho com o menu aberto; marcar uma visita e ver que a legenda do Sincronizar não muda; editar um problema e ver "alterações a enviar"; sincronizar de verdade e ver "hoje HH:MM ✓". Mescla e push só quando ele pedir.
