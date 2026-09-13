/*
 * FlyGambit - connectome.js
 * Sparse neural network whose topology is modeled after the male Drosophila
 * connectome (FlyWire/FAFB). Layers are named after real fly-brain regions:
 *
 *   Optic layers (773)  -> input: piece planes over the 64 squares + state
 *   Lobula complex (256)-> hidden 1, sparse fan-in k=20  ("visual feature extraction")
 *   Mushroom body (128) -> hidden 2, sparse fan-in k=20  ("memory / judgment")
 *   Central complex (64)-> dense action head per move    ("action selection")
 *   V3/BetaOut (32 -> 1) -> value baseline              ("expected outcome")
 *
 * Trained with policy-gradient (REINFORCE + value baseline) on discounted
 * returns with a dense material-capture shaping reward.
 * No DOM, no THREE - pure math, Node-testable.
 */
(function (global) {
  'use strict';

  var STATE_DIM = 773;   // 12 piece planes * 64 + turn + 4 castling rights
  var ACT_DIM = 132;     // from(64) + to(64) + promo + capture + castle + check
  var N1 = 256, K1 = 20;
  var N2 = 128, K2 = 20;
  var NCC = 64;          // central complex (dense)
  var NV = 32;           // value head hidden

  function randn() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* Sparse layer: each neuron samples K unique inputs from inDim. */
  function SparseLayer(inDim, n, k) {
    this.inDim = inDim; this.n = n; this.k = k;
    this.idx = new Uint32Array(n * k);
    this.W = new Float32Array(n * k);
    this.b = new Float32Array(n);
    this.gW = new Float32Array(n * k);
    this.gb = new Float32Array(n);
    this.mW = new Float32Array(n * k);
    this.vW = new Float32Array(n * k);
    this.mb = new Float32Array(n);
    this.vb = new Float32Array(n);
    var scale = Math.sqrt(2 / k);
    for (var i = 0; i < n; i++) {
      var start = i * k;
      var used = {};
      for (var j = 0; j < k; j++) {
        var pick;
        do { pick = (Math.random() * inDim) | 0; } while (used[pick]);
        used[pick] = 1;
        this.idx[start + j] = pick;
        this.W[start + j] = randn() * scale;
      }
    }
  }
  SparseLayer.prototype.forward = function (x, z, h) {
    var n = this.n, k = this.k, idx = this.idx, W = this.W, b = this.b;
    for (var i = 0; i < n; i++) {
      var s = b[i], o = i * k;
      for (var j = 0; j < k; j++) s += W[o + j] * x[idx[o + j]];
      z[i] = s; h[i] = s > 0 ? s : 0;
    }
  };
  /* dh: dL/dh (n). Accumulates gW/gb; returns nothing (input grads not needed
   * for layer 0; for layer 1 the caller folds grads via dx if provided). */
  SparseLayer.prototype.backward = function (x, z, dh, dx) {
    var n = this.n, k = this.k, idx = this.idx, W = this.W, gW = this.gW, gb = this.gb;
    for (var i = 0; i < n; i++) {
      var d = dh[i] * (z[i] > 0 ? 1 : 0);
      if (d === 0) continue;
      gb[i] += d;
      var o = i * k;
      for (var j = 0; j < k; j++) {
        var ix = idx[o + j];
        gW[o + j] += d * x[ix];
        if (dx) dx[ix] += d * W[o + j];
      }
    }
  };
  SparseLayer.prototype.stepAdam = function (adam) {
    sparseAdam(adam, this.W, this.gW, this.mW, this.vW, this.n * this.k);
    denseAdam(adam, this.b, this.gb, this.mb, this.vb, this.n);
  };
  SparseLayer.prototype.zeroGrads = function () {
    this.gW.fill(0); this.gb.fill(0);
  };

  /* Dense layer (used for the central-complex action head + value head). */
  function DenseLayer(inDim, n) {
    this.inDim = inDim; this.n = n;
    this.W = new Float32Array(inDim * n);
    this.b = new Float32Array(n);
    this.gW = new Float32Array(inDim * n);
    this.gb = new Float32Array(n);
    this.mW = new Float32Array(inDim * n);
    this.vW = new Float32Array(inDim * n);
    this.mb = new Float32Array(n);
    this.vb = new Float32Array(n);
    var scale = Math.sqrt(2 / inDim);
    for (var i = 0; i < this.W.length; i++) this.W[i] = randn() * scale;
  }
  DenseLayer.prototype.forward = function (x, z, h) {
    var n = this.n, d = this.inDim, W = this.W, b = this.b;
    for (var i = 0; i < n; i++) {
      var s = b[i], col = i;
      for (var j = 0; j < d; j++) s += W[j * n + col] * x[j];
      z[i] = s; h[i] = s > 0 ? s : 0;
    }
  };
  DenseLayer.prototype.backward = function (x, z, dh, dx) {
    var n = this.n, d = this.inDim, W = this.W, gW = this.gW, gb = this.gb;
    for (var i = 0; i < n; i++) {
      var g = dh[i] * (z[i] > 0 ? 1 : 0);
      if (g === 0) continue;
      gb[i] += g;
      for (var j = 0; j < d; j++) {
        gW[j * n + i] += g * x[j];
        if (dx) dx[j] += g * W[j * n + i];
      }
    }
  };
  DenseLayer.prototype.stepAdam = function (adam) {
    sparseAdam(adam, this.W, this.gW, this.mW, this.vW, this.W.length);
    denseAdam(adam, this.b, this.gb, this.mb, this.vb, this.n);
  };
  DenseLayer.prototype.zeroGrads = function () {
    this.gW.fill(0); this.gb.fill(0);
  };

  /* Linear head (no ReLU): 1 output. */
  function LinearHead(inDim) {
    this.inDim = inDim;
    this.W = new Float32Array(inDim);
    this.b = 0;
    this.gW = new Float32Array(inDim);
    this.gb = 0;
    this.mW = new Float32Array(inDim);
    this.vW = new Float32Array(inDim);
    this.mb = 0; this.vb = 0;
    var s = Math.sqrt(1 / inDim);
    for (var i = 0; i < inDim; i++) this.W[i] = randn() * s;
  }
  LinearHead.prototype.forward = function (x) {
    var s = this.b;
    for (var i = 0; i < this.inDim; i++) s += this.W[i] * x[i];
    return s;
  };
  LinearHead.prototype.backward = function (x, dOut, dx) {
    this.gb += dOut;
    for (var i = 0; i < this.inDim; i++) {
      this.gW[i] += dOut * x[i];
      if (dx) dx[i] += dOut * this.W[i];
    }
  };
  LinearHead.prototype.stepAdam = function (adam) {
    sparseAdam(adam, this.W, this.gW, this.mW, this.vW, this.inDim);
    this.mb = adam.beta1 * this.mb + (1 - adam.beta1) * this.gb;
    this.vb = adam.beta2 * this.vb + (1 - adam.beta2) * this.gb * this.gb;
    var mh = this.mb / (1 - Math.pow(adam.beta1, adam.t));
    var vh = this.vb / (1 - Math.pow(adam.beta2, adam.t));
    this.b -= adam.lr * mh / (Math.sqrt(vh) + adam.eps);
  };
  LinearHead.prototype.zeroGrads = function () { this.gW.fill(0); this.gb = 0; };

  function sparseAdam(ad, W, gW, mW, vW, len) {
    var b1 = ad.beta1, b2 = ad.beta2, lr = ad.lr, eps = ad.eps;
    var bc1 = 1 - Math.pow(b1, ad.t), bc2 = 1 - Math.pow(b2, ad.t);
    for (var i = 0; i < len; i++) {
      var g = gW[i];
      if (g === 0) continue;
      mW[i] = b1 * mW[i] + (1 - b1) * g;
      vW[i] = b2 * vW[i] + (1 - b2) * g * g;
      W[i] -= lr * (mW[i] / bc1) / (Math.sqrt(vW[i] / bc2) + eps);
    }
  }
  function denseAdam(ad, W, gW, mW, vW, len) {
    sparseAdam(ad, W, gW, mW, vW, len);
  }

  /* ---------------- The fly brain ---------------- */
  function FlyBrain() {
    this.optic = new Float32Array(STATE_DIM);   // input
    this.z1 = new Float32Array(N1); this.h1 = new Float32Array(N1);
    this.z2 = new Float32Array(N2); this.h2 = new Float32Array(N2);
    this.L1 = new SparseLayer(STATE_DIM, N1, K1);
    this.L2 = new SparseLayer(N1, N2, K2);
    this.CC = new DenseLayer(N2 + ACT_DIM, NCC);   // per-move, weights shared
    this.ccZ = new Float32Array(NCC); this.ccH = new Float32Array(NCC);
    this.Out = new LinearHead(NCC);
    this.V1 = new DenseLayer(N2, NV);
    this.vZ = new Float32Array(NV); this.vH = new Float32Array(NV);
    this.VOut = new LinearHead(NV);
    this.adam = { lr: 0.003, beta1: 0.9, beta2: 0.999, eps: 1e-8, t: 0 };
    this.silence = { optic: 0, lobula: 0, mb: 0, cc: 0 };
    this.opticMask = new Uint8Array(STATE_DIM).fill(1);
    this._cat = new Float32Array(N2 + ACT_DIM);
    this._dxOut = new Float32Array(NCC);
    this._dxc = new Float32Array(N2 + ACT_DIM);
    this._dxV = new Float32Array(NV);
    this._dvdx2 = new Float32Array(N2);
    this._dx1 = new Float32Array(N1);
    this.lobulaMask = new Uint8Array(N1).fill(1);
    this.mbMask = new Uint8Array(N2).fill(1);
  }

  FlyBrain.prototype.resetOpticMask = function () { this.opticMask.fill(1); };

  FlyBrain.prototype.setSilence = function (region, frac) {
    this.silence[region] = frac;
    var n = region === 'optic' ? STATE_DIM : region === 'lobula' ? N1 : N2;
    var mask = region === 'optic' ? this.opticMask
      : region === 'lobula' ? this.lobulaMask : this.mbMask;
    mask.fill(1);
    if (frac > 0) {
      var kill = Math.floor(n * frac);
      for (var i = 0; i < kill; i++) mask[(Math.random() * n) | 0] = 0;
    }
  };

  FlyBrain.SIZE = {
    optic: STATE_DIM, lobula: N1, mb: N2, cc: NCC, v: NV,
    K1: K1, K2: K2, ACT_DIM: ACT_DIM, STATE_DIM: STATE_DIM
  };
  FlyBrain.SYNAPSES = N1 * K1 + N2 * K2 + (N2 + ACT_DIM) * NCC + NCC + N2 * NV + NV;

  /* forward state: fills h1, h2; returns value estimate.
   * NOTE: optic/lobula/mb silencing is applied DETERMINISTICALLY via a fixed
   * mask (rebuild masks when toggles change) so training stays stable. */
  FlyBrain.prototype.forwardState = function (state) {
    var opt = this.optic;
    var sil = this.silence;
    if (sil.optic > 0) {
      for (var i = 0; i < STATE_DIM; i++) opt[i] = state[i] * this.opticMask[i];
    } else {
      opt.set(state);
    }
    this.L1.forward(opt, this.z1, this.h1);
    if (sil.lobula > 0) {
      for (var j = 0; j < N1; j++) if (this.lobulaMask[j] === 0) this.h1[j] = 0;
    }
    this.L2.forward(this.h1, this.z2, this.h2);
    if (sil.mb > 0) {
      for (var m = 0; m < N2; m++) if (this.mbMask[m] === 0) this.h2[m] = 0;
    }
    // value head
    this.V1.forward(this.h2, this.vZ, this.vH);
    return this.VOut.forward(this.vH);
  };

  /* scores: one per legal move; actFeats: Float32Array(ACT_DIM) per move.
   * Returns {scores, probs, caches:[{ccZ,ccH}...]}. */
  FlyBrain.prototype.scoreMoves = function (actFeats, tau) {
    var n = actFeats.length;
    var scores = new Float32Array(n);
    var caches = new Array(n);
    var cat = this._cat;
    cat.set(this.h2, 0);
    var silCC = this.silence.cc;
    for (var i = 0; i < n; i++) {
      var f = actFeats[i];
      if (silCC > 0) {
        scores[i] = Math.random() * 1e-6;
        caches[i] = { ccZ: null, ccH: null };
        continue;
      }
      cat.set(f, N2);
      this.CC.forward(cat, this.ccZ, this.ccH);
      var z = this.Out.forward(this.ccH);
      scores[i] = z;
      caches[i] = {
        ccZ: this.ccZ.slice(0), ccH: this.ccH.slice(0)
      };
    }
    var probs = new Float32Array(n);
    var maxs = -Infinity;
    for (var s = 0; s < n; s++) if (scores[s] > maxs) maxs = scores[s];
    var sum = 0;
    for (var p = 0; p < n; p++) {
      var e = Math.exp((scores[p] - maxs) / tau);
      probs[p] = e; sum += e;
    }
    for (var q = 0; q < n; q++) probs[q] /= sum;
    return { scores: scores, probs: probs, caches: caches };
  };

  /* Backprop one move's policy-gradient loss. dScores[i] = dL/dscore_i.
   * h2vec is the (snapshotted) mushroom-body activation at that ply.
   * Accumulates dL/dh2 into dLdh2. All buffers preallocated (turbo mode). */
  FlyBrain.prototype.backwardMove = function (caches, actFeats, dScores, dLdh2, h2vec) {
    if (this.silence.cc > 0) return;
    var n = caches.length;
    var dxOut = this._dxOut, dxc = this._dxc, cat = this._cat;
    for (var i = 0; i < n; i++) {
      var u = dScores[i];
      var c = caches[i];
      if (c.ccZ === null || u === 0) continue;
      cat.set(h2vec, 0);
      cat.set(actFeats[i], N2);
      this._dxOut.fill(0);
      this.Out.backward(c.ccH, u, dxOut);
      this._dxc.fill(0);
      this.CC.backward(cat, c.ccZ, dxOut, dxc);
      for (var j = 0; j < N2; j++) dLdh2[j] += dxc[j];
    }
  };

  /* Value loss 0.5*(V-G)^2 with per-ply snapshots; grads accumulate into dLdh2. */
  FlyBrain.prototype.backwardValue = function (G, h2vec, vZ, vH, Vsaved, dLdh2) {
    var dV = (Vsaved - G);
    this._dxV.fill(0);
    this.VOut.backward(vH, dV, this._dxV);
    this.V1.backward(h2vec, vZ, this._dxV, dLdh2);
  };

  /* Trunk backprop for one ply using that ply's activation snapshot. */
  FlyBrain.prototype.backpropTrunk = function (snap, dLdh2) {
    this.L2.backward(snap.h1, snap.z2, dLdh2, this._dx1);
    this.L1.backward(snap.optic, snap.z1, this._dx1, null);
    this._dx1.fill(0);
  };

  FlyBrain.prototype.zeroGrads = function () {
    this.L1.zeroGrads(); this.L2.zeroGrads(); this.CC.zeroGrads();
    this.Out.zeroGrads(); this.V1.zeroGrads(); this.VOut.zeroGrads();
  };

  FlyBrain.prototype.stepAdam = function () {
    this.adam.t++;
    this.L1.stepAdam(this.adam); this.L2.stepAdam(this.adam);
    this.CC.stepAdam(this.adam); this.Out.stepAdam(this.adam);
    this.V1.stepAdam(this.adam); this.VOut.stepAdam(this.adam);
  };

  FlyBrain.prototype.save = function () {
    return JSON.stringify({
      L1: { W: Array.from(this.L1.W), b: Array.from(this.L1.b), idx: Array.from(this.L1.idx) },
      L2: { W: Array.from(this.L2.W), b: Array.from(this.L2.b), idx: Array.from(this.L2.idx) },
      CC: { W: Array.from(this.CC.W), b: Array.from(this.CC.b) },
      Out: { W: Array.from(this.Out.W), b: this.Out.b },
      V1: { W: Array.from(this.V1.W), b: Array.from(this.V1.b) },
      VOut: { W: Array.from(this.VOut.W), b: this.VOut.b }
    });
  };
  FlyBrain.prototype.load = function (json) {
    var o = JSON.parse(json);
    this.L1.W.set(o.L1.W); this.L1.b.set(o.L1.b); this.L1.idx.set(o.L1.idx);
    this.L2.W.set(o.L2.W); this.L2.b.set(o.L2.b); this.L2.idx.set(o.L2.idx);
    this.CC.W.set(o.CC.W); this.CC.b.set(o.CC.b);
    this.Out.W.set(o.Out.W); this.Out.b = o.Out.b;
    this.V1.W.set(o.V1.W); this.V1.b.set(o.V1.b);
    this.VOut.W.set(o.VOut.W); this.VOut.b = o.VOut.b;
  };

  function sampleIndex(probs) {
    var r = Math.random(), acc = 0;
    for (var i = 0; i < probs.length; i++) { acc += probs[i]; if (r < acc) return i; }
    return probs.length - 1;
  }
  function argmaxIndex(a) {
    var bi = 0;
    for (var i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i;
    return bi;
  }
  function entropy(probs) {
    var e = 0;
    for (var i = 0; i < probs.length; i++) if (probs[i] > 1e-9) e -= probs[i] * Math.log(probs[i]);
    return e;
  }

  global.FG = global.FG || {};
  global.FG.FlyBrain = FlyBrain;
  global.FG.sampleIndex = sampleIndex;
  global.FG.argmaxIndex = argmaxIndex;
  global.FG.entropy = entropy;
  global.FG.randn = randn;
})(typeof window !== 'undefined' ? window : globalThis);
