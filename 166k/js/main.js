/**
 * main.js — the application: grow a brain, run it, poke it, watch it learn.
 *
 * The loop is budgeted rather than free-running: each animation frame we
 * advance the simulation by however many milliseconds actually elapsed,
 * capped so a slow frame can never queue up a mountain of catch-up work.
 * One simulated millisecond per real millisecond is real time.
 */

import { buildConnectome } from './connectome.js';
import { Simulation } from './sim.js';
import { Renderer } from './render.js';

const $ = (id) => document.getElementById(id);

const state = {
  conn: null, sim: null, renderer: null,
  running: true,
  speed: 1,
  stepsPerFrame: 0,
  lastFrame: 0,
  simTime: 0,
  selected: -1,
  fps: 0,
  slowWarned: false,
  history: [],          // rolling {t, approach, avoid, da}
  trialLog: [],
  autoTrain: null,
  // Ring buffer of recent spikes, used to draw the synapses that fired.
  spikeRing: { ids: new Int32Array(4096), t: new Int32Array(4096), w: 0, cap: 4096 },
  memoryIndex: null,    // last measured approach/avoid bias shift
  measure: null,
  plasticity: { pct: 0, mean: 0 },
  lesions: new Map(),      // region index -> Float32Array of the weights we zeroed
  hoverAt: 0,
};

/**
 * Lesion a region: silence everything it projects to, but leave its own
 * spiking intact. This is the classic ablation experiment — knock out the
 * mushroom body and the fly can still smell, it just cannot remember.
 * Reversible, because the original weights are kept.
 */
function toggleLesion(i) {
  const c = state.conn, sim = state.sim;
  const r = c.regions[i];
  if (!r) return;

  if (state.lesions.has(i)) {
    const backup = state.lesions.get(i);
    let k = 0;
    for (let n = r.start; n < r.start + r.count; n++) {
      for (let e = c.outOffset[n]; e < c.outOffset[n + 1]; e++) c.outWeight[e] = backup[k++];
    }
    state.lesions.delete(i);
    sim.setLesioned(r.start, r.count, false);
    state.renderer.setRegionMuted(i, false);
    log(`${r.uid} restored`);
  } else {
    const total = c.outOffset[r.start + r.count] - c.outOffset[r.start];
    const backup = new Float32Array(total);
    let k = 0;
    for (let n = r.start; n < r.start + r.count; n++) {
      for (let e = c.outOffset[n]; e < c.outOffset[n + 1]; e++) {
        backup[k++] = c.outWeight[e];
        c.outWeight[e] = 0;
      }
    }
    state.lesions.set(i, backup);
    sim.setLesioned(r.start, r.count, true);
    state.renderer.setRegionMuted(i, true);
    log(`${r.uid} lesioned — ${total.toLocaleString()} synapses silenced`);
  }
  syncRegionRows();
}

function restoreAll() {
  for (const i of [...state.lesions.keys()]) toggleLesion(i);
}

function syncRegionRows() {
  const host = $('region-rates');
  if (!host.dataset.built) return;
  for (const el of host.children) {
    const i = Number(el.dataset.i);
    if (Number.isNaN(i)) continue;
    el.classList.toggle('lesioned', state.lesions.has(i));
  }
}

