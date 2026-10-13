/* Suite de tests de « Suivi montagne » (Chrome sans interface, puppeteer-core).
   Usage : BASE=http://localhost:8767 SAMPLES=1 CHROME=/usr/bin/google-chrome node tests/suite.js
   Le dossier servi doit contenir index.html (nouvelle version), old.html (version v4 précédente, commit d5589b1),
   sw.js, et — pour les tests OCR — les captures Mi Fitness marche.jpg, rando.jpg, corde.jpg, poids.png
   (captures personnelles : jamais commitées). */
const puppeteer = require(process.env.PUPPETEER || 'puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:8767';
const W = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const out = [];
function ok(c, name, extra) { if (c) { pass++; out.push('  ✔ ' + name); } else { fail++; out.push('  ✘ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : '')); } }
const TRUTH = {}; // valeurs retirées
(async () => {
  const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox','--lang=fr-FR']});
  const fresh = async (url) => { const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({width:390,height:844});
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept()); if (url) await p.goto(url, {waitUntil:'networkidle0'}); return [ctx, p]; };

  // ---------- 1. Démarrage à neuf ----------
  out.push('1. Démarrage à neuf');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => ({v:DB.version, n:DB.sessions.length, w:DB.weights.map(x=>x.id), biv:DB.equip.filter(c=>/bivouac/i.test(c.name)).length, tomb:Object.keys(DB.tomb), types:TYPES.length, obj:OBJECTIFS.map(o=>o.n), snaps:snapshots().length}));
    ok(r.v === 4, 'version des données = 4', r.v); ok(r.n === 29, '29 séances de départ', r.n); ok(r.w.length === 1 && r.w[0] === 'seed-w-2026-10-13', 'pesée du 13/10/2026 présente', r.w);
    ok(r.biv === 1, 'une catégorie Bivouac'); ok(['s','c','i','w'].every(k => r.tomb.includes(k)), 'pierres tombales s/c/i/w');
    ok(r.obj.join() === '1,2,3,4,5,6,7,8,9,10', 'objectifs 1→10 (GR 441 en n° 10)', r.obj); ok(r.snaps === 1, 'copie de sécurité du jour créée', r.snaps);
    for (const t of ['journal','obj','prep','evo','poids','equip','data']) await p.evaluate(t => show(t), t);
    ok(p.errs.length === 0, 'aucune erreur JS sur les 7 onglets', p.errs); await ctx.close(); }

  // ---------- 2. Migration v3 → v4 depuis l'ancienne version ----------
  out.push('2. Migration depuis la version précédente (v3), sans perte');
  { const [ctx, p] = await fresh(BASE + '/old.html');
    const before = await p.evaluate(() => { // modifications « utilisateur » dans l'ancienne appli
      DB.sessions.push({id:'u1',date:'2026-10-12',type:'Tapis 6%',dist:5,dplus:300,dminus:null,dur:3600,bpm:120,bpmMax:null,pas:null,sac:4,sauts:null,ress:7,exos:'',notes:'à moi',updatedAt:1760000000000});
      DB.equip[0].items[0].bought = true; DB.equip[0].items[0].price = 149; DB.equip[0].items[0].updatedAt = 1760000000001;
      DB.objectifs[1] = {statut:'Prêt', datePrevue:'2026-10-25', dateRealisee:'', updatedAt:1760000000002};
      DB.tomb.s['seed-x-1'] = 1760000000003; DB.sessions = DB.sessions.filter(s => s.id !== 'seed-x-1');
      save(); return localStorage.getItem(KEY); });
    await p.goto(BASE + '/index.html', {waitUntil:'networkidle0'});
    const r = await p.evaluate(() => ({bk: localStorage.getItem(KEY + '.backup.v3'), db: DB}));
    const B = JSON.parse(before), D = r.db;
    ok(r.bk === before, 'copie intégrale avant migration (…backup.v3) identique aux données d’avant');
    ok(B.sessions.every(s => JSON.stringify(D.sessions.find(x => x.id === s.id)) === JSON.stringify(s)), 'toutes les séances conservées à l’identique', B.sessions.length + ' vs ' + D.sessions.length);
    ok(D.sessions.length === B.sessions.length, 'aucune séance ajoutée/retirée', [B.sessions.length, D.sessions.length]);
    ok(D.equip[0].items[0].bought === true && D.equip[0].items[0].price === 149, 'achat + prix conservés');
    ok(D.objectifs[1].statut === 'Prêt' && D.objectifs[1].datePrevue === '2026-10-25', 'état d’objectif conservé');
    ok(D.tomb.s['seed-x-1'] === 1760000000003, 'suppression conservée (pierre tombale)');
    ok(D.version === 4 && D.weights.length === 1 && D.equip.some(c => c.id === 'eqc-bivouac'), 'v4 : pesée + Bivouac ajoutés');
    ok(B.equip.every(c => D.equip.some(x => x.id === c.id && x.items.length === c.items.length)), 'catégories existantes intactes');
    const j1 = JSON.stringify(D); await p.reload({waitUntil:'networkidle0'}); const j2 = await p.evaluate(() => JSON.stringify(DB));
    ok(j1 === j2, 'migration idempotente (rechargement sans changement)');
    // un utilisateur qui supprime la catégorie Bivouac ne la voit pas revenir
    await p.evaluate(() => { const c = DB.equip.find(c => c.id === BIV_ID); DB.equip = DB.equip.filter(x => x !== c); DB.tomb.c[BIV_ID] = Date.now(); c.items.forEach(i => DB.tomb.i[i.id] = Date.now()); DB.version = 3; save(); });
    await p.reload({waitUntil:'networkidle0'});
    ok(await p.evaluate(() => !DB.equip.some(c => c.id === BIV_ID)), 'Bivouac supprimé par l’utilisateur : pas recréé');
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 3. Synchro : compatibilité avec un ancien client ----------
  out.push('3. Synchronisation avec un ancien client (fusion)');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const NEW = await p.evaluate(() => { DB.sessions[0].kcal = 321; DB.sessions[0].teLabel = 'Récupération · Aérobie'; DB.sessions[0].updatedAt = 5;
      DB.weights.push({id:'w2',date:'2026-10-20',weight:76.5,updatedAt:6}); DB.prefs.actMap.marche = {act:'Marche',type:'Tapis',incline:6,updatedAt:7}; save(); return JSON.stringify(DB); });
    const [ctx2, o] = await fresh(BASE + '/old.html');
    const viaOld = await o.evaluate(n => { const R = JSON.parse(n); if (!validImport(R)) return 'invalid'; migrate(R); return JSON.stringify(mergeDB(JSON.parse(JSON.stringify(DB)), R)); }, NEW);
    ok(viaOld !== 'invalid', 'l’ancien client accepte le fichier du gist v4');
    const OLDM = JSON.parse(viaOld);
    ok(OLDM.sessions[0].kcal === 321 || OLDM.sessions.find(s => s.id === JSON.parse(NEW).sessions[0].id).kcal === 321, 'ancien client : nouveaux champs de séance conservés à la fusion');
    ok(Array.isArray(OLDM.weights) && OLDM.weights.length === 2, 'ancien client : pesées conservées (clé inconnue gardée)', OLDM.weights);
    const back = await p.evaluate(m => { const R = JSON.parse(m); if (!validImport(R)) return null; migrate(R); const M = mergeDB(JSON.parse(JSON.stringify(DB)), R); normalizeDB(M); return M; }, viaOld);
    ok(back && back.weights.length === 2 && back.prefs.actMap.marche.type === 'Tapis', 'nouveau client : fusion du gist réécrit par l’ancien client sans perte');
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
    let keys = []; for (let i = 0; i < 40; i++) { keys = await p.evaluate(() => caches.keys()); if (keys.includes('suivi-montagne-v5') && !keys.includes('suivi-montagne-v4')) break; await W(250); }
    ok(keys.includes('ma-bibliotheque-v3') && keys.includes('autre-appli'), 'caches des autres applis conservés', keys);
    ok(!keys.includes('suivi-montagne-v4') && !keys.includes('suivi-montagne-v2') && keys.includes('suivi-montagne-v5'), 'anciens caches de l’appli supprimés, v5 créé', keys);
    await ctx.close(); }

  // ---------- 6. Moteur de conseils ----------
  out.push('6. Conseils « Prochaine ascension »');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => { const ref = new Date(2026, 9, 13); const A1 = advise(OBJECTIFS[0], ref);
      const s = sunTimes(ref, 45.7639, 2.9559); const A8 = advise(OBJECTIFS[7], ref); const A10 = advise(OBJECTIFS[9], ref);
      const save = DB.sessions; DB.sessions = []; const E = advise(OBJECTIFS[4], ref); DB.sessions = save;
      return {r1:A1.R.r, w1:A1.warn.join('|'), set:hhmm(s.set), rise:hhmm(s.rise), w8:A8.warn.join('|'), r8:A8.R.r, g10:A10.gear.map(g=>g.k), E:E.tips.map(t=>t.t).join('|'), Er:E.R.r, html:adviceCard(A1).length, all:OBJECTIFS.every(o=>{ const a=advise(o,ref); return a.R.r>=0&&a.R.r<=1&&a.plan.length===3; })}; });
    ok(r.r1 >= 0.8, 'Puy de Dôme : prêt avec les séances actuelles', r.r1); ok(/Fermeture du 05\/10\/2026 au 16\/10\/2026/.test(r.w1), 'fermeture du chemin des Muletiers signalée le 13/10/2026');
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
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => { const s = DB.sessions.find(x => x.id === 'seed-x-2'); s.teLabel = 'Récupération · Aérobie'; s.src = 'mifit'; s.kcal = 0;
      fillForm(s); show('add'); $('f_notes').value = 'modifié'; $('fSess').requestSubmit(); const t = DB.sessions.find(x => x.id === s.id);
      fillForm(null); show('add'); $('f_type').value = 'Tapis'; $('f_type').dispatchEvent(new Event('change')); $('f_dist').value = '5'; $('f_dist').dispatchEvent(new Event('input'));
      const auto = $('f_dplus').value, incl = $('f_incline').value, vis = $('w_incl').style.display; $('f_date').value = '2026-10-12'; $('fSess').requestSubmit();
      const n = DB.sessions.filter(x => x.type === 'Tapis').pop(); return {keep: t.teLabel === 'Récupération · Aérobie' && t.src === 'mifit' && t.kcal === 0 && t.notes === 'modifié', auto, incl, vis, n}; });
    ok(r.keep, 'modifier une séance conserve les champs importés (libellé TE, source, kcal)');
    ok(r.incl === '6' && r.auto === '300' && r.vis === '', 'type Tapis : inclinaison 6 % par défaut, D+ auto = 5 km × 6 % = 300 m', r);
    ok(r.n && r.n.incline === 6 && r.n.dplus === 300 && !('kcal' in r.n), 'séance Tapis enregistrée (sans champs vides superflus)', r.n);
    ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }

  // ---------- 9. Données : export / import JSON, copies ----------
  out.push('9. Export / import et copies de sécurité');
  { const [ctx, p] = await fresh(BASE + '/index.html');
    const r = await p.evaluate(() => { const j = JSON.stringify(DB); const o = JSON.parse(j); const v1 = validImport(o); o.weights.push({date:'13/10/2026'}); const v2 = validImport(o);
      snapshot('test', true); const nS = snapshots().length; DB.sessions = []; save(); const snaps = snapshots(); const i = snaps.findIndex(x => x.reason === 'test');
      restoreSnap(i); return {v1, v2, nS, after: DB.sessions.length, csv: weightsCSV().split('\n').length}; });
    ok(r.v1 && !r.v2, 'validation de l’import (pesées incluses)'); ok(r.after === 29, 'restauration d’une copie de sécurité', r); ok(r.csv === 2, 'export CSV des pesées');
    await ctx.close(); }

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
    { const [ctx, p] = await fresh(BASE + '/index.html');
      const n0 = await p.evaluate(() => DB.sessions.length);
      await p.evaluate(() => IMP.open()); const inp = await p.$('#impFiles');
      await inp.uploadFile(...['marche.jpg','corde.jpg','poids.png'].map(f => (process.env.SAMPLE_DIR || require('path').resolve('.')) + '/' + f));
      await p.waitForFunction(() => IMP.items.length === 3 && IMP.items.every(x => !['queued','reading'].includes(x.status)), {timeout:180000});
      ok(await p.evaluate(() => DB.sessions.length) === n0, 'rien n’est enregistré avant validation');
      const m = await p.evaluate(() => { const it = IMP.items[0]; return {dup:it.dup&&it.dup.id, mode:it.mode, type:it.type, fields:[...document.querySelectorAll('[data-it="'+it.id+'"] [data-k]')].map(e=>e.dataset.k)}; });
      ok(m.dup === 'seed-x-2' && m.mode === 'merge', 'séance du 11/10 déjà saisie détectée → « compléter »', m);
      ok(m.fields.includes('altMin') && m.fields.includes('dminus') && !m.fields.includes('incline'), 'champs adaptés au type Marche');
      // passage en Tapis
      await p.select('[data-it] select[data-type]', 'Tapis'); await W(200);
      const t = await p.evaluate(() => { const it = IMP.items[0], c = document.querySelector('[data-it="'+it.id+'"]'); return {incl:c.querySelector('[data-k="incline"]').value, dp:c.querySelector('[data-k="dplus"]').value, keys:[...c.querySelectorAll('[data-k]')].map(e=>e.dataset.k), badge:c.querySelector('label[for$="_dplus"] .cf').textContent}; });
      ok(t.incl === '6' && t.dp === '0' && t.badge === 'calculé', 'Marche → Tapis : inclinaison 6 %, D+ calculé x m', t);
      ok(!t.keys.includes('dminus') && !t.keys.includes('altMin'), 'Tapis : D-, altitudes masqués');
      await p.click('[data-it] input[data-k="incline"]', {clickCount:3}); await p.type('[data-it] input[data-k="incline"]', '8'); await W(100);
      ok(await p.evaluate(() => document.querySelector('[data-it] [data-k="dplus"]').value) === '0', 'inclinaison 8 % → D+ x m');
      await p.evaluate(() => { const r = document.querySelector('[data-it] input[value="new"][data-mode]'); r.click(); });
      await p.evaluate(() => document.querySelector('[data-it] [data-imp-save]').click()); await W(200);
      const s1 = await p.evaluate(() => { const s = DB.sessions[DB.sessions.length - 1]; return {s, pref:DB.prefs.actMap.marche}; });
      ok(s1.s.type === 'Tapis' && s1.s.incline === 8 && s1.s.dplus === 0 && s1.s.dminus == null && s1.s.altMin === undefined && s1.s.kcal === 0 && s1.s.dur === 0 && s1.s.heure === '', 'séance Tapis enregistrée avec les bonnes valeurs', s1.s);
      ok(s1.pref && s1.pref.type === 'Tapis' && s1.pref.incline === 8, 'choix mémorisé pour « Marche » (Tapis, 8 %)', s1.pref);
      // pesée : mise à jour de la pesée existante, pas de doublon
      const wv = await p.evaluate(() => { const it = IMP.items.find(x => x.kind === 'weigh'); return {mode:it.wMode, dup:it.wDup&&it.wDup.id}; });
      ok(wv.mode === 'update' && wv.dup === 'seed-w-2026-10-13', 'pesée du 13/10 déjà présente → mise à jour proposée', wv);
      await p.evaluate(() => IMP.saveAll()); await W(300);
      const after = await p.evaluate(() => ({w:DB.weights.length, w0:DB.weights[0], corde:DB.sessions.find(s => s.type === 'Corde à sauter' && s.date === '2026-10-01')}));
      ok(after.w === 1 && after.w0.updatedAt > 0 && after.w0.weight === 0 && after.w0.bodyType === '', 'pesée mise à jour (1 seule pesée)', after.w0);
      ok(after.corde && after.corde.sauts === 0 && after.corde.dur === 0 && after.corde.pauses === 4, '« Tout enregistrer » : corde à sauter ajoutée', after.corde);
      // nouvelle capture « Marche » : suggestion = dernier choix
      await inp.uploadFile((process.env.SAMPLE_DIR || require('path').resolve('.')) + '/marche.jpg');
      await p.waitForFunction(() => IMP.items.some(x => x.status === 'done' && x.act === 'Marche'), {timeout:120000});
      const sug = await p.evaluate(() => { const it = IMP.items.find(x => x.status === 'done' && x.act === 'Marche'); return {type:it.type, pref:it.pref, incl:it.v.incline}; });
      ok(sug.type === 'Tapis' && sug.pref && sug.incl === 8, 'capture suivante « Marche » : Tapis 8 % suggéré (modifiable)', sug);
      ok(p.errs.length === 0, 'aucune erreur JS', p.errs); await ctx.close(); }
  }
  await b.close();
  console.log(out.join('\n')); console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
