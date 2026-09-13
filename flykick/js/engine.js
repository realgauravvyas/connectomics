/* ============================================================
   FLYKICK engine — match simulation.
   2 teams × 5 flies, ball physics, goals, roles, kickoff,
   possession. Every fly is steered by its FlyBrain; the
   possessed fly ignores its brain and obeys the keyboard.
   ============================================================ */

const PITCH = { w: 1050, h: 640 };            // world units
const GOAL = { h: 150, depth: 26 };           // mouth height (world y-size)
const MATCH_TIME = 120;                        // seconds
const K_NAMES = ['Z', 'V', 'X', 'M', 'A'];

const Engine = {
  flies: [], ball: null, t: 0, state: 'menu', // menu|kickoff|play|goal|end
  score: [0,0], possession: null, userTeam: 0, // which team the user last joined
  goalCooldown: 0, events: [], log(msg, team, sys){
    this.events.push({msg, team, sys, t:this.t});
    if (this.events.length>80) this.events.shift();
  },

  reset(){
    this.flies = []; this.t = 0; this.score=[0,0];
    this.possession = null; this.state='kickoff'; this.events=[];
    this.goalCooldown = 0;
    // ball
    this.ball = { x:PITCH.w/2, y:PITCH.h/2, vx:0, vy:0, r:9, spin:0, lastTouch:null, trail:[] };
    // teams
    const formations = [
      // VOLT (left, attacks right →)     role, home x-fraction, y-fraction
      [['GK',.06,.50],['DF',.24,.32],['DF',.24,.68],['MF',.42,.50],['FW',.55,.50]],
      // MAGENTA (right, attacks left ←) — exact mirror
      [['GK',.94,.50],['DF',.76,.68],['DF',.76,.32],['MF',.58,.50],['FW',.45,.50]],
    ];
    for (let team=0; team<2; team++){
      formations[team].forEach((f,i)=>{
        this.flies.push({
          id: team+'-'+i, team, num: i+1, role: f[0],
          x: f[1]*PITCH.w, y: f[2]*PITCH.h,
          vx:0, vy:0, heading: team===0?0:Math.PI,
          r: 13, speed: f[0]==='FW'?3.4:f[0]==='GK'?2.8:3.0,
          brain: new FlyBrain(),
          kickCharge: 0, kickFlash: 0, stamina: 1,
          name: (team===0?'VOLT':'MAGENTA')+' #'+(i+1),
        });
      });
    }
    this.log('KICK OFF — connectome football', null, true);
  },

  /* ---------- possession ---------- */
  possess(fly){
    this.possession = fly;
    this.userTeam = fly.team;
    fly.brain.pulse('CX_EB', 1);  // you hijack the central complex
    this.log(`YOU possess ${fly.name}`, fly.team, true);
  },
  release(){
    if (this.possession) this.log(`released ${this.possession.name}`, this.possession.team, true);
    this.possession = null;
  },

  /* ---------- per-fly AI (brain-driven) ---------- */
  thinkAI(f, dt){
    const B=f.brain, ball=this.ball;

    // ---- team awareness: who's nearest to the ball? ----
    let mates = this.flies.filter(o=>o.team===f.team && o.role!=='GK');
    mates.sort((a,b)=>Math.hypot(ball.x-a.x,ball.y-a.y)-Math.hypot(ball.x-b.x,ball.y-b.y));
    const rank = mates.indexOf(f);              // 0 = closest

    let tx, ty;
    const attacking = f.team===0 ? ball.x < PITCH.w*.62 : ball.x > PITCH.w*.38;

    if (f.role==='GK'){
      tx = f.team===0 ? 26 : PITCH.w-26;
      ty = PITCH.h/2 + Math.max(-GOAL.h*.45, Math.min(GOAL.h*.45, ball.y - PITCH.h/2));
    } else if (rank===0){
      // closest fly: chase the ball itself
      tx = ball.x; ty = ball.y;
    } else if (rank===1){
      // second fly: support slightly behind the ball toward own goal
      const backX = f.team===0 ? -34 : 34;
      tx = ball.x + backX; ty = ball.y + (f.num%2 ? -46 : 46);
    } else {
      // everyone else: hold a formation lane, shifting with the ball
      const lanes = [.24,.42,.62,.80];          // x-fractions for DF/MF/FW depth
      const depth = f.role==='DF' ? lanes[attacking?1:0] : f.role==='MF' ? lanes[attacking?2:1] : lanes[attacking?3:2];
      const homeX = f.team===0 ? depth : 1-depth;
      const laneY = f.num===1 ? .28 : f.num===2 ? .72 : .5;
      // lane follows ball laterally so wingers react to play side
      const ballBias = (ball.y/PITCH.h - .5)*.5;
      tx = homeX*PITCH.w;
      ty = (laneY + ballBias*(f.role==='DF'?.4:.7)) * PITCH.h;
    }

    // steer
    const dx = tx-f.x, dy = ty-f.y, d = Math.hypot(dx,dy)||1;
    const urgency = Math.min(1, d/120);
    f.vx += (dx/d)*f.speed*urgency*dt*.25;
    f.vy += (dy/d)*f.speed*urgency*dt*.25;
    f.heading = Math.atan2(f.vy, f.vx);

    // sensory firing: see the ball when near, touch when colliding
    const bd = Math.hypot(ball.x-f.x, ball.y-f.y);
    if (bd < 160) B.sense('see', .5*(1-bd/160)+.3);
    if (bd < 26)  B.sense('touch', .8);

    // GK interception: if the ball is incoming and close, dive at it
    if (f.role==='GK'){
      const bd2=Math.hypot(ball.x-f.x, ball.y-f.y);
      const incoming = f.team===0 ? ball.vx<-0.6 : ball.vx>0.6;
      if (bd2<70 && incoming){
        tx = ball.x; ty = ball.y;  // dive!
      }
    }

    // kicking decision: close to ball → shoot toward goal (with aim jitter)
    if (bd < 26){
      const gx = f.team===0 ? PITCH.w+10 : -10;
      const gy = PITCH.h/2 + (Math.random()-.5)*110;   // shots aim within goal mouth ± jitter
      const a = Math.atan2(gy-ball.y, gx-ball.x);
      const power = 4.2 + Math.random()*.8;
      ball.vx += Math.cos(a)*power; ball.vy += Math.sin(a)*power;
      ball.lastTouch = f;
      B.sense('kick', 1);
      f.kickFlash = 1;
      this.log(`${f.name} kicks`, f.team);
      AUDIO.kick();
    }
    // occasionally "learn" (MB flash) after play
    if (Math.random()<.002) B.sense('learn', .6);
  },

  /* ---------- user control of possessed fly ---------- */
  applyUser(input, dt){
    const f = this.possession; if(!f) return;
    const acc = 0.55*dt;
    if (input.up)    f.vy -= acc;
    if (input.down)  f.vy += acc;
    if (input.left)  f.vx -= acc;
    if (input.right) f.vx += acc;
    if (input.up||input.down||input.left||input.right){
      f.heading = Math.atan2(f.vy, f.vx);
      f.brain.pulse('DN', .8);  // manual motor drive lights the command channel
    }
    // kick charge
    if (input.kick){
      f.kickCharge = Math.min(1.6, f.kickCharge + dt/650);
    }
    if (input.kickRelease && f.kickCharge>0){
      const ball = this.ball;
      const bd = Math.hypot(ball.x-f.x, ball.y-f.y);
      if (bd < 42){
        const power = 2.6 + f.kickCharge*4.4;
        const a = f.heading;
        ball.vx += Math.cos(a)*power; ball.vy += Math.sin(a)*power;
        ball.lastTouch = f;
        f.brain.sense('kick', 1);
        f.kickFlash = 1;
        this.log(`YOU kick (${Math.round(f.kickCharge*100)}% charge)`, f.team, true);
        AUDIO.kick(f.kickCharge);
      } else {
        this.log('swing — missed the ball', f.team, true);
      }
      f.kickCharge = 0;
    }
    f.brain.sense('see', .4); // possessed fly still sees
  },

  /* ---------- physics + rules ---------- */
  step(dt=16, input=null){
    if (this._frozen) return;    // audit/testing freeze hook
    if (this.state==='play' || this.state==='kickoff'){
      const sdt = dt/1000;
      this.t += sdt;

      if (this.state==='kickoff' && this.t>0.6) this.state='play';

      // fly brains + AI (skip possessed)
      this.flies.forEach(f=>{
        if (f===this.possession) this.applyUser(input, dt);
        else this.thinkAI(f, dt);
        f.brain.step(dt);
        f.kickFlash = Math.max(0, f.kickFlash - dt/300);
        // integrate
        const drag = Math.pow(.86, dt/16);
        f.vx*=drag; f.vy*=drag;
        const sp = Math.hypot(f.vx,f.vy), max = 3.8;
        if (sp>max){ f.vx=f.vx/sp*max; f.vy=f.vy/sp*max; }
        f.x += f.vx*dt/16; f.y += f.vy*dt/16;
        // bounds
        f.x = Math.max(12, Math.min(PITCH.w-12, f.x));
        f.y = Math.max(12, Math.min(PITCH.h-12, f.y));
      });

      // fly-fly soft separation
      for (let i=0;i<this.flies.length;i++) for (let j=i+1;j<this.flies.length;j++){
        const a=this.flies[i], b=this.flies[j];
        const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy);
        if (d < 24 && d>0){
          const push=(24-d)/24*.35;
          a.x-=dx/d*push; a.y-=dy/d*push; b.x+=dx/d*push; b.y+=dy/d*push;
        }
      }

      // ball physics + speed cap (no pinball)
      const ball=this.ball;
      ball.x += ball.vx*dt/16; ball.y += ball.vy*dt/16;
      const bdrag = Math.pow(.994, dt/16);
      ball.vx*=bdrag; ball.vy*=bdrag;
      const bs=Math.hypot(ball.vx,ball.vy), maxB=9;
      if(bs>maxB){ ball.vx=ball.vx/bs*maxB; ball.vy=ball.vy/bs*maxB; }
      ball.spin += ball.vx*.06;
      ball.trail.push({x:ball.x, y:ball.y, a:1});
      if (ball.trail.length>26) ball.trail.shift();
      ball.trail.forEach(p=>p.a*=.94);
      // walls (top/bottom)
      if (ball.y < 8 || ball.y > PITCH.h-8){ ball.vy*=-.72; ball.y=Math.max(8,Math.min(PITCH.h-8,ball.y)); AUDIO.wall(); }
      // end lines: only the goal mouth scores, everything else is boards
      const inMouth = Math.abs(ball.y-PITCH.h/2) < GOAL.h/2;
      if (inMouth && (ball.x < ball.r || ball.x > PITCH.w-ball.r)){
        this.goalScored(ball.x < PITCH.w/2 ? 1 : 0, ball.lastTouch); return;
      }
      if (ball.x < ball.r){ ball.vx = Math.abs(ball.vx)*.72; ball.x = ball.r; AUDIO.wall(); }
      else if (ball.x > PITCH.w-ball.r){ ball.vx = -Math.abs(ball.vx)*.72; ball.x = PITCH.w-ball.r; AUDIO.wall(); }
      // ball vs flies: gentle bounce off bodies; while the possessed fly
      // holds kick-charge it TRAPS the ball (dribbling) instead of shoving it
      this.flies.forEach(f=>{
        const dx=ball.x-f.x, dy=ball.y-f.y, d=Math.hypot(dx,dy);
        if (d < f.r+ball.r && d>0){
          const holding = f===this.possession && input && input.kick && !input.kickRelease;
          if (holding){
            // keep ball glued just ahead of the fly
            const a=f.heading;
            ball.x = f.x + Math.cos(a)*(f.r+ball.r+2);
            ball.y = f.y + Math.sin(a)*(f.r+ball.r+2);
            ball.vx=f.vx; ball.vy=f.vy;
          } else {
            const push=1.4;
            ball.vx += dx/d*push*.4; ball.vy += dy/d*push*.4;
            ball.x = f.x + dx/d*(f.r+ball.r+1);
            f.brain.sense('touch', .6);
          }
        }
      });

      // match clock
      if (this.t >= MATCH_TIME){ this.state='end'; AUDIO.whistle(3); this.log('FULL TIME', null, true); }
    }
  },

  goalScored(team, scorer){
    // team 0 = VOLT scored (ball went right), team 1 = MAGENTA
    this.score[team]++;
    this.state='goal'; this.goalCooldown=0;
    this.savedT = this.t;                       // preserve match clock
    const scorerName = scorer ? scorer.name : (team===0?'VOLT':'MAGENTA');
    this.log(`GOAL! ${team===0?'VOLT':'MAGENTA'} — scored by ${scorerName}`, team, true);
    this.goalInfo = { team, scorer: scorerName };
    AUDIO.goal();
    if (typeof Render!=='undefined' && Render.shake) Render.shake(18);
    setTimeout(()=>{ if(this.state==='goal'){ this.kickoff(); } }, 2200);
  },

  kickoff(){
    const clock = this.savedT || 0;   // keep match time across goals
    const score = this.score;
    const possession = this.possession;
    this.reset();
    this.score = score;
    this.possession = possession;      // you stay in your fly after a goal
    this.t = clock;
    this.state='play';
  },
};
window.Engine = Engine;
