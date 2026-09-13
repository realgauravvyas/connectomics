/**
 * connectome.js — grows a spar-se connectome from the anatomy tables.
 *
 * NOTE, AND THIS MATTERS: this is a statistically grown model, not the
 * real 166,000-neuron connectome. What is real: region sizes, the long-range
 * pathway table, inhibitory fractions, the plasticity rule, the behaviour
 * mapping. What is synthetic: which exact neuron talks to which.
 * See README ("Honest limitations") and data/SCHEMA.md if you want to
 * substitute real data.
 */

import { Rng } from './rng.js';
import { REGION_DEFS, PATHWAYS, INHIB_FRACTION } from './anatomy.js';
import { sample, centroid } from './shapes.js';

/** Small regions would vanish under linear downscaling, so we compress. */
const COMPRESS = 0.65;

/** Mean synaptic weight per pathway class: ordinary / neuromodulatory / plastic. */
const W_SCALE = [0.62, 0.42, 0.50];

function clampNum(x, a, b) { return x < a ? a : (x > b ? b : x); }

export function buildConnectome({
  neurons = 45000,
  synapsesPerNeuron = 14,
  seed = 20260913,
  onProgress = null,
} = {}) {
  const rng = new Rng(seed);
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const tick = (m) => onProgress && onProgress(m);

  // ---------------------------------------------------------------- regions
  tick('partitioning regions');
  const defs = [];
  for (const d of REGION_DEFS) {
    if (d.mirror) {
      defs.push({ ...d, uid: d.id + '_L', side: +1 });
      defs.push({ ...d, uid: d.id + '_R', side: -1 });
    } else {
      defs.push({ ...d, uid: d.id, side: 0 });
    }
  }

  // Weight each concrete region by its real size, compressed, then scaled
  // to the requested neuron budget.
  const weights = defs.map(d => Math.pow(d.real / (d.mirror ? 2 : 1), COMPRESS));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let assigned = 0;
  const counts = defs.map((d, i) => {
    const n = Math.max(8, Math.round(neurons * weights[i] / wsum));
    assigned += n;
    return n;
  });
  // Fix rounding drift on the biggest region.
  let drift = neurons - assigned;
  let biggest = counts.indexOf(Math.max(...counts));
  counts[biggest] = Math.max(8, counts[biggest] + drift);

  const n = counts.reduce((a, b) => a + b, 0);
  const pos = new Float32Array(n * 3);
  const regionOf = new Uint16Array(n);
  const groupOf = new Uint16Array(n);
  const sideOf = new Int8Array(n);
  const inhibitory = new Uint8Array(n);
  const hubness = new Float32Array(n);

  // Region metadata + index ranges
  const regions = [];
  let cursor = 0;
  defs.forEach((d, ri) => {
    const count = counts[ri];
    regions.push({
      index: ri, uid: d.uid, id: d.id, name: d.name, side: d.side,
      color: d.color, role: d.role, blurb: d.blurb,
      start: cursor, count, real: d.real,
      centroid: centroid(d.shape),
      mirrorShape: d.side === -1,
    });
    regionOf.fill(ri, cursor, cursor + count);
    sideOf.fill(d.side, cursor, cursor + count);
    cursor += count;
  });

  // Group table: 'REGION.GROUP' -> { start, count, region, ... }
  const groupMap = new Map();
  const groupList = [];

  // ------------------------------------------------------------- positions
  tick('placing neurons');
  cursor = 0;
  defs.forEach((d, ri) => {
    const count = counts[ri];
    const groups = d.groups || [{ k: 'ALL', f: 1 }];
    // Cumulative group boundaries
    const bounds = [];
    let acc = 0;
    for (let g = 0; g < groups.length; g++) {
      acc += groups[g].f;
      bounds.push(Math.min(count, Math.round(count * acc)));
    }

    let gi = 0;
    const gStart = cursor;
    for (let i = 0; i < count; i++) {
      while (gi < bounds.length - 1 && i >= bounds[gi]) gi++;
      const gkey = d.uid + '.' + groups[gi].k;
      if (i === 0 || i === bounds[gi - 1] || !groupMap.has(gkey + '#' + ri)) {
        // no-op, groups are registered after the loop
      }
      // position
      const o = (cursor + i) * 3;
      if (d.partOfGroup && d.shape.parts && d.shape.parts[gi]) {
        sample(rng, d.shape.parts[gi], pos, o);
      } else {
        sample(rng, d.shape, pos, o);
      }
      if (d.side === -1) pos[o] = -pos[o];
      // jitter so the surface never looks like a maths textbook
      pos[o]     += rng.range(-0.004, 0.004);
      pos[o + 1] += rng.range(-0.004, 0.004);
      pos[o + 2] += rng.range(-0.004, 0.004);

      groupOf[cursor + i] = groupList.length === 0 ? 0 : gi;
      hubness[cursor + i] = Math.exp(rng.gauss() * 0.85);
      inhibitory[cursor + i] = rng.chance(INHIB_FRACTION[d.id] ?? 0.3) ? 1 : 0;
    }

    // register groups for this region
    let gs = gStart;
    for (let g = 0; g < groups.length; g++) {
      const ge = (g === groups.length - 1) ? gStart + count : gStart + bounds[g];
      const key = d.uid + '.' + groups[g].k;
      const bare = d.id + '.' + groups[g].k;
      const entry = {
        key, bare, region: ri, uid: d.uid, regionId: d.id,
        k: groups[g].k, name: groups[g].name || groups[g].k,
        start: gs, count: Math.max(0, ge - gs), global: groupList.length,
      };
      groupList.push(entry);
      groupMap.set(key, entry);
      // Un-sided alias so a pathway 'AL.PN' can mean both hemispheres.
      if (!groupMap.has(bare)) groupMap.set(bare, entry);
      gs = ge;
    }
    for (let i = 0; i < count; i++) {
      // find group index for neuron (recompute cheaply)
      let g = 0;
      for (let k = 0; k < bounds.length; k++) { if (i < bounds[k]) { g = k; break; } }
      groupOf[gStart + i] = groupMap.get(d.uid + '.' + groups[g].k).global;
    }
    cursor += count;
  });

  // ----------------------------------------------------- sensory ensembles
  // Deterministic receptor subsets: "odour A" is always the same neurons.
  tick('assigning receptor tuning');
  const ensembles = {};
  const mkEnsemble = (name, groupKey, frac, salt) => {
    const list = [];
    for (const g of groupList) {
      if (g.bare !== groupKey) continue;
      const r2 = new Rng((seed ^ (salt * 2654435761)) >>> 0);
      for (let i = g.start; i < g.start + g.count; i++) {
        if (r2.float() < frac) list.push(i);
      }
    }
    ensembles[name] = Int32Array.from(list);
  };
  mkEnsemble('odorA', 'AL.ORN', 0.30, 1);
  mkEnsemble('odorB', 'AL.ORN', 0.30, 2);
  mkEnsemble('phero', 'AL.ORN', 0.25, 3);
  mkEnsemble('sweet', 'SEZ.GRN', 0.50, 4);
  mkEnsemble('bitter', 'SEZ.GRN', 0.50, 5);
  mkEnsemble('looming', 'OL.LOP', 0.16, 6);
  mkEnsemble('light', 'OL.LA', 0.40, 7);
  mkEnsemble('sound', 'AMMC.JO', 0.45, 8);
  mkEnsemble('airpuff', 'AMMC.JO', 0.80, 9);
  mkEnsemble('shock', 'DAN.PPL1', 1.0, 10);
  mkEnsemble('sugar', 'DAN.PAM', 1.0, 11);

  // --------------------------------------------------------- spatial index
  tick('building spatial index');
  const CELL = 0.045;
  const grid = new Map();
  const cellKey = (x, y, z) =>
    ((x + 512) << 20) ^ ((y + 512) << 10) ^ (z + 512);
  for (let i = 0; i < n; i++) {
    const k = cellKey(
      Math.floor(pos[i * 3] / CELL),
      Math.floor(pos[i * 3 + 1] / CELL),
      Math.floor(pos[i * 3 + 2] / CELL));
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(i);
  }

  // ------------------------------------------------------------- pathways
  tick('planning pathways');
  const resolve = (key, side) => {
    // Prefer the same hemisphere.
    const sided = groupMap.get(key + (side === -1 ? '_R' : '_L'));
    if (sided) return sided;
    return groupMap.get(key) || null;
  };

  const jobs = [];
  let predicted = 0;
  for (const p of PATHWAYS) {
    const [fr, fk] = p.from.split('.');
    const [tr, tk] = p.to.split('.');
    const contra = p.contra ?? (REGION_DEFS.find(d => d.id === fr)?.mirror &&
                                REGION_DEFS.find(d => d.id === tr)?.mirror ? 0.08 : 0);
    for (const gFrom of groupList) {
      if (gFrom.regionId !== fr || (fk && gFrom.k !== fk)) continue;
      for (const gTo of groupList) {
        if (gTo.regionId !== tr || (tk && gTo.k !== tk)) continue;
        const sameSide = gFrom.uid.slice(-2) === gTo.uid.slice(-2) ||
                         (!gFrom.uid.includes('_') || !gTo.uid.includes('_'));
        let frac = sameSide ? 1 - contra : contra;
        if (frac <= 0) continue;
        let count;
        if (p.in != null) count = p.in * gTo.count * frac;
        else count = p.out * gFrom.count * frac;
        count = Math.round(count);
        if (count <= 0) continue;
        jobs.push({ from: gFrom, to: gTo, count, p });
        predicted += count;
      }
    }
  }
  const scale = (synapsesPerNeuron * n) / Math.max(1, predicted);

  // --------------------------------------------------------------- synapse
  tick('growing synapses');
  const total = Math.round(predicted * scale);
  const eSrc = new Int32Array(total);
  const eTgt = new Int32Array(total);
  const eW = new Float32Array(total);
  const eD = new Uint8Array(total);
  const ePlastic = new Uint8Array(total);
  const deg = new Int32Array(n);

  let e = 0;
  for (const job of jobs) {
    const { from, to, p } = job;
    const count = Math.max(1, Math.round(job.count * scale));
    const strong = p.strong ? 2.2 : 1;
    const wi = p.neuromod ? 1 : (p.plastic ? 2 : 0);
    for (let k = 0; k < count && e < total; k++) {
      // source: biased toward hub neurons
      let s = from.start + rng.int(from.count);
      const s2 = from.start + rng.int(from.count);
      if (hubness[s2] > hubness[s]) s = s2;

      // target: usually a spatial neighbour, sometimes anywhere in the region
      let t;
      const anchor = to.start + rng.int(to.count);
      const cx = Math.floor(pos[anchor * 3] / CELL);
      const cy = Math.floor(pos[anchor * 3 + 1] / CELL);
      const cz = Math.floor(pos[anchor * 3 + 2] / CELL);
      const cell = grid.get(cellKey(cx, cy, cz));
      if (cell && rng.chance(0.62)) {
        let tries = 3;
        do {
          t = cell[rng.int(cell.length)];
          tries--;
        } while (tries > 0 && (t < to.start || t >= to.start + to.count));
        if (t < to.start || t >= to.start + to.count) t = anchor;
      } else {
        t = anchor;
      }
      if (t === s) continue;

      // Cheap heavy-tailed weight: mostly small, occasionally dominant.
      // (A true lognormal here costs ~1.5 µs per edge and dominates build time.)
      const u = rng.float();
      const wMag = Math.min(3.5, W_SCALE[wi] * (0.22 + 2.4 * u * u * u) * strong);

      eSrc[e] = s;
      eTgt[e] = t;
      eW[e] = wMag;
      const dx = pos[s * 3] - pos[t * 3];
      const dy = pos[s * 3 + 1] - pos[t * 3 + 1];
      const dz = pos[s * 3 + 2] - pos[t * 3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      eD[e] = 1 + Math.min(3, Math.floor(dist * 4));
      if (p.plastic) ePlastic[e] = 1;
      deg[t]++;
      e++;
    }
  }
  const E = e;

  // ------------------------------------------------------------- CSR build
  tick('compiling adjacency');
  const outOffset = new Int32Array(n + 1);
  for (let i = 0; i < E; i++) outOffset[eSrc[i] + 1]++;
  for (let i = 0; i < n; i++) outOffset[i + 1] += outOffset[i];

  const outTarget = new Int32Array(E);
  const outWeight = new Float32Array(E);
  const outDelay = new Uint8Array(E);
  const outPlastic = new Uint8Array(E);
  const cursorArr = outOffset.slice(0, n);
  for (let i = 0; i < E; i++) {
    const s = eSrc[i];
    const o = cursorArr[s]++;
    outTarget[o] = eTgt[i];
    outWeight[o] = eW[i];
    outDelay[o] = eD[i];
    outPlastic[o] = ePlastic[i];
  }

  // reverse adjacency, for the neuron inspector
  const inOffset = new Int32Array(n + 1);
  for (let i = 0; i < E; i++) inOffset[outTarget[i] + 1]++;
  for (let i = 0; i < n; i++) inOffset[i + 1] += inOffset[i];
  const inSource = new Int32Array(E);
  const inEdge = new Int32Array(E);
  const c2 = inOffset.slice(0, n);
  for (let s = 0; s < n; s++) {
    for (let k = outOffset[s]; k < outOffset[s + 1]; k++) {
      const t = outTarget[k];
      const o = c2[t]++;
      inSource[o] = s;
      inEdge[o] = k;
    }
  }

  // ------------------------------------------------- homeostatic scaling
  // Without this, dense regions and hub neurons go supercritical and seize
  // while sparse regions stay silent. Real neurons solve the same problem
  // with synaptic scaling, so we do too: normalise each neuron's total
  // incoming excitatory and inhibitory weight to a fixed budget.
  tick('normalising synapses');
  {
    const EXC_BUDGET = 4.0, INH_BUDGET = 3.0;
    const excSum = new Float32Array(n);
    const inhSum = new Float32Array(n);
    for (let s = 0; s < n; s++) {
      const inh = inhibitory[s];
      for (let k = outOffset[s]; k < outOffset[s + 1]; k++) {
        if (inh) inhSum[outTarget[k]] += outWeight[k];
        else excSum[outTarget[k]] += outWeight[k];
      }
    }
    const excScale = new Float32Array(n);
    const inhScale = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      excScale[i] = excSum[i] > 1e-6 ? clampNum(EXC_BUDGET / excSum[i], 0.15, 6) : 1;
      inhScale[i] = inhSum[i] > 1e-6 ? clampNum(INH_BUDGET / inhSum[i], 0.15, 6) : 1;
    }
    for (let s = 0; s < n; s++) {
      const inh = inhibitory[s];
      for (let k = outOffset[s]; k < outOffset[s + 1]; k++) {
        outWeight[k] *= inh ? inhScale[outTarget[k]] : excScale[outTarget[k]];
      }
    }
  }

  // ------------------------------------------------------- valence + pools
  // MBONs are split into approach (+) and avoidance (-) populations.
  const valence = new Float32Array(n);
  for (const g of groupList) {
    if (g.k !== 'MBON') continue;
    const r2 = new Rng((seed ^ (g.start * 40503)) >>> 0);
    for (let i = g.start; i < g.start + g.count; i++) valence[i] = r2.chance(0.5) ? 1 : -1;
  }

  // Motor pools and valence to read behaviour out of the network.
  const POOL = { NONE: -1, LEG_L: 0, LEG_R: 1, WING_L: 2, WING_R: 3, JUMP: 4, PROB: 5, ABD: 6, SONG: 7, DN_L: 8, DN_R: 9 };
  const poolOf = new Int8Array(n).fill(-1);
  for (const g of groupList) {
    if (g.regionId === 'VNC') {
      for (let i = g.start; i < g.start + g.count; i++) {
        const left = pos[i * 3] > 0;
        if (g.k === 'LEG') poolOf[i] = left ? POOL.LEG_L : POOL.LEG_R;
        else if (g.k === 'WING') poolOf[i] = left ? POOL.WING_L : POOL.WING_R;
        else if (g.k === 'JUMP') poolOf[i] = POOL.JUMP;
        else if (g.k === 'ABD') poolOf[i] = POOL.ABD;
      }
    } else if (g.regionId === 'SEZ' && g.k === 'MN') {
      for (let i = g.start; i < g.start + g.count; i++) poolOf[i] = POOL.PROB;
    } else if (g.regionId === 'P1') {
      for (let i = g.start; i < g.start + g.count; i++) poolOf[i] = POOL.SONG;
    } else if (g.regionId === 'DN') {
      for (let i = g.start; i < g.start + g.count; i++) poolOf[i] = pos[i * 3] > 0 ? POOL.DN_L : POOL.DN_R;
    }
  }

  // plastic edge list (KC -> MBON), plus a reverse map edge -> trace slot
  const plasticIdx = [];
  const plasticSlot = new Int32Array(E).fill(-1);
  for (let i = 0; i < E; i++) {
    if (outPlastic[i]) { plasticSlot[i] = plasticIdx.length; plasticIdx.push(i); }
  }
  const plasticEdges = Int32Array.from(plasticIdx);

  const buildMs = ((typeof performance !== 'undefined' ? performance : Date).now()) - t0;

  return {
    n, E,
    pos, regionOf, groupOf, sideOf, inhibitory, hubness, valence, poolOf,
    outOffset, outTarget, outWeight, outDelay,
    inOffset, inSource, inEdge, outPlastic,
    plasticEdges, plasticSlot,
    regions, groupList, groupMap, ensembles,
    POOL,
    meta: {
      seed, buildMs,
      requestedNeurons: neurons,
      synapsesPerNeuron,
      realNeurons: 166000,
      realSynapses: 125000000,
      sampling: (166000 * (125000000 / 166000)) / Math.max(1, E),
      predictedEdges: predicted,
    },
  };
}

/** Fetch a pre-built connectome if the repo ships one, else grow it. */
export async function loadConnectome(opts = {}) {
  if (opts.url !== false) {
    try {
      const res = await fetch(opts.url || './data/connectome.json');
      if (res.ok) return await res.json();
    } catch (_) { /* offline or file:// — fall through to growing one */ }
  }
  return buildConnectome(opts);
}
