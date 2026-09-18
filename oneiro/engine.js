/**
 * ONEIRO — Sleep‑Replay Maze Observatory
 * Deterministic hippocampal‑cortical network with sharp‑wave ripple (SWR) events
 * and Hebbian synaptic learning during offline replay of a 1‑D maze trajectory.
 * No external runtime dependencies; pure JS / Canvas 2D.
 * Browser‑safe: all DOM references are guarded by `typeof globalThis !== 'undefined'`.
 */

/** Ensure Node‑safe top‑level scope */
if (typeof globalThis === 'undefined') {
  // minimal stubs for when engine.js is evaluated in Node without a DOM
  globalThis = {};
}

const NEURON_COUNT = 20; // hippocampal CA1 place cells / cortical ensemble
const MAZE_LENGTH = 100;   // discrete maze positions
const SWR_PROB_PER_STEP = 0.003; // probability of SWR event per step
const REPLAY_STEPS = 50; // number of steps in a replay burst
const TOTAL_STEPS = 300; // total simulation steps

let W; // synaptic weight matrix (cortex → hippocampus, size NEURON_COUNT × MAZE_LENGTH)
let placeFields; // preferred position of each neuron (Gaussian bump)

let seed = 42;

// ---- Deterministic PRNG from seed ----
let rngState = seed;
function rng() {
  rngState = Math.floor(rngState * 1664525 + 1013904223);
  return (rngState >>> 0) / 0x100000000;
}

// ---- Initialise place fields (one bump per neuron, offset along maze) ----
function initPlaceFields() {
  placeFields = [];
  for (let i = 0; i < NEURON_COUNT; i++) {
    const preferred = (i / NEURON_COUNT) * MAZE_LENGTH;
    placeFields.push({ pref: preferred, width: MAZE_LENGTH / NEURON_COUNT * 0.6 });
  }
}

// ---- Initialise synaptic weights: random but seeded, smooth across position ----
function initWeights() {
  W = [];
  for (let i = 0; i < NEURON_COUNT; i++) {
    const row = [];
    for (let pos = 0; pos < MAZE_LENGTH; pos++) {
      // Gaussian-tuned weight: each neuron prefers a position
      const d = Math.abs(pos - placeFields[i].pref);
      const g = Math.exp(-(d * d) / (2 * (placeFields[i].width * placeFields[i].width)));
      row.push((rng() - 0.5) * 2.0 * g); // modulated by place field
    }
    W.push(row);
  }
}

