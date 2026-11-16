# Design: Revisão de UI/UX do Caderno de Visitas (4 fases)

**Data:** 2026-11-16
**Status:** Proposta aprovada em chat (ordem das seções definida pelo usuário); spec aguardando revisão final

## Contexto

Revisão de interface e experiência do app (`index.html`). Para fazer a revisão, o app foi
renderizado em largura de celular (390 px) com dados fictícios: lista, paciente com todas as
seções abertas, tarefas, arquivados e modal de controles.

Diagnóstico geral: o app cobre bem o fluxo clínico (Pendências do dia, faixa de alergia, labs
com faixa de referência e minigráfico, Evolução Tasy com um "Copiar" por campo), mas tudo tem o
mesmo peso visual. São quatro botões de cor forte no topo da lista, cinco ações empilhadas
acima do nome do paciente e doze seções iguais em sequência. Durante a visita, o olho não sabe
onde pousar.

**Objetivo:** mudar peso, lugar e legibilidade dos elementos **sem remover nenhuma
funcionalidade** e sem tocar no sync, no banco ou nas regras de privacidade.

### Restrições (valem para todas as fases)

- Funcionar 100% offline em `file://`: sem ES modules e sem dependências de build. O Tailwind
  continua pré-compilado; classe nova exige
  `npx tailwindcss@3 -o styles.css --content ./index.html --minify`.
- Subir a versão do cache em `sw.js` a cada fase entregue.
- Nada muda em `runSync`, `buildPushDiff`, migrations, `painel_sync_*`, `[NOME]` ou iniciais.
  Os flags `is*Minimized` continuam com os mesmos nomes.
- Regra de tela testável mora em `painel-core.js`, com teste em `tests/` (CLAUDE.md:
  "Regra de tela que dá para testar mora no core"). O `index.html` só desenha.
- `node --test` passa ao fim de cada fase.
- Toda ação destrutiva continua passando por `showConfirm`, com o mesmo texto de hoje.

### Funcionalidades que precisam continuar acessíveis (checklist de regressão)

**Lista:**
- sincronizar
- resetar e receber do servidor
- tarefas
- adicionar leito
- buscar
- ocultar concluídos/vazios/externos
- ordenar (leito, admissão, nome)
- resetar dia
- ver arquivados
- exportar/importar backup
- sair
- pendências (tocar abre o paciente)
- marcar visita
- checks EV/P/EX/TEV
- check de Queda
- abrir paciente

**Arquivados:** reinternar, restaurar, guardar na nuvem, deletar, trazer de volta da nuvem,
abrir paciente.

**Paciente:**
- lembrete
- copiar resumo
- dar alta
- arquivar
- deletar
- editar leito, nome, idade e admissão
- checks e Queda
- médico externo (com "salvar na lista")
- HPP (adicionar, arrastar, remover)
- internações anteriores
- alergias e medicações prévias
- anamnese
- problemas (status, plano, arrastar, remover)
- controles (adicionar, editar, remover, arrastar)
- exames:
  - nova coleta, filtros e faixas de referência
  - fixar e reordenar exames, editar/apagar coleta
  - aba Imagem
- anotações
- condutas (sugestões, salvar na lista, marcar, remover, arrastar)
- Evolução Tasy (data, nova de hoje, copiar por campo)
- texto do prontuário
- documentos gerados (copiar por bloco)
- previsão de alta (com limpar)
- anterior/próximo
- + Conduta, + Nota, + Controle

**Tarefas:** adicionar, marcar, editar, remover.

**Modais:** adicionar leito, reinternar, confirmar, lembrete, controle (4 tipos), exame de
imagem, bloqueio de sync, login.

---

## Fase 1: Defeitos concretos (risco baixo)

Itens isolados, cada um verificável numa captura de 390 px.

### 1.1 Fonte e altura dos campos inline no celular

