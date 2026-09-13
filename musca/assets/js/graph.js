/* ==========================================================================
   graph.js — activity propagation + reverse pathway search over the connectome

   The connectome here is a *directed weighted graph*: nodes are neurons, an
   edge u→v means u makes synapses onto v, and the weight is the number of
   synapses. Everything below is a deliberately simple, legible model of how
   activity might move through that graph. It is not a biophysical simulation.
   ========================================================================== */

/* ------------------------------------------------------------- min-heap --- */
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return [topK, topV];
  }
}

/* ------------------------------------------------------------- cascade --- */

/**
 * Propagate a spike outward from `seeds` across real synapses.
 *
 * At each hop a neuron hands its activity to its outgoing partners in
 * proportion to how strong each connection is relative to its own strongest
 * connection, times a global `decay`. Weak links fall below `threshold` and
 * die out — which is why the wave follows real anatomy instead of just
 * flooding everything.
 *
 * The `rel ** 0.8` term matters more than it looks. With a flatter exponent
 * (0.35) a single sensory cell still reaches ~60% of the CNS and 840 of 1007
 * motor neurons within a few hops, which makes the Lesion mode meaningless —
 * cut anything and nothing changes, because every route has a dozen parallels.
 * At 0.8 the wave stays on strong connections, so it reads as a circuit and a
 * cut costs real motor neurons.
 *
 * @returns {{act:Float32Array, hop:Int16Array, parent:Int32Array,
 *            order:Uint32Array, hopBuckets:number[][], reachedMotor:number}}
 */
export function cascade(D, seeds, opt = {}) {
  const decay     = opt.decay     ?? 0.72;
  const threshold = opt.threshold ?? 0.05;
  const maxHop    = opt.maxHop    ?? 14;
  const maxActive = opt.maxActive ?? 90000;
  const blocked   = opt.blocked   ?? null;
  const motorSet  = opt.motorSet  ?? null;

  const n = D.n;
  const act = new Float32Array(n);
  const hop = new Int16Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  const order = [];
  const hopBuckets = [];

  let frontier = [];
  for (const s of seeds) {
    if (blocked && blocked[s]) continue;
    if (hop[s] !== -1) continue;
    act[s] = 1; hop[s] = 0; parent[s] = -1;
    frontier.push(s); order.push(s);
  }
  if (!frontier.length) {
    return { act, hop, parent, order: new Uint32Array(0), hopBuckets: [], reachedMotor: 0, hops: 0 };
  }
  hopBuckets.push(frontier.slice());

  let h = 0, reachedMotor = 0;
  if (motorSet) for (const s of frontier) if (motorSet[s]) reachedMotor++;

  while (frontier.length && h < maxHop && order.length < maxActive) {
    const next = [];
    for (let fi = 0; fi < frontier.length; fi++) {
      const u = frontier[fi];
      const a = act[u];
      const e0 = D.offsets[u], e1 = D.offsets[u + 1];
      if (e0 === e1) continue;

      let wmax = 1;
      for (let e = e0; e < e1; e++) if (D.wgt[e] > wmax) wmax = D.wgt[e];

      for (let e = e0; e < e1; e++) {
        const v = D.dst[e];
        if (blocked && blocked[v]) continue;
        const rel = D.wgt[e] / wmax;
        const contrib = a * Math.pow(rel, 0.8) * decay;
        if (contrib <= threshold) continue;
        if (hop[v] === -1) {
          hop[v] = h + 1; parent[v] = u; act[v] = contrib;
          next.push(v); order.push(v);
          if (motorSet && motorSet[v]) reachedMotor++;
        } else if (contrib > act[v]) {
          act[v] = contrib; parent[v] = u;
        }
      }
    }
    h++;
    if (next.length) hopBuckets.push(next);
    frontier = next;
  }

  return {
    act, hop, parent,
    order: Uint32Array.from(order),
    hopBuckets,
    reachedMotor,
    hops: hopBuckets.length,
    peak: 1,
  };
}

