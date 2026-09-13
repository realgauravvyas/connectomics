/* ============================================================
   FLYKICK render — broadcast-neon match visuals.
   Layered glow pitch, holo top-down flies with wing motion-blur,
   ball trail + particles, possession aura, goal beams, shake.
   ============================================================ */

const Render = {
  canvas:null, ctx:null, W:0, H:0, DPR:1, scale:1,
  shakeT:0, shakeMag:0, particles:[], goalBeams:0,

  init(){
    this.canvas=document.getElementById('pitch');
    this.ctx=this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize',()=>this.resize());
    // static pitch layer cache
    this.pitchCache=null;
  },
  resize(){
    const r=this.canvas.getBoundingClientRect();
    this.DPR=Math.min(2,window.devicePixelRatio||1);
    this.W=Math.max(300,r.width); this.H=Math.max(240,r.height);
    this.canvas.width=this.W*this.DPR; this.canvas.height=this.H*this.DPR;
    this.ctx.setTransform(this.DPR,0,0,this.DPR,0,0);
    this.scale=Math.min(this.W/PITCH.w, this.H/PITCH.h);
    this.pitchCache=null;
  },
  wx(x){ return (x-PITCH.w/2)*this.scale + this.W/2; },
  wy(y){ return (y-PITCH.h/2)*this.scale + this.H/2; },

  shake(mag){ this.shakeT=1; this.shakeMag=mag; },
  burst(x,y,color,n=14,spd=3){
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2, s=(.4+Math.random())*spd;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,color,r:1+Math.random()*2.5});
    }
  },

  /* ---------- static pitch layer ---------- */
  makePitch(){
    const c=document.createElement('canvas');
    c.width=this.W*this.DPR; c.height=this.H*this.DPR;
    const g=c.getContext('2d'); g.scale(this.DPR,this.DPR);
    const W=this.W,H=this.H,s=this.scale;
    const px=x=>(x-PITCH.w/2)*s+W/2, py=y=>(y-PITCH.h/2)*s+H/2;

    // pitch base — dark gradient with subtle mow stripes
    const grad=g.createLinearGradient(0,0,0,H);
    grad.addColorStop(0,'#081020'); grad.addColorStop(.5,'#0a1424'); grad.addColorStop(1,'#081020');
    g.fillStyle=grad; g.fillRect(0,0,W,H);
    g.globalAlpha=.16;
    for(let i=0;i<10;i++){
      g.fillStyle=i%2?'#0e1c30':'#0a1626';
      g.fillRect(px(0)+i*(PITCH.w*s/10),py(0),PITCH.w*s/10,PITCH.h*s);
    }
    g.globalAlpha=1;

    // stadium glow vignette
    const vg=g.createRadialGradient(W/2,H/2,H*.2,W/2,H/2,W*.62);
    vg.addColorStop(0,'rgba(0,229,255,.05)'); vg.addColorStop(.7,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,.5)');
    g.fillStyle=vg; g.fillRect(0,0,W,H);

    // markings — glowing cyan lines
    g.strokeStyle='rgba(0,229,255,.5)'; g.lineWidth=1.6;
    g.shadowColor='#00e5ff'; g.shadowBlur=6;
    // boundary
    g.strokeRect(px(0),py(0),PITCH.w*s,PITCH.h*s);
    // halfway line + centre circle
    g.beginPath(); g.moveTo(px(PITCH.w/2),py(0)); g.lineTo(px(PITCH.w/2),py(PITCH.h)); g.stroke();
    g.beginPath(); g.arc(px(PITCH.w/2),py(PITCH.h/2),80*s,0,7); g.stroke();
    g.beginPath(); g.arc(px(PITCH.w/2),py(PITCH.h/2),3*s,0,7); g.fillStyle='rgba(0,229,255,.7)'; g.fill();
    // boxes
    [0,1].forEach(t=>{
      const dir=t===0?1:-1, gx=t===0?0:PITCH.w;
      g.strokeRect(px(Math.min(gx,gx+dir*120)),py(PITCH.h/2-110),120*s,220*s);
      g.strokeRect(px(Math.min(gx,gx+dir*46)),py(PITCH.h/2-64),46*s,128*s);
      // goal mouth — team-colored
      g.strokeStyle=t===0?'rgba(255,95,158,.85)':'rgba(0,229,255,.85)';
      g.shadowColor=t===0?'#ff5f9e':'#00e5ff';
      g.lineWidth=3;
      g.beginPath();
      g.moveTo(px(gx),py(PITCH.h/2-GOAL.h/2)); g.lineTo(px(gx-dir*14),py(PITCH.h/2-GOAL.h/2));
      g.lineTo(px(gx-dir*14),py(PITCH.h/2+GOAL.h/2)); g.lineTo(px(gx),py(PITCH.h/2+GOAL.h/2));
      g.stroke();
      g.strokeStyle='rgba(0,229,255,.5)'; g.lineWidth=1.6; g.shadowColor='#00e5ff';
    });
    g.shadowBlur=0;
    this.pitchCache=c;
  },

  /* ---------- main frame ---------- */
  draw(dt=16){
    const ctx=this.ctx;
    if(!this.pitchCache) this.makePitch();
    const now=performance.now();

    // screen shake
    let sx=0, sy=0;
    if(this.shakeT>0){
      this.shakeT=Math.max(0,this.shakeT-dt/450);
      const m=this.shakeMag*this.shakeT*this.shakeT;
      sx=(Math.random()-.5)*m; sy=(Math.random()-.5)*m;
    }
    ctx.clearRect(0,0,this.W,this.H);
    ctx.save();
    ctx.translate(sx,sy);
    ctx.drawImage(this.pitchCache,0,0,this.W,this.H);

    // GOAL BEAMS — light columns when a goal happens
    if(Engine.state==='goal' && Engine.goalInfo){
      const t=Engine.goalInfo.team;
      const gx=t===0?PITCH.w-6:6;
      const beam=ctx.createLinearGradient(this.wx(gx)-40,0,this.wx(gx)+40,0);
      const col=t===0?'0,229,255':'255,95,158';
      beam.addColorStop(0,`rgba(${col},0)`); beam.addColorStop(.5,`rgba(${col},${.22+.1*Math.sin(now/90)})`); beam.addColorStop(1,`rgba(${col},0)`);
      ctx.fillStyle=beam;
      ctx.fillRect(this.wx(gx)-60,0,120,this.H);
    }

    // ball trail
    const ball=Engine.ball;
    if(ball){
      ball.trail.forEach((p,i)=>{
        const a=p.a*(i/ball.trail.length);
        ctx.fillStyle=`rgba(255,209,102,${a*.5})`;
        ctx.beginPath(); ctx.arc(this.wx(p.x),this.wy(p.y),ball.r*this.scale*(.4+a*.8),0,7); ctx.fill();
      });
    }

    // flies
    Engine.flies.forEach(f=>this.drawFly(ctx,f,now,dt));

    // ball
    if(ball) this.drawBall(ctx,ball,now);

    // particles
    this.particles=this.particles.filter(p=>{
      p.x+=p.vx; p.y+=p.vy; p.vx*=.94; p.vy*=.94; p.life-=.03;
      if(p.life<=0) return false;
      ctx.globalAlpha=p.life;
      ctx.fillStyle=p.color;
      ctx.beginPath(); ctx.arc(this.wx(p.x),this.wy(p.y),p.r*this.scale*1.4,0,7); ctx.fill();
      ctx.globalAlpha=1;
      return true;
    });

    ctx.restore();
  },

  /* ---------- one fly (top-down holo) ---------- */
  drawFly(ctx,f,now,dt){
    const x=this.wx(f.x), y=this.wy(f.y);
    const s=this.scale;
    const team=f.team;
    const col= team===0 ? '0,229,255' : '255,95,158';
    const alt= team===0 ? '0,140,190' : '190,60,120';
    const possessed = f===Engine.possession;
    const speed=Math.hypot(f.vx,f.vy);
    const active = speed>.25 || f.kickFlash>0 || possessed;

    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(f.heading+Math.PI/2); // face travel direction

    // wing motion-blur trails when moving fast
    if(speed>.6){
      const wingA=Math.sin(now/ (speed>2?18:36))*.7;
      for(let w=0;w<2;w++){
        const side=w?1:-1;
        ctx.save();
        ctx.rotate(wingA*side*.4);
        ctx.fillStyle=`rgba(${alt},.25)`;
        ctx.beginPath(); ctx.ellipse(-14*s*side,-6*s, 15*s,5*s, .5*side, 0,7); ctx.fill();
        ctx.restore();
      }
    }
    // wings
    const wingA=Math.sin(now/ (active? 16: 60))*(active?.9:.15);
    for(let w=0;w<2;w++){
      const side=w?1:-1;
      ctx.save();
      ctx.rotate(wingA*side*.5);
      ctx.fillStyle=`rgba(${col},.18)`;
      ctx.strokeStyle=`rgba(${col},.6)`;
      ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.ellipse(-15*s*side,-5*s, 16*s,5.5*s, .5*side, 0,7); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // body — wireframe holo
    const grad=ctx.createLinearGradient(-8*s,0,8*s,0);
    grad.addColorStop(0,`rgba(${col},.06)`); grad.addColorStop(.5,`rgba(${col},.14)`); grad.addColorStop(1,`rgba(${col},.06)`);
    ctx.fillStyle=grad;
    ctx.strokeStyle=`rgba(${col},.75)`;
    ctx.lineWidth=1.8;
    // abdomen
    ctx.beginPath(); ctx.ellipse(11*s,0, 12*s,7*s, 0,0,7); ctx.fill(); ctx.stroke();
    // thorax
    ctx.beginPath(); ctx.ellipse(-2*s,0, 8*s,6.5*s, 0,0,7); ctx.fill(); ctx.stroke();
    // head + eyes
    ctx.beginPath(); ctx.arc(-12*s,0, 5.5*s,0,7); ctx.fill(); ctx.stroke();
    ctx.fillStyle=`rgba(${team===0?'255,209,102':'255,95,158'},.8)`;
    ctx.beginPath(); ctx.arc(-13.5*s,-2.5*s,2*s,0,7); ctx.fill();
    ctx.beginPath(); ctx.arc(-13.5*s, 2.5*s,2*s,0,7); ctx.fill();
    // haltere dots
    ctx.fillStyle=`rgba(${col},.9)`;
    ctx.beginPath(); ctx.arc(2*s,-7*s,1.4*s,0,7); ctx.fill();
    ctx.beginPath(); ctx.arc(2*s, 7*s,1.4*s,0,7); ctx.fill();

    // kick flash — green burst ring
    if(f.kickFlash>0){
      ctx.strokeStyle=`rgba(61,220,151,${f.kickFlash})`;
      ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.arc(-12*s,0, (10+ (1-f.kickFlash)*22)*s,0,7); ctx.stroke();
    }
    // kick charge meter for possessed
    if(possessed && f.kickCharge>0){
      ctx.strokeStyle='rgba(255,209,102,.9)';
      ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(0,0, 26*s, -Math.PI/2, -Math.PI/2 + (f.kickCharge/1.6)*Math.PI*2); ctx.stroke();
    }
    ctx.restore();

    // role letter + number (screen-space, unrotated)
    ctx.font=`${Math.max(9,10*s)}px ${'ui-monospace,monospace'}`;
    ctx.textAlign='center';
    ctx.fillStyle=`rgba(${col},.85)`;
    ctx.fillText(f.role, x, y-20*s-4);

    // possession aura
    if(possessed){
      const pul=(Math.sin(now/180)+1)/2;
      ctx.strokeStyle=`rgba(255,209,102,${.5+pul*.4})`;
      ctx.lineWidth=2.4;
      ctx.shadowColor='#ffd166'; ctx.shadowBlur=12+pul*8;
      ctx.beginPath(); ctx.arc(x,y,(20+pul*4)*s+8,0,7); ctx.stroke();
      ctx.shadowBlur=0;
      // "YOU" tag
      ctx.fillStyle='#ffd166';
      ctx.fillText('YOU', x, y+26*s+10);
    }
    // faint hover hint ring on all AI flies
    else if(Engine.state==='play'||Engine.state==='kickoff'){
      ctx.strokeStyle=`rgba(${col},.22)`;
      ctx.lineWidth=1;
      ctx.setLineDash([3,5]);
      ctx.beginPath(); ctx.arc(x,y,22*s+4,0,7); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.textAlign='left';
  },

  /* ---------- ball ---------- */
  drawBall(ctx,ball,now){
    const x=this.wx(ball.x), y=this.wy(ball.y), r=ball.r*this.scale*1.15;
    // glow
    const gl=ctx.createRadialGradient(x,y,1,x,y,r*3);
    gl.addColorStop(0,'rgba(255,209,102,.5)'); gl.addColorStop(1,'rgba(255,209,102,0)');
    ctx.fillStyle=gl; ctx.beginPath(); ctx.arc(x,y,r*3,0,7); ctx.fill();
    // body — white-gold with rotating hex pattern (spin)
    ctx.save();
    ctx.translate(x,y); ctx.rotate(ball.spin);
    const bg=ctx.createRadialGradient(-r*.3,-r*.3,r*.2,0,0,r);
    bg.addColorStop(0,'#fff8e0'); bg.addColorStop(.7,'#ffd166'); bg.addColorStop(1,'#c99b2e');
    ctx.fillStyle=bg;
    ctx.beginPath(); ctx.arc(0,0,r,0,7); ctx.fill();
    // pentagon patches
    ctx.fillStyle='rgba(30,20,5,.85)';
    for(let i=0;i<5;i++){
      const a=i*Math.PI*2/5;
      ctx.beginPath();
      ctx.arc(Math.cos(a)*r*.55, Math.sin(a)*r*.55, r*.22, 0, 7);
      ctx.fill();
    }
    ctx.fillStyle='rgba(30,20,5,.9)';
    ctx.beginPath(); ctx.arc(0,0,r*.26,0,7); ctx.fill();
    ctx.restore();
    // rim light
    ctx.strokeStyle='rgba(255,255,255,.5)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.stroke();
  },
};
window.Render = Render;
