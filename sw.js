// Service worker de « Suivi montagne ».
// Plusieurs applis partagent l'origine blood63.github.io (ex. « Ma bibliothèque ») : on ne touche QU'AUX caches
// préfixés « suivi-montagne- » (jamais aux caches des autres applis).
const PREFIX = 'suivi-montagne-';
const CACHE = PREFIX + 'v38.1';            // fichiers de l'appli (renouvelé à chaque version)
const EXT = PREFIX + 'ext-v2';          // polices + moteur OCR Tesseract + Leaflet (stables ; v2 : réponses CORS pour la vérification d'intégrité)
const TILES = PREFIX + 'tiles-v1';       // v23 : tuiles OSM préparées à la demande (« Préparer hors-ligne »), remplies par la page
const IMG = PREFIX + 'img-v1';           // v38 : photos des sommets + décors du bandeau, gardées d'une version à l'autre (changer le nom d'une image, ou passer à img-v2, pour la renouveler)
const KEEP = [CACHE, EXT, TILES, IMG];
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './img/sommets/barrhorn.webp', './img/sommets/cabaliros.webp', './img/sommets/chaine-des-puys.webp', './img/sommets/grande-sassiere.webp', './img/sommets/pic-du-midi-artigues.webp', './img/sommets/pic-du-midi-tourmalet.webp', './img/sommets/puy-de-dome.webp', './img/sommets/puy-de-la-vache.webp', './img/sommets/rhune.webp', './img/sommets/sancy.webp', './img/sommets/sancy-cretes.webp', './img/sommets/taillon.webp',
  // v26 : décors du bandeau « Le chemin des sommets » + randonneur (hors-ligne)
  './img/jeu/auvergne.webp', './img/jeu/rhune.webp', './img/jeu/sancy-val-enfer.webp', './img/jeu/cabaliros.webp', './img/jeu/sancy-cretes.webp', './img/jeu/midi-tourmalet.webp', './img/jeu/taillon.webp', './img/jeu/gr441.webp', './img/jeu/midi-artigues.webp', './img/jeu/barrhorn.webp', './img/jeu/grande-sassiere.webp', './img/jeu/randonneur.png'];
const isImg = a => /^\.\/img\/(sommets|jeu)\//.test(a);
const IMG_ASSETS = ASSETS.filter(isImg), APP_ASSETS = ASSETS.filter(a => !isImg(a));
// v38 : n'ajoute au cache images que celles qui manquent (pas de re-téléchargement à chaque version) ; échec = installation refusée (l'ancienne version reste active)
const fillImg = () => caches.open(IMG).then(c => Promise.all(IMG_ASSETS.map(a => c.match(a).then(h => h ? null : a))).then(miss => { miss = miss.filter(Boolean); return miss.length ? c.addAll(miss) : null; }));
const EXT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'];
self.addEventListener('install', e => {
  e.waitUntil(Promise.all([caches.open(CACHE).then(c => c.addAll(APP_ASSETS)), fillImg()]).then(() => self.skipWaiting()));
});
// v22 : si une autre appli du site a vidé les caches, on recrée le nôtre (message envoyé par la page au démarrage)
self.addEventListener('message', e => {
  if (e.data !== 'ensure-cache') return;
  e.waitUntil(Promise.all([caches.has(CACHE).then(ok => ok ? null : caches.open(CACHE).then(c => c.addAll(APP_ASSETS))), fillImg()]).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => caches.open(IMG)).then(c => c.keys().then(rs => Promise.all(rs.filter(r => !IMG_ASSETS.some(a => new URL(a, self.registration.scope).href === r.url)).map(r => c.delete(r))))) // images retirées de l'appli
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
  // v38 : images locales (sommets, décors) : cache images d'abord, réseau en repli (mises en cache si la réponse est bonne)
  if (/\/img\/(sommets|jeu)\//.test(url.pathname)) {
    e.respondWith(caches.open(IMG).then(c => c.match(e.request, {ignoreSearch: true}).then(hit => hit || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()).catch(() => {}); return r; })
      .catch(() => caches.match(e.request, {ignoreSearch: true}).then(h => h || Response.error())))));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()).catch(() => {}); return r; });
    const fromCache = () => c.match(e.request, {ignoreSearch: true}).then(r => r || (nav ? c.match('./index.html') : undefined));
    let r = null;
    try { r = await Promise.race([net, new Promise(ok => setTimeout(() => ok(null), 4000))]); } catch (err) { r = null; }
    if (r && r.ok) return r; // v38 : erreur serveur (404, 5xx…) → copie en cache si elle existe
    const hit = await fromCache();
    if (hit) { net.catch(() => {}); return hit; }
    return net; // rien en cache : on attend quand même le réseau
  })());
});
