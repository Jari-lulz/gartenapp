// Service Worker: holt immer die neueste Version aus dem Netz (am Browser-Zwischenspeicher vorbei),
// und nimmt nur ohne Netz (z. B. hinten im Garten) die zuletzt gespeicherte Version.
const CACHE = 'garten-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // Alte Zwischenspeicher aufräumen
  for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      // „no-cache“: beim Server nachfragen, ob es etwas Neues gibt
      const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch {
      return (await caches.match(req)) || (await caches.match('./')) || Response.error();
    }
  })());
});