/** Copy this step's spikes into the ring so the renderer can draw them. */
function recordSpikes(sim) {
  const ring = state.spikeRing;
  const n = Math.min(sim.firedCount, 256);
  const f = sim.fired;
  for (let k = 0; k < n; k++) {
    ring.ids[ring.w] = f[k];
    ring.t[ring.w] = state.simTime;
    ring.w = (ring.w + 1) % ring.cap;
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  const overlay = $('overlay');
  const status = $('overlay-status');
  const bar = $('overlay-bar');

  const setStatus = (txt, pct) => {
    status.textContent = txt;
    if (pct != null) bar.style.width = (pct * 100).toFixed(0) + '%';
    // let the browser paint the progress bar before we block the thread
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  const neurons = Number(new URLSearchParams(location.search).get('n') || 166000);
  const initStim = new URLSearchParams(location.search).get('stim');

  await setStatus('growing ' + neurons.toLocaleString() + ' neurons…', 0.05);
  const t0 = performance.now();
  const conn = buildConnectome({ neurons, synapsesPerNeuron: 14 });
  const growMs = performance.now() - t0;
  state.conn = conn;

  await setStatus('wiring ' + conn.E.toLocaleString() + ' synapses…', 0.6);
  const sim = new Simulation(conn);
  state.sim = sim;

  await setStatus('lighting up…', 0.85);
  const renderer = new Renderer($('gl'));
  renderer.setConnectome(conn);
  state.renderer = renderer;
  renderer.onPick = (e) => select(e.clientX, e.clientY);

  buildRegionPanel();
  buildStimButtons();
  wireControls();

  $('meta-scale').textContent =
    `1:${Math.round(conn.meta.sampling)} sample · ${conn.E.toLocaleString()} synapses · grown in ${growMs.toFixed(0)} ms`;

  // optional ?stim=odorA kicks the brain off so a shared link starts busy
  if (initStim && conn.ensembles[initStim]) {
    sim.stimulate(conn.ensembles[initStim], 0.5, 100000);
    log(`stimulus: ${initStim}`);
  }

  overlay.classList.add('gone');
  setTimeout(() => { overlay.style.display = 'none'; }, 700);

  state.lastFrame = performance.now();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ loop
function frame(now) {
  const dtReal = Math.min(now - state.lastFrame, 100);
  state.lastFrame = now;
  state.fps = state.fps * 0.9 + (1000 / Math.max(1, dtReal)) * 0.1;

  const sim = state.sim, conn = state.conn;
  if (state.running) {
    // Advance in real time, clamped so we stay interactive.
    const budget = Math.min(dtReal * state.speed, 50);
    let steps = Math.round(budget);
    state.stepsPerFrame = steps;
    for (let s = 0; s < steps; s++) {
      sim.step();
      if ((s & 1) === 0) sim.plasticityStep();
      recordSpikes(sim);
    }
    state.simTime += steps;
    if (steps > 0) sim.updateRates(steps, steps);
    runAutoTrain(steps);
    runMeasure(steps);
  }

  state.renderer.updateGlow(sim.glow);
  const ring = state.spikeRing;
  state.renderer.buildWires(ring.ids, ring.t, ring.cap, state.simTime);
  state.renderer.draw(dtReal / 1000);

  updateHud();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------- HUD
let hudTick = 0;
function updateHud() {
  const sim = state.sim, conn = state.conn;
  if (++hudTick % 6 !== 0) return;   // 10 Hz is plenty for text

  const b = sim.readBehavior();
  const rates = sim.regionRate;
  let mean = 0;
  for (let i = 0; i < rates.length; i++) mean += rates[i];
  mean /= rates.length;

  $('stat-fps').textContent = state.fps.toFixed(0);
  $('stat-hz').textContent = mean.toFixed(2);
  $('stat-spikes').textContent = (sim.spikeRate / 1000).toFixed(1) + 'k/s';
  $('stat-t').textContent = (state.simTime / 1000).toFixed(1) + ' s';
  $('stat-da').textContent = sim.dopamine.toFixed(2);
  $('stat-da').className = 'val ' + (sim.dopamine > 0.15 ? 'warn' : (sim.dopamine < -0.15 ? 'good' : ''));

  bar('walk', b.walk); bar('turn', Math.abs(b.turn));
  bar('wing', b.wing); bar('prob', b.proboscis); bar('song', b.song);

  $('turn-dir').textContent = b.turn > 0.05 ? 'right' : (b.turn < -0.05 ? 'left' : '—');
  $('walk-state').textContent = b.walk > 0.25 ? 'walking' : 'standing';
  $('wing-state').textContent = b.wing > 0.3 ? (b.wingAsym > 0.35 ? 'unilateral song' : 'buzzing') : 'folded';
  $('jump-state').textContent = b.jump ? 'JUMP' : '';

  // valence: the thing that actually changes when the fly learns
  const ap = sim.approachRate, av = sim.avoidRate;
  const total = Math.max(1e-6, ap + av);
  $('valence-av').style.width = ((av / total) * 100).toFixed(1) + '%';
  $('valence-ap').style.width = ((ap / total) * 100).toFixed(1) + '%';
  $('valence-label').textContent =
    av > ap * 1.15 ? 'avoiding' : (ap > av * 1.15 ? 'approaching' : 'undecided');

  state.history.push({ t: state.simTime, ap, av, da: sim.dopamine });
  if (state.history.length > 600) state.history.shift();
  drawTrace();

  // How much of the mushroom body output has been rewritten.
  if (hudTick % 30 === 0) updatePlasticity();
  const pl = state.plasticity;
  $('plast-readout').innerHTML =
    `<b>${(pl.pct * 100).toFixed(1)}%</b> of KC→MBON synapses changed · mean Δ <b>${(pl.mean * 100).toFixed(1)}%</b>`;
  if (state.memoryIndex !== null) {
    const mi = state.memoryIndex;
    const cls = mi > 0.05 ? 'pos' : (mi < -0.05 ? 'neg' : '');
    const word = mi > 0.05 ? 'aversion' : (mi < -0.05 ? 'attraction' : 'no memory');
    $('memory-readout').innerHTML =
      `memory index <span class="${cls}">${mi >= 0 ? '+' : ''}${mi.toFixed(3)}</span> — ${word}`;
  }

  // If this machine cannot keep up at full scale, say so rather than
  // silently running at a third of real time. The thresholds are
  // deliberately generous — only kick in if the fps is genuinely stuck.
  if (!state.slowWarned && state.simTime > 8000 && state.fps < 20) {
    state.slowWarned = true;
    log(`running at ${state.fps.toFixed(0)} fps — try ?n=60000 for a lighter brain`);
  }

  // region rate bars
  const host = $('region-rates');
  if (!host.dataset.built) {
    host.innerHTML = conn.regions.map((r, i) => `
      <div class="rr" data-i="${i}">
        <span class="rr-name" style="color:${rgbFor(r.uid)}">${r.uid}</span>
        <span class="rr-bar"><i style="background:${rgbFor(r.uid)}"></i></span>
        <span class="rr-val">0.0</span>
        <button class="rr-x" data-i="${i}" title="lesion / restore">◌</button>
      </div>`).join('');
    host.dataset.built = '1';
    host.querySelectorAll('.rr').forEach((el) => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.i);
        state.renderer.highlight = state.renderer.highlight === i ? -1 : i;
        el.classList.toggle('on', state.renderer.highlight === i);
      });
    });
    host.querySelectorAll('.rr-x').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLesion(Number(btn.dataset.i));
      });
    });
  }
  const rows = host.children;
  for (let i = 0; i < rows.length; i++) {
    const hz = rates[i];
    rows[i].querySelector('i').style.width = Math.min(100, (hz / 25) * 100).toFixed(0) + '%';
    rows[i].querySelector('.rr-val').textContent = hz.toFixed(1);
  }
}

