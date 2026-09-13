// FLYKICK browser audit — play the game via CDP: start match, verify pixels,
// possess a fly by clicking, drive with keys, charge-kick, score, screenshots.
const http=require('http');
const fs=require('fs');
const path=require('path');
const ROOT=path.join(__dirname,'..');
const WS=require('ws');
const SHOTS=path.join(ROOT,'..','temp','shots-flykick'); fs.mkdirSync(SHOTS,{recursive:true});

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=http.createServer((req,res)=>{
  const p=path.join(ROOT, req.url==='/'?'index.html':req.url.split('?')[0]);
  fs.readFile(p,(e,d)=>{e?(res.writeHead(404),res.end()):(res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'text/plain'}),res.end(d));});
});
const getJSON=u=>new Promise((res,rej)=>{http.get(u,r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>res(JSON.parse(b)));}).on('error',rej);});

(async()=>{
  await new Promise(r=>server.listen(8130,r));
  const targets=await getJSON('http://localhost:9222/json');
  const ws=new WS(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  let id=0;const p=new Map();const handlers=[];
  const send=(m,pa={})=>new Promise((res,rej)=>{const i=++id;p.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:pa}));});
  ws.on('message',m=>{const msg=JSON.parse(m);
    if(msg.id&&p.has(msg.id)){const h=p.get(msg.id);p.delete(msg.id);msg.error?h.rej(new Error(msg.error.message)):h.res(msg.result);}
    else if(msg.method)handlers.forEach(h=>h(msg));});
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable');await send('Page.enable');
  const errors=[];
  handlers.push(msg=>{
    if(msg.method==='Runtime.exceptionThrown'){const d=msg.params.exceptionDetails;errors.push('[EXC] '+d.text+' '+(d.exception?.description||''));}
    if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='error'){errors.push('[err] '+msg.params.args.map(a=>a.value||'').join(' '));}
  });
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const click=async(x,y)=>{for(const t of['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type:t,x,y,button:'left',clickCount:1});};
  const key=async(code,type='keyDown')=>{
    // CDP needs real key chars + virtual key codes for the page to see them
    const keyChar = code==='Space' ? ' ' : code.replace('Key','');
    const vk = code==='Space' ? 32 : code.replace('Key','').charCodeAt(0);
    await send('Input.dispatchKeyEvent',{type,key:keyChar,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});
  };
  const shot=async n=>{const{data}=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(SHOTS,n+'.png'),Buffer.from(data,'base64'));console.log('  📸',n);};
  let pass=0,fail=0;const ok=(c,m)=>{c?pass++:fail++;console.log(`  ${c?'✅':'❌'} ${m}`);};

  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  // hard-fresh navigation (not reload) — avoids stale state from prior audit rounds
  await send('Page.navigate',{url:'about:blank'});
  await sleep(400);
  await send('Page.navigate',{url:'http://localhost:8130/'});
  await sleep(3000);
  const bootOk=await ev(`typeof Engine!=='undefined'`);
  if(!bootOk) throw new Error('page did not boot Engine — check console');

  const pixelAudit=async(region)=>{
    return await ev(`(()=>{
      const c=document.getElementById('pitch');
      const x=c.getContext('2d');
      const r=${JSON.stringify(region)};
      const d=x.getImageData(r.x,r.y,r.w,r.h).data;
      let lit=0, colorful=0;
      for(let i=0;i<d.length;i+=4){
        const R=d[i],G=d[i+1],B=d[i+2];
        if(R>22||G>22||B>22) lit++;
        if(Math.abs(R-G)>45||Math.abs(G-B)>45) colorful++;
      }
      return {lit,colorful,total:d.length/4};
    })()`);
  };

  console.log('=== BOOT ===');
  ok(await ev(`typeof Engine!=='undefined'&&Engine.flies.length===10`),'engine booted, 10 flies');
  ok(await ev(`document.getElementById('ov-menu')&&!document.getElementById('ov-menu').classList.contains('hidden')`),'menu shows');
  const pitchPix=await pixelAudit({x:200,y:100,w:1000,h:500});
  ok(pitchPix.lit>3000,`pitch drawn (${pitchPix.lit} lit px — markings, flies, ball)`);

  console.log('=== MENU → KICK OFF ===');
  await ev(`window.scrollTo(0,0)`);
  const btn=await ev(`(()=>{window.scrollTo(0,0);const b=document.getElementById('btn-start');const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:btn.x,y:btn.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:btn.x,y:btn.y,button:'left',clickCount:1});
  await sleep(1500);
  // verify we did NOT navigate away
  const url=await ev(`location.href`);
  if(!url.includes('8130')) throw new Error('page navigated away! at '+url);
  ok(await ev(`Engine.state==='play'||Engine.state==='kickoff'`),'match started');
  await sleep(4000);
  await shot('01-match-playing');

  // AI plays meanwhile — ball must have moved from centre at some point
  const ballMoved=await ev(`Engine.ball.trail.length>3 || Math.hypot(Engine.ball.x-PITCH.w/2,Engine.ball.y-PITCH.h/2)>10`);
  ok(ballMoved,'AI flies are playing (ball moving)');

  console.log('=== POSSESS (click a VOLT fly) ===');
  // freeze play for a deterministic click, then unfreeze
  await ev(`Engine._frozen=true`);
  const fpos=await ev(`(()=>{
    const f=Engine.flies.find(f=>f.team===0&&f.role==='FW');
    const c=document.getElementById('pitch');
    const r=c.getBoundingClientRect();
    return {x:Math.round(r.left+Render.wx(f.x)), y:Math.round(r.top+Render.wy(f.y)), name:f.name, flyx:f.x, flyy:f.y};
  })()`);
  console.log(`  clicking ${fpos.name} at screen (${fpos.x},${fpos.y}), fly world (${fpos.flyx},${fpos.flyy})`);
  await click(fpos.x,fpos.y);
  await sleep(600);
  const gotIt=await ev(`Engine.possession && Engine.possession.name==='${fpos.name}'`);
  ok(gotIt,`possessed ${fpos.name} by click`);
  if(!gotIt){
    // fallback: possess programmatically to continue the audit
    await ev(`Engine.possess(Engine.flies.find(f=>f.name==='${fpos.name}'))`);
    console.log('  (click missed — possessed programmatically to continue)');
  }
  ok(await ev(`!document.getElementById('possess-banner').classList.contains('hidden')`),'possession banner visible');
  await ev(`Engine._frozen=false`);
  await shot('02-possessed');

  console.log('=== DRIVE (WASD) ===');
  const y0=await ev(`Engine.possession.y`);
  for(let i=0;i<12;i++){ await key('KeyW'); await sleep(50); }
  for(let i=0;i<12;i++){ await key('KeyW','keyUp'); await sleep(30); }
  await sleep(600);
  const y1=await ev(`Engine.possession.y`);
  ok(y1<y0-6,`fly drove UP with W (dy=${(y1-y0).toFixed(0)})`);

  console.log('=== CHARGE KICK ===');
  // isolate: stub AI thinkers so the charge/release kick is deterministic
  await ev(`Engine._origThink = Engine.thinkAI; Engine.thinkAI = ()=>{};`);
  await ev(`(()=>{const f=Engine.possession;f.x=480;f.y=320;f.vx=0;f.vy=0;f.heading=0;f.kickCharge=0;Engine.ball.x=f.x+18;Engine.ball.y=f.y;Engine.ball.vx=0;Engine.ball.vy=0;})()`);
  await key('Space');
  await sleep(900); // charge
  const charge=await ev(`Engine.possession.kickCharge`);
  await key('Space','keyUp');
  await sleep(400);
  const bvx=await ev(`Engine.ball.vx`);
  await ev(`Engine.thinkAI = Engine._origThink;`);
  ok(charge>0.3,`kick charged while holding Space (${(charge/1.6*100).toFixed(0)}%)`);
  ok(bvx>2,`release kicked the ball (vx=${bvx.toFixed(1)})`);

  console.log('=== RELEASE (Q) ===');
  await key('KeyQ');
  await sleep(300);
  ok(await ev(`Engine.possession===null`),'Q released possession');

  console.log('=== SWITCH TEAM (possess MAGENTA) ===');
  await ev(`Engine._frozen=true`);
  const mpos=await ev(`(()=>{const f=Engine.flies.find(f=>f.team===1&&f.role==='FW');const c=document.getElementById('pitch');const r=c.getBoundingClientRect();return {x:r.left+Render.wx(f.x), y:r.top+Render.wy(f.y), name:f.name};})()`);
  await click(mpos.x,mpos.y);
  await sleep(500);
  ok(await ev(`Engine.possession && Engine.possession.team===1`),'switched to MAGENTA fly — either team works');
  await ev(`Engine._frozen=false`);
  await key('KeyQ'); await sleep(200);

  console.log('=== BRAIN CAM ===');
  ok(await ev(`BrainCam.visible && document.getElementById('cam-subject').textContent.length>0`),'brain cam live');
  const camPix=await pixelAudit.call?null:null;
  const camLit=await ev(`(()=>{const c=document.getElementById('cam');const x=c.getContext('2d');const d=x.getImageData(0,0,c.width,c.height).data;let lit=0;for(let i=0;i<d.length;i+=4){if(d[i]>20||d[i+1]>20||d[i+2]>20)lit++;}return lit;})()`);
  ok(camLit>200,`brain cam drawing neurons (${camLit} lit px)`);

  // let a goal happen naturally or force one to see the goal overlay
  console.log('=== GOAL OVERLAY (forced) ===');
  await ev(`Engine.ball.x=PITCH.w-5;Engine.ball.y=PITCH.h/2;Engine.ball.vx=8;Engine.ball.lastTouch=Engine.flies.find(f=>f.team===0)`);
  await sleep(300);
  const scoreAfter=await ev(`Engine.score[0]`);
  ok(scoreAfter>=1,`goal registered (VOLT ${scoreAfter})`);
  await sleep(300);
  await shot('03-goal-overlay');
  await sleep(2400); // wait kickoff

  console.log('=== FULL TIME ===');
  await ev(`Engine.t=119.5`); await sleep(2500);
  const endShown=await ev(`!document.getElementById('ov-end').classList.contains('hidden')`);
  ok(endShown,'full-time overlay shows');
  await shot('04-full-time');
  const again=await ev(`(()=>{const b=document.getElementById('btn-again');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await click(again.x,again.y);
  await sleep(800);
  ok(await ev(`Engine.state==='play'&&Engine.t<2`),'rematch works');

  console.log('\n=== CONSOLE ERRORS ===');
  console.log(errors.length?errors.join('\n'):'(none)');
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  server.close();process.exit(fail||errors.length?1:0);
})().catch(e=>{console.error('AUDIT FAILED:',e.message);process.exit(1);});