**Problema.** O bloco `@media (max-width: 640px) { input, select, textarea { font-size: 16px !important } }`
serve para evitar o zoom do iOS. Só que ele também anula `text-2xl` do `.inline-bed` e
`text-lg` do `.inline-name`. Resultado: no celular, "1012-A" sai do tamanho do texto comum.

A regra global de `min-height: 48px` + `padding 0.75rem` em `input[type=text|date|number]`
tem efeito parecido: deixa Idade e Admissão (`.inline-age`, `.inline-admit`) em linhas altas e
espaçadas.

**Correção.**
- O `font-size: 16px !important` passa a ser um **mínimo**, não um valor fixo. Os campos
  `.inline-bed` e `.inline-name` ganham regra própria dentro do mesmo media query:
  - `.inline-bed`: 1.5rem
  - `.inline-name`: 1.125rem
- `min-height` e o padding vertical extra saem dos campos `.inline-*` (que parecem texto).
  Os campos de formulário com borda continuam com eles.

**Verificação:** na captura, o leito aparece maior que o nome, e Idade + Admissão ficam na
mesma linha.

### 1.2 Rótulos dos checks diários

**Problema.** `checkDotsHtml` mostra só a primeira letra da chave. EV e EX viram ambos "E", e
o significado só existe no `title`, que não aparece no toque.

**Correção.**
- Exibir a sigla inteira da chave: **EV · P · EX · TEV**. A Queda continua "Q" quando
  pendente.
- Quando o check está marcado, mostrar o ✓ **com** a sigla pequena embaixo, para o rótulo não
  sumir.
- Cada check vira `<button type="button">` com `aria-pressed` e `aria-label` (sigla). A Queda
  ganha o mesmo tratamento.
- Área de toque mínima de 44×44 px (hoje é `w-9 h-9` = 36 px), com espaço entre os checks de
  pelo menos 8 px.

**Verificação:** nenhum par de checks tem rótulo igual; tocar com o dedo não marca o vizinho.

### 1.3 Ordem das colunas de labs

**Problema.** Em `renderLabFlowsheet`, `filteredDates` vem em ordem crescente. No celular, a
coleta de hoje fica fora da tela, à direita.

**Correção.**
- Datas em ordem **decrescente**: a mais recente na primeira coluna, logo após o nome do
  exame.
- O minigráfico continua cronológico; ele é calculado à parte.
- A ordenação é uma função pequena no core, com teste.

**Verificação:** com 3 coletas, a de hoje aparece sem rolar.

### 1.4 Remover tarefa no toque

**Problema.** `.remove-task` usa `opacity-0 group-hover:opacity-100` e fica invisível no
celular.

**Correção.** Usar o mesmo padrão de Condutas e Problemas: `opacity-60 sm:opacity-0
group-hover:opacity-100`, com área de toque de 40 px.

### 1.5 Sair dos Arquivados

**Problema.** Ao entrar em Arquivados, só o subtítulo muda. A saída ("Ver Leitos Ativos") fica
dentro do painel de filtros.

**Correção.**
- Seletor segmentado **Ativos | Arquivados** sempre visível, logo abaixo da busca. Ele
  controla `isViewingArchived`.
- O botão `viewArchiveBtn` sai do painel de filtros.
- Atualizar `adjustListPadding` para a nova altura do cabeçalho.

### 1.6 Rodapé do paciente sem quebra

**Problema.** Em 390 px, "+ Conduta", "+ Nota" e "+ Controle" quebram em duas linhas.

**Correção.** Os três botões viram ícone em cima e rótulo curto embaixo (Conduta, Nota,
Controle), em `text-xs`, sem o "+". Altura fixa e uma linha só. Os botões ‹ › continuam
(ganham rótulo na Fase 3).

### 1.7 Editar/apagar coleta de lab

**Problema.** Os ícones de editar e apagar coleta têm 12 px (`w-3 h-3`) e ficam colados no
cabeçalho da coluna.

