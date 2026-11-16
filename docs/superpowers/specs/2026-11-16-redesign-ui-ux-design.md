# Design: Revisão de UI/UX do Caderno de Visitas (4 fases)

**Data:** 2026-11-16
**Status:** Proposta aprovada em chat (ordem das seções definida pelo usuário). Passou por uma
segunda revisão, conferida contra `index.html` e `painel-core.js`: o que mudou está em
"Registro da revisão", no fim. O usuário respondeu aos três pontos em aberto e pediu o plano
de implementação (`docs/superpowers/plans/2026-11-16-ui-ux-fase-*.md`).

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
  "Regra de tela que dá para testar mora no core"). O `index.html` só desenha. Função do core
  que depende de data recebe a data local já pronta (`hojeISO`), como `dayNumber` — nada de
  `Date` com fuso dentro do core.
- `node --test` passa ao fim de cada fase.
- Toda ação destrutiva que hoje passa por `showConfirm` continua passando, com o mesmo texto.
  Duas ações ganham confirmação que hoje não têm: remover tarefa (1.4) e Sair (2.1).
- **Elemento que muda de lugar leva o `id` e o listener junto.** Os handlers atuais procuram
  os botões por `id` (`syncBtn`, `resetLocalBtn`, `logoutBtn`, `exportDataBtn`,
  `importDataInput`, `resetChecksBtn`...). Mover o mesmo elemento para o novo lugar é mais
  seguro que reescrever o handler. O teste de 1.0 guarda essa regra.
- **O que fica fora do template do paciente liga o listener uma vez só**, na carga, e lê
  `currentPatientIndex` na hora do toque. `renderScreenB` roda a cada edição; ligar listener
  ali num elemento fixo (cabeçalho, barra de atalhos, folha de ações) acumula um listener por
  redesenho.
- **Componente novo já nasce acessível:** `<button>` de verdade, `aria-label` quando só tem
  ícone, anel de foco, alvo de toque de 44 px. A Fase 4 varre só o que as outras não tocaram.
- Elemento novo fixo ou flutuante leva `print:hidden`, como os botões de hoje.
- **Larguras de conferência:** 360 e 390 px (celular) e 1280 px (computador). O layout não pode
  depender de sobra de largura que só existe em 390; os orçamentos estão em cada item.

### Funcionalidades que precisam continuar acessíveis (checklist de regressão)

**Lista:**
- sincronizar
- resetar e receber do servidor
- tarefas
- adicionar leito
- buscar (por leito, nome, problema e HPP)
- ocultar concluídos/vazios/externos
- ordenar (leito, admissão, nome)
- resetar dia
- ver arquivados
- exportar/importar backup
- sair
- pendências (recolher; tocar abre o paciente)
- marcar visita
- checks EV/P/EX/TEV
- check de Queda
- sino de lembrete, chip do médico externo e selo de alta prevista no cartão
- abrir paciente
- mensagens de estado (sync, nuvem, falha ao salvar, dados ilegíveis com "Baixar cópia")
- voltar do aparelho volta para a lista, na mesma posição de rolagem

**Arquivados:** reinternar, restaurar, guardar na nuvem, deletar, trazer de volta da nuvem,
abrir paciente, buscar, uma linha por pessoa ("2ª internação"), bloco "Na nuvem".

**Paciente:**
- lembrete
- copiar resumo
- dar alta
- arquivar
- deletar
- editar leito, nome, idade e admissão
- checks e Queda
- médico externo (com "salvar na lista")
- faixa de alergia e faixa de internação anterior
- HPP (adicionar, editar, arrastar, remover)
- internações anteriores
- alergias e medicações prévias
- anamnese
- problemas (status, plano, arrastar, remover)
- controles (adicionar, editar, remover, arrastar)
- exames:
  - nova coleta, filtros e faixas de referência
  - fixar e reordenar exames, editar/apagar coleta
  - tendência (▲▼) e minigráfico dos fixados
  - aba Imagem
- anotações
- condutas (sugestões, salvar na lista, marcar, editar, remover)
- Evolução Tasy (data, nova de hoje, editar, copiar por campo)
- texto do prontuário (salvar com tipo e data, remover)
- documentos gerados (copiar por bloco; copiar inteiro nos sem blocos)
- previsão de alta (com limpar)
- anterior/próximo
- + Conduta, + Nota, + Controle

**Tarefas:** adicionar, marcar, editar, remover.

**Modais:** adicionar leito, reinternar, confirmar, lembrete, controle (4 tipos), exame de
imagem, bloqueio de sync, login.

---

## Fase 1: Defeitos concretos (risco baixo)

Itens isolados, cada um verificável numa captura.

### 1.0 Rede de segurança antes de mexer no HTML

