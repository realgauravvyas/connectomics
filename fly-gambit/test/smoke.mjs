/*
 * Node smoke test: vm-loads connectome.js + chessai.js and verifies
 * (1) one full self-play game without NaN, (2) capture rate rises with
 * training (the fly learns), (3) softmax normalizes, (4) eval works.
 * Run: node test/smoke.mjs
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { Chess } from '../vendor/chess.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = {
  Math, JSON, Float32Array, Uint32Array, Uint8Array, Array, Object,
  String, Number, Boolean, Error, isNaN, parseFloat, parseInt, console,
  Infinity, NaN, undefined, Chess
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const load = rel => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
load('js/connectome.js');
load('js/chessai.js');
const { FG } = sandbox;

const c = new Chess();
if (c.moves().length !== 20) throw new Error('chess.js broken');

const t = new FG.FlyTrainer();
let g = t.beginGame();
while (t.stepGame(g, 1.0)) { if (g.over) break; }
const res = t.finishGame(g);
if (!res) throw new Error('no result');
const W = t.brain.L1.W;
for (let i = 0; i < W.length; i++) {
  if (!isFinite(W[i])) throw new Error('NaN/Inf weight at L1[' + i + '] after 1 game');
}
console.log('single game OK:', res.moves, 'plies, winner', res.winner);

const run = n => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const gg = t.beginGame();
    while (t.stepGame(gg, 1.0)) if (gg.over) break;
    out.push(t.finishGame(gg).captureRate);
  }
  return out;
};
const e = run(25), l = run(75);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
console.log('capture rate first25:', mean(e).toFixed(3), ' next75:', mean(l).toFixed(3));

for (let i = 0; i < W.length; i++) if (!isFinite(W[i])) throw new Error('NaN weight after 100 games');
const ccW = t.brain.CC.W;
for (let i = 0; i < ccW.length; i++) if (!isFinite(ccW[i])) throw new Error('NaN CC weight');
const vW = t.brain.VOut.W;
for (let i = 0; i < vW.length; i++) if (!isFinite(vW[i])) throw new Error('NaN VOut weight');

console.log('agreement vs greedy:', t.accVsGreedy.toFixed(3));
t.brain.forwardState(FG.encodeState(new Chess()));
const sc = t.brain.scoreMoves(FG.encodeMoves(new Chess()).feats, 0.3);
let sum = 0;
for (let i = 0; i < sc.probs.length; i++) sum += sc.probs[i];
if (Math.abs(sum - 1) > 1e-4) throw new Error('probs not normalized');

const ev = t.evalVsGreedy(4);
console.log('eval vs greedy-capture bot: ' + ev.toFixed(2) + ' score');

const pass = mean(l) >= mean(e);
console.log(pass ? 'PASS: fly is learning to capture' : 'FAIL: capture rate did not improve',
  '(' + mean(e).toFixed(3) + ' -> ' + mean(l).toFixed(3) + ')');
process.exit(pass ? 0 : 1);
