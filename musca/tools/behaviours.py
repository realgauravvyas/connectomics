"""Validate curated behaviour pathways against the built connectome.

Runs a max-strength route search (same objective as the app's Reverse mode)
from sensory cell types to motor cell types and prints the real chain of
neurons it finds, so only pathways that genuinely exist get shipped.
"""
import array
import heapq
import json
import math
import os
import struct
import sys

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")


def load():
    meta = json.load(open(os.path.join(DATA, "meta.json")))
    labels = json.load(open(os.path.join(DATA, "labels.json")))
    buf = open(os.path.join(DATA, "neurons.bin"), "rb").read()
    n = struct.unpack_from("<I", buf, 4)[0]
    o = 16

    if HAS_NUMPY:
        def arr(dt, cnt, off):
            it = np.dtype(dt).itemsize
            return np.frombuffer(buf[off:off + cnt * it], dtype=dt)
        body = arr("<i4", n, o); o += 4 * n
        o += 12 * n                       # positions, not needed here
        o += n                            # superclass
        lab = arr("<u4", n, o); o += 4 * n
    else:
        body = array.array("i")
        body.frombytes(buf[o:o + 4 * n]); o += 4 * n
        o += 12 * n
        o += n
        lab = array.array("I")
        lab.frombytes(buf[o:o + 4 * n]); o += 4 * n

    eb = open(os.path.join(DATA, "edges.bin"), "rb").read()
    en = struct.unpack_from("<I", eb, 4)[0]
    ne = struct.unpack_from("<I", eb, 8)[0]

    if HAS_NUMPY:
        offs = np.frombuffer(eb[16:16 + 4 * (en + 1)], dtype="<u4")
        dst = np.frombuffer(eb[16 + 4 * (en + 1):16 + 4 * (en + 1) + 4 * ne], dtype="<u4")
        wgt = np.frombuffer(eb[16 + 4 * (en + 1) + 4 * ne:
                                16 + 4 * (en + 1) + 4 * ne + ne], dtype="<u1")
    else:
        offs = array.array("I")
        offs.frombytes(eb[16:16 + 4 * (en + 1)])
        dst = array.array("I")
        dst.frombytes(eb[16 + 4 * (en + 1):16 + 4 * (en + 1) + 4 * ne])
        wgt = array.array("B")
        wgt.frombytes(eb[16 + 4 * (en + 1) + 4 * ne:16 + 4 * (en + 1) + 4 * ne + ne])

    return meta, labels, body, lab, offs, dst, wgt, ne


def members(labels, lab, names):
    want = set()
    for nm in names:
        for i, l in enumerate(labels):
            if l == nm:
                want.add(i)
                break
        else:
            print(f"   !! label not found: {nm}")
    if HAS_NUMPY:
        return np.where(np.isin(lab, list(want)))[0]
    return [i for i, x in enumerate(lab) if x in want]