**Problema.** O script liga os eventos com `document.getElementById('x').addEventListener(...)`
e, dentro de `renderScreenB`, com `art.querySelector('.y').addEventListener(...)`. Se um
elemento sai do HTML e a linha que o usa fica, o script para ali: na carga, o app abre em
branco; na Tela B, o paciente não abre. As quatro fases mudam elementos de lugar (1.5 tira o
`viewArchiveBtn` dos filtros, 2.1 esvazia o painel de ações, 3.1 remove a seção "Previsão de
Alta").

**Correção.** `tests/html-refs.test.cjs` lê o `index.html` como texto e confere que:
- todo `getElementById('…')` do script tem um `id="…"` no HTML;
- toda classe procurada por `querySelector`/`querySelectorAll`/`setupCollapsibleSection`
  aparece em algum `class="…"` do arquivo.

O teste não abre navegador: é só texto, no padrão dos outros (`node --test`).

### 1.1 Fonte e altura dos campos inline no celular

**Problema.** São duas regras diferentes, com alcances diferentes:

- `@media (max-width: 640px) { input, select, textarea { font-size: 16px !important } }` evita
  o zoom do iOS, mas anula `text-2xl` do `.inline-bed` e `text-lg` do `.inline-name`. No
  celular, "1012-A" sai do tamanho do texto comum.
- `input[type="text"], input[type="date"], input[type="number"], textarea` recebe
  `min-height: 48px` + padding de 0.75rem. Ela pega `.inline-age` e `.inline-admit` (linhas
  altas e espaçadas) e também os campos de lista que parecem texto: `.problem-desc`,
  `.problem-plan`, `.hpp-desc`, o texto da conduta e `.task-text`. Cada problema ocupa duas
  linhas de 48 px, uma para a descrição e outra para o plano. `.inline-bed` e `.inline-name`
  não têm o atributo `type`, então esta regra não os alcança.

**Correção.**
- Dentro do mesmo media query, depois da regra geral:
  `.inline-bed { font-size: 1.5rem !important }` e
  `.inline-name { font-size: 1.125rem !important }`. O `!important` é necessário, e a classe
  vence o seletor de elemento. Os 16 px continuam valendo como piso para todo o resto.
- Classe `.campo-linha` para campo secundário que parece texto: sem `min-height`, padding
  vertical de 0.25rem. Vai em `.inline-age`, `.inline-admit` e `.problem-plan`. O campo
  principal de cada item (descrição do problema, item do HPP, conduta, tarefa) mantém a altura
  de toque.

**Verificação:** o leito aparece maior que o nome; Idade + Admissão ficam na mesma linha; o
plano do problema fica colado à descrição, sem a segunda faixa de 48 px.

### 1.2 Rótulos dos checks diários

**Problema.** `checkDotsHtml` mostra só a primeira letra da chave. EV e EX viram ambos "E", e
o significado só existe no `title`, que não aparece no toque. O ✓ branco sobre `sky-500` tem
contraste 2,8:1, abaixo do mínimo de 3:1 para ícone.

**Correção.**
- Exibir a sigla inteira da chave: **EV · P · EX · TEV**. A Queda continua "Q" quando
  pendente.
- Marcado: ✓ de 14 px com a sigla em 10 px embaixo, sobre `sky-700` (5,9:1). O rótulo não
  some.
- Cada check vira `<button type="button">` com `aria-pressed` e `aria-label` com o nome por
  extenso: Evolução, Prescrição, Exames, Profilaxia de TEV. A Queda ganha o mesmo tratamento.
- **Tamanho:** caixa de 40 px com 4 px de respiro, ou seja, um alvo de 44 px por check, sem
  sobreposição (hoje: caixa de 36 px, passo de 42 px). Os cinco checks ocupam 216 px. Caixas
  de 44 px com 8 px de respiro somariam 252 px e não deixariam lugar para os selos do cartão
  em 360 px (ver 2.4).
- A lista sai do core: `DAILY_CHECKS = [{ key: 'ev', label: 'EV', nome: '…' }, ...]`.

**Verificação:** nenhum par de checks tem rótulo igual; tocar com o dedo não marca o vizinho;
os cinco cabem numa linha em 360 px.

### 1.3 Ordem das colunas de labs

**Problema.** Em `renderLabFlowsheet`, `filteredDates` vem em ordem crescente. No celular, a
coleta de hoje fica fora da tela, à direita.

**Correção.**
- Colunas em ordem **decrescente**: a mais recente na primeira coluna, logo após o nome do
  exame.
- **A tendência e o minigráfico dependem da ordem das datas.** Hoje os dois são calculados
  percorrendo `filteredDates` (`rawValues`, `nums`, `prevNum`). Inverter a lista sem mais nada
  faria a seta comparar cada valor com a coleta *seguinte* e desenharia o gráfico de trás para
  frente. Então: todo o cálculo continua em ordem cronológica, e só o desenho das colunas usa
  a lista invertida.
- No core, com teste: `tendenciasLab(numsCronologicos)` devolve uma seta por coleta
  (`''`, `'▲'`, `'▼'`), comparando com a coleta anterior que tinha número. Um "—" no meio não
  quebra a comparação, como hoje.

**Verificação:** com 3 coletas, a de hoje aparece sem rolar; a seta da coluna mais recente
compara com a coleta anterior; o minigráfico continua do mais antigo para o mais novo.

### 1.4 Remover tarefa no toque

**Problema.** `.remove-task` usa `opacity-0 group-hover:opacity-100` e fica invisível no
celular. A remoção é imediata, sem confirmação.

**Correção.**
- Botão sempre visível onde não existe hover, com área de toque de 44 px.
- Passa por `showConfirm('Remover "<tarefa>"?')`, como condutas e problemas. Com o botão à
  vista ao lado do texto, um toque errado apagaria a tarefa.
- **Padrão para esconder botão até o hover:** `[@media(hover:hover)]:opacity-0
  group-hover:opacity-100 focus-visible:opacity-100`, com `opacity-60` de base. O padrão de
  hoje (`sm:opacity-0`) decide pela largura da tela: num tablet, que é largo e não tem hover,
  os botões de editar e remover ficam invisíveis. Trocar em Condutas, Problemas, HPP,
  Controles e Imagem na Fase 4.

### 1.5 Sair dos Arquivados

**Problema.** Ao entrar em Arquivados, só o subtítulo muda. A saída ("Ver Leitos Ativos") fica
dentro do painel de filtros.

**Correção.**
- Seletor segmentado **Ativos | Arquivados** sempre visível, logo abaixo da busca. Ele
  controla `isViewingArchived`.
- O botão `viewArchiveBtn` sai do painel de filtros (o listener atual vira o do seletor).
- "Adicionar leito" some em Arquivados.
- `adjustListPadding` já mede a altura real do cabeçalho (`offsetHeight` + `ResizeObserver`):
  não há número para atualizar, só conferir na captura que o primeiro cartão não fica coberto.

### 1.6 Rodapé do paciente sem quebra

**Problema.** Em 390 px, "+ Conduta", "+ Nota" e "+ Controle" quebram em duas linhas.

**Correção.** Os três botões viram ícone em cima e rótulo curto embaixo (Conduta, Nota,
Controle), em `text-xs`, sem o "+". Altura fixa e uma linha só. Os botões ‹ › continuam
(ganham rótulo na Fase 3; o orçamento de largura do rodapé está em 3.8).

### 1.7 Editar/apagar coleta de lab

**Problema.** Os ícones de editar e apagar coleta têm 12 px (`w-3 h-3`) e ficam colados no
cabeçalho da coluna.

**Correção.**
- O cabeçalho da data inteiro vira um `<button>` (data + lápis de 14 px, 44 px de altura) que
  abre o formulário de coleta em modo edição, como o lápis faz hoje.
- **Apagar coleta** passa a ser um botão vermelho dentro do formulário, visível só no modo
  edição. Continua passando por `showConfirm`, com o mesmo texto.
- Não há menu: a tabela rola na horizontal (`overflow-x-auto`) e cortaria um menu aberto
  dentro dela. Editar fica a um toque; apagar fica um passo mais fundo, que é o lugar certo
  para a ação destrutiva.

### 1.8 A seção HPP não lembra se estava fechada

**Problema.** `setupCollapsibleSection` usa o flag `isHppMinimized`, mas `migrateBed` não o
copia. O flag vale até o app ser recarregado; na abertura seguinte o HPP volta aberto em todos
os pacientes. Com o resumo nas seções fechadas (3.4), a diferença fica visível.

**Correção.** `migrateBed` passa a carregar `isHppMinimized` (padrão: aberto, como hoje), com
teste em `tests/migrate.test.cjs`.

### Entrega da Fase 1

- Testes novos: `html-refs` (1.0), `DAILY_CHECKS` (1.2) e `tendenciasLab` (1.3) em
  `tests/tela.test.cjs`, `isHppMinimized` (1.8).
- Regenerar o CSS e subir o `sw.js`.

---

## Fase 2: Tela inicial (lista de leitos)

### 2.0 Fundamentos (antes de mexer na lista)

Três peças que as fases 2 e 3 usam. Elas precisam existir antes das telas que as usam.

**Tokens e classes de componente.** As variáveis CSS e as classes `.btn`, `.chip`, `.card` e
`.field` descritas em 4.2 são criadas aqui, com as cores de 4.1. As telas mexidas nas fases 2
e 3 já nascem com elas; a Fase 4 migra o resto.

**Aviso global.** Hoje as mensagens saem em `#syncStatus`, uma linha dentro do cabeçalho da
lista. Ela não existe na tela do paciente: se o aparelho ficar sem espaço enquanto o médico
digita uma evolução, "Não foi possível salvar neste aparelho" é escrito num lugar que ele não
está vendo.
- `avisar(msg, { tom, fixo })`: faixa fixa logo abaixo do cabeçalho, visível nas três telas.
  `role="status"` (`role="alert"` em erro).
- Mensagem comum some em 4 s. Erro fica até o toque no ✕ ou até a próxima operação dar certo.
  Falha ao salvar e "dados ilegíveis" ficam fixos enquanto durar o problema.
- `setSyncStatus(msg, isError)` mantém a assinatura e passa a chamar `avisar`. Nenhuma das
  chamadas de hoje precisa mudar.

**Folha de ações.** Um componente só, usado pelo ⋯ da lista (2.1) e pelo ⋯ do paciente (3.1).
- Sobe de baixo no celular; em tela larga, o mesmo painel aparece centrado, como os modais de
  hoje. Não há popover ancorado.
- Itens de 48 px, ação destrutiva em vermelho depois de uma linha separadora, "Cancelar" no
  fim.
- `role="dialog"`, `aria-modal`, foco no primeiro item ao abrir e de volta ao ⋯ ao fechar.
  Fecha com toque fora e com Esc.
- **Voltar do aparelho com a folha aberta fecha a folha e fica na tela.** Hoje o `popstate`
  só troca de tela: com um modal aberto, o voltar leva para a lista e o modal fica por cima
  dela. A folha ganha uma entrada própria no histórico, então o voltar só a fecha. Os modais
  não ganham entrada (vários se reabrem dentro do próprio fechamento, na validação): o voltar
  fecha o modal aberto e troca de tela como hoje.
- Fica abaixo do `#syncOverlay` e respeita a área segura inferior (ver 4.3).

### 2.1 Cabeçalho

Hoje são 4 botões só de ícone, com a mesma cor forte. "Resetar e receber", que é destrutivo,
fica colado ao Sincronizar, e o ícone de Tarefas parece uma janela.

Novo cabeçalho, em três linhas fixas:

```
2 de 4 visitados                  [⟳ Sincronizar ]  [⋯]
1 externo · 1 vazio               [ hoje 09:22 ✓ ]
[🔍 Buscar leito, nome ou diagnóstico      ] [Filtros]
[ Ativos | Arquivados ]            [Tarefas 2]  [＋]
▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

- **A frase do progresso é o título.** O nome "Caderno" e o "v11" saem do cabeçalho (o nome
  continua no ícone, na tela de login e no rodapé do menu ⋯). A barra é uma faixa de 3 px na
  base do cabeçalho, sem linha própria. Em Arquivados: "Arquivados" / "12 pacientes · 3 na
  nuvem", sem barra.
- **Orçamento de altura:** até 170 px com os filtros fechados. O cabeçalho é fixo; cada linha
  a mais sai da área dos leitos. Medir antes e depois na captura de 390 × 667.
- **Orçamento de largura em 360 px** (336 px úteis): linha 1 = 148 (frase) + 128 (Sincronizar)
  + 44 (⋯) + 16 de respiro; linha 3 = 154 (seletor) + 88 (Tarefas) + 44 (＋) + 16.

**Sincronizar.** O botão mantém a palavra "Sincronizar": é o nome que o CLAUDE.md e os três
fluxos da IA usam ("toque em Sincronizar"). O estado vai numa legenda de 11 px dentro do
botão, na segunda linha. Ele substitui o `#syncDirtyDot`.

| Estado | Legenda | Tom |
|---|---|---|
| em dia | "hoje 09:22 ✓", "ontem 18:40" ou "14/11 18:40" | neutro, contorno |
| alterações a enviar | "alterações a enviar" | atenção |
| nunca sincronizou | "nunca sincronizado" | atenção |
| falhou | "falhou" (o motivo vai para o aviso global) | perigo |
| sincronizando | "sincronizando…" | neutro, desabilitado |

- A legenda mostra o dia quando a última sincronização não foi hoje. Sem o dia, um "09:22" de
  ontem passaria por atual.
- Tocar no botão sempre sincroniza, em qualquer estado. O detalhe do erro não fica "num
  toque" do botão.
- Regra no core, com teste: `estadoDoSync({ sujo, ultimoSync, erro }, hojeISO)` devolve
  `{ tom, legenda }`. O `index.html` converte `lastSyncAt` para dia e hora locais antes de
  chamar.
- Não há contagem de alterações: o estado local não tem esse número, e não vamos criá-lo.

**"Alterações a enviar" só para o que sincroniza.** Hoje `saveData` avança `lastModifiedAt` em
qualquer gravação. Marcar uma visita, recolher uma seção ou a virada do dia
(`ensureDailyReset`) acendem o aviso, embora nada disso vá para o banco. Com o pontinho de
12 px isso passa; com a legenda âmbar no botão principal, o aviso ficaria aceso quase o dia
inteiro e deixaria de dizer alguma coisa.
- `saveData(state, { localOnly: true })` grava sem avançar `lastModifiedAt`.
- Usam `localOnly`: flags `is*Minimized` e `isPendenciasMinimized`, visita e checks diários,
  `ensureDailyReset` e "Resetar dia", lembrete, médico externo, tarefas, exames fixados e as
  listas de sugestões. Nenhum desses campos entra em `buildPushPayload`.
- O erro possível é só para o lado seguro: esquecer o `localOnly` numa chamada mantém o
  comportamento de hoje (aviso aceso sem necessidade). `runSync` não muda.

**Menu ⋯** (folha de ações de 2.0), nesta ordem:
- Resetar dia
- Exportar backup
- Importar backup
- Sair
- **Resetar e receber do servidor** (em vermelho, depois de uma linha)
- Cancelar
- Rodapé: "Caderno de Visitas · versão N"

Detalhes do menu:
- Os itens são os mesmos elementos de hoje, com os mesmos `id`, movidos para dentro da folha.
  "Importar backup" continua sendo um `<label>` com o `<input type="file">` dentro.
- **Sair pede confirmação:** "Sair? Para entrar de novo é preciso internet." Hoje o toque sai
  na hora. Sem rede no hospital, o médico fica trancado fora do app no meio da visita, e o
  item passa a ficar numa folha ao alcance do polegar.
- **Versão com uma fonte só.** Hoje há três números que não conversam: "v11" no título,
  `wardBookData_v16` no armazenamento e `caderno-v9` no `sw.js`. O rodapé mostra uma constante
  `APP_VERSION` do `index.html`, e `tests/sw.test.cjs` confere que ela é igual ao número do
  cache em `sw.js`. Como o cache sobe a cada entrega, o número diz de fato qual versão o
  aparelho está rodando. O `<title>` vira "Caderno de Visitas".

**Filtros** fica só com filtro e ordenação: "Ocultar concluídos, vazios e externos" e
Ordenar por (Leito, Admissão, Nome).

**Tarefas** vira um chip "Tarefas N", com o número de tarefas não concluídas. Com zero, o
número some e fica só "Tarefas". O chip abre a Tela C.

**Adicionar leito** vira o botão ＋ da terceira linha (`aria-label="Adicionar leito"`) e uma
linha tracejada "+ Adicionar leito" no fim da lista, com o mesmo handler. Não é um botão
flutuante: os checks ficam alinhados à direita na base de cada cartão, exatamente onde um FAB
flutuaria, e o TEV e a Queda do cartão que estivesse embaixo dele ficariam cobertos.

### 2.2 Contador do dia

Hoje é "T: 6 | V: 2 | P: 2 | E: 1". Passa a ser a frase + barra do esboço acima.

- `progressoDoDia(state)` → `{ total, ocupados, aVisitar, visitados, pendentes, externos,
  vazios, tarefasAbertas }`, com a mesma regra de hoje: externo não conta como visitado nem
  como pendente.
- **O denominador é `aVisitar = ocupados − externos`**, não o total de leitos. No exemplo:
  6 leitos, 1 vazio, 1 externo → "2 de 4 visitados".
- `fraseProgresso(p)` → `{ titulo, detalhe }`, também no core, por causa dos plurais e dos
  casos de borda:
  - partes zeradas somem ("1 externo", sem "0 vazios");
  - `aVisitar === 0` → "Nenhum paciente para visitar", sem barra;
  - todos visitados → "4 de 4 visitados ✓", barra no tom de sucesso;
  - nenhum leito → "Nenhum leito".
- "Visitado" é o círculo (`isVisited`). "Concluído" é o círculo mais os quatro checks, e é o
  que "Ocultar concluídos" usa. São dois conceitos; a frase conta o primeiro.
- A barra tem `role="progressbar"` com `aria-valuenow`/`aria-valuemax`.

### 2.3 Pendências do dia

Hoje, com 9 itens, o painel ocupa a primeira tela e empurra os leitos. A cor segue a
*categoria*, então "Alta prevista atrasada" aparece com bolinha verde.

- `buildPendencias` ganha dois campos por item, sem mudar os existentes:
  - `gravidade`: `'alerta' | 'atencao' | 'info'`
    - alerta: ATB com prazo vencido, alta prevista atrasada
    - atenção: ATB no último dia, cultura sem resultado, dispositivo ≥ 7 dias, lembrete
    - info: alta prevista hoje
  - `curto`: rótulo para selo, com regra fixa:
    - ATB: "ATB D8/7"
    - cultura: "Cultura D5"
    - dispositivo: primeira palavra do nome, até 8 caracteres, + dia ("CVC D9", "SVD D12")
    - alta: "Alta hoje" ou "Alta atrasada"
    - lembrete: "Lembrete"
- `agruparPendencias(pend)` devolve `[{ bedIndex, bedNumber, gravidadeMax, itens }]`. Ordem
  dos grupos: gravidade máxima (alerta, atenção, info) e, no empate, número do leito. Dentro
  do grupo, os itens também vêm por gravidade. Testes em `tests/pendencias.test.cjs`.
- O painel mostra **uma linha por leito**: "1014-B · ATB D8/7 · Alta atrasada · Lembrete".
  A bolinha tem a cor da gravidade máxima: perigo, atenção ou primária (o "info" usa o tom da
  primária; não existe um azul à parte, ver 4.1). O título fica "Pendências (3 leitos,
  9 itens)". O recolhimento continua em `state.isPendenciasMinimized`.
