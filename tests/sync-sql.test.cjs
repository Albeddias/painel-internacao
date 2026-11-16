const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PainelCore = require('../painel-core.js');

// As duas funções do banco que o Sincronizar chama. O SQL em si é conferido no banco
// (dentro de uma transação desfeita); aqui ficam as amarras entre o SQL e o app, que
// quebrariam em silêncio se um lado mudasse sem o outro.
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '010_painel_sync_rpc.sql'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const body = (name) => {
  const m = sql.match(new RegExp('create or replace function public\\.' + name + '\\b[\\s\\S]*?\\n\\$\\$;'));
  assert.ok(m, 'função ' + name + ' não encontrada na migration');
  return m[0];
};

test('as duas funções rodam com as permissões de quem chama (RLS vale) e sem search_path herdado', () => {
  ['painel_sync_pull', 'painel_sync_push'].forEach(name => {
    const fn = body(name);
    assert.match(fn, /security invoker/, name);
    assert.match(fn, /set search_path = ''/, name);
    assert.doesNotMatch(fn, /security definer/, name);
  });
});

test('só usuário logado executa as funções', () => {
  ['painel_sync_pull()', 'painel_sync_push(jsonb)'].forEach(sig => {
    const s = sig.replace(/[()]/g, '\\$&');
    assert.match(sql, new RegExp('revoke all on function public\\.' + s + ' from public, anon;'), sig);
    assert.match(sql, new RegExp('grant execute on function public\\.' + s + ' to authenticated;'), sig);
  });
});

test('a leitura devolve todas as tabelas que a mescla lê', () => {
  const fn = body('painel_sync_pull');
  ['patients', 'problems', 'antibiotics', 'cultures', 'devices', 'exams', 'condutas', 'raw_texts',
    'evolucoes', 'notes', 'generated_docs', 'prefs'].forEach(t => {
    assert.match(fn, new RegExp("'" + t + "',"), 'chave ' + t);
    assert.match(fn, new RegExp('public\\.painel_' + t + '\\b'), 'tabela painel_' + t);
  });
  assert.match(fn, /\bstable\b/, 'uma consulta só = uma foto só do banco');
});

test('a gravação cobre todas as tabelas que o diff envia e remove', () => {
  const fn = body('painel_sync_push');
  const diff = PainelCore.buildPushDiff(PainelCore.buildPushPayload(PainelCore.migrateState({ beds: [] }, '2026-11-15')), {});
  Object.keys(diff.upsert).concat(Object.keys(diff.remove)).forEach(t => {
    assert.match(fn, new RegExp("'" + t + "'"), 'tabela ' + t);
  });
  assert.match(fn, /deletePatientIds/);
  assert.match(fn, /'evolucoes',\s*array\['patient_id', 'data'\],\s*array\['id'\]/, 'evolução: conflito no dia, id do banco preservado');
});

test('o app sincroniza pelas duas funções — nenhuma leitura ou gravação de tabela solta no sync', () => {
  assert.match(html, /sync_pull/);
  assert.match(html, /sync_push/);
  assert.match(html, /PainelCore\.runSync\(/);
  assert.doesNotMatch(html, /\.select\('\*'/, "select('*') direto voltou");
  assert.doesNotMatch(html, /\.upsert\(/, 'gravação fora da transação voltou');
  assert.doesNotMatch(html, /\.insert\(/, 'gravação fora da transação voltou');
});
