/*
 * FlySprint - sim.js
 * A tiny recurrent MLP gait controller + race physics, optimized by a
 * genetic algorithm. Each fly "lane" is an independent lineage that
 * evolves its own running style for the selected event.
 *
 * Brain:  10 -> 6 -> 4 (tanh / sigmoid), 90 weights.
 * Outputs: thrust, stride-frequency modulation, jump, pace.
 * The leg gate follows a hip-oscillator phase (CPG-like); force is only
 * applied on the ground, so airborne time costs speed -> jumping must be
 * learned, not spammed. Stumbling into a hurdle kills most of the speed.
 *
 * Pure math - no DOM - Node-testable.
 */
(function (global) {
  'use strict';

  var NI = 10, NH = 6, NO = 4, NW = NI * NH + NH + NH * NO + NO; // 90
  var DT = 1 / 45;
  var FMAX = 13.0, DRAG = 0.024, ROLL = 0.20, GRAV = 9.81, JUMPV = 4.7;

  var EVENTS = {
    '100m':  { name: '100 m Dash',    len: 100, hFirst: 0, hEvery: 0, hN: 0, hH: 0 },
    '200m':  { name: '200 m Dash',    len: 200, hFirst: 0, hEvery: 0, hN: 0, hH: 0 },
    '400m':  { name: '400 m Endurance', len: 400, hFirst: 0, hEvery: 0, hN: 0, hH: 0 },
    '100mH': { name: '100 m Hurdles', len: 100, hFirst: 13, hEvery: 8.5, hN: 10, hH: 0.84 }
  };

  function randn() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function sig(x) { return 1 / (1 + Math.exp(-x)); }

  function randomWeights() {
    var w = new Float32Array(NW);
    for (var i = 0; i < NW; i++) w[i] = randn() * 0.9;
    return w;
  }

  /* forward pass; writes hidden+out into `out` (len NH+NO), returns o offset */
  function brainForward(w, x, out) {
    var p = 0, i, j;
    for (i = 0; i < NH; i++) {
      var s = w[NI * NH + i];
      for (j = 0; j < NI; j++) s += w[j * NH + i] * x[j];
      out[i] = Math.tanh(s);
    }
    var off = NH;
    for (i = 0; i < NO; i++) {
      s = w[NI * NH + NH + NH * NO + i];
      for (j = 0; j < NH; j++) s += w[NI * NH + NH + j * NO + i] * out[j];
      out[off + i] = sig(s);
    }
    return off;
  }

  function hurdleX(cfg, i) { return cfg.hFirst + i * cfg.hEvery; }

  /* Step-by-step engine: one physics tick at a time, for live animation. */
  function Engine(w, cfg) {
    this.w = w; this.cfg = cfg;
    this.theta = 0; this.v = 0; this.x = 0; this.y = 0; this.vy = 0;
    this.air = false; this.E = 1; this.t = 0;
    this.stumbles = 0; this.clearedN = 0; this.done = false; this.finished = false;
    this.cap = cfg.len / 2.8 + 14;
    this.clearedFlag = new Uint8Array(cfg.hN || 1);
    this.xin = new Float32Array(NI);
    this.act = new Float32Array(NH + NO);
    this.prevPush = 0; this.prevJump = 0;
    this.st = { x: 0, y: 0, v: 0, theta: 0, E: 1, o0: 0, jump: 0, air: false,
      stumbles: 0, time: 0, done: false, stumbleEv: false, clearEv: false, finishEv: false, gap: 1 };
  }
  Engine.prototype.step = function () {
    if (this.done) return null;
    var cfg = this.cfg, w = this.w, x = this.xin, act = this.act, st = this.st;
    var hN = cfg.hN, nextH = -1;
    for (var h = 0; h < hN; h++) {
      var hx = hurdleX(cfg, h);
      if (!this.clearedFlag[h] && hx > this.x) { nextH = hx; break; }
    }
    var gap = nextH > 0 ? Math.max(0, Math.min(1, (nextH - this.x) / 8.5)) : 1;
    x[0] = Math.sin(this.theta); x[1] = Math.cos(this.theta); x[2] = this.v / 9.5;
    x[3] = this.E; x[4] = (cfg.len - this.x) / cfg.len; x[5] = gap;
    x[6] = this.air ? 1 : 0; x[7] = this.prevPush; x[8] = this.prevJump;
    x[9] = hN ? this.clearedN / hN : 0;

    brainForward(w, x, act);
    var o0 = act[NH], o1 = act[NH + 1], o2 = act[NH + 2], o3 = act[NH + 3];
    this.prevPush = o0; this.prevJump = o2;

    this.theta += DT * (6.5 + this.v * 0.55 + (o1 - 0.5) * 7.0);
    var gs = Math.sin(this.theta);
    var gate = gs > 0 ? gs * gs * Math.sqrt(gs) : 0;
    var thrust = 0;
    if (!this.air) {
      thrust = o0 * gate * FMAX * (0.62 + 0.38 * (0.5 + o3 / 2)) * (0.30 + 0.70 * this.E);
      this.E -= DT * (0.105 * o0 * (0.35 + gate));
      if (o0 < 0.4) this.E += DT * 0.02;
    } else {
      this.E += DT * 0.012;
    }
    this.E = Math.max(0, Math.min(1, this.E));
    this.v += DT * (thrust - DRAG * this.v * this.v - ROLL * this.v);
    if (this.v < 0) this.v = 0;
    var px = this.x;
    this.x += this.v * DT;

    if (!this.air && gap < 0.55 && o2 > (gap < 0.3 ? 0.15 : 0.5)) {
      this.vy = JUMPV; this.air = true;
    }
    if (this.air) {
      this.y += this.vy * DT; this.vy -= GRAV * DT;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.air = false; }
    }

    st.stumbleEv = false; st.clearEv = false; st.finishEv = false;
    for (var h2 = 0; h2 < hN; h2++) {
      var hx2 = hurdleX(cfg, h2);
      if (!this.clearedFlag[h2] && this.x >= hx2 && px < hx2) {
        this.clearedFlag[h2] = 1;
        if (this.y > cfg.hH) { this.clearedN++; st.clearEv = true; }
        else { this.stumbles++; this.v *= 0.3; st.stumbleEv = true; this.y = 0; this.vy = 0; this.air = false; }
      }
    }
    this.t += DT;
    if (this.x >= cfg.len) {
      this.done = true; this.finished = true; st.finishEv = true;
    } else if (this.t >= this.cap) {
      this.done = true; this.finished = false; st.finishEv = true;
    }
    st.x = this.x; st.y = this.y; st.v = this.v; st.theta = this.theta;
    st.E = this.E; st.o0 = o0; st.jump = o2; st.air = this.air;
    st.stumbles = this.stumbles; st.time = this.t; st.done = this.done; st.gap = gap;
    return st;
  };
  Engine.prototype.result = function () {
    return {
      time: this.finished ? this.t : this.cap + 20,
      finished: this.finished, dist: this.x,
      stumbles: this.stumbles, cleared: this.clearedN
    };
  };

  /* full-race simulation (training fitness + headless tests) */
  function runRace(w, cfg, onTick) {
    var e = new Engine(w, cfg), st;
    while ((st = e.step()) && !e.done) {
      if (onTick) onTick({ t: e.t, x: e.x, y: e.y, v: e.v, theta: e.theta, E: e.E,
        o: st.o0, jump: st.jump, air: e.air, stumbles: e.stumbles, gap: st.gap });
    }
    return e.result();
  }

  function fitness(w, cfg) {
    var r = runRace(w, cfg);
    return r.time + r.stumbles * 0.8 + (r.finished ? 0 : 30);
  }

  /* ---------------- GA ---------------- */
  function Lineage(eventKey, popSize) {
    this.cfg = EVENTS[eventKey];
    this.eventKey = eventKey;
    this.pop = [];
    this.fits = [];
    for (var i = 0; i < popSize; i++) {
      this.pop.push(randomWeights());
      this.fits.push(0);
    }
    this.evalAll();
    this.gen = 0;
    this.bestHist = [];   // {gen, time, stumbles}
    this.sigma = 0.18;
  }

  Lineage.prototype.evalAll = function () {
    for (var i = 0; i < this.pop.length; i++) this.fits[i] = fitness(this.pop[i], this.cfg);
    this.sort();
  };
  Lineage.prototype.sort = function () {
    var idx = this.pop.map(function (_, i) { return i; });
    var f = this.fits;
    idx.sort(function (a, b) { return f[a] - f[b]; });
    var np = [], nf = [];
    for (var k = 0; k < idx.length; k++) { np.push(this.pop[idx[k]]); nf.push(this.fits[idx[k]]); }
    this.pop = np; this.fits = nf;
  };
  Lineage.prototype.champion = function () { return this.pop[0]; };
  Lineage.prototype.champResult = function () {
    return runRace(this.pop[0], this.cfg);
  };
  Lineage.prototype.bestTime = function () { return this.fits[0]; };

  Lineage.prototype.evolveOne = function () {
    this.beginGen();
    while (!this.genFinished()) this.evalMore(4);
  };

  /* frame-sliceable generation:
   * beginGen() builds the next population (cheap), then evalMore(k) runs
   * k evaluations; the generation completes once all are done. */
  Lineage.prototype.beginGen = function () {
    if (this._pending) return;
    var n = this.pop.length, k;
    this.bestHist.push({ gen: this.gen, time: this.fits[0], stumbles: 0 });
    if (this.bestHist.length > 240) this.bestHist.shift();
    var next = [];
    for (k = 0; k < 3; k++) next.push(this.pop[k].slice(0));
    var self = this;
    function tournament() {
      var best = (Math.random() * n) | 0;
      for (var q = 0; q < 3; q++) {
        var c = (Math.random() * n) | 0;
        if (self.fits[c] < self.fits[best]) best = c;
      }
      return self.pop[best];
    }
    while (next.length < n) {
      var p1 = tournament(), p2 = tournament();
      var child = new Float32Array(NW);
      for (k = 0; k < NW; k++) child[k] = Math.random() < 0.5 ? p1[k] : p2[k];
      for (k = 0; k < NW; k++) if (Math.random() < 0.35) child[k] += randn() * this.sigma;
      next.push(child);
    }
    this.sigma = Math.max(0.03, this.sigma * 0.992);
    this._pending = next;
    this._pendFits = [];
  };
  Lineage.prototype.evalMore = function (count) {
    if (!this._pending) return this._pending === undefined; // no gen in progress
    var end = Math.min(this._pending.length, this._pendFits.length + count);
    for (var i = this._pendFits.length; i < end; i++) {
      this._pendFits.push(fitness(this._pending[i], this.cfg));
    }
    if (this._pendFits.length >= this._pending.length) {
      this.pop = this._pending; this.fits = this._pendFits;
      this._pending = null; this._pendFits = null;
      this.sort();
      this.gen++;
      return true;
    }
    return false;
  };
  Lineage.prototype.genFinished = function () { return !this._pending; };

  function exportTo(o) {
    o.EVENTS = EVENTS; o.Lineage = Lineage; o.runRace = runRace;
    o.Engine = Engine;
    o.brainForward = brainForward; o.randomWeights = randomWeights;
    o.SPEC = { NI: NI, NH: NH, NO: NO, NW: NW, DT: DT };
    o.hurdleX = hurdleX;
  }
  global.FG = global.FG || {};
  exportTo(global.FG);
})(typeof window !== 'undefined' ? window : globalThis);