- O rótulo completo de hoje ("ATB Cefepime: prazo vencido (D8/7)") sai do painel. Ele continua
  na tela do paciente: o resumo da seção Controles (3.4) mostra os itens que alertam.
- **Limiares num lugar só.** "Cultura ≥ 3 dias sem resultado" (com o teste de "aguardando") e
  "dispositivo ≥ 7 dias" estão escritos duas vezes hoje, em `renderTrackerList` e em
  `buildPendencias`. Viram constantes do core, ao lado do "ATB longo ≥ D8" de `atbBadge`.

### 2.4 Cartão do leito

- **Linha 1:** visita (círculo de 44 px, ocupando as linhas 1 e 2), leito, sino (se houver
  lembrete), chip do médico externo, e "D10" à direita.
- **Linha 2:** nome, sem dividir a largura com o selo de alta (hoje ele trunca o nome).
- **Linha 3:** selos à esquerda, checks à direita.
  - Selos: alta prevista e até 2 pendências `curto` do leito, por gravidade, com "+N" se
    houver mais. As pendências de alta e de lembrete não viram selo aqui: o selo de alta e o
    sino já dizem isso, e sairiam em dobro.
  - **Largura:** o cartão tem 342 px úteis em 390 e 312 px em 360; os checks ocupam 216 px.
    Ao lado deles cabe um selo ("Alta 16/11"), não três. A linha usa `flex-wrap`, com os
    checks em `ml-auto`: quando os selos não cabem, os checks descem para uma quarta linha.
    O cartão sem pendência continua com três linhas; o que tem pendência fica mais alto, e é
    ele que pede atenção.
