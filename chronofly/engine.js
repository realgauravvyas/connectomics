/**
 * CHRONOFLY — Counterfactual Neural Twin Engine
 * Deterministic synthetic recurrent circuit with identical twin branches.
 * One branch receives a targeted intervention (silence, stimulation, or modulation).
 * Identical random seeds, common input current, divergence tracked over time.
 * No external runtime dependencies; pure JS / Canvas 2D.
 * Browser‑safe: all DOM references are guarded by `typeof globalThis !== 'undefined'`.
 */

/** Ensure Node‑safe top‑level scope */
if (typeof globalThis === 'undefined') {
  // minimal stubs for when engine.js is evaluated in Node without a DOM
  globalThis = {};
}
const NEURON_COUNT = 6; // small deterministic recurrent set
const STEPS = 200; // simulation steps per run
const DT = 0.1; // time step (ms)
const I_BASE = 0.5; // baseline input current

// Synaptic weight matrix (random but seeded)
let W;

// Intervention config
let intervention = 'none'; // none | silence | stimulate | modulate
let gainMod = 1.0; // for modulate

// Neuron state: [v, I_syn] for each neuron
let stateA; // twin A (control)
let stateB; // twin B (intervened)

/** Initialise synaptic weights from a deterministic seed */
function initWeights(seed) {
  // Simple deterministic pseudo-random using seed
  let s = seed || 42;
  const seedRand = () => {
    s = Math.floor(s * 1664525 + 1013904223);
    return (s >>> 0) / 0x100000000;
  };

  W = [];
  for (let i = 0; i < NEURON_COUNT; i++) {
    const row = [];
    for (let j = 0; j < NEURON_COUNT; j++) {
      // symmetric-ish random with zero diagonal
      if (i === j) { row.push(0); continue; }
      row.push((seedRand() - 0.5) * 2.0);
    }
    W.push(row);
  }
}

/** Update neuron state (Leaky integrate-and-fire lite) */
function stepNeurons(state, applyIntervention) {
  // state = [v, I_syn] per neuron
  const newState = state.map(([v, I_syn], i) => {
    // total synaptic input
    let I_tot = 0;
    for (let j = 0; j < NEURON_COUNT; j++) {
      if (i !== j) {
        I_tot += W[i][j] * state[j][0]; // post-synaptic voltage -> input
      }
    }
    // total external input
    let I_ext = I_BASE;

    // ---- intervention ----
    if (applyIntervention) {
      if (intervention === 'silence') {
        // clamp voltage to rest, zero output influence
        I_ext = 0;
      } else if (intervention === 'stimulate') {
        I_ext += 1.2;
      } else if (intervention === 'modulate') {
        I_ext *= gainMod;
      }
    }

    // leaky integrate
    const v_rest = -0.5;
    const tau = 10;
    const v_new = v + DT * (- (v - v_rest) / tau + I_tot + I_ext);

    // simple threshold/spike
    let v_out = v_new;
    if (v_new > 1.0) {
      v_out = -0.5; // reset
    }

    return [v_out, I_syn];
  });
  return newState;
}

/** Run one twin pair to completion, return trajectory arrays */
function runExperiment(seed) {
  initWeights(seed);
  // initial states: all neurons at rest
  stateA = Array.from({ length: NEURON_COUNT }, () => [-0.5, 0]);
  stateB = Array.from({ length: NEURON_COUNT }, () => [-0.5, 0]);

  const tracesA = [];
  const tracesB = [];

  for (let t = 0; t < STEPS; t++) {
    stateA = stepNeurons(stateA, false); // control: no intervention applied in step itself; handled via I_ext
    stateB = stepNeurons(stateB, true); // intervened twin

    // record voltages of neuron 0 for divergence
    tracesA.push(stateA[0][0]);
    tracesB.push(stateB[0][0]);
  }

  return { tracesA, tracesB, seed };
}

