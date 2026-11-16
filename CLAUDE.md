# Painel de Internação (Caderno de Visitas)

App pessoal de um médico internista: `index.html` (offline-first, localStorage) + banco Supabase sincronizado via botão **Sincronizar** (mescla three-way). A lógica pura fica em `painel-core.js` (UMD), testada com `node --test` (rode da raiz, sem argumento de caminho).

## Regras de privacidade (INEGOCIÁVEIS)

- O banco NUNCA recebe nome completo de paciente — apenas `painel_patients.initials`.
- Todo documento gerado usa o placeholder literal `[NOME]` no lugar do nome. O app substitui localmente na hora de copiar.
- Nunca grave nomes completos, CPF, telefone ou endereço de pacientes em nenhuma tabela.

## Banco (Supabase)

- Projeto: **Gestão Médica** (`kuhymtikommkoupynhkj`, região sa-east-1). As tabelas do Painel convivem com outro app no mesmo projeto, por isso usam o **prefixo `painel_`**.
- Acesso restrito por RLS ao usuário dono do painel (o e-mail real está configurado nas policies do banco; o projeto tem outros usuários, mas só o dono enxerga as tabelas `painel_*`).

Tabelas: `painel_patients` (status: internado/alta/arquivado/nuvem; `person_id` agrupa as internações da mesma pessoa — nulo = internação única; `discharge_date` = data da alta; `alergias` e `medicacoes_previas` = texto puro, '' quando não há; `queda_orientada` = check "Queda" do app, termo de ciência do risco de queda aplicado nesta internação — quem marca é o médico no app, não altere), `painel_problems` (status: ativo/resolvido/cronico, com `plano` e `ordem`), `painel_antibiotics`, `painel_cultures`, `painel_devices` (`kind`: device/procedimento — cirurgias contam "PO Dn" e não alertam), `painel_exams` (tipo: lab/imagem), `painel_condutas` (`ordem` = posição na lista; nula = fim da lista), `painel_notes` (1 linha por paciente, PK = patient_id), `painel_raw_texts` (tipo: evolucao/prescricao/admissao — textos crus colados do prontuário), `painel_evolucoes` (evolução no formato do Tasy: UMA linha por paciente por dia, `UNIQUE (patient_id, data)`; nove campos de texto puro: `problemas`, `historia_internacao`, `evolucao_atual`, `exames_lab`, `culturas`, `exames_imagem`, `atualizacao_problemas`, `metas`, `acoes`), `painel_doc_templates` (`sumario_alta`, `laudo`; `evolucao_tasy` é um guia interno para a IA preencher `painel_evolucoes`, não um documento gerável; `receituario` foi aposentado — a linha continua no banco, não use), `painel_generated_docs`, `painel_prefs` (preferências globais do app, PK = key; hoje só `lab_ranges` — upsert por chave no push, três-vias na mescla).

Identifique pacientes por `bed_number` + `initials` (ex.: "leito 1012-A"). Em ambiguidade, pergunte.

## Fluxo 1 — Atualizar a base a partir de texto cru

Quando o usuário colar um texto do prontuário (ou pedir para processar `painel_raw_texts` pendentes):
1. Salve o texto em `painel_raw_texts` (tipo: evolucao/prescricao/admissao) se ainda não estiver lá.
2. Extraia e atualize: `painel_problems` (criar novos, atualizar status/plano dos existentes — não duplique problemas já cadastrados; compare por significado, não por string), `painel_antibiotics` (nome, D1, duração, indicação), `painel_condutas`, `anamnese_inicial` em `painel_patients` (apenas se for texto de admissão e o campo estiver vazio).
3. Gere `id` uuid para linhas novas. Item novo entra no fim da lista: `ordem` = maior `ordem` do paciente + 1 em `painel_problems` e `painel_condutas` (nos trackers, a maior entre `painel_antibiotics`, `painel_cultures` e `painel_devices`). Não delete linhas que você não criou, a menos que o texto diga explicitamente (ex.: "suspenso ATB").
4. Resuma para o usuário o que mudou e lembre-o de tocar **Sincronizar** no app.

## Fluxo 2 — Gerar documento

1. Leia o template em `painel_doc_templates` (`sumario_alta`, `laudo`) e siga as INSTRUÇÕES nele.
2. Leia o paciente completo (todas as tabelas `painel_*` + `painel_raw_texts`).
   Se `person_id` não for nulo, leia também as outras internações da pessoa (`where person_id = ... and id <> ...`) e cite-as quando relevante. Nunca crie nem altere `person_id`/`discharge_date`.
3. Gere o texto com `[NOME]`, mostre no chat E grave em `painel_generated_docs` (`patient_id`, `tipo`, `conteudo`).
4. Lembre o usuário de tocar **Sincronizar** no app para o documento aparecer na seção "Documentos Gerados".

