const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Bug: a navegação era network-first, mas painel-core.js/styles.css saíam do cache. Na
// primeira abertura após um deploy o index.html NOVO rodava com o painel-core.js ANTIGO
// ("PainelCore.fetchAllRows is not a function"). Além disso, uma resposta de erro do
// servidor era gravada como o index.html offline.

const SCOPE = 'https://app.test/Painel/';
const SW_SRC = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function response(body, status) {
  status = status == null ? 200 : status;
  return { body: body, status: status, ok: status >= 200 && status < 300, type: 'basic', clone: function () { return this; } };
}
function keyOf(req) { return new URL(typeof req === 'string' ? req : req.url, SCOPE).href; }

// Carrega o sw.js num contexto isolado. `network(url, init)` devolve uma resposta ou lança
// (offline); `cached` = { url relativa ao escopo: corpo } já presente no cache.
function loadSW(network, cached) {
  const listeners = {};
  const store = new Map();
  Object.keys(cached || {}).forEach(function (k) { store.set(keyOf(k), response(cached[k])); });
  const fetchCalls = [];
  const cache = {
    put: function (req, res) { store.set(keyOf(req), res); return Promise.resolve(); },
    addAll: function () { return Promise.resolve(); },
  };
  const sandbox = {
    self: {
      addEventListener: function (type, fn) { listeners[type] = fn; },
      location: { origin: new URL(SCOPE).origin, href: SCOPE + 'sw.js' },
      skipWaiting: function () {}, clients: { claim: function () {} },
    },
    caches: {
      open: function () { return Promise.resolve(cache); },
      match: function (req) { return Promise.resolve(store.get(keyOf(req))); },
      keys: function () { return Promise.resolve([]); },
      delete: function () { return Promise.resolve(true); },
    },
    fetch: function (req, init) {
      fetchCalls.push({ url: keyOf(req), init: init });
      try { return Promise.resolve(network(keyOf(req), init)); } catch (e) { return Promise.reject(e); }
    },
    URL: URL, Request: Request, Promise: Promise, console: console,
  };
  vm.runInNewContext(SW_SRC, sandbox);

  async function request(url, mode) {
    const event = {
      request: { method: 'GET', url: keyOf(url), mode: mode || 'no-cors' },
      respondWith: function (p) { this.response = p; },
    };
    listeners.fetch(event);
    const res = event.response === undefined ? undefined : await event.response;
    await new Promise(function (r) { setImmediate(r); }); // deixa a gravação no cache terminar
    return { intercepted: event.response !== undefined, res: res };
  }
  return { request: request, store: store, fetchCalls: fetchCalls };
}

const offline = function () { throw new TypeError('Failed to fetch'); };

test('arquivo do app: a rede vence o cache (HTML novo nunca roda com core antigo)', async () => {
  const sw = loadSW(function () { return response('core NOVO'); }, { './painel-core.js': 'core ANTIGO' });
  const out = await sw.request('./painel-core.js');
  assert.strictEqual(out.res.body, 'core NOVO');
  assert.strictEqual(sw.store.get(keyOf('./painel-core.js')).body, 'core NOVO', 'cache offline atualizado');
});

test('arquivo do app: revalida com o servidor em vez de aceitar o cache HTTP', async () => {
  const sw = loadSW(function () { return response('x'); });
  await sw.request('./styles.css');
  await sw.request('./', 'navigate');
  assert.deepStrictEqual(sw.fetchCalls.map(function (c) { return c.init && c.init.cache; }), ['no-cache', 'no-cache']);
});

test('arquivo do app offline: cai no cache', async () => {
  const sw = loadSW(offline, { './painel-core.js': 'core em cache' });
  const out = await sw.request('./painel-core.js');
  assert.strictEqual(out.res.body, 'core em cache');
});

test('navegação offline: serve o index.html do cache', async () => {
  const sw = loadSW(offline, { './index.html': 'app em cache' });
  const out = await sw.request('./', 'navigate');
  assert.strictEqual(out.res.body, 'app em cache');
});

test('navegação com erro do servidor: não grava o erro como index.html e serve o cache', async () => {
  const sw = loadSW(function () { return response('502 Bad Gateway', 502); }, { './index.html': 'app em cache' });
  const out = await sw.request('./', 'navigate');
  assert.strictEqual(out.res.body, 'app em cache');
  assert.strictEqual(sw.store.get(keyOf('./index.html')).body, 'app em cache');
});

test('erro do servidor sem cópia em cache: devolve a própria resposta (não inventa)', async () => {
  const sw = loadSW(function () { return response('404', 404); });
  const out = await sw.request('./painel-core.js');
  assert.strictEqual(out.res.status, 404);
  assert.strictEqual(sw.store.has(keyOf('./painel-core.js')), false, 'erro não entra no cache');
});

test('navegação bem-sucedida atualiza o index.html do cache', async () => {
  const sw = loadSW(function () { return response('app NOVO'); }, { './index.html': 'app ANTIGO' });
  const out = await sw.request('./', 'navigate');
  assert.strictEqual(out.res.body, 'app NOVO');
  assert.strictEqual(sw.store.get(keyOf('./index.html')).body, 'app NOVO');
});

test('CDN (versão fixa na URL): cache primeiro, sem esperar a rede', async () => {
  const url = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
  const sw = loadSW(offline, { [url]: 'lib em cache' });
  const out = await sw.request(url, 'cors');
  assert.strictEqual(out.res.body, 'lib em cache');
});

test('API do Supabase nunca é interceptada', async () => {
  const sw = loadSW(function () { return response('x'); });
  const out = await sw.request('https://kuhymtikommkoupynhkj.supabase.co/rest/v1/painel_patients');
  assert.strictEqual(out.intercepted, false);
  assert.strictEqual(sw.fetchCalls.length, 0);
});
