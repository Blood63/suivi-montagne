// carte « Statistiques » synthétique (valeurs fictives) : fond photo bruité + rayures blanches + anneaux
module.exports = `(async (o) => { const W=1050,H=1442, c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d');
  let seed=o.seed||7; const rnd=()=>{ seed=(seed*16807)%2147483647; return seed/2147483647; };
  const gr=g.createLinearGradient(0,0,W,H); gr.addColorStop(0,o.c1||'#8a2f24'); gr.addColorStop(.5,o.c2||'#b5523a'); gr.addColorStop(1,o.c3||'#3d4a3a'); g.fillStyle=gr; g.fillRect(0,0,W,H);
  for(let i=0;i<1600;i++){ g.fillStyle='rgba('+(rnd()*255|0)+','+(rnd()*200|0)+','+(rnd()*160|0)+','+(0.15+rnd()*0.25)+')'; const r=4+rnd()*40; g.beginPath(); g.arc(rnd()*W,rnd()*H,r,0,7); g.fill(); }
  g.strokeStyle='rgba(235,235,230,.75)'; g.lineWidth=7; for(let k=0;k<(o.lines??6);k++){ g.beginPath(); const y=300+k*170+rnd()*60; g.moveTo(-20,y+260); g.lineTo(W+20,y-200+rnd()*80); g.stroke(); }
  g.fillStyle='#fff'; g.textBaseline='alphabetic'; const F=(w,s)=>w+' '+s+'px Roboto, Arial, sans-serif';
  g.font=F(400,30); g.fillText('Prénom Nom',190,95);
  g.font=F(700,44); g.fillText(o.date+'Statistiques',70,190);
  const L=[['Calories',o.kcal,'kcal',610],['Pas',o.pas,'pas',862],(o.pauses!=null?['Pauses actives',o.pauses,'coups',1088]:['Durée de l’activité',o.min,'min',1088])];
  for(const [lab,v,u,y] of L){ g.font=F(400,34); g.fillText(lab,(lab==='Pas'?130:75),y); g.font=F(700,82); g.fillText(String(v),70,y+110); const w=g.measureText(String(v)).width; g.font=F(400,36); g.fillText(' '+u,70+w+6,y+110); }
  const cx=800,cy=880; [['#ff6a3d',230],['#ffd23f',175],['#3dd5ff',120]].forEach(([col,r])=>{ g.strokeStyle='rgba(255,255,255,.25)'; g.lineWidth=44; g.beginPath(); g.arc(cx,cy,r,0,7); g.stroke(); g.strokeStyle=col; g.beginPath(); g.arc(cx,cy,r,-1.57,-1.57+rnd()*5); g.stroke(); });
  g.font=F(500,32); g.fillText('Mi Fitness',120,1395);
  return await new Promise(r=>c.toBlob(r,'image/jpeg',0.86)); })`;
