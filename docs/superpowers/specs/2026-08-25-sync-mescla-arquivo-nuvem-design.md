# Design: Sincronização com mescla por linha + Arquivar na nuvem

**Data:** 2026-08-25
**Status:** Aprovado pelo usuário (design em chat); spec aguardando revisão final

## Contexto

O sync atual é "fotografia inteira, a última vence": o **Enviar** manda todos os pacientes do aparelho (delete+insert dos filhos por paciente) e o **Receber** substitui os dados locais de todo paciente sincronizado pela versão do banco. Com dois dispositivos (ou IA editando o banco), isso perde dados silenciosamente.

Incidente real que motivou o projeto: o usuário inseriu exames no paciente do leito 1015 pelo celular, precisou tocar Receber para baixar textos de prontuário de outros pacientes, e o pull apagou os exames do 1015 (ainda não enviados). Se tivesse tocado Enviar antes, as cópias locais desatualizadas dos outros pacientes teriam sobrescrito os textos no banco.

### Decisões de requisito (entrevista)

- **Conflito no mesmo paciente:** mesclar por linha. Prioridade são as coleções linha a linha (problemas, ATBs, culturas, dispositivos, exames, condutas, textos crus); campos de texto corrido (HPP, anamnese, evolução/notas) podem usar regra simples (dono da última modificação vence o campo inteiro).
- **Botões:** unificar Enviar/Receber em um único **Sincronizar** (baixa → mescla → grava). O botão "reset local + receber limpo do servidor" continua como "botão de pânico".
- **Mecanismo escolhido:** opção A — "última foto sincronizada" guardada no localStorage (three-way merge local × banco × foto). Sem migration, sem `updated_at` por linha, sem lápides no banco. Opções descartadas: B (timestamps + lápides no banco — exige reescrever o push linha a linha, lápides sem critério seguro de expurgo, IA teria que gravar lápides) e C (log de operações — complexidade desproporcional).
- **Extra aprovado:** função **"Guardar só na nuvem"** para pacientes arquivados (remove do aparelho, mantém no banco, restaurável sob demanda).

## Arquitetura da mescla

### A foto (`syncBase`)

Novo bloco no estado local, gravado **somente após uma sincronização gravada com sucesso**:

```
state.syncBase = {
  [patientId]: {
    rows: {
      problems:    { [id]: hash8 },   // hash curto (djb2) do conteúdo da linha
      antibiotics: { [id]: hash8 },
      cultures:    { [id]: hash8 },
      devices:     { [id]: hash8 },
      condutas:    { [id]: hash8 },
      rawTexts:    { [id]: hash8 },
      examsImage:  { [id]: hash8 },
      examsLab:    { [chave]: '' },   // chave de conteúdo: data|nome|valor (hash vazio: a chave É o conteúdo)
    },
    scalars: hash8,  // hash de bed_number, age, admit_date, hpp, anamnese,
                     // discharge_forecast, status e notes (texto da evolução)
  }
}
```

- **Exames de laboratório** não têm id estável no fluxo atual (o push gera uuid novo a cada envio); a identidade deles é a **chave de conteúdo** `data|nome|valor`. Editar um valor = "apagou a linha antiga, criou uma nova", o que produz o resultado correto na mescla.
- Tamanho: só ids + hashes (~40–50 bytes/linha). Ordem de grandeza: 5–10% do tamanho dos dados que o localStorage já guarda. Não é o gargalo (os textos crus são).

### Regras da mescla (por paciente, por tabela, por linha)

| Situação da linha | Interpretação | Resultado |
|---|---|---|
| Só local, ausente da foto | criada neste aparelho | mantém e envia |
| Só no banco, ausente da foto | criada lá (outro aparelho/IA) | adota localmente |
| Na foto (intocada), sumiu localmente | deletada neste aparelho | some do banco |
| Na foto (intocada), sumiu do banco | deletada lá | some do aparelho |
| Sumiu de um lado, mas o outro lado editou (hash ≠ foto) | edição × deleção | a edição vence: a linha fica |
| Nos dois lados, local ≠ foto, banco = foto | editada aqui | local vence |
| Nos dois lados, local = foto, banco ≠ foto | editada lá | banco vence |
| Nos dois lados, ambos ≠ foto | conflito real | local vence (quem sincroniza por último vence **aquela linha**) |

- **Campos corridos (scalars):** hash local ≠ foto → local vence o bloco inteiro de scalars; caso contrário, banco vence. `notes` (evolução) entra nesse bloco.
- **Ordem (`ordem`/posição):** regra simples — linhas que já existiam localmente mantêm a ordem relativa local; linhas adotadas do banco são inseridas segundo a coluna `ordem` delas. O entrelaçamento não precisa ser perfeito: ordem é ajustável por arrasto no app e nunca causa perda de dados.
- **`painel_generated_docs`:** só cresce; pull adota tudo, push não envia nem apaga (inalterado).
- **`painel_notes`:** upsert por `patient_id` (inalterado no servidor); no cliente entra no bloco de scalars.
- **Pacientes** (nível acima das linhas): lógica atual preservada — tombstones locais (`deletedPatientIds`) para deleção, `syncedPatientIds` para detectar deleção remota, paciente novo do banco vira leito com iniciais como nome provisório.

### Fluxo do botão Sincronizar

