// Service worker de « Suivi montagne ».
// Plusieurs applis partagent l'origine blood63.github.io (ex. « Ma bibliothèque ») : on ne touche QU'AUX caches
// préfixés « suivi-montagne- » (jamais aux caches des autres applis).
const PREFIX = 'suivi-montagne-';
const CACHE = PREFIX + 'v25';            // fichiers de l'appli (renouvelé à chaque version)
const EXT = PREFIX + 'ext-v2';          // polices + moteur OCR Tesseract + Leaflet (stables ; v2 : réponses CORS pour la vérification d'intégrité)
const TILES = PREFIX + 'tiles-v1';       // v23 : tuiles OSM préparées à la demande (« Préparer hors-ligne »), remplies par la page
const KEEP = [CACHE, EXT, TILES];
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './img/sommets/barrhorn.webp', './img/sommets/cabaliros.webp', './img/sommets/chaine-des-puys.webp', './img/sommets/grande-sassiere.webp', './img/sommets/pic-du-midi-artigues.webp', './img/sommets/pic-du-midi-tourmalet.webp', './img/sommets/puy-de-dome.webp', './img/sommets/puy-de-la-vache.webp', './img/sommets/rhune.webp', './img/sommets/sancy.webp', './img/sommets/sancy-cretes.webp', './img/sommets/taillon.webp'];
const EXT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
// v22 : si une autre appli du site a vidé les caches, on recrée le nôtre (message envoyé par la page au démarrage)
self.addEventListener('message', e => {
  if (e.data !== 'ensure-cache') return;
  e.waitUntil(caches.has(CACHE).then(ok => ok ? null : caches.open(CACHE).then(c => c.addAll(ASSETS))).catch(() => {}));
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
  // Tuiles OSM : servies depuis le cache si la zone a été préparée, sinon réseau (aucun téléchargement automatique)
  if (origin === 'https://tile.openstreetmap.org') {
    e.respondWith(caches.open(TILES).then(c => c.match(e.request.url).then(hit => hit || fetch(e.request))));
    return;
  }
  if (EXT_HOSTS.includes(origin)) {
    if (origin === 'https://cdn.jsdelivr.net' && !/(tesseract|leaflet@1\.9\.4)/i.test(url.pathname)) return; // OCR + Leaflet figés : mis en cache ; le reste passe sans interception
    e.respondWith(caches.open(EXT).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok || (r.type === 'opaque' && origin !== 'https://cdn.jsdelivr.net')) c.put(e.request, r.clone()).catch(() => {});
      return r; }))));
    return;
  }
  if (origin !== self.location.origin) return; // ne jamais intercepter/mettre en cache l'API GitHub
  // Réseau d'abord (version à jour), mais si le réseau ne répond pas en 4 s (montagne, réseau faible) : copie en cache.
  const nav = e.request.mode === 'navigate';
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()).catch(() => {}); return r; });
    const fromCache = () => c.match(e.request, {ignoreSearch: true}).then(r => r || (nav ? c.match('./index.html') : undefined));
    let r = null;
    try { r = await Promise.race([net, new Promise(ok => setTimeout(() => ok(null), 4000))]); } catch (err) { r = null; }
    if (r) return r;
    const hit = await fromCache();
    if (hit) { net.catch(() => {}); return hit; }
    return net; // rien en cache : on attend quand même le réseau
  })());
});