O sumário de alta sai em blocos: cada bloco começa com uma linha `=== NOME DO CAMPO ===` e o último é `=== PARA CONFERIR (NÃO COLAR NO PRONTUÁRIO) ===`. O app mostra um botão "Copiar" por bloco (o de conferência é só leitura); sumários antigos, sem marcadores, aparecem inteiros.

Receituário não é mais gerado (os já gravados em `painel_generated_docs` continuam visíveis no histórico do app).

## Fluxo 3 — Evolução Tasy (`painel_evolucoes`)

1. Siga o guia `evolucao_tasy` em `painel_doc_templates`.
2. Uma linha por paciente por dia: se a linha do dia já existe, atualize-a (ou use `insert ... on conflict (patient_id, data) do update`). Nunca crie uma segunda linha para o mesmo dia.
3. Texto puro, sem markdown, e `[NOME]` no lugar do nome — o app troca localmente ao copiar.
4. Lembre o usuário de tocar **Sincronizar**: a evolução aparece na seção "Evolução Tasy" do paciente, com um botão "Copiar" por campo.

## Convenções de sync (não quebre)

- O app tem um único botão **Sincronizar** (`PainelCore.runSync`, `tests/run-sync.test.cjs`):
  lê tudo, mescla (three-way: local × banco × última foto sincronizada, por linha) e grava SÓ
  a diferença para o que acabou de ler. São duas chamadas ao banco, cada uma atômica — as
  funções `painel_sync_pull()` e `painel_sync_push(jsonb)`
  (`supabase/migrations/010_painel_sync_rpc.sql`, `security invoker`: o RLS continua valendo).
  O sync não lê nem grava tabela solta; não volte a fazer isso.
- A gravação é tudo ou nada, e a falha também: se qualquer coisa der errado depois da leitura,
  `runSync` devolve o estado ao que era antes (mescla desfeita, foto antiga) e a próxima
  sincronização fecha certo. Por isso `doSync` redesenha a tela também no erro (os objetos
  dos leitos são trocados) e nada deve gravar "meio sync" por fora.
- O que vai no push é a diferença (`buildPushDiff`): linhas novas ou com coluna diferente
  (upsert, linha inteira), ids de linhas-filhas que saíram (`painel_problems`,
  `painel_antibiotics`, `painel_cultures`, `painel_devices`, `painel_exams`, `painel_condutas`,
  `painel_raw_texts`) e pacientes apagados no aparelho. Só mexe em filhos de paciente que é
  leito no aparelho. Linha criada no banco depois da leitura não é apagada (chega na
  sincronização seguinte). Exame de laboratório não tem identidade por `id`: é data + nome +
  valor, na mescla e no diff — linha igual fica no banco com o id que já tem.
- Antes de tirar a foto, o app confere o que o banco devolveu com o que enviou (`verifyPush`).
  `painel_sync_push` grava só as colunas enviadas (as chaves da linha que existem na tabela):
  coluna nova não exige mexer na função, mas o app tem de enviá-la E recebê-la de volta igual
  — valor que o banco transforma (ex.: data fora do formato `AAAA-MM-DD`) faz a conferência
  falhar.
- `painel_sync_pull` não traz os filhos de paciente `'nuvem'` (só a linha do paciente).
- Edições da IA no banco (criar/editar/deletar linhas) são MESCLADAS na próxima sincronização
  do app — podem ser feitas a qualquer momento. Deleções de linhas pela IA propagam aos
  aparelhos; conflito na mesma linha: a versão do aparelho que sincronizar por último vence.
- `painel_notes` é upsert por `patient_id`. `painel_generated_docs` só cresce (o app nunca
  apaga no push). Nunca altere `painel_patients.id`.
- `painel_evolucoes` entra na mesma mescla three-way, mas a identidade da linha é a **data**
  (não o `id`) e a gravação é upsert em `(patient_id, data)` — o app nunca faz delete nessa
  tabela. O mesmo dia criado pela IA e no aparelho vira uma linha só (conteúdo: regra de
  conflito de sempre; `id`: o do banco).
- Os campos do paciente têm three-way POR CAMPO (um hash por campo na foto,
  `syncBase[id].fields`; lista em `PATIENT_SCALAR_FIELDS` + `PATIENT_TEXT_FIELDS`): leito,
  idade, admissão, `hpp`, `anamnese_inicial`, `discharge_forecast`, status + `discharge_date`
  (um bloco só), `person_id`, `queda_orientada`, `alergias`, `medicacoes_previas` e a anotação
  (`painel_notes`).
  A IA pode preencher um campo mesmo que o aparelho tenha editado outros; só perde se o
  aparelho editou AQUELE campo. Campo novo no paciente entra nessa lista, com hash próprio —
  nunca no hash único antigo (`localScalarsHash`, mantido só para ler fotos antigas) — e com
  `notInLegacyHash`, como `queda_orientada`: na primeira sincronização após a atualização a
  foto ainda não tem o hash do campo, e sem essa marca o valor do aparelho seria trocado pelo
  default do banco.
