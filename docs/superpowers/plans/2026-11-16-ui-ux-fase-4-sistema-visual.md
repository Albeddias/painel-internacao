# Revisão de UI/UX, Fase 4: sistema visual e acessibilidade — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a revisão: cada cor com um significado só e com contraste suficiente, todo o app nas classes de componente, acessibilidade nos pontos que as fases 1 a 3 não tocaram, largura de leitura no computador e, se o usuário quiser, modo escuro.

**Architecture:** É uma fase de migração: o comportamento não muda. Cada task troca um conjunto fechado de classes ou atributos e é presa por uma asserção de texto que proíbe o que saiu (contagem zero). O que tem regra (a cor do chip de médico) vai para o core com teste. O modo escuro é a última task e é opcional.

**Tech Stack:** HTML + JS clássico (UMD, sem build, funciona em `file://`), Tailwind pré-compilado (`styles.css`), `node --test`, Edge headless para capturas.

**Spec:** `docs/superpowers/specs/2026-11-16-redesign-ui-ux-design.md` (seções "Restrições", "Fase 4" e "Verificação visual"). Plano 4 de 4. Depende das fases 1 a 3 entregues: usa os tokens e as classes de componente (Fase 2), a função `contraste` e os ajudantes `token`, `juntas` e `tpl` de `tests/tela.test.cjs`, o padrão de botão escondido até o hover (Fase 1), a folha de ações e `closeAllModals` (Fase 2).

## Global Constraints

- Funcionar 100% offline em `file://`: sem ES modules e sem dependências de build.
- Nada muda em `runSync`, `buildPushDiff`, migrations, `painel_sync_*`, `[NOME]` ou iniciais.
- **Nenhum comportamento muda nesta fase**, salvo o que o spec lista: cor do botão de confirmação, cor do chip de médico, setas de tendência em cinza, foco e teclado nos modais. O texto de toda confirmação fica idêntico.
- Testes: `node --test`, da raiz, sem argumento de caminho. Um só: `node --test --test-name-pattern="<trecho>"`. Suíte antes desta fase: cerca de 420 testes, 0 falhas.
- Contraste: texto 4,5:1; ícone, bolinha e barra 3:1. Os tons de cada papel estão na tabela do spec 4.1 e nos tokens `--c-*`.
- Uma classe de componente vence um utilitário do Tailwind de mesma especificidade: ao pôr `.btn` ou `.card` num elemento, retire dele os utilitários de cor, borda, padding e sombra que a classe já define.
- Classe Tailwind nova: `npx tailwindcss@3 -o styles.css --content ./index.html --minify`, com o `styles.css` no mesmo commit.
- Larguras de conferência: 360, 390 e 1280 px.
- Dados de teste e de captura são sempre fictícios.
- Branch `ui-fase-4`, criada de `master` no próprio diretório (sem worktree). Commits em português, `tipo(escopo): descrição`, terminando com `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Mescla e push só quando o usuário pedir.

## Review Focus

1. O texto de cada confirmação continua idêntico depois que a cor do botão passa a ser um tom. Asserção na Task 1.
2. Botão desabilitado ("Copiar" de campo vazio, ‹ › fora da lista) continua visível e claramente desabilitado depois da troca de classes. Conferência na Task 1.
3. Teclado no computador: Tab entra no modal e não escapa para a página atrás; Esc fecha; o foco volta ao botão que abriu. Conferência na Task 2.
4. Médico externo já cadastrado: a cor do chip muda uma única vez e fica estável; nenhuma cai em vermelho, laranja ou verde. Teste na Task 1.
5. Impressão: cabeçalhos, barra de atalhos, rodapés, aviso e folhas não saem no papel. Asserção na Task 2.

## Mapa de arquivos

| Arquivo | Responsabilidade nesta fase |
|---|---|
| `painel-core.js` | `CORES_MEDICO`, `corDoMedico`. |
| `tests/tela.test.cjs` | Proibições de classe (contagem zero), paleta do médico, modais, largura. |
| `index.html` | Migração de cores, `showConfirm` por tom, acessibilidade, largura do paciente, tema escuro (opcional). |
| `tools/captura/abre-tela.js` | Sufixo `:escuro` (só se a Task 4 for feita). |
| `styles.css` | Regenerado. |
| `sw.js` | Cache `caderno-v13`. |
| `CLAUDE.md` | Convenções novas de desenvolvimento. |

---

### Task 1: Cores com significado fixo (spec 4.1, 4.2)

**Files:**
- Modify: `painel-core.js` (paleta + função + export)
- Modify: `index.html` (classes de cor em todo o arquivo, `showConfirm` e suas chamadas, `getDoctorColorClasses`, setas de tendência)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `PainelCore.CORES_MEDICO` (6 pares `{ bg, text }`) e `PainelCore.corDoMedico(nome)` → `{ bg, text }`.
- Produces: `showConfirm(message, onConfirm, title = 'Ação Irreversível', tom = 'perigo', btnText = 'Confirmar')`, com `tom` em `'perigo'|'primaria'|'neutro'`. O quarto parâmetro deixa de ser uma classe do Tailwind.
- Produces: classe CSS `.btn-solid-danger` (fundo `--c-danger`, texto branco) e `.btn-solid-neutral` (fundo `--c-neutral-on-bg`, texto branco).

- [ ] **Step 1: Criar a branch e escrever os testes**

```bash
git checkout master && git checkout -b ui-fase-4
```

```js
test('corDoMedico: paleta sem matiz de estado, com contraste, estável por nome', () => {
  assert.strictEqual(PainelCore.CORES_MEDICO.length, 6);
  const proibidas = ['#fecaca', '#fed7aa', '#bbf7d0', '#d1fae5']; // vermelho, laranja e verdes da paleta antiga
  PainelCore.CORES_MEDICO.forEach((p) => {
    assert.ok(!proibidas.includes(p.bg), p.bg);
    assert.ok(contraste(p.bg, p.text) >= 4.5, p.bg + ' / ' + p.text);
  });
  const cor = PainelCore.corDoMedico('Dra. Exemplo Externa');
  assert.deepStrictEqual(cor, PainelCore.corDoMedico('Dra. Exemplo Externa'));
  assert.ok(PainelCore.CORES_MEDICO.some((p) => p.bg === cor.bg && p.text === cor.text));
  assert.deepStrictEqual(PainelCore.corDoMedico(''), { bg: '#e5e7eb', text: '#374151' });
});