function bar(id, v) {
  const el = $('bar-' + id);
  if (el) el.style.width = Math.min(100, v * 100).toFixed(0) + '%';
}

const REGION_RGB = {
  OL: '93,184,255', AL: '255,199,71', MB: '184,115,255', LH: '255,107,140',
  VNC: '115,242,179', CX: '250,250,140', CB: '140,217,242', SEZ: '255,158,77',
  AMMC: '153,230,255', DN: '217,217,242', P1: '255,89,217', DAN: '140,255,115',
};
function rgbFor(uid) {
  const base = uid.split('_')[0];
  return 'rgb(' + (REGION_RGB[base] || '200,200,200') + ')';
}

// rolling trace of approach / avoid / dopamine
function drawTrace() {
  const cv = $('trace');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const H = state.history;
  if (H.length < 2) return;
  let maxV = 0.01;
  for (const p of H) maxV = Math.max(maxV, p.ap, p.av);
  maxV *= 1.25;

  const line = (key, color, scale) => {
    g.beginPath();
    for (let i = 0; i < H.length; i++) {
      const x = (i / (H.length - 1)) * w;
      const y = h - (H[i][key] / (scale || maxV)) * h;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = color; g.lineWidth = 1.5; g.stroke();
  };
  line('ap', 'rgb(255,199,71)');
  line('av', 'rgb(255,107,140)');
  // dopamine on its own ±1 scale, drawn from the middle
  g.beginPath();
  for (let i = 0; i < H.length; i++) {
    const x = (i / (H.length - 1)) * w;
    const y = h / 2 - (H[i].da / 1.2) * (h / 2);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.strokeStyle = 'rgba(140,255,115,0.55)'; g.lineWidth = 1; g.stroke();
}

// ------------------------------------------------------------- stimuli
const STIMS = [
  ['odorA', 'odour A', 'scent'], ['odorB', 'odour B', 'scent'],
  ['phero', 'pheromone', 'scent'],
  ['sweet', 'sugar taste', 'taste'], ['bitter', 'bitter taste', 'taste'],
  ['looming', 'looming', 'vision'], ['light', 'light flash', 'vision'],
  ['sound', 'courtship song', 'mech'], ['airpuff', 'air puff', 'mech'],
  ['shock', 'shock (PPL1)', 'teach'], ['sugar', 'sugar (PAM)', 'teach'],
];

function buildStimButtons() {
  const host = $('stim-grid');
  host.innerHTML = STIMS.map(([key, label, kind]) =>
    `<button class="stim k-${kind}" data-key="${key}">${label}</button>`).join('');
  host.querySelectorAll('button').forEach((btn) => {
    let held = null;
    const fire = (ms) => {
      const c = state.conn;
      const idx = c.ensembles[btn.dataset.key];
      if (!idx || !idx.length) return;
      state.sim.stimulate(idx, ampFor(btn.dataset.key), ms || 400);
      flash(btn);
    };
    btn.addEventListener('click', () => fire(400));
    btn.addEventListener('pointerdown', (e) => {
      held = setTimeout(() => { fire(100000); held = 'on'; }, 350);
    });
    const stop = () => {
      if (held === 'on') state.sim.clearStims();
      else if (held) clearTimeout(held);
      held = null;
    };
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
  });
}

function ampFor(key) {
  if (key === 'shock' || key === 'sugar') return 0.6;
  if (key === 'airpuff') return 0.7;
  return 0.5;
}

function flash(el) {
  el.classList.add('hot');
  setTimeout(() => el.classList.remove('hot'), 180);
}

// -------------------------------------------------------- training runs
function trial(odorKey, teachKey, n, label) {
  const c = state.conn;
  state.autoTrain = {
    left: n, phase: 0, timer: 0,
    odor: c.ensembles[odorKey], teach: c.ensembles[teachKey],
    label,
  };
  log(`${label}: ${n} trials queued`);
}

/**
 * Advance the training state machine by `dt` simulated milliseconds, so a
 * trial takes the same biological time whether the browser runs at 30 or
 * 144 fps.
 */
function runAutoTrain(dt) {
  const at = state.autoTrain;
  if (!at) return;
  at.timer += dt;
  if (at.phase === 0) {
    state.sim.stimulate(at.odor, 0.5, 400);
    state.sim.stimulate(at.teach, 0.6, 400);
    at.phase = 1; at.timer = 0;
    log(`${at.label}: trial ${at.left} — pairing`);
  } else if (at.phase === 1 && at.timer >= 500) {
    state.sim.clearStims();
    at.phase = 2; at.timer = 0;
  } else if (at.phase === 2 && at.timer >= 400) {
    at.left--;
    if (at.left <= 0) {
      state.autoTrain = null;
      log(`${at.label}: done — probe the odour to see the memory`);
    } else at.phase = 0;
  }
}

/**
 * Present odour A on its own and report how far the approach/avoid balance
 * moved. This is the actual memory test: no teaching signal, just the odour,
 * so any shift can only have come from the synapses that were rewritten.
 */
function startMeasure() {
  if (state.measure || state.autoTrain) return;
  state.measure = { phase: 0, timer: 0 };
  log('measuring: odour A alone…');
}

function runMeasure(dt) {
  const m = state.measure;
  if (!m) return;
  const sim = state.sim, c = state.conn;
  m.timer += dt;
  if (m.phase === 0) {
    sim.clearStims();
    if (m.timer > 250) {
      m.a0 = sim.approachRate; m.v0 = sim.avoidRate;
      sim.stimulate(c.ensembles.odorA, 0.5, 420);
      m.phase = 1; m.timer = 0;
    }
  } else if (m.phase === 1 && m.timer > 420) {
    const shift = (sim.avoidRate - m.v0) - (sim.approachRate - m.a0);
    state.memoryIndex = shift;
    state.measure = null;
    sim.clearStims();
    const verdict = shift > 0.05 ? 'aversion to odour A'
      : shift < -0.05 ? 'attraction to odour A'
        : 'no measurable memory yet';
    log(`memory index ${shift >= 0 ? '+' : ''}${shift.toFixed(3)} — ${verdict}`);
  }
}

/** How much of the KC→MBON matrix has actually moved from its naive state. */
function updatePlasticity() {
  const c = state.conn, sim = state.sim;
  const pe = c.plasticEdges, w = c.outWeight, base = sim.baseW;
  let changed = 0, sum = 0;
  for (let k = 0; k < pe.length; k++) {
    const b = base[k];
    if (b <= 0) continue;
    const d = Math.abs(w[pe[k]] - b) / b;
    if (d > 0.02) changed++;
    sum += d;
  }
  const n = Math.max(1, pe.length);
  state.plasticity.pct = changed / n;
  state.plasticity.mean = sum / n;
}

function log(msg) {
  const el = $('log');
  const t = (state.simTime / 1000).toFixed(1);
  el.innerHTML = `<div><span class="lt">${t}s</span> ${msg}</div>` + el.innerHTML;
  while (el.children.length > 40) el.lastChild.remove();
}

// ----------------------------------------------------------------- panel
function buildRegionPanel() { /* region bars are built lazily in updateHud */ }

function wireControls() {
  $('play').addEventListener('click', () => {
    state.running = !state.running;
    $('play').textContent = state.running ? '❚❚ pause' : '▶ run';
    $('play').classList.toggle('paused', !state.running);
  });

  const bind = (id, fn) => {
    const el = $(id);
    const out = $(id + '-v');
    const apply = () => { const v = Number(el.value); fn(v); if (out) out.textContent = fmt(v); };
    el.addEventListener('input', apply);
    apply();
  };
  const fmt = (v) => (v < 1 ? v.toFixed(3) : v.toFixed(2));

  bind('arousal', (v) => { state.sim.gain = v; });
  bind('inhib', (v) => { state.sim.inhibScale = v; });
  bind('lr', (v) => { state.sim.lr = v; });
  bind('speed', (v) => { state.speed = v; });
  bind('size', (v) => { state.renderer.size = v; });
  bind('exposure', (v) => { state.renderer.exposure = v; });
  bind('wires', (v) => { state.renderer.wireOpacity = v; });

  $('plastic').addEventListener('change', (e) => {
    state.sim.plasticity = e.target.checked;
  });
  $('spin').addEventListener('change', (e) => {
    state.renderer.autoRotate = e.target.checked;
  });
  $('showwires').addEventListener('change', (e) => {
    state.renderer.showWires = e.target.checked;
  });

  $('measure').addEventListener('click', startMeasure);

  $('train-aversive').addEventListener('click', () => trial('odorA', 'shock', 3, 'aversive (A + shock)'));
  $('train-appetitive').addEventListener('click', () => trial('odorA', 'sugar', 3, 'appetitive (A + sugar)'));
  $('probe').addEventListener('click', () => {
    state.sim.stimulate(state.conn.ensembles.odorA, 0.5, 400);
    log('probe: odour A alone');
  });
  $('forget').addEventListener('click', () => {
    const c = state.conn;
    const pe = c.plasticEdges;
    for (let k = 0; k < pe.length; k++) c.outWeight[pe[k]] = state.sim.baseW[k];
    state.sim.traceVal.fill(0);
    log('synapses reset to naive weights');
  });
  $('reset').addEventListener('click', () => {
    state.sim.reset();
    state.simTime = 0;
    state.history.length = 0;
    log('membrane potentials reset');
  });
  $('clear-log').addEventListener('click', () => { $('log').innerHTML = ''; });

  // Hover to identify. Throttled because picking scans every neuron.
  const cv = $('gl');
  cv.addEventListener('pointermove', (e) => {
    if (state.renderer.dragging) return;
    const now = performance.now();
    if (now - state.hoverAt < 110) return;
    state.hoverAt = now;
    const i = state.renderer.pick(e.clientX, e.clientY);
    const tip = $('hover-tip');
    if (i < 0) { tip.classList.remove('on'); return; }
    const r = state.conn.regions[state.conn.regionOf[i]];
    const g = state.conn.groupList[state.conn.groupOf[i]];
    tip.innerHTML = `<b style="color:${rgbFor(r.uid)}">${r.uid}</b> ${g.k}` +
      (state.lesions.has(state.conn.regionOf[i]) ? ' <span class="les">lesioned</span>' : '');
    tip.classList.add('on');
    tip.style.left = e.clientX + 'px';
    tip.style.top = e.clientY + 'px';
  });
  cv.addEventListener('pointerleave', () => $('hover-tip').classList.remove('on'));

  $('restore-all').addEventListener('click', restoreAll);

  // keyboard: space pauses, digits fire stimuli, m measures, r resets view
  document.addEventListener('keydown', (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); $('play').click(); return; }
    if (k === 'm' || k === 'M') { startMeasure(); return; }
    if (k === 'r' || k === 'R') { resetView(); return; }
    // 1-9 → the first nine stimuli (STIMS[0..8]); 0 → shock
    if (/^[0-9]$/.test(k)) {
      const idx = k === '0' ? 9 : Number(k) - 1;
      const entry = STIMS[idx];
      if (entry) {
        state.sim.stimulate(state.conn.ensembles[entry[0]], ampFor(entry[0]), 400);
        log(`stimulus: ${entry[1]}`);
      }
    }
  });

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
      t.classList.add('on');
      document.querySelectorAll('.pane').forEach((p) => p.classList.remove('on'));
      $(t.dataset.pane).classList.add('on');
    });
  });
}