- `painel_condutas.ordem` guarda a posição na lista (o push grava 0, 1, 2...; o pull chega
  em ordem de chave primária e é reordenado por ela). Nula = fim da lista.
- A leitura vem inteira numa consulta só (`painel_sync_pull`: uma foto só do banco, cada
  tabela em ordem de chave primária). Lendo tabela direto, a API devolve no máximo ~1000
  linhas por requisição sem erro, e uma tabela truncada seria lida pela mescla como deleção
  remota (o push então apagaria de verdade). Nunca volte a um `select('*')` simples no sync.
- Leito com nome sempre tem `patientId` na hora do sync (`ensurePatientIds`, no início de
  `runSync` e de `mergeStates`): o leito nasce vazio e sem id, e o push pula leito sem id.
- O nome completo só existe no aparelho onde foi digitado. Aparelho que recebe o paciente do
  banco mostra as iniciais no lugar do nome (`bed.initialsPlaceholder`) e devolve ao banco as
  MESMAS iniciais (`bedInitials`); nunca recalcule iniciais a partir de `patientName` sem passar
  por `bedInitials` — "AB" viraria "A" e o aparelho seguinte receberia uma letra só. Para saber
  se o aparelho tem o nome de verdade, use `knownPatientName` (`tests/iniciais.test.cjs`).
- `painel_patients.status` inclui `'nuvem'` = paciente guardado só no banco (nenhum aparelho
  tem leito dele). Não mude status para/de `'nuvem'` por conta própria; o app gerencia isso.
  No aparelho ele vive só no registro `state.cloudArchived` (com o nome completo, que não
  existe em outro lugar) — tanto na mescla quanto no "Resetar e receber" (`keepInCloudRegistry`).

## Desenvolvimento

