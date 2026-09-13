/* ============================================================
   FLYKICK main — game loop, states, HUD, brain cam, toasts.
   ============================================================ */

const UI = {
  el(id){ return document.getElementById(id); },
  toast(html, awayTeam=false, ms=2200){
    const t=document.createElement('div');
    t.className='toast'+(awayTeam?' away':'');
    t.innerHTML=html;
    this.el('toast-area').appendChild(t);
    setTimeout(()=>{t.style.transition='opacity .4s';t.style.opacity='0';setTimeout(()=>t.remove(),400);},ms);
  },
  log(entry){
    const box=this.el('match-log');
    const ln=document.createElement('div');
    ln.className='ln'+(entry.team===1?' away':'')+(entry.sys?' sys':'');
    ln.innerHTML=`<b>${entry.t!==undefined?Math.floor(entry.t/60)+':'+String(Math.floor(entry.t%60)).padStart(2,'0'):'—'}</b><span>${entry.msg}</span>`;
    box.prepend(ln);
    while(box.children.length>40) box.lastChild.remove();
  },
  camTrace(f){
    const box=this.el('cam-trace');
    if(box.children.length>60) return;
    const ln=document.createElement('div');
    ln.className='ln';
    const col=FLY_BRAIN.clsColor[FLY_BRAIN.byid[f.id].cls];
    ln.innerHTML=`<b style="color:${col}">${f.id}</b><span>${f.msg||'fires'}</span>`;
    box.prepend(ln);
  },
};

/* brain cam — draws the possessed (or best) fly's circuit live */
const BrainCam = {
  canvas:null, ctx:null, W:0, H:0, DPR:1, visible:true,

  init(){
    this.canvas=document.getElementById('cam');
    this.ctx=this.canvas.getContext('2d');
    this.resize(); window.addEventListener('resize',()=>this.resize());
    this.traceIdx=0;
  },
  resize(){
    const r=this.canvas.getBoundingClientRect();
    if(!r.width) return;
    this.DPR=Math.min(2,window.devicePixelRatio||1);
    this.W=r.width; this.H=r.height;
    this.canvas.width=this.W*this.DPR; this.canvas.height=this.H*this.DPR;
    this.ctx.setTransform(this.DPR,0,0,this.DPR,0,0);
  },
  draw(){
    if(!this.visible||!this.W){ requestAnimationFrame(()=>this.draw()); return; }
    const ctx=this.ctx;
    const subject = Engine.possession
      || Engine.flies.slice().sort((a,b)=>b.brain.history.slice(-1)[0]-a.brain.history.slice(-1)[0])[0];
    document.getElementById('cam-subject').innerHTML = subject
      ? `watching: <b>${subject.name}</b>${subject===Engine.possession?' (YOU)':''} · ${subject.role}`
      : 'watching: match';

    ctx.clearRect(0,0,this.W,this.H);
    if(!subject){ requestAnimationFrame(()=>this.draw()); return; }
    const B=subject.brain;

    // grid bg
    ctx.strokeStyle='#101a2e'; ctx.lineWidth=1;
    for(let y=0;y<this.H;y+=14){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(this.W,y);ctx.stroke();}

    // synapses
    const pos=id=>{const n=FLY_BRAIN.byid[id];return {x:n.ax*this.W, y:n.ay*this.H};};
    FLY_BRAIN.synapses.forEach(([from,to,w])=>{
      const a=pos(from), b=pos(to);
      const fire=Math.min(1,(B.firing[from]||0));
      if(fire>.06){
        ctx.strokeStyle=`rgba(0,229,255,${fire*.8})`;
        ctx.lineWidth=.8+w*1.6*fire;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        // pulse dot
        const ph=(performance.now()/700+from.length)%1;
        ctx.fillStyle='rgba(0,229,255,.9)';
        ctx.beginPath(); ctx.arc(a.x+(b.x-a.x)*ph, a.y+(b.y-a.y)*ph, 2.5,0,7); ctx.fill();
      }
    });

    // activity trace (bottom strip)
    const hist=B.history;
    ctx.strokeStyle='#00e5ff'; ctx.lineWidth=1.4; ctx.beginPath();
    hist.forEach((v,i)=>{
      const x=(i/240)*this.W, y=this.H-6-Math.min(1,v*8)*(this.H*.3);
      i?ctx.lineTo(x,y):ctx.moveTo(x,y);
    });
    ctx.stroke();

    // nodes
    FLY_BRAIN.neurons.forEach(n=>{
      const p=pos(n.id);
      const act=Math.min(1,(B.firing[n.id]||0)+(B.flash[n.id]||0)*.5);
      const col=FLY_BRAIN.clsColor[n.cls];
      ctx.fillStyle=col;
      ctx.globalAlpha=.3+act*.7;
      ctx.shadowColor=col; ctx.shadowBlur=act*12;
      ctx.beginPath(); ctx.arc(p.x,p.y, 3+act*4,0,7); ctx.fill();
      ctx.shadowBlur=0; ctx.globalAlpha=1;
      if(act>.55){
        ctx.fillStyle='rgba(228,237,255,.9)'; ctx.font='9px ui-monospace,monospace';
        ctx.fillText(n.id, p.x+7, p.y-4);
      }
    });

    // stream firing events into the trace box (throttled)
    this.traceIdx=(this.traceIdx||0)+1;
    if(this.traceIdx%6===0){
      FLY_BRAIN.neurons.forEach(n=>{
        if((B.flash[n.id]||0)>.85) UI.camTrace({id:n.id,msg:'fires'});
      });
    }
    requestAnimationFrame(()=>this.draw());
  },
};