1. Autentica / obtém cliente Supabase (lazy, como hoje).
2. **Pull** de todas as tabelas (query atual do Receber).
3. `merged = PainelCore.mergeStates(state, pulled)` — função pura, sem I/O.
4. **Push** do estado mesclado com o `buildPushPayload` e a gravação atuais (upsert de patients, delete+insert dos filhos por paciente, upsert de notes, deleções por tombstone). **O lado servidor não muda.**
5. Sucesso confirmado → `state.syncBase = buildSyncBase(merged)`, atualiza `syncedPatientIds`, limpa tombstones enviados, `lastSyncAt`, salva no localStorage.

Falhas:
- Pull falha → nada muda.
- Push falha após pull → o estado local já está mesclado, mas a foto **não** foi atualizada; a próxima sincronização refaz a mescla do zero (idempotente: re-mesclar um estado já mesclado com o mesmo banco não altera nada).
- KNOWN existente (conexão cair entre delete e insert de uma tabela filha) permanece com a mesma mitigação: o aparelho é fonte da verdade e a próxima sincronização reinsere.

### Degradação sem foto

Sem `syncBase` (primeira sincronização após a atualização, localStorage limpo, ou paciente sem entrada na foto): a mescla degrada para **união** — nada é deletado de lado nenhum; linhas iguais dos dois lados com conteúdo diferente: local vence. Falha segura.

Caveat de transição (único, aceito): deleções feitas **antes** da atualização em um aparelho podem ressuscitar uma vez se outro aparelho ainda tinha a linha.

## Arquivar na nuvem

**Correção pós-design (encontrada na leitura do schema):** a marca "só na nuvem" não pode ser apenas local — outro aparelho readotaria o paciente no sync seguinte. A marca vive no banco como novo valor de status: `painel_patients.status = 'nuvem'`. Isso exige uma migration mínima (estender o CHECK de status para incluir `'nuvem'`), a única deste projeto.

- Ação **"Guardar só na nuvem"** em paciente arquivado (alta/arquivado).
- Fluxo: executa uma sincronização completa; **somente se ela concluir com sucesso**, faz `update status='nuvem'` no banco, remove o leito do estado local (sem tombstone) e grava um registro em `state.cloudArchived[id] = { nome, iniciais, leito }` (o nome completo nunca existe no banco — regra inegociável — então ele sobrevive apenas neste registro local, ~60 bytes/paciente).
- Mescla/pull: paciente com status `'nuvem'` nunca vira leito. Se um aparelho ainda tem o leito dele, o leito é movido para o registro local `cloudArchived` daquele aparelho (preservando o nome completo que ele conhecia) — assim a função é simétrica entre dispositivos. `buildPushPayload` não os inclui (não estão em `beds`), logo o delete+insert por paciente não os toca.
- Tela **"Na nuvem"** (na aba de arquivados): lista do registro local `cloudArchived` (nome se o aparelho conhecia, senão iniciais + leito) — sem consulta extra ao banco. **"Trazer de volta"**: `update status='arquivado'` no banco + sincronização — a mescla adota o paciente completo e reencaixa o nome do registro local se existir.
- Paciente deletado do banco enquanto arquivado na nuvem: some da listagem no próximo sync (registro local podado).
- `resetLocalSync` preserva `cloudArchived` (nomes completos são irrecuperáveis do banco).

## Mudanças por arquivo

- **`painel-core.js`** (lógica pura, prefix-agnóstica): `hash8()`, `buildSyncBase(state)`, `mergeStates(state, pulled)`, suporte a `cloudArchived` em `migrateState`, `applyPull`/mescla e nos pontos de readoção. `buildPushPayload` inalterado.
- **`index.html`**: botão único **Sincronizar** (substitui Enviar/Receber), fluxo pull→merge→push, tela de arquivados na nuvem, ação "Guardar só na nuvem", "reset local + receber limpo" mantido. `TABLE_PREFIX` e gravação no Supabase inalterados.
- **`CLAUDE.md`** e memória do projeto: reescrever "Convenções de sync" — morre a regra "edições da IA entre um Enviar e um Receber"; edições da IA no banco são **mescladas** na próxima sincronização (criações e deleções de linhas propagam corretamente). A IA continua sem tocar em `painel_patients.id`.
- **`supabase/migrations/003_painel_status_nuvem.sql`** — única mudança de schema: estende o CHECK de `painel_patients.status` para incluir `'nuvem'`.

## Testes (`node --test`, TDD)

1. Cenário do incidente (nomeado): exames novos locais no paciente A + textos crus novos no banco no paciente B → ambos preservados após mescla.
2. Adição/adição na mesma tabela do mesmo paciente → união.
3. Deleção local propaga ao banco; deleção remota propaga ao aparelho.
4. Edição/edição da mesma linha → local vence; edição só remota → banco vence.
5. Scalars: HPP editado localmente vence; não editado → banco vence.
6. Labs por chave de conteúdo (edição de valor = delete+insert lógico).
7. Sem foto → união, nenhuma deleção.
8. Idempotência: mesclar duas vezes seguidas com o mesmo pull não altera o estado.
9. Tombstones de paciente continuam funcionando (deleção local pendente não ressuscita).
10. Arquivar na nuvem: pull não readota; restaurar readota completo e reencaixa o nome local.
11. Privacidade: payload pós-mescla continua sem nome completo (teste existente estendido ao novo fluxo).

## Fora de escopo

- Sync automático/em tempo real.
- Mescla fina dentro de campos de texto corrido.
- Expurgo/compactação de pacientes antigos no banco.
- Detecção de conflito com aviso ao usuário (a regra "local vence a linha" é silenciosa, por decisão).
