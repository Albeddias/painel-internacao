# Revisão de UI/UX, Fase 3: tela do paciente — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a tela do paciente: ações raras no menu ⋯, identificação em chips, seções na ordem definida pelo usuário com barra de atalhos e resumo quando fechadas, campos que não cortam o texto, e o fluxo de copiar para o Tasy com marca de "copiado".

**Architecture:** Toda regra de exibição (ações por registro, selo e linha de cada controle, resumo de cada seção, janela padrão dos labs, vizinhos na lista) é função pura em `painel-core.js`, com teste. O que fica fora do template do paciente (cabeçalho fixo, barra de atalhos, folha de ações, rodapé) liga o listener uma vez só e lê `currentPatientIndex` na hora do toque, porque `renderScreenB` roda a cada edição.

**Tech Stack:** HTML + JS clássico (UMD, sem build, funciona em `file://`), Tailwind pré-compilado (`styles.css`), `node --test`, Edge headless para capturas.

**Spec:** `docs/superpowers/specs/2026-11-16-redesign-ui-ux-design.md` (seções "Restrições", "Fase 3" e "Verificação visual"). Plano 3 de 4. Depende das fases 1 e 2 entregues: usa `tests/html-refs.test.cjs`, `tools/captura/`, o ajudante `juntas`, os tokens e as classes `.btn`/`.chip`/`.card`, `openSheet`/`closeSheet`, `avisar`, `saveData(…, { localOnly: true })`, `PainelCore.statusAltaPrevista` e `PainelCore.LIMIARES`.

## Global Constraints

- Funcionar 100% offline em `file://`: sem ES modules e sem dependências de build.
- Nada muda em `runSync`, `buildPushDiff`, migrations, `painel_sync_*`, `[NOME]` ou iniciais. Os flags `is*Minimized` continuam com os mesmos nomes e os mesmos padrões de aberta/fechada.
- Regra de tela testável mora em `painel-core.js` e entra no objeto exportado. Função que depende de data recebe `hojeISO`; nada de `new Date()` sem argumento dentro do core.
- Testes: `node --test`, da raiz, sem argumento de caminho. Um só: `node --test --test-name-pattern="<trecho>"`. Suíte antes desta fase: cerca de 385 testes, 0 falhas.
- Elemento que muda de lugar leva o `id` ou a classe e o listener junto.
- **Listener de elemento fixo é ligado uma vez, na carga, nunca dentro de `renderScreenB`.**
- Componente novo: `<button type="button">`, `aria-label` quando só tem ícone, alvo de 44 px, `print:hidden` se for fixo ou flutuante.
- Ação destrutiva continua passando por `showConfirm`, com o mesmo texto de hoje.
- A ordem das seções (Task 3) foi definida pelo usuário: não alterar.
- Classe Tailwind nova: `npx tailwindcss@3 -o styles.css --content ./index.html --minify`, com o `styles.css` no mesmo commit.
- Larguras de conferência: 360, 390 e 1280 px. Rodapé em 360 px: 2 × 56 (navegação) + 4 × 8 + 3 × 64 (ações).
- Dados de teste e de captura são sempre fictícios.
- Branch `ui-fase-3`, criada de `master` no próprio diretório (sem worktree). Commits em português, `tipo(escopo): descrição`, terminando com `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Mescla e push só quando o usuário pedir.

## Review Focus

1. Paciente aberto a partir de Arquivados ou de "Internações anteriores": o menu ⋯ oferece Restaurar e Reinternar, não "Dar alta"; ‹ › ficam desabilitados. Testes nas Tasks 1 e 9.
2. Anotações iguais ao modelo, modelo personalizado, ou leito antigo sem as listas: o resumo sai vazio, sem erro. Testes na Task 6.
3. Texto colado com quebras de linha num campo de uma linha, e Enter no campo: vira uma linha só. Teste e conferência na Task 7.
4. Leito sem idade, admissão ou previsão, e data apagada no seletor nativo: os chips voltam ao texto de vazio. Teste e conferência na Task 2.
5. Paciente só com coletas antigas, ou com uma coleta de data futura por erro de digitação: a tabela de labs não abre vazia. Testes na Task 8.

## Mapa de arquivos

| Arquivo | Responsabilidade nesta fase |
|---|---|
| `painel-core.js` | `acoesDoRegistro`, `chipAdmissao`, `seloControle`, `linhaControle`, `fimPrevistoAtb`, `GENDOC_LABEL`, `resumoSecao`, `umaLinha`, `janelaLabs`, `rotuloFiltroLabs`, `vizinhosNaLista`, `avisoIniciais`. |
| `tests/tela.test.cjs` | Testes das regras acima (menos `resumoSecao`) e asserções de texto sobre o `index.html`. |
| `tests/resumo-secao.test.cjs` | Novo. Uma asserção por linha da tabela do spec 3.4. |
| `index.html` | Cabeçalho e menu do paciente, cartão de identificação, ordem das seções, barra de atalhos, controles, resumos, campos, exames, rodapé, marcas de copiado, arrasto das condutas. |
| `tools/captura/abre-tela.js` | Sufixos novos de `paciente:N`: `:menu`, `:secao=<chave>`, `:fixados`, `:copiado`. |
| `styles.css` | Regenerado. |
| `sw.js` | Cache `caderno-v12`. |

Em todos os testes de texto desta fase, `tpl` é o template do paciente:

```js
const tplIni = html.indexOf('id="patientDetailTpl"');
const tpl = html.slice(tplIni, html.indexOf('</template>', tplIni));
```

Declare-o uma vez em `tests/tela.test.cjs`, na Task 1.

---

### Task 1: Menu ⋯ do paciente e selo de alergia no cabeçalho (spec 3.1)

**Files:**
- Modify: `painel-core.js` (função nova + export)
- Modify: `index.html` (cabeçalho de `#screen-details`, `#patientMenuSheet`, `renderScreenB`, `updateAlergiasHighlight`, `openSheet`)
- Modify: `tools/captura/abre-tela.js`
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `PainelCore.acoesDoRegistro(bed)` → lista de `'alta'|'arquivar'|'restaurar'|'reinternar'|'deletar'`.
- Produces: `openPatientMenu()`, que mostra só os itens de `acoesDoRegistro` e chama `openSheet('patientMenuSheet', …)`.
- Produces: `#patientMenuBtn`, `#patientMenuSheet` (itens `#pmDischarge`, `#pmArchive`, `#pmRestore`, `#pmReadmit`, `#pmDelete`, cada um com `data-acao`), `#patientAllergyFlag`.