def route(offs, dst, wgt, srcs, tgts, hop_penalty=0.55, max_hops=14):
    """Max-strength Dijkstra — the same objective as strongestPath() in graph.js.

    Cost of an edge is (log(255) - log(weight)) plus a per-hop penalty, so few
    strong hops beat many weak ones. Distances are float64 to match the app.
    """
    n = len(offs)
    LOGMAX = math.log(255)
    tset = set(int(t) for t in tgts)
    h = []

    if HAS_NUMPY:
        dist = np.full(n, np.inf)
        prev = np.full(n, -1, dtype=np.int64)
        done = np.zeros(n, dtype=bool)
        depth = np.zeros(n, dtype=np.int16)
        for s in srcs:
            s = int(s)
            if dist[s] > 0:
                dist[s] = 0.0
                heapq.heappush(h, (0.0, s))
        found = -1
        while h:
            d, u = heapq.heappop(h)
            if done[u] or d > dist[u]:
                continue
            done[u] = True
            if u in tset:
                found = u
                break
            nd = depth[u] + 1
            if nd > max_hops:
                continue
            for e in range(offs[u], offs[u + 1]):
                v = int(dst[e])
                if done[v]:
                    continue
                w = int(wgt[e]) or 1
                alt = d + (LOGMAX - math.log(w)) + hop_penalty
                if alt < dist[v]:
                    dist[v] = alt
                    prev[v] = u
                    depth[v] = nd
                    heapq.heappush(h, (alt, v))
        if found < 0:
            return None
        path = []
        cur = found
        while cur != -1:
            path.append(cur)
            cur = int(prev[cur])
        return path[::-1]

    dist = {}
    prev = {}
    done = set()
    depth = {}
    for s in srcs:
        s = int(s)
        dist[s] = 0.0
        prev[s] = -1
        depth[s] = 0
        heapq.heappush(h, (0.0, s))
    found = -1
    while h:
        d, u = heapq.heappop(h)
        if u in done or d > dist.get(u, float('inf')):
            continue
        done.add(u)
        if u in tset:
            found = u
            break
        nd = depth[u] + 1
        if nd > max_hops:
            continue
        for e in range(offs[u], offs[u + 1]):
            v = int(dst[e])
            if v in done:
                continue
            w = int(wgt[e]) or 1
            alt = d + (LOGMAX - math.log(w)) + hop_penalty
            if alt < dist.get(v, float('inf')):
                dist[v] = alt
                prev[v] = u
                depth[v] = nd
                heapq.heappush(h, (alt, v))
    if found < 0:
        return None
    path = []
    cur = found
    while cur != -1:
        path.append(cur)
        cur = prev[cur]
    return path[::-1]


CANDIDATES = [
    ("Escape jump",        ["LPLC2"],              ["TTMn"],                "A looming shadow triggers the giant-fibre escape circuit."),
    ("Sing back",          ["JO-A1"],              ["DLMn a, b"],           "Hear a courtship song, answer with one."),
    ("Follow an odour",    ["ORN_DA1"],            ["ltm1-tibia MN"],       "Smell food, walk towards it."),
    ("See a shadow",       ["R1-R6"],              ["DNp01"],               "Photoreceptors to the giant fibre."),
    ("Steer a turn",       ["T4c"],                ["DLMn c-f"],            "Horizontal motion to the steering muscles."),
    ("Startle to sound",   ["JO-A1"],              ["TTMn"],                "A sound, and the fly jumps."),
    ("Walk to a smell",    ["ORN_DC2"],            ["DNg01_a"],             "Odour to the descending neurons that drive walking."),
    ("Taste and reach",    ["BM_Taste"],           ["MN9"],                 "Taste a sugar, extend the proboscis."),
    ("Remember an odour",  ["ORN_DA1"],            ["MBON01"],              "Smell to the mushroom body's output — where a fly learns."),
]


def main():
    meta, labels, body, lab, offs, dst, wgt, ne = load()
    print(f"loaded {len(lab):,} neurons, {ne:,} edges\n")
    out = []
    for name, srcs, tgts, blurb in CANDIDATES:
        print("=" * 70)
        print(f"{name}   {srcs} → {tgts}")
        s = members(labels, lab, srcs)
        t = members(labels, lab, tgts)
        print(f"   {len(s)} source neurons, {len(t)} target neurons")
        if not len(s) or not len(t):
            print("   SKIP")
            continue
        p = route(offs, dst, wgt, s, t)
        if not p:
            print("   NO ROUTE FOUND")
            continue
        chain = [labels[lab[i]] for i in p]
        print(f"   route of {len(p)} neurons:")
        print("   " + "  →  ".join(chain))
        out.append({
            "id": name.lower().replace(" ", "-"),
            "name": name,
            "blurb": blurb,
            "sources": srcs,
            "targets": tgts,
            "chain": chain,
            "neurons": [int(i) for i in p],
        })
    with open(os.path.join(DATA, "behaviours.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(f"\nwrote data/behaviours.json with {len(out)} validated behaviours")


if __name__ == "__main__":
    main()
