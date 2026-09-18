import assert from 'node:assert/strict';
import { divergence, mean, runTwins } from '../sim.js';

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

assert.throws(() => runTwins(-1, 'none'), /seed/);
assert.throws(() => runTwins(42, 'unknown'), /intervention/);
assert.throws(() => divergence([0.1], [0.1, 0.2]), /equal length/);
assert.equal(mean([1, 2, 3]), 2);

console.log('CHRONOFLY deterministic twin checks passed');
