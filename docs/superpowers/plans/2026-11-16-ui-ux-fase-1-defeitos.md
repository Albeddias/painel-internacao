# Revisão de UI/UX, Fase 1: defeitos concretos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir oito defeitos visuais e de toque do app no celular e montar a rede de segurança (teste de referências do HTML e gerador de capturas) que as fases 2 a 4 vão usar.

**Architecture:** Regra de tela nova vai para `painel-core.js` como função pura, com teste em `node --test`. O `index.html` só desenha. Mudança de marcação sem regra testável é presa por asserções de texto sobre o `index.html` (padrão que `tests/tela.test.cjs` já usa) e conferida numa captura do Edge headless.

**Tech Stack:** HTML + JS clássico (UMD, sem build, funciona em `file://`), Tailwind pré-compilado (`styles.css`), `node --test`, Edge headless para capturas.

**Spec:** `docs/superpowers/specs/2026-11-16-redesign-ui-ux-design.md` (seções "Restrições", "Fase 1" e "Verificação visual"). Este é o plano 1 de 4; os outros são `2026-11-16-ui-ux-fase-2-lista.md`, `-fase-3-paciente.md` e `-fase-4-sistema-visual.md`.

## Global Constraints

- Funcionar 100% offline em `file://`: sem ES modules e sem dependências de build.
- Nada muda em `runSync`, `buildPushDiff`, migrations, `painel_sync_*`, `[NOME]` ou iniciais. Os flags `is*Minimized` continuam com os mesmos nomes.
- Regra de tela testável mora em `painel-core.js` e entra no objeto exportado no fim do arquivo. Função que depende de data recebe `hojeISO` (`'AAAA-MM-DD'`); nada de `new Date()` sem argumento dentro do core.
- Testes: `node --test`, da raiz, sem argumento de caminho. Para rodar um só: `node --test --test-name-pattern="<trecho do nome>"`. Suíte antes desta fase: 345 testes, 0 falhas.
- Elemento que muda de lugar leva o `id` e o listener junto.
- Componente novo: `<button type="button">`, `aria-label` quando só tem ícone, alvo de toque de 44 px.
- Ação destrutiva que hoje passa por `showConfirm` continua passando, com o mesmo texto.
- Classe Tailwind nova em `index.html`: regenerar com `npx tailwindcss@3 -o styles.css --content ./index.html --minify` e commitar o `styles.css` junto.
- Larguras de conferência: 360, 390 e 1280 px.
- Dados de teste e de captura são sempre fictícios ("Paciente Exemplo Um"). Nunca um nome real.
- Branch `ui-fase-1`, criada no próprio diretório (sem worktree). Commits em português, `tipo(escopo): descrição`, terminando com `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. A mescla em `master` e o push só acontecem depois que o usuário conferir no aparelho e pedir.

## Review Focus

1. Exame com uma coleta só, ou sem número em nenhuma coleta: `tendenciasLab` devolve só `''` e a tabela desenha normalmente. Teste na Task 5.
2. Coleta em edição com a data trocada no formulário: "Apagar coleta" apaga a coleta da data **original** e a confirmação cita essa data. Asserção e conferência na Task 9.
3. Estado salvo antes desta fase, sem `isHppMinimized`: o HPP abre. Flag `true` salvo: continua fechado depois de `migrateState`. Teste na Task 10.
4. Tarefa sem texto: a confirmação diz `Remover "esta tarefa"?`, não `Remover ""?`. Asserção na Task 6.
5. `id` montado em tempo de execução (`common-ext-docs-list-${idx}`): o teste de referências só olha literais e não pode acusar erro falso. Prova na Task 1.

## Mapa de arquivos

| Arquivo | Responsabilidade nesta fase |
|---|---|
| `tests/html-refs.test.cjs` | Novo. Todo `id` e classe que o script procura existe no HTML. |
| `tools/captura/estado-ficticio.js` | Novo. Estado fictício único, usado nas capturas e nos testes. |
| `tools/captura/abre-tela.js` | Novo. Abre a tela pedida pelo `#hash` dentro da página capturada. |
| `tools/captura/capturar.cjs` | Novo. Monta a página numa pasta temporária e chama o Edge headless. |
| `tests/captura.test.cjs` | Novo. O estado fictício é válido e só tem nomes fictícios. |
| `painel-core.js` | `DAILY_CHECKS`, `tendenciasLab`, `isHppMinimized` em `migrateBed`. |
| `tests/tela.test.cjs` | Testes das funções novas e asserções de texto sobre o `index.html`. |
| `tests/migrate.test.cjs` | Teste do `isHppMinimized`. |
| `index.html` | CSS dos campos, checks, tabela de labs, tarefas, seletor Ativos/Arquivados, rodapé. |
| `styles.css` | Regenerado. |
| `sw.js` | Cache `caderno-v10`. |
| `.gitignore` | `tools/captura/saida/`. |

---

### Task 1: Teste de referências do HTML (spec 1.0)

**Files:**
- Create: `tests/html-refs.test.cjs`

