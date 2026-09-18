import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARENA_H, ARENA_W, divergence, flyPath, mean, runTwins } from '../js/sim.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
assert.ok(statSync(resolve(root, 'vendor/three.min.js')).size > 100000, 'vendored three.js must be present');
assert.ok(statSync(resolve(root, 'js/fly3d.js')).size > 1000, 'js/fly3d.js must be present');

const first = runTwins(42, 'none');
const repeat = runTwins(42, 'none');
assert.deepEqual(first.tracesA, repeat.tracesA);
assert.deepEqual(first.tracesB, repeat.tracesB);
assert.ok(first.divergence < 1e-12);

for (const intervention of ['silence', 'stimulate', 'modulate']) {
  const treated = runTwins(42, intervention);
  assert.equal(treated.tracesA.length, 200);
  assert.equal(treated.tracesB.length, 200);
  assert.ok(treated.divergence > 1e-6, `${intervention} should move the treated twin`);
  assert.ok(Number.isFinite(treated.meanA));
  assert.ok(Number.isFinite(treated.meanB));
}

const snapshot = runTwins(7, 'stimulate');
snapshot.tracesB[0] = 999;
const fresh = runTwins(7, 'stimulate');
assert.notEqual(fresh.tracesB[0], 999);
assert.deepEqual(snapshot.tracesA, fresh.tracesA);

const nonePaths = flyPath(first.tracesA);
const nonePathsAgain = flyPath(runTwins(42, 'none').tracesA);
assert.deepEqual(nonePaths, nonePathsAgain);
assert.equal(nonePaths.length, 200);
for (const p of nonePaths) {
  assert.ok(p.x >= 0 && p.x < ARENA_W);
  assert.ok(p.y >= 0 && p.y <= ARENA_H);
  assert.ok(Number.isFinite(p.heading));
}
const stimPaths = flyPath(runTwins(42, 'stimulate').tracesB);
const lastNone = nonePaths[nonePaths.length - 1];
const lastStim = stimPaths[stimPaths.length - 1];
assert.ok(Math.abs(lastNone.x - lastStim.x) + Math.abs(lastNone.y - lastStim.y) > 1e-6);
assert.throws(() => flyPath([]), /non-empty/);

assert.throws(() => runTwins(-1, 'none'), /seed/);
assert.throws(() => runTwins(42, 'unknown'), /intervention/);
assert.throws(() => divergence([0.1], [0.1, 0.2]), /equal length/);
assert.equal(mean([1, 2, 3]), 2);

console.log('CHRONOFLY deterministic twin checks passed');
