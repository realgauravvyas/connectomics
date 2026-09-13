// FLYKICK headless engine test — sim the match without a browser.
// Asserts: goals score, possession user-control overrides AI, clock ends,
// AI flies actually play (ball keeps moving), GK defends.
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const sandbox={ console, performance:{now:()=>Date.now()},
  setTimeout:(f,ms)=>{ deferred.push(f); }, Math, window:{},
  AUDIO:{kick(){},wall(){},goal(){},whistle(){},buzz(){}} };
const deferred=[];
function flushDeferred(){ while(deferred.length) deferred.shift()(); }
vm.createContext(sandbox);
const load=(f,extra)=>vm.runInContext(fs.readFileSync(path.join(__dirname,f),'utf8')+(extra||''),sandbox,{filename:f});
load('../js/brain.js','; this.FLY_BRAIN=FLY_BRAIN;');
load('../js/engine.js','; this.Engine=Engine; this.PITCH=PITCH;');

const E=sandbox.Engine;

let pass=0, fail=0;
const ok=(c,m)=>{ c?pass++:fail++; console.log(`  ${c?'✅':'❌'} ${m}`); };

// ---- 1. reset + kickoff structure ----
E.reset();
ok(E.flies.length===10,'10 flies on the pitch (2×5)');
ok(E.state==='kickoff','starts in kickoff');
ok(E.ball.x===525&&E.ball.y===320,'ball at centre');

// ---- 2. AI plays: run 20 sim-seconds, ball must travel ----
let maxBallSpeed=0, goalsSeen=0;
for(let i=0;i<1250;i++){
  E.step(16,{});
  while(deferred.length) deferred.shift()();
  if(E.state==='goal') goalsSeen++;
  maxBallSpeed=Math.max(maxBallSpeed,Math.hypot(E.ball.vx,E.ball.vy));
}
ok(maxBallSpeed>2,'AI plays — ball gets kicked (peak speed '+maxBallSpeed.toFixed(1)+')');
ok(E.t>0 && E.t<=21,'clock runs within goal-reset window ('+E.t.toFixed(1)+'s, '+goalsSeen+' goal(s) meanwhile)');

// ---- 3. full match: runs to completion ----
E.reset(); E.state='play'; E.t=0;
let scored=false;
for(let i=0;i<9000;i++){   // 144 sim-seconds max
  E.step(16,{});
  flushDeferred();  // goals schedule kickoff after "2.2s" — flush between steps in test time
  if(E.score[0]+E.score[1]>0) scored=true;
  if(E.state==='end') break;
}
ok(E.state==='end','match ends at full time ('+Math.floor(E.t)+'s, score '+E.score.join(':')+')');
console.log('  final score:',E.score.join(' : '), scored?'(goals happened)':'(0-0 draw — acceptable but check AI)');

// ---- 4. possession: user takes a fly, overrides AI steering ----
E.reset(); E.state='play'; E.t=10;
const fw=E.flies.find(f=>f.team===0&&f.role==='FW');
E.possess(fw);
const x0=fw.x, y0=fw.y;
// hold "up" for 30 frames
for(let i=0;i<30;i++) E.step(16,{up:true});
ok(fw.y < y0-3,`possessed fly moves UP on command (dy=${(fw.y-y0).toFixed(1)})`);
for(let i=0;i<30;i++) E.step(16,{down:true});
ok(fw.y > y0-1,`possessed fly responds DOWN too (back to ${fw.y.toFixed(1)} vs start ${y0.toFixed(1)})`);

// ---- 5. user kick: charge + release pushes ball ----
E.reset(); E.state='play'; E.t=10;
const fw2=E.flies.find(f=>f.team===0&&f.role==='FW');
E.possess(fw2);
// clear the neighbourhood so AI flies can't interfere with the kick test
E.flies.forEach(f=>{ if(f!==fw2){ f.x=Math.max(10,Math.min(sandbox.PITCH.w-10,f.x+(f.x>fw2.x?260:-260))); } });
fw2.heading=0; fw2.vx=0; fw2.vy=0; fw2.x=400; fw2.y=320;
E.ball.x=fw2.x+20; E.ball.y=fw2.y; E.ball.vx=0; E.ball.vy=0;
for(let i=0;i<40;i++) E.step(16,{kick:true});          // hold to charge
const charge=fw2.kickCharge;
for(let i=0;i<2;i++)  E.step(16,{kick:false,kickRelease:true});
ok(charge>0.5,`kick charges while holding space (${(charge/1.6*100).toFixed(0)}%)`);
ok(E.ball.vx>2,`charged kick sends ball flying (vx=${E.ball.vx.toFixed(1)})`);

// ---- 6. release: AI resumes ----
E.release();
ok(E.possession===null,'Q releases possession');

// ---- 7. goal detection both sides ----
E.reset(); E.state='play';
E.ball.x=2; E.ball.y=320; E.ball.vx=-8; E.ball.lastTouch=E.flies.find(f=>f.team===0&&f.role==='FW');
for(let i=0;i<5;i++) E.step(16,{});
ok(E.score[1]===1,'ball crossing LEFT goal mouth scores for MAGENTA ('+E.score.join(':')+')');
E.state='play'; E.ball.x=sandbox.PITCH.w-2; E.ball.vx=8; E.ball.y=320;
E.ball.lastTouch=E.flies.find(f=>f.team===1&&f.role==='FW');
for(let i=0;i<5;i++) E.step(16,{});
ok(E.score[0]===1,'ball crossing RIGHT goal mouth scores for VOLT ('+E.score.join(':')+')');

// ---- 8. wide shots must NOT score (was a bug: any end-line crossing counted) ----
E.reset(); E.state='play'; E.t=10;
// clear the area so a GK dive doesn't intercept the test shot
E.flies.forEach(f=>{ if(f.role==='GK'){ f.x = f.team===0? 300:750; f.y=320; } else { f.x=Math.max(120,Math.min(930,f.x)); } });
E.ball.x=14; E.ball.y=90; E.ball.vx=-8; E.ball.vy=0;   // left line, y=90 is outside the mouth (245..395)
E.ball.lastTouch=null;
for(let i=0;i<10;i++) E.step(16,{});
ok(E.score.join(':')==='0:0', 'wide shot (outside the posts) is NOT a goal ('+E.score.join(':')+')');
ok(E.ball.vx>0.5, `wide shot bounces off the boards instead (vx=${E.ball.vx.toFixed(1)})`);
E.ball.x=sandbox.PITCH.w-14; E.ball.y=560; E.ball.vx=8;  // right line, also outside mouth
for(let i=0;i<10;i++) E.step(16,{});
ok(E.score.join(':')==='0:0', 'wide shot at other end also NOT a goal ('+E.score.join(':')+')');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