**Interfaces:**
- Produces: a guarda que toda task seguinte roda. Se um elemento sair do HTML e o script ainda o procurar, `node --test` falha citando o `id` ou a classe.

- [ ] **Step 1: Criar a branch**

```bash
git checkout -b ui-fase-1
```

- [ ] **Step 2: Escrever o teste**

O algoritmo abaixo foi rodado contra o `index.html` atual: 109 ids e 102 classes referenciados, nenhum faltando.

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// O script liga eventos com getElementById(...).addEventListener e, na tela do paciente,
// com querySelector('.classe'). Se o elemento sai do HTML e a linha fica, o script para
// ali: o app abre em branco. Este teste lê o arquivo como texto e confere as duas pontas.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.slice(html.lastIndexOf('<script>'));

const SELECTOR_CALL = /(?:querySelector(?:All)?|closest|matches|setupCollapsibleSection\(\s*\w+\s*,|enableListDrag\(\s*\w+\s*,)\s*\(?\s*(['"`])((?:(?!\1).)*)\1/g;
const selectors = [...script.matchAll(SELECTOR_CALL)].map((m) => m[2]);

test('todo id procurado pelo script existe no HTML', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"${}]+)"/g)].map((m) => m[1]));
  const refs = new Set([...script.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]));
  selectors.forEach((s) => { for (const m of s.matchAll(/#([A-Za-z][\w-]*)/g)) refs.add(m[1]); });
  assert.ok(refs.size > 50, 'a extração de ids parou de funcionar');
  assert.deepStrictEqual([...refs].filter((id) => !ids.has(id)), []);
});

test('toda classe procurada pelo script existe em algum class="…"', () => {
  const classes = new Set();
  for (const m of html.matchAll(/class(?:Name)?\s*=\s*(["'`])((?:(?!\1)[\s\S])*)\1/g)) {
    m[2].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
  }
  for (const m of script.matchAll(/classList\.(?:add|toggle|remove)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/['"]([^'"]+)['"]/g)) classes.add(s[1]);
  }
  const refs = new Set();
  selectors.forEach((s) => {
    const limpo = s.replace(/\$\{[^}]*\}/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    for (const m of limpo.matchAll(/\.([A-Za-z][\w-]*)/g)) refs.add(m[1]);
  });
  assert.ok(refs.size > 50, 'a extração de classes parou de funcionar');
  assert.deepStrictEqual([...refs].filter((c) => !classes.has(c)), []);
});
```

- [ ] **Step 3: Rodar e ver passar**

Run: `node --test --test-name-pattern="procurad"`
Expected: 2 testes, 0 falhas. Se falhar no código atual, o defeito é da expressão regular, não do app: corrija a expressão.

- [ ] **Step 4: Provar que o teste morde**

No `index.html`, troque `id="syncBtn"` por `id="syncBtnX"` e rode o mesmo comando.
Expected: FAIL, com `[ 'syncBtn' ]` na diferença. Desfaça a troca e rode de novo: PASS.

Depois troque `class="inline-bed ` por `class="inline-bedX ` no template do paciente e rode.
Expected: FAIL, com `[ 'inline-bed' ]`. Desfaça: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/html-refs.test.cjs
git commit -m "test(tela): todo id e classe que o script procura existe no HTML"
```

---

### Task 2: Gerador de capturas (spec "Verificação visual")

**Files:**
- Create: `tools/captura/estado-ficticio.js`, `tools/captura/abre-tela.js`, `tools/captura/capturar.cjs`
- Create: `tests/captura.test.cjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `node tools/captura/capturar.cjs <tela> [--largura=390] [--altura=667] [--cheia]`, que grava `tools/captura/saida/<tela>-<largura>.png` (com `:` trocado por `-` no nome) e imprime o caminho. `--cheia` usa altura de 3200 px.
- Produces: `estadoFicticio(hojeISO)`, que devolve um estado no formato de `localStorage['wardBookData_v16']`. Em Node: `require('../tools/captura/estado-ficticio.js')`.
- Produces: telas (o `<tela>` do comando, que vira o `#hash`):

  | Tela | O que abre |
  |---|---|
  | `lista` | lista de leitos |
  | `arquivados` | lista com Arquivados ligado |
  | `tarefas` | Tela C |
  | `paciente:N` | paciente do leito de índice N, seções como estão no estado |
  | `paciente:N:aberto` | o mesmo, com todos os flags `is*Minimized` em `false` |
  | `modal:controle` | paciente 0 com o modal de controle aberto |

  Qualquer tela aceita o sufixo `:medir`, que desenha no canto inferior esquerdo uma etiqueta com a altura do cabeçalho fixo da tela ativa e `window.innerWidth`. As fases seguintes acrescentam telas a esta tabela.

- [ ] **Step 1: Escrever o teste do estado fictício**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="estado fictício"`
Expected: FAIL com `Cannot find module '../tools/captura/estado-ficticio.js'`.

- [ ] **Step 3: Escrever `tools/captura/estado-ficticio.js`**

Script clássico que exporta `estadoFicticio(hojeISO)` nos dois ambientes (`module.exports` no Node, `self.estadoFicticio` no navegador), como o `painel-core.js` faz. Todas as datas são calculadas a partir de `hojeISO`. A ordem dos leitos é fixa, porque as fases seguintes citam os índices:

| Índice | Leito | Conteúdo |
|---|---|---|
| 0 | `1012-A` | "Paciente Exemplo Um", 78 anos, admissão hoje−9, `personId: 'pessoa-1'`. Alergia "Dipirona (edema de glote)", medicações prévias em 3 linhas, HPP "HAS, DM2, DRC G3b", anamnese de 3 linhas. Problemas: 2 ativos com plano (um com descrição de 60+ caracteres) e 1 crônico. Controles: ATB "Piperacilina-tazobactam" D1 hoje−7, 7 dias; cultura "Hemocultura" coletada hoje−3, "Aguardando"; dispositivo "CVC Subclávia D" desde hoje−8; um ATB suspenso; um dispositivo removido; um procedimento. Labs: coletas em hoje−5, hoje−1 e hoje (20 exames na de hoje, com Hb, Cr e K fora da faixa; a Hb sobe a cada coleta: 9,1, 9,5 e 10,1). Um exame de imagem. 3 condutas (1 feita). Anotações = modelo + duas linhas. Evoluções de hoje e de hoje−1, com `[NOME]` em `evolucao_atual`. 2 textos do prontuário. Um sumário de alta em blocos (`=== … ===`, com o bloco PARA CONFERIR). Alta prevista hoje−1, lembrete hoje, visitado, só o check `ev` marcado. |
| 1 | `1013-B` | "Paciente Exemplo Dois", visitado, quatro checks e Queda marcados, alta prevista hoje+5, 1 problema. |
| 2 | `1014-B` | "Paciente Exemplo Três", médico externo "Dra. Exemplo Externa". |
| 3 | `UTI-12-B` | "Paciente Exemplo Quatro de Nome Bastante Comprido da Silva", admissão hoje−2, sem pendência, não visitado. |
| 4 | `1021` | vazio (sem `patientId`). |
| 5 | `1030-C` | "Paciente Exemplo Cinco", alta prevista hoje. |
| 6 | `1031-A` | `patientName: 'PES'`, `initialsPlaceholder: 'PES'`; uma evolução de hoje com `[NOME]`. |
| 7 | `1012-A` | arquivado, `archiveReason: 'alta'`, alta em hoje−30, `personId: 'pessoa-1'`, 1 problema ativo, 2 coletas de lab antigas (hoje−35 e hoje−32). |
| 8 | `1040` | arquivado, `archiveReason: 'arquivado'`, "Paciente Exemplo Seis". |

Fora dos leitos: `cloudArchived` com um registro (`nome: 'Paciente Exemplo Sete'`, `iniciais: 'PES'`, `leito: '1050'`), `generalTasks` com 2 abertas e 1 feita, `lastSyncAt` = hoje às 09:22 (hora local) e `lastModifiedAt` um minuto antes, `lastReset: hojeISO`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test --test-name-pattern="estado fictício"`
Expected: 2 testes, 0 falhas.

- [ ] **Step 5: Escrever `tools/captura/abre-tela.js`**

Script clássico que roda no fim da página. Lê `location.hash`, separa por `:` e executa a tela da tabela de Interfaces. `state` e as funções do app (`openPatientDetails`, `openTrackerModal`, `showScreen`) são globais do script da página. Para `arquivados`, clique em `#viewArchiveBtn`; para `tarefas`, em `#openTasksBtn`. Para `:aberto`, ponha em `false` todo flag de `state.beds[N]` cujo nome case com `/^is\w+Minimized$/` antes de abrir. Para `:medir`, acrescente ao `body` um `div` fixo, de fundo amarelo, com o texto `cab <altura>px · <innerWidth>w`, onde a altura é o `offsetHeight` do `header` dentro de `.screen.active`.

- [ ] **Step 6: Escrever `tools/captura/capturar.cjs`**

A receita abaixo foi validada nesta máquina (Edge em `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`). Os pontos que não podem mudar: a injeção **antes** do `painel-core.js`, o `iframe` (o Edge headless não abre janela mais estreita que uns 500 px) e o `--virtual-time-budget`, que deixa rodar os `setTimeout` do app antes da foto.

```js
// uso: node tools/captura/capturar.cjs <tela> [--largura=390] [--altura=667] [--cheia]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const raiz = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const tela = args.find((a) => !a.startsWith('--')) || 'lista';
const opt = (nome, padrao) => { const a = args.find((x) => x.startsWith('--' + nome + '=')); return a ? a.split('=')[1] : padrao; };
const largura = Number(opt('largura', 390));
const altura = Number(opt('altura', args.includes('--cheia') ? 3200 : 667));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-captura-'));
['painel-core.js', 'styles.css', 'icon.svg'].forEach((f) => fs.copyFileSync(path.join(raiz, f), path.join(work, f)));

const ler = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const gravaEstado = ler('estado-ficticio.js') + `
;(function () {
  var d = new Date();
  var hoje = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  localStorage.setItem('wardBookData_v16', JSON.stringify(estadoFicticio(hoje)));
  localStorage.setItem('sb-x-auth-token', 'ficticio-ficticio-ficticio-ficticio');
})();`;

let html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const MARCA = '<script src="painel-core.js"></script>';
if (!html.includes(MARCA)) throw new Error('index.html mudou: não achei ' + MARCA);
html = html.replace(MARCA, '<script>' + gravaEstado + '</script>\n' + MARCA);
html = html.replace('</body>', '<script>' + ler('abre-tela.js') + '</script>\n</body>');
fs.writeFileSync(path.join(work, 'index.html'), html);
fs.writeFileSync(path.join(work, 'wrapper.html'),
  '<!doctype html><body style="margin:0;background:#777"><iframe src="index.html#' + tela +
  '" style="width:' + largura + 'px;height:' + altura + 'px;border:0;display:block"></iframe></body>');

const saida = path.join(__dirname, 'saida');
fs.mkdirSync(saida, { recursive: true });
const png = path.join(saida, tela.replace(/:/g, '-') + '-' + largura + '.png');
const edge = process.env.CAPTURA_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!edge) throw new Error('Edge não encontrado; defina CAPTURA_BROWSER com o caminho do navegador');
execFileSync(edge, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=4000',
  '--user-data-dir=' + path.join(work, 'perfil'), '--window-size=' + Math.max(largura, 600) + ',' + altura,
  '--screenshot=' + png, 'file:///' + path.join(work, 'wrapper.html').replace(/\\/g, '/')],
  { stdio: 'pipe', timeout: 60000 });
console.log(png);
```

- [ ] **Step 7: Ignorar a pasta de saída**

Acrescente a linha `tools/captura/saida/` ao `.gitignore`.

- [ ] **Step 8: Capturar o "antes" e conferir**

Run:
```bash
node tools/captura/capturar.cjs lista:medir
node tools/captura/capturar.cjs paciente:0:aberto --largura=360 --cheia
```
Expected: dois caminhos de PNG impressos. Abra as duas imagens. A lista mostra os sete leitos ativos do estado fictício, o painel de pendências e a etiqueta amarela com a altura do cabeçalho (cerca de 135 px hoje). O paciente em 360 px mostra os defeitos que esta fase corrige: leito do tamanho do texto comum, Idade e Admissão em linhas separadas, "+ Conduta" quebrado em duas linhas e o botão › cortado. Guarde as duas como referência do "antes".

- [ ] **Step 9: Commit**

```bash
git add tools/captura tests/captura.test.cjs .gitignore
git commit -m "chore(captura): gerador de capturas com estado fictício versionado"
```

---

### Task 3: Fonte e altura dos campos inline (spec 1.1)

**Files:**
- Modify: `index.html` (bloco `<style>`; classes de `.inline-age`, `.inline-admit` e `.problem-plan`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: classe CSS `.campo-linha` (campo secundário que parece texto, sem altura mínima). A Fase 3 volta a usá-la.

- [ ] **Step 1: Escrever a asserção que falha**

No fim de `tests/tela.test.cjs` (a constante `html` já existe ali). O ajudante `juntas` é reaproveitado pelas tasks seguintes:

```js
const classAttrs = () => [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(/\s+/));
const juntas = (a, b) => classAttrs().some((t) => t.includes(a) && t.includes(b));

test('index.html: leito e nome mantêm o tamanho no celular; campo-linha sem altura mínima', () => {
  assert.ok(/\.inline-bed\s*\{\s*font-size:\s*1\.5rem\s*!important/.test(html));
  assert.ok(/\.inline-name\s*\{\s*font-size:\s*1\.125rem\s*!important/.test(html));
  assert.ok(/input\.campo-linha\s*\{[^}]*min-height:\s*0/.test(html));
  ['inline-age', 'inline-admit', 'problem-plan'].forEach((c) => assert.ok(juntas(c, 'campo-linha'), c));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="campo-linha"`
Expected: FAIL na primeira asserção.

- [ ] **Step 3: Escrever o CSS e aplicar a classe**

No `<style>` do `index.html`:
- dentro do `@media (max-width: 640px)` existente, **depois** da regra `input, select, textarea`, as duas regras `.inline-bed { font-size: 1.5rem !important; }` e `.inline-name { font-size: 1.125rem !important; }`;
- **depois** da regra `input[type="text"], input[type="date"], input[type="number"], textarea`, a regra `input.campo-linha { min-height: 0; padding-top: 0.25rem; padding-bottom: 0.25rem; }`. O seletor precisa do `input` na frente: `.campo-linha` sozinha perde para `input[type="text"]` por especificidade.

Acrescente `campo-linha` às classes de `.inline-age`, `.inline-admit` (template do paciente) e `.problem-plan` (string em `renderProblemList`).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Conferir na captura**

Run: `node tools/captura/capturar.cjs paciente:0:aberto --cheia`
Expected: "1012-A" maior que o nome; Idade e Admissão na mesma linha; o plano de cada problema colado à descrição.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/tela.test.cjs
git commit -m "fix(ui): leito e nome no tamanho certo no celular; campos secundários sem faixa de 48 px"
```

---

### Task 4: Checks com a sigla inteira (spec 1.2)

**Files:**
- Modify: `painel-core.js` (constante nova + export)
- Modify: `index.html` (`quedaDotHtml`, `checkDotsHtml`, as duas áreas `.checks` dos templates)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `PainelCore.DAILY_CHECKS`, lista de `{ key, label, nome }`.
- Produces: cada check é `<button type="button" class="dot …" data-check-key="…" aria-pressed="…" aria-label="…">`; a Queda é `<button type="button" class="queda-dot …" aria-pressed="…" aria-label="…">`. As classes `dot` e `queda-dot` continuam: os listeners de hoje dependem delas.

- [ ] **Step 1: Escrever os testes**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="DAILY_CHECKS"`
Expected: FAIL, `PainelCore.DAILY_CHECKS` é `undefined`.

- [ ] **Step 3: Implementar**

`painel-core.js`: a constante `DAILY_CHECKS` com os quatro itens do teste, exportada.

`index.html`, `checkDotsHtml(bed)`: percorre `PainelCore.DAILY_CHECKS`. Valores fixados pelo spec:
- caixa `w-10 h-10` (40 px), `rounded-md border-2`, conteúdo em coluna (`flex flex-col items-center justify-center`);
- desmarcado: a sigla em `text-xs font-bold`, cores `bg-slate-100 border-slate-200 text-slate-600`;
- marcado: `checkIconSvg('w-3.5 h-3.5')` e, embaixo, a sigla em `text-[10px] leading-none font-bold`; cores `bg-sky-700 border-sky-700 text-white`;
- `aria-pressed` com `true`/`false`, `aria-label` com o `nome`.

`quedaDotHtml(bed)`: mesmo formato. Pendente: "Q", `bg-amber-50 border-amber-400 text-amber-700`, `aria-label="Queda: termo de ciência pendente"`. Feito: ✓ com "Q" embaixo, `bg-green-700 border-green-700 text-white`, `aria-label="Queda: termo de ciência aplicado nesta internação"`. Sai o `ml-1.5`.

Nas duas áreas `.checks` (templates da lista e do paciente), `gap-1.5` vira `gap-1`: caixa de 40 + respiro de 4 = passo de 44 px, cinco checks em 216 px.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs lista --largura=360
node tools/captura/capturar.cjs paciente:0
```
Expected: cada cartão mostra EV, P, EX, TEV e Q numa linha só em 360 px; no leito 0, o EV aparece azul-escuro com ✓ e "EV" embaixo; no leito 1, os cinco marcados.

- [ ] **Step 6: Commit**

```bash
git add painel-core.js index.html styles.css tests/tela.test.cjs
git commit -m "fix(ui): checks mostram a sigla inteira e viram botões de 44 px de alvo"
```

---

### Task 5: Coletas de lab da mais recente para a mais antiga (spec 1.3)

**Files:**
- Modify: `painel-core.js` (função nova + export)
- Modify: `index.html` (`renderLabFlowsheet`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `PainelCore.tendenciasLab(nums: Array<number|null>): string[]`. Entrada em ordem cronológica; saída com um item por coleta: `''`, `'▲'` ou `'▼'`.

- [ ] **Step 1: Escrever os testes**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="tendenciasLab|tabela de labs"`
Expected: FAIL, `PainelCore.tendenciasLab is not a function`.

- [ ] **Step 3: Implementar**

`painel-core.js`: `tendenciasLab(nums)`, ao lado de `buildLabsLine`, exportada.

`index.html`, `renderLabFlowsheet`: `filteredDates` continua crescente, e `rawValues`, `nums` e `sparklineSvg(nums)` continuam sendo calculados sobre ela. Logo depois dos filtros, `const columnDates = filteredDates.slice().reverse();`. O cabeçalho e as células percorrem `columnDates`; a célula da coluna `ci` usa o índice cronológico `filteredDates.length - 1 - ci` para pegar o valor e a seta de `PainelCore.tendenciasLab(nums)`. As cores das setas ficam como estão.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Conferir na captura**

Run: `node tools/captura/capturar.cjs paciente:0:aberto --cheia`
Expected: na tabela de labs, a primeira coluna depois do nome é a data de hoje. No estado fictício a Hb sobe de ontem para hoje: a seta ▲ está na coluna de hoje, e o minigráfico termina subindo.

- [ ] **Step 6: Commit**

```bash
git add painel-core.js index.html tests/tela.test.cjs
git commit -m "fix(exames): coleta mais recente na primeira coluna, com tendência e minigráfico cronológicos"
```

---

### Task 6: Remover tarefa no toque (spec 1.4)

**Files:**
- Modify: `index.html` (`taskItemTpl`, `renderScreenC`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: o padrão de classes para botão escondido até o hover, que a Fase 4 aplica às outras listas: `opacity-60 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100`.

- [ ] **Step 1: Escrever a asserção**

```js
test('index.html: remover tarefa aparece no toque e pede confirmação', () => {
  const tpl = html.slice(html.indexOf('id="taskItemTpl"'), html.indexOf('id="patientDetailTpl"'));
  assert.ok(/class="remove-task [^"]*\bopacity-60 \[@media\(hover:hover\)\]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100\b/.test(tpl));
  assert.ok(/class="remove-task [^"]*\bmin-w-\[44px\] min-h-\[44px\]/.test(tpl));
  assert.ok(/class="remove-task [^"]*"[^>]*aria-label="Remover tarefa"/.test(tpl));
  assert.ok(html.includes("|| 'esta tarefa'"), 'tarefa sem texto não vira Remover ""?');
  assert.ok(html.includes("'Remover tarefa', 'bg-red-600', 'Remover'"));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="remover tarefa"`
Expected: FAIL na primeira asserção.

- [ ] **Step 3: Implementar**

`taskItemTpl`: o botão `.remove-task` ganha `type="button"`, as classes do teste (mais `flex items-center justify-center`) e `aria-label="Remover tarefa"`. Sai `opacity-0`.

`renderScreenC`: o clique chama `showConfirm` com a mensagem `Remover "<texto>"?`, onde o texto é `task.text.trim()` ou `'esta tarefa'`, título `'Remover tarefa'`, classe `'bg-red-600'` e botão `'Remover'`. O que hoje roda direto no clique passa a rodar na confirmação.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs tarefas
```
Expected: o ✕ aparece em cada tarefa. Confira também que a variante arbitrária entrou no CSS: uma busca por `hover:hover` em `styles.css` acha a regra.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css tests/tela.test.cjs
git commit -m "fix(tarefas): botão de remover visível no celular e com confirmação"
```

---

### Task 7: Seletor Ativos | Arquivados (spec 1.5)

**Files:**
- Modify: `index.html` (cabeçalho da lista, painel de filtros, listener de `viewArchiveBtn`)
- Modify: `tools/captura/abre-tela.js` (tela `arquivados`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `setViewArchived(v: boolean)`, a única porta de entrada para `isViewingArchived`.
- Produces: `#viewSegment` com os botões `#viewActiveBtn` e `#viewArchivedBtn`. A Fase 2 move o `#viewSegment` inteiro para a terceira linha do cabeçalho.

- [ ] **Step 1: Escrever a asserção**

```js
test('index.html: sair dos Arquivados está sempre à vista', () => {
  assert.ok(!html.includes('viewArchiveBtn'), 'o botão do painel de filtros saiu');
  assert.ok(html.includes('id="viewActiveBtn"') && html.includes('id="viewArchivedBtn"'));
  assert.ok(html.includes('function setViewArchived('));
  const filtros = html.slice(html.indexOf('id="filtersPanel"'), html.indexOf('</header>'));
  assert.ok(!filtros.includes('viewSegment'), 'o seletor fica fora do painel recolhível');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="Arquivados está"`
Expected: FAIL na primeira asserção.

- [ ] **Step 3: Implementar**

Marcação, numa linha nova entre a busca e o `#filtersPanel`:

```html
<div class="flex items-center gap-2 mt-2">
  <div id="viewSegment" class="inline-flex rounded-lg border border-slate-300 overflow-hidden" role="group" aria-label="Leitos exibidos">
    <button type="button" id="viewActiveBtn" aria-pressed="true">Ativos</button>
    <button type="button" id="viewArchivedBtn" aria-pressed="false">Arquivados</button>
  </div>
</div>
```

Cada botão tem 36 px de altura, `text-sm font-medium`; o selecionado fica `bg-sky-700 text-white`, o outro `bg-white text-slate-700`.

`setViewArchived(v)` faz o que o listener de `viewArchiveBtn` faz hoje (define `isViewingArchived`, limpa a busca, chama `renderScreenA()`), mais: acerta `aria-pressed` e as cores dos dois botões e esconde `#addBedBtn` quando `v` é verdadeiro. Os dois botões chamam `setViewArchived(false)` e `setViewArchived(true)`. Saem a constante `viewArchiveBtn`, o elemento e o listener.

Em `tools/captura/abre-tela.js`, a tela `arquivados` passa a chamar `setViewArchived(true)`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam, inclusive os dois de `html-refs`.

- [ ] **Step 5: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs arquivados:medir
node tools/captura/capturar.cjs lista:medir
```
Expected: em `arquivados`, "Arquivados" selecionado, o botão ＋ ausente, o primeiro cartão inteiro abaixo do cabeçalho e o bloco "Na nuvem" com o Paciente Exemplo Sete. Em `lista`, "Ativos" selecionado. Anote a altura do cabeçalho mostrada na etiqueta.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css tools/captura/abre-tela.js tests/tela.test.cjs
git commit -m "fix(ui): seletor Ativos | Arquivados sempre visível"
```

---

### Task 8: Rodapé do paciente numa linha (spec 1.6)

**Files:**
- Modify: `index.html` (`footer` de `#screen-details`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: os `id` de hoje (`footerActionConduta`, `footerActionNote`, `footerActionTracker`, `prevPatientBtn`, `nextPatientBtn`), que não mudam.
- Produces: botões de navegação com 56 px de largura fixa. A Fase 3 põe o leito vizinho dentro deles.

- [ ] **Step 1: Escrever a asserção**

```js
test('index.html: rodapé do paciente cabe numa linha', () => {
  const rodape = html.slice(html.indexOf('<!-- RODAPÉ FIXO (TELA B) -->'), html.indexOf('id="screen-tasks"'));
  ['+ Conduta', '+ Nota', '+ Controle'].forEach((t) => assert.ok(!rodape.includes(t), t));
  ['Conduta', 'Nota', 'Controle'].forEach((t) => assert.ok(new RegExp('<span[^>]*>' + t + '</span>').test(rodape), t));
  assert.strictEqual((rodape.match(/\bw-14\b/g) || []).length, 2, '‹ e › com 56 px');
  assert.ok(/id="prevPatientBtn"[^>]*aria-label="Paciente anterior"/.test(rodape));
  assert.ok(/id="nextPatientBtn"[^>]*aria-label="Próximo paciente"/.test(rodape));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="rodapé do paciente"`
Expected: FAIL (`+ Conduta` ainda está lá).

- [ ] **Step 3: Implementar**

Os três botões de ação: `flex-1 min-w-0 h-14 flex flex-col items-center justify-center gap-0.5 text-xs font-medium rounded-lg`, com um ícone de 20 px em cima e o rótulo num `<span>` embaixo. Ícones do Heroicons 20 solid, embutidos como os outros: `clipboard-document-check` (Conduta), `pencil-square` (Nota), `plus-circle` (Controle). Conduta continua sendo o botão principal, agora em `bg-sky-700 text-white`; os outros dois ficam com a borda de hoje.

Os botões ‹ ›: `w-14 h-14 flex-shrink-0`, `type="button"`, com os `aria-label` do teste.

Orçamento em 360 px: 336 úteis − 2 × 56 − 4 × 8 = 192, ou 64 px para cada ação.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0 --largura=360
node tools/captura/capturar.cjs paciente:0 --largura=390
```
Expected: nas duas larguras, cinco botões numa linha só, o › inteiro dentro da tela e nenhum rótulo quebrado.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css tests/tela.test.cjs
git commit -m "fix(ui): rodapé do paciente cabe numa linha em 360 px"
```

---

### Task 9: Editar e apagar coleta de lab (spec 1.7)

**Files:**
- Modify: `index.html` (`renderLabTab`, `renderLabFlowsheet`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `#delete-lab-entry-btn`, dentro de `#lab-entry-form`, visível só no modo edição. O cabeçalho de cada data é um `<button class="edit-collection-btn" data-date="…">`.

- [ ] **Step 1: Escrever a asserção**

```js
test('index.html: a data da coleta é o botão de editar; apagar fica dentro do formulário', () => {
  assert.ok(!html.includes('delete-collection-btn'), 'o ✕ de 12 px no cabeçalho saiu');
  assert.ok(/<button type="button" class="edit-collection-btn [^"]*\bmin-h-\[44px\]/.test(html));
  assert.ok(/id="delete-lab-entry-btn"[^>]*class="hidden /.test(html) || /class="hidden [^"]*"[^>]*id="delete-lab-entry-btn"/.test(html));
  assert.strictEqual(html.split('Deletar todos os exames da coleta do dia').length - 1, 1, 'mesmo texto de confirmação, uma vez só');
  const apagar = html.slice(html.indexOf("querySelector('#delete-lab-entry-btn').addEventListener"));
  assert.ok(/dataset\.editDate/.test(apagar.slice(0, 600)), 'apaga a coleta da data original, não a do campo de data');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="data da coleta"`
Expected: FAIL na primeira asserção.

- [ ] **Step 3: Implementar**

`renderLabFlowsheet`, cabeçalho de cada coluna: o `<th>` perde o padding e recebe um `<button type="button" class="edit-collection-btn w-full min-h-[44px] px-3 flex items-center justify-center gap-1 …" data-date="${date}" aria-label="Editar coleta de ${dd/mm}">` com a data e o lápis de 14 px (`w-3.5 h-3.5`). Sai o `svg.delete-collection-btn`.

`renderLabTab`:
- no formulário, depois de `#save-lab-entry-btn`: `<button type="button" id="delete-lab-entry-btn" class="hidden w-full text-sm bg-red-100 text-red-800 font-medium rounded-lg py-3">Apagar coleta</button>`;
- `setLabEditMode(editDate)` também mostra ou esconde esse botão;
- o listener é ligado com `contentEl.querySelector('#delete-lab-entry-btn').addEventListener('click', …)`; o clique lê `form.dataset.editDate` (a data original da coleta em edição, não o valor do campo de data), acha a coleta por ela e chama `showConfirm` com o texto de hoje, `Deletar todos os exames da coleta do dia ${PainelCore.formatDateBR(editDate)}?`. Na confirmação: remove a coleta, `saveData(state)` e `renderLabTab(contentEl, bed, bedIdx)`, que fecha o formulário;
- do listener delegado de `flowsheetContainer` sai o ramo de `deleteBtn`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0:aberto --cheia
```
Expected: cada data da tabela aparece com o lápis ao lado, numa faixa de 44 px de altura; nenhum ✕ no cabeçalho.

Abra `index.html` no navegador com dados de teste e confira o item 2 do Review Focus: toque numa data, mude o campo "Data da Coleta" para outro dia e toque em "Apagar coleta". A confirmação cita a data original, e é essa coleta que some.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css tests/tela.test.cjs
git commit -m "fix(exames): tocar na data edita a coleta; apagar fica dentro do formulário"
```

---

### Task 10: A seção HPP lembra se estava fechada (spec 1.8)

**Files:**
- Modify: `painel-core.js` (`migrateBed`)
- Test: `tests/migrate.test.cjs`

**Interfaces:**
- Produces: `bed.isHppMinimized` (booleano, padrão `false`) em todo leito que passa por `migrateBed`.

- [ ] **Step 1: Escrever o teste**

```js
test('migrateBed: isHppMinimized sobrevive ao recarregar; sem o flag, o HPP abre', () => {
  assert.strictEqual(PainelCore.migrateBed({ bedNumber: '1', isHppMinimized: true }).isHppMinimized, true);
  assert.strictEqual(PainelCore.migrateBed({ bedNumber: '1' }).isHppMinimized, false);
  const salvo = JSON.parse(JSON.stringify({ beds: [{ bedNumber: '1', patientName: 'Paciente Exemplo Um', isHppMinimized: true }] }));
  assert.strictEqual(PainelCore.migrateState(salvo, '2026-11-16').beds[0].isHppMinimized, true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="isHppMinimized"`
Expected: FAIL, `undefined !== true`.

- [ ] **Step 3: Implementar**

Em `migrateBed`, junto dos outros flags: `isHppMinimized`, com o mesmo padrão de leitura dos vizinhos e valor inicial `false`.

- [ ] **Step 4: Rodar a suíte inteira**

Run: `node --test`
Expected: todos passam. Algum teste de sync pode comparar o leito inteiro; se um deles falhar por causa da chave nova, acrescente `isHppMinimized: false` ao valor esperado daquele teste.

- [ ] **Step 5: Commit**

```bash
git add painel-core.js tests/migrate.test.cjs
git commit -m "fix(ui): seção HPP lembra se estava fechada depois de recarregar"
```

---

### Task 11: Entrega da Fase 1

**Files:**
- Modify: `sw.js` (versão do cache)

- [ ] **Step 1: Subir o cache**

Em `sw.js`, `const CACHE = 'caderno-v9';` vira `'caderno-v10'`.

- [ ] **Step 2: Suíte inteira**

Run: `node --test`
Expected: 0 falhas; a contagem sobe de 345 para cerca de 360.

- [ ] **Step 3: Capturas finais**

Run, para cada largura em 360, 390 e 1280:
```bash
node tools/captura/capturar.cjs lista:medir --largura=<L>
node tools/captura/capturar.cjs arquivados --largura=<L>
node tools/captura/capturar.cjs tarefas --largura=<L>
node tools/captura/capturar.cjs paciente:0:aberto --largura=<L> --cheia
node tools/captura/capturar.cjs modal:controle --largura=<L>
```
Expected: nas quinze imagens, nenhum texto cortado, nenhum botão fora da tela e nenhum elemento sobreposto. Compare `paciente-0-aberto-360.png` com o "antes" da Task 2.

- [ ] **Step 4: Checklist de regressão**

Abra `index.html` no navegador e percorra o checklist do spec ("Funcionalidades que precisam continuar acessíveis"), itens de Lista, Arquivados, Paciente e Tarefas. Atenção ao que esta fase tocou: marcar e desmarcar cada check e a Queda na lista e no paciente; entrar e sair dos Arquivados; adicionar, editar e apagar uma coleta; fixar e reordenar um exame; remover uma tarefa; fechar o HPP, recarregar a página e ver que continua fechado.

- [ ] **Step 5: Registrar as convenções no CLAUDE.md**

Na seção "Desenvolvimento", no estilo das linhas que já estão lá, acrescente duas:
- elemento que sai do HTML: `tests/html-refs.test.cjs` falha se o script ainda procurar o `id` ou a classe;
- capturas: `node tools/captura/capturar.cjs <tela> [--largura=N] [--cheia]`, sempre com o estado fictício de `tools/captura/estado-ficticio.js` (nunca dado real).

Na linha das regras de tela que moram no core, acrescente `DAILY_CHECKS` e `tendenciasLab`.

- [ ] **Step 6: Commit**

```bash
git add sw.js CLAUDE.md
git commit -m "chore(sw): cache v10 (fase 1 da revisão de UI)"
```

- [ ] **Step 7: Entregar ao usuário para conferir no aparelho**

Mostre ao usuário as capturas de 360 px do antes e do depois e peça a conferência no Galaxy A54 (spec, fim de "Verificação visual"): o teclado não cobre o campo em uso; arrastar funciona em HPP, Problemas e Controles; o voltar do aparelho volta da tela do paciente para a lista. Não mescle em `master` nem faça push antes de ele pedir.
