/* ==========================================================================
   data.js — fetch + parse the MUSCA binaries, build lookup indices
   ========================================================================== */

const MAGIC = { neurons: 0x3153554d, edges: 0x4553554d, syn: 0x5953554d };

async function getBuf(url, onProgress, label, weight) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (onProgress) onProgress(weight, label);
  return buf;
}

// typed-array views need 4-byte alignment; slice when the offset is odd
function view(buffer, ctor, off, len) {
  const bpe = ctor.BYTES_PER_ELEMENT;
  if (off % bpe === 0) return new ctor(buffer, off, len);
  return new ctor(buffer.slice(off, off + len * bpe));
}

function readHeader(buffer, expect, name) {
  const dv = new DataView(buffer);
  const magic = dv.getUint32(0, true);
  if (magic !== expect) throw new Error(`${name}: bad magic (${magic.toString(16)})`);
  return { a: dv.getUint32(4, true), b: dv.getUint32(8, true), c: dv.getUint32(12, true), head: 16 };
}

export async function loadAll(onProgress = () => {}) {
  onProgress(0.03, 'metadata');
  const meta = await (await fetch('data/meta.json')).json();
  const labels = await (await fetch('data/labels.json')).json();

  onProgress(0.06, 'neurons');
  const nb = await getBuf('data/neurons.bin');
  onProgress(0.32, 'neurons');
  const nh = readHeader(nb, MAGIC.neurons, 'neurons.bin');
  const n = nh.a;
  let o = nh.head;
  const bodyId = view(nb, Int32Array, o, n); o += 4 * n;
  const pos = view(nb, Float32Array, o, 3 * n); o += 12 * n;
  const sup = view(nb, Uint8Array, o, n); o += n;
  const lab = view(nb, Uint32Array, o, n); o += 4 * n;
  const nt = view(nb, Uint8Array, o, n); o += n;
  const side = view(nb, Uint8Array, o, n); o += n;
  const dim = view(nb, Uint8Array, o, n); o += n;
  const hasSoma = view(nb, Uint8Array, o, n); o += n;
  const pre = view(nb, Uint32Array, o, n); o += 4 * n;
  const post = view(nb, Uint32Array, o, n); o += 4 * n;

  onProgress(0.34, 'synapses');
  const sb = await getBuf('data/synapses.bin');
  onProgress(0.64, 'synapses');
  const sh = readHeader(sb, MAGIC.syn, 'synapses.bin');
  const sn = sh.a;
  const sq = view(sb, Int16Array, sh.head, 3 * sn);
  const sprim = view(sb, Uint8Array, sh.head + 6 * sn, sn);

  onProgress(0.66, 'wiring');
  const eb = await getBuf('data/edges.bin');
  onProgress(0.92, 'wiring');
  const eh = readHeader(eb, MAGIC.edges, 'edges.bin');
  const en = eh.a, ne = eh.b;
  const offsets = view(eb, Uint32Array, eh.head, en + 1);
  const dst = view(eb, Uint32Array, eh.head + 4 * (en + 1), ne);
  const wgt = view(eb, Uint8Array, eh.head + 4 * (en + 1) + 4 * ne, ne);

  onProgress(0.94, 'indexing');

  // --- synapse cloud -> float positions -----------------------------------
  const so = meta.synOrigin, ss = meta.synScale;
  const synPos = new Float32Array(3 * sn);
  for (let i = 0; i < sn; i++) {
    synPos[3 * i]     = sq[3 * i]     * ss + so[0];
    synPos[3 * i + 1] = sq[3 * i + 1] * ss + so[1];
    synPos[3 * i + 2] = sq[3 * i + 2] * ss + so[2];
  }

  // --- label (cell-type) index: CSR over labels ---------------------------
  const nl = labels.length;
  const lcount = new Uint32Array(nl + 1);
  for (let i = 0; i < n; i++) lcount[lab[i] + 1]++;
  for (let i = 0; i < nl; i++) lcount[i + 1] += lcount[i];
  const lstart = lcount.slice();
  const lmembers = new Uint32Array(n);
  const cursor = lstart.slice();
  for (let i = 0; i < n; i++) lmembers[cursor[lab[i]]++] = i;

  // --- reverse adjacency (incoming edges) ---------------------------------
  const inOff = new Uint32Array(n + 1);
  for (let e = 0; e < ne; e++) inOff[dst[e] + 1]++;
  for (let i = 0; i < n; i++) inOff[i + 1] += inOff[i];
  const inSrc = new Uint32Array(ne);
  const inW = new Uint8Array(ne);
  const cur2 = inOff.slice(0, n);
  for (let s = 0; s < n; s++) {
    for (let e = offsets[s]; e < offsets[s + 1]; e++) {
      const d = dst[e], p = cur2[d]++;
      inSrc[p] = s;
      inW[p] = wgt[e];
    }
  }

  // --- derived stats -------------------------------------------------------
  const superCount = new Uint32Array(meta.superclasses.length);
  const ntCount = new Uint32Array(meta.neurotransmitters.length);
  for (let i = 0; i < n; i++) { superCount[sup[i]]++; if (nt[i] < 255) ntCount[nt[i]]++; }

  onProgress(1, 'ready');

  return {
    meta, labels, n,
    bodyId, pos, sup, lab, nt, side, dim, hasSoma, pre, post,
    offsets, dst, wgt, ne,
    inOff, inSrc, inW,
    synPos, synPrim: sprim, sn,
    lstart, lmembers, lcount,
    superCount, ntCount,
    bodyIndex: (() => {
      const m = new Map();
      for (let i = 0; i < n; i++) m.set(bodyId[i], i);
      return m;
    })(),
    labelLookup: (() => {
      const m = new Map();
      for (let i = 0; i < labels.length; i++) m.set(labels[i].toLowerCase(), i);
      return m;
    })(),
  };
}

/* ---------------------------------------------------------------- helpers */

export function labelOf(D, i) { return D.labels[D.lab[i]] || 'unlabelled'; }

export function membersOfLabel(D, li) {
  return D.lmembers.subarray(D.lstart[li], D.lstart[li + 1]);
}

export function indexOfLabel(D, name) {
  if (!name) return -1;
  return D.labelLookup.has(name.toLowerCase()) ? D.labelLookup.get(name.toLowerCase()) : -1;
}

/** fuzzy search over cell-type names, ranked: exact > prefix > substring > subsequence */
export function searchLabels(D, q, limit = 24) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (let i = 0; i < D.labels.length; i++) {
    const s = D.labels[i].toLowerCase();
    const at = s.indexOf(q);
    if (at === 0) out.push([i, s.length === q.length ? 0 : 1, s.length]);
    else if (at > 0) out.push([i, 2, s.length]);
  }
  out.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
  return out.slice(0, limit).map(([i]) => i);
}