- **Selo de alta:** texto curto ("Alta hoje", "Alta 16/11") e tom pelo estado: atrasada =
  perigo, hoje = primária, em 1 ou 2 dias = atenção, depois = neutro. `getDischargeStatus`
  sai do `index.html` e vira `statusAltaPrevista(data, hojeISO)` no core.
- **Lembrete:** sai o fundo azul (`.reminder-list-active`), fica só o sino.
- **Estados distintos.** Hoje concluído, vazio e externo recebem o mesmo `opacity-60`. A regra
  sai do `index.html` (`isBedCompleted`) e vira `estadoDoLeito(bed)` no core, que devolve
  `'vazio' | 'externo' | 'concluido' | 'pendente'`. "Ocultar concluídos" esconde os três
  primeiros, como hoje.
  - Concluído: check verde, texto normal, fundo levemente esverdeado. Sem opacidade.
  - Externo: chip do médico. Os checks ficam escondidos, e o círculo de visita vira um
    marcador neutro: hoje ele aparece e não responde ao toque.
  - Vazio: cartão compacto de uma linha, "1021 · Vazio — toque para admitir". Sem círculo e
    sem checks. O toque abre o paciente com o foco no nome, como acontece ao criar um leito.
- **Lista vazia.**
  - Nenhum leito no aparelho: "Nenhum leito neste aparelho. Toque em ＋ para adicionar ou em
    Sincronizar para receber do banco." Num aparelho recém-logado a lista nasce vazia, e hoje
    nada diz que os pacientes chegam pelo Sincronizar.
  - Nenhum leito visível por causa da busca ou do filtro: "Nenhum leito com esse filtro", com
    um botão "Limpar busca".
- Os checks seguem a Fase 1.2.

### Entrega da Fase 2

- Testes de `estadoDoSync`, `progressoDoDia`, `fraseProgresso`, `agruparPendencias`, dos novos
  campos de `buildPendencias`, de `statusAltaPrevista`, de `estadoDoLeito` e da versão
  (`APP_VERSION` × `sw.js`).
- Regenerar o CSS, subir o `sw.js`.
- Capturas em 360, 390 e 1280 px; conferir os orçamentos de altura e largura de 2.1 e 2.4.
- Conferir o checklist da lista e dos arquivados.

---

## Fase 3: Tela do paciente

### 3.1 Cabeçalho do paciente

Hoje 5 ações quebram em duas linhas acima do nome, e Deletar (vermelho) fica ao lado de
Arquivar.

- **Cabeçalho fixo:** ‹ Voltar | leito + nome | **⋯**.
- **Alergia sempre à vista.** A faixa de alergia fica no topo do conteúdo e sai da tela quando
  o médico rola até Condutas, que é onde ele decide o que prescrever. Quando há alergia
  registrada, o cabeçalho fixo mostra o selo vermelho "⚠ ALERGIA" ao lado do leito, com o
  texto da alergia no `aria-label`. O toque rola até a faixa. A faixa continua como hoje.
- O menu **⋯** do cabeçalho (folha de ações de 2.0) depende do estado do registro:

  | Registro | Itens |
  |---|---|
  | internado, com paciente | Dar alta · Arquivar · **Deletar** |
  | leito vazio | **Deletar** |
  | arquivado | Restaurar · Reinternar · **Deletar** |

  Hoje os cinco botões aparecem em qualquer registro. "Dar alta" num paciente já arquivado
  regrava a alta com a data de hoje e cria um leito ativo vazio com o mesmo número. Restaurar
  e Reinternar usam os handlers que já existem no cartão de Arquivados. "Guardar na nuvem"
  continua só na lista, porque age sobre todas as internações da pessoa.
- **Cartão de identificação:**
  - Leito (grande) e nome editáveis, como hoje.
  - Linha de dados em chips: **[78 a] [Adm 07/11 · D10] [Alta prev. 16/11 ✕]**. Vazios:
    **[Idade] [Admissão] [+ Previsão de alta]**. A linha quebra em duas no aparelho estreito.
  - **Como o chip edita.** Um `<input type="date">` não mostra "07/11": o navegador escolhe o
    formato (no iOS, algo como "7 de nov. de 2026") e a largura. O chip mostra o texto
    formatado pelo app, e o campo nativo fica por cima dele, transparente, com a área do chip
    inteira e fonte de 16 px. O toque abre o seletor nativo, sem zoom e sem depender de
    `showPicker()`. A idade é um `<input type="number">` estreito dentro do chip.
  - O chip de alta usa o tom de `statusAltaPrevista` (2.4). O ✕ é o "Limpar" da previsão, com
    alvo próprio de 44 px.
  - "D10" é o dia de internação, que hoje não aparece nesta tela.
  - A seção solta "Previsão de Alta" do fim da página deixa de existir: o campo mora aqui.
  - Ações: **Copiar resumo** (botão principal) e o sino.
  - Checks (Fase 1.2).
  - **Médico externo** recolhido numa linha "Médico externo: — ▸", que expande para o campo
    atual. Quando preenchido, mostra o nome.
