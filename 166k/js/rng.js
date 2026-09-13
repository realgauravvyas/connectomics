/**
 * rng.js — deterministic pseudo-random number generation.
 *
 * Every visitor, every reload, every machine must grow the *same* brain.
 * That only works if the generator is seeded and platform independent,
 * so we use our own xorshift32 instead of Math.random().
 */

export class Rng {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  u32() {
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    this.s = x;
    return x;
  }

  /** Uniform in [0,1) */
  float() {
    return this.u32() / 4294967296;
  }

  /** Uniform in [a,b) */
  range(a, b) {
    return a + (b - a) * this.float();
  }

  /** Integer in [0,n) */
  int(n) {
    return (this.u32() % n) | 0;
  }

  /** Standard normal (Box–Muller) */
  gauss() {
    let u = 0;
    while (u === 0) u = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.float());
  }

  /** Heavy tailed — used for synaptic weights and "hubness" of neurons. */
  lognormal(mu = 0, sigma = 1) {
    return Math.exp(mu + sigma * this.gauss());
  }

  pick(arr) {
    return arr[this.int(arr.length)];
  }

  /** True with probability p */
  chance(p) {
    return this.float() < p;
  }
}

/** Turn a string into a 32-bit seed (FNV-1a). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
