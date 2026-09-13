"""MUSCA data build pipeline.

Turns the raw MaleCNS (male-cns:v1.0) flat-connectome tables into compact
browser-ready binaries.

  data-raw/body-annotations.feather       -> data/neurons.bin
  data-raw/body-neurotransmitters.feather ->   (joined into neurons.bin)
  data-raw/connectome-weights.feather     -> data/edges.bin   (CSR)
  remote  syn-points-male-cns-v1.0        -> data/synapses.bin
  derived                                 -> data/types.json, data/meta.json
"""
import json
import os
import struct
import sys
import time

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.feather as feather
import pyarrow.ipc as ipc

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from httpfile import HttpRangeFile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data-raw")
OUT = os.path.join(ROOT, "data")
WORK = os.path.join(RAW, "work")
os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)

BASE = "https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/"

MIN_EDGE_WEIGHT = 6      # ignore synapses this weak or weaker
TOP_K_OUT = 24           # keep at most this many strongest outputs per neuron
N_SYN_BATCHES = 26       # row-groups sampled from the 13 GB synapse table
SYN_TARGET = 1_100_000   # synapse points shipped to the browser
SYN_SCALE = 4.0          # int16 quantisation of coordinates (8nm voxel units)


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


# --------------------------------------------------------------------------
# Stage 1 - neuron annotations
# --------------------------------------------------------------------------
def stage_neurons():
    cache = os.path.join(WORK, "neurons.parquet")
    if os.path.exists(cache):
        log("stage1: loading cache")
        return pd.read_parquet(cache)

    log("stage1: reading body-annotations")
    ann = feather.read_table(os.path.join(RAW, "body-annotations.feather")).to_pandas()
    log("  raw rows:", len(ann))

    # The connectome proper = the bodies that carry a superclass (166,700 neurons).
    neu = ann[ann["superclass"].notna()].copy().drop_duplicates("bodyId")
    log("  neurons:", len(neu))

    log("stage1: reading neurotransmitters")
    nt = feather.read_table(
        os.path.join(RAW, "body-neurotransmitters.feather"),
        columns=["body", "consensus_nt", "predicted_nt"],
    ).to_pandas().drop_duplicates("body").set_index("body")
    neu["nt"] = neu["bodyId"].map(nt["consensus_nt"]).fillna(neu["bodyId"].map(nt["predicted_nt"]))

    loc = neu["somaLocation"].apply(
        lambda v: np.asarray(v, dtype=np.float64)
        if v is not None and len(np.asarray(v)) == 3 else np.array([np.nan] * 3)
    )
    xyz = np.stack(loc.values).astype(np.float64)
    neu["sx"], neu["sy"], neu["sz"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    have = np.isfinite(neu["sx"]).values
    log("  real soma coordinates:", int(have.sum()))

    # ~27k neurons ship without a soma coordinate. Dropping them all on their
    # cell type's median would build a fake bright spike in the render, so place
    # them at the type's mean with a jitter drawn from the type's real spread.
    rng = np.random.default_rng(11)
    neu["hasSoma"] = have
    for key in ("type", "superclass"):
        miss = ~np.isfinite(neu["sx"].values)
        if not miss.any():
            break
        grp = neu[have].groupby(key)[["sx", "sy", "sz"]]
        mean = grp.mean()
        std = grp.std().fillna(0.0)
        keys = neu.loc[miss, key]
        m = mean.reindex(keys).to_numpy()
        s = std.reindex(keys).to_numpy()
        fallback = np.isnan(m[:, 0])
        if fallback.any():
            m[fallback] = neu.loc[have, ["sx", "sy", "sz"]].mean().to_numpy()
            s[fallback] = neu.loc[have, ["sx", "sy", "sz"]].std().to_numpy()
        s = np.clip(s, 150.0, 900.0)         # plausible spread, never a singularity
        neu.loc[miss, ["sx", "sy", "sz"]] = m + rng.normal(0.0, 1.0, m.shape) * s
    still = ~np.isfinite(neu["sx"].values)
    if still.any():
        neu.loc[still, ["sx", "sy", "sz"]] = neu[["sx", "sy", "sz"]].median().values
    log("  estimated somas jittered within their cell type")

    # a display label per neuron: cell type, else class, else superclass
    neu["label"] = (
        neu["type"].fillna(neu["class"]).fillna(neu["superclass"])
        .fillna(neu["instance"]).fillna("unlabelled")
    )
    neu.to_parquet(cache, index=False)
    log("stage1: cached ->", cache)
    return neu


# --------------------------------------------------------------------------
# Stage 2 - connectivity (streamed, weight-sorted file)
# --------------------------------------------------------------------------
def census_synapses(neu):
    """Count connections and synapses among the annotated neurons.

    This has to be a full pass over connectome-weights: stage_edges() stops
    early because the table is sorted by descending weight, so it only ever
    sees the strong tail. The headline numbers on the page come from here, and
    it is easy to get them wrong — "6.2M" is the number of *pairs* with weight
    >= 5, not the number of synapses (which is the sum of the weights).
    """
    cache = os.path.join(WORK, "synapse-census.json")
    if os.path.exists(cache):
        log("stage2b: loading census cache")
        with open(cache) as fh:
            return json.load(fh)

    log("stage2b: census over connectome-weights (full pass)")
    t = feather.read_table(os.path.join(RAW, "connectome-weights.feather"), memory_map=True)
    body = neu["bodyId"].to_numpy(np.int64)
    max_id = int(body.max())
    lut = np.full(max_id + 2, -1, dtype=np.int32)
    lut[body] = np.arange(len(neu), dtype=np.int32)

    chunk = 8_000_000
    pairs = 0
    syns = 0
    for off in range(0, t.num_rows, chunk):
        s = t.slice(off, chunk)
        si = lut[np.clip(s.column("body_pre").to_numpy(), 0, max_id + 1)]
        di = lut[np.clip(s.column("body_post").to_numpy(), 0, max_id + 1)]
        wt = s.column("weight").to_numpy()
        keep = (si >= 0) & (di >= 0)
        pairs += int(keep.sum())
        syns += int(wt[keep].sum())
    del t

    out = {"nConnections": pairs, "nSynapses": syns}
    with open(cache, "w") as fh:
        json.dump(out, fh)
    log(f"  {pairs:,} connections, {syns:,} synapses")
    return out


# --------------------------------------------------------------------------
def stage_edges(neu):
    cache = os.path.join(WORK, "edges.npz")
    n = len(neu)
    body = neu["bodyId"].to_numpy(np.int64)
    max_id = int(body.max())

    if os.path.exists(cache):
        log("stage2: loading cache")
        z = np.load(cache)
        return z["src"], z["dst"], z["w"], z["pre"], z["post"]

    log("stage2: reading connectome-weights (streamed)")
    t = feather.read_table(os.path.join(RAW, "connectome-weights.feather"), memory_map=True)
    rows = t.num_rows
    log("  total rows:", rows)

    lut = np.full(max_id + 2, -1, dtype=np.int32)
    lut[body] = np.arange(n, dtype=np.int32)

    chunk = 4_000_000
    acc_s, acc_d, acc_w = [], [], []
    off = 0
    while off < rows:
        s = t.slice(off, chunk)
        bpre = s.column("body_pre").to_numpy()
        bpost = s.column("body_post").to_numpy()
        wt = s.column("weight").to_numpy()
        if wt.max() < MIN_EDGE_WEIGHT:
            break
        si = lut[np.clip(bpre, 0, max_id + 1)]
        di = lut[np.clip(bpost, 0, max_id + 1)]
        keep = (si >= 0) & (di >= 0) & (wt >= MIN_EDGE_WEIGHT)
        acc_s.append(si[keep])
        acc_d.append(di[keep])
        acc_w.append(wt[keep].astype(np.int32))
        off += chunk
        if off % 20_000_000 < chunk:
            log(f"  scanned {off:,} rows  kept {sum(len(a) for a in acc_s):,}")
    del t

    src = np.concatenate(acc_s)
    dst = np.concatenate(acc_d)
    w = np.concatenate(acc_w)
    log("  edges kept (before top-K):", len(src))

    # keep the strongest TOP_K_OUT outputs of every neuron
    order = np.lexsort((-w, src))
    src, dst, w = src[order], dst[order], w[order]
    first = np.empty(len(src), dtype=bool)
    first[0] = True
    np.not_equal(src[1:], src[:-1], out=first[1:])
    starts = np.maximum.accumulate(np.where(first, np.arange(len(src)), 0))
    keep = (np.arange(len(src)) - starts) < TOP_K_OUT
    src, dst, w = src[keep], dst[keep], w[keep]
    log("  edges after top-K:", len(src))

    pre = np.bincount(src, minlength=n).astype(np.uint32)
    post = np.bincount(dst, minlength=n).astype(np.uint32)
    np.savez_compressed(cache, src=src, dst=dst, w=w, pre=pre, post=post)
    log("stage2: cached ->", cache)
    return src, dst, w, pre, post


# --------------------------------------------------------------------------
# Stage 3 - synapse cloud sample
# --------------------------------------------------------------------------
def stage_synapses():
    pq = os.path.join(WORK, "synapses.parquet")
    if os.path.exists(pq):
        log("stage3: loading cache")
        return pd.read_parquet(pq)

    log("stage3: sampling synapse cloud (remote range reads)")
    f = HttpRangeFile(BASE + "syn-points-male-cns-v1.0-minconf-0.5.feather")
    pf = pa.PythonFile(f, mode="r")
    reader = ipc.open_file(pf)
    nb = reader.num_record_batches
    log(f"  {nb} row-groups, {f.size/1e9:.2f} GB")

    idx = np.linspace(0, nb - 1, N_SYN_BATCHES).astype(int)
    parts = []
    for k, i in enumerate(idx):
        b = reader.get_batch(int(i))
        cols = [c for c in ("x", "y", "z", "primary") if c in b.schema.names]
        parts.append(b.select(cols).to_pandas())
        if k % 8 == 0:
            log(f"  batch {k+1}/{len(idx)}  downloaded {f.bytes_downloaded/1e6:.0f} MB")
    syn = pd.concat(parts, ignore_index=True)
    log("  sampled:", len(syn), "points ·", round(f.bytes_downloaded / 1e6, 1), "MB downloaded")
    syn.to_parquet(pq, index=False)
    return syn


# --------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------
def write_neurons(neu, pre, post):
    n = len(neu)
    body = neu["bodyId"].to_numpy("<i4")
    pos = np.stack([neu["sx"], neu["sy"], neu["sz"]], axis=1).astype("<f4")

    supers = sorted(neu["superclass"].dropna().unique().tolist())
    s_idx = {s: i for i, s in enumerate(supers)}
    sup = neu["superclass"].map(s_idx).fillna(0).to_numpy(np.uint8)

    labels = neu["label"].fillna("unlabelled")
    l_names = sorted(labels.unique().tolist())
    l_idx = {s: i for i, s in enumerate(l_names)}
    lab = labels.map(l_idx).to_numpy(np.uint32)

    nts = sorted(neu["nt"].dropna().unique().tolist())
    nt_idx = {s: i for i, s in enumerate(nts)}
    nt = neu["nt"].map(nt_idx).fillna(255).to_numpy(np.uint8)

    sides = ["L", "R", "M", "?"]
    sd_idx = {s: i for i, s in enumerate(sides)}
    side = neu["somaSide"].fillna("?").map(sd_idx).fillna(3).to_numpy(np.uint8)

    dims = sorted(neu["dimorphism"].dropna().astype(str).unique().tolist())
    dims = ["none"] + dims
    d_idx = {s: i for i, s in enumerate(dims)}
    dim = neu["dimorphism"].astype(str).map(d_idx).fillna(0).to_numpy(np.uint8)
    has = neu["hasSoma"].to_numpy(np.uint8)

    path = os.path.join(OUT, "neurons.bin")
    with open(path, "wb") as fh:
        fh.write(b"MUS1")
        fh.write(struct.pack("<III", n, 1, 0))
        for a in (body, pos, sup, lab, nt, side, dim, has,
                  pre.astype("<u4"), post.astype("<u4")):
            fh.write(np.ascontiguousarray(a).tobytes())
    log(f"wrote neurons.bin  n={n}  {os.path.getsize(path)/1e6:.2f} MB")

    with open(os.path.join(OUT, "labels.json"), "w", encoding="utf-8") as fh:
        json.dump(l_names, fh, separators=(",", ":"))
    log(f"wrote labels.json  {len(l_names)} cell labels")

    return {"superclasses": supers, "neurotransmitters": nts, "sides": sides, "dimorphisms": dims}


def write_edges(src, dst, w, n):
    order = np.argsort(src, kind="stable")
    src, dst, w = src[order], dst[order], w[order]
    offsets = np.zeros(n + 1, dtype="<u4")
    np.add.at(offsets, src + 1, 1)
    offsets = np.cumsum(offsets).astype("<u4")
    w8 = np.clip(w, 1, 255).astype(np.uint8)

    path = os.path.join(OUT, "edges.bin")
    with open(path, "wb") as fh:
        fh.write(b"MUSE")
        fh.write(struct.pack("<III", n, len(src), 1))
        fh.write(offsets.tobytes())
        fh.write(dst.astype("<u4").tobytes())
        fh.write(w8.tobytes())
    log(f"wrote edges.bin  {len(src):,} edges over {n:,} nodes  {os.path.getsize(path)/1e6:.2f} MB")


def write_synapses(syn):
    x = syn["x"].to_numpy(np.float64)
    y = syn["y"].to_numpy(np.float64)
    z = syn["z"].to_numpy(np.float64)
    if len(x) > SYN_TARGET:
        sel = np.sort(np.random.default_rng(7).choice(len(x), SYN_TARGET, replace=False))
        x, y, z = x[sel], y[sel], z[sel]
        syn = syn.iloc[sel]

    prims = sorted(syn["primary"].fillna("unknown").astype(str).unique().tolist())
    p_idx = {s: i for i, s in enumerate(prims)}
    p = syn["primary"].fillna("unknown").astype(str).map(p_idx).to_numpy(np.uint8)

    origin = np.array([x.min(), y.min(), z.min()], dtype=np.float64)
    q = np.round((np.stack([x, y, z], axis=1) - origin) / SYN_SCALE).astype("<i2")

    path = os.path.join(OUT, "synapses.bin")
    with open(path, "wb") as fh:
        fh.write(b"MUSY")
        fh.write(struct.pack("<III", len(q), 1, 0))
        fh.write(q.tobytes())
        fh.write(p.tobytes())
    log(f"wrote synapses.bin  {len(q):,} points  {os.path.getsize(path)/1e6:.2f} MB")
    return prims, origin.tolist()


def main():
    neu = stage_neurons()
    census = census_synapses(neu)
    src, dst, w, pre, post = stage_edges(neu)
    cats = write_neurons(neu, pre, post)

    syn = stage_synapses()
    prims, syn_origin = write_synapses(syn)
    write_edges(src, dst, w, len(neu))

    meta = {
        "dataset": "male-cns:v1.0",
        "nNeurons": int(len(neu)),
        "nEdges": int(len(src)),
        "nSynapsePoints": int(SYN_TARGET),
        "nConnections": int(census["nConnections"]),
        "nSynapses": int(census["nSynapses"]),
        "minEdgeWeight": MIN_EDGE_WEIGHT,
        "topKOut": TOP_K_OUT,
        "synScale": SYN_SCALE,
        "synOrigin": syn_origin,
        "superclasses": cats["superclasses"],
        "neurotransmitters": cats["neurotransmitters"],
        "sides": cats["sides"],
        "dimorphisms": cats["dimorphisms"],
        "neuropils": prims,
        "bounds": {
            "x": [float(neu.sx.min()), float(neu.sx.max())],
            "y": [float(neu.sy.min()), float(neu.sy.max())],
            "z": [float(neu.sz.min()), float(neu.sz.max())],
        },
    }
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, separators=(",", ":"))
    log("wrote meta.json")
    log("DONE")


if __name__ == "__main__":
    main()
