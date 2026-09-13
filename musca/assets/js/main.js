/* ==========================================================================
   main.js — MUSCA
   ========================================================================== */

import { loadAll, labelOf, membersOfLabel, searchLabels } from './data.js';
import { cascade, strongestPath, motorMask } from './graph.js';
import { Brain } from './scene.js';
import * as UI from './ui.js';
import { $, $$, esc, fmt } from './ui.js';

const SENSORY = new Set(['ol_sensory', 'cb_sensory', 'vnc_sensory', 'sensory_ascending',
  'sensory_descending', 'cb_sensory_tbc', 'vnc_sensory_tbc']);

const state = {
  mode: 'atlas',
  sel: -1,
  res: null,
  blocked: null,
  cutLabels: new Set(),
  cutCount: 0,
  lastSeeds: [],
  lastReach: null,
  behaviours: [],
  activeBeh: null,
  colour: 'superclass',
  decay: 0.72,
  threshold: 0.05,
  speed: 4,
  tour: false,
};

let D, brain, motorSet, hoverTimer = 0, lastPick = -1, hist = null;

/* ------------------------------------------------------------------ boot -- */

const bootFill = $('#bootFill'), bootMsg = $('#bootMsg');
const setBoot = (p, m) => { bootFill.style.width = `${Math.round(p * 100)}%`; bootMsg.textContent = m; };

(async function start() {
  try {
    D = await loadAll(setBoot);
    setBoot(0.96, 'building the brain…');
    await new Promise((r) => setTimeout(r, 30));

    const canvas = document.createElement('canvas');
    canvas.id = 'gl';
    $('#app').prepend(canvas);
    brain = new Brain(canvas);
    brain.setData(D);
    motorSet = motorMask(D);

    $('#nSoma').textContent = fmt(D.n);
    $('#nSyn').textContent = fmt(D.sn);

    state.behaviours = await (await fetch('data/behaviours.json')).json();

    wireUI();
    UI.renderLegend(D, state.colour, onLegendPick);
    renderAction();
    updateHUD();

    setBoot(1, 'ready');
    setTimeout(() => { $('#boot').hidden = true; $('#app').hidden = false; brain.onResize(); }, 260);

    // handy for the browser console — and for the screenshot tooling
    window.MUSCA = {
      state, D, brain,
      ping: (i) => runCascade([i ?? randomSensory()]),
      behaviour: (id) => runBehaviour(id),
      mode: (m) => setMode(m),
      hash: applyHash,
      ready: true,
    };
    window.__muscaReady = true;
    applyHash();
  } catch (e) {
    console.error(e);
    $('#boot').hidden = true;
    $('#app').hidden = false;
    $('#err').hidden = false;
    $('#errMsg').textContent = (e && e.stack) || String(e);
  }
})();

/* ------------------------------------------------------------- selection -- */

function select(i, opts = {}) {
  state.sel = i;
  UI.renderNeuron(D, i, { hint: 'click another neuron to move on', onGoto: (j) => select(j, { fly: true }) });
  if (i >= 0) {
    const partners = [];
    for (let e = D.offsets[i]; e < D.offsets[i + 1]; e++) partners.push([D.dst[e], D.wgt[e]]);
    for (let e = D.inOff[i]; e < D.inOff[i + 1]; e++) partners.push([D.inSrc[e], D.inW[e]]);
    partners.sort((a, b) => b[1] - a[1]);
    const set = new Set([i]);
    for (const [j] of partners.slice(0, 220)) set.add(j);
    brain.setHighlight([...set]);
    if (opts.fly) brain.flyTo(i, 34);
  } else {
    brain.clearHighlight();
  }
  renderAction();
}

function onLegendPick(key, node) {
  node.classList.toggle('is-off');
  const off = node.classList.contains('is-off');
  // dimming a whole class: recolour those neurons to near-black
  const field = { superclass: D.sup, nt: D.nt, side: D.side, dimorphism: D.dim }[state.colour];
  if (!state._dim) state._dim = new Set();
  const tag = `${state.colour}:${key}`;
  if (off) state._dim.add(tag); else state._dim.delete(tag);
  recolor();
}