- **Ícone de "salvar na lista"** (médico externo e condutas): hoje é um gráfico de barras.
  Troca por estrela/marcador. Os dois botões fazem coisas diferentes e têm rótulos diferentes:
  "Salvar médico na lista de sugestões" e "Adicionar a conduta e salvar na lista".

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

Cada seção continua independente, com o próprio flag `is*Minimized` e o mesmo padrão de
aberta/fechada de hoje. O `setupCollapsibleSection` localiza a seção pelo seletor do conteúdo,
não pela posição, então reordenar o template não muda a ligação.

### 3.3 Barra de atalhos

Uma faixa fixa abaixo do cabeçalho, com rolagem horizontal:

**Problemas · Histórico · Controles · Exames · Condutas · Evolução · Docs**

São 7 atalhos para 12 seções. Cada seção leva `data-atalho` com o chip a que pertence:

| Chip | Rola até | Seções que acendem o chip |
|---|---|---|
| Problemas | Problemas | Problemas |
| Histórico | HPP | HPP, Alergias e Medicações, Anamnese, Internações anteriores |
| Controles | Controles | Controles e Invasivos |
| Exames | Exames | Exames |
| Condutas | Condutas | Condutas, Anotações |
| Evolução | Evolução Tasy | Evolução Tasy |
| Docs | Texto do Prontuário | Texto do Prontuário, Documentos Gerados |

- Tocar no chip abre a seção, se estiver fechada (persistindo o flag como o toque no título
  já faz), e rola até ela.
- **Rolagem:** as seções levam `scroll-margin-top` igual à altura do cabeçalho + barra, e o
  chip chama `scrollIntoView({ block: 'start' })`. Não calcular a posição à mão. Rolar só
  depois que a seção aberta terminou de ajustar a altura dos campos (ver 3.5).
- O chip da seção visível fica destacado (IntersectionObserver; sem ele, sem destaque) e é
  trazido para dentro da faixa quando está fora dela.
- A faixa tem um degradê na borda direita enquanto houver chips escondidos: os sete não cabem
  em 390 px.
- **Com um campo de texto em foco, a barra some.** Cabeçalho, barra e rodapé somam cerca de
  170 px fixos. Com o teclado aberto, sobraria pouco mais que a linha em que se está
  digitando.

### 3.4 Resumo nas seções fechadas

Estende o padrão que já existe em Exames (`buildLabsLine` → `.labs-last-line`). O título de
cada seção fechada mostra uma linha de resumo, calculada por uma função do core com testes:
`resumoSecao(bed, secao, { hoje, pinnedExams, notesTemplate })`. A assinatura leva as opções
porque o resumo de Exames precisa dos fixados e o de Anotações precisa do modelo, e os dois
ficam no estado, não no leito.

| Seção | Resumo |
|---|---|
| Problemas | nomes dos ativos e a contagem dos crônicos: "PAC · LRA KDIGO 2 · 1 crônico" (resolvidos não contam) |
| HPP | "HAS · DM2 · DRC G3b" |
| Alergias e Medicações | a alergia, ou "Nenhuma alergia registrada"; depois o começo das medicações: "Dipirona · losartana 50 mg, metformina…" |
| Anamnese | primeiros ~60 caracteres |
| Internações anteriores | "2 internações · última alta 03/09" |
| Controles | itens em uso, primeiro os que alertam: "Pip-Tazo D7/7 ⚠ · CVC D9 ⚠ · HMC D2". Encerrados e retirados não entram. |
| Exames | (já existe) |
| Condutas | "1/3 feitas · próxima: Solicitar TC de tórax" |
| Anotações | primeira linha não vazia que não seja linha do modelo |
| Evolução Tasy | "Hoje ✓", "Última: 14/11" ou "Nenhuma" |
| Texto do Prontuário | "2 textos · último 16/11" |
| Documentos | "Sumário de alta 16/11" (o mais recente) |

- **O resumo aparece só com a seção fechada.** Aberta, ele repetiria o que está logo abaixo
  (os 60 caracteres da anamnese em cima da própria anamnese) e teria de ser atualizado a cada
  tecla para não ficar desatualizado. Exames é a exceção e continua como hoje, com a linha da
  última coleta sempre visível.
- Uma linha só, cortada com reticências. Exames pode usar duas (`line-clamp-2`), porque ali a
  linha é o conteúdo.
- Cor do resumo: `slate-500` ou mais escuro. O `slate-400` dos contadores de hoje tem 2,6:1.
- Os contadores de hoje continuam no título ("HPP (3)", "Evolução Tasy (5)"), e a etiqueta
  vermelha "ALERGIA" também.
- **"Nenhuma alergia registrada", nunca "Sem alergias".** Campo vazio quer dizer que ninguém
  preencheu, não que o paciente nega alergia.
- **Anotações:** "+ Nota" preenche o campo com o modelo ("S: (Subjetivo)…"). Sem a regra do
  modelo, o resumo seria "S: (Subjetivo)" em todos os pacientes. Com o campo igual ao modelo,
  o resumo fica vazio.
- **Medicações** é texto livre. Contar linhas daria "1 medicação" para "losartana, metformina,
  AAS" numa linha só; por isso o resumo mostra o começo do texto.
- **Controles:** cada nome é cortado em 14 caracteres. O selo vem de `seloControle` (3.6).
- **Documentos:** a data vem de `createdAt`, que é UTC. O `index.html` converte para o dia
  local e passa pronto; o teste não pode depender do fuso da máquina.

### 3.5 Problemas

- **Campo que quebra linha.** A descrição passa de `input` de uma linha para um campo que
  cresce com o texto. Hoje o texto é cortado ("Pneumonia comunitária g"). O mesmo corte
  acontece no plano, no item do HPP, no texto da conduta e na tarefa, e os cinco passam a usar
  o mesmo campo.
  - **Uma linha lógica.** Enter sai do campo em vez de inserir quebra; quebra de linha colada
    vira espaço. `descricao` com quebra de linha bagunça o "Copiar resumo" (`buildDailySummary`
    junta os problemas com "; "), e no HPP uma quebra separa o item em dois (`parseHpp`).
  - **Altura sem salto.** `autoResizeTextarea` mede a altura num `setTimeout`, depois que o
    campo entra na página. Com dez campos que nascem com uma linha e crescem no instante
    seguinte, cada `renderScreenB()` encolhe e estica a página, e a rolagem pula. Estes campos
    usam a técnica da grade com o texto espelhado num pseudo-elemento (o campo cresce por CSS,
    já no primeiro desenho), ou `field-sizing: content` onde o navegador tiver.
- O "Plano" ganha um indicador visual de campo editável: borda tracejada leve quando vazio, e
  o ícone ↳ à esquerda.
- **Status.** O chip ganha um "▾" e deixa de trocar no ciclo cego (`PROBLEM_STATUS_NEXT` sai
  do toque; o valor gravado é o mesmo). O chip mostra o texto e a cor, e um `<select>` nativo
  transparente fica por cima dele, com **Ativo / Crônico / Resolvido**, como nos chips de data
  de 3.1. O seletor do sistema já traz alvo grande, teclado e leitor de tela.

### 3.6 Controles

Cada item passa a ter duas linhas, com uma barra lateral de 3 px na cor do tipo:

