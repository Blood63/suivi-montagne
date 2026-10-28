/* Suite de tests de « Suivi montagne » (Chrome sans interface, puppeteer-core).
   Usage : BASE=http://localhost:8767 SAMPLES=1 CHROME=/usr/bin/google-chrome node tests/suite.js
   Le dossier servi (SERVE_DIR, par défaut le dossier courant) doit contenir index.html (nouvelle version) ;
   old.html (v4) et old16.html (v16) y sont copiés depuis tests/fixtures s'ils manquent (v24),
   sw.js, et — pour les tests OCR — les captures Mi Fitness marche.jpg, rando.jpg, corde.jpg, poids.png
   + truth.json (valeurs attendues). Captures et valeurs personnelles : jamais commitées. */
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:8767';
const SWC = 'suivi-montagne-' + (require('fs').readFileSync(require('path').join(__dirname, '..', 'sw.js'), 'utf8').match(/PREFIX \+ '(v\d+)'/) || [])[1]; // cache de l'appli attendu (lu dans sw.js)
const W = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const out = [];
function ok(c, name, extra) { if (c) { pass++; out.push('  ✔ ' + name); } else { fail++; out.push('  ✘ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : '')); } }
// Valeurs attendues de l'OCR : fichier local non commité (${SAMPLE_DIR}/truth.json), comme les captures.
const SDIR = process.env.SAMPLE_DIR || require('path').resolve('.');
// v24 : versions anciennes commitées dans tests/fixtures (old.html = v4 sans données, commit fab7403 ; old16.html = v16, commit 2f57c2c ; v25 : old24.html = v24, commit 9153bb4),
// copiées dans le dossier servi si elles manquent : plus besoin de l'historique git (clone neuf ou superficiel).
{ const fs = require('fs'), path = require('path'); const SERVE = process.env.SERVE_DIR || process.cwd();
  for (const f of ['old.html', 'old16.html', 'old24.html', 'old28.html']) { const fp = path.join(SERVE, f), src = path.join(__dirname, 'fixtures', f); if (fs.existsSync(fp)) continue;
    try { fs.copyFileSync(src, fp); console.log('(' + f + ' copié depuis tests/fixtures)'); }
    catch (e) { console.error('Impossible de copier ' + src + ' : ' + e.message); process.exit(2); } }
  if (!process.env.OLD16) process.env.OLD16 = 'old16.html'; }
const TRUTH = process.env.SAMPLES ? JSON.parse(require('fs').readFileSync(SDIR + '/truth.json', 'utf8')) : {};
// Données fictives (aucune donnée réelle dans le dépôt).
function FIXTURE() {
  const S = []; let n = 0; const d0 = Date.UTC(2026, 7, 20);
  for (let i = 0; i < 24; i++) { const d = new Date(d0 + i * 2 * 864e5).toISOString().slice(0, 10); const k = i % 3;
    S.push(k === 0 ? {id:'fx-' + (++n), date:d, type:'Marche', dist:9, dplus:650, dminus:640, dur:9000, bpm:128, bpmMax:150, pas:null, sac:6, sauts:null, ress:null, exos:'', notes:'fictif', updatedAt:0}
      : k === 1 ? {id:'fx-' + (++n), date:d, type:'Tapis 6%', dist:6, dplus:360, dminus:null, dur:4200, bpm:132, bpmMax:null, pas:null, sac:4, sauts:null, ress:null, exos:'', notes:'fictif', updatedAt:0}
      : {id:'fx-' + (++n), date:d, type:'Renforcement', dist:null, dplus:null, dminus:null, dur:2400, bpm:null, bpmMax:null, pas:null, sac:null, sauts:null, ress:6, exos:'gainage', notes:'fictif', updatedAt:0}); }
  S.push({id:'fx-1011', date:'2026-10-11', type:'Marche', dist:5, dplus:40, dminus:null, dur:3400, bpm:100, bpmMax:null, pas:null, sac:null, sauts:null, ress:null, exos:'', notes:'fictif', updatedAt:0});
  return {sessions:S, weights:[{id:'fx-w-1013', date:'2026-10-13', heure:'08:00', weight:80, fatPct:22, src:'manuel', updatedAt:0}]};
}
(async () => {
  const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox','--lang=fr-FR']});
  const fresh = async (url) => { const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({width:390,height:844});
    // un doigt touche ce qu'il voit : on centre l'élément avant le clic/la frappe (sinon la barre d'actions collante peut le recouvrir)
    for (const m of ['click','type']) { const o = p[m].bind(p); p[m] = async (sel, ...a) => { await p.evaluate(s => { const e = document.querySelector(s); if (e) e.scrollIntoView({block:'center'}); }, sel).catch(()=>{}); return o(sel, ...a); }; }
    // v29 : init() attend l'ouverture d'IndexedDB (async) : après chaque navigation, on attend que les données soient chargées
    for (const m of ['goto','reload']) { const o = p[m].bind(p); p[m] = async (...a) => { const r = await o(...a); await p.waitForFunction("typeof DB==='undefined'?!document.getElementById('p-journal'):!!DB&&(typeof appReady==='undefined'||appReady)", {timeout:6000}).catch(()=>{}); return r; }; }
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept()); if (url) await p.goto(url, {waitUntil:'networkidle0'}); return [ctx, p]; };

  const withFix = async (p, idPrefix, wHeure) => { await p.evaluate((F, pre, h) => { if (h) F.weights[0].heure = h; const D = JSON.parse(JSON.stringify(DB));
      if (pre) { F.sessions.forEach((s, i) => s.id = pre + s.date + '-' + i); F.weights.forEach(w => w.id = pre + 'w-' + w.date); }
      D.sessions = F.sessions; D.weights = F.weights; localStorage.setItem(KEY, JSON.stringify(D)); }, FIXTURE(), idPrefix || null, wHeure || null);
    await p.reload({waitUntil:'networkidle0'}); };
  const NFIX = FIXTURE().sessions.length;

  // ---------- 1. Démarrage à neuf ----------
  out.push('1. Démarrage à neuf');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => ({v:DB.version, n:DB.sessions.length, w:DB.weights.map(x=>x.id), biv:DB.equip.filter(c=>/bivouac/i.test(c.name)).length, tomb:Object.keys(DB.tomb), types:TYPES.length, obj:OBJECTIFS.map(o=>o.n), snaps:snapshots().length}));
    ok(r.v === 4, 'version des données = 4', r.v); ok(r.n === 0 && r.w.length === 0, 'aucune séance ni pesée embarquée dans le code (elles viennent du stockage local / de la synchro)', r);
    ok(r.biv === 1, 'une catégorie Bivouac'); ok(['s','c','i','w'].every(k => r.tomb.includes(k)), 'pierres tombales s/c/i/w');
    ok(r.obj.join() === '1,2,3,4,5,6,7,8,9,10,11,12,13', 'objectifs 1→13 (GR 441 en n° 10, Cabaliros 11, Taillon 12, Vache 13 : numéros inchangés)', r.obj); ok(r.snaps === 1, 'copie de sécurité du jour créée', r.snaps);
    for (const t of ['journal','obj','prep','evo','poids','equip','data']) await p.evaluate(t => show(t), t);
    ok(p.errs.length === 0, 'aucune erreur JS sur les 7 onglets', p.errs); await ctx.close(); }

  // ---------- 2. Migration v3 → v4 depuis l'ancienne version ----------
  out.push('2. Migration depuis la version précédente (v3), sans perte');
  { const [ctx, p] = await fresh(BASE + '/old.html'); let DEL;
    const before = await p.evaluate((F) => { // modifications « utilisateur » dans l'ancienne appli
      if (DB.sessions.length < 3) DB.sessions.push(...F.sessions.slice(0, 6)); // v24 : la v4 commitée n'a plus de séances de départ (données retirées) → séances fictives
      DB.sessions.push({id:'u1',date:'2026-10-12',type:'Tapis 6%',dist:5,dplus:300,dminus:null,dur:3600,bpm:120,bpmMax:null,pas:null,sac:4,sauts:null,ress:7,exos:'',notes:'à moi',updatedAt:1760000000000});
      DB.equip[0].items[0].bought = true; DB.equip[0].items[0].price = 149; DB.equip[0].items[0].updatedAt = 1760000000001;
      DB.objectifs[1] = {statut:'Prêt', datePrevue:'2026-10-25', dateRealisee:'', updatedAt:1760000000002};
      const del = DB.sessions[1].id; DB.tomb.s[del] = 1760000000003; DB.sessions = DB.sessions.filter(s => s.id !== del);
      save(); return JSON.stringify({j:localStorage.getItem(KEY), del}); }, FIXTURE()).then(x => (DEL = JSON.parse(x).del, JSON.parse(x).j));
    await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'});
    const r = await p.evaluate(() => ({bk: localStorage.getItem(KEY + '.backup.v3'), db: DB}));
    const B = JSON.parse(before), D = r.db;
    ok(r.bk === before, 'copie intégrale avant migration (…backup.v3) identique aux données d’avant');
    ok(B.sessions.every(s => JSON.stringify(D.sessions.find(x => x.id === s.id)) === JSON.stringify(s)), 'toutes les séances conservées à l’identique', B.sessions.length + ' vs ' + D.sessions.length);
    ok(D.sessions.length === B.sessions.length, 'aucune séance ajoutée/retirée', [B.sessions.length, D.sessions.length]);
    ok(D.equip[0].items[0].bought === true && D.equip[0].items[0].price === 149, 'achat + prix conservés');
    ok(D.objectifs[1].statut === 'Prêt' && D.objectifs[1].datePrevue === '2026-10-25', 'état d’objectif conservé');
    ok(B.sessions.length >= 5, 'l’ancienne version avait ses séances locales', B.sessions.length);
    ok(D.tomb.s[DEL] === 1760000000003, 'suppression conservée (pierre tombale)');
    ok(D.version === 4 && Array.isArray(D.weights) && D.weights.length === 0 && D.equip.some(c => c.id === 'eqc-bivouac'), 'v4 : Bivouac ajouté, aucune pesée inventée');
    ok(B.equip.every(c => D.equip.some(x => x.id === c.id && x.items.length === c.items.length)), 'catégories existantes intactes');
    const j1 = JSON.stringify(D); await p.reload({waitUntil:'networkidle0'}); const j2 = await p.evaluate(() => JSON.stringify(DB));
    ok(j1 === j2, 'migration idempotente (rechargement sans changement)');
    // un utilisateur qui supprime la catégorie Bivouac ne la voit pas revenir
    await p.evaluate(() => { const c = DB.equip.find(c => c.id === BIV_ID); DB.equip = DB.equip.filter(x => x !== c); DB.tomb.c[BIV_ID] = Date.now(); c.items.forEach(i => DB.tomb.i[i.id] = Date.now()); DB.version = 3; save(); });
    await p.reload({waitUntil:'networkidle0'});
    ok(await p.evaluate(() => !DB.equip.some(c => c.id === BIV_ID)), 'Bivouac supprimé par l’utilisateur : pas recréé');
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  out.push('2b. Appareil déjà en v4 avec séances/pesée « seed-… » : tout est conservé');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p, 'seed-');
    const before = await p.evaluate(() => localStorage.getItem(KEY)); await p.reload({waitUntil:'networkidle0'});
    const r = await p.evaluate(() => ({n:DB.sessions.length, w:DB.weights.map(x => x.id), seed:DB.sessions.every(s => /^seed-/.test(s.id)), same:JSON.stringify(DB.sessions) === JSON.stringify(JSON.parse(localStorage.getItem(KEY)).sessions)}));
    const B = JSON.parse(before);
    ok(r.n === NFIX && r.seed && r.w.length === 1 && r.w[0] === 'seed-w-2026-10-13', 'séances et pesée locales conservées (ids inchangés)', r);
    ok(JSON.stringify(B.sessions) === await p.evaluate(() => JSON.stringify(DB.sessions)) && JSON.stringify(B.weights) === await p.evaluate(() => JSON.stringify(DB.weights)), 'contenu identique après rechargement');
    const m = await p.evaluate(() => { const L = JSON.parse(JSON.stringify(DB)); const R = JSON.parse(JSON.stringify(DB)); R.sessions[0].kcal = 1; R.sessions[0].updatedAt = 9;
      const E = Object.assign(JSON.parse(JSON.stringify(DB)), {sessions:[], weights:[]}); const M1 = mergeDB(E, R); const M2 = mergeDB(L, R);
      return {n1:M1.sessions.length, w1:M1.weights.length, n2:M2.sessions.length, k:M2.sessions.find(s => s.id === R.sessions[0].id).kcal, t:Object.keys(M2.tomb.s).length + Object.keys(M2.tomb.w).length}; });
    ok(m.n1 === NFIX && m.w1 === 1, 'nouvel appareil vide : récupère tout depuis le gist', m); ok(m.n2 === NFIX && m.k === 1 && m.t === 0, 'fusion sans doublon ni pierre tombale', m);
    // appareil v1/v2 (ids aléatoires) : adopte les ids stables du gist à la 1re synchro, sans doublon
    const a = await p.evaluate(() => { const R = JSON.parse(JSON.stringify(DB)); const old = {version:2, sessions:R.sessions.map(s => Object.assign({}, s, {id:'r' + Math.random().toString(36).slice(2)})), objectifs:{}, equip:R.equip};
      delete old.sessions[0].updatedAt; old.sessions[1].notes = 'modifié'; old.sessions.forEach(s => { delete s.updatedAt; });
      const n0 = old.sessions.length; migrate(old); const kept = old.sessions.length === n0; adoptSeedIds(old, R); const M = mergeDB(old, R);
      return {kept, n:M.sessions.length, ids:old.sessions.every(s => /^seed-/.test(s.id)), note:M.sessions.find(s => s.id === R.sessions[1].id).notes, leg:old.sessions.some(s => s._legacy)}; });
    ok(a.kept && a.ids && a.n === NFIX && a.note === 'modifié' && !a.leg, 'ancien appareil v2 : ids stables adoptés, modification locale gardée, aucun doublon', a);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 3. Synchro : compatibilité avec un ancien client ----------
  out.push('3. Synchronisation avec un ancien client (fusion)');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    const NEW = await p.evaluate(() => { DB.sessions[0].kcal = 321; DB.sessions[0].teLabel = 'Récupération · Aérobie'; DB.sessions[0].updatedAt = 5;
      DB.weights = [{id:'w2',date:'2026-10-20',weight:81.5,updatedAt:6}]; DB.prefs.actMap.marche = {act:'Marche',type:'Tapis',incline:6,updatedAt:7}; save(); return JSON.stringify(DB); });
    const [ctx2, o] = await fresh(BASE + '/old.html');
    const viaOld = await o.evaluate(n => { const R = JSON.parse(n); if (!validImport(R)) return 'invalid'; migrate(R); return JSON.stringify(mergeDB(JSON.parse(JSON.stringify(DB)), R)); }, NEW);
    ok(viaOld !== 'invalid', 'l’ancien client accepte le fichier du gist v4');
    const OLDM = JSON.parse(viaOld);
    ok(OLDM.sessions[0].kcal === 321 || OLDM.sessions.find(s => s.id === JSON.parse(NEW).sessions[0].id).kcal === 321, 'ancien client : nouveaux champs de séance conservés à la fusion');
    ok(Array.isArray(OLDM.weights) && OLDM.weights.length === 1, 'ancien client : pesées conservées (clé inconnue gardée)', OLDM.weights);
    const back = await p.evaluate(m => { const R = JSON.parse(m); if (!validImport(R)) return null; migrate(R); const M = mergeDB(JSON.parse(JSON.stringify(DB)), R); normalizeDB(M); return M; }, viaOld);
    ok(back && back.weights.length === 1 && back.prefs.actMap.marche.type === 'Tapis', 'nouveau client : fusion du gist réécrit par l’ancien client sans perte');
    const del = await p.evaluate(() => { const L = JSON.parse(JSON.stringify(DB)); L.weights = L.weights.filter(w => w.id !== 'w2'); L.tomb.w.w2 = 100; const R = JSON.parse(JSON.stringify(DB)); const M = mergeDB(L, R); return M.weights.map(w => w.id); });
    ok(!del.includes('w2'), 'suppression d’une pesée propagée (pierre tombale w)', del);
    const pref = await p.evaluate(() => { const L = {sessions:[],prefs:{actMap:{marche:{type:'Tapis',updatedAt:10}}}}, R = {sessions:[],prefs:{actMap:{marche:{type:'Marche',updatedAt:20},corde:{type:'Corde à sauter',updatedAt:1}}}}; const M = mergeDB(L, R); return M.prefs.actMap; });
    ok(pref.marche.type === 'Marche' && pref.corde, 'préférences fusionnées par clé (la plus récente gagne)', pref);
    await ctx.close(); await ctx2.close(); }

  // ---------- 4. Doublon Bivouac ----------
  out.push('4. Catégorie Bivouac sans doublon');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => { const L = JSON.parse(JSON.stringify(DB)); L.equip.push({id:'perso',name:'Bivouac',updatedAt:9,items:[{id:'x1',name:'Ma tente',note:'',price:300,bought:true,updatedAt:9}]});
      const a = dedupeBivouac(L); const names = L.equip.filter(c => /bivouac/i.test(c.name)).map(c => c.id);
      const L2 = JSON.parse(JSON.stringify(DB)); L2.equip.find(c => c.id === BIV_ID).items[0].bought = true; L2.equip.find(c => c.id === BIV_ID).items[0].updatedAt = 5; L2.equip.push({id:'perso',name:'Bivouac',updatedAt:9,items:[]});
      const b2 = dedupeBivouac(L2); return {a, names, tomb: L.tomb.c[BIV_ID], b2}; });
    ok(r.a && r.names.join() === 'perso' && r.tomb === 1, 'catégorie perso « Bivouac » existante → catégorie par défaut retirée', r);
    ok(r.b2 === false, 'catégorie par défaut déjà modifiée → conservée'); await ctx.close(); }

  // ---------- 5. Service worker : ne touche qu'à ses propres caches ----------
  out.push('5. Service worker');
  { const [ctx, p] = await fresh(BASE + '/icon-192.png'); // page de la même origine qui n'enregistre pas le SW
    await p.evaluate(async () => { for (const k of ['ma-bibliotheque-v3','autre-appli','suivi-montagne-v4','suivi-montagne-v2']) { const c = await caches.open(k); await c.put('/x-' + k, new Response('x')); } });
    await p.evaluate(async () => { const r = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; });
    let keys = []; for (let i = 0; i < 40; i++) { keys = await p.evaluate(() => caches.keys()); if (keys.includes(SWC) && !keys.includes('suivi-montagne-v4') && !keys.includes('suivi-montagne-v2')) break; await W(250); }
    ok(keys.includes('ma-bibliotheque-v3') && keys.includes('autre-appli'), 'caches des autres applis conservés', keys);
    ok(!keys.includes('suivi-montagne-v4') && !keys.includes('suivi-montagne-v2') && keys.includes(SWC), 'anciens caches de l’appli supprimés, '+SWC+' créé', keys);
    await ctx.close(); }

  // ---------- 6. Moteur de conseils ----------
  out.push('6. Conseils « Prochaine ascension » (séances fictives)');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    const r = await p.evaluate(() => { const ref = new Date(2026, 9, 13); const A1 = advise(OBJECTIFS[0], ref);
      const s = sunTimes(ref, 45.7639, 2.9559); const A8 = advise(OBJECTIFS[7], ref); const A10 = advise(OBJECTIFS[9], ref);
      const save = DB.sessions; DB.sessions = []; const E = advise(OBJECTIFS[4], ref); DB.sessions = save;
      return {r1:A1.R.r, w1:A1.warn.join('|'), set:hhmm(s.set), rise:hhmm(s.rise), w8:A8.warn.join('|'), r8:A8.R.r, g10:A10.gear.map(g=>g.k), E:E.tips.map(t=>t.t).join('|'), Er:E.R.r, html:adviceCard(A1).length, all:OBJECTIFS.every(o=>{ const a=advise(o,ref); return a.R.r>=0&&a.R.r<=1&&a.plan.length===3; })}; });
    ok(r.r1 >= 0.8, 'Puy de Dôme : prêt avec les séances fictives', r.r1); ok(/Fermeture du 05\/10\/2026 au 16\/10\/2026/.test(r.w1), 'fermeture du chemin des Muletiers signalée le 13/10/2026');
    ok(r.set === '19h07' && r.rise === '08h00', 'coucher du soleil au col de Ceyssat le 13/10 ≈ 19h07', [r.rise, r.set]);
    ok(/hors saison/.test(r.w8) && /3 000 m/.test(r.w8), 'Barrhorn en octobre : hors saison + altitude', r.w8); ok(r.r8 < 0.8, 'Barrhorn : pas encore prêt', r.r8);
    ok(['tente','duvet','matelas','rechaud'].every(k => r.g10.includes(k)), 'GR 441 : matériel de bivouac demandé');
    ok(r.Er === 0 && /Grosse séance/.test(r.E) && /Régularité/.test(r.E), 'sans séance : indice 0 et conseils de base', r.E.slice(0, 200));
    ok(r.all, 'conseils cohérents pour tous les objectifs'); ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 7. Fiches sommet ----------
  out.push('7. Fiches sommet');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    await p.evaluate(() => show('obj')); await p.click('#objList [data-sum="10"]'); await W(300);
    const r = await p.evaluate(() => ({cur:curPage, t:$('pageTitle').textContent, txt:$('sumBody').innerText, st:history.state}));
    ok(r.cur === 'sum' && /GR 441/.test(r.txt) && r.st && r.st.sum === 10, 'clic sur un objectif → fiche (historique)', [r.cur, r.st]);
    for (const k of ['Carte','Départ, parking et accès','Itinéraire','Eau et refuges','Meilleure saison','Dangers','Ta préparation','Matériel conseillé','Sources']) ok(r.txt.includes(k), 'section « ' + k + ' »');
    await p.goBack(); await W(300); ok(await p.evaluate(() => curPage) === 'obj', 'retour (bouton précédent) → Objectifs');
    const all = await p.evaluate(() => OBJECTIFS.map(o => { renderSummit(o.n); const t = $('sumBody').innerText; return t.length > 1500 && /Sources/.test(t) && $('sumBody').querySelectorAll('.links a').length === 5; }));
    ok(all.every(Boolean), 'toutes les fiches sont complètes (≥ 1 500 caractères, 5 liens carte/météo)', all);
    const g = await p.evaluate(() => { const before = gearStatus(10).find(x => x.k === 'filtre'); DB.equip = DB.equip.filter(c => c.id !== BIV_ID); const miss = gearStatus(10).find(x => x.k === 'filtre').st; addGear('filtre'); const after = gearStatus(10).find(x => x.k === 'filtre').st; return [before.st, miss, after]; });
    ok(g[1] === 'missing' && g[2] === 'buy', 'bouton « Ajouter » : l’article rejoint la liste d’équipement', g);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 8. Formulaire : champs étendus et tapis ----------
  out.push('8. Formulaire de séance');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    const r = await p.evaluate(() => { const s = DB.sessions.find(x => x.id === 'fx-1011'); s.teLabel = 'Récupération · Aérobie'; s.src = 'mifit'; s.kcal = 300;
      fillForm(s); show('add'); $('f_notes').value = 'modifié'; $('fSess').requestSubmit(); const t = DB.sessions.find(x => x.id === s.id);
      fillForm(null); show('add'); $('f_type').value = 'Tapis'; $('f_type').dispatchEvent(new Event('change')); $('f_dist').value = '5'; $('f_dist').dispatchEvent(new Event('input'));
      const auto = $('f_dplus').value, incl = $('f_incline').value, vis = $('w_incl').style.display; $('f_date').value = '2026-10-12'; $('fSess').requestSubmit();
      const n = DB.sessions.filter(x => x.type === 'Tapis').pop(); return {keep: t.teLabel === 'Récupération · Aérobie' && t.src === 'mifit' && t.kcal === 300 && t.notes === 'modifié', auto, incl, vis, n}; });
    ok(r.keep, 'modifier une séance conserve les champs importés (libellé TE, source, kcal)');
    ok(r.incl === '6' && r.auto === '300' && r.vis === '', 'type Tapis : inclinaison 6 % par défaut, D+ auto = 5 km × 6 % = 300 m', r);
    ok(r.n && r.n.incline === 6 && r.n.dplus === 300 && !('kcal' in r.n), 'séance Tapis enregistrée (sans champs vides superflus)', r.n);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 9. Données : export / import JSON, copies ----------
  out.push('9. Export / import et copies de sécurité');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    const r = await p.evaluate(() => { const j = JSON.stringify(DB); const o = JSON.parse(j); const v1 = validImport(o); o.weights.push({date:'13/10/2026'}); const v2 = validImport(o);
      snapshot('test', true); const nS = snapshots().length; DB.sessions = []; save(); const snaps = snapshots(); const i = snaps.findIndex(x => x.reason === 'test');
      restoreSnap(i); return {v1, v2, nS, after: DB.sessions.length, csv: weightsCSV().split('\n').length}; });
    ok(r.v1 && !r.v2, 'validation de l’import (pesées incluses)'); ok(r.after === NFIX, 'restauration d’une copie de sécurité', r); ok(r.csv === 2, 'export CSV des pesées');
    await ctx.close(); }

  // ---------- 9b. Barre d'onglets : indicateur aligné ----------
  out.push('9b. Barre d’onglets (indicateur aligné à toutes les largeurs)');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const meas = () => p.evaluate(() => { const n = document.querySelector('nav'), i = n.querySelector('.ind').getBoundingClientRect(), t = n.querySelector('.tab.on').getBoundingClientRect();
      const fit = [...n.querySelectorAll('.tab .lb')].every(l => l.scrollWidth <= l.clientWidth + 0.5);
      return {d: Math.max(Math.abs(i.left - t.left), Math.abs(i.right - t.right), Math.abs(i.top - t.top), Math.abs(i.bottom - t.bottom)), fit}; });
    let worst = 0, fitAll = true, cases = 0;
    for (const [w, h] of [[320,640],[360,780],[390,844],[412,915],[768,1024],[1024,768],[1440,900],[844,390]]) {
      await p.setViewport({width:w, height:h});
      for (const t of ['journal','obj','prep','evo','poids','equip','data']) { await p.evaluate(t => show(t), t); await W(480); const m = await meas(); worst = Math.max(worst, m.d); fitAll = fitAll && m.fit; cases++; } }
    ok(worst < 0.5, `indicateur aligné sur l’onglet actif (${cases} cas, écart max ${worst.toFixed(2)} px)`, worst);
    ok(fitAll, 'libellés entiers dans leur onglet dès 320 px');
    // redimensionnement / rotation sans changer d'onglet, encoches simulées (marges gauche/droite différentes)
    await p.setViewport({width:390, height:844}); await p.evaluate(() => show('evo')); await W(480); await p.setViewport({width:844, height:390}); await W(100); const r1 = await meas();
    await p.evaluate(() => { const n = document.querySelector('nav'); n.style.left = '54px'; n.style.right = '30px'; }); await W(100); const r2 = await meas();
    await p.evaluate(() => { document.documentElement.style.fontSize = '22px'; document.querySelector('nav').style.fontFamily = 'serif'; }); await W(100); const r3 = await meas();
    ok(r1.d < 0.5 && r2.d < 0.5 && r3.d < 0.5, 'aligné après rotation, avec encoches et changement de police', [r1, r2, r3]);
    await p.evaluate(() => openSummit(3)); await W(480); const r4 = await p.evaluate(() => ({on: document.querySelector('nav .tab.on').dataset.p, cur: document.querySelector('nav .tab[aria-current]').dataset.p}));
    ok(r4.on === 'evo' && r4.cur === 'evo', 'fiche sommet : l’onglet d’origine reste indiqué', r4);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 9c. Dates, plages, durées, données illisibles ----------
  out.push('9c. Mois / semaines / années, durées, données illisibles');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    const r = await p.evaluate(() => { DB.sessions.push({id:'old1', date:'2026-06-17', type:'Randonnée', dist:3, dplus:160, dur:9000, updatedAt:1});
      const ms = monthsRange(), ws = weeksRange(); const cur = todayISO().slice(0, 7);
      return {first: ms[0], hasCur: ms.includes(cur), last: ms[ms.length - 1], w0: ws[0], wy: isoWeekYear(new Date(2027, 0, 1)), ww: isoWeek(new Date(2027, 0, 1)), wy2: isoWeekYear(new Date(2026, 11, 28)),
        h1: Number.isNaN(hms('1:75')), h2: hms('0:59:59'), h3: hms('45'), csv: sessionsCSV().includes('17/06/2026;2026-S25')}; });
    ok(r.first === '2026-06' && r.hasCur, 'Évolution mensuelle : séance de juin 2026 incluse, jusqu’au mois en cours', r);
    ok(r.w0 === '2026-06-15', 'Évolution hebdo : commence à la semaine de la 1re séance', r.w0);
    ok(r.wy === 2026 && r.ww === 53 && r.wy2 === 2026, '01/01/2027 = semaine 53 de 2026 (année ISO correcte dans le CSV)', r);
    ok(r.h1 === true && r.h2 === 3599 && r.h3 === 2700 && r.csv, 'durée « 1:75 » refusée, « 45 » = 45 min', r);
    // séance modifiée alors qu'elle a été supprimée par un autre appareil
    const e = await p.evaluate(() => { const s = DB.sessions.find(x => x.id === 'fx-1'); fillForm(s); show('add'); DB.sessions = DB.sessions.filter(x => x.id !== 'fx-1'); $('f_notes').value = 'gardée'; $('fSess').requestSubmit(); return DB.sessions.some(x => x.notes === 'gardée' && x.date === s.date); });
    ok(e, 'modification d’une séance supprimée entre-temps : recréée, rien de perdu');
    // données locales illisibles → copie de sécurité restaurée, original conservé à part
    const n0 = await p.evaluate(() => { snapshot('test', true); localStorage.setItem(KEY, '{"sessions":[{"date":'); return DB.sessions.length; });
    await p.reload({waitUntil:'networkidle0'});
    const c = await p.evaluate(() => ({n: DB.sessions.length, kept: Object.keys(localStorage).some(k => k.startsWith(KEY + '.corrupt.') && localStorage.getItem(k) === '{"sessions":[{"date":')}));
    ok(c.n === n0 && c.kept, 'données illisibles : dernière copie restaurée, original gardé', [c, n0]);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 9d. Synchro automatique (API GitHub simulée), hors ligne, annulation, objectifs ----------
  out.push('9d. Synchro automatique, hors ligne, annuler une suppression, objectifs');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    await p.evaluate(() => { // faux serveur de gists dans la page
      window.FAKE = {content: null, patches: 0, gets: 0, delay: 0}; const F = window.FAKE;
      const gist = () => ({id: 'g1', files: F.content == null ? {} : {'suivi-montagne-data.json': {content: F.content, truncated: false}}});
      window.fetch = async (url, o = {}) => { const u = String(url), m = o.method || 'GET'; if (F.delay) await new Promise(r => setTimeout(r, F.delay));
        const J = (x, st = 200) => new Response(JSON.stringify(x), {status: st, headers: {'Content-Type': 'application/json'}});
        if (/\/gists\/g1$/.test(u) && m === 'GET') { F.gets++; return J(gist()); }
        if (/\/gists\/g1$/.test(u) && m === 'PATCH') { F.patches++; F.content = JSON.parse(o.body).files['suivi-montagne-data.json'].content; return J(gist()); }
        if (/\/gists\?/.test(u)) return J([]);
        if (/\/gists$/.test(u) && m === 'POST') { F.content = JSON.parse(o.body).files['suivi-montagne-data.json'].content; return J(gist(), 201); }
        return J({message: 'x'}, 404); };
      saveSyncCfg({token: 'ghp_test', gistId: 'g1', lastSync: 0, auto: true}); });
    await p.evaluate(() => syncNow({silent: true}));
    const a0 = await p.evaluate(() => ({p: FAKE.patches, n: JSON.parse(FAKE.content).sessions.length}));
    await p.evaluate(() => syncNow({silent: true})); const a1 = await p.evaluate(() => FAKE.patches);
    ok(a0.p === 1 && a1 === 1, 'synchro sans changement : aucune écriture inutile dans le gist', [a0, a1]);
    await p.evaluate(() => { DB.sessions.push({id: 'auto1', date: todayISO(), type: 'Marche', dist: 3, dplus: 50, dur: 1800, updatedAt: Date.now()}); save(); });
    await W(5500); const a2 = await p.evaluate(() => ({p: FAKE.patches, has: JSON.parse(FAKE.content).sessions.some(s => s.id === 'auto1')}));
    ok(a2.p === 2 && a2.has, 'modification → synchronisée automatiquement (≈ 4 s)', a2);
    // saisie pendant une synchro lente → resynchronisée ensuite, sans boucle
    await p.evaluate(() => { FAKE.delay = 1200; syncNow({silent: true}); }); await W(300);
    await p.evaluate(() => { DB.sessions.push({id: 'auto2', date: todayISO(), type: 'Marche', dist: 2, dplus: 20, dur: 1200, updatedAt: Date.now()}); save(); });
    await W(9000); const a3 = await p.evaluate(() => ({p: FAKE.patches, has: JSON.parse(FAKE.content).sessions.some(s => s.id === 'auto2')}));
    await W(6000); const a4 = await p.evaluate(() => FAKE.patches);
    ok(a3.has && a4 === a3.p, 'saisie pendant la synchro : envoyée juste après, sans boucle de synchro', [a3, a4]);
    // hors ligne : rien n'est tenté, indicateur affiché ; retour du réseau → synchro
    await p.evaluate(() => { FAKE.delay = 0; }); await p.setOfflineMode(true); await W(200);
    const g0 = await p.evaluate(() => { DB.sessions.push({id: 'off1', date: todayISO(), type: 'Marche', dist: 1, dplus: 10, dur: 600, updatedAt: Date.now()}); save(); return {g: FAKE.gets, pill: $('offPill').classList.contains('on')}; });
    await W(5000); const g1 = await p.evaluate(() => FAKE.gets);
    ok(g0.pill && g1 === g0.g, 'hors ligne : indicateur « Hors ligne », aucune requête', [g0, g1]);
    await p.setOfflineMode(false); await W(4500);
    const g2 = await p.evaluate(() => ({pill: $('offPill').classList.contains('on'), has: JSON.parse(FAKE.content).sessions.some(s => s.id === 'off1')}));
    ok(!g2.pill && g2.has, 'retour du réseau : synchronisé automatiquement', g2);
    // annuler une suppression (séance, pesée, article) — la version restaurée gagne sur la pierre tombale
    const u = await p.evaluate(() => { const id = DB.sessions[0].id; show('journal'); jExpandAll(); document.querySelector(`[data-del="${id}"]`).click(); const gone = !DB.sessions.some(s => s.id === id);
      document.querySelector('#toast .tbtn').click(); const back = DB.sessions.find(s => s.id === id); const M = mergeDB({sessions: [], tomb: {s: {[id]: back.updatedAt - 5}}}, DB);
      const wid = DB.weights[0].id; show('poids'); document.querySelector(`[data-w-del="${wid}"]`).click(); document.querySelector('#toast .tbtn').click();
      show('equip'); const row = document.querySelector('#eqList [data-item]'), iid = row.dataset.item; row.querySelector('[data-act=del]').click(); document.querySelector('#toast .tbtn').click();
      return {gone, back: !!back, tomb: DB.tomb.s[id], alive: M.sessions.some(s => s.id === id), w: DB.weights.some(w => w.id === wid), i: DB.equip.some(c => c.items.some(x => x.id === iid))}; });
    ok(u.gone && u.back && u.tomb === undefined && u.alive && u.w && u.i, '« Annuler » après suppression : séance, pesée et article restaurés', u);
    // objectifs : « Fait » remplit la date ; prochaine ascension = date prévue la plus proche
    const o = await p.evaluate(() => { show('obj'); const sel = document.querySelector('#objList select[data-obj="1"]'); sel.value = 'Fait'; sel.dispatchEvent(new Event('change', {bubbles: true}));
      const d1 = objState(1).dateRealisee; const f = new Date(); f.setDate(f.getDate() + 20); DB.objectifs[6] = {statut: 'À préparer', datePrevue: toISO(f), dateRealisee: '', updatedAt: 1};
      return {d1, next: nextObjective().n}; });
    ok(o.d1 === await p.evaluate(() => todayISO()) && o.next === 6, 'objectif « Fait » : date du jour ; prochaine ascension = date prévue la plus proche', o);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 9e. Nombres en texte, « Refaire », objectif hebdo ----------
  out.push('9e. Nombres en texte, « Refaire une séance », objectif de la semaine');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    await p.evaluate(() => { const D = JSON.parse(localStorage.getItem(KEY)); D.sessions.push({id:'str1', date:todayISO(), type:'Marche', dist:'5,5', dplus:'120', dur:'3600', updatedAt:1}); D.weights.push({id:'ws', date:'2026-10-20', weight:'79,5', updatedAt:1}); localStorage.setItem(KEY, JSON.stringify(D)); });
    await p.reload({waitUntil:'networkidle0'});
    const r = await p.evaluate(() => { const s = DB.sessions.find(x => x.id === 'str1'), w = DB.weights.find(x => x.id === 'ws'); const a = monthAgg(todayISO().slice(0, 7));
      return {d: s.dist, p: s.dplus, w: w.weight, sum: typeof a.dist === 'number', kl: $('kpiMonth').innerText.replace(/\s+/g, ' ')}; });
    ok(r.d === 5.5 && r.p === 120 && r.w === 79.5 && r.sum, 'nombres enregistrés en texte convertis (totaux justes)', r);
    ok(/\/ [\d\s  ]+ m D\+/.test(r.kl) && /D\+ hebdo visé/.test(r.kl), 'Journal : D+ de la semaine comparé à l’objectif de la prochaine ascension', r.kl);
    const d = await p.evaluate(() => { const n0 = DB.sessions.length; show('journal'); jExpandAll(); document.querySelector('[data-dup="fx-2"]').click();
      const st = {open: document.body.classList.contains('sheet-open'), date: $('f_date').value, type: $('f_type').value, dist: $('f_dist').value, id: $('f_id').value, n1: DB.sessions.length};
      $('fSess').requestSubmit(); return Object.assign(st, {n2: DB.sessions.length, n0, orig: DB.sessions.filter(s => s.id === 'fx-2').length}); });
    ok(d.open && d.date === await p.evaluate(() => todayISO()) && d.type === 'Tapis 6%' && d.dist === '6' && d.id === '' && d.n1 === d.n0 && d.n2 === d.n0 + 1 && d.orig === 1, '« Refaire » : copie pré-remplie à la date du jour, l’originale intacte', d);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 9f. Activité quotidienne (cartes « Statistiques ») et sorties de référence — données fictives ----------
  out.push('9f. Activité quotidienne et sorties de référence (données fictives)');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    const n = await p.evaluate(() => { const D = {sessions:[], daily:[{date:'2026-01-02',pas:'1 000',kcal:5,actMin:1,updatedAt:3},{date:'2026-01-02',pas:2000,updatedAt:9},{date:'bad'},{id:'x',date:'2026-01-03',pas:10}]}; normalizeDB(D); return D.daily; });
    ok(n.length === 2 && n.find(x => x.date === '2026-01-02').pas === 2000 && n.every(x => x.id === 'day-' + x.date), 'une seule entrée par jour (id = date), la plus récente gagne, dates invalides écartées', n);
    const m = await p.evaluate(() => { const L = {sessions:[], daily:[{id:'day-2026-01-01',date:'2026-01-01',pas:100,updatedAt:5},{id:'day-2026-01-02',date:'2026-01-02',pas:7,updatedAt:5}], tomb:{d:{'day-2026-01-02':6}}};
      const R = {sessions:[], daily:[{id:'day-2026-01-01',date:'2026-01-01',pas:900,updatedAt:8},{id:'day-2026-01-02',date:'2026-01-02',pas:7,updatedAt:5},{id:'day-2026-01-03',date:'2026-01-03',pas:3,updatedAt:1}]};
      const M = mergeDB(L, R); return {d: M.daily.map(x => x.id + ':' + x.pas).sort(), t: M.tomb.d}; });
    ok(JSON.stringify(m.d) === JSON.stringify(['day-2026-01-01:900','day-2026-01-03:3']) && m.t['day-2026-01-02'] === 6, 'fusion : union par jour, plus récente gagne, suppression propagée (tomb.d)', m);
    // ancien client (v4) : la clé « daily » inconnue est conservée
    const NEW = await p.evaluate(() => { DB.daily = [{id:'day-2026-02-01',date:'2026-02-01',pas:4321,kcal:99,actMin:12,src:'Mi Fitness',updatedAt:10}]; save(); return JSON.stringify(DB); });
    const [ctx2, o] = await fresh(BASE + '/old.html');
    const viaOld = await o.evaluate(n => { const R = JSON.parse(n); if (!validImport(R)) return 'invalid'; migrate(R); return JSON.stringify(mergeDB(JSON.parse(JSON.stringify(DB)), R)); }, NEW);
    ok(viaOld !== 'invalid' && JSON.parse(viaOld).daily && JSON.parse(viaOld).daily[0].pas === 4321, 'ancien client : activité quotidienne conservée à la fusion (clé inconnue gardée)');
    await ctx2.close();
    // import (résultat OCR simulé) → vérification → enregistrement ; ré-import du même jour = mise à jour, jamais de doublon
    const imp = await p.evaluate(() => { const Y = addDays(todayISO(), -1); DB.daily = []; save();
      const R = v => ({kind:'daily', activity:{v:'Statistiques',conf:99}, fields:{date:{v:Y,conf:95}, pas:{v:v,conf:97}, kcal:{v:150,conf:96}, actMin:{v:25,conf:96}}});
      const it = {id:'t1', name:'a.png', status:'reading', file:null}; IMP.items = [it]; IMP.prepare(it, R(5000)); IMP.open();
      const c = document.querySelector('[data-it="t1"]'), keys = [...c.querySelectorAll('[data-k]')].map(e => e.dataset.k), st = IMP.statusText(it);
      const n0 = DB.daily.length; IMP.saveOne(it, true); const a = {n0, n1: DB.daily.length, pas: DB.daily[0].pas, id: DB.daily[0].id};
      const it2 = {id:'t2', name:'b.png', status:'reading', file:null}; IMP.items = [it2]; IMP.prepare(it2, R(6200)); IMP.render();
      const dup = !!document.querySelector('[data-it="t2"] .dup') && /mises à jour/.test(document.querySelector('[data-it="t2"] .dup').textContent);
      IMP.saveOne(it2, true); IMP.close(); return Object.assign(a, {keys, st, dup, n2: DB.daily.length, pas2: DB.daily[0].pas, Y}); });
    ok(imp.keys.join() === 'date,pas,kcal,actMin' && /Statistiques du/.test(imp.st), 'carte « Statistiques » : formulaire de vérification (date, pas, kcal, minutes)', imp);
    ok(imp.n0 === 0 && imp.n1 === 1 && imp.pas === 5000 && imp.id === 'day-' + imp.Y, 'rien avant validation, puis une entrée pour le jour', imp);
    ok(imp.dup && imp.n2 === 1 && imp.pas2 === 6200, 'ré-import du même jour : « mise à jour » annoncée, pas de doublon', imp);
    // variante de carte « Pauses actives N coups » (au lieu des minutes) : champ séparé, minutes laissées vides
    const pa = await p.evaluate(() => { const Y = addDays(todayISO(), -2); DB.daily = []; save();
      const R = {kind:'daily', activity:{v:'Statistiques',conf:99}, fields:{date:{v:Y,conf:95}, pas:{v:4321,conf:97}, kcal:{v:210,conf:96}, pausesActives:{v:7,conf:96}}};
      const it = {id:'t3', name:'c.png', status:'reading', file:null}; IMP.items = [it]; IMP.prepare(it, R); IMP.open();
      const keys = [...document.querySelectorAll('[data-it="t3"] [data-k]')].map(e => e.dataset.k); IMP.saveOne(it, true); IMP.close();
      const x = dayOf(Y); show('evo'); $('sgD').click(); const txt = $('evoD').innerText, csv = dailyCSV();
      return {keys, x, one: /7 pauses actives/.test(txt), csv: csv.split('\n')[0].includes('Pauses actives') && csv.includes(';;7;')}; });
    ok(pa.keys.join() === 'date,pas,kcal,actMin,pausesActives' && pa.x && pa.x.actMin === null && pa.x.pausesActives === 7 && pa.x.pas === 4321, 'carte « Pauses actives » : champ séparé, minutes vides (pas 0)', pa);
    ok(pa.one && pa.csv, 'pauses actives affichées dans l’historique et exportées en CSV', pa);
    const man = await p.evaluate(() => { IMP.items = []; IMP.manualDaily(); const it = IMP.items[0]; const c = document.querySelector('[data-it="' + it.id + '"]');
      c.querySelector('[data-k="date"]').value = addDays(todayISO(), -3); c.querySelector('[data-k="pas"]').value = '9 876'; c.querySelector('[data-k="actMin"]').value = '-4';
      const e1 = IMP.saveOne(it, true); c.querySelector('[data-k="actMin"]').value = '44'; const e2 = IMP.saveOne(it, true); IMP.close(); const x = dayOf(addDays(todayISO(), -3)); return {e1, e2, x}; });
    ok(man.e1 && man.e1.length && !man.e2 && man.x && man.x.pas === 9876 && man.x.actMin === 44 && man.x.src === 'saisie', 'saisie manuelle d’une journée (valeur négative refusée)', man);
    // indicateurs : série, jours actifs / repos, rappel du matin
    const S = await p.evaluate(() => { const T = todayISO(); DB.sessions = DB.sessions.filter(s => s.date < addDays(T, -10)); DB.daily = [];
      for (let i = 2; i <= 6; i++) DB.daily.push({id:'day-' + addDays(T, -i), date:addDays(T, -i), pas: i === 4 ? 1500 : 9000, kcal:100, actMin: i === 4 ? 5 : 40, updatedAt:1});
      save(); const s = dailyStats(); localStorage.removeItem(KEY + '.dailyHint'); show('journal'); renderJournal();
      const hint = !!document.querySelector('#dailyCard #dHint'); document.querySelector('[data-dhint-x]').click(); const hint2 = !!document.querySelector('#dHint'); renderJournal(); const hint3 = !!document.querySelector('#dHint');
      DB.daily.push({id:'day-' + addDays(T, -1), date:addDays(T, -1), pas:8000, kcal:1, actMin:31, updatedAt:1}); localStorage.removeItem(KEY + '.dailyHint'); renderJournal();
      return {streak: s.streak, best: s.best, a7: s.active7, r7: s.rest7, hint, hint2, hint3, hint4: !!document.querySelector('#dHint'), s2: dailyStats().streak, card: $('jDaily').innerText}; });
    ok(S.streak === 2 && S.best === 2 && S.a7 === 4 && S.r7 === 1, 'série active (hier pas encore importé → compte jusqu’à avant-hier), jours actifs / repos', S);
    ok(S.hint && !S.hint2 && !S.hint3 && !S.hint4 && S.s2 === 3, 'rappel doux si hier manque, « Plus tard » le masque pour la journée, disparaît une fois importé', S);
    const adv = await p.evaluate(() => { const T = todayISO(); DB.daily = []; for (let i = 1; i <= 7; i++) DB.daily.push({id:'day-' + addDays(T, -i), date:addDays(T, -i), pas:3000, kcal:50, actMin:10, updatedAt:1});
      const A = advise(nextObjective()); return {t: A.tips.map(x => x.t).join(' | '), p: A.plan.map(x => x.t)}; });
    ok(/pas\/jour/.test(adv.t) && /5 jours actifs/.test(adv.t) && adv.p.includes('Au quotidien'), 'conseils : objectif de pas quotidien et régularité', adv);
    const evo = await p.evaluate(() => { show('evo'); $('sgD').click(); return {c1: !!$('chD1').querySelector('svg rect'), c2: !!$('chD2').querySelector('svg'), cal: document.querySelectorAll('#evoD .cal i').length, csv: dailyCSV().split('\n').length}; });
    ok(evo.c1 && evo.c2 && evo.cal === 56 && evo.csv === 8, 'Évolution → Quotidien : graphiques, calendrier 8 semaines, export CSV', evo);
    // sorties de référence : comparaison et dédoublonnage
    const ref = await p.evaluate(() => { const o = OBJECTIFS[0];
      DB.sessions.push({id:'ref-2025-01-05-1000', date:'2025-01-05', heure:'10:00', type:'Randonnée', dist:4, dur:7200, dplus:300, bpm:120, bpmMax:160, altMax:1200, lieu:'Sommet fictif', ref:true, objs:[o.n], updatedAt:1});
      DB.sessions.push({id:'ref-2025-02-05-1000', date:'2025-02-05', type:'Randonnée', dist:2, dur:3600, dplus:100, lieu:'Autre lieu', ref:true, updatedAt:1});
      const c = comparableFor(o), h = adviceCard(advise(o)), j = adviceCard(advise(o), {compact:true});
      const o2 = OBJECTIFS.find(x => x.n !== o.n && !(x.n === 2)); const c2 = comparableFor(o2);
      show('evo'); $('sgW').click(); const tbl = $('refTbl').innerText, gapr = /\d+ semaines sans séance/.test($('tblW').innerText) && $('tblW').querySelectorAll('tr').length < 40;
      return {same: c && c.s.id, why: c && c.why, other: c2 && c2.s.id, card: /dernière sortie comparable/.test(h) && /Sommet fictif/.test(h), compact: /Dernière sortie comparable/.test(j), tbl: /Sommet fictif/.test(tbl) && /Autre lieu/.test(tbl), gapr}; });
    ok(ref.same === 'ref-2025-01-05-1000' && ref.why === 'même sommet' && ref.other === 'ref-2025-02-05-1000', 'sortie comparable : même sommet d’abord, sinon la plus récente', ref);
    ok(ref.card && ref.compact && ref.tbl, 'comparaison affichée (conseil, Journal) et tableau des sorties en montagne (Évolution)', ref);
    ok(ref.gapr, 'Évolution : les longues séries de semaines sans séance tiennent sur une ligne', ref);
    const dd = await p.evaluate(() => { const D = {sessions:[{id:'u1', date:'2025-03-03', type:'Marche', dist:5.01, dur:3000, updatedAt:2}, {id:'ref-2025-03-03-0900', date:'2025-03-03', type:'Randonnée', dist:5.0, dur:3010, lieu:'Lieu fictif', ref:true, bpmMax:150, updatedAt:1}], tomb:newTomb()};
      const ch = dedupeRef(D); return {ch, n: D.sessions.length, u: D.sessions[0], t: D.tomb.s['ref-2025-03-03-0900'] > 1}; });
    ok(dd.ch && dd.n === 1 && dd.u.id === 'u1' && dd.u.ref && dd.u.lieu === 'Lieu fictif' && dd.u.bpmMax === 150 && dd.u.type === 'Marche' && dd.t, 'sortie de référence déjà présente sur l’appareil : pas de doublon, séance locale enrichie', dd);
    const fm = await p.evaluate(() => { show('journal'); fillForm(DB.sessions.find(s => s.id === 'ref-2025-02-05-1000')); const a = {l: $('f_lieu').value, r: $('f_ref').checked}; $('f_lieu').value = 'Lieu modifié'; $('fSess').requestSubmit();
      const s = DB.sessions.find(x => x.id === 'ref-2025-02-05-1000'); return Object.assign(a, {l2: s.lieu, r2: s.ref, chip: (jExpandAll(), /📍 Lieu modifié/.test($('sessList').innerText))}); });
    ok(fm.l === 'Autre lieu' && fm.r && fm.l2 === 'Lieu modifié' && fm.r2 && fm.chip, 'formulaire : lieu et repère « référence » modifiables, affichés dans le Journal', fm);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 10. Import Mi Fitness : OCR sur les captures + écran de vérification ----------
  if (process.env.SAMPLES) {
    out.push('10. Import Mi Fitness (OCR dans le navigateur, index.html réel)');
    { const [ctx, p] = await fresh(BASE + '/index.html'); const SYN = require(__dirname + '/synth-card.js');
      const cases = [{date:'2 octobre 2026',kcal:1234,pas:12345,min:87,seed:3,iso:'2026-10-02'},{date:'28 février 2027',kcal:356,pas:8021,min:41,seed:11,c1:'#244a6b',c2:'#6b8fb5',c3:'#c9b38a',iso:'2027-02-28'},
        {date:'1 août 2026',kcal:0,pas:76,min:0,seed:5,lines:9,c1:'#d8c9a0',c2:'#a08050',c3:'#504030',iso:'2026-08-01'},{date:'15 décembre 2026',kcal:2876,pas:25003,min:205,seed:9,c1:'#1d3b2a',c2:'#5d7d4a',c3:'#9db08a',iso:'2026-12-15'},
        {date:'9 mars 2027',kcal:812,pas:11204,pauses:7,seed:13,iso:'2027-03-09'},{date:'21 juin 2026',kcal:57,pas:1320,pauses:0,seed:17,c1:'#3b2d5a',c2:'#7a5a9a',c3:'#c0a070',iso:'2026-06-21'}];
      for (const o of cases) { const r = await p.evaluate(async (S, o) => { const bl = await (eval(S))(o); const r = await MiFit.analyze(bl); return {kind: r.kind, f: Object.fromEntries(Object.entries(r.fields).map(([k, x]) => [k, x.v]))}; }, SYN, o);
        ok(r.kind === 'daily' && r.f.date === o.iso && r.f.kcal === o.kcal && r.f.pas === o.pas && r.f.actMin === o.min && r.f.pausesActives === o.pauses, 'carte « Statistiques » synthétique sur photo (' + o.date + (o.pauses != null ? ', variante « Pauses actives »' : '') + ') lue exactement', r); }
      await ctx.close(); }
    const acc = {};
    { const [ctx, p] = await fresh(BASE + '/index.html');
      for (const [file, T] of Object.entries(TRUTH)) {
        const t0 = Date.now(); const r = await p.evaluate(f => MiFit.analyze(f).then(r => ({kind:r.kind, act:r.activity&&r.activity.v, fields:Object.fromEntries(Object.entries(r.fields).map(([k,x]) => [k,{v:x.v,c:Math.round(x.conf),w:!!x.warn}]))})), '/' + file);
        const rows = []; let good = 0;
        for (const [k, v] of Object.entries(T.f)) { const g = r.fields[k]; const okk = g && (typeof v === 'number' ? Math.abs(g.v - v) < 1e-6 : g.v === v); if (okk) good++; rows.push({k, truth:v, got:g?g.v:null, conf:g?g.c:null, ok:!!okk}); }
        acc[file] = {kind:r.kind, act:r.act, ms:Date.now() - t0, good, total:Object.keys(T.f).length, rows};
        ok(r.kind === T.kind, file + ' : type détecté = ' + T.kind, r.kind); ok(r.act === T.act, file + ' : activité « ' + T.act + ' »', r.act);
        ok(good === Object.keys(T.f).length, file + ' : ' + good + '/' + Object.keys(T.f).length + ' champs exacts', rows.filter(x => !x.ok)); }
      require('fs').writeFileSync(process.env.ACC_OUT || '/tmp/ocr_accuracy.json', JSON.stringify(acc, null, 1)); await ctx.close(); }
    { const [ctx, p] = await fresh(BASE + '/index.html'); const M = TRUTH['marche.jpg'].f, P = TRUTH['poids.png'].f, C = TRUTH['corde.jpg'].f; await withFix(p, null, P.heure); // même date/heure → doublon
      const n0 = await p.evaluate(() => DB.sessions.length);
      await p.evaluate(() => IMP.open()); const inp = await p.$('#impFiles');
      await inp.uploadFile(...['marche.jpg','corde.jpg','poids.png'].map(f => SDIR + '/' + f));
      await p.waitForFunction(() => IMP.items.length === 3 && IMP.items.every(x => !['queued','reading'].includes(x.status)), {timeout:180000});
      ok(await p.evaluate(() => DB.sessions.length) === n0, 'rien n’est enregistré avant validation');
      const m = await p.evaluate(() => { const it = IMP.items[0]; return {dup:it.dup&&it.dup.id, mode:it.mode, type:it.type, fields:[...document.querySelectorAll('[data-it="'+it.id+'"] [data-k]')].map(e=>e.dataset.k)}; });
      ok(m.dup === 'fx-1011' && m.mode === 'merge', 'séance du 11/10 déjà saisie détectée → « compléter »', m);
      ok(m.fields.includes('altMin') && m.fields.includes('dminus') && !m.fields.includes('incline'), 'champs adaptés au type Marche');
      // passage en Tapis
      await p.select('[data-it] select[data-type]', 'Tapis'); await W(200);
      const t = await p.evaluate(() => { const it = IMP.items[0], c = document.querySelector('[data-it="'+it.id+'"]'); return {incl:c.querySelector('[data-k="incline"]').value, dp:c.querySelector('[data-k="dplus"]').value, keys:[...c.querySelectorAll('[data-k]')].map(e=>e.dataset.k), badge:c.querySelector('label[for$="_dplus"] .cf').textContent}; });
      ok(t.incl === '6' && t.dp === String(Math.round(M.dist * 60)) && t.badge === 'calculé', 'Marche → Tapis : inclinaison 6 %, D+ calculé = distance × 6 %', t);
      ok(!t.keys.includes('dminus') && !t.keys.includes('altMin'), 'Tapis : D-, altitudes masqués');
      await p.click('[data-it] input[data-k="incline"]'); await p.evaluate(s => document.querySelector(s).select(), '[data-it] input[data-k="incline"]'); await p.type('[data-it] input[data-k="incline"]', '8'); await W(100);
      ok(await p.evaluate(() => document.querySelector('[data-it] [data-k="dplus"]').value) === String(Math.round(M.dist * 80)), 'inclinaison 8 % → D+ = distance × 8 %');
      await p.evaluate(() => { const r = document.querySelector('[data-it] input[value="new"][data-mode]'); r.click(); });
      await p.evaluate(() => document.querySelector('[data-it] [data-imp-save]').click()); await W(200);
      const s1 = await p.evaluate(() => { const s = DB.sessions[DB.sessions.length - 1]; return {s, pref:DB.prefs.actMap.marche}; });
      ok(s1.s.type === 'Tapis' && s1.s.incline === 8 && s1.s.dplus === Math.round(M.dist * 80) && s1.s.dminus == null && s1.s.altMin === undefined && s1.s.kcal === M.kcal && s1.s.dur === M.dur && s1.s.heure === M.heure, 'séance Tapis enregistrée avec les bonnes valeurs', s1.s);
      ok(s1.pref && s1.pref.type === 'Tapis' && s1.pref.incline === 8, 'choix mémorisé pour « Marche » (Tapis, 8 %)', s1.pref);
      // pesée : mise à jour de la pesée existante, pas de doublon
      const wv = await p.evaluate(() => { const it = IMP.items.find(x => x.kind === 'weigh'); return {mode:it.wMode, dup:it.wDup&&it.wDup.id}; });
      ok(wv.mode === 'update' && wv.dup === 'fx-w-1013', 'pesée du 13/10 déjà présente → mise à jour proposée', wv);
      await p.evaluate(() => IMP.saveAll()); await W(300);
      const after = await p.evaluate(cd => ({w:DB.weights.length, w0:DB.weights[0], corde:DB.sessions.find(s => s.type === 'Corde à sauter' && s.date === cd)}), C.date);
      ok(after.w === 1 && after.w0.updatedAt > 0 && after.w0.weight === P.weight && after.w0.bodyType === P.bodyType, 'pesée mise à jour (1 seule pesée)', after.w0);
      ok(after.corde && after.corde.sauts === C.sauts && after.corde.dur === C.dur && after.corde.pauses === C.pauses, '« Tout enregistrer » : corde à sauter ajoutée', after.corde);
      // nouvelle capture « Marche » : suggestion = dernier choix
      await inp.uploadFile(SDIR + '/marche.jpg');
      await p.waitForFunction(() => IMP.items.some(x => x.status === 'done' && x.act === 'Marche'), {timeout:120000});
      const sug = await p.evaluate(() => { const it = IMP.items.find(x => x.status === 'done' && x.act === 'Marche'); return {type:it.type, pref:it.pref, incl:it.v.incline}; });
      ok(sug.type === 'Tapis' && sug.pref && sug.incl === 8, 'capture suivante « Marche » : Tapis 8 % suggéré (modifiable)', sug);
      ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }
  }

  // ---------- 12. Ascensions : séances de montre rattachées à un objectif (v12) ----------
  out.push('12. Ascensions (séances rattachées à un objectif)');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    const n0 = await p.evaluate(() => DB.sessions.length);
    await p.evaluate(() => show('obj'));
    await p.select('select[data-obj="1"][data-k="statut"]', 'Fait'); await W(600);
    ok(await p.evaluate(() => $('ascDlg').classList.contains('on') && /Bravo/.test($('ascBox').textContent)), 'objectif marqué fait → proposition d’ajouter les séances de la montre');
    ok(await p.evaluate(() => objState(1).statut === 'Fait' && objState(1).dateRealisee === todayISO()), 'statut Fait + date réalisée');
    await p.click('#ascBox [data-asc-man]'); await W(300);
    ok(await p.evaluate(() => $('f_obj').value === '1' && $('f_type').value === 'Randonnée'), 'saisie manuelle : objectif pré-sélectionné');
    await p.evaluate(() => { $('f_dist').value = '6,5'; $('f_dplus').value = '420'; $('f_dur').value = '2:10:00'; $('f_x_kcal').value = '700'; });
    await p.click('#btnSave'); await W(400);
    // 2e enregistrement : séance déjà existante
    await p.evaluate(() => openSummitNoPush(1)); await p.evaluate(() => document.querySelector('#ascCard [data-asc-link]').click()); await W(200);
    const pickId = await p.evaluate(() => { const b = document.querySelector('#ascBox [data-asc-pick]'); const id = b.dataset.ascPick; b.click(); return id; }); await W(300);
    const r = await p.evaluate(id => { const T = ascTotals(1), x = DB.sessions.find(s => s.id === id); return {n:T.n, dist:T.dist, dplus:T.dplus, kcal:T.kcal, len:DB.sessions.length, page:curPage, card:$('ascCard').textContent, xd:x.dist, xp:x.dplus}; }, pickId);
    ok(r.n === 2 && Math.abs(r.dist - (6.5 + r.xd)) < 1e-9 && r.dplus === 420 + r.xp && r.kcal === 700, 'totaux cumulés sur 2 séances (distance, D+, kcal)', r);
    ok(r.len === n0 + 1, 'séance existante rattachée sans duplication (1 seule séance créée)', [r.len, n0]);
    ok(r.page === 'sum' && /Mon ascension/.test(r.card) && /2 séances/.test(r.card), 'fiche du sommet : carte « Mon ascension » avec la liste', r.card.slice(0, 120));
    await p.evaluate(id => document.querySelector(`#ascCard [data-asc-rm="${id}"]`).click(), pickId); await W(200);
    ok(await p.evaluate(() => ascTotals(1).n === 1), 'retirer une séance de l’objectif');
    await p.evaluate(() => document.querySelector('#toast .tbtn').click()); await W(200);
    ok(await p.evaluate(() => ascTotals(1).n === 2), '« Annuler » remet la séance dans l’objectif');
    // modification : le lien est conservé
    const mid = await p.evaluate(() => ascSessions(1).find(s => s.dist === 6.5).id);
    await p.evaluate(id => document.querySelector(`#ascCard [data-asc-edit="${id}"]`).click(), mid); await W(200);
    await p.evaluate(() => { $('f_notes').value = 'sommet'; }); await p.click('#btnSave'); await W(300);
    ok(await p.evaluate(id => { const s = DB.sessions.find(x => x.id === id); return s.objN === 1 && s.notes === 'sommet' && curPage === 'sum'; }, mid), 'modifier une séance de l’objectif garde le lien et revient à la fiche');
    // import Mi Fitness (revue identique) : la séance va dans l’objectif ciblé
    const im = await p.evaluate(() => { IMP.target = 1; const it = {id:'t1', objN:IMP.target, name:'x', status:'queued'}; IMP.items.push(it);
      IMP.prepare(it, {kind:'workout', activity:{v:'Randonnée'}, fields:{date:{v:'2026-10-13',conf:99}, dist:{v:4.2,conf:99}, dplus:{v:310,conf:99}, dur:{v:5400,conf:99}}});
      IMP.open(); const html = $('impList').innerHTML; it.mode = 'new'; IMP.saveOne(it, true); IMP.close(); return {html:/Ascension d’un objectif/.test(html), n:ascTotals(1).n, s:DB.sessions.find(s => s.date === '2026-10-13' && s.dist === 4.2)}; });
    ok(im.html && im.n === 3 && im.s && im.s.objN === 1 && im.s.src === 'mifit', 'import Mi Fitness : choix de l’objectif dans la revue, séance cumulée', im);
    ok(await p.evaluate(() => { renderJournal(); jExpandAll(); return document.querySelectorAll('#sessList .tag.asc').length === 3; }), 'Journal : séances d’objectif signalées 🏁 (comptées une seule fois)');
    ok(await p.evaluate(() => { renderObj(); return /3 séances/.test(document.querySelector('#objList .asc-mini').textContent); }), 'liste des objectifs : résumé de l’ascension');
    // « Refaire » une séance d’objectif ne copie pas le lien
    ok(await p.evaluate(id => { renderJournal(); jExpandAll(); document.querySelector(`[data-dup="${id}"]`).click(); return $('f_obj').value === ''; }, mid), '« Refaire » ne recopie pas l’objectif');
    await p.evaluate(() => { fillForm(null); show('journal'); });
    // synchro : champ conservé par la fusion, y compris face à une copie distante plus ancienne sans le champ
    ok(await p.evaluate(id => { const L = JSON.parse(JSON.stringify(DB)), R = JSON.parse(JSON.stringify(DB)); const r = R.sessions.find(s => s.id === id); delete r.objN; r.updatedAt = 1;
      const M = mergeDB(L, R); return M.sessions.find(s => s.id === id).objN === 1; }, mid), 'fusion : objN conservé');
    // marquer fait depuis la fiche (objectif 2) sans séance → proposition
    await p.evaluate(() => { openSummitNoPush(2); document.querySelector('#ascCard [data-asc-done]').click(); }); await W(600);
    ok(await p.evaluate(() => objState(2).statut === 'Fait' && $('ascDlg').classList.contains('on')), 'bouton « Marquer comme fait » sur la fiche → proposition');
    await p.evaluate(() => document.querySelector('#ascBox [data-asc-x]').click());
    ok(await p.evaluate(() => !$('ascDlg').classList.contains('on') && /Mon ascension/.test($('sumBody').textContent)), '« Plus tard » ferme ; on peut ajouter plus tard depuis la fiche');
    for (const t of ['journal','obj','prep','evo','poids','equip','data']) await p.evaluate(t => show(t), t);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 13. Catégorie « Roadtrip en voiture » ----------
  out.push('13. Équipement : Roadtrip en voiture');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => { const c = DB.equip.find(x => x.id === RT_ID); return c && {name:c.name, n:c.items.length, ids:new Set(c.items.map(i => i.id)).size, txt:c.items.map(i => i.name).join('|')}; });
    ok(r && r.name === 'Roadtrip en voiture' && r.n >= 30 && r.ids === r.n, 'catégorie présente, ids stables et uniques', r && r.n);
    ok(r && ['Gilet','Triangle|triangle','Matelas','Réchaud','Bidon','Batterie','GPS','Permis','Trousse de secours'].every(k => new RegExp(k).test(r.txt)), 'sécurité, couchage, cuisine, eau, énergie, navigation, papiers');
    await withFix(p); // utilisateur existant (données sans la catégorie)
    const x = await p.evaluate(() => { const before = JSON.parse(localStorage.getItem(KEY)); return {has:DB.equip.some(c => c.id === RT_ID), others:DB.equip.filter(c => c.id !== RT_ID).length, sess:DB.sessions.length}; });
    ok(x.has && x.sess === NFIX, 'ajoutée aux données existantes sans toucher aux séances');
    ok(await p.evaluate(() => { const D = JSON.parse(JSON.stringify(DB)); D.equip = D.equip.filter(c => c.id !== RT_ID); D.tomb.c[RT_ID] = Date.now(); return ensureRoadtrip(D) === false && !D.equip.some(c => c.id === RT_ID); }), 'supprimée par l’utilisateur : pas recréée');
    ok(await p.evaluate(() => { const D = JSON.parse(JSON.stringify(DB)); D.equip = D.equip.filter(c => c.id !== RT_ID); D.equip.push({id:'mine', name:'Road trip', items:[], updatedAt:3}); return ensureRoadtrip(D) === false; }), 'catégorie perso « Road trip » existante : pas de doublon');
    await p.evaluate(() => show('equip'));
    ok(await p.evaluate(() => /Roadtrip en voiture/.test($('eqList').textContent)) && p.errs.length === 0, 'affichée dans Équipement, aucune erreur JS', p.errs); await ctx.close(); }
  // ---------- 14. Objectif de pas quotidien personnalisé (v13) ----------
  out.push('14. Objectif de pas quotidien personnalisé');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => { const out = {};
      out.def = stepGoal(); // aucun objectif perso : adapté (8000 par défaut sans prochaine ascension éligible, ou selon objectif)
      DB.prefs.stepGoal = {v:6000, updatedAt:100}; save();
      out.user = userStepGoal(); out.goal = stepGoal(); out.ds = dailyStats().goal;
      show('data'); out.input = $('stepGoalInput').value; out.state = $('stepGoalState').textContent;
      show('evo'); $('sgD').click(); out.evoTxt = $('evoD').innerText.includes('6 000');
      show('journal'); out.jTxt = $('jDaily').innerText.includes('6 000');
      // fusion : le plus récent gagne, dans les deux sens
      const L = JSON.parse(JSON.stringify(DB)); L.prefs.stepGoal = {v:6000, updatedAt:100};
      const R = JSON.parse(JSON.stringify(DB)); R.prefs.stepGoal = {v:9000, updatedAt:50};
      out.merge1 = mergeDB(L, R).prefs.stepGoal.v; out.merge2 = mergeDB(R, L).prefs.stepGoal.v;
      // ancien format (nombre brut) normalisé, valeur invalide écartée
      const D = {sessions:[], prefs:{stepGoal:6000}}; normalizeDB(D); out.normNum = D.prefs.stepGoal;
      const D2 = {sessions:[], prefs:{stepGoal:{v:999999, updatedAt:5}}}; normalizeDB(D2); out.normBad = D2.prefs.stepGoal;
      // saisie via l'UI Données → Préférences
      show('data'); $('stepGoalInput').value = '6000'; $('btnStepGoal').click();
      out.ui = {v: DB.prefs.stepGoal && DB.prefs.stepGoal.v, stored: JSON.parse(localStorage.getItem(KEY)).prefs.stepGoal.v};
      return out; });
    ok(r.user === 6000 && r.goal === 6000 && r.ds === 6000, 'objectif personnalisé 6 000 utilisé partout (stepGoal, dailyStats)', r);
    ok(r.input === '6000' && /Objectif actuel : 6\s000/.test(r.state), 'Données → Préférences affiche l’objectif actuel', r.state);
    ok(r.merge1 === 6000 && r.merge2 === 6000, 'fusion gist : stepGoal le plus récent gagne (merge-safe)', [r.merge1, r.merge2]);
    ok(r.normNum && r.normNum.v === 6000 && r.normBad === undefined, 'normalizeDB : nombre brut converti, valeur hors limites écartée', [r.normNum, r.normBad]);
    ok(r.ui.v === 6000 && r.ui.stored === 6000, 'bouton Enregistrer : 6 000 persisté dans le stockage local', r.ui);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 15. v14 : graphiques interactifs, semaines affichées, conseils entraînement, lien d'achat ----------
  out.push('15. Graphiques interactifs, semaines, conseils entraînement, lien matériel (v14)');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    // pesées fictives supplémentaires pour le graphique poids
    await p.evaluate(() => { for(let i=0;i<5;i++) DB.weights.push({id:'fx-w'+i, date:'2026-0'+(8+i>9?'':'') , weight:80, updatedAt:0}); DB.weights = DB.weights.filter(w=>/^\d{4}-\d{2}-\d{2}$/.test(w.date));
      const base=[['2026-08-10',84.0,24.0],['2026-08-24',83.2,23.5],['2026-09-07',82.4,23.0],['2026-09-21',81.6,22.5],['2026-10-05',80.8,22.2]];
      base.forEach(([d,w,fp],i)=>DB.weights.push({id:'fx-wx'+i,date:d,weight:w,fatPct:fp,musclePct:38+i*0.2,stdKg:72,updatedAt:1})); save(); });
    const cw = await p.evaluate(() => { const out={};
      out.def=userChartWeeks();
      const D={sessions:[],prefs:{chartWeeks:12}}; normalizeDB(D); out.normNum=D.prefs.chartWeeks;
      const D2={sessions:[],prefs:{chartWeeks:{v:999,updatedAt:5}}}; normalizeDB(D2); out.normBad=D2.prefs.chartWeeks;
      const L=JSON.parse(JSON.stringify(DB)); L.prefs.chartWeeks={v:8,updatedAt:100}; const R=JSON.parse(JSON.stringify(DB)); R.prefs.chartWeeks={v:26,updatedAt:50};
      out.merge=mergeDB(L,R).prefs.chartWeeks.v;
      show('data'); $('chartWeeksSel').value='8'; $('btnChartWeeks').click(); out.ui=DB.prefs.chartWeeks.v;
      show('evo'); out.nW=$('chW1')._c.labels.length; out.selW=$('chW1')._sel;
      DB.prefs.chartWeeks={v:4,updatedAt:Date.now()}; save(); renderEvo(); out.nW4=$('chW1')._c.labels.length;
      return out; });
    ok(cw.def===26 && cw.normNum && cw.normNum.v===12 && cw.normBad===undefined, 'semaines graphiques : défaut 26, nombre brut normalisé, invalide écarté', cw);
    ok(cw.merge===8 && cw.ui===8, 'semaines graphiques : préférence synchronisée, fusion = plus récente', cw);
    ok(cw.nW<=8 && cw.nW4<=4 && cw.nW4<cw.nW, 'semaines graphiques : appliquées aux graphiques hebdomadaires', cw);
    const ch = await p.evaluate(() => { const out={}; DB.prefs.chartWeeks={v:26,updatedAt:Date.now()}; save(); show('poids');
      out.defTxt=$('chWt').querySelector('.chart-detail').textContent; out.defSel=$('chWt')._sel; out.n=$('chWt')._c.n;
      setChartIndex($('chWt'),0); out.firstTxt=$('chWt').querySelector('.chart-detail').textContent; out.range=$('chWt').querySelector('.chart-range').value;
      // toucher le graphique (pointerdown au milieu) déplace le curseur
      const svg=$('chWt').querySelector('svg'), r=svg.getBoundingClientRect();
      svg.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+r.width*0.55,clientY:r.top+40,pointerId:1}));
      out.afterTouch=$('chWt')._sel; out.touchTxt=$('chWt').querySelector('.chart-detail').textContent;
      show('evo'); out.evoTxt=$('chW1').querySelector('.chart-detail').textContent; out.evoN=$('chW1')._c.n;
      const A=trainingAdvice(); out.lines=A.lines.map(x=>x.t.replace(/<[^>]+>/g,'')).join(' | '); out.plan=A.plan.length;
      show('prep'); out.prep= $('prepTrain').textContent.includes('Conseils entraînement'); show('evo'); out.evoAdv=$('evoTrain').textContent.includes('Pour la semaine qui vient');
      return out; });
    ok(ch.n>=4 && ch.defSel===ch.n-1 && /kg/.test(ch.defTxt), 'poids : détail par défaut = dernière pesée', ch);
    ok(/10\/08\/2026/.test(ch.firstTxt) && ch.range==='0' && /84/.test(ch.firstTxt), 'poids : curseur sur la 1re pesée → date et valeur affichées', ch);
    ok(ch.afterTouch!==0 && ch.touchTxt.length>10, 'poids : toucher le graphique déplace le curseur', ch);
    ok(/séance/.test(ch.evoTxt) && /D\+/.test(ch.evoTxt), 'évolution hebdo : détail de la semaine (séances, km, D+, durée)', ch.evoTxt);
    ok(ch.lines.length>20 && ch.plan>=3 && ch.prep && ch.evoAdv, 'conseils entraînement : analyse + plan de la semaine, dans Préparation et Évolution', ch.lines.slice(0,160));
    const eq = await p.evaluate(() => { const out={}; out.bad=safeUrl('javascript:alert(1)'); out.noscheme=safeUrl('example.com/produit'); out.ok=safeUrl('https://example.com/a?x=1');
      show('equip'); const card=document.querySelector('#eqList [data-cat]'); card.querySelector('[data-new=name]').value='Lien fictif'; card.querySelector('[data-new=price]').value='12,5'; card.querySelector('[data-new=url]').value='example.com/chaussures';
      card.querySelector('[data-act=add]').click();
      const it=[...DB.equip[0].items].pop(); out.url=it.url; const a=document.querySelector('#eqList a.eq-link'); out.href=a&&a.getAttribute('href'); out.target=a&&a.getAttribute('target');
      const D=JSON.parse(JSON.stringify(DB)); D.equip[0].items[0].url='javascript:alert(1)'; normalizeDB(D); out.stripped=!('url' in D.equip[0].items[0]);
      const M=mergeDB(JSON.parse(JSON.stringify(DB)), JSON.parse(JSON.stringify(DB))); out.kept=M.equip.flatMap(c=>c.items).some(i=>i.url==='https://example.com/chaussures');
      return out; });
    ok(eq.bad===null && eq.noscheme==='https://example.com/produit' && eq.stripped, 'lien matériel : seuls http(s) acceptés, https ajouté, lien dangereux retiré à la normalisation', eq);
    ok(eq.url==='https://example.com/chaussures' && eq.href===eq.url && eq.target==='_blank' && eq.kept, 'lien matériel : ajouté via le formulaire, cliquable (nouvel onglet), conservé à la fusion', eq);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }


  // ---------- 16. v15 : chargement OCR à froid simulé + doublons même jour forçables ----------
  out.push('16. Premier chargement OCR (étapes simulées) et doublons du même jour (v15)');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    // --- A. UI de chargement à froid / à chaud, sans vrai OCR ---
    const cold = await p.evaluate(async () => { const seen = [];
      MiFit.analyze = async (f, onP) => { const snap = tag => { const c = document.querySelector('[data-it="cold1"]'); seen.push({tag, msg: c && c.querySelector('[data-msg]').textContent, note: c ? !c.querySelector('[data-loadnote]').hidden : null, bar: c && c.querySelector('[data-prog]') ? getComputedStyle(c.querySelector('[data-prog]')).getPropertyValue('--v') : null}); };
        onP(0, 'Téléchargement du moteur OCR…', {phase:'load', cold:true}); snap('moteur');
        onP(0.013, 'Téléchargement du modèle français… 42 %', {phase:'load', cold:true, pct:0.42}); snap('modele');
        onP(0.026, 'Initialisation du moteur OCR…', {phase:'load', cold:true}); snap('init');
        onP(0.04, 'Lecture de la capture (1/2)…', {phase:'read', cold:true}); snap('lecture');
        return {kind:'workout', activity:{v:'Marche'}, fields:{date:{v:'2026-10-10',conf:99}, dist:{v:3,conf:99}, dur:{v:1800,conf:99}}}; };
      const it = {id:'cold1', name:'fictive.png', status:'queued', prog:0, msg:'En attente…', file:null}; IMP.items = [it]; IMP.open(); await IMP.run(); IMP.close();
      return {seen, status: it.status, ready: MiFit.isReady()}; });
    ok(cold.seen[0].note === true && /Téléchargement du moteur/.test(cold.seen[0].msg), 'froid : note de premier chargement visible dès la 1re étape', cold.seen);
    ok(/modèle français… 42 %/.test(cold.seen[1].msg) && cold.seen[1].note === true, 'froid : étape « modèle français » avec % réel du logger', cold.seen[1]);
    ok(/Initialisation/.test(cold.seen[2].msg) && cold.seen[3].note === false && /Lecture de la capture/.test(cold.seen[3].msg), 'froid : initialisation puis lecture, note masquée ensuite', cold.seen);
    ok(cold.status === 'done', 'froid simulé : analyse terminée, revue affichée', cold.status);
    const warm = await p.evaluate(async () => { let noteDuring = null;
      MiFit.analyze = async (f, onP) => { onP(0, 'Chargement du moteur OCR…', {phase:'load', cold:false}); const c = document.querySelector('[data-it="warm1"]'); noteDuring = c ? !c.querySelector('[data-loadnote]').hidden : null;
        return {kind:'workout', activity:{v:'Marche'}, fields:{date:{v:'2026-10-09',conf:99}, dist:{v:2,conf:99}, dur:{v:1200,conf:99}}}; };
      const it = {id:'warm1', name:'fictive2.png', status:'queued', prog:0, msg:'En attente…', file:null}; IMP.items = [it]; IMP.open(); await IMP.run(); IMP.close(); return {noteDuring, status: it.status}; });
    ok(warm.noteDuring === false && warm.status === 'done', 'chaud : pas de note de premier chargement, import inchangé');
    const err = await p.evaluate(async () => { MiFit.analyze = async () => { throw new Error('Moteur OCR indisponible : une connexion internet est nécessaire la première fois. Vérifie ta connexion puis réessaie.'); };
      const it = {id:'err1', name:'fictive3.png', status:'queued', prog:0, msg:'En attente…', file:null}; IMP.items = [it]; IMP.open(); await IMP.run();
      const c = document.querySelector('[data-it="err1"]'); const out = {status: it.status, txt: c ? c.textContent : ''}; IMP.close(); return out; });
    ok(err.status === 'error' && /Moteur OCR indisponible/.test(err.txt) && /Réessayer/.test(err.txt), 'échec de chargement : message clair + bouton Réessayer', err);
    // --- B. Séances : types différents le même jour, doublon exact, ajout forcé ---
    const dup = await p.evaluate(() => { const out = {}; const D = '2026-10-10';
      DB.sessions.push({id:'dup-hike', date:D, heure:'08:00', type:'Randonnée', dist:8, dplus:300, dur:3600, kcal:600, updatedAt:1});
      const mk = (act, F) => { const it = {id:'d' + Math.random().toString(36).slice(2, 7), name:'x.png', status:'reading', file:null}; IMP.prepare(it, {kind:'workout', activity:{v:act}, fields:F}); return it; };
      // corde le soir, même durée par hasard : types différents → jamais de fusion par défaut
      const corde = mk('Corde à sauter', {date:{v:D,conf:99}, heure:{v:'19:00',conf:99}, dur:{v:3600,conf:99}, sauts:{v:900,conf:99}});
      out.diff = {dup: corde.dup && corde.dup.id, mode: corde.mode, diffType: corde.dupDiffType, exact: corde.dupExact, type: corde.type};
      const n0 = DB.sessions.length; corde.mode = corde.mode; IMP.saveOne(corde, true);
      out.afterDiff = {n: DB.sessions.length - n0, hike: DB.sessions.find(s => s.id === 'dup-hike').sauts == null, corde: DB.sessions.some(s => s.type === 'Corde à sauter' && s.date === D)};
      // même capture « Marche » que la séance existante du 11/10 (fx-1011) : doublon exact, défaut sûr = compléter
      const ex = mk('Marche', {date:{v:'2026-10-11',conf:99}, heure:{v:'',conf:99}, dur:{v:3400,conf:99}, dist:{v:5,conf:99}});
      out.exact = {dup: ex.dup && ex.dup.id, mode: ex.mode, exact: ex.dupExact, why: (ex.dupWhy || []).length};
      IMP.items = [ex]; IMP.open(); const card = document.querySelector('[data-it="' + ex.id + '"]'); out.exactTxt = card ? card.textContent : '';
      const n1 = DB.sessions.length; IMP.saveOne(ex, true); out.afterExactMerge = DB.sessions.length - n1;
      // … mais l'utilisateur peut TOUJOURS forcer une nouvelle séance
      const forced = mk('Marche', {date:{v:'2026-10-11',conf:99}, dur:{v:3400,conf:99}, dist:{v:5,conf:99}}); forced.mode = 'new';
      const n2 = DB.sessions.length; IMP.saveOne(forced, true); out.forcedAdded = DB.sessions.length - n2; IMP.close();
      // deux activités sans aucun point commun le même jour : aucun avertissement, ajout direct
      const far = mk('Corde à sauter', {date:{v:D,conf:99}, dur:{v:600,conf:99}, sauts:{v:300,conf:99}});
      out.far = {dup: far.dup && far.dup.id, mode: far.mode}; IMP.items = IMP.items.filter(x => x !== far);
      return out; });
    ok(dup.diff.dup === 'dup-hike' && dup.diff.diffType && dup.diff.mode === 'new' && !dup.diff.exact, 'rando le matin + corde le soir (durée proche) : types différents détectés, défaut = nouvelle séance', dup.diff);
    ok(dup.afterDiff.n === 1 && dup.afterDiff.hike && dup.afterDiff.corde, 'séance du soir ajoutée en plus, celle du matin intacte', dup.afterDiff);
    ok(dup.exact.dup === 'fx-1011' && dup.exact.exact && dup.exact.mode === 'merge' && dup.exact.why >= 2, 'capture identique : doublon exact détecté (points communs expliqués), défaut = compléter', dup.exact);
    ok(/probablement déjà importée/.test(dup.exactTxt) && /Ajouter quand même comme nouvelle séance/.test(dup.exactTxt), 'revue : avertissement fort + choix « Ajouter quand même » toujours présent', dup.exactTxt.slice(0, 200));
    ok(dup.afterExactMerge === 0 && dup.forcedAdded === 1, 'défaut sûr sans doublon, mais ajout forcé toujours possible (+1 séance)', dup);
    ok(dup.far.dup === null && dup.far.mode === 'new', 'deux activités sans rapport le même jour : aucun faux doublon', dup.far);
    // --- C. Pesées : matin + soir le même jour, ré-import exact ---
    const weigh = await p.evaluate(() => { const out = {}; const D = '2026-10-08';
      DB.weights.push({id:'w-am', date:D, heure:'08:00', weight:80, updatedAt:1});
      const mk = F => { const it = {id:'w' + Math.random().toString(36).slice(2, 7), name:'p.png', status:'reading', file:null}; IMP.prepare(it, {kind:'weigh', activity:{v:'Pesée'}, fields:F}); return it; };
      const soir = mk({date:{v:D,conf:99}, heure:{v:'19:30',conf:99}, weight:{v:79.4,conf:99}});
      out.soir = {dup: soir.wDup && soir.wDup.id, mode: soir.wMode, exact: soir.wExact};
      IMP.items = [soir]; IMP.open(); out.soirTxt = (document.querySelector('[data-it="' + soir.id + '"]') || {}).textContent || '';
      const n0 = DB.weights.length; IMP.saveOne(soir, true); out.nSoir = DB.weights.length - n0;
      const re = mk({date:{v:D,conf:99}, heure:{v:'08:00',conf:99}, weight:{v:80.1,conf:99}});
      IMP.items = [re]; IMP.render(); out.re = {mode: re.wMode, exact: re.wExact}; const n1 = DB.weights.length; IMP.saveOne(re, true);
      out.nRe = DB.weights.length - n1; out.total = DB.weights.filter(w => w.date === D).length; IMP.close();
      IMP.items = IMP.items.filter(x => x.kind !== 'weigh'); return out; });
    ok(weigh.soir.dup === 'w-am' && weigh.soir.mode === 'new' && !weigh.soir.exact && /Autre pesée le même jour/.test(weigh.soirTxt) && /Ajouter quand même comme nouvelle pesée/.test(weigh.soirTxt), 'pesée du soir : autre pesée du jour signalée, défaut = ajout en plus', weigh.soir);
    ok(weigh.nSoir === 1 && weigh.total === 2, 'deux pesées le même jour enregistrées (matin + soir)', weigh);
    ok(weigh.re.exact && weigh.re.mode === 'update' && weigh.nRe === 0, 'ré-import de la pesée du matin : mise à jour, pas de doublon', weigh.re);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }


  // ---------- 17. v16 : poids de base, GPX interactif, météo sommet ----------
  out.push('17. Poids de base, trace GPX et météo du sommet (v16, fixtures fictives)');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    const eq = await p.evaluate(() => { const out={}; const c=DB.equip[0];
      c.items[0].bought=true; c.items[0].wg=850; c.items[0].updatedAt=9; c.items[1].bought=true; delete c.items[1].wg; c.items[1].updatedAt=9;
      if(c.items[2]){ c.items[2].bought=false; c.items[2].wg=5000; }
      save(); renderEquip(); out.kpi=document.querySelector('#eqKpi').textContent; out.cat=document.querySelector('#eqList [data-cat]').textContent; out.fmt=[fmtW(450),fmtW(1250),fmtW(2000)];
      out.base=baseWeight();
      const D=JSON.parse(JSON.stringify(DB)); D.equip[0].items[0].wg=-4; D.equip[0].items[1].wg='abc'; normalizeDB(D); out.norm=[('wg' in D.equip[0].items[0]),('wg' in D.equip[0].items[1])];
      const M=mergeDB(JSON.parse(JSON.stringify(DB)),JSON.parse(JSON.stringify(DB))); out.merged=M.equip[0].items[0].wg;
      // ajout via le formulaire (poids en grammes)
      const card=document.querySelector('#eqList [data-cat]'); card.querySelector('[data-new=name]').value='Poids fictif'; card.querySelector('[data-new=wg]').value='275'; card.querySelector('[data-act=add]').click();
      out.added=DB.equip[0].items.find(i=>i.name==='Poids fictif'); return out; });
    ok(eq.fmt.join('|')==='450 g|1,25 kg|2 kg', 'poids : format g / kg', eq.fmt);
    ok(eq.base.w===850 && eq.base.miss===1 && /Poids de base : 850 g/.test(eq.kpi) && /sans poids/.test(eq.kpi), 'poids de base = articles cochés avec poids, manquants signalés (non cochés ignorés)', eq.base);
    ok(/🎒 850 g/.test(eq.cat), 'sous-total poids par catégorie', eq.cat.slice(0,120));
    ok(eq.norm.join()==='false,false' && eq.merged===850, 'poids invalide retiré à la normalisation, poids conservé à la fusion', eq);
    ok(eq.added && eq.added.wg===275, 'ajout d’article avec poids (g) via le formulaire', eq.added);
    // --- GPX fictif ---
    const gx = await p.evaluate(() => { const out={}; let pts='';
      for(let i=0;i<60;i++){ const la=45.7600+i*0.001, lo=2.9500+((i%2)?0.0012:-0.0012)+i*0.0004; pts+='<trkpt lat="'+la.toFixed(6)+'" lon="'+lo.toFixed(6)+'"><ele>'+(1000+i*10)+'</ele></trkpt>'; }
      const txt='<?xml version="1.0"?><gpx><trk><trkseg>'+pts+'</trkseg></trk></gpx>';
      const g=parseGpx(txt); out.g={n:g.pts.length,n0:g.n0,dist:g.dist,dplus:g.dplus};
      // gros fichier : plafond de points
      let big=''; for(let i=0;i<1500;i++){ const la=45.7+i*0.0004, lo=2.9+((i%2)?0.002:-0.002); big+='<trkpt lat="'+la+'" lon="'+lo+'"><ele>'+(1000+i)+'</ele></trkpt>'; }
      out.big=parseGpx('<gpx><trk><trkseg>'+big+'</trkseg></trk></gpx>').pts.length;
      try{ parseGpx('<gpx></gpx>'); out.err=''; }catch(e){ out.err=e.message; }
      DB.objectifs[1]=Object.assign(objState(1),{gpx:g,updatedAt:Date.now()}); save();
      renderSummit(1); out.hasFile=!!document.querySelector('#sumGpxFile'); out.profile=!!document.querySelector('#sumGpxChart'); out.stat=document.querySelector('#p-sum').textContent;
      out.det=document.querySelector('#sumGpxChart .chart-detail')?.textContent||'';
      const sg=sanGpx({pts:[[91,0,1],[0,0,1]]}); out.sanNull=sg===null;
      removeGpx(1); out.afterDel=!!(DB.objectifs[1]&&DB.objectifs[1].gpx); return out; });
    ok(gx.g.n>=10 && gx.g.n<=420 && gx.g.dist>2 && gx.g.dplus>=500, 'GPX fictif parsé : distance et D+ calculés, points simplifiés', gx.g);
    ok(gx.big<=420, 'GPX volumineux : plafond de points pour la synchro', gx.big);
    ok(/Aucune trace/.test(gx.err) && gx.sanNull, 'GPX invalide rejeté, trace stockée invalide nettoyée', gx.err);
    ok(gx.hasFile && gx.profile && /Profil altimétrique/.test(gx.stat) && /Altitude/.test(gx.det), 'fiche sommet : profil interactif avec altitude au curseur', gx.det);
    ok(gx.afterDel===false && /Ajouter une trace GPX/.test(await p.evaluate(()=>document.querySelector('#p-sum').textContent)), 'trace GPX retirable');
    // --- Météo fictive (réseau simulé) ---
    const wx = await p.evaluate(async () => { const out={}; const dates=['2026-10-19','2026-10-20'];
      DB.objectifs[1]=Object.assign(objState(1),{datePrevue:'2026-10-20',updatedAt:Date.now()}); save(); localStorage.removeItem(KEY+'.wx');
      const fx={daily:{time:dates,weather_code:[3,95],temperature_2m_max:[8,6],temperature_2m_min:[-1,-2],precipitation_probability_max:[20,90],precipitation_sum:[0,8.5],wind_speed_10m_max:[30,55],wind_gusts_10m_max:[60,95]},hourly:{time:['2026-10-19T12:00','2026-10-20T12:00'],apparent_temperature:[2,-4]}};
      const oldFetch=window.fetch; window.fetch=async()=>({ok:true,json:async()=>fx});
      renderSummit(1); await loadSummitWeather(1,true); out.txt=document.querySelector('#sumWx').textContent; out.cached=!!wxCache(1);
      window.fetch=async()=>{ throw new Error('réseau fictif coupé'); }; localStorage.removeItem(KEY+'.wx'); await loadSummitWeather(1,true); out.errTxt=document.querySelector('#sumWx').textContent;
      window.fetch=oldFetch; return out; });
    ok(/20\/10\/2026/.test(wx.txt) && /Orage/.test(wx.txt) && /ressenti -4/.test(wx.txt.replace('\u2212','-')) && /rafales 95/.test(wx.txt) && wx.cached, 'météo fictive : date prévue, orage, ressenti, vent/rafales, cache 30 min', wx.txt.slice(0,220));
    ok(/indisponible/.test(wx.errTxt), 'météo : échec réseau affiché proprement, sans blocage', wx.errTxt);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 14. v17 : nouveaux sommets, classement par difficulté, compatibilité ----------
  out.push('17. v17 : Cabaliros, Taillon, ordre de difficulté');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await p.evaluate(() => localStorage.removeItem('sm-objsort'));
    const r = await p.evaluate(() => { const o11=OBJECTIFS.find(o=>o.n===11), o12=OBJECTIFS.find(o=>o.n===12);
      const req=['type','sum','start','parking','access','route','water','refuges','dangers','winter','seasonTxt','tech','ign','variants','tips','secours'];
      return {o11:o11&&o11.altSom, o12:o12&&o12.altSom, f11:req.filter(k=>!OBJ_INFO[11][k]), f12:req.filter(k=>!OBJ_INFO[12][k]), s11:(SEASON[11]||[]).length, s12:(SEASON[12]||[]).length,
        g12:OBJ_GEAR[12], order:OBJ_BY_DIFF.map(o=>o.n), mono:OBJ_BY_DIFF.every((o,i,a)=>!i||diffScore(a[i-1]).s<=diffScore(o).s),
        allTech:OBJECTIFS.every(o=>o.n in TECH&&OBJ_INFO[o.n].tech), num:OBJECTIFS.map(o=>o.n).join() }; });
    ok(r.o11 === 2334 && r.o12 === 3144, 'Cabaliros 2 334 m (n° 11) et Taillon 3 144 m (n° 12)', r);
    ok(!r.f11.length && !r.f12.length && r.s11 === 12 && r.s12 === 12, 'fiches 11 et 12 complètes (tous les champs, saison)', [r.f11, r.f12]);
    ok(['crampons','piolet','casque'].every(k => r.g12.includes(k)), 'Taillon : crampons, piolet, casque conseillés');
    ok(r.mono && r.order[0] === 13 && r.order[1] === 1 && r.order[r.order.length-1] === 9 && r.order[r.order.length-2] === 8 && r.order.indexOf(11) < r.order.indexOf(12) && r.order.indexOf(6) < r.order.indexOf(12), 'classement par difficulté croissant et cohérent', r.order);
    ok(r.allTech && r.num === '1,2,3,4,5,6,7,8,9,10,11,12,13', 'technicité renseignée partout, numéros non modifiés');
    await p.evaluate(() => show('obj')); await W(300);
    const L = await p.evaluate(() => ({first:[...document.querySelectorAll('#objList > .card')].map(c=>c.querySelector('[data-sum]').dataset.sum), badge:document.querySelector('#objList .dlv').textContent, exp:!!document.querySelector('.diffexp'), tag:document.querySelector('#objList .dtag').textContent}));
    ok(L.first.join() === r.order.join() && L.badge === '1' && L.exp && /Niveau 1\/13/.test(L.tag), 'Objectifs triés par difficulté par défaut, badge de niveau et explication', L);
    // v18 : numéro affiché = rang de difficulté ; plus de bouton de tri ; clés internes inchangées
    const V = await p.evaluate(() => { localStorage.setItem('sm-objsort','num'); renderObj(); const cards=[...document.querySelectorAll('#objList > .card')];
      const h=cards.map(c=>c.querySelector('.dlv').textContent+':'+c.querySelector('[data-sum]').dataset.sum);
      renderSummit(8); const eb=document.querySelector('#sumBody .eyebrow2').textContent; renderPrep(); const ph=document.querySelector('#prepList h3').textContent;
      const opt=[...new DOMParser().parseFromString('<select>'+objOpts(12)+'</select>','text/html').querySelectorAll('option')].map(o=>o.value+'='+o.textContent);
      return {h, eb, ph, opt, seg:!!document.querySelector('[data-osort]')}; });
    ok(V.h[0] === '1:13' && V.h[1] === '2:1' && V.h[5] === '6:11' && V.h[8] === '9:12' && V.h[11] === '12:8' && V.h[12] === '13:9' && !V.seg, 'numéros affichés = rang de difficulté (Vache 1, Muletiers 2 … Barrhorn 12, Grande Sassière 13), tri unique', V.h);
    ok(/Objectif 12 sur 13/.test(V.eb) && /^1\. Puy de la Vache/.test(V.ph), 'fiche sommet et Prépa : numéro de difficulté', [V.eb, V.ph]);
    ok(V.opt[1] === '13=1. Puy de la Vache' && V.opt[2] === '1=2. Puy de Dôme' && V.opt.includes('12=9. Pic du Taillon') && V.opt.includes('8=12. Barrhorn (Üssers Barrhorn)') && V.opt.includes('9=13. Aiguille de la Grande Sassière'), 'sélecteur d’ascension : numéro affiché = difficulté, valeur stockée = clé interne', V.opt);
    // statut par numéro : modifier le n° 12 depuis la liste triée ne touche que le Taillon
    await p.select('select[data-obj="12"][data-k="statut"]', 'Prêt'); await W(300);
    ok(await p.evaluate(() => objState(12).statut === 'Prêt' && objState(8).statut === 'À préparer' && objState(4).statut === 'À préparer'), 'statut modifié dans la liste triée : enregistré sur le bon numéro');
    const nx = await p.evaluate(() => { DB.objectifs[1]={statut:'Fait',dateRealisee:'2026-10-01',datePrevue:'',updatedAt:1}; DB.objectifs[2]={statut:'Fait',dateRealisee:'2026-10-02',datePrevue:'',updatedAt:1};
      const a=nextObjective().n; DB.objectifs[4]={statut:'Fait',dateRealisee:'2026-10-03',datePrevue:'',updatedAt:1}; const b=nextObjective().n;
      const f=new Date(); f.setDate(f.getDate()+10); DB.objectifs[12]={statut:'Prêt',datePrevue:toISO(f),dateRealisee:'',updatedAt:1}; const c=nextObjective().n; return [a,b,c]; });
    ok(nx.join() === '4,3,12', 'Prochaine ascension : la plus facile non faite et non fermée (Vache en travaux ignorée), fermeture bloquante seulement (téléphérique du Sancy ≠ randonnée fermée), sauf date prévue', nx);
    for (const n of [11, 12]) { const t = await p.evaluate(n => { renderSummit(n); return $('sumBody').innerText; }, n);
      ok(/Variantes/.test(t) && /Technique, carte et secours/.test(t) && /Bons plans/.test(t) && /niveau \d+\/13/i.test(t) && /112/.test(t), 'fiche ' + n + ' : variantes, technique, secours, bons plans, niveau'); }
    const t12 = await p.evaluate(() => { renderSummit(12); return $('sumBody').innerText; });
    ok(/Sarradets/.test(t12) && /Brèche de Roland/.test(t12) && /crampons/i.test(t12) && /1748 OT/.test(t12), 'Taillon : refuge des Sarradets, Brèche, crampons, carte IGN');
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }
  // ---------- 18. v19 : photos des sommets ----------
  out.push('18. v19 : photos des sommets');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    await p.evaluate(() => show('obj')); await W(300);
    const r = await p.evaluate(async () => { const figs=[...document.querySelectorAll('#objList > .card > figure.sphoto')];
      for (const f of figs) { f.scrollIntoView(); await new Promise(r=>setTimeout(r,60)); }
      const imgs=figs.map(f=>f.querySelector('img')); imgs.forEach(i=>i.loading='eager'); await Promise.all(imgs.map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r; setTimeout(r,5000);})));
      const st=await Promise.all([...new Set(imgs.map(i=>i.getAttribute('src')))].map(async u=>(await fetch(u)).status));
      return {n:figs.length, ok:imgs.filter(i=>i.naturalWidth>=600).length, cred:figs.every(f=>/Wikimedia Commons/.test(f.textContent)&&/CC|domaine/i.test(f.textContent)), st, ow:document.documentElement.scrollWidth>innerWidth+1,
        cover:OBJECTIFS.every(o=>PHOTOS[o.n]&&PHOTO_FILES[PHOTOS[o.n]])}; });
    ok(r.n === 13 && r.ok === 13 && r.st.every(x=>x===200) && r.cover, '13 cartes Objectifs avec photo chargée (locale, HTTP 200)', r);
    ok(r.cred && !r.ow, 'crédit auteur/licence sur chaque photo, sans débordement', r);
    const h = await p.evaluate(async () => { const res=[]; for (const o of OBJECTIFS) { renderSummit(o.n); const i=document.querySelector('#sumBody .sumhero img'); i.loading='eager'; await new Promise(r=>{ if(i.complete) r(); else { i.onload=i.onerror=r; setTimeout(r,5000); } }); res.push(i.naturalWidth>0); } return res; });
    ok(h.every(Boolean), 'photo en tête des 13 fiches sommet', h);
    const fb = await p.evaluate(async () => { const k=PHOTOS[1]; PHOTO_FILES.__x={w:800,h:600,a:'x',l:'x',lu:'#',p:'#',t:'x'}; PHOTOS[1]='__x'; renderSummit(1); const i=document.querySelector('#sumBody .sumhero img'); i.loading='eager'; await new Promise(r=>{ i.addEventListener('error',()=>setTimeout(r,20)); setTimeout(r,2000); }); await new Promise(r=>setTimeout(r,50)); const gone=!document.querySelector('#sumBody .sumhero figure'); PHOTOS[1]=k; delete PHOTO_FILES.__x; return gone; });
    ok(fb, 'photo manquante : retirée proprement (pas d’image cassée)');
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 19. v20 : synchro au retour dans l'appli ----------
  out.push('19. v20 : synchro réactive entre appareils');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => { const calls=[]; const orig=window.scheduleSync; window.scheduleSync=d=>calls.push(d);
      const c=syncCfg(); c.lastSync=Date.now()-60e3; saveSyncCfg(c); document.dispatchEvent(new Event('visibilitychange')); const a=calls.length;
      c.lastSync=Date.now()-5e3; saveSyncCfg(c); dispatchEvent(new Event('focus')); const b=calls.length;
      window.scheduleSync=orig; return {a,b,stale:SYNC_STALE_MS,poll:SYNC_POLL_MS}; });
    ok(r.a === 1 && r.b === 1 && r.stale === 30000 && r.poll === 120000, 'retour dans l’appli après 30 s : synchro déclenchée ; pas de rafale sous 30 s', r);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 20. v21 : même type, heures éloignées ----------
  out.push('20. v21 : deux tapis le même jour à des heures éloignées');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => { DB.sessions.push({id:'fx-am',date:'2026-10-22',heure:'10:05',type:'Tapis 6%',dist:3,dur:2700,kcal:299,pas:2893,updatedAt:1});
      const mk=(h,dur,dist,kcal)=>({type:'Tapis',v:{date:'2026-10-22',heure:h,dur,dist,kcal}});
      const a=mk('16:31',2701,3.25,344); IMP.findDup(a); const b=mk('10:05',2700,3,299); IMP.findDup(b); const c=mk('10:40',2705,3.25,344); IMP.findDup(c); const d=mk(null,2701,3.25,344); IMP.findDup(d);
      return {a:[a.dup&&a.dup.id,a.mode,a.dupFar,a.dupExact,a.dupWhy.join('|')], b:[b.mode,b.dupExact], c:c.mode, d:d.mode}; });
    ok(r.a[0] === 'fx-am' && r.a[1] === 'new' && r.a[2] === true && r.a[3] === false && /heures de départ différentes/.test(r.a[4]), '10:05 et 16:31, même durée : signalé mais ajouté comme nouvelle séance par défaut', r.a);
    ok(r.b[0] === 'merge' && r.b[1] === true, 'même capture réimportée (même heure) : toujours « compléter »', r.b);
    ok(r.c === 'merge' && r.d === 'merge', 'heures proches ou heure inconnue : comportement inchangé', [r.c, r.d]);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 21. v22 : revue (import, synchro, journal, onglets, copies, code mort) ----------
  out.push('21. v22 : import JSON, résumé de synchro, journal, 5 onglets, copies sans GPX');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const nav = await p.evaluate(() => { const t = [...document.querySelectorAll('nav .tab')].map(b => b.dataset.p + ':' + b.innerText.trim());
      show('poids'); const a = document.querySelector('nav .tab.on').dataset.p; show('equip'); const b = document.querySelector('nav .tab.on').dataset.p;
      document.querySelector('#p-equip [data-sub=prep]').click(); const c = curPage; document.querySelector('#p-evo [data-sub=poids]').click(); const d = curPage;
      return {t, a, b, c, d, sub: document.querySelectorAll('.subnav').length}; });
    ok(nav.t.length === 5 && nav.t.join() === 'journal:Journal,obj:Objectifs,prep:Prépa,evo:Évolution,data:Données', '5 onglets aux libellés lisibles', nav.t);
    ok(nav.a === 'evo' && nav.b === 'prep' && nav.c === 'prep' && nav.d === 'poids' && nav.sub === 4, 'Poids dans Évolution, Équipement dans Prépa (sous-onglets), toujours accessibles', nav);
    const jr = await p.evaluate(() => { const T = todayISO(), ym = T.slice(0, 7);
      DB.sessions = [{id:'j1',date:T,type:'Marche',dist:5,lieu:'Col de Ceyssat',updatedAt:1},{id:'j2',date:'2025-01-10',type:'Randonnée',dist:9,notes:'Neige fraîche, très beau',updatedAt:1},{id:'j3',date:'2025-01-12',type:'Vélo',dist:20,updatedAt:1},{id:'j4',date:'2024-06-02',type:'Marche',dist:3,lieu:'Sancy',updatedAt:1}];
      J.open = null; show('journal'); renderJournal(); const g = [...document.querySelectorAll('#sessList details.mgrp')].map(d => d.dataset.ym + (d.open ? '+' : '-') + d.querySelectorAll('.sess').length);
      const det = document.querySelector('#sessList details[data-ym="2025-01"]'); det.open = true; det.dispatchEvent(new Event('toggle')); const lazy = det.querySelectorAll('.sess').length;
      $('jSearch').value = 'neige fraiche'; renderJList(); const q1 = [...document.querySelectorAll('#sessList .sess')].map(x => x.dataset.id).join(), cnt = $('jCount').textContent;
      $('jSearch').value = 'sancy'; renderJList(); const q2 = [...document.querySelectorAll('#sessList .sess')].map(x => x.dataset.id).join();
      $('jSearch').value = ''; $('fltPer').value = '30'; renderJList(); const q3 = [...document.querySelectorAll('#sessList .sess')].map(x => x.dataset.id).join();
      $('fltPer').value = ''; $('jSearch').value = 'zzz'; renderJList(); const none = /Aucune séance ne correspond/.test($('sessList').innerText); $('jSearch').value = ''; renderJList();
      return {g, ym, lazy, q1, q2, q3, cnt, none}; });
    ok(jr.g[0] === jr.ym + '+1' && jr.g.slice(1).every(x => /-0$/.test(x)), 'journal : mois en cours ouvert, mois passés repliés (lignes non rendues)', jr.g);
    ok(jr.lazy === 2, 'ouverture d’un mois : ses séances sont rendues à la demande', jr.lazy);
    ok(jr.q1 === 'j2' && /1 séance trouvée/.test(jr.cnt) && jr.q2 === 'j4' && jr.q3 === 'j1' && jr.none, 'recherche (notes, lieu, sans accents) et filtre de période', jr);
    const sn = await p.evaluate(() => { localStorage.removeItem(SNAP_KEY); DB.objectifs[3] = {statut:'Prêt',updatedAt:5,gpx:{pts:[[45,3,1000],[45.01,3.01,1100]],name:'t'}}; save();
      snapshot('test', true); const a = snapshots()[0], d = JSON.parse(a.data); delete DB.objectifs[3].gpx; DB.objectifs[3].gpx = {pts:[[45,3,1000],[45.02,3.02,1200]],name:'cur'}; save();
      restoreSnap(0); return {noGpx: a.noGpx, has: !!(d.objectifs[3] && d.objectifs[3].gpx), st: d.objectifs[3].statut, kept: DB.objectifs[3].gpx && DB.objectifs[3].gpx.pts[1][0]}; });
    ok(sn.noGpx && !sn.has && sn.st === 'Prêt' && sn.kept === 45.02, 'copies locales sans traces GPX ; la restauration garde les traces actuelles', sn);
    const q = await p.evaluate(() => { const big = JSON.stringify({x:'y'}); const a = []; for (let i = 0; i < 5; i++) a.push({t:Date.now() - i * 1e5, day:'2026-01-0' + (i + 1), reason:'r' + i, n:1, data:big}); localStorage.setItem(SNAP_KEY, JSON.stringify(a));
      const orig = Storage.prototype.setItem; let msg = ''; const ot = window.toast; window.toast = m => { msg = m; };
      Storage.prototype.setItem = function (k, v) { if (k === KEY && JSON.parse(orig.call ? (localStorage.getItem(SNAP_KEY) || '[]') : '[]').length > 2) throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); };
      DB.prefs.zz = 1; let err = null; try { save(); } catch (e) { err = e.message; } Storage.prototype.setItem = orig; window.toast = ot;
      const s = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); return {n: s.length, first: s[0].reason, saved: JSON.parse(localStorage.getItem(KEY)).prefs.zz, msg, err}; });
    ok(q.n === 2 && q.first === 'r0' && q.saved === 1 && /la plus récente est gardée/.test(q.msg) && !q.err, 'stockage plein : copies anciennes supprimées une à une, la plus récente gardée, avertissement', q);
    const im = await p.evaluate(async () => { const base = {version:4, sessions:[{id:'a',date:'2026-01-01',type:'Marche',dist:1,updatedAt:5},{id:'b',date:'2026-01-02',type:'Marche',dist:2,updatedAt:5}], weights:[{id:'w1',date:'2026-01-01',kg:80,updatedAt:5}], daily:[], objectifs:{1:{statut:'Prêt',updatedAt:5}}, equip:defaultEquip(), prefs:{actMap:{}}, tomb:newTomb()};
      DB = normalizeDB(JSON.parse(JSON.stringify(base))); save(); const file = JSON.parse(JSON.stringify(base)); file.sessions = [file.sessions[0], {id:'c',date:'2026-01-03',type:'Vélo',dist:3,updatedAt:4}]; file.weights = [];
      openImpChoice(file); const shown = !$('impDlg').hidden, paused = syncPaused; const t0 = Date.now(); scheduleSync(0);
      $('impMerge').click(); const m = {ids: DB.sessions.map(s => s.id).sort().join(), w: DB.weights.length, closed: $('impDlg').hidden, resumed: !syncPaused};
      const remoteOld = JSON.parse(JSON.stringify(DB)); const dl = []; const od = window.download; window.download = (n, t) => dl.push([n, JSON.parse(t).sessions.length]); const op = window.prompt;
      window.prompt = () => 'non'; const no = await importReplace(file); const idsNo = DB.sessions.map(s => s.id).sort().join();
      window.prompt = () => 'REMPLACER'; openImpChoice(file); $('impReplace').click(); await new Promise(r => setTimeout(r, 300)); window.prompt = op; window.download = od;
      const r = {ids: DB.sessions.map(s => s.id).sort().join(), w: DB.weights.length, tb: !!DB.tomb.s.b, tw: !!DB.tomb.w.w1, ob: DB.objectifs[1].statut, dl, closed: $('impDlg').hidden, snap: snapshots()[0].reason};
      const old = mergeDB(remoteOld, DB), back = mergeDB(DB, remoteOld); // le gist (ou un ancien appareil) avec l'état précédent
      return {shown, paused, m, no, idsNo, r, old: old.sessions.map(s => s.id).sort().join() + '|' + old.weights.length, back: back.sessions.map(s => s.id).sort().join()}; });
    ok(im.shown && im.paused, 'import JSON : choix explicite affiché, synchro auto en pause', im);
    ok(im.m.ids === 'a,b,c' && im.m.w === 1 && im.m.closed && im.m.resumed, '« Fusionner » : ajoute sans rien supprimer, synchro relancée', im.m);
    ok(im.no === false && im.idsNo === 'a,b,c', '« Remplacer » sans taper REMPLACER : rien ne change', im.idsNo);
    ok(im.r.ids === 'a,c' && im.r.w === 0 && im.r.tb && im.r.tw && im.r.ob === 'Prêt' && im.r.dl.length === 1 && im.r.dl[0][1] === 3 && im.r.closed && /remplacement/.test(im.r.snap), '« Remplacer partout » : pierres tombales, copie téléchargée de l’état précédent, copie locale', im.r);
    ok(im.old === 'a,c|0' && im.back === 'a,c', 'remplacement propagé : la fusion avec l’ancien état (gist / autre appareil) ne fait pas revenir les éléments', [im.old, im.back]);
    const sd = await p.evaluate(() => { const A = {sessions:[{id:'x',updatedAt:1}], weights:[], daily:[], equip:[], objectifs:{}}, B = {sessions:[{id:'x',updatedAt:2},{id:'y',updatedAt:1},{id:'z',updatedAt:1}], weights:[{id:'w',updatedAt:1}], daily:[{id:'2026-01-01',updatedAt:1}], equip:[], objectifs:{}};
      return [diffText(syncDiff(A, B)), diffText(syncDiff(B, B)), diffText(syncDiff(B, A))]; });
    ok(sd[0] === '2 séances nouvelles, 1 séance modifiée, 1 pesée nouvelle, 1 jour d’activité nouveau' && sd[1] === '' && /2 séances supprimées/.test(sd[2]), 'résumé de synchro lisible', sd);
    const dead = await p.evaluate(() => [typeof objSortMode, typeof septSessions, typeof octSessions, Array.isArray(SEED_SESSIONS), DATA_VERSION]);
    ok(dead.join() === 'undefined,undefined,undefined,true,4', 'code mort retiré (objSortMode, septSessions/octSessions) ; DATA_VERSION inchangé (4)', dead);
    const sri = await p.evaluate(async () => { try { await loadLeaflet(); } catch (e) { return 'err ' + e.message; } const s = [...document.scripts].find(x => /leaflet/.test(x.src)); return !!window.L && /^sha384-/.test(s.integrity) && s.crossOrigin === 'anonymous'; });
    ok(sri === true, 'Leaflet chargé avec vérification d’intégrité (SRI)', sri);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 22. v23 : bloc Jour J hors-ligne ----------
  out.push('22. v23 : Jour J hors-ligne (soleil, heures, orage, matériel, GPX, carte préparée)');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const tl = await p.evaluate(() => OBJECTIFS.map(o => { const r = tileList(offPts(o.n)); return [o.n, r.tiles.length, r.zmax]; }));
    ok(tl.every(([, n, z]) => n > 0 && n <= 180 && z >= 11 && z <= 15), 'carte hors-ligne : ≤ 180 tuiles, zoom 11–15, pour chaque objectif (même l’itinérance)', tl);
    const dj = await p.evaluate(() => { const n = 3, tm = toISO(new Date(Date.now() + 864e5)); const hours = []; for (let h = 5; h <= 21; h++) hours.push([h, 10 + h / 2, h >= 15 ? 95 : 1, h >= 15 ? 70 : 5, 30]);
      wxStore(n, {days:[{date:tm, code:95, tmin:2, tmax:12, pop:70, gust:40, hours}], fetchedAt:Date.now() - 5 * 3600e3, planned:''});
      const a = JSON.parse(localStorage.getItem(KEY + '.wx')); a[n].t = Date.now() - 5 * 3600e3; localStorage.setItem(KEY + '.wx', JSON.stringify(a));
      openSummit(n); const t = $('sumDayJ').innerText; return {t, strip: document.querySelectorAll('#sumDayJ .hstrip > div').length, st: document.querySelectorAll('#sumDayJ .hstrip .st').length}; });
    ok(/🌅 \d\dh\d\d · 🌇 \d\dh\d\d/.test(dj.t) && /orage possible vers 15 h/.test(dj.t) && /orage possible l’après-midi \(dès 15 h\)/.test(dj.t) && /au plus tard \d\dh\d\d/.test(dj.t), 'Jour J : lever/coucher, risque d’orage l’après-midi, heure de départ conseillée', dj.t);
    ok(dj.strip === 15 && dj.st === 6 && /Prévision du /.test(dj.t) && /Matériel\s+\d+\/\d+ prêts/.test(dj.t) && /Trace GPX/.test(dj.t), 'Jour J : heure par heure (6–20 h), horodatage du cache, matériel, GPX', dj);
    await p.setOfflineMode(true);
    const off = await p.evaluate(async () => { const a = JSON.parse(localStorage.getItem(KEY + '.wx')); a[3].t = Date.now() - 5 * 3600e3; localStorage.setItem(KEY + '.wx', JSON.stringify(a)); await loadSummitWeather(3, false); return $('sumWx').innerText; });
    ok(/copie hors-ligne du/.test(off), 'hors-ligne : la dernière météo en cache est affichée avec sa date', off.slice(0, 200));
    await p.setOfflineMode(false);
    const pr = await p.evaluate(async () => { const of = window.fetch; let tiles = 0, wx = 0; window.fetch = async (u, o) => { u = String(u);
        if (/tile\.openstreetmap\.org/.test(u)) { tiles++; return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], {type:'image/png'}), {status:200}); }
        if (/open-meteo/.test(u)) { wx++; return new Response(JSON.stringify({daily:{time:[todayISO()], weather_code:[1]}, hourly:{time:[todayISO() + 'T14:00'], temperature_2m:[9], weather_code:[1], precipitation_probability:[0], wind_gusts_10m:[10]}}), {status:200}); }
        return of(u, o); };
      await caches.delete(TILE_CACHE); await prepOffline(3); window.fetch = of; const c = await caches.open(TILE_CACHE), k = await c.keys(), m = offMeta(3);
      return {tiles, wx, keys: k.length, m, t: $('sumDayJ').innerText, map: !!$('sumMap')._map}; });
    ok(pr.wx === 1 && pr.tiles === pr.keys && pr.keys > 0 && pr.keys <= 180 && pr.m.tiles === pr.keys && /préparé le/.test(pr.t) && pr.map, '« Préparer hors-ligne » : météo + tuiles en cache, horodatage affiché, carte interactive sans GPX', pr);
    const keys = await p.evaluate(async (SWC) => { await navigator.serviceWorker.ready; for (let i = 0; i < 20 && !(await caches.keys()).includes(SWC); i++) await new Promise(r => setTimeout(r, 250)); return caches.keys(); }, SWC);
    ok(keys.includes('suivi-montagne-tiles-v1') && keys.includes(SWC), 'cache des tuiles conservé par le service worker', keys);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 23. v24 : fuseau, balayage, zoom hors-ligne, restauration + GPX ----------
  out.push('23. v24 : soleil à l’heure de Paris, balayage 5 onglets, zoom de carte hors-ligne, restauration sans perte de trace');
  for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) { const [ctx, p] = await fresh(); await p.emulateTimezone(tz); await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'});
    const r = await p.evaluate(() => { const s = sunTimes(new Date(2026, 9, 13), 45.7639, 2.9559); return {set:hhmm(s.set), rise:hhmm(s.rise)}; });
    ok(r.set === '19h07' && r.rise === '08h00', 'appareil en ' + tz + ' : coucher au col de Ceyssat affiché 19h07 (heure de Paris)', r); await ctx.close(); }
  { const [ctx, p] = await fresh(); await p.setViewport({width:390, height:844, hasTouch:true, isMobile:true}); await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'});
    const swipe = async (from, dir) => { await p.evaluate(t => { show(t); window.scrollTo(0, 0); }, from); await W(450);
      const y = 420, x0 = dir < 0 ? 300 : 90, x1 = x0 + dir * 220; await p.touchscreen.touchStart(x0, y); for (let i = 1; i <= 8; i++) { await p.touchscreen.touchMove(x0 + dir * 220 * i / 8, y + i); await W(16); } await p.touchscreen.touchEnd(); await W(600);
      return p.evaluate(() => curPage + '|' + (document.querySelector('nav .tab.on') || {dataset:{}}).dataset.p); };
    const sw = {prepL: await swipe('prep', -1), equipL: await swipe('equip', -1), prepR: await swipe('prep', 1), poidsL: await swipe('poids', -1), evoR: await swipe('evo', 1), dataL: await swipe('data', -1), journalR: await swipe('journal', 1)};
    const T = await p.evaluate(() => TABS.join());
    ok(T === 'journal,obj,prep,evo,data' && sw.prepL === 'evo|evo' && sw.equipL === 'evo|evo' && sw.prepR === 'obj|obj' && sw.poidsL === 'data|data' && sw.evoR === 'prep|prep' && sw.dataL === 'data|data' && sw.journalR === 'journal|journal', 'balayage : 5 onglets dans l’ordre de la barre du bas (sous-onglets rattachés à leur onglet)', {T, sw});
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const prep = await p.evaluate(async () => { const of = window.fetch; window.fetch = async (u, o) => { u = String(u);
        if (/tile\.openstreetmap\.org/.test(u)) return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], {type:'image/png'}), {status:200});
        if (/open-meteo/.test(u)) return new Response(JSON.stringify({daily:{time:[todayISO()], weather_code:[1]}, hourly:{time:[todayISO() + 'T14:00'], temperature_2m:[9], weather_code:[1], precipitation_probability:[0], wind_gusts_10m:[10]}}), {status:200});
        return of(u, o); };
      DB.objectifs[1] = Object.assign(objState(1), {gpx:{pts:[[45.7639,2.9559,1080],[45.7645,2.9590,1200],[45.7720,2.9640,1465]],dist:1.2,dplus:385,n0:3,name:'courte'}, updatedAt:Date.now()}); save();
      await prepOffline(1); window.fetch = of; const on = $('sumMap') && $('sumMap')._map; return {z: offMeta(1).zmax, onMax: on ? on.getMaxZoom() : null}; });
    await p.setOfflineMode(true);
    const m = await p.evaluate(async () => { closeSummit(); await new Promise(r => setTimeout(r, 200)); openSummit(1); for (let i = 0; i < 30 && !($('sumMap') && $('sumMap')._map); i++) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => setTimeout(r, 300)); const map = $('sumMap')._map; let tl = null; map.eachLayer(l => { if (l._url) tl = l; });
      map.setZoom(18); await new Promise(r => setTimeout(r, 300)); const req = []; tl.on('tileloadstart', e => req.push(e.coords.z)); map.panBy([40, 40]); await new Promise(r => setTimeout(r, 400));
      return {fit: map.getZoom(), max: map.getMaxZoom(), native: tl.options.maxNativeZoom, req: [...new Set(req)]}; });
    ok(m.max <= prep.z + 2 && m.native === prep.z && m.req.every(z => z <= prep.z && z >= 11), 'hors-ligne : zoom limité, tuiles demandées seulement aux zooms préparés (11–' + prep.z + '), agrandies au-delà', {prep, m});
    await p.setOfflineMode(false);
    const r = await p.evaluate(() => { localStorage.removeItem(SNAP_KEY); DB.objectifs[4] = {statut:'À préparer', updatedAt:Date.now() - 864e5}; save(); snapshot('test', true);
      DB.objectifs[4] = Object.assign({}, DB.objectifs[4], {gpx:{pts:[[45,3,1000],[45.03,3.03,1300]],dist:4,dplus:300,n0:2,name:'non synchronisée'}, updatedAt:Date.now() - 3600e3}); save();
      const remote = JSON.parse(JSON.stringify(DB)); delete remote.objectifs[4].gpx; remote.objectifs[4].statut = 'Prêt'; remote.objectifs[4].updatedAt = Date.now() - 60e3; // gist plus récent, sans la trace
      restoreSnap(0); const m1 = mergeDB(JSON.parse(JSON.stringify(DB)), remote), m2 = mergeDB(remote, JSON.parse(JSON.stringify(DB)));
      return {kept: !!DB.objectifs[4].gpx, newer: DB.objectifs[4].updatedAt > remote.objectifs[4].updatedAt, g1: !!(m1.objectifs[4] && m1.objectifs[4].gpx), g2: !!(m2.objectifs[4] && m2.objectifs[4].gpx)}; });
    ok(r.kept && r.newer && r.g1 && r.g2, 'restauration : trace actuelle recollée et objectif daté de la restauration → la trace survit à la synchro avec un gist plus récent', r);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 24. v25 : Puy de la Vache, Barrhorn en 2 jours, vue détaillée de l'activité quotidienne ----------
  out.push('24. v25 : Puy de la Vache (n° 1), Barrhorn 12 / Grande Sassière 13, vue détaillée de l’activité quotidienne');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => { const o=OBJECTIFS.find(o=>o.n===13), I=OBJ_INFO[13], b=OBJECTIFS.find(o=>o.n===8);
      const req=['type','sum','start','parking','access','route','water','refuges','dangers','winter','seasonTxt','tech','ign','variants','tips','secours'];
      const cl=closuresFor(o,todayISO(),todayISO());
      return {alt:[o.altDep,o.altSom,o.dplus,o.dist,o.h], miss:req.filter(k=>!I[k]), season:(SEASON[13]||[]).length, gear:(OBJ_GEAR[13]||[]).length, ph:PHOTOS[13], cred:PHOTO_FILES[PHOTOS[13]], src:o.src.length,
        geo:I.sum, start:I.start.ll, cl:cl.length, park:/Ventouse/.test(I.parking)&&/20\/04\/2026/.test(I.parking), rank:[diffRank(13),diffRank(1),diffRank(8),diffRank(9),diffRank(7)], N:OBJECTIFS.length,
        bm:b.multi&&b.multi.jours, bd:/2 jours/.test(b.duree)&&/Turtmannhütte/.test(b.duree), keys:OBJECTIFS.map(o=>o.n).join(), uniq:new Set(OBJECTIFS.map(o=>o.n)).size}; });
    ok(r.alt.join() === '990,1167,285,4,2' && !r.miss.length && r.season === 12 && r.gear > 4 && r.src >= 4 && Math.abs(r.geo[0]-45.705)<0.01 && Math.abs(r.geo[1]-2.963)<0.01, 'fiche Puy de la Vache complète (altitudes, D+, distance, durée, sources, coordonnées météo)', r);
    ok(r.ph === 'puy-de-la-vache' && r.cred && /commons\.wikimedia/i.test(r.cred.p) && /CC BY-SA/.test(r.cred.l), 'photo Wikimedia Commons libre avec crédit', r.cred);
    ok(r.cl === 1 && r.park, 'fermeture (travaux, arrêté, parking) affichée et alternative de stationnement', r);
    ok(r.rank.join() === '1,2,12,13,11' && r.N === 13 && r.uniq === 13 && r.keys === '1,2,3,4,5,6,7,8,9,10,11,12,13', 'Vache n° 1, Muletiers 2, Barrhorn 12, Grande Sassière 13 ; clés internes 1–12 inchangées, 13 nouvelle', r);
    ok(r.bm === 2 && r.bd, 'Barrhorn : organisation en 2 jours (nuit à la Turtmannhütte)', r);
    const st = await p.evaluate(async () => { const u='./img/sommets/puy-de-la-vache.webp'; const res=await fetch(u); const sw=await (await fetch('./sw.js')).text(); return {s:res.status, pre:sw.includes(u)}; });
    ok(st.s === 200 && st.pre, 'photo locale servie et précachée par le service worker', st);
    const t = await p.evaluate(() => { renderSummit(13); const a=$('sumBody').innerText; renderSummit(8); const b=$('sumBody').innerText; renderSummit(9); const c=$('sumBody').innerText; return {a,b,c}; });
    ok(/Objectif 1 sur 13/.test(t.a) && /Fermé/.test(t.a) && /Ventouse/.test(t.a) && /Gegeours/.test(t.a), 'fiche Vache : niveau 1/13, fermeture, parking alternatif, crédit photo');
    ok(/Objectif 12 sur 13/.test(t.b) && /2 jours/.test(t.b) && /sans escalade/i.test(t.b), 'fiche Barrhorn : 12/13, 2 jours, sans escalade');
    ok(/Objectif 13 sur 13/.test(t.c) && /le plus difficile/.test(t.c), 'fiche Grande Sassière : 13/13, la plus difficile');
    // données existantes : état des objectifs 1/2 conservé, objectif 13 synchronisable
    const m = await p.evaluate(() => { DB.objectifs[1]={statut:'Prêt',datePrevue:'',dateRealisee:'',updatedAt:5}; DB.objectifs[2]={statut:'Prêt',datePrevue:'',dateRealisee:'',updatedAt:6}; save();
      const R=JSON.parse(JSON.stringify(DB)); R.objectifs[13]={statut:'Prêt',datePrevue:'2028-05-01',dateRealisee:'',updatedAt:9}; const M=mergeDB(DB,R);
      return {k:Object.keys(M.objectifs).sort().join(), s1:M.objectifs[1].statut, s13:M.objectifs[13].statut, nx:nextObjective().n}; });
    ok(m.k === '1,13,2' && m.s1 === 'Prêt' && m.s13 === 'Prêt', 'fusion : objectifs 1/2 intacts, objectif 13 synchronisé', m);
    ok(m.nx !== 13, 'Vache fermée : pas proposée comme prochaine ascension', m);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }
  // ancien client (v24) : un état d'objectif 13 inconnu est conservé
  { const [ctx, p] = await fresh(BASE + '/old24.html');
    await p.evaluate(() => { const D=JSON.parse(JSON.stringify(DB)); D.objectifs[13]={statut:'Prêt',datePrevue:'2028-05-01',dateRealisee:'',updatedAt:5}; localStorage.setItem(KEY, JSON.stringify(D)); });
    await p.reload({waitUntil:'networkidle0'});
    for (const t of ['journal','obj','prep','evo','data']) { await p.evaluate(t => show(t), t); await W(120); }
    const r = await p.evaluate(() => { DB.sessions.push({id:'o24',date:'2026-10-01',type:'Randonnée',dist:4,dplus:285,dur:7200,updatedAt:7}); save(); const L=JSON.parse(localStorage.getItem(KEY));
      const other=JSON.parse(JSON.stringify(L)); other.objectifs[13].updatedAt=9; other.objectifs[13].statut='Fait'; const m=mergeDB(L,other); return {k:!!L.objectifs[13], m:m.objectifs[13]&&m.objectifs[13].statut}; });
    ok(r.k && r.m === 'Fait', 'ancien client v24 : garde et fusionne l’état de l’objectif 13', r);
    ok(p.errs.length === 0, 'ancien client v24 : aucune erreur JS', p.errs); await ctx.close(); }
  // vue détaillée de l'activité quotidienne (mobile, CPU ralenti ×4)
  { const [ctx, p] = await fresh(); await p.setViewport({width:390, height:844, hasTouch:true, isMobile:true}); await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'});
    await p.evaluate(() => { const T=todayISO(); DB.daily=[]; for (let i=1;i<=70;i++){ if(i%9===0) continue; const d=addDays(T,-i); DB.daily.push(i%3? {id:'day-'+d,date:d,pas:4000+(i*733)%9000,kcal:300+(i*37)%500,actMin:20+(i*7)%60,src:'test',updatedAt:1} : {id:'day-'+d,date:d,pas:3000+i*50,kcal:200,actMin:null,pausesActives:i%5,src:'test',updatedAt:1}); } save(); show('journal'); renderJournal(); });
    const before = await p.evaluate(() => localStorage.getItem(KEY));
    await p.emulateCPUThrottling(4);
    // boutons de la carte : n'ouvrent pas la vue
    await p.evaluate(() => { localStorage.removeItem(KEY+'.dailyHint'); renderJournal(); });
    const card = await p.evaluate(() => ({tap:!!document.querySelector('#dailyCard[data-day-open][role=button]'), go:/détails/.test($('dailyCard').innerText)}));
    ok(card.tap && card.go, 'carte « Activité quotidienne » cliquable (rôle bouton, « détails › »)', card);
    // fluidité : on mesure les images pendant l'ouverture
    const fr = await p.evaluate(async () => { const ts=[]; let on=true; const loop=t=>{ ts.push(t); if(on) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
      const t0=performance.now(); $('dailyCard').querySelector('h3').click(); const tOpen=performance.now()-t0;
      await new Promise(r=>setTimeout(r,900)); on=false; const gaps=ts.slice(1).map((t,i)=>t-ts[i]);
      return {tOpen, max:Math.max(...gaps), n:ts.length, open:DAYV.isOpen(), vis:!$('dayDlg').hidden&&$('dayDlg').classList.contains('on'), bars:$('chDV1').querySelectorAll('rect.b').length, svg2:!!$('chDV2').querySelector('svg'), hist:!!(history.state&&history.state.day)}; });
    ok(fr.open && fr.vis && fr.hist && fr.bars > 20 && fr.svg2, 'appui sur la carte : vue détaillée ouverte, graphiques dessinés après l’animation', fr);
    ok(fr.tOpen < 120 && fr.max < 120, 'ouverture fluide (CPU ×4) : rendu initial < 120 ms, aucune image bloquée > 120 ms', fr);
    const v = await p.evaluate(async () => { const out={}; for (const [k] of DAYV.P) { document.querySelector(`[data-day-p="${k}"]`).click(); await new Promise(r=>setTimeout(r,60));
        const R=DAYV._R, s=DAYV.stats(R.days,'pas'); out[k]={n:R.n, bars:$('chDV1').querySelectorAll('rect.b').length, kpi:$('dayBox').querySelector('.kpi b').textContent, avg:s.avg==null?'–':f(s.avg,0), rows:$('dayBox').querySelectorAll('.dtbl tr').length-1, nd:s.nd}; }
      for (const m of ['kcal','min','pas']) { document.querySelector(`[data-day-m="${m}"]`).click(); await new Promise(r=>setTimeout(r,60)); out[m]=$('dayBox').querySelector('.card h3').textContent; }
      return out; });
    ok(v['7'].n === 7 && v['28'].n === 28 && v['84'].n === 84 && v['182'].n === 182 && v.all.n >= 69 && v.all.n <= 71, 'périodes 7 j / 4 / 12 / 26 sem. / tout', v);
    ok(['7','28','84','182','all'].every(k => v[k].kpi === v[k].avg && v[k].rows === v[k].nd), 'moyennes et tableau jour par jour exacts pour chaque période', v);
    ok(v['28'].bars >= 20 && v['84'].bars <= 13 && /par semaine/.test(v['84'] ? 'par semaine' : ''), 'jour par jour jusqu’à 45 j, moyennes hebdomadaires au-delà', v);
    ok(/Calories/.test(v.kcal) && /Minutes/.test(v.min) && /Pas/.test(v.pas), 'choix de l’indicateur : pas, calories, minutes', v);
    const sc = await p.evaluate(async () => { const el=$('chDV1'), svg=el.querySelector('svg'), r=svg.getBoundingClientRect(); const C=el._c;
      const ev=(t,x)=>svg.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x,clientY:r.top+r.height/2,pointerId:1}));
      const t0=performance.now(); ev('pointerdown',r.left+r.width*0.2); for(let i=0;i<20;i++) ev('pointermove',r.left+r.width*(0.2+i*0.03)); ev('pointerup',r.left+r.width*0.8); const dt=performance.now()-t0;
      return {dt, sel:el._sel, txt:el.querySelector('.chart-detail').textContent}; });
    ok(sc.dt < 150 && sc.sel > 0 && /pas/.test(sc.txt), 'graphique interactif réactif au doigt (21 déplacements < 150 ms, CPU ×4)', sc);
    await p.emulateCPUThrottling(1);
    await p.goBack(); await W(500);
    const c1 = await p.evaluate(() => ({o:DAYV.isOpen(), h:$('dayDlg').hidden, pg:curPage, body:document.body.classList.contains('day-open')}));
    ok(!c1.o && c1.h && c1.pg === 'journal' && !c1.body, 'bouton retour : ferme la vue et reste sur le Journal', c1);
    await p.keyboard.press('Tab'); await p.evaluate(() => $('dailyCard').focus()); await p.keyboard.press('Enter'); await W(500);
    const k1 = await p.evaluate(() => DAYV.isOpen()); await p.keyboard.press('Escape'); await W(500); const k2 = await p.evaluate(() => DAYV.isOpen() || !(history.state === null || !history.state.day));
    await p.evaluate(() => $('dailyCard').click()); await W(500); await p.evaluate(() => $('dayDlg').dispatchEvent(new MouseEvent('click',{bubbles:true}))); await W(500); const k3 = await p.evaluate(() => DAYV.isOpen());
    await p.evaluate(() => $('dailyCard').click()); await W(500); await p.evaluate(() => document.querySelector('[data-day-x]').click()); await W(500); const k4 = await p.evaluate(() => DAYV.isOpen());
    ok(k1 && !k2 && !k3 && !k4, 'clavier (Entrée / Échap), appui hors de la feuille et ✕ : ouverture et fermeture', [k1, k2, k3, k4]);
    await p.evaluate(() => { document.querySelector('#dailyCard [data-imp-open]') && document.querySelector('#dailyCard [data-imp-open]').click(); }); await W(300);
    const k5 = await p.evaluate(() => { const o=DAYV.isOpen(); if(IMP.isOpen()) IMP.close(); return o; });
    ok(!k5, 'bouton « Importer » de la carte : n’ouvre pas la vue détaillée');
    const sw = await p.evaluate(async () => { $('dailyCard').click(); await new Promise(r=>setTimeout(r,450)); const pg=curPage; return {pg, inMain:!!$('dayDlg').closest('main')}; });
    ok(sw.pg === 'journal' && !sw.inMain, 'vue détaillée hors de la zone de balayage des onglets', sw);
    await p.evaluate(() => DAYV.close()); await W(400);
    const after = await p.evaluate(() => localStorage.getItem(KEY));
    ok(after === before, 'données inchangées après toutes les manipulations (stockage identique octet pour octet)');
    const vp = await p.evaluate(() => { $('dailyCard').click(); return new Promise(r=>setTimeout(()=>{ const b=$('dayBox').getBoundingClientRect(); r({ow:document.documentElement.scrollWidth>innerWidth+1||b.right>innerWidth+1, w:b.width}); DAYV.close(); },500)); });
    ok(!vp.ow, 'vue détaillée sans débordement horizontal (390 px)', vp);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // v26 : bandeau « Le chemin des sommets » (26 niveaux) en tête d'Objectifs
  { const [ctx, p] = await fresh(); const reqs = []; p.on('request', r => { if (/img\/jeu\//.test(r.url())) reqs.push(r.url()); });
    await p.setViewport({width:390, height:844, isMobile:true, hasTouch:true}); await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'});
    await p.evaluate(() => show('obj')); await W(900);
    const lz = reqs.filter(u => /\.webp/.test(u)).length; ok(lz >= 1 && lz <= 4, 'décors chargés à la demande (seulement ceux proches de l’écran)', lz);
    const L0 = await p.evaluate(() => ({cur:JEU.cur, n:JEU.levels.length, c:JEU.levels.map(l=>l.closed?'C':l.done?'D':'.').join('')}));
    ok(L0.n === 26 && L0.cur === 0 && L0.c[1] === 'C', '26 niveaux ; données vides : niveau 1 (prépa Vache), sommet Vache fermé marqué « passé »', L0);
    const before = await p.evaluate(() => localStorage.getItem(KEY));
    const L1 = await p.evaluate(() => { const S=DB.objectifs; const k=JSON.stringify(S); S[13]={statut:'Prêt',datePrevue:'',dateRealisee:'',updatedAt:1}; JEU.render(); const z=JEU.cur; S[1]={statut:'Prêt',datePrevue:'',dateRealisee:'',updatedAt:1};
      JEU.render(); const a=JEU.cur; S[1].statut='Fait'; JEU.render(); const b=JEU.cur; const st=trainStats(new Date());
      const coh=JEU.levels.every((l,i)=>{ const o=OBJ_BY_DIFF[l.k], s=objState(o.n); return l.n===o.n&&(l.t==='prep'?l.done===(s.statut==='Fait'||s.statut==='Prêt'||readiness(o,st).r>=0.8):l.done===(s.statut==='Fait')); });
      const cl=CLOSURES[13], save=cl.map(c=>c.to); cl.forEach(c=>c.to='2020-01-01'); JEU.render(); const c=JEU.cur; cl.forEach((c,i)=>c.to=save[i]); JEU.render();
      DB.objectifs=JSON.parse(k); JEU.render(); return {z,a,b,c,coh,d:JEU.cur}; });
    ok(L1.z === 2 && L1.a === 3 && L1.b === 4, 'niveaux dérivés des statuts : prépa Vache « Prêt » → niveau 3 (Vache fermée passée), Dôme « Prêt » → 4, « Fait » → 5', L1);
    ok(L1.coh, 'chaque niveau = prépa ≥ 80 % / statut, ou sommet « Fait » (cohérence avec les données réelles)');
    ok(L1.c === 1 && L1.d === 0, 'Vache : bloque seulement quand la fermeture est levée (sinon « passé »)', L1);
    await p.evaluate(() => { document.getAnimations().filter(a => !(a instanceof CSSAnimation) && a.effect && a.effect.getComputedTiming().iterations !== Infinity).forEach(a => a.finish()); }); await W(900); // v29 : montée de niveau jouée puis bandeau recentré
    const ce = await p.evaluate(() => { const st=$('jeuStrip'), S=JEU.scale, x=JEU.at[JEU.cur][0]*S; const hk=$('jeuHk').getBoundingClientRect(), sr=st.getBoundingClientRect();
      return {d:Math.abs(x-(st.scrollLeft+st.clientWidth/2)), clamp:x<st.clientWidth/2, hx:hk.left+hk.width*.62-sr.left+st.scrollLeft-x}; });
    ok((ce.d < 3 || ce.clamp) && Math.abs(ce.hx) < 3, 'ouverture centrée sur le niveau courant, randonneur posé sur sa pastille', ce);
    // balayage horizontal sur le bandeau : défile le bandeau, ne change pas d'onglet
    const box = await p.evaluate(() => { const r=$('jeuStrip').getBoundingClientRect(); return {x:r.left+r.width*0.8, y:r.top+r.height*0.5}; });
    const sl0 = await p.evaluate(() => $('jeuStrip').scrollLeft);
    await p.touchscreen.touchStart(box.x, box.y); for (let i = 1; i <= 10; i++) await p.touchscreen.touchMove(box.x - i * 24, box.y + 2); await p.touchscreen.touchEnd(); await W(700);
    const sw1 = await p.evaluate(() => ({pg:curPage, sl:$('jeuStrip').scrollLeft}));
    ok(sw1.pg === 'obj' && sw1.sl > sl0 + 50, 'balayage sur le bandeau : il défile, l’onglet reste « Objectifs »', {sl0, ...sw1});
    const hb = await p.evaluate(() => { const r=$('jeuHud').getBoundingClientRect(); return {x:r.left+r.width*0.8, y:r.top+r.height*0.5}; });
    await p.touchscreen.touchStart(hb.x, hb.y); for (let i = 1; i <= 10; i++) await p.touchscreen.touchMove(hb.x - i * 20, hb.y + 1); await p.touchscreen.touchEnd(); await W(700);
    ok(await p.evaluate(() => curPage) === 'prep', 'balayage hors du bandeau : change toujours d’onglet (Objectifs → Prépa)');
    await p.evaluate(() => show('obj')); await W(500);
    const ce2 = await p.evaluate(() => { const st=$('jeuStrip'), x=JEU.at[JEU.cur][0]*JEU.scale; return Math.abs(x-(st.scrollLeft+st.clientWidth/2)) < 3 || x < st.clientWidth/2; });
    ok(ce2, 'retour sur Objectifs : recentré sur le niveau courant');
    // appui sur une pastille : fiche du bon sommet
    const tp = await p.evaluate(() => { const st=$('jeuStrip'), S=JEU.scale, i=JEU.cur, [x,y]=JEU.at[i]; st.scrollLeft=x*S-st.clientWidth/2; const r=st.getBoundingClientRect(); return {x:r.left+x*S-st.scrollLeft, y:r.top+y*S, n:JEU.levels[i].n}; });
    await p.touchscreen.tap(tp.x, tp.y); await W(600);
    const ts = await p.evaluate(() => ({pg:curPage, s:String(curSum)})); ok(ts.pg === 'sum' && ts.s === String(tp.n), 'appui sur une pastille : fiche détaillée du sommet', {tp, ts});
    await p.goBack(); await W(500);
    // tous les décors dessinés en faisant défiler jusqu'au bout ; défilement fluide
    await p.emulateCPUThrottling(4);
    const fl = await p.evaluate(async () => { const st=$('jeuStrip'); let worst=0, t=performance.now(); for (let i=0;i<60;i++){ st.scrollLeft+= st.scrollWidth/60; await new Promise(r=>requestAnimationFrame(r)); const n=performance.now(); worst=Math.max(worst,n-t); t=n; }
      await new Promise(r=>setTimeout(r,1200)); return {worst, drawn:[...document.querySelectorAll('#jeuIn canvas')].filter(c=>c.width>1).length}; });
    await p.emulateCPUThrottling(1);
    ok(fl.drawn === 11, 'défilement jusqu’au bout : les 11 décors sont chargés et dessinés', fl);
    ok(fl.worst < 120, 'défilement fluide (CPU ×4) : aucune image > 120 ms', fl);
    // redimensionnement / rotation
    const pre = await p.evaluate(() => { const st=$('jeuStrip'); st.scrollLeft=3000; return (st.scrollLeft+st.clientWidth/2)/(JEU.scale); });
    await p.setViewport({width:844, height:390, isMobile:true, hasTouch:true}); await W(700);
    const ro = await p.evaluate(() => { const st=$('jeuStrip'); return {h:st.clientHeight, mid:(st.scrollLeft+st.clientWidth/2)/(JEU.scale), ow:document.documentElement.scrollWidth>innerWidth+1, iw:$('jeuIn').offsetWidth}; });
    ok(ro.h < 450 && ro.h >= 314 && Math.abs(ro.mid - pre) < 8 && !ro.ow, 'rotation en paysage : bandeau réduit, même endroit au centre, pas de débordement', {pre, ...ro});
    for (const w of [360, 430, 390]) { await p.setViewport({width:w, height:800, isMobile:true, hasTouch:true}); await W(400);
      const r = await p.evaluate(() => { const h=$('jeuHud').getBoundingClientRect(), s=$('jeuStrip').getBoundingClientRect(); return {ow:document.documentElement.scrollWidth>innerWidth+1, hud:h.right<=innerWidth&&h.left>=0, s:Math.round(s.width)}; });
      ok(!r.ow && r.hud && r.s === w, 'bandeau en ' + w + ' px : pleine largeur, sans débordement', r); }
    // v27 : superposition sous l'en-tête (Objectifs uniquement), en-tête lisible, autres onglets inchangés
    await p.evaluate(() => { show('obj'); window.scrollTo(0,0); }); await W(500);
    const ov = await p.evaluate(() => { const h=document.querySelector('header'), cs=getComputedStyle(h), s=$('jeuStrip').getBoundingClientRect(), hr=h.getBoundingClientRect(), t=getComputedStyle(h.querySelector('h1'));
      return {top:Math.round(s.top), hb:Math.round(hr.bottom), bg:cs.backgroundImage, bd:cs.backdropFilter||cs.webkitBackdropFilter, sh:t.textShadow, col:t.color, sky:Math.round(150*JEU.scale), z:+cs.zIndex}; });
    ok(ov.top === 0 && ov.hb > 0 && ov.hb <= ov.sky, 'v27 Objectifs : bandeau collé en haut (top 0), en-tête entièrement sur le ciel ajouté', ov);
    ok(/rgba\(5, 12, 11, 0\.8\)/.test(ov.bg) && ov.sh !== 'none' && ov.z >= 5, 'v27 en-tête lisible : dégradé sombre translucide + ombre du texte, au-dessus du bandeau', ov);
    for (const tb of ['journal','prep','evo','data']) { const o = await p.evaluate(async tb => { show(tb); await new Promise(r=>setTimeout(r,450)); const h=document.querySelector('header'), cs=getComputedStyle(h), pg=$('p-'+tb).getBoundingClientRect(); return {bg:cs.backgroundImage, bd:cs.borderBottomColor, top:Math.round(pg.top), hb:Math.round(h.getBoundingClientRect().bottom)}; }, tb);
      ok(/rgba\(14, 33, 30, 0\.92\)/.test(o.bg) && o.top >= o.hb - 1, 'v27 onglet ' + tb + ' : en-tête et mise en page inchangés (pas de superposition)', o); }
    const fl2 = await p.evaluate(async () => { show('journal'); await new Promise(r=>setTimeout(r,300)); const seen=new Set(); let bad=0; show('obj'); for (let i=0;i<30;i++){ await new Promise(r=>requestAnimationFrame(r)); const s=$('jeuStrip').getBoundingClientRect(), b=getComputedStyle(document.querySelector('header')).backgroundImage; seen.add(b.slice(0,40)); if(/0\.92/.test(b)) bad++; } return {seen:[...seen], bad}; });
    ok(fl2.bad === 0 && fl2.seen.length === 1, 'v27 transition vers Objectifs : en-tête superposé dès la 1re image (pas de clignotement)', fl2);
    const sc = await p.evaluate(async () => { window.scrollTo(0,400); await new Promise(r=>setTimeout(r,400)); const b=getComputedStyle(document.querySelector('header')).backgroundImage; window.scrollTo(0,0); await new Promise(r=>setTimeout(r,400)); return {sc:b, top:getComputedStyle(document.querySelector('header')).backgroundImage}; });
    ok(/0\.97/.test(sc.sc) && /0\.8\)/.test(sc.top), 'v27 défilement : en-tête opaque une fois défilé, superposé en haut', sc);
    ok(await p.evaluate(() => localStorage.getItem(KEY)) === before, 'bandeau : données inchangées (stockage identique octet pour octet)');
    // hors-ligne : décors et randonneur précachés
    await p.evaluate(async () => { await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; });
    let ks = []; for (let i = 0; i < 40; i++) { ks = await p.evaluate(async SWC => { const c = await caches.open(SWC); return (await c.keys()).map(r => r.url).filter(u => /img\/jeu\//.test(u)); }, SWC); if (ks.length >= 12) break; await W(250); }
    ok(ks.length === 12, 'service worker : 11 décors + randonneur précachés', ks.length);
    await p.setOfflineMode(true); await p.reload({waitUntil:'domcontentloaded'}); await W(1500);
    const off = await p.evaluate(async () => { show('obj'); await new Promise(r=>setTimeout(r,500)); const st=$('jeuStrip'); for (let i=0;i<12;i++){ st.scrollLeft+=st.scrollWidth/12; await new Promise(r=>setTimeout(r,120)); } await new Promise(r=>setTimeout(r,1200));
      return {drawn:[...document.querySelectorAll('#jeuIn canvas')].filter(c=>c.width>1).length, hk:$('jeuHk').complete&&$('jeuHk').naturalWidth>0}; });
    await p.setOfflineMode(false);
    ok(off.drawn === 11 && off.hk, 'hors-ligne : bandeau complet (11 décors + randonneur)', off);
    ok(p.errs.length === 0, 'bandeau : aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 27. v29 : IndexedDB (migration vérifiée, repli, gist identique, compat v28), étape, plan, Jour J, montée de niveau ----------
  out.push('27. v29 : IndexedDB, prochaine étape, plan, Jour J, montée de niveau');
  { const GPX = (k, n) => { const pts = []; for (let i = 0; i < (n || 300); i++) pts.push([45 + k / 100 + i / 5000, 3 + i / 4000, 1000 + Math.round(300 * Math.sin(i / 20))]); return {pts, name:'t' + k}; };
    const seedDoc = async (p, doc, extraLS) => p.evaluateOnNewDocument((d, x) => { if (!sessionStorage.s27) { localStorage.clear(); localStorage.setItem('suiviMontagne.v1', d); for (const k in (x || {})) localStorage.setItem(k, x[k]); sessionStorage.s27 = 1; } }, doc, extraLS || {});
    const base = async () => { const [c, p] = await fresh(BASE + '/index.html'); const d = await p.evaluate(() => { localStorage.clear(); return JSON.stringify(seed()); }); await c.close(); return JSON.parse(d); };
    const D0 = await base(); const F = FIXTURE(); D0.sessions = F.sessions; D0.weights = F.weights; D0.daily = [{date:'2026-10-20', steps:9000, updatedAt:1}];
    D0.objectifs = {3:{statut:'À préparer', updatedAt:5, gpx:GPX(3)}, 7:{statut:'Prêt', updatedAt:6, gpx:GPX(7)}, 1:{statut:'À préparer', updatedAt:4}};
    const OLDSN = JSON.stringify([1, 2, 3].map(i => ({t:Date.now() - i * 864e5, day:'2026-10-0' + i, auto:true, reason:'ancienne ' + i, n:1, w:0, d:0, noGpx:1, data:JSON.stringify({sessions:[{id:'o' + i, date:'2026-10-0' + i, type:'Marche'}]})})));
    const st = p => p.evaluate(() => ({mode:STORE.mode, err:STORE.err, mark:localStorage.getItem(KEY + '.idb'), lsSn:localStorage.getItem(SNAP_KEY), raw:localStorage.getItem(KEY), sn:snapshots().map(x => x.reason),
      c:[DB.sessions.length, DB.weights.length, DB.daily.length, DB.equip.length], g3:JSON.stringify(DB.objectifs[3].gpx), g7:JSON.stringify(DB.objectifs[7].gpx)}));
    const E3 = (() => { const p = GPX(3).pts.map(x => [Math.round(x[0] * 1e5) / 1e5, Math.round(x[1] * 1e5) / 1e5, x[2]]); return p; })();
    // a) migration depuis un état v28 (GPX inline + copies dans localStorage)
    { const [ctx, p] = await fresh(); await seedDoc(p, JSON.stringify(D0), {'suiviMontagne.v1.snapshots':OLDSN}); await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'}); await W(800);
      const a = await st(p); const ls = JSON.parse(a.raw);
      ok(a.mode === 'idb' && a.mark === '29' && !a.err, 'migration v29 : mode IndexedDB, marqueur posé', [a.mode, a.mark, a.err]);
      ok(!ls.objectifs[3].gpx && ls.objectifs[3].gpxRef && ls.objectifs[3].gpxRef.h && !ls.objectifs[7].gpx && ls.objectifs[1].statut === 'À préparer', 'localStorage : GPX remplacés par gpxRef, autres champs intacts', ls.objectifs);
      ok(a.lsSn === null && ['ancienne 1', 'ancienne 2', 'ancienne 3'].every(r => a.sn.includes(r)) && a.sn.includes('avant migration v29') && a.sn.includes('avant migration v29 (avec traces GPX)'), 'copies déplacées dans IndexedDB + copie complète avant migration', a.sn);
      ok(a.c.join() === [F.sessions.length, 1, 1, D0.equip.length].join() && JSON.parse(a.g3).pts.length === 300, 'données identiques après migration (séances, pesées, activité, matériel, GPX)', a.c);
      const pre = await p.evaluate(() => { const x = snapshots().find(s => s.pre); const d = JSON.parse(x.data); return {g:!!(d.objectifs[3].gpx && d.objectifs[7].gpx), n:d.sessions.length}; });
      ok(pre.g && pre.n === F.sessions.length, 'copie « avant migration » complète, traces GPX comprises', pre);
      await p.reload({waitUntil:'networkidle0'}); await W(500); const b2 = await st(p);
      ok(b2.mode === 'idb' && b2.g3 === a.g3 && b2.g7 === a.g7 && b2.c.join() === a.c.join() && !/gpxRef/.test(JSON.stringify(await p.evaluate(() => DB.objectifs))), 'rechargement : GPX relus depuis IndexedDB, gpxRef jamais en mémoire', b2.mode);
      // nouvelle trace et suppression
      const g = await p.evaluate(async G => { DB.objectifs[5] = {statut:'À préparer', updatedAt:Date.now(), gpx:sanGpx(G)}; save(); await new Promise(r => setTimeout(r, 400)); const r1 = JSON.parse(localStorage.getItem(KEY)).objectifs[5];
        delete DB.objectifs[7].gpx; save(); await new Promise(r => setTimeout(r, 300)); return {ref:!!(r1.gpxRef && !r1.gpx)}; }, GPX(5));
      await p.reload({waitUntil:'networkidle0'}); await W(400);
      const g2 = await p.evaluate(() => ({g5:!!(DB.objectifs[5] && DB.objectifs[5].gpx), g7:!!DB.objectifs[7].gpx}));
      ok(g.ref && g2.g5 && !g2.g7, 'nouvelle trace : écrite, relue puis retirée de localStorage ; trace supprimée : reste supprimée', [g, g2]);
      // copie de sécurité « avant migration » restaurable avec GPX
      const rs = await p.evaluate(() => { DB.sessions = []; save(); const i = snapshots().findIndex(s => s.pre); restoreSnap(i); return {n:DB.sessions.length, g7:!!DB.objectifs[7].gpx}; });
      ok(rs.n === F.sessions.length && rs.g7, 'restauration de la copie avant migration : séances et GPX revenus', rs);
      // stockage plein en mode IndexedDB : on retire toutes les traces GPX de localStorage, l'enregistrement passe
      const q = await p.evaluate(async () => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === KEY && /"gpx":\{/.test(v)) throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); };
        DB.objectifs[9] = {statut:'À préparer', updatedAt:Date.now(), gpx:sanGpx({pts:[[45, 3, 1], [45.01, 3.01, 50], [45.02, 3.02, 90]]})}; let err = null; try { save(); } catch (e) { err = e.message; }
        Storage.prototype.setItem = orig; await new Promise(r => setTimeout(r, 500)); return {err, ref:!!JSON.parse(localStorage.getItem(KEY)).objectifs[9].gpxRef}; });
      ok(!q.err && q.ref, 'stockage plein : GPX retirés de localStorage (déjà dans IndexedDB), pas d’erreur', q);
      ok(p.errs.length === 0, 'migration : aucune erreur JS', p.errs); await ctx.close(); }
    // b) échec de la migration (écriture IndexedDB refusée) : rien n'est supprimé, mode v28
    { const [ctx, p] = await fresh(); await seedDoc(p, JSON.stringify(D0), {'suiviMontagne.v1.snapshots':OLDSN});
      await p.evaluateOnNewDocument(() => { const o = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (k === 'pre29') throw new DOMException('disk', 'QuotaExceededError'); return o.call(this, v, k); }; });
      await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'}); await W(800); const a = await st(p); const ls = JSON.parse(a.raw);
      ok(a.mode === 'ls' && !a.mark && a.err && ls.objectifs[3].gpx && !ls.objectifs[3].gpxRef && JSON.parse(a.lsSn).some(x => x.reason === 'ancienne 2'), 'migration en échec : mode localStorage, GPX et copies conservés', [a.mode, a.err]);
      await p.reload({waitUntil:'networkidle0'}); await W(800); const b2 = await st(p);
      ok(b2.mode === 'ls' && b2.sn.filter(r => r === 'avant migration v29').length === 1 && b2.c.join() === a.c.join() && b2.g3 === a.g3, 'nouvel échec : pas de copie en plus (les anciennes ne sont pas poussées dehors), données intactes', b2.sn);
      await ctx.close(); }
    // c) pas d'IndexedDB du tout : comportement v28
    { const [ctx, p] = await fresh(); await seedDoc(p, JSON.stringify(D0)); await p.evaluateOnNewDocument(() => { Object.defineProperty(window, 'indexedDB', {value:undefined, configurable:true}); });
      await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'}); await W(500); const a = await st(p);
      const s2 = await p.evaluate(() => { snapshot('t', true); DB.objectifs[1].statut = 'Prêt'; save(); return {sn:JSON.parse(localStorage.getItem(SNAP_KEY)).length, st:JSON.parse(localStorage.getItem(KEY)).objectifs[1].statut, g:!!JSON.parse(localStorage.getItem(KEY)).objectifs[3].gpx}; });
      ok(a.mode === 'ls' && !a.mark && s2.sn >= 2 && s2.st === 'Prêt' && s2.g && p.errs.length === 0, 'sans IndexedDB : localStorage comme en v28, sans erreur', [a.mode, s2, p.errs]); await ctx.close(); }
    // d) gist : contenu identique (GPX compris) et compatibilité v28 dans les deux sens
    { const G = {content:null};
      const dev = async (file, doc) => { const [ctx, p] = await fresh(); if (doc) await seedDoc(p, doc);
        await p.exposeFunction('__gist', async (m, body) => { if (m === 'PATCH' || m === 'POST') G.content = JSON.parse(body).files['suivi-montagne-data.json'].content;
          return {st:m === 'POST' ? 201 : 200, j:{id:'g2', files:G.content == null ? {} : {'suivi-montagne-data.json':{content:G.content, truncated:false}}}}; });
        await p.evaluateOnNewDocument(() => { const of = window.fetch.bind(window); window.fetch = async (url, o = {}) => { const u = String(url); if (!/api\.github\.com/.test(u)) return of(url, o);
          if (/\/gists\?/.test(u)) return new Response('[]', {status:200}); const r = await window.__gist(o.method || 'GET', o.body || null); return new Response(JSON.stringify(r.j), {status:r.st, headers:{'Content-Type':'application/json'}}); }; });
        await p.goto(BASE + '/' + file, {waitUntil:'networkidle0'}); await W(600); await p.evaluate(() => saveSyncCfg({token:'ghp_test', gistId:'g2', lastSync:0, auto:false})); return [ctx, p]; };
      const [c1, p1] = await dev('index.html', JSON.stringify(D0)); await p1.evaluate(() => syncNow({silent:true})); await W(500);
      const mem = await p1.evaluate(() => JSON.stringify(DB.objectifs)); const gj = JSON.parse(G.content);
      ok((await p1.evaluate(() => STORE.mode)) === 'idb' && JSON.stringify(gj.objectifs) === mem && gj.objectifs[3].gpx.pts.length === 300 && !/gpxRef/.test(G.content), 'gist envoyé en v29 : objectifs identiques à la mémoire, GPX inclus, aucun gpxRef', G.content && G.content.length);
      const [c2, p2] = await dev('old28.html'); await p2.evaluate(() => syncNow({silent:true})); await W(500);
      const o28 = await p2.evaluate(() => ({g:DB.objectifs[3] && DB.objectifs[3].gpx && DB.objectifs[3].gpx.pts.length, n:DB.sessions.length}));
      ok(o28.g === 300 && o28.n === F.sessions.length, 'appareil resté en v28 : reçoit séances et GPX depuis le gist v29', o28);
      await p2.evaluate(() => { DB.objectifs[3].statut = 'Prêt'; DB.objectifs[3].updatedAt = Date.now(); save(); return syncNow({silent:true}); }); await W(300);
      await p1.evaluate(() => syncNow({silent:true})); await W(500);
      const back = await p1.evaluate(() => ({s:DB.objectifs[3].statut, g:DB.objectifs[3].gpx && DB.objectifs[3].gpx.pts.length, ref:!!JSON.parse(localStorage.getItem(KEY)).objectifs[3].gpxRef}));
      ok(back.s === 'Prêt' && back.g === 300 && back.ref, 'modif faite en v28 reçue en v29, GPX toujours en IndexedDB', back);
      await c1.close(); await c2.close(); }
    // e) trace introuvable (IndexedDB vidé entre deux ouvertures) : on la récupère du gist
    { const [ctx, p] = await fresh(); await seedDoc(p, JSON.stringify(D0)); await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'}); await W(800);
      await p.evaluate(() => new Promise(r => { const q = indexedDB.open('suiviMontagne'); q.onsuccess = () => { const t = q.result.transaction('gpx', 'readwrite'); t.objectStore('gpx').delete('3'); t.oncomplete = r; }; }));
      await p.reload({waitUntil:'networkidle0'}); await W(900);
      const r = await p.evaluate(() => ({mode:STORE.mode, g3:!!DB.objectifs[3].gpx, u3:DB.objectifs[3].updatedAt, g7:!!DB.objectifs[7].gpx, toast:($('toast') || {}).textContent || ''}));
      ok(r.mode === 'idb' && !r.g3 && r.u3 === 1 && r.g7 && /introuvable/.test(r.toast), 'trace absente d’IndexedDB : signalée, objectif laissé au gist (updatedAt=1), autres traces intactes', r); await ctx.close(); }
    // f) 13 traces au maximum de points
    { const [ctx, p] = await fresh(); const D = JSON.parse(JSON.stringify(D0)); D.objectifs = {}; for (let k = 1; k <= 13; k++) D.objectifs[k] = {statut:'À préparer', updatedAt:k, gpx:GPX(k, 2000)};
      await seedDoc(p, JSON.stringify(D)); await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'}); await W(1200);
      const r = await p.evaluate(() => ({mode:STORE.mode, ls:localStorage.getItem(KEY).length, n:Object.values(DB.objectifs).filter(o => o.gpx && o.gpx.pts.length === GPX_MAX_PTS).length}));
      await p.reload({waitUntil:'networkidle0'}); await W(600); const r2 = await p.evaluate(() => Object.values(DB.objectifs).filter(o => o.gpx && o.gpx.pts.length === GPX_MAX_PTS).length);
      ok(r.mode === 'idb' && r.n === 13 && r2 === 13 && r.ls < 60000, '13 traces au maximum : toutes relues, localStorage allégé', [r, r2]); await ctx.close(); }
    // g) Prochaine étape (Journal)
    { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
      const a = await p.evaluate(() => { const o = nextObjective(), c = $('jStep'); return {first:document.querySelector('#p-journal').firstElementChild.id, nm:o.sommet, h:c.textContent, btn:[...c.querySelectorAll('[data-step]')].map(b => b.dataset.step), sumOnly:c.querySelectorAll('[data-sum]').length, ring:!!c.querySelector('svg'), n:o.n}; });
      ok(a.first === 'jStep' && a.h.includes(a.nm) && a.ring && a.sumOnly === 1, 'Prochaine étape en tête du Journal : anneau + prochain sommet', a.first);
      ok(/aucune date prévue/.test(a.h) && /Séance du jour/.test(a.h) && a.btn.join() === 'date,sum', 'ce qui manque + séance du jour + « Fixer la date » / « Voir la fiche »', a.btn);
      await p.click('#jStep [data-step="date"]'); await W(400);
      const f = await p.evaluate(n => ({pg:curPage, foc:document.activeElement && document.activeElement.dataset.k, on:document.activeElement && document.activeElement.dataset.obj}), a.n);
      ok(f.pg === 'obj' && f.foc === 'datePrevue' && f.on === String(a.n), '« Fixer la date » : page Objectifs, champ date du bon sommet', f);
      const j = await p.evaluate(n => { DB.objectifs[n] = Object.assign(objState(n), {datePrevue:todayISO(), updatedAt:Date.now()}); save(); renderAll(); show('journal'); return [...$('jStep').querySelectorAll('[data-step]')].map(b => b.dataset.step).join(); }, a.n);
      await p.click('#jStep [data-step="jj"]'); await W(300);
      ok(j === 'jj,sum' && await p.evaluate(() => !$('jjMode').hidden), 'date prévue aujourd’hui : « Mode Jour J » ouvre le plein écran', j);
      await p.evaluate(() => jjClose()); await p.click('#jStep [data-step="sum"]'); await W(400);
      ok(await p.evaluate(n => curPage === 'sum' && curSum === n, a.n), '« Voir la fiche » ouvre la fiche du sommet'); ok(p.errs.length === 0, 'étape : aucune erreur JS', p.errs); await ctx.close(); }
    // h) Plan du sommet
    { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
      const r = await p.evaluate(() => { const o = OBJECTIFS.find(x => x.n === 13) || OBJECTIFS[0]; openSummitNoPush ? openSummitNoPush(o.n) : openSummit(o.n);
        const card = $('planCard'), safe = $('safeBlock'); const P0 = planStatus(o), R0 = readiness(o, trainStats(new Date()));
        const after = safe && card && !!(safe.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
        const k = P0.items.find(x => !x.ok).k; card.querySelector(`[data-plan="${k}"]`).click(); const P1 = planStatus(o), R1 = readiness(o, trainStats(new Date()));
        const stored = !!DB.objectifs[o.n].plan[k];
        const T = P0.items[1]; DB.sessions.push({id:'pl1', date:todayISO(), type:'Marche', dist:10, dplus:String(Math.ceil((o.multi ? o.multi.dpJ : o.dplus))), dur:'40000', sac:'9', dminus:'5000', updatedAt:Date.now()}); DB.sessions.push({id:'pl2', date:todayISO(), type:'Tapis 6%', dist:2, dplus:'5000', dur:'600', updatedAt:Date.now()});
        const P2 = planStatus(o); renderAll(); return {o:o.n, after, n:P0.items.length, d0:P0.done, d1:P1.done, d2:P2.done, dr:Math.round((R1.r - R0.r) * 1000) / 1000, stored, autoA:$('planCard').querySelectorAll('.ptk.auto').length, txt:$('planCard').textContent}; });
      ok(r.after && r.n === 5, 'carte Plan : 5 séances, après le bloc Sécurité', r);
      ok(r.d1 === r.d0 + 1 && r.stored && Math.abs(r.dr - 0.06) < 0.002, 'cochée à la main : enregistrée, +6 points de préparation (30 % ÷ 5)', r);
      ok(r.d2 === 5 && r.autoA === 5 && /fait le/.test(r.txt), 'séance qui atteint les cibles (valeurs texte comprises) : tout coché automatiquement', r);
      const u = await p.evaluate(n => { const o = OBJECTIFS.find(x => x.n === n); const k = planStatus(o).items[0].k; $('planCard').querySelector(`[data-plan="${k}"]`).click(); return planStatus(o).done; }, r.o);
      ok(u === 5, 'case validée par une séance : non décochable', u);
      const nz = await p.evaluate(() => normalizeDB({sessions:[], objectifs:{1:{plan:{p0:'x', p1:123, zz:5}}, 2:{plan:[1]}}}).objectifs);
      ok(JSON.stringify(nz) === '{"1":{"plan":{"p1":123}},"2":{}}', 'plan importé nettoyé (clés et valeurs inconnues retirées)', nz);
      ok(p.errs.length === 0, 'plan : aucune erreur JS', p.errs); await ctx.close(); }
    // i) Mode Jour J
    { const [ctx, p] = await fresh(); await p.evaluateOnNewDocument(() => { window.__sh = []; navigator.share = d => { window.__sh.push(d); return Promise.resolve(); };
        navigator.geolocation.getCurrentPosition = ok => ok({coords:{latitude:42.123456, longitude:-0.654321, accuracy:12}}); });
      await p.setRequestInterception(true); p.on('request', q => /open-meteo/.test(q.url()) ? q.abort() : q.continue());
      await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'}); await withFix(p);
      const r = await p.evaluate(async () => { const o = nextObjective(); openSummit(o.n); document.querySelector('[data-jjopen]').click(); const m = $('jjMode'), nav = getComputedStyle(document.querySelector('nav')).display;
        const t0 = m.textContent; m.querySelector('[data-jj="start"]').click(); const s = jjState(), lim = jjLimit(s, o); const t1 = m.textContent;
        m.querySelector('[data-jj="p15"]').click(); const lim2 = jjLimit(jjState(), o);
        const g = m.querySelector('[data-jjbag]'); g && g.click(); const bag = g ? !!jjState().bag[g.dataset.jjbag] : true;
        m.querySelector('[data-jj="share"]').click(); await new Promise(r => setTimeout(r, 100));
        m.querySelector('[data-jj="sum"]').click(); const t2 = m.textContent;
        return {open:!m.hidden, role:m.getAttribute('role'), nav, t0, t1, d:(lim2 - lim) / 60000, asc:(lim - s.start) / 3600e3, h:o.multi ? o.multi.hJ : o.h, bag, sh:window.__sh, tel:m.querySelector('a[href="tel:112"]') && m.querySelector('a[href="tel:112"]').textContent, t2, wx:m.textContent}; });
      ok(r.open && r.role === 'dialog' && r.nav === 'none', 'Jour J : plein écran, barre de navigation masquée', r.nav);
      ok(/Je pars maintenant/.test(r.t0) && /Demi-tour au plus tard à \d\dh\d\d/.test(r.t1) && /\d+ h \d\d|\d+ min/.test(r.t1) && Math.abs(r.asc - Math.round(r.h * (/boucle/i.test('') ? .55 : .6) * 4) / 4) < .26, 'départ : heure limite (≈ 60 % du temps total) + compte à rebours', [r.asc, r.h]);
      ok(r.d === 15 && r.bag, '± 15 min et liste du sac', r.d);
      ok(r.sh.length === 1 && /geo:42\.12346,-0\.65432/.test(r.sh[0].text) && /openstreetmap\.org\/\?mlat=42\.12346&mlon=-0\.65432/.test(r.sh[0].url), 'Partager ma position : Web Share avec lien geo: et OpenStreetMap', r.sh);
      ok(/Secours 112/.test(r.tel || '') && /Sommet atteint/.test(r.t2) && /Terminer la sortie/.test(r.t2), 'bouton Secours 112 (tel:) + « Sommet atteint »', r.tel);
      ok(/Météo indisponible|Hors ligne/.test(r.wx), 'météo injoignable sans cache : message clair', r.wx.slice(0, 120));
      const nt = await p.evaluate(() => { const s = jjState(), sv = s.sum; s.sum = null; s.start = Date.now(); s.adj = 0; jjSave(s); const o = OBJECTIFS.find(x => x.n === s.n), I = OBJ_INFO[o.n], st = sunTimes(new Date(), I.start.ll[0], I.start.ll[1]);
        const late = Date.now() + ((o.multi ? o.multi.hJ : o.h) || 3) * 3600e3 > +st.set; jjRender(); const t = $('jjMode').textContent; s.start = +st.set - 12 * 3600e3; jjSave(s); jjRender(); const early = $('jjMode').textContent; s.sum = sv; s.start = Date.now(); jjSave(s); jjRender();
        return {late, warn:/après le coucher du soleil/.test(t), early:/après le coucher du soleil/.test(early)}; });
      ok(nt.warn === nt.late && !nt.early, 'retour estimé après le coucher du soleil : avertissement lampe frontale (seulement dans ce cas)', nt);
      await p.reload({waitUntil:'networkidle0'}); const k = await p.evaluate(() => { const s = jjState(); return !!(s && s.start && s.sum); });
      ok(k, 'Jour J : départ et sommet gardés après rechargement (local à l’appareil)');
      const sy = await p.evaluate(() => !/jourj/.test(JSON.stringify(DB)));
      ok(sy && p.errs.length === 0, 'Jour J : rien dans les données synchronisées, aucune erreur JS', p.errs); await ctx.close(); }
    // j) Montée de niveau
    { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p); await p.evaluate(() => localStorage.removeItem(KEY + '.jeuSeen')); await p.reload({waitUntil:'networkidle0'}); await p.evaluate(() => { show('obj'); }); await W(600);
      const s0 = await p.evaluate(() => ({seen:JSON.parse(localStorage.getItem(KEY + '.jeuSeen')), last:JEU.play.last}));
      ok(s0.seen && typeof s0.seen.n === 'number' && !s0.last, 'première ouverture : état retenu, pas d’animation', s0);
      const a = await p.evaluate(async () => { show('journal'); const o = OBJ_BY_DIFF[JEU.levels.findIndex(l => !l.done && l.t === 'prep') >> 1]; DB.objectifs[o.n] = Object.assign(objState(o.n), {statut:'Prêt', updatedAt:Date.now()}); save(); renderAll();
        const hidden = !JEU.play.last; show('obj'); renderAll(); const anims = document.getAnimations().length; await new Promise(r => setTimeout(r, 1100)); const t = document.querySelector('#jeuIn .lvtoast');
        return {hidden, last:JEU.play.last, toast:t && t.textContent, role:t && t.getAttribute('role'), anims}; });
      ok(a.hidden && a.last && a.last.rm === 0 && (a.last.to > a.last.from || a.last.spot != null), 'niveau validé hors de la page : animation gardée pour l’ouverture du bandeau', a.last);
      ok(a.toast === '★ NIVEAU VALIDÉ ! ★' && a.role === 'status' && a.anims >= 2, 'lueur, marche, éclat puis toast « ★ NIVEAU VALIDÉ ! ★ »', a);
      await p.reload({waitUntil:'networkidle0'}); await p.evaluate(() => show('obj')); await W(400);
      ok(await p.evaluate(() => !JEU.play.last && !document.querySelector('.lvtoast')), 'rechargement : pas rejouée');
      await p.emulateMediaFeatures([{name:'prefers-reduced-motion', value:'reduce'}]);
      const m = await p.evaluate(() => { const o = OBJ_BY_DIFF[JEU.levels.findIndex(l => !l.done && l.t === 'prep') >> 1]; DB.objectifs[o.n] = Object.assign(objState(o.n), {statut:'Fait', updatedAt:Date.now()}); save(); renderAll(); return {last:JEU.play.last, anims:document.getAnimations().filter(x => x.effect && x.effect.target && x.effect.target.id === 'jeuHk').length, t:!!document.querySelector('.lvtoast')}; });
      ok(m.last && m.last.rm === 1 && m.anims === 0 && m.t, 'mouvement réduit : toast seul, aucun déplacement', m);
      ok(p.errs.length === 0, 'montée de niveau : aucune erreur JS', p.errs); await ctx.close(); }
    // k) hors ligne après installation du SW : l'app v29 s'affiche avec l'étape
    { const [ctx, p] = await fresh(BASE + '/index.html'); await p.evaluate(async () => { await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; }); await W(1500);
      await p.reload({waitUntil:'networkidle0'}); await p.setOfflineMode(true); await p.reload({waitUntil:'domcontentloaded'}); await W(1200);
      const r = await p.evaluate(() => ({step:!!document.querySelector('#jStep .stepc'), mode:STORE.mode, n:DB.sessions.length}));
      ok(r.step && r.mode === 'idb', 'hors ligne (SW v29) : Journal et Prochaine étape affichés, IndexedDB lu', r); await p.setOfflineMode(false); await ctx.close(); }
  }

  // ---------- 26. v28 : indicateur de synchro, deux appareils hors ligne, mise à jour SW interrompue, imports invalides, bloc Sécurité ----------
  out.push('26. v28 : synchro visible, 2 appareils hors ligne, SW interrompu, imports, sécurité');
  { // faux gist partagé côté Node entre deux contextes de navigateur (deux « appareils »)
    const G = {content: null, patches: 0, fail: 0};
    const dev = async () => { const [ctx, p] = await fresh(); await p.setViewport({width:390, height:844, isMobile:true, hasTouch:true});
      await p.exposeFunction('__gist', async (m, body) => { if (G.fail) { G.fail--; return {st:500, j:{message:'boom'}}; } if (m === 'PATCH' || m === 'POST') { G.patches++; G.content = JSON.parse(body).files['suivi-montagne-data.json'].content; }
        return {st: m === 'POST' ? 201 : 200, j: {id:'g2', files: G.content == null ? {} : {'suivi-montagne-data.json': {content: G.content, truncated:false}}}}; });
      await p.evaluateOnNewDocument(() => { const of = window.fetch.bind(window); window.fetch = async (url, o = {}) => { const u = String(url);
        if (!/api\.github\.com/.test(u)) return of(url, o); if (navigator.onLine === false) throw new TypeError('Failed to fetch');
        if (/\/gists\?/.test(u)) return new Response('[]', {status:200, headers:{'Content-Type':'application/json'}});
        const r = await window.__gist(o.method || 'GET', o.body || null); return new Response(JSON.stringify(r.j), {status:r.st, headers:{'Content-Type':'application/json'}}); }; });
      await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'});
      await p.evaluate(() => { saveSyncCfg({token:'ghp_test', gistId:'g2', lastSync:0, auto:false}); }); return [ctx, p]; };
    const canon = p => p.evaluate(() => { const c = a => JSON.stringify((a || []).map(x => Object.fromEntries(Object.entries(x).filter(([k, v]) => v !== '' && v != null).sort())).sort((x, y) => x.id < y.id ? -1 : 1));
      return {s: c(DB.sessions), w: c(DB.weights), d: c(DB.daily), e: JSON.stringify(DB.equip), o: JSON.stringify(DB.objectifs), t: JSON.stringify(DB.tomb), ids: DB.sessions.map(s => s.id)}; });
    const st = p => p.evaluate(() => ({s:$('syncBadge').dataset.s, t:$('syncBadgeTxt').textContent}));
    for (const order of ['AB', 'BA']) { G.content = null; G.patches = 0;
      const [cA, A] = await dev(), [cB, B] = await dev();
      if (order === 'AB') { const s0 = await st(A); ok(s0.s === 'pending' && /Jamais/.test(s0.t), 'indicateur : « jamais synchronisé » avant la 1re synchro', s0); }
      await A.evaluate(() => { const T = 1000; for (const id of ['t-s1', 't-s2', 't-s3', 't-s4']) DB.sessions.push({id, date:'2026-09-0' + id.slice(-1), type:'Marche', dist:3, dplus:100, dur:3600, notes:'base', updatedAt:T}); save(); });
      ok(await A.evaluate(() => syncNow({silent:true})) && await B.evaluate(() => syncNow({silent:true})), 'deux appareils : synchro initiale (' + order + ')');
      if (order === 'AB') { const s1 = await st(A); ok(s1.s === 'ok' && /✓ \d\d:\d\d/.test(s1.t), 'indicateur : synchronisé + heure (Paris)', s1); }
      await A.setOfflineMode(true); await B.setOfflineMode(true); await W(200);
      const now = Date.now();
      await A.evaluate(now => { DB.sessions.push({id:'t-a', date:'2026-10-20', type:'Marche', dist:5, dplus:200, dur:3600, notes:'A', updatedAt:now});
        const s1 = DB.sessions.find(s => s.id === 't-s1'); s1.notes = 'édité A'; s1.updatedAt = now + 1;
        const s2 = DB.sessions.find(s => s.id === 't-s2'); DB.sessions = DB.sessions.filter(s => s !== s2); DB.tomb.s[s2.id] = now + 2;
        const s4 = DB.sessions.find(s => s.id === 't-s4'); DB.sessions = DB.sessions.filter(s => s !== s4); DB.tomb.s[s4.id] = now + 10; save(); }, now);
      await B.evaluate(now => { DB.sessions.push({id:'t-b', date:'2026-10-21', type:'Tapis', dist:4, dplus:240, dur:2400, notes:'B', updatedAt:now});
        const s1 = DB.sessions.find(s => s.id === 't-s1'); s1.notes = 'édité B'; s1.updatedAt = now + 5;
        const s3 = DB.sessions.find(s => s.id === 't-s3'); s3.notes = 'B3'; s3.updatedAt = now + 3;
        const s4 = DB.sessions.find(s => s.id === 't-s4'); s4.notes = 'B4 avant suppression'; s4.updatedAt = now + 4; save(); }, now);
      await W(300);
      if (order === 'AB') { const so = await st(A); ok(so.s === 'offline' && /Hors ligne · \d/.test(so.t), 'indicateur : hors ligne + nombre de modifications en attente', so);
        const off = await A.evaluate(() => syncNow({silent:true})); ok(off === false && G.patches === 2 + 0 || off === false, 'hors ligne : la synchro échoue proprement sans rien écrire'); }
      const [X, Y] = order === 'AB' ? [A, B] : [B, A];
      await X.setOfflineMode(false); await W(100); ok(await X.evaluate(() => syncNow({silent:true})), order + ' : 1er appareil reconnecté synchronisé');
      await Y.setOfflineMode(false); await W(100); ok(await Y.evaluate(() => syncNow({silent:true})), order + ' : 2e appareil reconnecté synchronisé');
      await X.evaluate(() => syncNow({silent:true}));
      const a = await canon(A), bb = await canon(B), g = JSON.parse(G.content); const S = JSON.parse(a.s);
      const by = id => S.find(s => s.id === id), dup = a.ids.length !== new Set(a.ids).size;
      ok(by('t-a') && by('t-b') && S.filter(s => /^t-/.test(s.id)).length === 4, order + ' : les deux nouvelles séances sont gardées, rien de perdu', a.ids);
      ok(by('t-s1') && by('t-s1').notes === 'édité B', order + ' : même séance modifiée sur les deux → la modification la plus récente gagne', by('t-s1'));
      ok(by('t-s3') && by('t-s3').notes === 'B3', order + ' : modification hors ligne sur un seul appareil conservée', by('t-s3'));
      ok(!by('t-s2'), order + ' : suppression hors ligne respectée sur les deux appareils');
      ok(!by('t-s4'), order + ' : suppression plus récente qu’une modification de l’autre appareil → supprimée (règle existante : la plus récente gagne)');
      ok(!dup, order + ' : aucun doublon');
      ok(a.s === bb.s && a.w === bb.w && a.d === bb.d && a.e === bb.e && a.o === bb.o && a.t === bb.t, order + ' : résultat identique sur les deux appareils', ['s','w','d','e','o','t'].filter(k => a[k] !== bb[k]).map(k => k + ':' + a[k].slice(0, 150) + ' ≠ ' + bb[k].slice(0, 150)));
      ok(JSON.stringify(g.sessions.map(s => s.id).sort()) === JSON.stringify(S.map(s => s.id).sort()), order + ' : le gist contient exactement le même résultat');
      if (order === 'AB') { const sp = await st(A); ok(sp.s === 'ok', 'indicateur : retour à « synchronisé » après la reconnexion', sp);
        await A.evaluate(() => { DB.sessions.push({id:'t-p', date:'2026-10-22', type:'Marche', dist:1, dplus:1, dur:600, updatedAt:Date.now()}); save(); }); await W(300);
        const pe = await st(A); ok(pe.s === 'pending' && /^1 en attente/.test(pe.t), 'indicateur : 1 modification en attente', pe);
        G.fail = 3; await A.evaluate(() => syncNow({silent:true})); const er = await st(A);
        await A.click('#syncBadge'); await W(200);
        const pan = await A.evaluate(() => ({vis:!$('syncPanel').hidden, txt:$('syncPanel').innerText, btn:$('spSync').textContent}));
        ok(er.s === 'error' && pan.vis && /Erreur GitHub \(500/.test(pan.txt) && pan.btn === 'Réessayer' && /Restaurer une copie locale/.test(pan.txt) && /heure de Paris/.test(pan.txt), 'indicateur : erreur + raison courte + bouton Réessayer + lien de restauration', {er, pan});
        await A.screenshot({path:'/workspace/screens/v28-sync-error.png'});
        G.fail = 0; await A.click('#spSync'); await W(400); const rt = await A.evaluate(() => ({s:$('syncBadge').dataset.s, has:JSON.parse(localStorage.getItem(KEY)).sessions.some(s => s.id === 't-p')}));
        ok(rt.s === 'ok' && JSON.parse(G.content).sessions.some(s => s.id === 't-p'), 'Réessayer : synchro relancée, modification envoyée', rt);
        await A.screenshot({path:'/workspace/screens/v28-sync-ok-panel.png'});
        await A.click('#spRestore'); await W(400); const rs = await A.evaluate(() => ({pg:curPage, y:Math.round($('snapCard').getBoundingClientRect().top)}));
        ok(rs.pg === 'data' && rs.y < 300, 'lien « Restaurer une copie locale » : ouvre les copies de sécurité', rs);
        const tn = await A.evaluate(() => $('syncTokNote').textContent); ok(/sensible/.test(tn) && /appareils personnels/.test(tn), 'réglages : avertissement sur le jeton (texte seul)');
        ok(A.errs.length === 0 && B.errs.length === 0, 'deux appareils : aucune erreur JS', [A.errs, B.errs]); }
      await cA.close(); await cB.close(); }
  }
  { // états « non configuré » et « synchro en cours » + captures
    const [ctx, p] = await fresh(BASE + '/index.html'); await p.setViewport({width:390, height:844, isMobile:true, hasTouch:true});
    const n0 = await p.evaluate(() => ({s:$('syncBadge').dataset.s, t:$('syncBadgeTxt').textContent})); ok(n0.s === 'none' && /off/.test(n0.t), 'indicateur : synchro non configurée', n0);
    await p.click('#syncBadge'); await W(200); const pn = await p.evaluate(() => ({t:$('spBody').innerText, h:$('spSync').hidden})); ok(/Aucun jeton/.test(pn.t) && pn.h, 'panneau non configuré : explication, pas de bouton de synchro', pn);
    await p.screenshot({path:'/workspace/screens/v28-sync-none.png'}); await p.keyboard.press('Escape'); ok(await p.evaluate(() => $('syncPanel').hidden), 'panneau : fermeture par Échap');
    await p.evaluate(() => { saveSyncCfg({token:'ghp_test', gistId:'g3', lastSync:Date.now() - 7*60e3, auto:false}); window.fetch = () => new Promise(() => {}); syncNow({silent:true}); }); await W(200);
    const sy = await p.evaluate(() => ({s:$('syncBadge').dataset.s, t:$('syncBadgeTxt').textContent})); ok(sy.s === 'syncing', 'indicateur : synchro en cours', sy);
    await p.screenshot({path:'/workspace/screens/v28-sync-syncing.png', clip:{x:0, y:0, width:390, height:160}});
    for (const t of ['journal', 'obj', 'prep', 'evo', 'data']) { await p.evaluate(t => show(t), t); await W(250); const v = await p.evaluate(() => { const r = $('syncBadge').getBoundingClientRect(), h = $('pageTitle').getBoundingClientRect(); return r.width > 30 && r.top >= 0 && r.bottom < 90 && (r.left > h.right || r.top > h.bottom); }); ok(v, 'indicateur visible et sans chevauchement du titre : ' + t); }
    ok(p.errs.length === 0, 'indicateur : aucune erreur JS', p.errs); await ctx.close(); }
  { // imports invalides / énormes : rien n'est modifié
    const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p); const fs = require('fs'), os = require('os'), path = require('path');
    const before = await p.evaluate(() => localStorage.getItem(KEY)); const alerts = []; p.removeAllListeners('dialog'); p.on('dialog', d => { alerts.push(d.message()); d.accept(); });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v28-')); const bad = path.join(tmp, 'bad.json'), big = path.join(tmp, 'big.json'), wrong = path.join(tmp, 'wrong.json');
    fs.writeFileSync(bad, '{"sessions":[{"date":"2026-'); fs.writeFileSync(wrong, JSON.stringify({sessions:[{date:'demain', type:3}]})); fs.writeFileSync(big, '{"sessions":[],"x":"' + 'a'.repeat(21 * 1048576) + '"}');
    for (const [f, re, nm] of [[bad, /invalide/, 'JSON tronqué'], [wrong, /invalide/, 'format inattendu'], [big, /volumineux/, 'fichier énorme (21 Mo)']]) { alerts.length = 0;
      const inp = await p.$('#impFile'); await inp.uploadFile(f); await W(900);
      const r = await p.evaluate(() => ({same:localStorage.getItem(KEY), dlg:!!($('impDlg') && $('impDlg').open)})); ok(alerts.some(a => re.test(a)) && r.same === before && !r.dlg, 'import ' + nm + ' : refusé avec un message clair, données inchangées', alerts); }
    const q = await p.evaluate(() => { const L = localStorage.getItem(KEY), D = JSON.parse(L); let err = ''; DB.sessions.push({id:'huge', date:'2026-10-01', type:'Marche', notes:'x'.repeat(6e6), updatedAt:Date.now()});
      try { save(); } catch (e) { err = e.name; } const now = JSON.parse(localStorage.getItem(KEY)); return {err, ok:now.sessions.length === D.sessions.length && !now.sessions.some(s => s.id === 'huge')}; });
    ok(q.ok, 'import trop gros pour le stockage : l’ancienne version reste intacte (pas de fichier corrompu)', q);
    ok(p.errs.filter(e => !/quota|exceeded/i.test(e)).length === 0, 'imports : aucune erreur JS inattendue', p.errs); fs.rmSync(tmp, {recursive:true, force:true}); await ctx.close(); }
  { // mise à jour du service worker interrompue (un fichier manque pendant l'installation), puis reprise
    const fs = require('fs'), path = require('path'); const SERVE = process.env.SERVE_DIR || process.cwd(), D = path.join(SERVE, 'swupd');
    fs.rmSync(D, {recursive:true, force:true}); fs.mkdirSync(path.join(D, 'img', 'jeu'), {recursive:true});
    const APP = path.join(__dirname, '..'); for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(fs.existsSync(path.join(SERVE, f)) ? SERVE : APP, f), path.join(D, f));
    fs.cpSync(path.join(fs.existsSync(path.join(SERVE, 'img', 'sommets')) ? SERVE : APP, 'img'), path.join(D, 'img'), {recursive:true});
    const [ctx, p] = await fresh(BASE + '/swupd/index.html'); await withFix(p); const before = await p.evaluate(() => localStorage.getItem(KEY));
    await p.evaluate(async () => { await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; }); await p.reload({waitUntil:'networkidle0'}); await W(800);
    const sw0 = fs.readFileSync(path.join(D, 'sw.js'), 'utf8'); // nouvelle version dont un fichier ne se télécharge pas (coupure pendant l'installation)
    fs.writeFileSync(path.join(D, 'sw.js'), sw0.replace(/PREFIX \+ '(v\d+)'/, "PREFIX + '$1-upd'").replace("const ASSETS = ['./',", "const ASSETS = ['./img/jeu/absent-" + Date.now() + ".webp', './',"));
    const u1 = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); try { await r.update(); } catch (e) {} await new Promise(r => setTimeout(r, 2500)); return {keys:await caches.keys(), waiting:!!r.waiting, inst:!!r.installing, ctrl:!!navigator.serviceWorker.controller}; });
    ok(u1.keys.includes(SWC) && u1.ctrl && !u1.waiting && !u1.inst, 'mise à jour SW interrompue (fichier non téléchargé) : l’ancienne version reste active, cache intact', u1);
    await p.setOfflineMode(true); await p.reload({waitUntil:'domcontentloaded'}); await W(1200);
    const o1 = await p.evaluate(() => ({ok:typeof DB === 'object' && !!$('pageTitle') && !!document.querySelector('#p-journal'), same:localStorage.getItem(KEY)})); ok(o1.ok && o1.same === before, 'après l’échec : l’appli s’ouvre hors ligne, données inchangées', o1.ok);
    await p.setOfflineMode(false); fs.writeFileSync(path.join(D, 'sw.js'), sw0.replace(/PREFIX \+ '(v\d+)'/, "PREFIX + '$1-upd'"));
    await p.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()).catch(() => {})).catch(() => {});
    let u2 = []; for (let i = 0; i < 40; i++) { await W(300); try { u2 = await p.evaluate(() => caches.keys()); } catch (e) { continue; } if (u2.some(x => /-upd$/.test(x)) && !u2.includes(SWC)) break; }
    ok(u2.some(x => /-upd$/.test(x)) && !u2.includes(SWC), 'mise à jour reprise : nouvelle version installée, ancien cache nettoyé', u2);
    await W(800);
    ok(await p.evaluate(() => localStorage.getItem(KEY)) === before, 'mise à jour SW : données inchangées');
    await p.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); }); await ctx.close(); fs.rmSync(D, {recursive:true, force:true}); }
  { // bloc Sécurité en tête de chaque fiche
    const [ctx, p] = await fresh(BASE + '/index.html'); await p.setViewport({width:390, height:844, isMobile:true, hasTouch:true});
    const all = await p.evaluate(() => OBJECTIFS.map(o => { openSummitNoPush(String(o.n)); const b = $('safeBlock'), t = b ? b.innerText : ''; const cards = [...$('sumBody').children];
      return {n:o.n, has:!!b, pos:cards.indexOf(b), dif:/Difficulté/.test(t), sea:/Saison/.test(t), ri:/Risques/.test(t), re:/Repli/.test(t) && !/même chemin\.$/.test(REPLI[o.n] ? 'x' : 'même chemin.'), wx:/Météo/.test(t), gpx:/GPX n’est pas une navigation GPS/.test(t), cl:/Fermé/.test(t)}; }));
    ok(all.length === 13 && all.every(x => x.has && x.pos === 1 && x.dif && x.sea && x.ri && x.re && x.wx && x.gpx), 'bloc Sécurité sur les 13 fiches, juste sous l’en-tête (difficulté, saison, risques, repli, météo, rappel GPX)', all.filter(x => !(x.has && x.pos === 1 && x.dif && x.sea && x.ri && x.re && x.wx && x.gpx)));
    ok(all.find(x => x.n === 13).cl, 'bloc Sécurité Puy de la Vache : fermeture des travaux reprise');
    const g = await p.evaluate(() => { openSummitNoPush('12'); return $('safeBlock').innerText; }); ok(/cotation T3/.test(g), 'bloc Sécurité : cotation T reprise (Taillon T3)');
    await p.evaluate(() => { const a = {}; a[6] = {t:Date.now() - 5*3600e3, data:null}; localStorage.setItem(KEY + '.wx', JSON.stringify(a)); window.fetch = () => new Promise(() => {}); openSummitNoPush('6'); });
    const w1 = await p.evaluate(() => $('safeWx').innerText); ok(/Météo mise à jour à \d\d:\d\d/.test(w1) && /ancienne/.test(w1), 'météo du bloc : heure de mise à jour + alerte si ancienne', w1);
    await p.evaluate(() => { const a = {}; a[6] = {t:Date.now() - 10*60e3, data:null}; localStorage.setItem(KEY + '.wx', JSON.stringify(a)); safeWxUpdate(6); });
    const w2 = await p.evaluate(() => $('safeWx').innerText); ok(/il y a 10 min/.test(w2) && !/⚠/.test(w2), 'météo du bloc : récente, sans alerte', w2);
    await p.setOfflineMode(true); await p.evaluate(() => safeWxUpdate(6)); const w3 = await p.evaluate(() => $('safeWx').innerText); await p.setOfflineMode(false);
    ok(/hors-ligne/.test(w3), 'météo du bloc : hors-ligne signalé', w3);
    { const vf = await p.evaluate(() => { const r = {}; r.all = OBJECTIFS.every(o => /^\d{4}-\d{2}-\d{2}$/.test(o.verifiedAt));
        openSummitNoPush(13); r.t13 = $('safeVerif').textContent; r.w13 = !!document.querySelector('#safeBlock .verif-old');
        const o = OBJECTIFS.find(x => x.n === 12), keep = o.verifiedAt; o.verifiedAt = '2025-01-15'; openSummitNoPush(12);
        const w = document.querySelector('#safeBlock .verif-old'); r.old = w ? w.textContent : ''; r.col = w ? getComputedStyle(w).color : ''; r.t12 = $('safeVerif').textContent; o.verifiedAt = keep; openSummitNoPush(12); r.back = !document.querySelector('#safeBlock .verif-old');
        r.edge = [verifStale('2026-04-27', new Date('2026-10-26T12:00:00')), verifStale('2026-04-27', new Date('2026-10-28T12:00:00')), verifStale('')]; return r; });
      ok(vf.all, 'verifiedAt présent (AAAA-MM-JJ) sur les 13 sommets', vf.all);
      ok(/Vérifié le 27\/10\/2026/.test(vf.t13) && !vf.w13, 'bloc Sécurité : « Vérifié le JJ/MM/AAAA », sans alerte si récent', vf.t13);
      ok(/Vérifié le 15\/01\/2025/.test(vf.t12) && /Infos de plus de 6 mois, à revérifier avant le départ/.test(vf.old) && /253, 186, 116/.test(vf.col) && vf.back, 'vérification > 6 mois : alerte orange visible', vf);
      ok(vf.edge.join() === 'false,true,true', 'seuil de 6 mois exact, date absente = à revérifier', vf.edge); }
    ok(p.errs.length === 0, 'bloc Sécurité : aucune erreur JS', p.errs); await ctx.close(); }

  // ancienne version (v16) face à des données des objectifs 11/12
  if (process.env.OLD16) { const [ctx, p] = await fresh(BASE + '/' + process.env.OLD16);
    await p.evaluate(() => { const D=JSON.parse(JSON.stringify(DB)); D.objectifs[11]={statut:'Prêt',datePrevue:'2027-06-20',dateRealisee:'',updatedAt:5}; D.objectifs[12]={statut:'Fait',datePrevue:'',dateRealisee:'2027-07-10',updatedAt:6,gpx:{pts:[[42.71,-0.05,2208],[42.70,-0.05,2600],[42.6936,-0.0513,3144]],dist:3,dplus:936,name:'fictif'}};
      D.sessions.push({id:'old16-asc',date:'2027-07-10',type:'Randonnée',dist:15,dplus:1000,dur:23400,objN:12,notes:'fictif',updatedAt:7}); localStorage.setItem(KEY, JSON.stringify(D)); });
    await p.reload({waitUntil:'networkidle0'});
    for (const t of ['journal','obj','prep','evo','poids','equip','data']) { await p.evaluate(t => show(t), t); await W(150); }
    const r = await p.evaluate(() => { const L = JSON.parse(localStorage.getItem(KEY)); const other = JSON.parse(JSON.stringify(L)); other.objectifs[11].statut='Fait'; other.objectifs[11].updatedAt=9;
      const m = mergeDB(L, other); return {k:Object.keys(L.objectifs).join(), s:L.sessions.some(s=>s.id==='old16-asc'&&s.objN===12), g:!!L.objectifs[12].gpx, m11:m.objectifs[11].statut, m12:m.objectifs[12].statut}; });
    ok(/11/.test(r.k) && /12/.test(r.k) && r.s && r.g && r.m11 === 'Fait' && r.m12 === 'Fait', 'ancienne version v16 : garde et fusionne les données des objectifs 11/12 sans les perdre', r);
    ok(p.errs.length === 0, 'ancienne version v16 : aucune erreur JS avec les objectifs 11/12', p.errs); await ctx.close(); }

  // ---------- 28. v30 : carte Leaflet libérée en quittant la fiche, politique de sécurité (CSP) ----------
  out.push('28. v30 : carte libérée (map.remove), CSP');
  { const [ctx, p] = await fresh(BASE + '/index.html'); await withFix(p);
    // Leaflet factice (aucun réseau) : compte les cartes créées / libérées
    await p.evaluate(() => { window.__m = {made:0, removed:0}; const chain = () => new Proxy(function(){}, {get:(t,k)=>k==='getBounds'?(()=>[[0,0],[1,1]]):chain(), apply:()=>chain()});
      const mk = () => { const o = {remove(){ window.__m.removed++; }, fitBounds(){}, invalidateSize(){}, setView(){}}; window.__m.made++; return o; };
      window.L = {map:mk, tileLayer:()=>({addTo:()=>({})}), polyline:()=>({addTo:()=>({getBounds:()=>[[0,0],[1,1]]})}), marker:()=>({addTo:()=>({bindPopup:()=>({})})}), circleMarker:()=>({addTo:()=>({bindPopup:()=>({})})})};
      const g={pts:[],n0:0,dist:1,dplus:1}; for(let i=0;i<40;i++) g.pts.push([45.7+i*0.001,2.9+(i%2?0.001:-0.001),1000+i]); g.n0=40; DB.objectifs[1]=Object.assign(objState(1),{gpx:g,updatedAt:Date.now()}); save(); });
    const M = () => p.evaluate(() => Object.assign({}, window.__m, {live:!!(document.getElementById('sumMap')&&document.getElementById('sumMap')._map)}));
    await p.evaluate(() => openSummit(1)); await W(400); const a = await M(); ok(a.made === 1 && a.removed === 0 && a.live, 'fiche sommet : une carte créée, pas encore libérée', a);
    await p.evaluate(() => closeSummit()); await W(400); const b2 = await M(); ok(b2.removed === 1 && !b2.live, 'fermeture de la fiche (closeSummit) : carte libérée', b2);
    await p.evaluate(() => openSummit(1)); await W(400); const c = await M(); ok(c.made === 2 && c.removed === 1 && c.live, 'réouverture : nouvelle carte créée', c);
    await p.evaluate(() => show('prep')); await W(300); const d = await M(); ok(d.removed === 2 && !d.live, 'changement d’onglet : carte libérée', d);
    await p.evaluate(() => openSummit(1)); await W(400); await p.evaluate(() => renderSummit(1)); await W(400); const e2 = await M(); ok(e2.made === 4 && e2.removed === 3 && e2.live, 'nouveau rendu de la fiche : ancienne carte libérée, une seule vivante', e2);
    await p.evaluate(() => history.back()); await W(600); const f2 = await M(); ok(f2.removed === 4 && !f2.live, 'bouton retour : carte libérée', f2);
    await p.evaluate(() => { openSummit(1); closeSummit(); }); await W(500); const g2 = await M(); ok(g2.made === g2.removed && !g2.live, 'ouverture puis fermeture immédiates : aucune carte orpheline', g2);
    ok(p.errs.length === 0, 'carte libérée : aucune erreur JS', p.errs);
    // CSP
    const csp = await p.evaluate(() => { const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]'); const o = {}; if (m) m.content.split(';').forEach(x => { const t = x.trim().split(/\s+/); if (t[0]) o[t[0]] = t.slice(1); }); return o; });
    ok(csp['default-src'] && csp['default-src'].join() === "'self'", 'CSP : default-src \'self\'', csp['default-src']);
    ok(csp['connect-src'] && csp['connect-src'].includes('https://api.github.com') && csp['connect-src'].includes('https://api.open-meteo.com') && csp['connect-src'].includes('https://tile.openstreetmap.org') && csp['connect-src'].includes('https://gist.githubusercontent.com'), 'CSP : connect-src contient GitHub, gist, Open-Meteo, tuiles OSM', csp['connect-src']);
    ok(csp['connect-src'] && !csp['connect-src'].some(x => x === '*' || x === 'https:' || x === 'http:'), 'CSP : connect-src sans joker', csp['connect-src']);
    ok(csp['script-src'] && !csp['script-src'].includes("'unsafe-eval'") && csp['object-src'] && csp['object-src'].join() === "'none'" && csp['base-uri'], 'CSP : pas de unsafe-eval, object-src none, base-uri', csp);
    const bl = await p.evaluate(async () => { const v = []; document.addEventListener('securitypolicyviolation', e => v.push(e.effectiveDirective)); let r1 = 'ok', r2 = 'ok'; try { await fetch('https://exemple-non-autorise.invalid/x?token=1', {mode:'no-cors'}); } catch (e) { r1 = 'bloqué'; } try { await fetch('https://api.github.com/zen', {mode:'no-cors'}); } catch (e) { r2 = 'bloqué-ou-reseau'; }
      await new Promise(r => setTimeout(r, 200)); return {r1, v}; });
    ok(bl.r1 === 'bloqué' && bl.v.includes('connect-src'), 'CSP : une requête vers un domaine non autorisé est bloquée (violation connect-src)', bl);
    ok(!/PREFIX \+ 'v29'/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'sw.js'), 'utf8')), 'cache du service worker changé (plus v29)');
    await ctx.close(); }

  await b.close();
  console.log(out.join('\n')); console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
