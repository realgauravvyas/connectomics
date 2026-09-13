/**
 * analyze.mjs — headless sanity check for the connectome + simulation.
 *
 *   npm run analyze
 *
 * Grows the network, runs it for a few simulated seconds and prints
 * whether it behaves like a brain (or at least like a plausible one):
 * firing rates in range, no NaN, odour responses, and learning.
 */

import { buildConnectome } from '../js/connectome.js';
import { Simulation } from '../js/sim.js';

const N = Number(process.env.N || 45000);
const SECS = Number(process.env.SECS || 6);

console.log(`\n166k · growing connectome (${N} neurons)…`);
const t0 = Date.now();
const conn = buildConnectome({ neurons: N, synapsesPerNeuron: 14 });
const growMs = Date.now() - t0;

const mb = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';
const bytes =
  conn.pos.byteLength + conn.outTarget.byteLength * 2 + conn.outWeight.byteLength * 2 +
  conn.outDelay.byteLength + conn.inSource.byteLength;

console.log(`  neurons            ${conn.n.toLocaleString()}`);
console.log(`  synapses           ${conn.E.toLocaleString()}  (${(conn.E / conn.n).toFixed(1)} per neuron)`);
console.log(`  real connectome    166,000 neurons / 125,000,000 synapses  → 1:${Math.round(conn.meta.sampling)} sampled`);
console.log(`  adjacency memory   ${mb(bytes)}`);
console.log(`  build time         ${growMs} ms`);
console.log(`  plastic synapses   ${conn.plasticEdges.length.toLocaleString()} (KC→MBON)`);

console.log('\n  region                 neurons    rate Hz   in-deg');
for (const r of conn.regions) {
  const idx = [];
  for (let i = r.start; i < r.start + r.count; i++) idx.push(conn.outOffset[i + 1] - conn.outOffset[i]);
  const avgIn = (conn.E / conn.n).toFixed(1);
  console.log(`  ${(r.uid + '                 ').slice(0, 18)}${String(r.count).padStart(8)}       —      ${avgIn}`);
}

// ------------------------------------------------------------------ run it
const sim = new Simulation(conn);
const STEPS = SECS * 1000;
console.log(`\n  simulating ${SECS} s (${STEPS.toLocaleString()} ms steps)…`);
const t1 = Date.now();
let nan = false;
for (let s = 0; s < STEPS; s++) {
  sim.step();
  if ((s & 1) === 0) sim.plasticityStep();
  if (s % 16 === 0) sim.updateRates(16, 16);
}
const simMs = Date.now() - t1;
for (let i = 0; i < conn.n; i++) if (!Number.isFinite(sim.v[i])) { nan = true; break; }

console.log(`  wall time           ${simMs} ms  (${(STEPS / simMs).toFixed(1)} sim-ms per real-ms)`);
console.log(`  realtime factor     ${(STEPS / simMs).toFixed(2)}× `);
console.log(`  NaN in membrane     ${nan ? 'YES — BROKEN' : 'no'}`);

const meanRate = conn.regions.map((r, i) => sim.regionRate[i]);
const overall = meanRate.reduce((a, b) => a + b, 0) / conn.regions.length;
console.log(`  mean firing rate    ${overall.toFixed(2)} Hz   (healthy: 0.2 – 20)`);
console.log(`  per-region rates    ${meanRate.map((x, i) => conn.regions[i].uid + ':' + x.toFixed(1)).join(' ')}`);

const b = sim.readBehavior();
console.log(`\n  behaviour readout   walk=${b.walk.toFixed(2)} turn=${b.turn.toFixed(2)} wing=${b.wing.toFixed(2)} proboscis=${b.proboscis.toFixed(2)} jump=${b.jump}`);
console.log(`  motor pool Hz       ${Array.from(sim.poolRate).map(x => x.toFixed(1)).join(' ')}`);