```
▍Piperacilina-tazobactam              [D7/7 último dia]
▍ATB · D1 12/11 · fim previsto 18/11            ✎  ✕
```

- **Cores de tipo:** ATB sky, **Cultura teal**, Dispositivo slate, Procedimento violet. Hoje a
  cultura é âmbar, a mesma cor de "precisa olhar hoje": uma cultura sem alerta nenhum
  pareceria uma pendência (ver 4.1). O modal de controles troca junto.
- **`seloControle(t, hojeISO)` no core**, para os quatro tipos, devolve `{ rotulo, tom,
  alerta }`. Hoje só o ATB tem a regra no core (`atbBadge`, que continua e é chamado por
  dentro); cultura, dispositivo e procedimento são calculados dentro de `renderTrackerList`.
  O resumo de 3.4 precisa da mesma regra, e sem a função ela seria escrita pela terceira vez.
  Os cálculos não mudam.
- **"Fim previsto"** é a data de fim, se houver uma futura; sem ela, D1 + duração − 1
  (`fimPrevistoAtb`, no core). No exemplo: D1 em 12/11, 7 dias, fim em 18/11. Hoje a data só
  aparece quando alguém a digita.
- O rótulo do tipo ("ATB", "Cultura", "Disp", "Proc") desce para a segunda linha.
- Suspenso ou removido: texto em tom neutro e selo "Suspenso D7" / "Removido D10", sem
  `opacity-60` (4.3).

### 3.7 Exames

- Os filtros De/Até/Nome recolhem numa linha que diz o filtro em vigor: **"Últimos 7 dias ·
  Filtrar ▸"**, "01/11 a 10/11 · Filtrar ▸" ou "Busca: TSH · Filtrar ▸".
- **Tabela nunca vazia por causa do padrão.** Hoje o padrão é "últimos 7 dias" a contar de
  hoje. Se a última coleta tem 10 dias, a tabela diz "Nenhum resultado encontrado para os
  filtros aplicados", enquanto o título mostra "Labs 06/11: …". Com os filtros recolhidos, o
  motivo ficaria ainda menos visível. `janelaLabs(datasDasColetas, hojeISO)`, no core: os
  últimos 7 dias; sem coleta nesse período, as 3 coletas mais recentes. A linha do filtro
  passa a dizer "Últimas 3 coletas".
- **Modo "Editar fixados"**, ligado por um botão ao lado de "Faixas de referência". Só nele
  aparecem as setas ▲▼ de reordenar e o alfinete vira botão, com alvo de 44 px. Fora do modo,
  o alfinete é só um marcador: hoje ele tem 14 px e fica ao lado do nome. Isso também separa
  as setas de reordenar das setas de tendência, que usam o mesmo desenho.
- "+ Adicionar Nova Coleta" continua no topo.

### 3.8 Rodapé

- ‹ › ganham o leito vizinho, em duas linhas dentro do botão: a seta em cima e o leito
  embaixo, em 11 px, cortado se não couber. Seguem a ordem atual da lista
  (`renderedBedIndexes`).
- **Orçamento em 360 px** (336 px úteis): 2 botões de navegação de 56 px + 4 respiros de 8 px
  deixam 64 px para cada ação. Com o leito ao lado da seta ("‹ 1030-C"), cada botão de
  navegação teria uns 80 px e as ações voltariam a quebrar, que é o defeito de 1.6.
- A navegação continua dando a volta, do último para o primeiro, como hoje.
- **Fora da lista, os botões ficam desabilitados.** Paciente aberto a partir de Arquivados, de
  "Internações anteriores" ou de uma pendência cujo leito está escondido pelo filtro não está
  em `renderedBedIndexes`. Hoje os botões aparecem normais e não fazem nada.
- `vizinhosNaLista(indices, atual)` → `{ anterior, proximo }` no core, com teste.

### 3.9 Marca de "copiado" (adição)

O fluxo da Evolução Tasy é copiar um campo, trocar de janela, colar e voltar, nove vezes. O
botão vira "Copiado ✓" por 2 segundos e volta a "Copiar". Na volta ao app, não há como saber
em qual campo se estava.

- O campo copiado guarda um "✓ copiado" discreto ao lado do botão, até o texto ser editado, a
  data mudar ou o app ser recarregado. Fica só na memória, por paciente + data + campo.
- Ao lado do seletor de data, dentro da seção: "3 de 7 copiados" (conta só os campos com
  texto).
- Vale também para os blocos do sumário de alta.
- Não cria dado, não sincroniza e não muda o que é copiado.
- **Aviso de iniciais.** O "Copiar" troca `[NOME]` pelo nome que o aparelho tem. No computador,
  que recebeu o paciente do banco, esse nome são as iniciais: o texto colado no Tasy sai com
  "AB" no lugar do nome. Quando o aparelho só tem as iniciais (`knownPatientName(bed)` vazio)
  e o texto tem `[NOME]`, a Evolução Tasy e os Documentos mostram uma linha: "Este aparelho só
  tem as iniciais: [NOME] sai como "AB". Digite o nome completo no cartão para copiar com o
  nome." O nome digitado ali continua só no aparelho, como hoje.

### 3.10 Arrastar condutas (adição)

A ordem das condutas já existe no dado e no banco (`painel_condutas.ordem`; o push grava a
posição). O que falta é a alça: Problemas, HPP e Controles têm, Condutas não.

- Mesma alça e mesmo `enableListDrag` das outras listas; `.conduta.dragging` entra no CSS.
- Os handlers da conduta guardam o índice (`updateConduta(bedIdx, ci, …)`,
  `splice(ci, 1)`). Depois de arrastar, redesenhar a lista, como o HPP já faz, para os índices
  voltarem a bater.

### Entrega da Fase 3

- Testes de `resumoSecao` (cada linha da tabela 3.4, mais o modelo de anotações e a alergia
  vazia), `seloControle`, `fimPrevistoAtb`, `janelaLabs` e `vizinhosNaLista`.
- Regenerar o CSS, subir o `sw.js`.
- Conferir o checklist do paciente, inclusive arrastar em HPP, Problemas, Controles e
  Condutas depois do reordenamento.
- Conferir que trocar o status de um problema com a página rolada até Condutas não desloca a
  rolagem.

---

## Fase 4: Sistema visual e acessibilidade

### 4.1 Cores com significado fixo

Hoje o âmbar significa ao mesmo tempo resetar, pendente, cultura, dar alta e queda pendente.

Cada papel tem três tons, porque a mesma cor não serve para tudo. Texto pequeno precisa de
4,5:1; ícone, bolinha e barra precisam de 3:1. Os contrastes abaixo foram calculados com as
cores do Tailwind: sobre branco e, na coluna do selo, o texto sobre o fundo do próprio selo.

| Papel | Uso | Texto e fundo com texto branco | Selo (fundo + texto) | Só ícone, bolinha, barra |
|---|---|---|---|---|
| primária | ação principal, links, foco, "info" | sky-700 (5,9) | sky-100 + sky-800 (6,6) | sky-600 (4,1) |
| sucesso | feito, visitado, sincronizado | green-700 (5,0) | green-100 + green-800 (6,5) | green-600 (3,3) |
| atenção | precisa olhar hoje | amber-700 (5,0) | amber-100 + amber-800 (6,4) | amber-600 (3,2) |
| perigo | vencido, atrasado, apagar, alergia, lab alto | red-600 (4,8) | red-100 + red-800 (6,8) | red-600 |
| neutra | todo o resto | slate-600 (7,6); slate-500 no mínimo (4,8) | slate-100 + slate-600 (6,9) | slate-500 |
| tipos de controle | só a barra lateral e o modal | — | — | sky, teal, slate, violet |