- Testes: `node --test` (sempre rodar após mexer em `painel-core.js`).
- O app deve continuar funcionando 100% offline em `file://` — não introduza ES modules nem dependências de build. A biblioteca supabase-js é carregada sob demanda (lazy) só quando o usuário sincroniza, em versão fixa e com `integrity` (`SUPABASE_LIB_URL` / `SUPABASE_LIB_SRI` no `index.html`): ao atualizar, troque a versão e o hash juntos, e use o arquivo original do pacote (o `.min.js` do jsDelivr é gerado na hora e não serve para integridade).
- A lógica de sync é prefix-agnóstica em `painel-core.js` (chaves lógicas `patients`, `problems`, ...); o mapeamento para os nomes físicos `painel_*` é feito no `index.html` via a constante `TABLE_PREFIX`.
- Schema: `supabase/migrations/`. Mudanças de schema exigem migration nova + atualização de `buildPushPayload`/`applyPull` + testes. Tabela nova no sync entra também em `painel_sync_pull`, em `painel_sync_push` e no banco de mentira dos testes (`tests/helpers/fake-db.cjs`, que imita as duas funções).
- Classes Tailwind novas em `index.html` exigem regenerar o CSS: `npx tailwindcss@3 -o styles.css --content ./index.html --minify`. Ao mudar arquivos do app, suba a versão do cache em `sw.js` e, junto, `APP_VERSION` no `index.html` (o número que o menu ⋯ mostra; `tests/sw.test.cjs` confere que são iguais).
- Cores e componentes: use os tokens `--c-*` (`:root` no `<style>` do `index.html`) e as classes `.btn`, `.chip`, `.card`, `.field`, `.mark`, em vez de cores soltas do Tailwind. Variação é modificador (`.btn-sm`, `.chip-warn`), nunca um utilitário por cima (o `<style>` vem depois do `styles.css` e vence).
- Cada papel de cor (primária, sucesso, atenção, perigo, neutra) tem um significado só: âmbar é só "atenção", vermelho é perigo, índigo e roxo não são cor de botão. Não reintroduza cor solta do Tailwind que reprova no contraste (`tests/tela.test.cjs` proíbe `text-slate-400`, `text-sky-600`, `bg-sky-600`, `shadow-lg`...). Exceção documentada: na tabela de labs, valor alto em vermelho e baixo em azul; as setas ▲▼ ficam cinza.
- `showConfirm(mensagem, aoConfirmar, título, tom, textoDoBotão)` recebe um tom (`'perigo'`, `'primaria'`, `'neutro'`), não uma classe. Apaga ou substitui dados → `'perigo'`.
- Modal novo: `role="dialog"`, `aria-modal="true"` e rótulo (`aria-labelledby` no `<h3>`), entra em `MODAL_IDS` e abre e fecha só por `showModal` / `hideModal`, que levam o foco para dentro, prendem o Tab e devolvem o foco a quem abriu; Esc fecha (`closeAllModals`). Botão só de ícone tem `aria-label`; ✕ de lista tem 44 px e o padrão `opacity-60 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100`.
- Gravação que só toca dado local (flags `is*Minimized`, visita, checks diários, lembrete, médico externo, tarefas, exames fixados, sugestões) usa `saveData(state, { localOnly: true })`: não acende "alterações a enviar" no Sincronizar. Na dúvida, grave sem a opção (o pior caso é o aviso aceso à toa). A Queda vai para o banco: sem `localOnly`.
- Mensagens ao usuário passam por `avisar(msg, { tom, fixo })` (ou `setSyncStatus`), visível nas três telas. Menus são folhas de ações: `openSheet(id, gatilho)` / `closeSheet()` (marcação `.sheet` > `.sheet-backdrop` + `.sheet-panel` com `.sheet-item`); a folha tem entrada própria no histórico, e o voltar do aparelho só a fecha.
- Elemento fora dos templates (cabeçalho do paciente e menu ⋯, barra de atalhos, folhas, rodapés) liga o listener uma vez, na carga, e lê `currentPatientIndex` na hora do toque — nunca dentro de `renderScreenB`, que roda a cada edição e acumularia um listener por redesenho.
- Campo de texto de lista (descrição e plano do problema, item do HPP, conduta, tarefa) é `<div class="grow-wrap …"><textarea rows="1" class="…">`, escrito literalmente no template (o `tests/html-refs.test.cjs` só enxerga classes em `class="…"`), ligado por `bindGrowField`: uma linha lógica (Enter sai, quebra colada vira espaço via `umaLinha`) e altura por CSS, sem medir. Não volte a `<input>` nem a `autoResizeTextarea` nesses campos.
- Service worker: tudo o que é do próprio app é network-first (o cache é só a reserva offline), para o `index.html` e o `painel-core.js` virem sempre da mesma versão; só CDNs são cache-first. Não volte a servir o JS do app do cache (`tests/sw.test.cjs`).
- Regra de tela que dá para testar mora no core, não no `index.html`: contagem de dias e datas (`dayNumber`, `formatDateBR`), selo do antibiótico (`atbBadge`), check de Queda (`showsQuedaCheck`), checks diários (`DAILY_CHECKS`), seta de tendência dos labs (`tendenciasLab`, entrada em ordem cronológica), legenda do Sincronizar (`estadoDoSync`), progresso do dia (`progressoDoDia` / `fraseProgresso` / `fraseArquivados`), pendências por leito (`agruparPendencias`, com `gravidade` e `curto` em `buildPendencias`), limiares de alerta (`LIMIARES`), cor do chip do médico externo (`corDoMedico`), cartão do leito (`estadoDoLeito`, `statusAltaPrevista`, `selosDoCartao`), tela do paciente (menu ⋯ `acoesDoRegistro`, chip `chipAdmissao`, controles `seloControle` / `linhaControle` / `fimPrevistoAtb`, resumo da seção fechada `resumoSecao`, `umaLinha`, janela de labs `janelaLabs` / `rotuloFiltroLabs`, ‹ › `vizinhosNaLista`, aviso de iniciais `avisoIniciais`) e exames fixados (`pinnedExamIndex` / `sortExamNames` / `togglePinnedExam`, sempre sem diferenciar maiúsculas). Não recrie cópias locais (`tests/tela.test.cjs`).
- Elemento que sai do HTML: `tests/html-refs.test.cjs` falha se o script ainda procurar o `id` (`getElementById`) ou a classe (`querySelector`, `closest`...). Mova o elemento com o `id` e o listener juntos.
- Capturas de tela: `node tools/captura/capturar.cjs <tela> [--largura=N] [--altura=N] [--cheia] [--toque]` (telas em `tools/captura/abre-tela.js`; saída em `tools/captura/saida/`, fora do git). Sempre com o estado fictício de `tools/captura/estado-ficticio.js` — nunca dado real. Sem `--toque` o Edge se apresenta como computador e esconde o que só aparece no hover.
- Leitura de labs (`labNumber`): ponto + 3 dígitos é milhar (`7.350` = 7350), exceto `0.xxx`, que é decimal. Valores e faixas aceitam negativo (`BE -2,5`, `BE: -2-2`).
- Toda operação de sync roda com a tela bloqueada (`lockScreen` / `unlockScreen`): a mescla troca os objetos do estado, e uma edição feita no meio se perderia.
