/**
 * sim.js — a leaky integrate-and-fire network running on the connectome.
 *
 * One step = 1 ms of biological time. Synaptic currents decay exponentially;
 * spikes arrive after an axonal delay held in a 4-slot ring buffer.
 *
 * Plasticity is a three-factor rule on the KC→MBON synapses only:
 *      dw/dt = -lr * dopamine * valence(MBON) * eligibility
 * Punishment (PPL1) therefore weakens approach-driving outputs and
 * strengthens avoidance-driving ones. That is the standard account of
 * Drosophila aversive olfactory conditioning.
 */

import { Rng } from './rng.js';

const NOISE_N = 8192;

export class Simulation {
  constructor(conn, opts = {}) {
    this.c = conn;
    const n = conn.n;

    this.v = new Float32Array(n);
    this.I = new Float32Array(n);
    this.ref = new Uint8Array(n);
    this.glow = new Float32Array(n);
    this.lastSpike = new Int32Array(n).fill(-1e9);
    this.bucket = [
      new Float32Array(n), new Float32Array(n),
      new Float32Array(n), new Float32Array(n),
    ];

    // Precomputed noise (cheaper than calling the RNG 166k times per step).
    const r = new Rng(opts.seed ?? 1234);
    this.noise = new Float32Array(NOISE_N);
    for (let i = 0; i < NOISE_N; i++) this.noise[i] = r.gauss();
    this.noiseCursor = 0;

    this.decayM = Math.exp(-1 / (opts.tauM ?? 20));      // membrane, 20 ms
    this.decayS = Math.exp(-1 / (opts.tauS ?? 5));       // synaptic, 5 ms
    // Tuned with tools/tune.mjs: baseline ~1.5 Hz, no runaway up to 0.27.
    this.gain = opts.gain ?? 0.25;
    this.inhibScale = opts.inhibScale ?? 1.55;
    this.refractory = opts.refractory ?? 4;
    this.drive = opts.drive ?? 0.030;                    // subthreshold noise
    // Sparse, strong spontaneous kicks: without them the network is silent.
    this.kickThresh = opts.kickThresh ?? 3.0;            // in gaussian sigmas
    this.kickAmp = opts.kickAmp ?? 1.25;
    this.vThresh = 1;
    this.vReset = -0.15;

    this.fired = new Int32Array(Math.max(1024, n >> 2));
    this.firedCount = 0;
    this.si = 0;                                          // step counter (ms)

    this.stims = [];

    // Who is dopaminergic, and with what sign: PPL1 = punishment (+),
    // PAM = reward (-). This is the teaching signal for KC→MBON plasticity.
    this.daSign = new Float32Array(n);
    this.danN = 0;
    for (const g of conn.groupList) {
      if (g.k === 'PPL1' || g.k === 'PAM') {
        const s = g.k === 'PPL1' ? 1 : -1;
        for (let i = g.start; i < g.start + g.count; i++) { this.daSign[i] = s; }
        this.danN += g.count;
      }
    }
    this.danN = Math.max(1, this.danN);

    // Plasticity
    this.lr = opts.lr ?? 0.003;
    this.plasticity = true;
    const nPlastic = conn.plasticEdges.length;
    this.traceVal = new Float32Array(nPlastic);
    this.traceTime = new Int32Array(nPlastic);
    this.baseW = new Float32Array(nPlastic);
    for (let k = 0; k < nPlastic; k++) this.baseW[k] = conn.outWeight[conn.plasticEdges[k]];
    this.traceDecay = Math.exp(-1 / 90);

    // Neurons whose outputs have been surgically silenced. Plasticity must
    // skip them, or a lesioned synapse quietly regrows during training.
    this.lesioned = new Uint8Array(n);

    // Rolling list of recently active Kenyon cells (plasticity work list).
    this.kcMask = new Uint8Array(n);
    for (const g of conn.groupList) {
      if (g.k === 'KC') this.kcMask.fill(1, g.start, g.start + g.count);
    }
    this.kcList = new Int32Array(8192);
    this.kcTime = new Int32Array(8192);
    this.kcCount = 0;
    this.dopamine = 0;
    this.daDecay = Math.exp(-1 / 120);

    // Readouts
    this.regionSpikes = new Float32Array(conn.regions.length);
    this.regionRate = new Float32Array(conn.regions.length);
    this.poolSpikes = new Float32Array(10);
    this.poolRate = new Float32Array(10);
    this.poolN = new Float32Array(10).fill(1);
    for (let i = 0; i < n; i++) {
      const p = conn.poolOf[i];
      if (p >= 0) this.poolN[p]++;
    }
    this.spikeCount = 0;
    this.spikeRate = 0;
    this.approachRate = 0;
    this.avoidRate = 0;

    this.approachCount = 0;
    this.avoidCount = 0;
    this.approachN = 0;
    this.avoidN = 0;
    for (let i = 0; i < n; i++) {
      const v = conn.valence[i];
      if (v > 0) this.approachN++;
      else if (v < 0) this.avoidN++;
    }
    this.approachN = Math.max(1, this.approachN);
    this.avoidN = Math.max(1, this.avoidN);
  }

