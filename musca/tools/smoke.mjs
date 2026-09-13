/* MUSCA smoke test — loads the app in headless Chrome and asserts the things
   that are easy to break silently:

     1. the app boots with no uncaught exceptions
     2. every shipped behaviour resolves through the real reverse search
     3. a ping produces a sane, non-saturating cascade
     4. a lesion shows a real cost (cells silenced > 0, motor reach drops)
     5. a cascade after a route doesn't leave the edge layer in route mode

   Usage:  node tools/smoke.mjs <url>
   Exit code is non-zero if any assertion fails.
*/
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9360;
const URL_ = process.argv[2] || 'http://127.0.0.1:8000/';

const chrome = spawn(CHROME, [
  '--headless=new', '--enable-unsafe-swiftshader', '--no-sandbox',
  '--hide-scrollbars', '--mute-audio', '--window-size=1600,950',
  '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + join(tmpdir(), 'musca-smoke'),
  'about:blank',
], { stdio: 'ignore' });

const j = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
let ver = null;
for (let i = 0; i < 60; i++) { try { ver = await j('/json/version'); break; } catch { await sleep(400); } }
if (!ver) { chrome.kill(); throw new Error('chrome did not start'); }

const target = await j('/json/new?about:blank').catch(async () => (await fetch(
  `http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });

let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push(d.exception?.description || d.text);
  }
};
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
console.log('→ loading', URL_);
await send('Page.navigate', { url: URL_ });

let ready = false;
for (let i = 0; i < 160; i++) {
  await sleep(500);
  if (await evaluate('!!window.__muscaReady') === true) { ready = true; break; }
}
if (!ready) {
  const msg = await evaluate('document.getElementById("bootMsg")?.textContent');
  console.error(`✗ app never became ready (boot says: ${msg})`);
  ws.close(); chrome.kill(); process.exit(1);
}
await sleep(1200);
console.log('✓ app booted');

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

/* 1 — every behaviour resolves through the real search --------------------- */
const beh = await evaluate(`(async () => {
  const G = await import('./assets/js/graph.js');
  const { D, state } = window.MUSCA;
  return state.behaviours.map((b) => {
    const src = [], tgt = [];
    for (const nm of b.sources) { const li = D.labelLookup.get(nm.toLowerCase()); if (li != null) for (const x of D.lmembers.subarray(D.lstart[li], D.lstart[li+1])) src.push(x); }
    for (const nm of b.targets) { const li = D.labelLookup.get(nm.toLowerCase()); if (li != null) for (const x of D.lmembers.subarray(D.lstart[li], D.lstart[li+1])) tgt.push(x); }
    const p = G.strongestPath(D, src, new Set(tgt), { blocked: null });
    return { id: b.id, ok: !!p, hops: p ? p.path.length - 1 : null, chain: p ? p.path.map((i) => D.labels[D.lab[i]]) : null };
  });
})()`);
if (beh && beh.__err) { check('behaviours resolve', false, beh.__err); }
else {
  for (const b of beh) check(`behaviour ${b.id}`, b.ok, b.ok ? `${b.hops} hops · ${b.chain.join(' → ')}` : 'no route');
}

/* 2 — a ping is sparse and non-saturating --------------------------------- */
const ping = await evaluate(`(() => {
  const { D } = window.MUSCA;
  const li = D.labelLookup.get('orn_da1');
  const i = D.lmembers[D.lstart[li]];
  window.MUSCA.ping(i);
  const r = window.MUSCA.state.res;
  const motor = window.MUSCA.state.lastReach;
  return { label: D.labels[D.lab[i]], activated: r.order.length, hops: r.hops, hit: motor.hit, total: motor.total };
})()`);
if (ping && ping.__err) check('ping runs', false, ping.__err);
else {
  check('ping runs', ping.activated > 0, `${ping.label}: ${ping.activated} neurons, ${ping.hops} hops`);
  check('cascade is not saturating', ping.activated < 0.25 * 166700,
    `${ping.activated} / 166,700 neurons (${(100 * ping.activated / 166700).toFixed(1)}%)`);
  check('motor reach leaves headroom', ping.hit < ping.total,
    `${ping.hit} / ${ping.total} motor neurons`);
}

/* 3 — lesion shows a real cost ------------------------------------------- */
const lesion = await evaluate(`(() => {
  const { D } = window.MUSCA;
  location.hash = '#lesion/AL-AST1';
  window.MUSCA.hash();
  return { panel: document.getElementById('panel')?.innerText || document.body.innerText };
})()`);
await sleep(600);
const panel = await evaluate(`document.body.innerText`);
const silenced = /cells silenced\s*\n?\s*(\d+)/i.exec(panel || '');
const delta = /change from before the cut\s*\n?\s*(-?\d+)/i.exec(panel || '');
check('lesion reports cells silenced', !!silenced && +silenced[1] > 0, silenced ? `${silenced[1]} cells` : 'not found');
check('lesion reports a motor-neuron cost', !!delta && +delta[1] < 0, delta ? `${delta[1]} motor neurons` : 'not found');

/* 4 — a cascade after a route doesn't leave the edge layer in route mode --- */
const afterRoute = await evaluate(`(() => {
  location.hash = '#reverse/escape-jump';
  window.MUSCA.hash();
  const D = window.MUSCA.D;
  const li = D.labelLookup.get('orn_da1');
  window.MUSCA.ping(D.lmembers[D.lstart[li]]);
  return { isRoute: window.MUSCA.brain.isRoute, playing: window.MUSCA.brain.playing };
})()`);
check('cascade clears route mode', afterRoute && afterRoute.isRoute === false,
  afterRoute ? `isRoute=${afterRoute.isRoute}` : 'eval failed');

/* 5 — every documented deep link actually applies ------------------------- */
const DEEP_LINKS = [
  ['#atlas', 'atlas'],
  ['#poke', 'poke'],
  ['#reverse', 'reverse'],
  ['#lesion', 'lesion'],
  ['#reverse/escape-jump', 'reverse'],
  ['#reverse/remember-an-odour', 'reverse'],
  ['#lesion/AL-AST1', 'lesion'],
  ['#colour/nt', 'lesion'],
  ['#colour/class', 'lesion'],
  ['#colour/side', 'lesion'],
  ['#colour/dim', 'lesion'],
];
const linkResults = await evaluate(`(() => {
  const out = [];
  for (const h of ${JSON.stringify(DEEP_LINKS.map(([h]) => h))}) {
    try {
      location.hash = h;
      window.MUSCA.hash();
      out.push({ hash: h, mode: window.MUSCA.state.mode, colour: window.MUSCA.state.colour });
    } catch (e) { out.push({ hash: h, err: String(e && e.message || e) }); }
  }
  return out;
})()`);
if (linkResults && linkResults.__err) check('deep links apply', false, linkResults.__err);
else {
  const broken = linkResults.filter((r) => r.err);
  check('deep links apply without throwing', broken.length === 0,
    broken.length ? broken.map((b) => `${b.hash}: ${b.err}`).join(' | ') : `${linkResults.length} links`);
  const wrongMode = linkResults.filter((r, i) => !r.err && r.mode !== DEEP_LINKS[i][1]);
  check('deep links set the expected mode', wrongMode.length === 0,
    wrongMode.length ? wrongMode.map((r) => `${r.hash} → ${r.mode}`).join(' | ') : 'all match');
  const colourOk = linkResults.filter((r) => r.hash.startsWith('#colour/')).every((r) => r.colour === r.hash.slice(8));
  check('colour deep links set the colour key', colourOk);
}

/* 6 — documented keyboard shortcuts work, from any mode ------------------- */
const keys = await evaluate(`(() => {
  const fire = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const out = {};
  try {
    // start from Atlas, where the ping buttons do not exist
    location.hash = '#atlas'; window.MUSCA.hash();
    window.MUSCA.state.res = null;

    fire('p');
    out.afterP = { mode: window.MUSCA.state.mode, activated: window.MUSCA.state.res ? window.MUSCA.state.res.order.length : 0 };

    window.MUSCA.state.sel = -1;
    fire('r');
    out.afterR = { mode: window.MUSCA.state.mode, sel: window.MUSCA.state.sel };

    fire(' ');  // reset view
    out.space = true;

    document.getElementById('about').hidden = false;
    fire('Escape');
    out.escClosesAbout = document.getElementById('about').hidden === true;
  } catch (e) { out.err = String(e && e.message || e); }
  return out;
})()`);
if (keys && keys.err) check('keyboard shortcuts', false, keys.err);
else {
  check('`p` pings from any mode', keys.afterP.mode === 'poke' && keys.afterP.activated > 0,
    `mode=${keys.afterP.mode}, ${keys.afterP.activated} neurons`);
  check('`r` picks a random sensory cell', keys.afterR.sel >= 0, `sel=${keys.afterR.sel}`);
  check('`esc` closes dialogs', keys.escClosesAbout === true);
}

/* 7 — the guided tour starts and stops cleanly ---------------------------- */
const tour = await evaluate(`(() => {
  try { location.hash = '#tour'; window.MUSCA.hash(); } catch (e) { return { err: String(e && e.message || e) }; }
  return { started: window.MUSCA.state.tour === true, mode: window.MUSCA.state.mode };
})()`);
await sleep(4000);
const tourMid = await evaluate(`({ tour: window.MUSCA.state.tour, mode: window.MUSCA.state.mode })`);
check('guided tour starts', tour && tour.started === true, tour?.err || `mode ${tour?.mode}`);
check('guided tour is still running 4s in', tourMid && tourMid.tour === true,
  tourMid ? `mode ${tourMid.mode}` : 'eval failed');
// stop it so the remaining checks run on a quiet page
await evaluate(`(() => { window.MUSCA.state.tour = false; window.MUSCA.mode('atlas'); return 1; })()`);

/* 8 — framerate with the whole cloud on screen ---------------------------- */
// NB: headless uses SwiftShader (software WebGL), so this is a *lower bound*.
// A real GPU is substantially faster; if software rendering holds up, the
// "interactive" claim in the README is safe.
const fps = await evaluate(`(async () => {
  window.MUSCA.mode('atlas');
  const t = [];
  let last = performance.now();
  await new Promise((res) => {
    let n = 0;
    const tick = () => {
      const now = performance.now();
      t.push(now - last); last = now;
      if (++n < 120) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  t.sort((a, b) => a - b);
  const mean = t.reduce((a, b) => a + b, 0) / t.length;
  return { meanMs: +mean.toFixed(2), fps: +(1000 / mean).toFixed(1), p95Ms: +t[Math.floor(t.length * 0.95)].toFixed(2) };
})()`);
if (fps && fps.__err) check('renders at interactive framerate', false, fps.__err);
else {
  check('renders at interactive framerate (software WebGL, lower bound)',
    fps.fps >= 24, `${fps.fps} fps mean (${fps.meanMs} ms/frame, p95 ${fps.p95Ms} ms)`);
}

/* 9 — click-to-inspect via GPU picking ------------------------------------ */
// Project known neurons into screen space, then pick at those pixels. A neuron
// can be occluded by one in front of it, so an exact hit is a bonus; the real
// assertion is that picking lands on *a* valid neuron.
const pickRes = await evaluate(`(() => {
  const { brain } = window.MUSCA;
  window.MUSCA.mode('atlas');
  brain.resetCamera();
  const canvas = brain.canvas;
  const rect = canvas.getBoundingClientRect();
  const V = brain.camera.position.constructor;
  const samples = [];
  const n = brain.D.n;
  for (const idx of [0, 900, 5000, 40000, 90000, 130000, 160000, n - 1]) {
    const v = new V();
    brain.worldOf(idx, v);
    v.project(brain.camera);
    const cx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
    const cy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
    samples.push({ want: idx, cx, cy, got: brain.pick(cx, cy) });
  }
  const hit = samples.filter((s) => s.got >= 0);
  const exact = samples.filter((s) => s.got === s.want);

  // now the full click path: pointerdown + pointerup on a pixel known to hit
  const target = hit[Math.floor(hit.length / 2)];
  let selAfterClick = null;
  if (target) {
    const opts = { clientX: target.cx, clientY: target.cy, bubbles: true, pointerId: 1, isPrimary: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
    canvas.dispatchEvent(new PointerEvent('pointerup', opts));
    selAfterClick = window.MUSCA.state.sel;
  }
  return {
    total: samples.length, hit: hit.length, exact: exact.length,
    selAfterClick, canvasSize: [rect.width, rect.height],
  };
})()`);
if (pickRes && pickRes.__err) check('GPU picking', false, pickRes.__err);
else {
  check('GPU picking returns a neuron under the cursor', pickRes.hit >= pickRes.total - 1,
    `${pickRes.hit}/${pickRes.total} projected neurons picked, ${pickRes.exact} exact`);
  check('clicking a neuron selects it', pickRes.selAfterClick >= 0,
    `sel=${pickRes.selAfterClick} (canvas ${pickRes.canvasSize.join('×')})`);
}

/* 10 — no uncaught exceptions --------------------------------------------- */
check('no uncaught exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ all checks passed');
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
