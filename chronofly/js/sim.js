export const NEURON_COUNT = 6;
export const STEPS = 200;
export const DT = 0.1;
export const I_BASE = 0.5;
export const TARGET_NEURON = 3;
export const INTERVENTIONS = ['none', 'silence', 'stimulate', 'modulate'];
export const MODULATE_GAIN = 1.5;

function createSeededRandom(seed) {
  let s = (seed || 42) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function validateRun(seed, intervention, gain) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('seed must be an integer from 0 to 4294967295');
  }
  if (!INTERVENTIONS.includes(intervention)) {
    throw new Error(`intervention must be one of ${INTERVENTIONS.join(', ')}`);
  }
  if (!Number.isFinite(gain) || gain <= 0 || gain > 10) {
    throw new Error('gain must be a finite number greater than 0 and not greater than 10');
  }
}

export function initWeights(seed) {
  const random = createSeededRandom(seed);
  const weights = [];
  for (let i = 0; i < NEURON_COUNT; i += 1) {
    const row = [];
    for (let j = 0; j < NEURON_COUNT; j += 1) {
      if (i === j) {
        row.push(0);
      } else {
        row.push((random() - 0.5) * 2.0);
      }
    }
    weights.push(row);
  }
  return weights;
}

function externalCurrent(intervention, gain, neuron, applyIntervention) {
  if (!applyIntervention || neuron !== TARGET_NEURON) return I_BASE;
  if (intervention === 'silence') return 0;
  if (intervention === 'stimulate') return I_BASE + 1.2;
  if (intervention === 'modulate') return I_BASE * gain;
  return I_BASE;
}

export function stepNeurons(state, weights, applyIntervention, intervention, gain) {
  if (!Array.isArray(state) || state.length !== NEURON_COUNT) {
    throw new Error(`state must contain ${NEURON_COUNT} neurons`);
  }
  return state.map((neuron, i) => {
    const voltage = neuron[0];
    let synapticInput = 0;
    for (let j = 0; j < NEURON_COUNT; j += 1) {
      if (i !== j) synapticInput += weights[i][j] * state[j][0];
    }
    const external = externalCurrent(intervention, gain, i, applyIntervention);
    const next = voltage + DT * (-(voltage + 0.5) / 10 + synapticInput + external);
    return [next > 1.0 ? -0.5 : next, neuron[1]];
  });
}

export function runTwins(seed, intervention = 'none', gain = MODULATE_GAIN) {
  validateRun(seed, intervention, gain);
  const weights = initWeights(seed);
  let control = Array.from({ length: NEURON_COUNT }, () => [-0.5, 0]);
  let treated = Array.from({ length: NEURON_COUNT }, () => [-0.5, 0]);
  const tracesA = [];
  const tracesB = [];

  for (let t = 0; t < STEPS; t += 1) {
    control = stepNeurons(control, weights, false, intervention, gain);
    treated = stepNeurons(treated, weights, true, intervention, gain);
    tracesA.push(control[TARGET_NEURON][0]);
    tracesB.push(treated[TARGET_NEURON][0]);
  }

  return {
    seed,
    intervention,
    gain,
    targetNeuron: TARGET_NEURON,
    tracesA,
    tracesB,
    divergence: divergence(tracesA, tracesB),
    meanA: mean(tracesA),
    meanB: mean(tracesB)
  };
}

export function divergence(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    throw new Error('traces must be non-empty arrays of equal length');
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      throw new Error('traces must contain only finite numbers');
    }
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum / a.length;
}

export const ARENA_W = 100;
export const ARENA_H = 100;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function flyPath(trace) {
  if (!Array.isArray(trace) || trace.length === 0) {
    throw new Error('trace must be a non-empty array');
  }
  const path = [];
  let x = 8;
  let y = ARENA_H / 2;
  let heading = 0;
  for (const v of trace) {
    if (!Number.isFinite(v)) throw new Error('trace must contain only finite numbers');
    const drive = clamp((v + 0.5) * 0.35, -0.6, 0.9);
    heading += clamp((v + 0.5) * 0.08, -0.3, 0.3);
    const speed = 0.9 * (1 + drive);
    x += Math.cos(heading) * speed;
    y += Math.sin(heading) * speed;
    if (x < 0) x += ARENA_W;
    if (x >= ARENA_W) x -= ARENA_W;
    if (y < 8 || y > ARENA_H - 8) {
      heading = -heading;
      y = clamp(y, 8, ARENA_H - 8);
    }
    path.push({ x, y, heading, speed: Math.abs(speed) });
  }
  return path;
}

export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('values must be a non-empty array');
  }
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('values must contain only finite numbers');
    sum += value;
  }
  return sum / values.length;
}