- [ ] **Step 1: Criar a branch e escrever os testes**

```bash
git checkout master && git checkout -b ui-fase-3
```

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="acoesDoRegistro|ações do paciente"`
Expected: 2 falhas.

- [ ] **Step 3: Implementar `acoesDoRegistro`**

Arquivado vem primeiro: `restaurar`, `reinternar` (só se tem nome) e `deletar`. Ativo sem nome: só `deletar`. Ativo com nome: `alta`, `arquivar`, `deletar`.

- [ ] **Step 4: Implementar no `index.html`**

Cabeçalho fixo de `#screen-details`: `‹ Voltar` | bloco central com `#patient-header-bed`, `#patientAllergyFlag` e `#patient-header-name` (cortado com reticências) | `<button type="button" id="patientMenuBtn" class="btn btn-ghost" aria-label="Ações do paciente">⋯</button>`.

`#patientAllergyFlag`: `<button type="button" class="chip chip-danger hidden">⚠ ALERGIA</button>`. `updateAlergiasHighlight` passa a mostrar ou esconder também este selo e a escrever `aria-label="Alergia registrada: <texto>"`. O clique rola a página até o topo, onde está a faixa. A faixa `.alergias-banner` continua como hoje.

Folha, depois de `#listMenuSheet`, no contrato da Fase 2:

```html
<div id="patientMenuSheet" class="sheet hidden print:hidden" role="dialog" aria-modal="true" aria-label="Ações do paciente">
  <div class="sheet-backdrop" data-sheet-close></div>
  <div class="sheet-panel">
    <button type="button" id="pmDischarge" class="sheet-item" data-acao="alta">Dar alta</button>
    <button type="button" id="pmArchive" class="sheet-item" data-acao="arquivar">Arquivar</button>
    <button type="button" id="pmRestore" class="sheet-item" data-acao="restaurar">Restaurar</button>
    <button type="button" id="pmReadmit" class="sheet-item" data-acao="reinternar">Reinternar</button>
    <hr class="sheet-sep">
    <button type="button" id="pmDelete" class="sheet-item sheet-item-danger" data-acao="deletar">Deletar</button>
    <button type="button" class="sheet-item sheet-cancel" data-sheet-close>Cancelar</button>
  </div>
</div>
```

`openPatientMenu()` esconde os itens cujo `data-acao` não está em `acoesDoRegistro(state.beds[currentPatientIndex])` e abre a folha. Em `openSheet`, o foco inicial passa a ir para o primeiro `.sheet-item` **visível**.

Os cinco listeners são ligados uma vez, na carga, e leem `state.beds[currentPatientIndex]` na hora do toque:
- alta, arquivar, deletar: o corpo dos três listeners que hoje estão em `renderScreenB`, movido sem mudar texto nem comportamento;
- restaurar: o que o botão "Restaurar" do cartão de Arquivados faz, seguido de `renderScreenB()`;
- reinternar: `openReadmitModal(leito)`.

Do template saem os botões `.discharge-card`, `.archive-bed-btn` e `.delete-patient-btn`; ficam o sino e "Copiar resumo".

Em `tools/captura/abre-tela.js`, sufixo `:menu` em `paciente:N`: abre o paciente e chama `openPatientMenu()`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 6: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0:menu --largura=360
node tools/captura/capturar.cjs paciente:7:menu --largura=360
node tools/captura/capturar.cjs paciente:4:menu --largura=360
```
Expected: leito 0 (internado): "Dar alta", "Arquivar" e, depois da linha, "Deletar" em vermelho; o cabeçalho mostra "⚠ ALERGIA". Leito 7 (arquivado): "Restaurar", "Reinternar", "Deletar". Leito 4 (vazio): só "Deletar".

- [ ] **Step 7: Commit**

```bash
git add painel-core.js index.html styles.css tools/captura/abre-tela.js tests/tela.test.cjs
git commit -m "feat(paciente): ações no menu ⋯ conforme o registro e selo de alergia no cabeçalho fixo"
```

---

### Task 2: Cartão de identificação em chips (spec 3.1)

**Files:**
- Modify: `painel-core.js` (função nova + export)
- Modify: `index.html` (template do paciente, CSS, `renderScreenB`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: `PainelCore.statusAltaPrevista` (Fase 2).
- Produces: `PainelCore.chipAdmissao(admitDate, hojeISO): string`.
- Produces: classe CSS `.chip-nativo` (chip com um campo nativo transparente por cima), reaproveitada na Task 7.
- Produces: `refreshIdChips(art, bed)`.

- [ ] **Step 1: Escrever os testes**

```js
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
```

No teste `campo-linha` da Fase 1, a lista de classes passa a ser `['inline-age', 'problem-plan']`: `.inline-admit` deixa de ser um campo visível.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="chipAdmissao|identificação em chips"`
Expected: 2 falhas.

- [ ] **Step 3: Implementar `chipAdmissao`**

`'Adm ' + formatDateBR(data)` e, quando `dayNumber` é 1 ou mais, `' · D' + n`.

- [ ] **Step 4: Reescrever o cartão**

CSS, depois da regra global dos campos (precisa vir depois para vencer o `min-height: 48px`):

```css
.chip-nativo { position: relative; min-height: 36px; }
.chip-nativo > input, .chip-nativo > select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; font-size: 16px; min-height: 0; padding: 0; }
```

O chip mostra o texto formatado pelo app; o campo nativo cobre o chip inteiro, invisível. O toque abre o seletor do sistema. Não usar `showPicker()`.

Linha de dados, no lugar de `.patient-meta` (as classes dos três campos continuam, e os listeners de hoje também):

```html
<div class="patient-meta flex flex-wrap items-center gap-2 mt-3">
  <label class="chip"><input class="inline-age campo-linha w-12" type="number" min="0" inputmode="numeric" placeholder="Idade" aria-label="Idade"><span>a</span></label>
  <label class="chip chip-nativo"><span class="admit-text"></span><input class="inline-admit" type="date" aria-label="Data de admissão"></label>
  <label class="chip chip-nativo alta-chip"><span class="alta-text"></span><input class="inline-discharge-forecast" type="date" aria-label="Previsão de alta"></label>
  <button type="button" class="clear-discharge-forecast-btn hidden min-w-[44px] min-h-[44px]" aria-label="Limpar previsão de alta">✕</button>
</div>
```