// ------------------------------------------------------------- odour test
console.log('\n  odour response test (AL → MB → LH cascade)');
const beforeMB = sim.regionRate[conn.groupMap.get('MB_L.KC').region];
sim.stimulate(conn.ensembles.odorA, 0.5, 400);
for (let s = 0; s < 400; s++) { sim.step(); if (s % 16 === 0) sim.updateRates(16, 16); }
const afterMB = sim.regionRate[conn.groupMap.get('MB_L.KC').region];
console.log(`    mushroom body     ${beforeMB.toFixed(2)} Hz → ${afterMB.toFixed(2)} Hz  ${afterMB > beforeMB ? 'RESPONDS' : 'no response'}`);

// ----------------------------------------------------------- learning test
console.log('\n  aversive conditioning test (odour + PPL1 shock ×3)');
const mbonRegion = conn.groupMap.get('MB_L.MBON').region;
function probe() {
  sim.clearStims();
  for (let s = 0; s < 250; s++) { sim.step(); if (s % 16 === 0) sim.updateRates(16, 16); }
  const a0 = sim.approachRate, v0 = sim.avoidRate;
  sim.stimulate(conn.ensembles.odorA, 0.5, 300);
  for (let s = 0; s < 300; s++) { sim.step(); if (s % 16 === 0) sim.updateRates(16, 16); }
  return { approach: sim.approachRate - a0, avoid: sim.avoidRate - v0 };
}
const before = probe();
const bias = (p) => p.avoid - p.approach;   // >0 = net avoidance drive
console.log(`    before training   approach ${before.approach.toFixed(3)}  avoid ${before.avoid.toFixed(3)}   bias ${bias(before).toFixed(3)}`);
for (let trial = 0; trial < 3; trial++) {
  sim.stimulate(conn.ensembles.odorA, 0.5, 400);
  sim.stimulate(conn.ensembles.shock, 0.6, 400);
  for (let s = 0; s < 500; s++) {
    sim.step();
    if ((s & 1) === 0) sim.plasticityStep();
    if (s % 16 === 0) sim.updateRates(16, 16);
  }
}
const after = probe();
console.log(`    after 3 shocks    approach ${after.approach.toFixed(3)}  avoid ${after.avoid.toFixed(3)}   bias ${bias(after).toFixed(3)}`);
const shift = bias(after) - bias(before);
console.log(`    memory shift      ${shift > 0 ? '+' : ''}${shift.toFixed(3)}  ${shift > 0.02 ? 'LEARNED AVERSION ✓' : (shift < -0.02 ? 'learned preference (wrong sign)' : 'no clear learning')}`);

// ---------------------------------------------------------- ablation test
// The point of the lesion feature: knock out the mushroom body and the fly
// should still smell but no longer form the memory. If this prints a large
// shift, the lesion is not actually disconnecting the pathway.
console.log('\n  ablation test (lesion mushroom body, then try to learn)');

function silenceRegion(ri) {
  const r = conn.regions[ri];
  const n0 = conn.outOffset[r.start], n1 = conn.outOffset[r.start + r.count];
  const saved = new Float32Array(n1 - n0);
  let k = 0;
  for (let e = n0; e < n1; e++) { saved[k++] = conn.outWeight[e]; conn.outWeight[e] = 0; }
  return { ri, saved, n0, n1 };
}
function restoreRegion(rec) {
  let k = 0;
  for (let e = rec.n0; e < rec.n1; e++) conn.outWeight[e] = rec.saved[k++];
}

// back to naive weights so the ablation starts from a clean slate
for (let k = 0; k < conn.plasticEdges.length; k++) {
  conn.outWeight[conn.plasticEdges[k]] = sim.baseW[k];
}
sim.traceVal.fill(0);