/* -------------------------------------------------------- reverse search --- */

/**
 * Dijkstra over the connectome maximising the *strength* of a route.
 * Cost of traversing an edge is (log(maxW) - log(w)) plus a small per-hop
 * penalty, so the search prefers few hops of strong connections over many
 * hops of weak ones.
 *
 * @param {number[]} sources  starting neurons (e.g. sensory cells)
 * @param {Set<number>} targets stop as soon as one of these is reached
 * @returns {{path:number[], edges:number[], weight:number}|null}
 */
export function strongestPath(D, sources, targets, opt = {}) {
  const blocked = opt.blocked ?? null;
  const hopPenalty = opt.hopPenalty ?? 0.55;
  const maxHops = opt.maxHops ?? 14;
  const n = D.n;

  const LOGMAX = Math.log(255);
  // Float64, not Float32: the heap holds float64 keys, so storing distances at
  // float32 precision makes the stale-entry test `d > dist[u]` fire on roughly
  // half of all pops (rounding down), silently dropping reachable neurons.
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevEdge = new Int32Array(n).fill(-1);
  const depth = new Int8Array(n);
  const done = new Uint8Array(n);

  const heap = new Heap();
  for (const s of sources) {
    if (blocked && blocked[s]) continue;
    if (dist[s] > 0) { dist[s] = 0; heap.push(0, s); }
  }

  let found = -1;
  while (heap.size) {
    const [d, u] = heap.pop();
    if (done[u] || d > dist[u]) continue;
    done[u] = 1;
    if (targets.has(u)) { found = u; break; }

    const nd = depth[u] + 1;
    if (nd > maxHops) continue;
    for (let e = D.offsets[u]; e < D.offsets[u + 1]; e++) {
      const v = D.dst[e];
      if (done[v]) continue;
      if (blocked && blocked[v]) continue;
      const step = (LOGMAX - Math.log(D.wgt[e] || 1)) + hopPenalty;
      const alt = d + step;
      if (alt < dist[v]) {
        dist[v] = alt;
        prev[v] = u;
        prevEdge[v] = e;
        depth[v] = nd;
        heap.push(alt, v);
      }
    }
  }

  if (found < 0) return null;
  const path = [], edges = [];
  let cur = found;
  while (cur !== -1) {
    path.push(cur);
    if (prevEdge[cur] >= 0) edges.push(prevEdge[cur]);
    cur = prev[cur];
  }
  path.reverse(); edges.reverse();
  return { path, edges, cost: dist[found] };
}

/* ------------------------------------------------------------- helpers --- */

/** Which motor neurons did this cascade reach? */
export function motorMask(D) {
  const motorSupers = new Set(['vnc_motor', 'cb_motor', 'vnc_efferent', 'cb_efferent', 'vnc_endocrine', 'cb_endocrine']);
  const m = new Uint8Array(D.n);
  const names = D.meta.superclasses;
  for (let i = 0; i < D.n; i++) if (motorSupers.has(names[D.sup[i]])) m[i] = 1;
  return m;
}

/** Fraction of all motor neurons reachable from a seed set (used by Lesion). */
export function motorReach(D, res, motorSet) {
  let total = 0, hit = 0;
  for (let i = 0; i < D.n; i++) if (motorSet[i]) { total++; if (res.hop[i] >= 0) hit++; }
  return { total, hit, frac: total ? hit / total : 0 };
}

/** Total synapse count arriving at a set of neurons from a set of neurons. */
export function connectionStrength(D, fromSet, toSet) {
  let s = 0;
  for (let u = 0; u < D.n; u++) {
    if (!fromSet.has(u)) continue;
    for (let e = D.offsets[u]; e < D.offsets[u + 1]; e++) if (toSet.has(D.dst[e])) s += D.wgt[e];
  }
  return s;
}
