export const NEURON_COUNT = 20;
export const MAZE_LENGTH = 100;
export const TOTAL_STEPS = 300;
export const SWR_PROBABILITY = 0.02;
export const SWR_THRESHOLD = 1.35;
export const LEARNING_RATE = 0.001;

function createSeededRandom(seed) {
  let s = (seed || 123) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('seed must be an integer from 0 to 4294967295');
  }
}

export function placeFields() {
  const fields = [];
  for (let i = 0; i < NEURON_COUNT; i += 1) {
    fields.push({
      preferred: (i / NEURON_COUNT) * MAZE_LENGTH,
      width: (MAZE_LENGTH / NEURON_COUNT) * 0.6
    });
  }
  return fields;
}

export function activation(fields, neuron, position) {
  const d = Math.abs(position - fields[neuron].preferred);
  const sigma = fields[neuron].width;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

export function initialWeights(fields, random) {
  const weights = [];
  for (let i = 0; i < NEURON_COUNT; i += 1) {
    const row = [];
    for (let pos = 0; pos < MAZE_LENGTH; pos += 1) {
      const d = Math.abs(pos - fields[i].preferred);
      const tuning = Math.exp(-(d * d) / (2 * fields[i].width * fields[i].width));
      row.push((random() - 0.5) * 2.0 * tuning);
    }
    weights.push(row);
  }
  return weights;
}

export function meanAbsoluteWeight(weights) {
  let sum = 0;
  let count = 0;
  for (const row of weights) {
    for (const value of row) {
      if (!Number.isFinite(value)) throw new Error('weights must contain only finite numbers');
      sum += Math.abs(value);
      count += 1;
    }
  }
  if (count === 0) throw new Error('weights must not be empty');
  return sum / count;
}

export function runReplay(seed) {
  validateSeed(seed);
  const random = createSeededRandom(seed);
  const fields = placeFields();
  const weights = initialWeights(fields, random);
  const hippocampal = [];
  const cortical = [];
  const replayEvents = [];
  const synapticEvolution = [];
  const positions = [];
  let accumulated = 0;

  for (let t = 0; t < TOTAL_STEPS; t += 1) {
    const base = (t * 7) % MAZE_LENGTH;
    const position = Math.max(0, Math.min(MAZE_LENGTH - 1, base + Math.floor(random() * 3) - 1));
    positions.push(position);

    let total = 0;
    for (let i = 0; i < NEURON_COUNT; i += 1) total += activation(fields, i, position);
    const normalizer = Math.max(total, 1e-6);
    const hippocampalActivity = Array.from({ length: NEURON_COUNT }, (_, i) => activation(fields, i, position) / normalizer);
    const corticalActivity = [...hippocampalActivity];
    hippocampal.push(hippocampalActivity);
    cortical.push(corticalActivity);

    if (random() < SWR_PROBABILITY && total > SWR_THRESHOLD) replayEvents.push(t);

    for (let i = 0; i < NEURON_COUNT; i += 1) {
      const delta = LEARNING_RATE * corticalActivity[i] * hippocampalActivity[i];
      accumulated += delta;
      weights[i][position] += delta;
    }
    synapticEvolution.push(accumulated / (NEURON_COUNT * MAZE_LENGTH));
  }

  return {
    seed,
    hippocampal,
    cortical,
    positions,
    replayEvents,
    synapticEvolution,
    weights,
    meanWeight: meanAbsoluteWeight(weights)
  };
}