function resetView() {
  const r = state.renderer;
  r.yaw = 0.6; r.pitch = -0.25;
  r.dist = r.span * 1.5;
  r.target = r.center.slice();
  r.autoRotate = true;
  const spin = $('spin');
  if (spin) spin.checked = true;
  log('view reset');
}

// ----------------------------------------------------------------- pick
function select(cx, cy) {
  const i = state.renderer.pick(cx, cy);
  state.selected = i;
  const card = $('neuron');
  if (i < 0) { card.classList.remove('on'); return; }
  const c = state.conn;
  const r = c.regionOf[i];
  const region = c.regions[r];
  const gl_ = c.groupList[c.groupOf[i]];
  const inDeg = c.inOffset[i + 1] - c.inOffset[i];
  const outDeg = c.outOffset[i + 1] - c.outOffset[i];
  const pool = c.poolOf[i];
  const poolName = pool >= 0 ? (Object.keys(c.POOL).find((k) => c.POOL[k] === pool) || '') : '';

  card.innerHTML = `
    <div class="nid">neuron #${i.toLocaleString()}</div>
    <div class="nrow"><span>region</span><b style="color:${rgbFor(region.uid)}">${region.uid}</b></div>
    <div class="nrow"><span>type</span><b>${gl_.uid}.${gl_.k}</b></div>
    <div class="nrow"><span>sign</span><b>${c.inhibitory[i] ? 'inhibitory' : 'excitatory'}</b></div>
    <div class="nrow"><span>synapses in</span><b>${inDeg}</b></div>
    <div class="nrow"><span>synapses out</span><b>${outDeg}</b></div>
    ${poolName ? `<div class="nrow"><span>motor pool</span><b>${poolName.toLowerCase()}</b></div>` : ''}
    <div class="nrow"><span>rate</span><b>${simHz(i).toFixed(1)} Hz</b></div>
    <button id="npoke">poke this neuron</button>
    <button id="npoke500">drive 50 nearby</button>`;
  card.classList.add('on');
  $('npoke').onclick = () => state.sim.stimulate(Int32Array.of(i), 2.0, 300);
  $('npoke500').onclick = () => {
    const near = nearest(i, 50);
    state.sim.stimulate(near, 1.2, 300);
  };
}

function simHz(i) {
  const c = state.conn;
  const r = c.regionOf[i];
  return state.sim.regionRate[r];
}

/**
 * k nearest neighbours, keeping only a k-long list so a click stays cheap
 * even at 166k neurons (no full sort).
 */
function nearest(i, k) {
  const c = state.conn, p = c.pos;
  const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
  const bestD = new Float64Array(k).fill(Infinity);
  const bestI = new Int32Array(k).fill(-1);
  for (let j = 0; j < c.n; j++) {
    const dx = p[j * 3] - x, dy = p[j * 3 + 1] - y, dz = p[j * 3 + 2] - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d >= bestD[k - 1]) continue;
    let m = k - 1;
    while (m > 0 && bestD[m - 1] > d) { bestD[m] = bestD[m - 1]; bestI[m] = bestI[m - 1]; m--; }
    bestD[m] = d; bestI[m] = j;
  }
  return bestI;
}

boot().catch((err) => {
  console.error(err);
  const s = $('overlay-status');
  if (s) s.innerHTML = '<span class="err">failed to start: ' + err.message + '</span>';
});