function recolor() {
  brain.setColorMode(state.colour);
  const col = brain.colAttr.array;
  if (state._dim && state._dim.size) {
    const field = { superclass: D.sup, nt: D.nt, side: D.side, dimorphism: D.dim }[state.colour];
    for (const tag of state._dim) {
      const [mode, k] = tag.split(':');
      if (mode !== state.colour) continue;
      const kk = +k;
      for (let i = 0; i < D.n; i++) if (field[i] === kk) {
        col[3 * i] *= 0.08; col[3 * i + 1] *= 0.08; col[3 * i + 2] *= 0.08;
      }
    }
  }
  // silenced cells go dark and red so a lesion is obvious on the brain itself
  if (state.blocked) {
    for (let i = 0; i < D.n; i++) {
      if (!state.blocked[i]) continue;
      col[3 * i] = 0.16; col[3 * i + 1] = 0.008; col[3 * i + 2] = 0.02;
    }
  }
  brain.colAttr.needsUpdate = true;
}

/* --------------------------------------------------------------- actions -- */

function seedsForPing() {
  if (state.sel >= 0) return [state.sel];
  return [randomSensory()];
}

/** A sensory cell that actually projects somewhere — otherwise a ping is a dud. */
function randomSensory() {
  const names = D.meta.superclasses;
  if (!state._sensoryPool) {
    const pool = [];
    for (let i = 0; i < D.n; i++) {
      if (!SENSORY.has(names[D.sup[i]])) continue;
      if (D.offsets[i + 1] - D.offsets[i] >= 4) pool.push(i);
    }
    state._sensoryPool = pool;
  }
  const pool = state._sensoryPool;
  return pool.length ? pool[(Math.random() * pool.length) | 0] : 0;
}

function runCascade(seeds, opts = {}) {
  const t0 = performance.now();
  const res = cascade(D, seeds, {
    decay: state.decay, threshold: state.threshold,
    blocked: state.blocked, motorSet, maxActive: 90000,
  });
  const ms = Math.round(performance.now() - t0);

  state.res = res;
  state.lastSeeds = seeds;
  hist = res.hopBuckets.map((b) => b.length);

  const reached = res.hopBuckets.reduce((a, b) => { let s = a; for (const i of b) if (motorSet[i]) s++; return s; }, 0);
  const totalMotor = motorSet.reduce((a, b) => a + b, 0);
  const reach = { hit: reached, total: totalMotor, frac: reached / totalMotor };

  // remember the pre-cut baseline so Lesion can show what a cut actually cost
  state.lastReach = reach;

  let out = 0;
  for (let i = 0; i < D.n; i++) if (motorSet[i]) out++;

  brain.playCascade(res, state.speed, { highlight: seeds });
  setEdgesUI(true);
  stopSpin();

  updateHUD({
    activated: res.order.length,
    hops: res.hops,
    motor: reached,
    motorTotal: totalMotor,
    ms,
  });
  UI.setHint(`signal from ${labelOf(D, seeds[0])} · ${res.order.length.toLocaleString('en-US')} neurons reached in ${res.hops} hops`);
  return { res, reach, seeds };
}

function updateHUD(extra) {  const base = [
    { label: 'neurons', value: fmt(D.n) },
    { label: 'synapses', value: fmt(D.meta.nSynapses) },
    { label: 'connections drawn', value: fmt(D.ne) },
    { label: 'cell types', value: fmt(D.labels.length) },
  ];
  if (extra) {
    return UI.setHUD([
      { label: 'neurons activated', value: fmt(extra.activated), cls: 'hi' },
      { label: 'hops', value: String(extra.hops), cls: 'hi' },
      { label: 'motor neurons reached', value: `${extra.motor} / ${extra.motorTotal}`, cls: 'mg' },
      { label: 'search time', value: extra.ms > 0 ? `${extra.ms} ms` : '<1 ms' },
    ]);
  }
  UI.setHUD(base);
}

