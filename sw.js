/* Service worker do Caderno de Visitas.
 * Estratégia: TUDO o que é do próprio app (navegação, painel-core.js, styles.css...) é
 * network-first, com o cache só como reserva offline. Assim o index.html e o painel-core.js
 * vêm sempre da mesma versão: servir o JS do cache fazia a primeira abertura após um deploy
 * rodar HTML novo com core antigo. CDNs (supabase-js em versão fixa, fontes) seguem
 * cache-first com atualização em segundo plano.
 * Ao mudar arquivos do app, subir a versão do cache abaixo força a limpeza dos antigos. */
const CACHE = 'caderno-v5';
const APP_SHELL = ['./', './index.html', './styles.css', './painel-core.js', './manifest.json', './icon.svg'];

self.addEventListener('install', (e) => {
  // cache: 'reload' — o pré-cache vem do servidor, nunca de uma cópia velha do cache HTTP.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro; cache se estiver offline ou se o servidor responder com erro (4xx/5xx).
// `no-cache` revalida com o servidor (ETag) em vez de aceitar o cache HTTP — o GitHub Pages
// manda max-age de 10 min, o que deixaria HTML e JS de versões diferentes logo após o deploy.
// Só resposta OK entra no cache: um 502 nunca vira o index.html offline.
function networkFirst(req, cacheKey) {
  const key = cacheKey || req;
  return fetch(req, { cache: 'no-cache' })
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(key, copy));
        return res;
      }
      if (res && res.status >= 400) return caches.match(key).then((cached) => cached || res);
      return res; // redirecionamento opaco etc.: segue como veio
    })
    .catch(() => caches.match(key));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Nunca intercepta a API/auth do Supabase — sync precisa de rede de verdade.
  if (url.hostname.endsWith('.supabase.co')) return;

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, './index.html'));
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
    return;
  }

  // CDNs (supabase-js, fontes): cache-first + refresh em background.
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