/* ---- app boot ---- */
window.addEventListener('DOMContentLoaded',()=>{
  Render.init();
  Input.init();
  BrainCam.init();

  Engine.reset(); Engine.state='menu';
  Engine.log = (msg,team,sys)=>{}; // replaced below

  // wire buttons
  UI.el('btn-start').addEventListener('click',()=>{
    Engine.reset();
    Engine.savedT=0;
    Engine.state='play';
    AUDIO.ensure(); if(AUDIO.on) AUDIO.startCrowd();
    AUDIO.whistle(1);
    UI.el('ov-menu').classList.add('hidden');
    UI.toast('Click any fly to <b>possess</b> it — either team!');
  });
  UI.el('btn-again').addEventListener('click',()=>{
    UI.el('ov-end').classList.add('hidden');
    Engine.reset(); Engine.savedT=0; Engine.state='play';
    AUDIO.whistle(1);
  });
  UI.el('btn-audio').addEventListener('click',function(){
    const on=AUDIO.toggle();
    this.classList.toggle('on',on);
    this.innerHTML=`<svg><use href="#ic-${on?'sound':'mute'}"/></svg>`;
    UI.toast(on?'🔊 Sound on — crowd, kicks, whistle':'Muted');
  });
  UI.el('btn-braincam').addEventListener('click',function(){
    BrainCam.visible=!BrainCam.visible;
    this.classList.toggle('on',BrainCam.visible);
    document.getElementById('brain-panel').style.opacity = BrainCam.visible?'1':'.4';
    UI.toast(BrainCam.visible?'Brain cam on':'Brain cam dimmed');
  });

  // engine event tap → log + toasts
  const origLog = (msg,team,sys)=>UI.log({msg,team,sys,t:Engine.t});
  Engine.log = origLog;

  // HUD update + loop
  let last=performance.now();
  let lastSecond=-1;
  function frame(now){
    const dt=Math.min(50, now-last); last=now;
    const input=Input.frame();
    Engine.step(dt, input);

    // HUD
    const rem=Math.max(0,MATCH_TIME-Engine.t);
    const mm=Math.floor(rem/60), ss=Math.floor(rem%60);
    UI.el('sb-clock').textContent=`${mm}:${String(ss).padStart(2,'0')}`;
    UI.el('sb-score').textContent=`${Engine.score[0]} : ${Engine.score[1]}`;

    // overlays per state
    if(Engine.state==='goal'){
      UI.el('ov-goal').classList.remove('hidden');
      const g=Engine.goalInfo;
      UI.el('goal-text').textContent='GOAL!';
      UI.el('goal-text').style.color = g.team===0?'var(--home)':'var(--away)';
      UI.el('goal-scorer').textContent = (g.team===0?'VOLT':'MAGENTA')+' · '+g.scorer;
    } else UI.el('ov-goal').classList.add('hidden');

    if(Engine.state==='end'){
      UI.el('ov-end').classList.remove('hidden');
      const [a,b]=Engine.score;
      UI.el('end-title').textContent = a===b?'DRAW':(a>b?'VOLT WINS':'MAGENTA WINS');
      UI.el('end-title').style.color = a===b?'var(--gold)':(a>b?'var(--home)':'var(--away)');
      UI.el('end-score').textContent=`${a} : ${b}`;
    } else UI.el('ov-end').classList.add('hidden');

    // possession banner
    const banner=UI.el('possess-banner');
    if(Engine.possession){
      banner.classList.remove('hidden');
      UI.el('possess-name').textContent=Engine.possession.name;
    } else banner.classList.add('hidden');

    // clock second beeps in last 10s
    const sec=Math.floor(rem);
    if(sec!==lastSecond){ lastSecond=sec; if(sec<=10&&sec>0&&Engine.state==='play') AUDIO.ui&&0; }

    Render.draw(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  BrainCam.draw();
});