**Correção.**
- O cabeçalho da data vira um `<button>` que abre um menu pequeno com **Editar coleta** e
  **Apagar coleta**.
- O menu tem área de toque de 44 px por item. Apagar continua passando por `showConfirm`.

### Entrega da Fase 1

- Testes novos no core: ordem decrescente das datas (1.3). Os rótulos dos checks (1.2) entram
  como lista exportada, por exemplo `DAILY_CHECKS = [{key:'ev', label:'EV'}, ...]`, testada em
  `tests/tela.test.cjs`.
- Regenerar o CSS e subir o `sw.js`.

---

## Fase 2: Tela inicial (lista de leitos)

### 2.1 Cabeçalho

Hoje são 4 botões só de ícone, com a mesma cor forte. "Resetar e receber", que é destrutivo,
fica colado ao Sincronizar, e o ícone de Tarefas parece uma janela.

Novo cabeçalho:

```
Caderno                         [⟳ Sincronizado 09:22]  [⋯]
2 de 4 visitados · 1 externo · 1 vazio
[▓▓▓▓▓░░░░░░░░░░]
[🔍 Buscar...                              ] [Filtros]
[ Ativos | Arquivados ]             [Tarefas 2]
```

- **Sincronizar** passa a ser um botão com texto e estado. Ele substitui o `#syncDirtyDot` e
  absorve o `#syncStatus`:
  - **Sincronizado hh:mm**: neutro, contorno.
  - **Alterações não enviadas**: âmbar. Usa a mesma condição de `updateSyncBadge`.
  - **Erro: …**: vermelho. O texto vem de `setSyncStatus(msg, true)`; o detalhe longo fica
    num toque.
  - Não há contagem de alterações: o estado local não tem esse número, e não vamos criá-lo.
- **Menu ⋯** (folha que sobe de baixo no celular, popover no desktop):
  - Resetar dia
  - Exportar backup
  - Importar backup
  - **Resetar e receber do servidor** (em vermelho, separado por uma linha)
  - Sair
  - Rodapé com a versão do app (a "v11" sai do título)
- **Filtros** fica só com filtro e ordenação: "Ocultar concluídos, vazios e externos" e
  Ordenar por (Leito, Admissão, Nome).
- **Tarefas** vira um chip "Tarefas N", com o número de tarefas não concluídas. Com zero, o
  número some e fica só "Tarefas". O chip abre a Tela C.
- **+ Leito** vira um botão flutuante (FAB) no canto inferior direito. A lista ganha padding
  inferior para o FAB não cobrir o último cartão.

### 2.2 Contador do dia

Hoje é "T: 6 | V: 2 | P: 2 | E: 1". Passa a ser a frase + barra do esboço acima. Os números
vêm de uma função nova no core, `progressoDoDia(state)` → `{ total, ocupados, visitados,
pendentes, externos, vazios }`, com a mesma regra de hoje (externo não conta como visitado nem
pendente). Ela tem teste.

### 2.3 Pendências do dia

Hoje, com 9 itens, o painel ocupa a primeira tela e empurra os leitos. A cor segue a
*categoria*, então "Alta prevista atrasada" aparece com bolinha verde.

- `buildPendencias` ganha dois campos por item, sem mudar os existentes:
  - `gravidade`: `'alerta' | 'atencao' | 'info'`
    - alerta: ATB com prazo vencido, alta prevista atrasada
    - atenção: ATB no último dia, cultura sem resultado, dispositivo ≥ 7 dias, lembrete
    - info: alta prevista hoje
  - `curto`: rótulo para selo. Exemplos: "ATB D8/7", "Cultura D5", "CVC D9", "Alta hoje",
    "Lembrete".
- Uma função nova no core, `agruparPendencias(pend)`, devolve
  `[{ bedIndex, bedNumber, gravidadeMax, itens }]`. Ela tem testes em
  `tests/pendencias.test.cjs`.
