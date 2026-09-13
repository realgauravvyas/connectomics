// scratch benchmark — is the machine slow or is my loop slow?
const n = 45000;
const v = new Float32Array(n);
const I = new Float32Array(n);
let t = Date.now();
let acc = 0;
for (let s = 0; s < 1000; s++) {
  for (let i = 0; i < n; i++) {
    const cur = I[i] * 0.8 + 0.001;
    I[i] = cur;
    let vi = v[i] * 0.95 + cur * 0.055;
    if (vi > 1) vi = -0.15;
    v[i] = vi;
    acc += vi;
  }
}
console.log('1000 x 45k LIF steps:', Date.now() - t, 'ms   acc', acc.toFixed(3));

// rng speed
import { Rng } from '../js/rng.js';
const r = new Rng(1);
t = Date.now();
let x = 0;
for (let i = 0; i < 630000; i++) x += r.lognormal(-0.2, 0.75);
console.log('630k lognormals:', Date.now() - t, 'ms  x', x.toFixed(1));

// edge build speed
const src = new Int32Array(630000);
const tgt = new Int32Array(630000);
t = Date.now();
for (let i = 0; i < 630000; i++) { src[i] = r.int(n); tgt[i] = r.int(n); }
console.log('630k edge pairs:', Date.now() - t, 'ms');
