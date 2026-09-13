/*
 * FlySprint smoke test: GA must improve 100m times, hurdle champions must
 * clear all 10 hurdles with zero stumbles, and no NaN may appear.
 * Run: node test/smoke.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
new Function(fs.readFileSync(path.join(root, 'js/sim.js'), 'utf8'))();
const { FG } = globalThis;

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

// 100m: trained must be clearly faster than untrained
const lin = new FG.Lineage('100m', 16);
const untrained = lin.bestTime();
const curve = [];
for (let g = 0; g < 90; g++) { lin.evolveOne(); curve.push(lin.bestTime()); }
const final = lin.bestTime();
console.log('100m: untrained ' + untrained.toFixed(1) + 's -> 90 gens ' + final.toFixed(1) + 's');
for (const w of lin.champion()) if (!isFinite(w)) throw new Error('NaN weight in champion');
if (!(final < untrained - 2)) throw new Error('FAIL: 100m GA did not improve');
if (final > 15) throw new Error('FAIL: 100m too slow to be fun: ' + final);

// monotonic-ish improvement in the tail
if (mean(curve.slice(70)) > mean(curve.slice(0, 15))) throw new Error('FAIL: no late improvement');

// hurdles: champion must clear everything
const lh = new FG.Lineage('100mH', 16);
for (let g = 0; g < 130; g++) lh.evolveOne();
const rh = lh.champResult();
console.log('100mH: best ' + lh.bestTime().toFixed(1) + 's, cleared ' + rh.cleared + '/10, stumbles ' + rh.stumbles);
if (!rh.finished || rh.stumbles > 0 || rh.cleared !== 10) throw new Error('FAIL: hurdle champion does not clear the track');

// determinism: same weights -> same time (photo finishes are honest)
const r2 = FG.runRace(lh.champion(), FG.EVENTS['100mH']);
if (Math.abs(r2.time - lh.bestTime()) > 1e-4) throw new Error('FAIL: race not deterministic');

// 200m quick sanity
const l2 = new FG.Lineage('200m', 14);
for (let g = 0; g < 50; g++) l2.evolveOne();
console.log('200m: ' + l2.bestTime().toFixed(1) + 's after 50 gens');
if (l2.bestTime() > 40) throw new Error('FAIL: 200m not improving');

console.log('PASS: flies evolve faster, hurdle champions fly clean');