- **A base não é `sky-600` nem `green-600`.** Texto branco sobre `sky-600` dá 4,1:1, e sobre
  `green-600` dá 3,3:1: os botões principais reprovariam no próprio critério de 4.3. Reprovam
  hoje: ✓ branco sobre `sky-500` (2,8) e sobre `green-500` (2,3), `amber-500` como texto ou
  bolinha (2,2), texto em `slate-400` (2,6) e a alça de arrasto em `slate-300` (1,5).
- **Âmbar é só "atenção".** Cultura passa a teal (3.6). "Dar alta" deixa de ser âmbar: ação
  neutra no menu. "Resetar e receber" é perigo.
- **"Info" não é um papel novo:** usa o tom da primária (pendência "alta prevista hoje", sino
  do lembrete).
- Índigo (sync, nuvem) e roxo (tarefas, externos) deixam de ser cores de botão.
- **Chip do médico externo:** a cor é sorteada pelo nome entre nove pares, e a lista inclui
  vermelho, laranja e verde. Um médico pode cair no tom de "perigo". A lista fica só com
  matizes que não são estado (azul, índigo, roxo, rosa, ciano, teal). A cor de cada médico
  muda uma vez, na atualização.
- **Labs:** o valor baixo continua azul e o alto vermelho (convenção da tabela, documentada
  como exceção). As setas de tendência ▲▼ passam a cinza: hoje a subida é vermelha, mas uma
  hemoglobina que sobe não é um alerta. A cor fica só para o que está fora da faixa.

### 4.2 Tokens e classes de componente

Criados em 2.0; aqui se migra o que as fases 2 e 3 não tocaram.

- Variáveis CSS em `:root` no `<style>` do `index.html`, quatro por papel (forte, fundo do
  selo, texto do selo, marcador), mais as de superfície: `--c-primary`, `--c-primary-bg`,
  `--c-primary-on-bg`, `--c-primary-mark`, idem para `success`, `warn` e `danger`;
  `--c-neutral-bg`, `--c-neutral-on-bg`, `--c-surface`, `--c-surface-2`, `--c-border`,
  `--c-text`, `--c-text-muted`.
- Classes curtas no mesmo `<style>`: `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`,
  `.chip`, `.chip-warn`, `.chip-danger`, `.card`, `.field`, `.campo-linha`.
- **Cascata:** o `<style>` vem depois do `styles.css`, então uma classe de componente vence um
  utilitário do Tailwind de mesma especificidade. Um `py-1` posto num `.btn` não tem efeito.
  Variação vira modificador (`.btn-sm`), não utilitário por cima.
- **Sombras:** `shadow-lg` sai de todos os cartões. Fica `.card` = borda `--c-border` +
  sombra leve (`0 1px 2px`). A hierarquia passa a vir da tipografia.

### 4.3 Acessibilidade

- **Rótulos:** todo botão só de ícone tem `aria-label`, não só `title`.
- **Contraste:**
  - Texto ≥ 4,5:1; ícone e marcador ≥ 3:1 (tabela de 4.1).
  - Os checks vazios (hoje `slate-400` sobre `slate-100`, 2,3:1) passam para `slate-600` sobre
    `slate-100` (6,9:1).
  - Nenhum cartão ou item usa `opacity` para indicar estado.
- **Toque:** alvos ≥ 44 px nos controles de uso frequente (checks, visita, ✕ de listas,
  menus). A alça de arrasto tem hoje 24 px de largura: passa a ocupar a altura da linha, com
  32 px de largura.
- **Foco:** anel de foco visível (`focus-visible`) em botões e chips.
- **Modais:** `role="dialog"`, `aria-modal`, título ligado por `aria-labelledby`, foco dentro
  ao abrir e de volta ao botão de origem ao fechar, Esc fecha. O voltar do aparelho fecha o
  modal (2.0).
- **Botão escondido até o hover:** trocar `sm:opacity-0` pelo padrão de 1.4 em todas as
  listas.
- **Área segura.** O aparelho principal é Android, onde a barra de navegação fica fora da
  página. Basta `padding-bottom: env(safe-area-inset-bottom)` na folha de ações e nos rodapés,
  que não custa nada onde o valor é zero. O app declara
  `apple-mobile-web-app-status-bar-style: black-translucent`; se um dia for usado num iPhone
  instalado, conferir se o cabeçalho fica sob o relógio (aí entra `viewport-fit=cover`).
- **Movimento:** com `prefers-reduced-motion`, sem as transições de seção, de toggle e da
  folha de ações.

### 4.4 Modo escuro (opcional dentro da fase)

- Redefine os tokens sob `@media (prefers-color-scheme: dark)` e sob `[data-theme="dark"]`.
- Escolha **Automático / Claro / Escuro** no menu ⋯, gravada em `wardBookPrefs_v1` (preferência
  local, fora do estado sincronizável).
- **Pré-condição:** os tokens só alcançam o que usa as classes de componente. Enquanto
  existir `bg-white`, `text-slate-800` ou `border-slate-200` solto no HTML ou nas strings do
  script, o modo escuro sai pela metade. O atalho é remapear os utilitários neutros para os
  tokens num bloco só do `<style>` (`.bg-white { background-color: var(--c-surface) }`,
  `.text-slate-800 { color: var(--c-text) }`...), em vez de reescrever cada elemento. Critério
  de pronto: nenhuma cor neutra do Tailwind fora desse bloco e das classes de componente.
- `color-scheme: dark` na raiz, para os campos de data e os seletores nativos acompanharem, e
  `theme-color` por tema.
- As cores dos labs (alto/baixo), a faixa de alergia, os selos de gravidade e os chips de
  médico (cor por `style` inline, fora dos tokens) precisam ser conferidos nos dois temas.
- Se ficar grande demais, sai desta fase sem afetar o resto.

### 4.5 Tela larga

O computador é usado para colar no Tasy; consulta e lançamento são quase sempre no celular.
Na tela larga, o que importa é a Evolução Tasy e os Documentos.

- O conteúdo do paciente estica hoje até 1280 px (`max-w-7xl`), e as linhas de texto da
  evolução, da anamnese e das anotações vão de uma ponta à outra. Limitar a cerca de 768 px
  (`max-w-3xl`), centrado.
- A barra de atalhos e o rodapé seguem a mesma largura.
- Conferir a captura de 1280 px em cada fase: o código já tem regras para tela larga (`sm:`),
  e elas mudam junto com o resto.

### Entrega da Fase 4

- Regenerar o CSS, subir o `sw.js`.
- Capturas de todas as telas e modais em claro (e escuro, se feito).
- Conferir o checklist inteiro.

---

## Verificação visual (todas as fases)

Captura com dados fictícios, sem alterar os arquivos do app. O gerador mora em
`tools/captura/`, versionado: cada fase será feita numa sessão diferente, e sem ele o estado
fictício seria recriado toda vez, e o "antes e depois" compararia pacientes diferentes.

1. Copiar `index.html`, `painel-core.js`, `styles.css` e `icon.svg` para uma pasta temporária.
2. Injetar antes do `painel-core.js` um script que grava o estado fictício em
   `localStorage['wardBookData_v16']` e uma chave `sb-x-auth-token` (libera o portão offline).
   As datas do estado são relativas ao dia da captura. Injetar no fim um script que abre a
   tela pedida pelo `#hash`, incluindo os estados que não são tela: folha de ações aberta,
   modo "Editar fixados", aviso global, Arquivados.
3. Envolver em `<iframe style="width:390px">`: o Edge/Chrome headless tem largura mínima de
   janela maior que 390.
4. Rodar
   `msedge --headless=new --window-size=600,860 --screenshot=out.png file:///…/wrapper.html`.

