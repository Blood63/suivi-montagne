// Service worker de « Suivi montagne ».
// Plusieurs applis partagent l'origine blood63.github.io (ex. « Ma bibliothèque ») : on ne touche QU'AUX caches
// préfixés « suivi-montagne- » (jamais aux caches des autres applis).
const PREFIX = 'suivi-montagne-';
const CACHE = PREFIX + 'v5';            // fichiers de l'appli (renouvelé à chaque version)
const EXT = PREFIX + 'ext-v1';          // polices + moteur OCR Tesseract (stables, conservés entre versions)
const KEEP = [CACHE, EXT];
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const EXT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url), origin = url.origin;
  // Polices et moteur OCR (versions figées dans l'URL) : cache d'abord, pour fonctionner hors-ligne
  if (EXT_HOSTS.includes(origin)) {
    if (origin === 'https://cdn.jsdelivr.net' && !/tesseract/i.test(url.pathname)) return;
    e.respondWith(caches.open(EXT).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()).catch(() => {});
      return r; }))));
    return;
  }
  if (origin !== self.location.origin) return; // ne jamais intercepter/mettre en cache l'API GitHub
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); }
      return r;
    }).catch(() => caches.open(CACHE).then(c => c.match(e.request, {ignoreSearch: true}).then(r => r || c.match('./index.html'))))
  );
});