/** Keep the "Active wiring" toggle honest about what is on screen. */
function setEdgesUI(on) {
  const box = $('#lyEdges');
  if (box) box.checked = on;
}

/** Stop the idle spin once there is something worth looking at. */
function stopSpin() {
  brain.setAutoRotate(false);
  const box = $('#lySpin');
  if (box) box.checked = false;
}

/* ----------------------------------------------------------- action panel -- */

function renderAction() {
  const el = $('#actionBody');
  const selLabel = state.sel >= 0 ? labelOf(D, state.sel) : null;
  const selCount = state.sel >= 0 ? 1 : 0;

  if (state.mode === 'atlas') {
    el.innerHTML = UI.actionAtlas({ sel: state.sel });
  } else if (state.mode === 'poke') {
    el.innerHTML = UI.actionPoke({
      sel: state.sel, selLabel, decay: state.decay, threshold: state.threshold, speed: state.speed,
    });
  } else if (state.mode === 'reverse') {
    el.innerHTML = UI.actionReverse({
      behaviours: state.behaviours, active: state.activeBeh ? state.activeBeh.id : null,
      pathHTML: state.pathHTML || '',
    });
  } else {
    el.innerHTML = UI.actionLesion({
      selLabel, selCount,
      cutCount: state.cutCount,
      lesionHTML: state.lesionHTML || '',
    });
  }
  bindActions();
}

function bindActions() {
  const on = (id, fn) => { const n = document.getElementById(id); if (n) n.onclick = fn; };

  on('aResetCam', () => brain.resetCamera());
  on('aPing', () => {
    const seeds = seedsForPing();
    if (seeds[0] == null || seeds[0] < 0) return UI.toast('pick a neuron first');
    runCascade(seeds);
  });
  on('aRandom', () => {
    const s = randomSensory();
    select(s, { fly: true });
    runCascade([s]);
  });

  const sd = document.getElementById('sDecay');
  if (sd) sd.oninput = () => { state.decay = +sd.value / 100; sd.nextElementSibling.textContent = state.decay.toFixed(2); };
  const st = document.getElementById('sThresh');
  if (st) st.oninput = () => { state.threshold = +st.value / 100; st.nextElementSibling.textContent = state.threshold.toFixed(3); };
  const ss = document.getElementById('sSpeed');
  if (ss) ss.oninput = () => { state.speed = +ss.value; ss.nextElementSibling.textContent = `${state.speed}×`; };

  $$('[data-bh]').forEach((n) => {
    n.onclick = () => runBehaviour(n.dataset.bh);
  });

  on('aCutOne', () => { if (state.sel >= 0) cutLabel(D.lab[state.sel]); });
  on('aCutRandom', () => cutLabel((Math.random() * D.labels.length) | 0));
  on('aHeal', () => {
    state.blocked = null; state.cutLabels.clear(); state.cutCount = 0;
    state.lesionHTML = '';
    recolor();
    UI.toast('all cells restored');
    renderAction();
  });
}

/* --------------------------------------------------------------- reverse -- */

