const { test } = require('node:test');
const assert = require('node:assert');
const PainelCore = require('../painel-core.js');

// Bug: a API do Supabase devolve no máximo N linhas por requisição (padrão 1000) SEM erro.
// O pull lia a tabela truncada, a mescla entendia as linhas que faltavam como "apagadas no
// banco" e o push as apagava de verdade. fetchAllRows baixa a tabela inteira, em páginas.

// Servidor de mentira: tabela com `total` linhas e teto de `maxRows` por requisição.
function fakeTable(total, maxRows, opts) {
  opts = opts || {};
  const all = Array.from({ length: total }, function (_, i) { return { id: i }; });
  const calls = [];
  function fetchPage(from) {
    calls.push(from);
    if (opts.failAtCall === calls.length) return Promise.resolve({ data: null, error: new Error('rede caiu'), count: null });
    return Promise.resolve({ data: all.slice(from, from + maxRows), error: null, count: opts.noCount ? null : total });
  }
  return { fetchPage, calls, all };
}

test('fetchAllRows: tabela que cabe em uma página faz uma requisição só', async () => {
  const t = fakeTable(124, 1000);
  assert.deepStrictEqual(await PainelCore.fetchAllRows(t.fetchPage), t.all);
  assert.deepStrictEqual(t.calls, [0]);
});

test('fetchAllRows: acima do teto, busca as páginas seguintes até completar', async () => {
  const t = fakeTable(2350, 1000);
  const rows = await PainelCore.fetchAllRows(t.fetchPage);
  assert.strictEqual(rows.length, 2350);
  assert.deepStrictEqual(rows, t.all, 'todas as linhas, na ordem, sem repetição');
  assert.deepStrictEqual(t.calls, [0, 1000, 2000]);
});

test('fetchAllRows: funciona com qualquer teto do servidor (não presume 1000)', async () => {
  const t = fakeTable(1059, 300);
  assert.strictEqual((await PainelCore.fetchAllRows(t.fetchPage)).length, 1059);
  assert.deepStrictEqual(t.calls, [0, 300, 600, 900]);
});

test('fetchAllRows: total exatamente igual ao teto não pede página a mais', async () => {
  const t = fakeTable(1000, 1000);
  assert.strictEqual((await PainelCore.fetchAllRows(t.fetchPage)).length, 1000);
  assert.deepStrictEqual(t.calls, [0]);
});

test('fetchAllRows: tabela vazia devolve lista vazia', async () => {
  const t = fakeTable(0, 1000);
  assert.deepStrictEqual(await PainelCore.fetchAllRows(t.fetchPage), []);
  assert.deepStrictEqual(t.calls, [0]);
});

test('fetchAllRows: sem contagem do servidor, segue até vir uma página vazia', async () => {
  const t = fakeTable(2350, 1000, { noCount: true });
  assert.strictEqual((await PainelCore.fetchAllRows(t.fetchPage)).length, 2350);
  assert.deepStrictEqual(t.calls, [0, 1000, 2000, 2350]);
});

test('fetchAllRows: erro em qualquer página rejeita — nunca devolve tabela parcial', async () => {
  const t = fakeTable(2350, 1000, { failAtCall: 2 });
  await assert.rejects(PainelCore.fetchAllRows(t.fetchPage), /rede caiu/);
});