- O painel mostra **uma linha por leito**: "1014-B · ATB D8/7 · Alta atrasada · Lembrete".
  A cor da bolinha é a da gravidade máxima (vermelho/âmbar/azul). O título fica
  "Pendências (3 leitos, 9 itens)". O recolhimento continua em `state.isPendenciasMinimized`.

### 2.4 Cartão do leito

- **Linha 1:** visita (círculo), leito, sino (se houver lembrete), chip do médico externo,
  e "D10" à direita.
- **Linha 2:** nome, com a largura inteira (hoje é truncado pelo selo de alta).
- **Linha 3:** selos à esquerda (alta prevista e até 2 pendências `curto` do leito, +N se
  houver mais), checks à direita.
- **Lembrete:** sai o fundo azul (`.reminder-list-active`), fica só o sino.
- **Leito vazio:** cartão compacto de uma linha, "1021 · Vazio — toque para admitir". Não
  mostra os checks.
- **Estados distintos.** Hoje concluído, vazio e externo recebem o mesmo `opacity-60`:
  - Concluído: check verde, texto normal, fundo levemente esverdeado. Sem opacidade.
  - Externo: chip do médico; os checks ficam escondidos, como já não contam.
  - Vazio: o cartão compacto acima.
- O círculo de visita passa de 40 para 44 px. Os checks seguem a Fase 1.2.

### Entrega da Fase 2

- Testes de `progressoDoDia`, `agruparPendencias` e dos novos campos de `buildPendencias`.
- Regenerar o CSS, subir o `sw.js`, revisar `adjustListPadding`.
- Conferir o checklist da lista e dos arquivados.

---

## Fase 3: Tela do paciente

### 3.1 Cabeçalho do paciente

Hoje 5 ações quebram em duas linhas acima do nome, e Deletar (vermelho) fica ao lado de
Arquivar.

- **Cabeçalho fixo:** ‹ Voltar | leito + nome | **⋯**.
- O menu **⋯** do cabeçalho fixo tem:
  - Dar alta
  - Arquivar
  - **Deletar** (vermelho, separado por uma linha)
- **Cartão de identificação:**
  - Leito (grande) e nome editáveis, como hoje.
  - Linha de dados: **78a · Adm 07/11 (D10) · Alta prev. 16/11 ✕**. Cada pedaço continua
    editável no toque (`input` de idade, data de admissão e data de previsão). O ✕ é o
    "Limpar" da previsão.
  - A seção solta "Previsão de Alta" do fim da página deixa de existir: o campo mora aqui.
  - Ações: **Copiar resumo** (botão principal) e o sino.
  - Checks (Fase 1.2).
  - **Médico externo** recolhido numa linha "Médico externo: — ▸", que expande para o campo
    atual. Quando preenchido, mostra o nome.
- **Ícone de "salvar na lista"** (médico externo e condutas): hoje é um gráfico de barras.
  Troca por estrela/marcador, com `aria-label` "Salvar na lista de sugestões".
- A faixa de alergia continua no topo, como hoje.

### 3.2 Ordem das seções (definida pelo usuário)

1. **Problemas**
2. **HPP**
3. **Alergias e Medicações Prévias**
4. **Anamnese Inicial**
5. **Internações anteriores** (só quando existem, como hoje)
6. **Controles e Invasivos**
7. **Exames (Labs e Imagem)**
8. **Condutas**
9. **Anotações / Sinais / Exames**
10. **Evolução Tasy**
11. **Texto do Prontuário**
12. **Documentos Gerados**

Cada seção continua independente, com o próprio flag `is*Minimized`. O `setupCollapsibleSection`
localiza a seção pelo seletor do conteúdo, não pela posição, então reordenar o template não
muda a ligação.

### 3.3 Barra de atalhos

Uma faixa fixa abaixo do cabeçalho, com rolagem horizontal:

**Problemas · Histórico · Controles · Exames · Condutas · Evolução · Docs**

