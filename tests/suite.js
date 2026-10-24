/* Suite de tests de « Suivi montagne » (Chrome sans interface, puppeteer-core).
   Usage : BASE=http://localhost:8767 SAMPLES=1 CHROME=/usr/bin/google-chrome node tests/suite.js
   Le dossier servi (SERVE_DIR, par défaut le dossier courant) doit contenir index.html (nouvelle version) ;
   old.html (v4, commit d5589b1) et old16.html (v16, commit 2f57c2c) y sont recréés automatiquement depuis git s'ils manquent (v22),
   sw.js, et — pour les tests OCR — les captures Mi Fitness marche.jpg, rando.jpg, corde.jpg, poids.png
   + truth.json (valeurs attendues). Captures et valeurs personnelles : jamais commitées. */
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:8767';
const W = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const out = [];
function ok(c, name, extra) { if (c) { pass++; out.push('  ✔ ' + name); } else { fail++; out.push('  ✘ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : '')); } }
// Valeurs attendues de l'OCR : fichier local non commité (${SAMPLE_DIR}/truth.json), comme les captures.
const SDIR = process.env.SAMPLE_DIR || require('path').resolve('.');
// v22 : versions anciennes recréées depuis l'historique git (plus de fichier old.html non commité requis)
{ const fs = require('fs'), path = require('path'), cp = require('child_process'); const SERVE = process.env.SERVE_DIR || process.cwd(), REPO = path.resolve(__dirname, '..');
  for (const [f, c] of [['old.html', 'd5589b1'], ['old16.html', '2f57c2c']]) { const fp = path.join(SERVE, f); if (fs.existsSync(fp)) continue;
    try { fs.writeFileSync(fp, cp.execSync('git show ' + c + ':index.html', {cwd: REPO, maxBuffer: 64e6})); console.log('(' + f + ' recréé depuis git ' + c + ')'); }
    catch (e) { console.error('Impossible de recréer ' + f + ' depuis git (' + c + ') : ' + e.message); process.exit(2); } }
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
    ok(r.obj.join() === '1,2,3,4,5,6,7,8,9,10,11,12', 'objectifs 1→12 (GR 441 en n° 10, Cabaliros 11, Taillon 12 : numéros inchangés)', r.obj); ok(r.snaps === 1, 'copie de sécurité du jour créée', r.snaps);
    for (const t of ['journal','obj','prep','evo','poids','equip','data']) await p.evaluate(t => show(t), t);
    ok(p.errs.length === 0, 'aucune erreur JS sur les 7 onglets', p.errs); await ctx.close(); }

  // ---------- 2. Migration v3 → v4 depuis l'ancienne version ----------
  out.push('2. Migration depuis la version précédente (v3), sans perte');
  { const [ctx, p] = await fresh(BASE + '/old.html'); let DEL;
    const before = await p.evaluate(() => { // modifications « utilisateur » dans l'ancienne appli
      DB.sessions.push({id:'u1',date:'2026-10-12',type:'Tapis 6%',dist:5,dplus:300,dminus:null,dur:3600,bpm:120,bpmMax:null,pas:null,sac:4,sauts:null,ress:7,exos:'',notes:'à moi',updatedAt:1760000000000});
      DB.equip[0].items[0].bought = true; DB.equip[0].items[0].price = 149; DB.equip[0].items[0].updatedAt = 1760000000001;
      DB.objectifs[1] = {statut:'Prêt', datePrevue:'2026-10-25', dateRealisee:'', updatedAt:1760000000002};
      const del = DB.sessions[1].id; DB.tomb.s[del] = 1760000000003; DB.sessions = DB.sessions.filter(s => s.id !== del);
      save(); return JSON.stringify({j:localStorage.getItem(KEY), del}); }).then(x => (DEL = JSON.parse(x).del, JSON.parse(x).j));
    await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'});
    const r = await p.evaluate(() => ({bk: localStorage.getItem(KEY + '.backup.v3'), db: DB}));
    const B = JSON.parse(before), D = r.db;
    ok(r.bk === before, 'copie intégrale avant migration (…backup.v3) identique aux données d’avant');
    ok(B.sessions.every(s => JSON.stringify(D.sessions.find(x => x.id === s.id)) === JSON.stringify(s)), 'toutes les séances conservées à l’identique', B.sessions.length + ' vs ' + D.sessions.length);
    ok(D.sessions.length === B.sessions.length, 'aucune séance ajoutée/retirée', [B.sessions.length, D.sessions.length]);
    ok(D.equip[0].items[0].bought === true && D.equip[0].items[0].price === 149, 'achat + prix conservés');
    ok(D.objectifs[1].statut === 'Prêt' && D.objectifs[1].datePrevue === '2026-10-25', 'état d’objectif conservé');
    ok(B.sessions.length > 5 && B.sessions.some(s => /^seed-/.test(s.id)), 'l’ancienne version avait ses séances locales', B.sessions.length);
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
    let keys = []; for (let i = 0; i < 40; i++) { keys = await p.evaluate(() => caches.keys()); if (keys.includes('suivi-montagne-v22') && !keys.includes('suivi-montagne-v4')) break; await W(250); }
    ok(keys.includes('ma-bibliotheque-v3') && keys.includes('autre-appli'), 'caches des autres applis conservés', keys);
    ok(!keys.includes('suivi-montagne-v4') && !keys.includes('suivi-montagne-v2') && keys.includes('suivi-montagne-v22'), 'anciens caches de l’appli supprimés, v22 créé', keys);
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
    ok(r.mono && r.order[0] === 1 && r.order[r.order.length-1] === 8 && r.order.indexOf(11) < r.order.indexOf(12) && r.order.indexOf(6) < r.order.indexOf(12), 'classement par difficulté croissant et cohérent', r.order);
    ok(r.allTech && r.num === '1,2,3,4,5,6,7,8,9,10,11,12', 'technicité renseignée partout, numéros non modifiés');
    await p.evaluate(() => show('obj')); await W(300);
    const L = await p.evaluate(() => ({first:[...document.querySelectorAll('#objList > .card')].map(c=>c.querySelector('[data-sum]').dataset.sum), badge:document.querySelector('#objList .dlv').textContent, exp:!!document.querySelector('.diffexp'), tag:document.querySelector('#objList .dtag').textContent}));
    ok(L.first.join() === r.order.join() && L.badge === '1' && L.exp && /Niveau 1\/12/.test(L.tag), 'Objectifs triés par difficulté par défaut, badge de niveau et explication', L);
    // v18 : numéro affiché = rang de difficulté ; plus de bouton de tri ; clés internes inchangées
    const V = await p.evaluate(() => { localStorage.setItem('sm-objsort','num'); renderObj(); const cards=[...document.querySelectorAll('#objList > .card')];
      const h=cards.map(c=>c.querySelector('.dlv').textContent+':'+c.querySelector('[data-sum]').dataset.sum);
      renderSummit(8); const eb=document.querySelector('#sumBody .eyebrow2').textContent; renderPrep(); const ph=document.querySelector('#prepList h3').textContent;
      const opt=[...new DOMParser().parseFromString('<select>'+objOpts(12)+'</select>','text/html').querySelectorAll('option')].map(o=>o.value+'='+o.textContent);
      return {h, eb, ph, opt, seg:!!document.querySelector('[data-osort]')}; });
    ok(V.h[0] === '1:1' && V.h[4] === '5:11' && V.h[7] === '8:12' && V.h[11] === '12:8' && !V.seg, 'numéros affichés = rang de difficulté (Muletiers 1 … Barrhorn 12), tri unique', V.h);
    ok(/Objectif 12 sur 12/.test(V.eb) && /^1\. Puy de Dôme/.test(V.ph), 'fiche sommet et Prépa : numéro de difficulté', [V.eb, V.ph]);
    ok(V.opt[1] === '1=1. Puy de Dôme' && V.opt.includes('12=8. Pic du Taillon') && V.opt.includes('8=12. Barrhorn (Üssers Barrhorn)'), 'sélecteur d’ascension : numéro affiché = difficulté, valeur stockée = clé interne', V.opt);
    // statut par numéro : modifier le n° 12 depuis la liste triée ne touche que le Taillon
    await p.select('select[data-obj="12"][data-k="statut"]', 'Prêt'); await W(300);
    ok(await p.evaluate(() => objState(12).statut === 'Prêt' && objState(8).statut === 'À préparer' && objState(4).statut === 'À préparer'), 'statut modifié dans la liste triée : enregistré sur le bon numéro');
    const nx = await p.evaluate(() => { DB.objectifs[1]={statut:'Fait',dateRealisee:'2026-10-01',datePrevue:'',updatedAt:1}; DB.objectifs[2]={statut:'Fait',dateRealisee:'2026-10-02',datePrevue:'',updatedAt:1};
      const a=nextObjective().n; DB.objectifs[4]={statut:'Fait',dateRealisee:'2026-10-03',datePrevue:'',updatedAt:1}; const b=nextObjective().n;
      const f=new Date(); f.setDate(f.getDate()+10); DB.objectifs[12]={statut:'Prêt',datePrevue:toISO(f),dateRealisee:'',updatedAt:1}; const c=nextObjective().n; return [a,b,c]; });
    ok(nx.join() === '4,3,12', 'Prochaine ascension : la plus facile non faite, sauf date prévue', nx);
    for (const n of [11, 12]) { const t = await p.evaluate(n => { renderSummit(n); return $('sumBody').innerText; }, n);
      ok(/Variantes/.test(t) && /Technique, carte et secours/.test(t) && /Bons plans/.test(t) && /niveau \d+\/12/i.test(t) && /112/.test(t), 'fiche ' + n + ' : variantes, technique, secours, bons plans, niveau'); }
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
    ok(r.n === 12 && r.ok === 12 && r.st.every(x=>x===200) && r.cover, '12 cartes Objectifs avec photo chargée (locale, HTTP 200)', r);
    ok(r.cred && !r.ow, 'crédit auteur/licence sur chaque photo, sans débordement', r);
    const h = await p.evaluate(async () => { const res=[]; for (const o of OBJECTIFS) { renderSummit(o.n); const i=document.querySelector('#sumBody .sumhero img'); i.loading='eager'; await new Promise(r=>{ if(i.complete) r(); else { i.onload=i.onerror=r; setTimeout(r,5000); } }); res.push(i.naturalWidth>0); } return res; });
    ok(h.every(Boolean), 'photo en tête des 12 fiches sommet', h);
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
      const s = snapshots(); return {n: s.length, first: s[0].reason, saved: JSON.parse(localStorage.getItem(KEY)).prefs.zz, msg, err}; });
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

  await b.close();
  console.log(out.join('\n')); console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