Três larguras (360, 390 e 1280 px) e dois enquadramentos:
- **uma tela** (390 × 667): mostra o que cabe sem rolar e quanto os elementos fixos ocupam;
- **página inteira** (iframe alto): mostra o conteúdo todo.

O estado fictício cobre os extremos: leito de 8 caracteres, nome longo, paciente com 3
pendências, ATB com nome longo, lista vazia, leito vazio, médico externo, paciente com
alergia, 20 exames numa coleta. Nomes de paciente são sempre fictícios ("Paciente Exemplo
Um").

**A captura não substitui o aparelho.** Conferir à mão, no Galaxy A54, ao fim de cada fase:
- o teclado aberto não cobre o campo nem o botão que o salva (no Android a página encolhe e o
  rodapé fixo sobe junto com o teclado);
- arrastar funciona com o dedo nas quatro listas;
- o voltar do aparelho fecha folha e modal, e da tela do paciente volta para a lista;
- sem rede, o app abre e a fonte de reserva não quebra os orçamentos de largura.

E no computador, ao fim das fases 3 e 4: copiar os nove campos da Evolução Tasy em sequência.

## Fora de escopo

- Mudanças no sync, no schema, nos fluxos da IA ou nos templates de documento.
- Funcionalidades novas de dado (ex.: "copiar evolução inteira"). Se surgirem durante a
  implementação, vão para um spec próprio. As duas adições desta revisão (3.9 e 3.10) não
  criam dado nem mexem no sync, e cada uma pode sair sem afetar o resto.

Ideias anotadas, não incluídas:
- "Desfazer" por alguns segundos no lugar da confirmação, para remoções pequenas (conduta,
  tarefa, item do HPP). Hoje toda remoção abre um modal.
- Preencher a admissão com a data de hoje quando o nome é digitado num leito vazio.
- Apagar itens das listas de sugestões (condutas comuns, médicos). Hoje elas só crescem.
- Recolher os controles encerrados num bloco "Encerrados (3)" no fim da lista.
- "Limpar concluídas" nas Tarefas.
- Sincronizar a partir da tela do paciente.
- Sugestões do médico externo em chips, como as das condutas, no lugar do `<datalist>`.
- Tela do paciente em duas colunas no computador.

## Pontos confirmados pelo usuário (2026-11-16)

- **Nomes dos checks:** EV = Evolução, P = Prescrição, EX = Exames, TEV = Profilaxia de TEV.
- **Computador:** usado para colar no Tasy. Consulta e lançamento de dados são, na maioria das
  vezes, pelo celular. Por isso 4.5 fica, e 3.9 ganhou o aviso de iniciais.
- **Aparelho principal:** Samsung Galaxy A54 (6,4", 1080 px de largura física, Android). A
  largura que o navegador enxerga depende do "Zoom da tela" do aparelho e fica entre 360 e
  412 px; os orçamentos foram feitos para 360 px, o caso mais apertado. Na primeira conferência
  no aparelho, anotar a largura real (2.1 mostra a versão no menu ⋯; a Fase 2 põe a largura ao
  lado dela enquanto durar a revisão).

## Registro da revisão (2026-11-16)

O que mudou em relação à versão do commit `24fcda1`.

**Erros de fato (o spec dizia uma coisa, o código faz outra):**
- 1.3 dizia que o minigráfico "é calculado à parte". Ele e as setas de tendência são
  calculados na ordem de `filteredDates`: inverter as colunas inverteria os dois.
- O checklist e a entrega da Fase 3 mandavam conferir "arrastar condutas". Condutas não têm
  alça de arrasto. Saiu do checklist e virou a adição 3.10.
- 1.1 tratava as duas regras de CSS como uma. `.inline-bed` e `.inline-name` não têm `type` e
  não recebem o `min-height`; quem recebe são Idade, Admissão e os campos das listas.
- 3.4 dava "Pip-Tazo D6/7 ⚠" como exemplo. D6/7 não alerta em `atbBadge`.
- 4.1 fixava `sky-600` e `green-600` como base e 4.3 exigia 4,5:1. Texto branco sobre elas dá
  4,1:1 e 3,3:1.
- 4.2 dizia que as telas das fases 2 e 3 "já nascem" com tokens que só seriam criados na
  Fase 4. A criação foi para 2.0.
- 1.5 mandava "atualizar" o `adjustListPadding`, que já mede a altura sozinho.

**Conflitos entre itens do próprio spec:**
- 1.2 × 2.4: checks de 44 px com 8 px de respiro somam 252 px e não deixam lugar para "alta +
  2 pendências + N" na mesma linha.
- 1.6 × 3.8: o leito ao lado da seta devolve a quebra de linha que 1.6 corrige.
- 2.3 × 2.4: a pendência de alta e o selo de alta apareceriam os dois no mesmo cartão.
- 2.3 × 4.1: gravidade "info" em azul, sem papel azul na tabela de cores.
- 3.6 × 4.1: âmbar como tipo (cultura) e como estado (atenção).
- 2.1: o texto de erro "fica num toque" de um botão cujo toque sincroniza.
- 2.1: `#syncStatus` foi tratado como estado do sync, mas carrega também falha ao salvar e
  dados ilegíveis, que não podem sumir atrás de "Sincronizado".
- 1.7, 2.1, 3.1 e 3.5 usavam "menu" sem definir o componente; o primeiro uso era na Fase 1.

**Defeitos de hoje que o redesenho tornaria mais visíveis, agora cobertos:**
- `isHppMinimized` não sobrevive ao recarregar (1.8).
- "Alterações não enviadas" acende com check, seção recolhida e virada do dia (2.1).
- Mensagens de erro invisíveis na tela do paciente (2.0).
- Voltar do aparelho deixa o modal aberto sobre a lista (2.0).
- "Dar alta" disponível em paciente já arquivado (3.1).
- Tabela de labs vazia quando a última coleta tem mais de 7 dias (3.7).
- Botões de editar/remover invisíveis em tablet (1.4).
- Sair sem confirmação; remover tarefa sem confirmação (2.1, 1.4).
- Três números de versão diferentes (2.1).

**Decisões aprovadas no chat que esta revisão alterou (precisam do seu aceite):**
1. "+ Leito" deixa de ser FAB: botão ＋ na terceira linha e linha no fim da lista (2.1).
2. O título "Caderno" sai; a frase do progresso vira o título, e o cabeçalho passa de cinco
   para três linhas (2.1).
3. O botão mantém a palavra "Sincronizar", com o estado em legenda, em vez de o estado ser o
   rótulo (2.1).
4. Checks com caixa de 40 px e passo de 44 px, não 44 + 8 (1.2).
5. Coleta de lab: o toque na data abre a edição e "Apagar" vai para o formulário, sem menu
   (1.7).
6. Resumo da seção só quando ela está fechada (3.4).
7. Resumo de Problemas e de Condutas com os nomes, não só a contagem (3.4).
8. Status do problema e datas do cartão com o seletor nativo por baixo do chip, em vez de menu
   próprio (3.1, 3.5).
9. Cultura passa de âmbar para teal; a paleta do chip de médico perde vermelho, laranja e
   verde; setas de tendência ficam cinza (3.6, 4.1).
10. Em tela larga, a folha de ações aparece centrada, sem popover ancorado (2.0).
11. Menu ⋯ do paciente muda conforme o registro (3.1).

**Adições:** teste de referências do HTML (1.0), aviso global (2.0), `localOnly` (2.1), versão
única (2.1), estados de lista vazia (2.4), selo de alergia no cabeçalho fixo (3.1), campo que
quebra linha nas cinco listas (3.5), "fim previsto" calculado (3.6), modo "Editar fixados" com
o alfinete (3.7), marca de copiado (3.9), arrastar condutas (3.10), tela larga (4.5), gerador
de capturas versionado e conferência no aparelho (Verificação).