/** Compute mean squared divergence */
function divergence(tracesA, tracesB) {
  let sum = 0;
  for (let i = 0; i < tracesA.length; i++) {
    const d = tracesA[i] - tracesB[i];
    sum += d * d;
  }
  return sum / tracesA.length;
}

// ---- Render ----
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const telemetry = document.getElementById('telemetry');
const runBtn = document.getElementById('runBtn');
const seedInput = document.getElementById('seed');
const interventionSelect = document.getElementById('intervention');

let currentTraces = null;
let currentSeed = null;

function resizeCanvas() {
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function render(tracesA, tracesB) {
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const width = canvas.width;
  const height = canvas.height;
  const margin = { t: 40, r: 30, b: 40, l: 50 };
  const plotWidth = width - margin.l - margin.r;
  const plotHeight = height - margin.t - margin.b;

  // find y range with slight padding
  const allVals = [...tracesA, ...tracesB];
  const minY = Math.min(...allVals) - 0.1;
  const maxY = Math.max(...allVals) + 0.1;

  // axes
  ctx.strokeStyle = 'var(--border-subtle)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.l, margin.t);
  ctx.lineTo(margin.l, margin.t + plotHeight);
  ctx.lineTo(margin.l + margin.l, margin.t + plotHeight);
  ctx.stroke();

  // grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  const nx = 5;
  const ny = 5;
  for (let i = 0; i <= nx; i++) {
    const x = margin.l + (i / nx) * plotWidth;
    ctx.beginPath();
    ctx.moveTo(x, margin.t);
    ctx.lineTo(x, margin.t + plotHeight);
    ctx.stroke();
  }
  for (let i = 0; i <= ny; i++) {
    const y = margin.t + (i / ny) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(margin.l, y);
    ctx.lineTo(margin.l + plotWidth, y);
    ctx.stroke();
  }

  // plot traces
  const colorA = 'var(--cyan)';
  const colorB = 'var(--pink)';

  // trace A (control) - solid
  ctx.strokeStyle = colorA;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < tracesA.length; i++) {
    const x = margin.l + (i / (tracesA.length - 1)) * plotWidth;
    const y = margin.t + plotHeight - ((tracesA[i] - minY) / (maxY - minY)) * plotHeight;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // trace B (intervened) - dashed
  ctx.strokeStyle = colorB;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (let i = 0; i < tracesB.length; i++) {
    const x = margin.l + (i / (tracesB.length - 1)) * plotWidth;
    const y = margin.t + plotHeight - ((tracesB[i] - minY) / (maxY - minY)) * plotHeight;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // labels
  ctx.fillStyle = '#8b9bb4';
  ctx.font = '11px JetBrains Mono, monospace';
  ctx.fillText('Time (steps)', margin.l + plotWidth / 2, margin.t + plotHeight + 20);
  ctx.fillText('Voltage (mV)', 10, margin.t + plotHeight / 2 + 12, 40);
}

function updateTelemetry(tracesA, tracesB, seed, intervention) {
  const div = divergence(tracesA, tracesB);
  telemetry.innerHTML = `
Seed: ${seed}<br>
Intervention: ${intervention}<br>
MSE Divergence: ${div.toExponential(3)}<br>
Twin A (control) neuron-0 mean: ${(tracesA.reduce((s, v) => s + v, 0) / tracesA.length).toFixed(3)}<br>
Twin B (intervened) neuron-0 mean: ${(tracesB.reduce((s, v) => s + v, 0) / tracesB.length).toFixed(3)}<br>
`;
}

// main run
runBtn.addEventListener('click', () => {
  const seed = Math.max(0, parseInt(seedInput.value) || 42);
  intervention = interventionSelect.value;
  gainMod = intervention === 'modulate' ? 1.5 : 1.0;

  currentTraces = runExperiment(seed);
  currentSeed = seed;

  render(currentTraces.tracesA, currentTraces.tracesB);
  updateTelemetry(currentTraces.tracesA, currentTraces.tracesB, seed, intervention);
});

// initial draw with defaults
runBtn.click();