- "Histórico" aponta para HPP.
- "Condutas" aponta para Condutas; Anotações vem logo abaixo.
- "Docs" aponta para Texto do Prontuário.
- Tocar no chip abre a seção, se estiver fechada (persistindo o flag como o toque no título
  já faz), e rola até ela, descontando a altura do cabeçalho + barra.
- O chip da seção visível fica destacado (IntersectionObserver; sem ele, sem destaque).

### 3.4 Resumo nas seções fechadas

Estende o padrão que já existe em Exames (`buildLabsLine` → `.labs-last-line`). Cada título
mostra uma linha de resumo, calculada por uma função do core,
`resumoSecao(bed, secao, hojeISO)`, com testes:

| Seção | Resumo |
|---|---|
| Problemas | "2 ativos · 1 crônico" (resolvidos não contam) |
| HPP | "HAS · DM2 · DRC G3b" (truncado) |
| Alergias e Medicações | "Dipirona" ou "Nenhuma registrada" + "2 medicações" |
| Anamnese | primeiros ~60 caracteres |
| Controles | itens ativos com selo, com prioridade aos que alertam: "Pip-Tazo D6/7 ⚠ · CVC D9 ⚠" |
| Exames | (já existe) |
| Condutas | "1/3 feitas" |
| Anotações | primeira linha não vazia |
| Evolução Tasy | "Hoje ✓" ou "Última: 14/11" |
| Texto do Prontuário | "2 textos · último 16/11" |
| Documentos | "Sumário de alta 16/11" (o mais recente) |

O resumo aparece também com a seção aberta, em cinza claro, como a linha de labs hoje.

### 3.5 Problemas

- A descrição passa de `input` de uma linha para `textarea` que cresce com o texto
  (`autoResizeTextarea`). Hoje o texto é cortado ("Pneumonia comunitária g").
- O "Plano" ganha um indicador visual de campo editável: borda tracejada leve quando vazio, e
  o ícone ↳ à esquerda.
- O chip de status ganha um "▾". O toque abre um menu com **Ativo / Crônico / Resolvido** no
  lugar do ciclo cego (`PROBLEM_STATUS_NEXT` deixa de ser usado no toque; o valor gravado é o
  mesmo).

### 3.6 Controles

Cada item passa a ter duas linhas, com uma barra lateral de 3 px na cor do tipo (as mesmas do
modal: ATB sky, Cultura amber, Dispositivo slate, Procedimento violet):

```
▍Piperacilina-tazobactam              [D7/7 último dia]
▍ATB · D1 12/11 · fim previsto 18/11            ✎  ✕
```

- O selo vem de `atbBadge` e das regras atuais, sem mudança de cálculo.
- O rótulo do tipo ("ATB:", "Cultura:", "Disp:", "Proc:") desce para a segunda linha.

### 3.7 Exames

- Os filtros De/Até/Nome recolhem numa linha **"Últimos 7 dias · Filtrar ▸"**. O padrão de 7
  dias continua.
- As setas ▲▼ de reordenar fixados só aparecem num modo **"Editar fixados"**, ligado por um
  botão ao lado de "Faixas de referência".
- "+ Adicionar Nova Coleta" continua no topo.

### 3.8 Rodapé

- ‹ › ganham o leito vizinho: "‹ 1030-C" e "1014-B ›", seguindo a ordem atual da lista
  (`renderedBedIndexes`).
- Sem vizinho, o botão fica desabilitado.

### Entrega da Fase 3

- Testes de `resumoSecao` (cada linha da tabela 3.4).
- Regenerar o CSS, subir o `sw.js`.
- Conferir o checklist do paciente, inclusive arrastar em HPP, Problemas, Controles e
  Condutas depois do reordenamento.

---

## Fase 4: Sistema visual e acessibilidade

### 4.1 Cores com significado fixo

Hoje o âmbar significa ao mesmo tempo resetar, pendente, cultura, dar alta e queda pendente.