function runBehaviour(id) {
  const beh = state.behaviours.find((b) => b.id === id);
  if (!beh) return;
  state.activeBeh = beh;

  const src = [], tgt = [];
  for (const nm of beh.sources) { const li = D.labelLookup.get(nm.toLowerCase()); if (li != null) src.push(...membersOfLabel(D, li)); }
  for (const nm of beh.targets) { const li = D.labelLookup.get(nm.toLowerCase()); if (li != null) tgt.push(...membersOfLabel(D, li)); }
  if (!src.length || !tgt.length) return UI.toast('no cells of that type');

  const path = strongestPath(D, src, new Set(tgt), { blocked: state.blocked });
  if (!path) { UI.toast('no anatomical route found'); return; }

  state.pathHTML = UI.renderPath({ chain: path.path.map((i) => labelOf(D, i)) }, -1);
  renderAction();
  setHash(`reverse/${beh.id}`);

  // animate the chain: reveal each step, then a slow pulse running down it
  const chain = path.path;
  let step = 0;
  brain.clearHighlight();
  brain.stopCascade();
  brain.playRoute(chain, 1.5);
  // pull back so the route glows inside the whole CNS rather than filling the frame
  brain.frameIndices(chain, 1.7, 2.6);
  setEdgesUI(true);
  stopSpin();
  UI.setHint(`${beh.name} — ${chain.length} neurons, sensory → motor`);

  // show the whole population of each cell type on the route, not just the one
  // neuron the search happened to pick
  const populations = chain.map((i) => {
    const li = D.lab[i];
    const mem = membersOfLabel(D, li);
    return mem.length && mem.length <= 900 ? [...mem] : [i];
  });

  const timer = setInterval(() => {
    step++;
    if (step > chain.length) { clearInterval(timer); return; }
    const n = document.getElementById('pathOut');
    if (n) n.innerHTML = UI.renderPath({ chain: chain.map((i) => labelOf(D, i)) }, step);
    brain.setHighlight(populations.slice(0, step + 1).flat());
    updateHUD({
      activated: chain.length, hops: chain.length,
      motor: step >= chain.length ? 1 : 0, motorTotal: 1, ms: 0,
    });
  }, 700);
  state._behTimer = timer;
}

/* ---------------------------------------------------------------- lesion -- */

function cutLabel(li) {
  if (state.cutLabels.has(li)) {
    UI.toast(`${D.labels[li]} is already cut`);
    renderAction();
    return;
  }
  if (!state.blocked) state.blocked = new Uint8Array(D.n);
  let added = 0;
  for (const i of membersOfLabel(D, li)) { if (!state.blocked[i]) { state.blocked[i] = 1; added++; } }
  state.cutLabels.add(li);
  state.cutCount += added;

  let html = `<div class="kv"><dt>cut</dt><dd>${esc(D.labels[li])}</dd><dt>cells silenced</dt><dd>${added}</dd></div>`;

  if (state.lastSeeds.length) {
    const beforeHit = state.lastReach ? state.lastReach.hit : null;
    const { reach } = runCascade(state.lastSeeds);
    const delta = beforeHit != null ? reach.hit - beforeHit : null;
    html += `<div class="kv" style="margin-top:8px">
      <dt>motor neurons reachable</dt><dd>${reach.hit} / ${reach.total}</dd>
      ${delta != null ? `<dt>change from before the cut</dt><dd style="color:${delta < 0 ? '#ff5a6a' : '#7dff9b'}">${delta > 0 ? '+' : ''}${delta}</dd>` : ''}
    </div>`;
    state.lastReach = reach;
  } else {
    html += `<p class="dim" style="margin-top:8px">Run a ping first, then cut — MUSCA will show you exactly what the cut cost.</p>`;
  }

  state.lesionHTML = html;
  recolor();
  UI.toast(`cut ${D.labels[li]} — ${added} cells silenced`);
  renderAction();
}

/* ------------------------------------------------------------------ wiring */