// Silence the Kenyon cells only: the MBONs survive and still drive
// behaviour, they just stop hearing from the mushroom body. That is the
// ablation that should abolish olfactory memory while leaving the fly
// otherwise intact.
const kcGroup = conn.groupMap.get('MB_L.KC');
const kcRegionL = conn.groupMap.get('MB_L.KC').region;
const kcRegionR = conn.groupMap.get('MB_R.KC').region;
const mbRecs = [];
for (const [key] of [['MB_L.KC'], ['MB_R.KC']]) {
  const g = conn.groupMap.get(key);
  const n0 = conn.outOffset[g.start], n1 = conn.outOffset[g.start + g.count];
  const saved = new Float32Array(n1 - n0);
  let k = 0;
  for (let e = n0; e < n1; e++) { saved[k++] = conn.outWeight[e]; conn.outWeight[e] = 0; }
  sim.setLesioned(g.start, g.count, true);
  mbRecs.push({ saved, n0, n1, start: g.start, count: g.count });
}
const lesionBefore = probe();
const lesionSnapshot = snapshotWeights();
for (let trial = 0; trial < 3; trial++) {
  sim.stimulate(conn.ensembles.odorA, 0.5, 400);
  sim.stimulate(conn.ensembles.shock, 0.6, 400);
  for (let s = 0; s < 500; s++) {
    sim.step();
    if ((s & 1) === 0) sim.plasticityStep();
    if (s % 16 === 0) sim.updateRates(16, 16);
  }
}
const lesionAfter = probe();
const lesionShift = bias(lesionAfter) - bias(lesionBefore);

// Behavioural bias is noisy at this scale, so judge the lesion by the thing
// that actually stores the memory: how far the KC→MBON weights moved
// *during training*. The snapshot has to be taken after the lesion, or a
// zeroed weight reads as a 100% change before anything has happened.
function snapshotWeights() {
  const pe = conn.plasticEdges, w = conn.outWeight;
  const snap = new Float32Array(pe.length);
  for (let k = 0; k < pe.length; k++) snap[k] = w[pe[k]];
  return snap;
}
function weightDelta(snap) {
  const pe = conn.plasticEdges, w = conn.outWeight, base = sim.baseW;
  let sum = 0;
  for (let k = 0; k < pe.length; k++) {
    if (base[k] > 0) sum += Math.abs(w[pe[k]] - snap[k]) / base[k];
  }
  return sum / Math.max(1, pe.length);
}
const dLesion = weightDelta(lesionSnapshot);

console.log(`    with MB lesioned  bias ${bias(lesionBefore).toFixed(3)} → ${bias(lesionAfter).toFixed(3)}  (shift ${lesionShift >= 0 ? '+' : ''}${lesionShift.toFixed(3)})`);
console.log(`    synapse change    ${(dLesion * 100).toFixed(2)}%  ${dLesion < 0.005 ? 'NO PLASTICITY ✓ (as expected)' : 'weights still moving — lesion ineffective'}`);

for (const rec of mbRecs) {
  restoreRegion(rec);
  sim.setLesioned(rec.start, rec.count, false);
}

// control: same training with the mushroom body intact
for (let k = 0; k < conn.plasticEdges.length; k++) {
  conn.outWeight[conn.plasticEdges[k]] = sim.baseW[k];
}
sim.traceVal.fill(0);
const intactSnapshot = snapshotWeights();
for (let trial = 0; trial < 3; trial++) {
  sim.stimulate(conn.ensembles.odorA, 0.5, 400);
  sim.stimulate(conn.ensembles.shock, 0.6, 400);
  for (let s = 0; s < 500; s++) {
    sim.step();
    if ((s & 1) === 0) sim.plasticityStep();
    if (s % 16 === 0) sim.updateRates(16, 16);
  }
}
const dIntact = weightDelta(intactSnapshot);
console.log(`    intact control    ${(dIntact * 100).toFixed(2)}%  (weights do move)`);
console.log(`    lesioned/intact   ${(dLesion * 100).toFixed(2)}% vs ${(dIntact * 100).toFixed(2)}%  ${dLesion < dIntact * 0.1 ? 'LESION BLOCKS LEARNING ✓' : 'lesion not blocking learning'}`);
console.log('');
