/* Suite de tests de « Suivi montagne » (Chrome sans interface, puppeteer-core).
   Usage : BASE=http://localhost:8767 SAMPLES=1 CHROME=/usr/bin/google-chrome node tests/suite.js
   Le dossier servi doit contenir index.html (nouvelle version), old.html (version v4 précédente, commit d5589b1),
   sw.js, et — pour les tests OCR — les captures Mi Fitness marche.jpg, rando.jpg, corde.jpg, poids.png
   + truth.json (valeurs attendues). Captures et valeurs personnelles : jamais commitées. */
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:8767';
const W = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const out = [];
function ok(c, name, extra) { if (c) { pass++; out.push('  ✔ ' + name); } else { fail++; out.push('  ✘ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : '')); } }
// Valeurs attendues de l'OCR : fichier local non commité (${SAMPLE_DIR}/truth.json), comme les captures.
const SDIR = process.env.SAMPLE_DIR || require('path').resolve('.');
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
    ok(r.obj.join() === '1,2,3,4,5,6,7,8,9,10', 'objectifs 1→10 (GR 441 en n° 10)', r.obj); ok(r.snaps === 1, 'copie de sécurité du jour créée', r.snaps);
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
    let keys = []; for (let i = 0; i < 40; i++) { keys = await p.evaluate(() => caches.keys()); if (keys.includes('suivi-montagne-v7') && !keys.includes('suivi-montagne-v4')) break; await W(250); }
    ok(keys.includes('ma-bibliotheque-v3') && keys.includes('autre-appli'), 'caches des autres applis conservés', keys);
    ok(!keys.includes('suivi-montagne-v4') && !keys.includes('suivi-montagne-v2') && keys.includes('suivi-montagne-v7'), 'anciens caches de l’appli supprimés, v7 créé', keys);
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
    ok(r.all, 'conseils cohérents pour les 10 objectifs'); ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 7. Fiches sommet ----------
  out.push('7. Fiches sommet');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    await p.evaluate(() => show('obj')); await p.click('#objList [data-sum="10"]'); await W(300);
    const r = await p.evaluate(() => ({cur:curPage, t:$('pageTitle').textContent, txt:$('sumBody').innerText, st:history.state}));
    ok(r.cur === 'sum' && /GR 441/.test(r.txt) && r.st && r.st.sum === 10, 'clic sur un objectif → fiche (historique)', [r.cur, r.st]);
    for (const k of ['Carte','Départ, parking et accès','Itinéraire','Eau et refuges','Meilleure saison','Dangers','Ta préparation','Matériel conseillé','Sources']) ok(r.txt.includes(k), 'section « ' + k + ' »');
    await p.goBack(); await W(300); ok(await p.evaluate(() => curPage) === 'obj', 'retour (bouton précédent) → Objectifs');
    const all = await p.evaluate(() => OBJECTIFS.map(o => { renderSummit(o.n); const t = $('sumBody').innerText; return t.length > 1500 && /Sources/.test(t) && $('sumBody').querySelectorAll('.links a').length === 5; }));
    ok(all.every(Boolean), 'les 10 fiches sont complètes (≥ 1 500 caractères, 5 liens carte/météo)', all);
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

  // ---------- 10. Import Mi Fitness : OCR sur les captures + écran de vérification ----------
  if (process.env.SAMPLES) {
    out.push('10. Import Mi Fitness (OCR dans le navigateur, index.html réel)');
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
      await p.click('[data-it] input[data-k="incline"]', {clickCount:3}); await p.type('[data-it] input[data-k="incline"]', '8'); await W(100);
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
  await b.close();
  console.log(out.join('\n')); console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
