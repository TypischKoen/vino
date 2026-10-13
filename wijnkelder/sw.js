// Offline-ondersteuning: de app zelf komt uit de cache, data van API's altijd live.
const VERSION = 'wijnkelder-v3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/ai.js', 'js/ai-claude.js', 'js/ai-gemini.js', 'js/prompts.js', 'js/wine.js', 'js/scan.js', 'js/image.js', 'js/weather.js',
  'vendor/anthropic.js', 'vendor/barcode.js', 'vendor/zxing_reader.wasm',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Fonts: eenmaal ophalen en bewaren
  if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.open(VERSION).then(async (c) => (await c.match(e.request)) ?? fetch(e.request).then((r) => { c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return; // Claude, Open Food Facts, weer: altijd live
  // Eigen bestanden: snel uit de cache, op de achtergrond verversen
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => cached);
    return cached ?? fresh;
  }));
});