  // ------------------------------------------------------------- stimuli
  /** Drive a set of neurons with `amp` per ms for `ms` milliseconds. */
  stimulate(indices, amp, ms = 300) {
    if (!indices || !indices.length) return;
    this.stims.push({
      idx: indices instanceof Int32Array ? indices : Int32Array.from(indices),
      amp, ttl: ms,
    });
    if (this.stims.length > 24) this.stims.shift();
  }

  stimulateRegion(regionIndex, amp, ms = 300) {
    const r = this.c.regions[regionIndex];
    if (!r) return;
    const idx = new Int32Array(r.count);
    for (let i = 0; i < r.count; i++) idx[i] = r.start + i;
    this.stimulate(idx, amp, ms);
  }

  clearStims() { this.stims.length = 0; }

  // ---------------------------------------------------------------- step
  step() {
    const c = this.c, n = c.n;
    const v = this.v, I = this.I, ref = this.ref, glow = this.glow;
    const off = c.outOffset, tgt = c.outTarget, w = c.outWeight, dly = c.outDelay;
    const regionOf = c.regionOf, valence = c.valence, poolOf = c.poolOf;

    const si = this.si;
    const B = this.bucket;
    const arr = B[si & 3];
    const decayM = this.decayM, decayS = this.decayS, gain = this.gain;
    const thresh = this.vThresh, reset = this.vReset;

    // pending stimuli
    if (this.stims.length) {
      for (let s = this.stims.length - 1; s >= 0; s--) {
        const st = this.stims[s];
        const idx = st.idx;
        for (let k = 0; k < idx.length; k++) arr[idx[k]] += st.amp;
        if (--st.ttl <= 0) this.stims.splice(s, 1);
      }
    }

    // spontaneous drive, refreshed every 4 ms
    const noiseOn = (si & 3) === 0;
    const drive = this.drive * 4;
    const noise = this.noise;
    const kickThresh = this.kickThresh, kickAmp = this.kickAmp;
    let nc = this.noiseCursor;

    const fired = this.fired, firedCap = fired.length;
    const lastSpike = this.lastSpike;
    const daSign = this.daSign, kcMask = this.kcMask;
    let fc = 0;
    const regionSpikes = this.regionSpikes, poolSpikes = this.poolSpikes;
    let apC = 0, avC = 0, daAcc = 0;

    for (let i = 0; i < n; i++) {
      let cur = I[i] * decayS + arr[i];
      arr[i] = 0;
      I[i] = cur;

      let vi = v[i];
      if (ref[i] > 0) {
        ref[i]--;
        vi = reset;
      } else {
          vi = vi * decayM + cur * gain;
        if (noiseOn) {
          const nz = noise[nc++ & (NOISE_N - 1)];
          vi += drive * nz;
          if (nz > kickThresh) vi += kickAmp;   // spontaneous release
        }
        if (vi >= thresh) {
          vi = reset;
          ref[i] = this.refractory;
          if (fc < firedCap) fired[fc++] = i;
          lastSpike[i] = si;
          glow[i] = 1;
          regionSpikes[regionOf[i]] += 1;
          const p = poolOf[i];
          if (p >= 0) poolSpikes[p] += 1;
          const vv = valence[i];
          if (vv > 0) apC++; else if (vv < 0) avC++;
          const ds = daSign[i];
          if (ds !== 0) daAcc += ds;
          if (kcMask[i] && this.kcCount < 8192) {
            this.kcList[this.kcCount] = i;
            this.kcTime[this.kcCount] = si;
            this.kcCount++;
          }
        }
      }
      v[i] = vi;
      glow[i] *= 0.94;
    }
    this.noiseCursor = nc;
    this.firedCount = fc;
    this.spikeCount += fc;
    this.approachCount += apC;
    this.avoidCount += avC;

    // deliver spikes
    const inhibScale = this.inhibScale;
    const outWeightSign = c.inhibitory;
    const b1 = B[(si + 1) & 3], b2 = B[(si + 2) & 3], b3 = B[(si + 3) & 3], b0 = B[si & 3];
    for (let k = 0; k < fc; k++) {
      const s = fired[k];
      const sign = outWeightSign[s] ? -inhibScale : 1;
      const e0 = off[s], e1 = off[s + 1];
      for (let e = e0; e < e1; e++) {
        const x = w[e] * sign;
        const t = tgt[e];
        switch (dly[e]) {
          case 1: b1[t] += x; break;
          case 2: b2[t] += x; break;
          case 3: b3[t] += x; break;
          default: b0[t] += x; break;
        }
      }
    }

    // Dopamine level: saturating, signed, driven by the DANs themselves.
    // Positive = punishment (PPL1 dominant), negative = reward (PAM).
    const daInstant = (daAcc / this.danN) * 50;
    let da = this.dopamine + (daInstant - this.dopamine) * 0.02;
    this.dopamine = da > 3 ? 3 : (da < -3 ? -3 : da);
    this.si++;
    return fc;
  }