function wireUI() {
  $$('.mode').forEach((b) => {
    b.onclick = () => {
      $$('.mode').forEach((x) => x.classList.remove('is-on'));
      b.classList.add('is-on');
      state.mode = b.dataset.mode;
      if (state.mode !== 'reverse' && state._behTimer) clearInterval(state._behTimer);
      if (state.mode !== 'lesion') { /* keep the lesion state, just leave the panel */ }
      renderAction();
    };
  });

  $$('#colourBy button').forEach((b) => {
    b.onclick = () => {
      $$('#colourBy button').forEach((x) => x.classList.remove('is-on'));
      b.classList.add('is-on');
      state.colour = b.dataset.c;
      state._dim = new Set();
      recolor();
      UI.renderLegend(D, state.colour, onLegendPick);
    };
  });

  $('#lySoma').onchange = (e) => brain.setNeuronVisible(e.target.checked);
  $('#lySyn').onchange = (e) => brain.setSynapseVisible(e.target.checked);
  $('#lyEdges').onchange = (e) => { brain.edges.visible = e.target.checked && !!state.res; };
  $('#lySpin').onchange = (e) => brain.setAutoRotate(e.target.checked);
  brain.setAutoRotate(true);

  const search = $('#search');
  let searchTimer;
  search.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => UI.renderSearch(D, search.value), 90);
  };
  search.onblur = () => setTimeout(() => { $('#searchResults').hidden = true; }, 180);
  document.addEventListener('picktype', (e) => {
    const li = e.detail;
    const mem = membersOfLabel(D, li);
    if (!mem.length) return;
    // centre the camera on the type's centroid
    let cx = 0, cy = 0, cz = 0;
    for (const i of mem) { cx += D.pos[3 * i]; cy += D.pos[3 * i + 1]; cz += D.pos[3 * i + 2]; }
    cx /= mem.length; cy /= mem.length; cz /= mem.length;
    const w = [0, 0, 0];
    brain.toWorld(cx, cy, cz, w);
    brain.controls.target.set(w[0], w[1], w[2]);
    brain.camera.position.set(w[0] + brain.span * 0.4, w[1] + brain.span * 0.3, w[2] + brain.span * 0.55);
    brain.controls.update();
    select(mem[0]);
    brain.setHighlight([...mem].slice(0, 4000));
    UI.toast(`${D.labels[li]} — ${mem.length} neurons`);
    updateHUD();
    state.selLabel = D.labels[li];
    state.selCount = mem.length;
    if (state.mode === 'lesion') renderAction();
  });

  // picking
  const canvas = brain.canvas;
  canvas.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - hoverTimer < 60) return;
    hoverTimer = now;
    const i = brain.pick(e.clientX, e.clientY);
    lastPick = i;
    const tip = $('#tooltip');
    if (i >= 0) {
      const sup = D.meta.superclasses[D.sup[i]].replace(/_/g, ' ');
      tip.innerHTML = `<b>${esc(labelOf(D, i))}</b><span>${esc(sup)} · ${D.pre[i] + D.post[i]} synapses</span>`;
      tip.style.left = `${e.clientX + 14}px`;
      tip.style.top = `${e.clientY + 14}px`;
      tip.hidden = false;
      canvas.style.cursor = 'crosshair';
    } else {
      tip.hidden = true;
      canvas.style.cursor = 'grab';
    }
  });
  canvas.addEventListener('pointerleave', () => { $('#tooltip').hidden = true; });

  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY, performance.now()]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    const dt = performance.now() - downAt[2];
    downAt = null;
    if (moved > 6 || dt > 400) return;          // that was a drag, not a click
    const i = brain.pick(e.clientX, e.clientY);
    if (i >= 0) {
      select(i);
      if (state.mode === 'poke') {
        // poking a cell immediately fires it — the fastest path to the fun part
        runCascade([i]);
      }
    } else {
      select(-1);
    }
  });

  $('#btnAbout').onclick = () => { $('#about').hidden = false; };
  $('#aboutX').onclick = () => { $('#about').hidden = true; };
  $('#about').onclick = (e) => { if (e.target.id === 'about') $('#about').hidden = true; };

  $('#btnTour').onclick = () => runTour();

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('#about').hidden = true; $('#searchResults').hidden = true; }
    if (e.target && e.target.tagName === 'INPUT') return;
    // The ping buttons only exist in the Poke panel, so switch to that mode
    // first — otherwise `p` and `r` silently do nothing from Atlas or Reverse,
    // which is what the README promises they won't.
    const pokeThen = (id) => {
      if (state.mode !== 'poke') setMode('poke');
      document.getElementById(id)?.click();
    };
    if (e.key === 'p') pokeThen('aPing');
    if (e.key === 'r') pokeThen('aRandom');
    if (e.key === ' ') { e.preventDefault(); brain.resetCamera(); }
  });

  // timeline animation
  const tl = $('#timeline');
  (function tick() {
    requestAnimationFrame(tick);
    if (!hist) return;
    UI.drawTimeline(tl, hist, brain.anim ? brain.animT : null);
  })();
}