| Papel | Uso | Base |
|---|---|---|
| primária | ação principal, links, foco | sky-600 |
| sucesso | feito, visitado, sincronizado | green-600 |
| atenção | precisa olhar hoje | amber-500/700 |
| perigo | vencido, atrasado, apagar, alergia, lab alto | red-600 |
| neutra | todo o resto | slate |
| categorias | **só** tipos de controle e chip de médico externo | sky/amber/slate/violet |

- Índigo (sync, nuvem) e roxo (tarefas, externos) deixam de ser cores de botão.
- "Dar alta" deixa de ser âmbar: ação neutra no menu.
- O lab baixo continua azul (é convenção da tabela), documentado como exceção.

### 4.2 Tokens e classes de componente

- Variáveis CSS em `:root` no `<style>` do `index.html`: `--c-primary`, `--c-success`,
  `--c-warn`, `--c-danger`, `--c-surface`, `--c-surface-2`, `--c-border`, `--c-text`,
  `--c-text-muted`.
- Classes curtas no mesmo `<style>`: `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`,
  `.chip`, `.chip-warn`, `.chip-danger`, `.card`, `.field`.
- A troca é progressiva: as telas mexidas nas fases 2 e 3 já nascem com essas classes; o resto
  migra nesta fase.
- **Sombras:** `shadow-lg` sai de todos os cartões. Fica `.card` = borda `--c-border` +
  sombra leve (`0 1px 2px`). A hierarquia passa a vir da tipografia.

### 4.3 Acessibilidade

- **Rótulos:** todo botão só de ícone tem `aria-label`, não só `title`.
- **Contraste:**
  - Texto ≥ 4,5:1.
  - Os checks vazios (hoje slate-400 sobre slate-100, ≈ 2,5:1) passam para slate-600 sobre
    slate-100.
  - Nenhum cartão usa `opacity` para indicar estado.
- **Toque:** alvos ≥ 44 px nos controles de uso frequente (checks, visita, ✕ de listas, menus).
- **Foco:** anel de foco visível (`focus-visible`) em botões e chips.
- **Movimento:** com `prefers-reduced-motion`, sem as transições de seção e de toggle.

### 4.4 Modo escuro (opcional dentro da fase)

- Redefine os tokens sob `@media (prefers-color-scheme: dark)` e sob `[data-theme="dark"]`.
- Escolha **Automático / Claro / Escuro** no menu ⋯, gravada em `wardBookPrefs_v1` (preferência
  local, fora do estado sincronizável).
- As cores dos labs (alto/baixo), a faixa de alergia e os selos de gravidade precisam ser
  conferidos nos dois temas.
- Se ficar grande demais, sai desta fase sem afetar o resto.

### Entrega da Fase 4

- Regenerar o CSS, subir o `sw.js`.
- Capturas de todas as telas e modais em claro (e escuro, se feito).
- Conferir o checklist inteiro.

---

## Verificação visual (todas as fases)

Captura em largura de celular com dados fictícios, sem tocar no projeto:

1. Copiar `index.html`, `painel-core.js`, `styles.css` e `icon.svg` para uma pasta temporária.
2. Injetar antes do `painel-core.js` um script que grava um estado fictício em
   `localStorage['wardBookData_v16']` e uma chave `sb-x-auth-token` (libera o portão offline).
   Injetar no fim um script que abre a tela pedida pelo `#hash`.
3. Envolver em `<iframe style="width:390px">`: o Edge/Chrome headless tem largura mínima de
   janela maior que 390.
4. Rodar
   `msedge --headless=new --window-size=600,860 --screenshot=out.png file:///…/wrapper.html`.

Nomes de paciente nos dados de teste são sempre fictícios ("Paciente Exemplo Um").

## Fora de escopo

- Mudanças no sync, no schema, nos fluxos da IA ou nos templates de documento.
- Funcionalidades novas (ex.: "copiar evolução inteira"). Se surgirem durante a
  implementação, vão para um spec próprio.
