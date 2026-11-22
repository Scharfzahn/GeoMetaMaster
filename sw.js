/* GeoMetaMaster Service Worker
   - App-Shell + Daten: Stale-While-Revalidate (offline nutzbar, Updates kommen beim nächsten Start)
   - Bilder von Wikimedia: Cache-first mit CORS-Fetch (kein "opaque"-Quota-Overhead), max. 400 Einträge
   Bei Änderungen an index.html/app.js/style.css VERSION erhöhen, damit der Shell-Cache neu aufgebaut wird. */
const VERSION = 'v2';
const SHELL = 'geometa-shell-' + VERSION;
const IMGS = 'geometa-img-v1';
const MAX_IMGS = 400;
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'data/cards.json', 'data/world.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('geometa-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_IMGS) await Promise.all(keys.slice(0, keys.length - MAX_IMGS).map(k => cache.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Wikimedia-Bilder
  if (url.hostname === 'upload.wikimedia.org') {
    e.respondWith((async () => {
      const cache = await caches.open(IMGS);
      const hit = await cache.match(url.href);
      if (hit) return hit;
      try {
        const res = await fetch(url.href, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (res.ok) { cache.put(url.href, res.clone()).then(() => trim(cache)); }
        return res;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // Eigene Dateien: erst Cache, parallel aktualisieren
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  })());
});