`refreshIdChips(art, bed)` escreve:
- `.admit-text`: `PainelCore.chipAdmissao(bed.admitDate, todayISO())`;
- `.alta-text`: `'Alta prev. ' + PainelCore.formatDateBR(bed.dischargeForecast)`, ou `'+ Previsão de alta'` quando vazia;
- a classe do `.alta-chip` pelo `tom` de `statusAltaPrevista` (`perigo` → `chip-danger`, `primaria` → `chip-primary`, `atencao` → `chip-warn`, senão só `chip`);
- o ✕ visível só quando há previsão.

É chamada no desenho e dentro dos listeners de `.inline-admit` e `.inline-discharge-forecast`, depois de gravar.

Médico externo, recolhido:

```html
<details class="ext-doc-details mt-3">
  <summary class="text-sm">Médico externo: <span class="ext-doc-summary">—</span></summary>
  <!-- a linha de hoje: .inline-ext-name, o datalist e .add-ext-doc-to-list-btn -->
</details>
```

`.ext-doc-summary` mostra o nome, ou "—". É atualizado no desenho e a cada tecla no campo.

Os dois botões de "salvar na lista" trocam o ícone de barras pelo `bookmark` (Heroicons 20 solid) e ganham os `aria-label` do teste.

Do fim do template sai o bloco "Seção: Previsão de Alta".

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 6: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0 --largura=360
node tools/captura/capturar.cjs paciente:4 --largura=360
```
Expected: leito 0: chips "78 a", "Adm DD/MM · D10", "Alta prev. DD/MM" em vermelho com o ✕, e "Médico externo: —" numa linha. Leito 4 (vazio): "Idade", "Admissão", "+ Previsão de alta", sem o ✕.

No navegador, confira o item 4 do Review Focus: tocar no chip de admissão abre o seletor de data; escolher uma data atualiza o chip na hora; apagar a data no seletor devolve "Admissão"; o ✕ limpa a previsão.

- [ ] **Step 7: Commit**

```bash
git add painel-core.js index.html styles.css tests/tela.test.cjs
git commit -m "feat(paciente): identificação em chips, com previsão de alta e dia de internação"
```

---

### Task 3: Seções na ordem definida pelo usuário (spec 3.2)

**Files:**
- Modify: `index.html` (template do paciente)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: cada `.collapsible-section` do template tem `data-secao="<chave>" data-atalho="<chip>"`, nesta ordem de atributos. As chaves de `data-secao` são as que `resumoSecao` recebe na Task 6.

- [ ] **Step 1: Escrever a asserção**

```js
test('index.html: seções do paciente na ordem definida pelo usuário, cada uma com seu atalho', () => {
  const secoes = [...tpl.matchAll(/data-secao="([a-z]+)" data-atalho="([a-z]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(secoes, [
    ['problemas', 'problemas'], ['hpp', 'historico'], ['alergias', 'historico'], ['anamnese', 'historico'],
    ['internacoes', 'historico'], ['controles', 'controles'], ['exames', 'exames'], ['condutas', 'condutas'],
    ['anotacoes', 'condutas'], ['evolucao', 'evolucao'], ['textos', 'docs'], ['documentos', 'docs'],
  ]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="ordem definida pelo usuário"`
Expected: FAIL (lista vazia).

- [ ] **Step 3: Reordenar o template**

Mova os doze blocos `.collapsible-section` para a ordem do teste e acrescente os dois atributos a cada um. Nada mais muda: `setupCollapsibleSection` acha cada seção pelo seletor do conteúdo, não pela posição, e os flags e padrões continuam os mesmos. O cartão de identificação e as duas faixas continuam antes das seções.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Conferir**

Run: `node tools/captura/capturar.cjs paciente:0:aberto --largura=390 --cheia`
Expected: os títulos aparecem na ordem: Lista de Problemas, HPP, Alergias e Medicações Prévias, Anamnese Inicial, Internações anteriores, Controles e Invasivos, Exames, Condutas, Anotações, Evolução Tasy, Texto do Prontuário, Documentos Gerados.

No navegador: arraste um item em Problemas, em HPP e em Controles e confira que a ordem nova fica depois de recarregar.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/tela.test.cjs
git commit -m "feat(paciente): seções na ordem do raciocínio clínico (problemas primeiro)"
```

---

### Task 4: Barra de atalhos (spec 3.3)

**Files:**
- Modify: `index.html` (`#screen-details`, CSS, `renderScreenB`, `showScreen`)
- Modify: `tools/captura/abre-tela.js`
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: `data-secao` e `data-atalho` (Task 3).
- Produces: `goToSection(atalho: string)` e `observeSections()`.
- Produces: variável CSS `--paciente-topo` (altura do cabeçalho + barra + 8 px), usada no `padding-top` de `#patientDetailContent` e no `scroll-margin-top` das seções.

- [ ] **Step 1: Escrever a asserção**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="barra de atalhos"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Marcação, logo depois do `header` de `#screen-details`:

```html
<nav id="sectionNav" class="fixed left-0 right-0 z-10 print:hidden" aria-label="Seções do paciente">
  <div class="section-nav-scroll flex gap-2 overflow-x-auto px-3 py-2">
    <button type="button" class="chip section-nav-chip" data-atalho="problemas">Problemas</button>
    <!-- … os outros seis, na ordem do teste -->
  </div>
</nav>
```

Chips de 36 px de altura, sem quebra. A faixa tem `mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent)` e 24 px de padding à direita: o degradê avisa que há chips escondidos e o último chip não fica embaixo dele.

Posição: ao entrar na tela do paciente e em `resize`, `#sectionNav` recebe `top` = altura do cabeçalho, e `--paciente-topo` é escrita na raiz. `#patientDetailContent` troca o `padding-top: 80px` fixo por `var(--paciente-topo, 132px)`. As seções ganham `.collapsible-section { scroll-margin-top: var(--paciente-topo, 132px); }`.

Destino de cada chip:

```js
const ATALHO_ALVO = { problemas: 'problemas', historico: 'hpp', controles: 'controles', exames: 'exames',
  condutas: 'condutas', evolucao: 'evolucao', docs: 'textos' };
```

`goToSection(atalho)`: acha a seção `[data-secao="<alvo>"]`; se está fechada, clica no título dela (o listener de `setupCollapsibleSection` abre e grava o flag); depois de 50 ms, `scrollIntoView({ block: 'start', behavior: 'smooth' })`. A espera cobre os campos que ainda ajustam a altura num `setTimeout`.

Destaque: `observeSections()` cria um `IntersectionObserver` sobre as seções com `data-atalho` e marca como ativo (`aria-current="true"` e `chip-primary`) o chip da seção que está no topo da área visível; o chip ativo é trazido para dentro da faixa com `scrollIntoView({ inline: 'nearest', block: 'nearest' })`. É chamada no fim de `renderScreenB` e desliga o observador anterior antes de criar outro. Sem `IntersectionObserver` no navegador, não faz nada.

Teclado: `focusin` e `focusout` no documento ligam e desligam a classe `digitando` no `body` quando o foco está num `textarea` ou num `input` de texto, número ou busca dentro de `#screen-details`. CSS: `body.digitando #sectionNav { display: none; }`. A barra é fixa, então escondê-la não desloca a página.

Os sete listeners de clique são ligados uma vez, na carga.

Em `tools/captura/abre-tela.js`, sufixo `:secao=<atalho>` em `paciente:N`: abre o paciente e chama `goToSection`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0:medir --largura=360
node tools/captura/capturar.cjs paciente:0:secao=exames --largura=360
node tools/captura/capturar.cjs paciente:0:secao=docs --largura=360
```
Expected: a barra aparece logo abaixo do cabeçalho, com o degradê à direita; o primeiro cartão não fica coberto. Em `secao=exames`, a seção Exames está aberta, com o título logo abaixo da barra e o chip "Exames" destacado. Em `secao=docs`, o chip "Docs" está destacado e visível dentro da faixa.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css tools/captura/abre-tela.js tests/tela.test.cjs
git commit -m "feat(paciente): barra de atalhos para as seções"
```

---

### Task 5: Controles em duas linhas, com a regra no core (spec 3.6)

**Files:**
- Modify: `painel-core.js` (três funções + export)
- Modify: `index.html` (`renderTrackerList`, CSS, botão de Cultura do modal)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: `PainelCore.LIMIARES`, `atbBadge` (que continua existindo e é chamado por dentro).
- Produces: `PainelCore.seloControle(t, hojeISO)` → `{ tipo: 'atb'|'cultura'|'dispositivo'|'procedimento', rotulo, curto, tom: 'perigo'|'atencao'|'neutro', alerta: boolean, ativo: boolean }`. `ativo` é falso para ATB suspenso, cultura com resultado e dispositivo removido.
- Produces: `PainelCore.linhaControle(t, hojeISO): string` (a segunda linha do item) e `PainelCore.fimPrevistoAtb(t, hojeISO): string` (`'AAAA-MM-DD'` ou `''`).
- Produces: ajudante interno do core `somaDias(iso, n): string`, que a Task 8 reaproveita.

- [ ] **Step 1: Escrever os testes**

```js
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
```

No teste antigo "selo do ATB e check de Queda vêm do core", a linha `assert.ok(html.includes('PainelCore.atbBadge('));` passa a ser `assert.ok(html.includes('PainelCore.seloControle('));`: o `index.html` deixa de chamar `atbBadge` direto.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="seloControle|fimPrevistoAtb|linhaControle|controles desenhados"`
Expected: 4 falhas.

- [ ] **Step 3: Implementar no core**

- `somaDias(iso, n)`: soma dias a uma data `'AAAA-MM-DD'` no calendário local (via `parseISODate`) e devolve no mesmo formato.
- `seloControle`: para ATB, parte de `atbBadge` (o `rotulo` é o `label` sem os parênteses; `curto` é a parte antes do espaço, salvo em "Suspenso Dn" e "Agendado", que ficam inteiros). Tom do ATB: prazo vencido = `perigo`; último dia e ATB longo = `atencao`. Cultura: pendente é resultado vazio ou com "aguard"; alerta a partir de `LIMIARES.culturaDias`. Dispositivo: alerta a partir de `LIMIARES.dispositivoDias`; removido conta os dias de uso, como hoje. Procedimento: "PO Dn", "Agendado" quando a data é futura, nunca alerta.
- `fimPrevistoAtb` e `linhaControle`: os valores dos testes.

- [ ] **Step 4: Redesenhar a lista**

`renderTrackerList` deixa de calcular: para cada controle, `seloControle` e `linhaControle`. Cada `.tracker-item` leva `data-tipo` e `data-tracker-id`, e fica assim:

```
▍ alça │ linha 1: nome ........................................ selo (.chip, pelo tom)
▍      │ linha 2: linhaControle, em 0.75rem e --c-text-muted ......... ✎  ✕
```

- Tom para classe: `perigo` → `chip-danger`, `atencao` → `chip-warn`, `neutro` → `chip`.
- ✎ e ✕ com alvo de 44 px e `aria-label` ("Editar", "Remover").
- Item com `ativo` falso e tipo diferente de cultura: nome em `--c-text-muted`. Sem `opacity`.
- Barra lateral de 3 px pelo tipo:

```css
.tracker-item { border-left: 3px solid var(--c-border); }
.tracker-item[data-tipo="atb"] { border-left-color: #0284c7; }
.tracker-item[data-tipo="cultura"] { border-left-color: #0d9488; }
.tracker-item[data-tipo="dispositivo"] { border-left-color: #64748b; }
.tracker-item[data-tipo="procedimento"] { border-left-color: #7c3aed; }
```

No modal de controle, o botão `data-type="culture"` troca `bg-amber-50 hover:bg-amber-100 text-amber-800` por `bg-teal-50 hover:bg-teal-100 text-teal-800`. Sai `daysBetween` do `index.html`, se não sobrar uso.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam, inclusive os testes antigos de `atbBadge`.

- [ ] **Step 6: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0:secao=controles --largura=360
node tools/captura/capturar.cjs modal:controle --largura=360
```
Expected: seis itens de duas linhas. "Piperacilina-tazobactam" com o selo vermelho "D8/7 prazo vencido" e "ATB · D1 DD/MM · fim previsto DD/MM" embaixo; a hemocultura com barra teal e selo âmbar "D4"; o CVC com selo âmbar "D9"; o ATB suspenso e o dispositivo removido em cinza, sem transparência. No modal, "Cultura" em teal.

- [ ] **Step 7: Commit**

```bash
git add painel-core.js index.html styles.css tests/tela.test.cjs
git commit -m "feat(paciente): controles em duas linhas, com selo e fim previsto calculados no core"
```

---

### Task 6: Resumo nas seções fechadas (spec 3.4)

**Files:**
- Modify: `painel-core.js` (`resumoSecao`, `GENDOC_LABEL` + exports)
- Modify: `index.html` (títulos das seções, `setupCollapsibleSection`, `GENDOC_LABEL`)
- Create: `tests/resumo-secao.test.cjs`
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: `seloControle` (Task 5), `data-secao` (Task 3), `buildLabsLine`, `parseHpp`.
- Produces: `PainelCore.resumoSecao(bed, secao, opts): string`, com `opts = { hoje, pinnedExams, notesTemplate, anteriores, diaLocal }`. `anteriores` é a lista dos leitos das internações anteriores; `diaLocal(isoTimestamp)` devolve `'AAAA-MM-DD'` no fuso do aparelho. Seção desconhecida ou sem conteúdo: `''`.
- Produces: `PainelCore.GENDOC_LABEL` (sai do `index.html`).
- Produces: `refreshSectionSummary(section, bed)`.

- [ ] **Step 1: Escrever os testes**

`tests/resumo-secao.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

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
```

Em `tests/tela.test.cjs`:

```js
test('index.html: resumo no título de cada seção fechada', () => {
  assert.strictEqual((tpl.match(/class="section-summary /g) || []).length, 11, 'todas as seções menos Exames, que já tem a linha de labs');
  assert.ok(html.includes('PainelCore.resumoSecao(') && html.includes('function refreshSectionSummary('));
  assert.ok(!html.includes('const GENDOC_LABEL') && html.includes('PainelCore.GENDOC_LABEL'));
  assert.ok(juntas('labs-last-line', 'line-clamp-2'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="resumoSecao|resumo no título"`
Expected: 9 falhas.

- [ ] **Step 3: Implementar `resumoSecao`**

`GENDOC_LABEL` (`{ sumario_alta: 'Sumário de Alta', receituario: 'Receituário', laudo: 'Laudo' }`) vai para o core.

Regras que os testes não deixam explícitas:
- texto é sempre reduzido a uma linha antes de cortar; o corte acrescenta `…`;
- cortes: anamnese em 60 caracteres, medicações em 40, nome de controle em 14;
- controles: só os de `seloControle(...).ativo`; primeiro os de `alerta`, cada grupo na ordem da lista; cada item é `nome cortado + ' ' + curto`, com `' ⚠'` quando alerta;
- anotações: a primeira linha não vazia que não seja, depois de `trim()`, igual a uma linha do modelo;
- documentos e textos: o mais recente pela data.

- [ ] **Step 4: Mostrar o resumo**

Em cada título de seção do template, menos o de Exames, dentro do `<span>` do título (que ganha `min-w-0 flex-1`): `<span class="section-summary hidden block text-xs font-normal truncate"></span>`. A cor é `--c-text-muted`.

`refreshSectionSummary(section, bed)` lê `section.dataset.secao`, calcula o texto e mostra o resumo **só quando a seção está fechada** e o texto não é vazio. É chamada por `setupCollapsibleSection` no desenho e a cada abrir ou fechar. As opções vêm de um ajudante só: `hoje: todayISO()`, `pinnedExams: state.pinnedExams`, `notesTemplate: state.notesTemplate || globalNotesTemplate`, `anteriores` de `PainelCore.previousAdmissions(state.beds, bed)` e um `diaLocal` que converte o instante para a data local.

Exames continua com `.labs-last-line`, sempre visível, agora com `line-clamp-2`. Os contadores "(3)" e a etiqueta "ALERGIA" continuam nos títulos.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 6: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0 --largura=360 --cheia
node tools/captura/capturar.cjs paciente:0:aberto --largura=360 --cheia
```
Expected: com as seções fechadas, cada título tem uma linha cinza embaixo. Alergias começa por "Dipirona (edema de glote) · "; Controles começa por "Piperacilina-t… D8/7 ⚠" e não cita o ATB suspenso nem o dispositivo removido; Condutas: "1/3 feitas · próxima: …"; Evolução Tasy: "Hoje ✓". Com tudo aberto, nenhum resumo aparece, exceto a linha de labs.

- [ ] **Step 7: Commit**

```bash
git add painel-core.js index.html styles.css tests/resumo-secao.test.cjs tests/tela.test.cjs
git commit -m "feat(paciente): resumo de uma linha no título de cada seção fechada"
```

---

### Task 7: Campos que quebram linha e status por seletor (spec 3.5)

**Files:**
- Modify: `painel-core.js` (função nova + export)
- Modify: `index.html` (CSS, `renderProblemList`, `renderHppList`, `renderCondutaList`, `taskItemTpl`, `renderScreenC`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: `.chip-nativo` (Task 2).
- Produces: `PainelCore.umaLinha(texto): string`.
- Produces: `growFieldHtml(classes: string, placeholder: string): string` e `bindGrowField(textarea, valor, aoMudar)`.
- Produces: a conduta passa a ter a classe `.conduta-text` no campo de texto.

- [ ] **Step 1: Escrever os testes**

```js
test('umaLinha: quebra de linha vira um espaço', () => {
  assert.strictEqual(PainelCore.umaLinha('Pneumonia\ncomunitária\r\ngrave'), 'Pneumonia comunitária grave');
  assert.strictEqual(PainelCore.umaLinha('a \n\n b'), 'a b');
  assert.strictEqual(PainelCore.umaLinha('sem quebra'), 'sem quebra');
  assert.strictEqual(PainelCore.umaLinha(null), '');
});

test('index.html: campos de lista quebram linha sem inserir quebra; status por seletor', () => {
  assert.ok(html.includes('function growFieldHtml(') && html.includes('function bindGrowField(') && html.includes('PainelCore.umaLinha('));
  ['problem-desc', 'problem-plan', 'hpp-desc', 'conduta-text', 'task-text'].forEach((c) => {
    assert.ok(!new RegExp('<input[^>]*class="[^"]*\\b' + c + '\\b').test(html), c + ' não é mais <input>');
    assert.ok(html.includes(c), c);
  });
  assert.ok(/\.grow-wrap::after\s*\{[^}]*content:\s*attr\(data-espelho\)/.test(html));
  assert.ok(html.includes('problem-status-select') && !html.includes('PROBLEM_STATUS_NEXT'));
});
```

No teste `campo-linha` da Fase 1, a lista de classes passa a ser `['inline-age']`, e entra a asserção `assert.ok(/\.grow-wrap\.campo-linha > textarea/.test(html));`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="umaLinha|campos de lista"`
Expected: 2 falhas.

- [ ] **Step 3: Implementar `umaLinha` e o campo**

`umaLinha`: troca cada sequência de quebras de linha, com os espaços em volta, por um espaço.

O campo cresce por CSS, sem medir altura em `setTimeout`: o texto é espelhado num pseudo-elemento invisível que ocupa a mesma célula da grade e empurra a altura.

```css
.grow-wrap { display: grid; flex: 1; min-width: 0; }
.grow-wrap::after { content: attr(data-espelho) " "; white-space: pre-wrap; visibility: hidden; }
.grow-wrap > textarea { resize: none; overflow: hidden; background: transparent; }
.grow-wrap > textarea, .grow-wrap::after {
  grid-area: 1 / 1 / 2 / 2; font: inherit; padding: 0.625rem 0.5rem; min-height: 44px;
  border: 1px solid transparent; border-radius: 0.375rem; overflow-wrap: anywhere;
}
.grow-wrap.campo-linha > textarea, .grow-wrap.campo-linha::after { padding: 0.25rem 0.5rem; min-height: 0; }
@media (max-width: 640px) { .grow-wrap::after { font-size: 16px; } }
```

A última regra é necessária: no celular o `textarea` é forçado a 16 px, e o espelho precisa da mesma fonte para ter a mesma altura.

- `growFieldHtml(classes, placeholder)` devolve `<div class="grow-wrap"><textarea rows="1" class="…" placeholder="…"></textarea></div>`.
- `bindGrowField(textarea, valor, aoMudar)` escreve o valor no campo e no `data-espelho` do pai. A cada `input`: passa o texto por `PainelCore.umaLinha`, atualiza o espelho e chama `aoMudar(texto)`. Enter: `preventDefault()` e `blur()`.

- [ ] **Step 4: Aplicar nos cinco campos e trocar o status**

| Campo | Onde | Observação |
|---|---|---|
| `.problem-desc` | `renderProblemList` | mantém o riscado quando resolvido |
| `.problem-plan` | `renderProblemList` | o `div` é `grow-wrap campo-linha`; antes dele, um `↳` (`aria-hidden`); vazio, o campo tem borda tracejada (`:placeholder-shown`) |
| `.hpp-desc` | `renderHppList` | |
| `.conduta-text` | `renderCondutaList` | hoje é um `input[type=text]` sem classe; os listeners passam a procurar `.conduta-text` |
| `.task-text` | `taskItemTpl` e `renderScreenC` | |

Status do problema, no lugar do botão que troca em ciclo:

```html
<label class="problem-status chip chip-nativo">
  <span class="problem-status-text">Ativo ▾</span>
  <select class="problem-status-select" aria-label="Status do problema">
    <option value="ativo">Ativo</option><option value="cronico">Crônico</option><option value="resolvido">Resolvido</option>
  </select>
</label>
```

Classe do chip: ativo → `chip-primary`, crônico → `chip`, resolvido → `chip-success`. No `change`: grava `p.status`, `saveData(state)` e `renderScreenB()`. Saem `PROBLEM_STATUS_NEXT` e `PROBLEM_STATUS_STYLE`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 6: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0:aberto --largura=360 --cheia
node tools/captura/capturar.cjs tarefas --largura=360
```
Expected: a descrição longa do primeiro problema aparece inteira, em duas ou três linhas; o plano fica logo abaixo, com o ↳; cada problema tem o chip de status com "▾".

No navegador, confira o item 3 do Review Focus e a rolagem:
1. cole um texto de três linhas na descrição de um problema: vira uma linha só;
2. aperte Enter no campo: o foco sai, nenhuma quebra entra;
3. role até Condutas e troque o status de um problema pelo atalho "Problemas" e de volta: a página não pula ao redesenhar;
4. "Copiar resumo" continua saindo com um problema por item.

- [ ] **Step 7: Commit**

```bash
git add painel-core.js index.html styles.css tests/tela.test.cjs
git commit -m "feat(paciente): campos de lista mostram o texto inteiro; status do problema por seletor"
```

---

### Task 8: Exames: filtros recolhidos, janela padrão e "Editar fixados" (spec 3.7)

**Files:**
- Modify: `painel-core.js` (duas funções + export)
- Modify: `index.html` (`renderLabTab`, `renderLabFlowsheet`, `openPatientDetails`)
- Modify: `tools/captura/abre-tela.js`
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: `somaDias` (Task 5).
- Produces: `PainelCore.janelaLabs(datas: string[], hojeISO)` → `{ inicio, fim, rotulo }`.
- Produces: `PainelCore.rotuloFiltroLabs({ nome, inicio, fim }, padrao): string`.
- Produces: `let pinEditMode = false;`, `#lab-filter-summary-btn`, `#toggle-pin-edit-btn`.

- [ ] **Step 1: Escrever os testes**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="janelaLabs|rotuloFiltroLabs|filtros de labs"`
Expected: 3 falhas.

- [ ] **Step 3: Implementar no core**

`janelaLabs`: ignora datas repetidas. Se alguma coleta cai entre hoje − 7 e hoje, devolve esse intervalo, como o padrão de hoje. Senão, `inicio` é a data da terceira coleta mais recente (ou a mais antiga, se houver menos de três) e `fim` é o maior entre hoje e a coleta mais recente.

- [ ] **Step 4: Implementar no `index.html`**

`renderLabTab`:
- os campos De/Até nascem com `inicio` e `fim` de `janelaLabs` sobre as datas das coletas do paciente;
- o bloco `.lab-filters` nasce com `hidden`. Acima dele, `<button type="button" id="lab-filter-summary-btn">`, com o texto `rotuloFiltroLabs(...) + ' · Filtrar ▸'` (`▾` quando aberto), que abre e fecha o bloco e é reescrito a cada mudança de filtro;
- ao lado de "Faixas de referência", `<button type="button" id="toggle-pin-edit-btn">`, com o texto "Editar fixados" ou "Concluir", que alterna `pinEditMode` e redesenha a tabela.

`renderLabFlowsheet`:
- fora do modo: sem setas de reordenar; as linhas fixadas mostram só um marcador (`<span class="pin-mark">` com o ícone de hoje); as outras, nada;
- no modo: cada linha tem `<button type="button" class="pin-exam-btn min-w-[44px] min-h-[44px] …" data-exam-name="…" aria-pressed="…" aria-label="Fixar <exame>">`, e as fixadas têm as setas ▲▼, como hoje.

O listener delegado de `flowsheetContainer` continua tratando `.pin-exam-btn` e `.pin-move-btn`. `pinEditMode` volta a `false` em `openPatientDetails`, junto de `currentExamTab`.

Em `tools/captura/abre-tela.js`, sufixo `:fixados` em `paciente:N`: abre o paciente com Exames aberto, liga `pinEditMode` e redesenha.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 6: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0:secao=exames --largura=360
node tools/captura/capturar.cjs paciente:0:fixados --largura=360
node tools/captura/capturar.cjs paciente:7:secao=exames --largura=360
```
Expected: na primeira, a linha "Últimos 7 dias · Filtrar ▸" no lugar dos três campos, e a tabela sem setas de reordenar. Na segunda, um alfinete de toque em cada linha e setas nas fixadas. O leito 7 é a internação de 30 dias atrás, com duas coletas antigas: a captura mostra "Últimas 2 coletas · Filtrar ▸" e a tabela com as duas, não a mensagem de "Nenhum resultado".

- [ ] **Step 7: Commit**

```bash
git add painel-core.js index.html styles.css tools/captura tests/tela.test.cjs
git commit -m "feat(exames): filtros recolhidos, tabela nunca vazia por causa do padrão e modo de editar fixados"
```

---

### Task 9: Rodapé com o leito vizinho (spec 3.8)

**Files:**
- Modify: `painel-core.js` (função nova + export)
- Modify: `index.html` (rodapé de `#screen-details`, listeners de `prevPatientBtn` e `nextPatientBtn`, `renderScreenB`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Produces: `PainelCore.vizinhosNaLista(indices: number[], atual: number)` → `{ anterior: number | null, proximo: number | null }`.
- Produces: `updateFooterNav()`.

- [ ] **Step 1: Escrever os testes**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="vizinhosNaLista|leito vizinho"`
Expected: 2 falhas.

- [ ] **Step 3: Implementar**

Core: `vizinhosNaLista`, com os valores dos testes.

Rodapé: cada botão de navegação continua com 56 px e passa a ter duas linhas, a seta em cima e `<span class="nav-label text-[11px] leading-none truncate max-w-full"></span>` embaixo.

`updateFooterNav()`, chamada no fim de `renderScreenB`: calcula os vizinhos; cada botão recebe o número do leito vizinho no `.nav-label` e `disabled` quando o vizinho é `null` (`disabled:opacity-40`). Os dois listeners passam a abrir o vizinho devolvido pela mesma função.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0 --largura=360
node tools/captura/capturar.cjs paciente:7 --largura=360
```
Expected: no leito 0, ‹ com o último leito da lista embaixo e › com "1013-B"; os cinco botões numa linha, sem corte, inclusive com "UTI-12-B". No leito 7 (arquivado), os dois esmaecidos.

A captura abre o paciente sem passar pela lista; se `renderedBedIndexes` estiver vazia nesse caminho, faça `abre-tela.js` chamar `renderScreenA()` antes de abrir o paciente.

- [ ] **Step 6: Commit**

```bash
git add painel-core.js index.html styles.css tools/captura/abre-tela.js tests/tela.test.cjs
git commit -m "feat(paciente): ‹ › mostram o leito vizinho e desabilitam fora da lista"
```

---

### Task 10: Marca de "copiado" e aviso de iniciais (spec 3.9)

**Files:**
- Modify: `painel-core.js` (função nova + export)
- Modify: `index.html` (`renderEvolucaoTasy`, `renderDocBlock`, `renderGeneratedDocsList`)
- Modify: `tools/captura/abre-tela.js`
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: `PainelCore.knownPatientName`.
- Produces: `PainelCore.avisoIniciais(bed, textos: string[]): string` (`''` quando não há o que avisar).
- Produces: `const copiedMarks = new Set();`, só na memória. Chaves: `'ev|<patientId>|<data>|<campo>'` e `'doc|<id do documento>|<índice do bloco>'`.

- [ ] **Step 1: Escrever os testes**

```js
test('avisoIniciais: avisa quando [NOME] vai sair como iniciais', () => {
  const soIniciais = { patientName: 'AB', initialsPlaceholder: 'AB' };
  const msg = 'Este aparelho só tem as iniciais: [NOME] sai como "AB". Digite o nome completo no cartão para copiar com o nome.';
  assert.strictEqual(PainelCore.avisoIniciais(soIniciais, ['Paciente [NOME] evolui bem', '']), msg);
  assert.strictEqual(PainelCore.avisoIniciais(soIniciais, ['sem marcador', '']), '');
  assert.strictEqual(PainelCore.avisoIniciais(soIniciais, null), '');
  assert.strictEqual(PainelCore.avisoIniciais({ patientName: 'Paciente Exemplo Um', initialsPlaceholder: '' }, ['[NOME]']), '');
  assert.strictEqual(PainelCore.avisoIniciais({ patientName: '', initialsPlaceholder: '' }, ['[NOME]']), '', 'leito sem nome');
});

test('index.html: marca de copiado na Evolução Tasy e nos blocos do sumário', () => {
  assert.ok(html.includes('const copiedMarks = new Set();'));
  assert.ok(html.includes('PainelCore.avisoIniciais('));
  assert.ok(html.includes('✓ copiado') && html.includes('evolucao-copy-count'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="avisoIniciais|marca de copiado"`
Expected: 2 falhas.

- [ ] **Step 3: Implementar**

Core: `avisoIniciais`. Há aviso quando o leito tem nome, `knownPatientName(bed)` é vazio e algum texto contém `[NOME]`.

`renderEvolucaoTasy`:
- cópia bem-sucedida de um campo: `copiedMarks.add(chave)`; ao lado do botão fica um `<span class="copiado-mark">✓ copiado</span>`, que persiste depois que o botão volta a "Copiar";
- edição do texto daquele campo: `copiedMarks.delete(chave)` e a marca some;
- na barra, ao lado do seletor de data: `<span class="evolucao-copy-count">`, com "N de M copiados" (M = campos com texto), visível quando N é 1 ou mais;
- no topo, quando `avisoIniciais(bed, <os nove textos da data aberta>)` não é vazio: `<p class="iniciais-aviso chip-warn …">` com a mensagem.

`renderDocBlock(blk, chave)` e `renderGeneratedDocsList`: a mesma marca por bloco, e o mesmo aviso no topo da lista, calculado sobre os `conteudo` dos documentos.

Nada disso é gravado: recarregar o app zera as marcas.

Em `tools/captura/abre-tela.js`, sufixo `:copiado` em `paciente:N`: acrescenta a `copiedMarks` as chaves de `problemas` e `evolucao_atual` da evolução de hoje e abre o paciente com a Evolução Tasy aberta.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam.

- [ ] **Step 5: Regenerar o CSS e conferir**

Run:
```bash
npx tailwindcss@3 -o styles.css --content ./index.html --minify
node tools/captura/capturar.cjs paciente:0:copiado --largura=1280 --cheia
node tools/captura/capturar.cjs paciente:6:secao=evolucao --largura=360 --cheia
```
Expected: no leito 0, dois campos com "✓ copiado" e "2 de N copiados" ao lado da data. No leito 6 (só iniciais), a linha de aviso com `"PES"` no topo da Evolução Tasy.

- [ ] **Step 6: Commit**

```bash
git add painel-core.js index.html styles.css tools/captura/abre-tela.js tests/tela.test.cjs
git commit -m "feat(evolucao): marca de copiado por campo e aviso quando o aparelho só tem as iniciais"
```

---

### Task 11: Arrastar condutas (spec 3.10)

**Files:**
- Modify: `index.html` (`renderCondutaList`, CSS de `.dragging`)
- Test: `tests/tela.test.cjs`

**Interfaces:**
- Consumes: `dragHandleHtml` e `enableListDrag`, que já existem; a ordem das condutas já vai para o banco pela posição (`buildPushPayload` grava `ordem: i`).

- [ ] **Step 1: Escrever a asserção**

```js
test('index.html: condutas têm alça de arrasto, como as outras listas', () => {
  assert.ok(html.includes("enableListDrag(listElement, '.conduta',"));
  assert.ok(/\.conduta\.dragging/.test(html));
  assert.ok(html.includes('data-conduta-id'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-name-pattern="condutas têm alça"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Cada `.conduta` ganha `data-conduta-id` e `dragHandleHtml` na frente do checkbox. `.conduta.dragging` entra na regra de CSS de `.tracker-item.dragging`.

Ao soltar: monta a ordem nova pelos `data-conduta-id` e, se nenhuma conduta ficou de fora, grava `bed.condutas`, chama `saveData(state)` e **`renderScreenB()`**. O redesenho é obrigatório: os listeners de cada conduta guardam o índice (`updateConduta(bedIdx, ci, …)`, `splice(ci, 1)`), e sem ele passariam a editar a conduta errada.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test`
Expected: todos passam, inclusive `tests/condutas-ordem.test.cjs`.

- [ ] **Step 5: Conferir**

Run: `node tools/captura/capturar.cjs paciente:0:secao=condutas --largura=360`
Expected: cada conduta com a alça à esquerda do checkbox.

No navegador: arraste a terceira conduta para o topo, edite o texto dela e marque-a como feita. As três mudanças caem na conduta arrastada, e a ordem fica depois de recarregar.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/tela.test.cjs
git commit -m "feat(condutas): reordenar por arrasto"
```

---

### Task 12: Entrega da Fase 3

**Files:**
- Modify: `sw.js`, `index.html` (`APP_VERSION`)

- [ ] **Step 1: Subir a versão**

`sw.js`: `'caderno-v12'`. `index.html`: `const APP_VERSION = '12';`.

- [ ] **Step 2: Suíte inteira**

Run: `node --test`
Expected: 0 falhas.

- [ ] **Step 3: Capturas finais**

Run, para cada largura em 360, 390 e 1280:
```bash
node tools/captura/capturar.cjs paciente:0:medir --largura=<L> --cheia
node tools/captura/capturar.cjs paciente:0:aberto --largura=<L> --cheia
node tools/captura/capturar.cjs paciente:0:menu --largura=<L>
node tools/captura/capturar.cjs paciente:4 --largura=<L>
node tools/captura/capturar.cjs paciente:7:menu --largura=<L>
node tools/captura/capturar.cjs lista --largura=<L> --cheia
node tools/captura/capturar.cjs tarefas --largura=<L>
```
Expected: nada cortado, sobreposto ou fora da tela. O rodapé cabe numa linha em 360 px. A lista está igual à do fim da Fase 2.

- [ ] **Step 4: Checklist de regressão**

Abra `index.html` no navegador e percorra todos os itens de Paciente do checklist do spec, um a um, num paciente internado e num arquivado. Inclua: arrastar em HPP, Problemas, Controles e Condutas; adicionar, editar e remover um controle de cada tipo; nova coleta, editar e apagar; aba Imagem; "+ Conduta", "+ Nota" e "+ Controle" do rodapé; lembrete; copiar resumo; dar alta, arquivar, restaurar, reinternar e deletar pelo menu ⋯, conferindo o texto de cada confirmação.

- [ ] **Step 5: Registrar as convenções no CLAUDE.md**

Na seção "Desenvolvimento", no estilo das linhas que já estão lá:
- listener de elemento fora dos templates (cabeçalhos, barra de atalhos, folhas, rodapés) é ligado uma vez, na carga, e lê `currentPatientIndex` na hora do toque; nunca dentro de `renderScreenB`;
- campo de texto de lista usa `growFieldHtml`/`bindGrowField` (uma linha lógica, cresce por CSS); não voltar a `<input>` nem a `autoResizeTextarea` nesses campos.

Na linha das regras de tela que moram no core, acrescente as funções desta fase (`acoesDoRegistro`, `chipAdmissao`, `seloControle`, `linhaControle`, `fimPrevistoAtb`, `resumoSecao`, `umaLinha`, `janelaLabs`, `rotuloFiltroLabs`, `vizinhosNaLista`, `avisoIniciais`).

- [ ] **Step 6: Commit**

```bash
git add sw.js index.html CLAUDE.md
git commit -m "chore(sw): cache v12 (fase 3 da revisão de UI)"
```

- [ ] **Step 7: Entregar ao usuário para conferir no aparelho e no computador**

No Galaxy A54: digitar numa anotação e ver que a barra de atalhos some com o teclado aberto e o campo fica visível; tocar nos chips de admissão e de previsão de alta; trocar o status de um problema; arrastar uma conduta; voltar do aparelho com o menu ⋯ do paciente aberto.

No computador: abrir um paciente com evolução de hoje e copiar os nove campos em sequência para o Tasy, conferindo a marca "✓ copiado" na volta e, se o nome estiver só em iniciais, o aviso no topo da seção. Mescla e push só quando ele pedir.