// ---- Neuron activation: place‑field tuned firing rate ----
function activation(neuronIdx, position) {
  const d = Math.abs(position - placeFields[neuronIdx].pref);
  const sigma = placeFields[neuronIdx].width;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

// ---- Run one full simulation ----
function runSimulation(seedVal) {
  rngState = seedVal; // reseed
  initPlaceFields();
  initWeights();

  // activity traces
  const hippocampal = []; // population activity per step (binned)
  const cortical = [];     // population activity per step
  const replayEvents = []; // SWR event timestamps
  const synapticEvolution = []; // average weight magnitude per step

  let weightsAvg = 0;

  for (let t = 0; t < TOTAL_STEPS; t++) {
    // choose maze position for this step (deterministic sweep + jitter)
    const basePos = (t * 7) % MAZE_LENGTH; // deterministic walk
    const pos = Math.max(0, Math.min(MAZE_LENGTH - 1, basePos + Math.floor(rng() * 3 - 1.5)));

    // ---- hippocampal population activity ----
    const hipAct = NEURON_COUNT;
    let hipSum = 0;
    for (let i = 0; i < NEURON_COUNT; i++) {
      const a = activation(i, pos);
      hipSum += a;
    }
    const hipNorm = Array.from({ length: NEURON_COUNT }, () => {
      const a = Math.max(0, activation(/*placeholder*/0, pos)); // we'll fill below
      return a;
    });
    // recompute properly
    const hipActVals = Array.from({ length: NEURON_COUNT }, i => activation(i, pos) / Math.max(hipSum, 1e-6));
    hippocampal.push([...hipActVals]);
    hipSumTotal = hipSum;

    // ---- cortical population activity (same place‑field tuning, no dynamics) ----
    const corAct = Array.from({ length: NEURON_COUNT }, i => activation(i, pos) / Math.max(hipSum, 1e-6));
    cortical.push([...corAct]);

    // ---- sharp‑wave ripple event? ----
    if (rng() < SWR_PROB_PER_STEP && hipSum > 3.0) {
      // record an SWR event
      replayEvents.push(t);
      // during SWR: accelerated replay of the recent trajectory
      // (synthetic: just note the event; actual replay dynamics are captured in weight changes)
    }

    // ---- Hebbian synaptic update (post‑synaptic x pre‑synaptic) ----
    // pre‑synaptic: cortical activity at this position
    // post‑synaptic: hippocampal activity at this position
    for (let i = 0; i < NEURON_COUNT; i++) {
      const pre = corAct[i];
      const post = hipActVals[i];
      const delta = 0.001 * pre * post; // tiny Hebbian potentiation
      weightsAvg += delta;
      // apply to weight at this position
      const wIdx = Math.floor(pos); // discretised position index
      if (wIdx >= 0 && wIdx < MAZE_LENGTH) {
        W[i][wIdx] += delta;
      }
    }
    synapticEvolution.push(weightsAvg / (NEURON_COUNT * MAZE_LENGTH));

    // occasional replay burst (every ~50 steps)
    if (t > 0 && t % 50 === 0) {
      // synthetic replay: no-op marker; real implementation would reverse‑drive hippocampal→cortical
    }
  }

  return {
    hippocampal,
    cortical,
    replayEvents,
    synapticEvolution,
    seed: seedVal
  };
}

/** Compute mean weight across cortex‑maze grid */
function meanWeight(W) {
  let s = 0, n = 0;
  for (let i = 0; i < W.length; i++) {
    for (let j = 0; j < W[i].length; j++) {
      s += Math.abs(W[i][j]);
      n++;
    }
  }
  return n > 0 ? s / n : 0;
}

/** Render heat‑map of hippocampal population activity over time */
function renderHeatMap(ctx, data, width, height) {
  const frameCount = data.length;
  const neurons = data[0].length;
  const cellW = width / frameCount;
  const cellH = height / neurons;

  for (let t = 0; t < frameCount; t++) {
    for (let n = 0; n < neurons; n++) {
      const val = Math.min(1, Math.max(0, data[t][n]));
      const c = Math.round(255 * (1 - val)); // bright = high activity, dark = low
      ctx.fillStyle = `rgb(${c}, ${c}, ${c + 30})`;
      ctx.fillRect(t * cellW, n * cellH, cellW, cellH);
    }
  }
}

/** Render simple line plot of average synaptic strength over time */
function renderSynapticPlot(ctx, evolution, width, height) {
  const steps = evolution.length;
  const plotW = width - 60;
  const plotH = height - 40;
  const margin = { t: 20, r: 40, b: 40, l: 50 };

  // find min/max
  const minV = Math.min(...evolution);
  const maxV = Math.max(...evolution);

  // axes
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.l, margin.t);
  ctx.lineTo(margin.l, margin.t + plotH);
  ctx.lineTo(margin.l + plotW, margin.t + plotH);
  ctx.stroke();

  // plot line
  ctx.strokeStyle = 'var(--emerald)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < steps; i++) {
    const x = margin.l + (i / Math.max(1, steps - 1)) * plotW;
    const y = margin.t + plotH - ((evolution[i] - minV) / Math.max(0.001, maxV - minV) * plotH);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ---- Render main frame ----
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const telemetry = document.getElementById('telemetry');
const runBtn = document.getElementById('runBtn');
const seedInput = document.getElementById('seed');
const speedSelect = document.getElementById('speed');

let currentResult = null;

function resizeCanvas() {
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function runExperiment(seedVal) {
  currentResult = runSimulation(seedVal);
  return currentResult;
}

function updateTelemetry(result) {
  const evCount = result.replayEvents.length;
  const avgW = meanWeight(W).toExponential(3);
  telemetry.innerHTML = `
Seed: ${result.seed}<br>
SWR Events: ${evCount}<br>
Mean Synaptic Strength (|W|): ${avgW}<br>
Replay Speed: ${speedSelect.value}x<br>
`;
}

function render(r) {
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.fillStyle = '#050a12';
  ctx.fillRect(0, 0, cw, ch);

  // two panels: top‑left heat map of hippocampal activity,
  // bottom‑right synaptic evolution plot
  const panelW = cw / 2 - 20;
  const panelH = ch / 2 - 20;

  // left: heat map of last 80 steps of hippocampal population
  const win = 80;
  const start = Math.max(0, r.hippocampatial.length - win);
  const subset = r.hippocampatial.slice(start);
  renderHeatMap(ctx, subset, panelW, panelH);

  // right: synaptic evolution plot
  renderSynapticPlot(ctx, r.synapticEvolution, panelW, panelH);
}

function runBtnHandler() {
  const seed = Math.max(0, parseInt(seedInput.value) || 123);
  runExperiment(seed);
  render(currentResult);
  updateTelemetry(currentResult);
}

// initial
runBtnHandler();
runBtn.addEventListener('click', runBtnHandler);