  /** Dopamine is supplied by the caller from DAN activity (see updateRates). */
  setDopamine(x) { this.dopamine = x; }

  /**
   * Eligibility trace + weight update, every 2 ms.
   *
   * Only synapses belonging to Kenyon cells that spiked in the last few ms
   * are visited, so cost tracks *activity*, not network size. Traces are
   * stored with a timestamp and decayed lazily on access.
   */
  plasticityStep() {
    if (!this.plasticity) return;
    const c = this.c;
    const m = c.plasticEdges.length;
    if (!m) return;

    const si = this.si;
    const trVal = this.traceVal, trTime = this.traceTime;
    const slot = c.plasticSlot, outPlastic = c.outPlastic;
    const off = c.outOffset, outTarget = c.outTarget, outWeight = c.outWeight;
    const last = this.lastSpike, valence = c.valence;
    const dec = this.traceDecay, da = this.dopamine, lr = this.lr;
    const lesioned = this.lesioned;

    // Expire Kenyon-cell spikes older than the pairing window.
    const kcL = this.kcList, kcT = this.kcTime;
    let w = 0;
    for (let j = 0; j < this.kcCount; j++) {
      if (si - kcT[j] < 8) { kcT[w] = kcT[j]; kcL[w] = kcL[j]; w++; }
    }
    this.kcCount = w;

    for (let j = 0; j < w; j++) {
      const s = kcL[j];
      if (lesioned[s]) continue;      // a cut axon must stay cut
      for (let e = off[s]; e < off[s + 1]; e++) {
        if (!outPlastic[e]) continue;
        const k = slot[e];
        const t = outTarget[e];
        const age = si - trTime[k];
        let tr = age > 0 ? trVal[k] * Math.pow(dec, age) : trVal[k];
        if (si - last[t] < 8) tr += 0.5;
        if (tr > 4) tr = 4;
        trVal[k] = tr;
        trTime[k] = si;
        if (da !== 0 && tr > 0.002) {
          const w0 = this.baseW[k];
          let nw = outWeight[e] - lr * da * valence[t] * tr * w0;
          if (nw < 0) nw = 0;
          else if (nw > w0 * 4) nw = w0 * 4;
          outWeight[e] = nw;
        }
      }
    }
  }

  /** Per-frame summary statistics. Call once per animation frame. */
  updateRates(dtMs, steps) {
    const c = this.c;
    const perSec = 1000 / Math.max(1, dtMs);
    const a = 1 - Math.exp(-dtMs / 120);
    for (let r = 0; r < c.regions.length; r++) {
      const reg = c.regions[r];
      const rate = (this.regionSpikes[r] / Math.max(1, reg.count)) * perSec;
      this.regionRate[r] += (rate - this.regionRate[r]) * a;
      this.regionSpikes[r] = 0;
    }
    for (let p = 0; p < 10; p++) {
      const rate = (this.poolSpikes[p] / this.poolN[p]) * perSec;
      this.poolRate[p] += (rate - this.poolRate[p]) * a;
      this.poolSpikes[p] = 0;
    }
    this.spikeRate = this.spikeCount * perSec / Math.max(1, steps);
    this.spikeCount = 0;

    const ap = this.approachCount / this.approachN;
    const av = this.avoidCount / this.avoidN;
    this.approachRate += (ap - this.approachRate) * a;
    this.avoidRate += (av - this.avoidRate) * a;
    this.approachCount = 0;
    this.avoidCount = 0;
  }

  /** Turn motor-pool firing rates into something a fly can do. */
  readBehavior() {
    const P = this.c.POOL;
    const pr = this.poolRate;
    const legL = pr[P.LEG_L], legR = pr[P.LEG_R];
    const wingL = pr[P.WING_L], wingR = pr[P.WING_R];
    const legs = legL + legR;
    return {
      walk: Math.min(1, legs / 45),
      turn: legs > 0.5 ? clamp((legR - legL) / (legs + 1), -1, 1) : 0,
      wing: Math.min(1, (wingL + wingR) / 40),
      wingAsym: Math.abs(wingL - wingR) / (wingL + wingR + 1),
      jump: pr[P.JUMP] > 12 ? 1 : 0,
      proboscis: Math.min(1, pr[P.PROB] / 25),
      abdomen: Math.min(1, pr[P.ABD] / 30),
      song: Math.min(1, pr[P.SONG] / 12),
      dnL: pr[P.DN_L], dnR: pr[P.DN_R],
    };
  }

  /** Silence (or unsilence) a contiguous run of neurons. */
  setLesioned(start, count, on) {
    this.lesioned.fill(on ? 1 : 0, start, start + count);
  }

  reset() {
    this.v.fill(0);
    this.I.fill(0);
    this.ref.fill(0);
    this.glow.fill(0);
    for (const b of this.bucket) b.fill(0);
    this.stims.length = 0;
    this.lastSpike.fill(-1e9);
  }
}

function lastSpikeSet(arr, i, t) { arr[i] = t; }
function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