test('index.html: nenhuma cor reprovada no contraste, nem cor de botão fora dos papéis', () => {
  ['shadow-lg', 'bg-indigo-', 'text-indigo-', 'bg-purple-', 'text-purple-', 'bg-sky-600', 'bg-sky-500', 'bg-green-500',
    'bg-green-600', 'bg-amber-500', 'bg-amber-600', 'text-slate-400', 'text-slate-300', 'text-sky-600', 'text-sky-500',
    'text-green-600', 'text-amber-600', 'ring-sky-500', 'doctorColorPairs']
    .forEach((c) => assert.strictEqual(html.split(c).length - 1, 0, c));
  assert.ok(html.includes('PainelCore.corDoMedico('));
});

test('index.html: a confirmação recebe um tom, e os textos continuam os mesmos', () => {
  assert.ok(!/, 'bg-[a-z]+-\d{3}', '/.test(html), 'showConfirm não recebe mais classe do Tailwind');
  assert.ok(/function showConfirm\(message, onConfirm, title = "Ação Irreversível", tom = 'perigo', btnText = 'Confirmar'\)/.test(html));
  ['Dar alta no paciente do leito', 'Arquivar o leito', 'Deletar PERMANENTEMENTE o leito', 'Isso substituirá TODOS os dados atuais. Continuar?',
    'Isso vai APAGAR todos os leitos deste dispositivo', 'Deletar todos os exames da coleta do dia', 'Resetar todos os checks de visita',
    'Sair? Para entrar de novo é preciso internet.'].forEach((t) => assert.ok(html.includes(t), t));
});

test('index.html: setas de tendência dos labs em cinza', () => {
  const ini = html.indexOf('function renderLabFlowsheet(');
  const corpo = html.slice(ini, html.indexOf('function renderImageTab('));
  assert.ok(!/text-red-500|text-sky-500/.test(corpo), 'subir ou descer não é alerta; a cor fica para o valor fora da faixa');
  assert.ok(corpo.includes("'text-red-600 font-semibold'"), 'valor alto continua vermelho');
});
```

No teste "remover tarefa" da Fase 1, a asserção `'Remover tarefa', 'bg-red-600', 'Remover'` passa a ser `'Remover tarefa', 'perigo', 'Remover'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="corDoMedico|nenhuma cor reprovada|confirmação recebe um tom|setas de tendência"`
Expected: 4 falhas.

- [ ] **Step 3: Implementar a paleta no core**

```js
const CORES_MEDICO = [
  { bg: '#bfdbfe', text: '#1e40af' }, { bg: '#c7d2fe', text: '#3730a3' }, { bg: '#e9d5ff', text: '#6b21a8' },
  { bg: '#fbcfe8', text: '#9d174d' }, { bg: '#cffafe', text: '#155e75' }, { bg: '#ccfbf1', text: '#115e59' },
];
```

`corDoMedico(nome)`: o mesmo cálculo de `getDoctorColorClasses` (soma dos códigos dos caracteres com deslocamento, módulo o tamanho da paleta); nome vazio devolve o par cinza do teste. No `index.html`, `getDoctorColorClasses` passa a montar o `style` a partir de `PainelCore.corDoMedico(name)`, e `doctorColorPairs` sai.

- [ ] **Step 4: Trocar `showConfirm` para tom**

A assinatura do teste. Mapa do tom para a classe do botão de confirmar: `perigo` → `btn btn-solid-danger`, `primaria` → `btn btn-primary`, `neutro` → `btn btn-solid-neutral`.

Chamadas, pelo texto do botão:

| Botão | Hoje | Tom |
|---|---|---|
| Confirmar (padrão), Deletar, Remover, "Entendi" de erro | `bg-red-600` | `perigo` |
| Resetar e receber | `bg-amber-500` | `perigo` |
| Importar (substitui todos os dados) | `bg-green-600` | `perigo` |
| Dar Alta, Baixar cópia, "Entendi" de aviso, Guardar | `bg-amber-600`, `bg-indigo-600` | `primaria` |
| Arquivar, Sair | `bg-slate-600` | `neutro` |

Só o quarto argumento muda. Mensagem, título e texto do botão ficam como estão.

- [ ] **Step 5: Migrar as cores**

Guia de troca, aplicado ao arquivo inteiro (marcação e strings do script):

| De | Para |
|---|---|
| botão cheio (`bg-sky-600 text-white … hover:bg-sky-700`) | `btn btn-primary` (`btn-sm` nos "Copiar" pequenos) |
| botão de contorno (`bg-white border border-slate-300 text-slate-700 …`) | `btn btn-ghost` |
| botão vermelho claro (`bg-red-100 text-red-800 …`) | `btn btn-danger` |
| cartão e seção (`bg-white rounded-xl shadow-lg border border-slate-200/50`) | `card` |
| `text-sky-600` e `text-sky-500`, inclusive em `hover:` | `text-sky-700` |
| `text-slate-400` e `text-slate-300`, em texto e em ícone | `text-slate-500` |
| `ring-sky-500` (anel de foco dos campos) | `ring-sky-600` |
| botões índigo de Arquivados ("Nuvem", "Trazer de volta") | `btn btn-ghost` |
| verde de "Restaurar", azul de "Reinternar" em Arquivados | `btn btn-ghost` |
| ✓ branco sobre `bg-green-500` (o que sobrar) | fundo `--c-success-mark` |
| setas ▲▼ da tabela de labs | `text-slate-500` |

Os modais continuam com `shadow-2xl`: é a única sombra forte que fica. O valor baixo de lab continua azul (agora `text-sky-700`) e o alto, vermelho: é a exceção documentada no spec.

- [ ] **Step 6: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 7: Regenerar o CSS e comparar com o fim da Fase 3**

Run, em 360 e em 1280:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs lista --largura=<L> --cheia
node tools/captura/capturar.cjs arquivados --largura=<L>
node tools/captura/capturar.cjs paciente:0:aberto --largura=<L> --cheia
node tools/captura/capturar.cjs paciente:6:secao=evolucao --largura=<L> --cheia
node tools/captura/capturar.cjs modal:controle --largura=<L>
node tools/captura/capturar.cjs tarefas --largura=<L>
```
Expected: mesma disposição das capturas da entrega da Fase 3; mudam só cores e sombras. Nenhum botão ficou sem fundo, sem borda ou com o texto invisível. No leito 6, os botões "Copiar" dos campos vazios aparecem esmaecidos e os dos campos com texto, cheios (item 2 do Review Focus). O chip da "Dra. Exemplo Externa" não é vermelho, laranja nem verde.

- [ ] **Step 8: Commit**

```bash
git add painel-core.js index.html styles.css tests/tela.test.cjs
git commit -m "refactor(ui): cada cor com um significado só; app inteiro nas classes de componente"
```

---

### Task 2: Acessibilidade (spec 4.3)

**Files:**
- Modify: `index.html` (botões só de ícone, modais, `showModal`/`hideModal`, listas, `dragHandleHtml`, CSS, rodapés)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: `closeAllModals()` e `openSheetId` (Fase 2).
- Produces: `showModal(id)` guarda quem tinha o foco e foca o primeiro campo ou botão do modal; `hideModal(id)` devolve o foco.

- [ ] **Step 1: Escrever as asserções**

```js
test('index.html: todo botão com title tem aria-label', () => {
  const sem = [...html.matchAll(/<button(?![^>]*aria-label=)[^>]*\btitle="([^"]*)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(sem, []);
});

test('index.html: os seis modais são diálogos de verdade', () => {
  const modais = [...html.matchAll(/<div id="(\w+Modal)" class="hidden[^"]*"([^>]*)>/g)];
  assert.deepStrictEqual(modais.map((m) => m[1]).sort(), ['addBedModal', 'confirmModal', 'imageExamModal', 'readmitModal', 'reminderModal', 'trackerModal']);
  modais.forEach((m) => assert.ok(/role="dialog"/.test(m[2]) && /aria-modal="true"/.test(m[2]) && /aria-label(ledby)?="/.test(m[2]), m[1]));
});

test('index.html: botão escondido até o hover não depende da largura da tela; estado não usa opacidade', () => {
  assert.strictEqual(html.split('sm:opacity-0').length - 1, 0);
  assert.ok(!/\? 'opacity-60'/.test(html));
});

test('index.html: alvos de toque das listas e alça de arrasto', () => {
  ['remove-problem', 'remove-hpp', 'remove-conduta', 'remove-rawtext', 'edit-image-btn', 'remove-image-btn']
    .forEach((c) => assert.ok(juntas(c, 'min-w-[44px]') && juntas(c, 'min-h-[44px]'), c));
  assert.ok(juntas('drag-handle', 'w-8') && juntas('drag-handle', 'self-stretch'));
});

test('index.html: foco visível, movimento reduzido, área segura e impressão', () => {
  assert.ok(/button:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--c-primary\)/.test(html));
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(html));
  assert.ok((html.match(/env\(safe-area-inset-bottom\)/g) || []).length >= 2);
  ['id="listHeader"', 'id="sectionNav"', 'id="appNotice"', 'id="listMenuSheet"', 'id="patientMenuSheet"'].forEach((id) => {
    const i = html.indexOf(id);
    const tag = html.slice(html.lastIndexOf('<', i), html.indexOf('>', i));
    assert.ok(tag.includes('print:hidden'), id);
  });
  assert.strictEqual((html.match(/<footer class="[^"]*print:hidden/g) || []).length, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="aria-label|diálogos de verdade|não depende da largura|alvos de toque das listas|foco visível"`
Expected: 5 falhas.

- [ ] **Step 3: Implementar**

Rótulos: cada `<button>` que hoje só tem `title` ganha um `aria-label` com o mesmo texto.

Modais: os seis contêineres ganham, **depois do `class`** (o teste lê os atributos nessa posição), `role="dialog"`, `aria-modal="true"` e `aria-labelledby` apontando para o `id` do seu `<h3>` (crie o `id` onde não existe). O `trackerModal` tem dois títulos, um por passo: use `aria-label="Controle"`.
- `showModal(id)` guarda `document.activeElement` e foca o primeiro `input`, `select`, `textarea` ou `button` visível do modal;
- `hideModal(id)` devolve o foco ao elemento guardado, se ele ainda está na página;
- Tab e Shift+Tab dentro de um modal aberto dão a volta no próprio modal (um listener de `keydown` no contêiner);
- Esc: se há folha aberta, `closeSheet()`; senão, se há modal aberto, `closeAllModals()`.

Listas:
- `sm:opacity-0` sai das sete ocorrências e entra o padrão da Fase 1: `opacity-60 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100`;
- os seis botões do teste ganham `min-w-[44px] min-h-[44px]` e centralizam o ícone;
- `dragHandleHtml`: a alça passa a `w-8 self-stretch flex items-center justify-center`, ocupando a altura da linha.

Cartões da lista: `.list-card` que abre o paciente ganha `tabindex="0"`, `role="button"` e abre também com Enter. O cartão de leito vazio já é um `<button>`.

CSS:

```css
button:focus-visible, summary:focus-visible, [tabindex="0"]:focus-visible { outline: 2px solid var(--c-primary); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
```

As chamadas de `scrollIntoView` e `scrollTo` com `behavior: 'smooth'` passam a usar um ajudante que devolve `'auto'` quando `matchMedia('(prefers-reduced-motion: reduce)')` casa.

Área segura: os dois rodapés fixos (paciente e tarefas) ganham `padding-bottom: calc(0.75rem + env(safe-area-inset-bottom))`. A folha de ações já tem.

Impressão: `print:hidden` nos cinco elementos do teste e nos dois rodapés.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir o teclado**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0:aberto --largura=360 --cheia
node tools/captura/capturar.cjs paciente:0:aberto --largura=1280 --cheia
```
Expected: em 360 px, os ✕ das listas visíveis e a alça com a altura da linha. Em 1280 px, os ✕ escondidos (a captura não tem ponteiro em cima).

No navegador do computador, só com o teclado (item 3 do Review Focus):
1. Tab percorre a lista; Enter num cartão abre o paciente; o anel de foco aparece em cada parada;
2. abrir "+ Controle": o foco entra no modal; Tab dá a volta dentro dele; Esc fecha e o foco volta ao botão do rodapé;
3. abrir o ⋯: as setas e o Tab ficam na folha; Esc fecha;
4. nas listas, Tab alcança o ✕ de cada item e ele aparece ao receber o foco.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css tests/tela.test.cjs
git commit -m "feat(a11y): rótulos, modais como diálogos, foco visível e alvos de toque nas listas"
```

---

### Task 3: Tela larga (spec 4.5)

**Files:**
- Modify: `index.html` (contêineres de `#screen-details`)
- Test: `tests/tela.test.cjs`

- [ ] **Step 1: Escrever a asserção**

```js
test('index.html: tela do paciente com largura de leitura no computador', () => {
  const tela = html.slice(html.indexOf('id="screen-details"'), html.indexOf('id="screen-tasks"'));
  assert.ok(!tela.includes('max-w-7xl'));
  assert.strictEqual((tela.match(/\bmax-w-3xl\b/g) || []).length, 4, 'cabeçalho, barra de atalhos, conteúdo e rodapé');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="largura de leitura"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Em `#screen-details`, os contêineres internos do cabeçalho, de `#sectionNav`, de `#patientDetailContent` e do rodapé trocam `max-w-7xl` por `max-w-3xl` (768 px), centrados com `mx-auto`. A lista e as tarefas ficam como estão.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0:copiado --largura=1280 --cheia
node tools/captura/capturar.cjs paciente:0:menu --largura=1280
node tools/captura/capturar.cjs paciente:0:aberto --largura=390 --cheia
```
Expected: em 1280 px, cabeçalho, barra, conteúdo e rodapé alinhados numa coluna central de 768 px; os campos da Evolução Tasy com linhas de leitura confortável e o "Copiar" de cada campo à direita do rótulo; o menu ⋯ centrado. Em 390 px, nada muda.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css tests/tela.test.cjs
git commit -m "feat(paciente): largura de leitura na tela larga"
```

---

### Task 4: Modo escuro (spec 4.4, opcional)

**Só execute esta task se o usuário pedir.** Pergunte antes de começar. Sem o pedido, vá para a Task 5: nada das outras tasks depende desta.

**Files:**
- Modify: `index.html` (tokens, bloco de remapeamento, preferência de tema, item no menu ⋯, `<meta name="theme-color">`)
- Modify: `tools/captura/abre-tela.js`
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `prefs.theme` em `wardBookPrefs_v1`, com `'auto'|'claro'|'escuro'` (padrão `'auto'`); `aplicarTema()`; atributo `data-theme` na raiz (`light`, `dark` ou ausente).
- Produces: token novo `--c-on-strong` (texto sobre fundo forte): `#ffffff` no claro, `#0f172a` no escuro. `.btn-primary`, `.btn-solid-danger` e os checks marcados passam a usá-lo.

- [ ] **Step 1: Escrever os testes**

```js
test('tema escuro: tokens com contraste', () => {
  const bloco = (html.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/) || [])[1] || '';
  const t = (nome) => (bloco.match(new RegExp('--c-' + nome + ':\\s*(#[0-9a-f]{6})\\s*;')) || [])[1];
  ['text', 'text-muted', 'primary', 'success', 'warn', 'danger'].forEach((n) => {
    assert.ok(contraste(t(n), t('surface')) >= 4.5, n + ' sobre surface');
    assert.ok(contraste(t(n), t('surface-2')) >= 4.5, n + ' sobre surface-2');
  });
  ['primary', 'success', 'warn', 'danger', 'neutral'].forEach((p) =>
    assert.ok(contraste(t(p + '-on-bg'), t(p + '-bg')) >= 4.5, p + ' no selo'));
  assert.ok(contraste(t('on-strong'), t('primary')) >= 4.5 && contraste(t('on-strong'), t('danger')) >= 4.5);
});

test('tema escuro: nenhuma cor neutra do Tailwind fora do bloco de remapeamento', () => {
  assert.ok(html.includes('/* remapeamento de neutros para os tokens */'));
  assert.ok(/prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/.test(html));
  assert.ok(html.includes("theme: 'auto'") || html.includes('prefs.theme'));
  assert.ok(html.includes('id="themeBtn"') && html.includes('function aplicarTema('));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="tema escuro"`
Expected: 2 falhas.

- [ ] **Step 3: Implementar**

Tokens do tema escuro (todos conferidos: texto a 4,5:1 ou mais sobre as duas superfícies):

| Token | Escuro | Token | Escuro |
|---|---|---|---|
| `--c-surface` | `#0f172a` | `--c-surface-2` | `#1e293b` |
| `--c-border` | `#334155` | `--c-text` | `#e2e8f0` |
| `--c-text-muted` | `#94a3b8` | `--c-on-strong` | `#0f172a` |
| `--c-primary` | `#38bdf8` | `--c-success` | `#4ade80` |
| `--c-warn` | `#fbbf24` | `--c-danger` | `#f87171` |
| `--c-primary-bg` / `-on-bg` | `#0c4a6e` / `#bae6fd` | `--c-success-bg` / `-on-bg` | `#14532d` / `#bbf7d0` |
| `--c-warn-bg` / `-on-bg` | `#78350f` / `#fde68a` | `--c-danger-bg` / `-on-bg` | `#7f1d1d` / `#fecaca` |
| `--c-neutral-bg` / `-on-bg` | `#334155` / `#e2e8f0` | os quatro `-mark` | iguais ao tom forte do papel |

O mesmo bloco de valores aparece duas vezes: sob `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` e sob `:root[data-theme="dark"] { … }`. Nos dois, `color-scheme: dark`, para os campos de data e os seletores nativos acompanharem.

Remapeamento, num bloco só, aberto pelo comentário `/* remapeamento de neutros para os tokens */`: cada utilitário neutro que ainda existe no arquivo aponta para um token. Por exemplo `.bg-white { background-color: var(--c-surface); }`, `.bg-slate-50 { background-color: var(--c-surface-2); }`, `.text-slate-800, .text-slate-900 { color: var(--c-text); }`, `.text-slate-500, .text-slate-600, .text-slate-700 { color: var(--c-text-muted); }`, `.border-slate-200, .border-slate-300 { border-color: var(--c-border); }`, e as variantes `hover:` em uso. Levante a lista com uma busca por `(bg|text|border)-slate-\d+` e por `bg-white` no `index.html`. O `body` passa a usar `--c-surface-2` e `--c-text`.

Preferência: `savePrefs` passa a gravar também `theme`. `aplicarTema()` escreve `data-theme` na raiz (`auto` remove o atributo) e troca o `content` de `<meta name="theme-color">` (`#0284c7` no claro, `#0f172a` no escuro). É chamada na carga, antes do primeiro desenho.

No menu ⋯ da lista, antes de "Sair": `<button type="button" id="themeBtn" class="sheet-item">`, com o texto "Tema: Automático", "Tema: Claro" ou "Tema: Escuro", que avança para o próximo valor a cada toque.

Em `tools/captura/abre-tela.js`, sufixo `:escuro` em qualquer tela: define `data-theme="dark"` na raiz antes de abrir.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir os dois temas**

Run, em 360 px:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs lista:escuro --cheia
node tools/captura/capturar.cjs paciente:0:aberto:escuro --cheia
node tools/captura/capturar.cjs modal:controle:escuro
node tools/captura/capturar.cjs menu:escuro
node tools/captura/capturar.cjs lista --cheia
```
Expected: no escuro, nenhum bloco branco sobrando e nenhum texto escuro sobre fundo escuro. Confira um a um: a faixa de alergia, os valores de lab alto e baixo, os selos de gravidade, o chip do médico (cor por `style`, fora dos tokens: precisa continuar legível), os checks marcados e vazios, os campos de data. A captura do tema claro fica igual à da Task 3.

Se sobrar área fora do tema e a correção não couber no bloco de remapeamento, pare e avise o usuário: o spec prevê que o modo escuro saia da fase sem afetar o resto.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css tools/captura/abre-tela.js tests/tela.test.cjs
git commit -m "feat(ui): modo escuro, com escolha Automático / Claro / Escuro"
```

---

### Task 5: Entrega da Fase 4

**Files:**
- Modify: `sw.js`, `index.html` (`APP_VERSION`, linha de versão), `CLAUDE.md`

- [ ] **Step 1: Subir a versão e tirar a largura do rodapé do menu**

`sw.js`: `'caderno-v13'`. `index.html`: `const APP_VERSION = '13';`. A linha de versão do menu ⋯ volta a ser só `Caderno de Visitas · versão ${APP_VERSION}`: a largura em pixels serviu para a revisão.

- [ ] **Step 2: Registrar as convenções no CLAUDE.md**

As fases 1 a 3 já registraram as suas. Na seção "Desenvolvimento", acrescente, no estilo das linhas que já estão lá:
- cores: cada papel (primária, sucesso, atenção, perigo, neutra) tem um significado só; não reintroduzir cor solta do Tailwind (`tests/tela.test.cjs` proíbe as que reprovam no contraste);
- `showConfirm` recebe um tom (`'perigo'`, `'primaria'`, `'neutro'`), não uma classe;
- modal novo: `role="dialog"`, `aria-modal`, rótulo, e abre e fecha por `showModal`/`hideModal`, que cuidam do foco.

Confira que as linhas das fases 1 a 3 estão lá e que a lista das regras de tela que moram no core inclui `corDoMedico`.

- [ ] **Step 3: Suíte inteira**

Run: `node --test`
Expected: 0 falhas.

- [ ] **Step 4: Capturas finais de todas as telas**

Run, para cada largura em 360, 390 e 1280:
```bash
node tools/captura/capturar.cjs lista --largura=<L> --cheia
node tools/captura/capturar.cjs arquivados --largura=<L>
node tools/captura/capturar.cjs menu --largura=<L>
node tools/captura/capturar.cjs tarefas --largura=<L>
node tools/captura/capturar.cjs paciente:0:aberto --largura=<L> --cheia
node tools/captura/capturar.cjs paciente:0 --largura=<L> --cheia
node tools/captura/capturar.cjs paciente:0:menu --largura=<L>
node tools/captura/capturar.cjs paciente:4 --largura=<L>
node tools/captura/capturar.cjs paciente:7 --largura=<L>
node tools/captura/capturar.cjs modal:controle --largura=<L>
node tools/captura/capturar.cjs aviso --largura=<L>
```
Expected: nada cortado, sobreposto ou fora da tela, em nenhuma das 33 imagens. Se a Task 4 foi feita, repita as de 360 px com `:escuro`.

- [ ] **Step 5: Checklist de regressão inteiro**

Abra `index.html` no navegador e percorra o checklist completo do spec: Lista, Arquivados, Paciente, Tarefas e Modais, item por item. É a última passada: cada item listado ali precisa ser exercitado, não só visto.

- [ ] **Step 6: Commit**

```bash
git add sw.js index.html CLAUDE.md
git commit -m "chore(sw): cache v13 (fase 4 da revisão de UI) e convenções no CLAUDE.md"
```

- [ ] **Step 7: Entregar ao usuário**

Peça a conferência final no Galaxy A54 (uma visita de verdade, do primeiro ao último leito) e no computador (copiar uma evolução inteira para o Tasy, usando só o teclado para trocar de campo). Mescla e push só quando ele pedir.
