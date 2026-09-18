import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAZE_LENGTH, TOTAL_STEPS, runReplay } from '../sim.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(statSync(resolve(root, 'vendor/three.min.js')).size > 100000, 'vendored three.js must be present');
assert.ok(statSync(resolve(root, 'fly3d.js')).size > 1000, 'fly3d.js must be present');

const first = runReplay(123);
const repeat = runReplay(123);
assert.deepEqual(first.replayEvents, repeat.replayEvents);
assert.deepEqual(first.synapticEvolution, repeat.synapticEvolution);
assert.deepEqual(first.positions, repeat.positions);
assert.equal(first.meanWeight, repeat.meanWeight);
assert.equal(first.hippocampal.length, TOTAL_STEPS);
assert.equal(first.cortical.length, TOTAL_STEPS);
assert.equal(first.synapticEvolution.length, TOTAL_STEPS);
assert.equal(first.positions.length, TOTAL_STEPS);
for (const pos of first.positions) {
  assert.ok(Number.isInteger(pos));
  assert.ok(pos >= 0 && pos < MAZE_LENGTH);
}
assert.ok(first.replayEvents.length > 0, 'default seed should produce observable replay events');
assert.deepEqual([...first.replayEvents].sort((a, b) => a - b), first.replayEvents);

for (const event of first.replayEvents) {
  assert.ok(Number.isInteger(event));
  assert.ok(event >= 0 && event < TOTAL_STEPS);
}
for (let i = 1; i < first.synapticEvolution.length; i += 1) {
  assert.ok(first.synapticEvolution[i] >= first.synapticEvolution[i - 1]);
  assert.ok(Number.isFinite(first.synapticEvolution[i]));
}
assert.ok(first.meanWeight > 0);
assert.ok(Number.isFinite(first.meanWeight));
assert.throws(() => runReplay(-1), /seed/);

console.log(`ONEIRO deterministic replay checks passed (${first.replayEvents.length} SWR events)`);
