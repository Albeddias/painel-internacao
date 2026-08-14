/* Service worker do Caderno de Visitas.
 * Estratégia: navegação network-first (atualizações chegam rápido, cache é o fallback
 * offline); assets cache-first com atualização em segundo plano (stale-while-revalidate).
 * Ao mudar arquivos do app, subir a versão do cache abaixo força a limpeza dos antigos. */
const CACHE = 'caderno-v1';
const APP_SHELL = ['./', './index.html', './styles.css', './painel-core.js', './manifest.json', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Nunca intercepta a API/auth do Supabase — sync precisa de rede de verdade.
  if (url.hostname.endsWith('.supabase.co')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Assets locais e CDNs (supabase-js, fontes): cache-first + refresh em background.
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