/* ------------------------------------------------------------------ tour -- */

async function runTour() {
  if (state.tour) { state.tour = false; $('#btnTour').classList.remove('is-on'); return; }
  state.tour = true;
  $('#btnTour').classList.add('is-on');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  brain.resetCamera();
  UI.toast('MUSCA · the complete male fly CNS', 2600);
  await wait(3200);

  // 1. ping a sensory cell
  setMode('poke');
  const s = randomSensory();
  select(s, { fly: true });
  await wait(1400);
  runCascade([s]);
  UI.toast('Poke — a spike spreads across real synapses');
  await wait(6500);

  // 2. reverse a behaviour
  setMode('reverse');
  const pick = ['escape-jump', 'sing-back', 'follow-an-odour', 'remember-an-odour']
    .filter((id) => state.behaviours.some((b) => b.id === id));
  const id = pick[(Math.random() * pick.length) | 0];
  runBehaviour(id);
  UI.toast('Reverse — name a behaviour, find the neurons');
  await wait(7000);

  // 3. lesion
  setMode('lesion');
  await wait(600);
  const sensoryLabels = [];
  for (let i = 0; i < D.labels.length; i++) {
    const c = D.lstart[i + 1] - D.lstart[i];
    if (c > 0 && D.meta.superclasses[D.sup[D.lmembers[D.lstart[i]]]] === 'ol_sensory') sensoryLabels.push(i);
  }
  if (sensoryLabels.length) {
    cutLabel(sensoryLabels[(Math.random() * sensoryLabels.length) | 0]);
    UI.toast('Lesion — cut the input, watch the reach collapse');
    await wait(6500);
  }

  setMode('atlas');
  state.tour = false;
  $('#btnTour').classList.remove('is-on');
  UI.toast('tour finished — go play', 2600);
}

function setMode(m) {
  state.mode = m;
  $$('.mode').forEach((x) => x.classList.toggle('is-on', x.dataset.mode === m));
  renderAction();
  setHash(m);
}

/* ------------------------------------------------------- deep links ---- */

/**
 * Write the URL fragment and remember it, so the `hashchange` it triggers
 * doesn't re-apply the action we just performed. Without this, a deep link
 * fires twice (once from the explicit call, once from the event) — which for
 * `#lesion/X` means the same cell type gets cut twice and the panel reports
 * "0 cells silenced" for a cut that plainly happened.
 */
let _appliedHash = null;
function setHash(m) {
  if (state._hashLock) return;
  _appliedHash = m;
  if (decodeURIComponent(location.hash.replace(/^#\/?/, '')).trim() !== m) location.hash = m;
}

/** #poke · #reverse/escape-jump · #lesion/ORN_DA1 · #colour/nt · #tour */
function applyHash() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, '')).trim();
  if (!h || h === _appliedHash) return;
  _appliedHash = h;
  const [kind, arg] = h.split('/');
  state._hashLock = true;
  try {
    if (['atlas', 'poke', 'reverse', 'lesion'].includes(kind)) setMode(kind);
    if (kind === 'poke') { const s = randomSensory(); select(s); runCascade([s]); }
    if (kind === 'reverse' && arg) runBehaviour(arg);
    if (kind === 'lesion' && arg) { const li = D.labelLookup.get(arg.toLowerCase()); if (li != null) cutLabel(li); }
    if (kind === 'colour' && arg) {
      state.colour = arg; state._dim = new Set();
      $$('#colourBy button').forEach((x) => x.classList.toggle('is-on', x.dataset.c === arg));
      recolor(); UI.renderLegend(D, state.colour, onLegendPick);
    }
    if (kind === 'tour') runTour();
  } finally {
    state._hashLock = false;
  }
}
addEventListener('hashchange', () => { if (!state._hashLock) applyHash(); });
window.__muscaHash = applyHash;

