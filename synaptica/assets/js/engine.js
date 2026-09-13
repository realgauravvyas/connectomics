/* =========================================================================
 * SYNAPTICA — 3D engine + brain builder
 * Dependency-free: vanilla JS, Canvas 2D, custom perspective projection.
 * Builds the neuron cloud (nodes), expands the real pathway graph (edges),
 * and projects 3D points to the screen each frame.
 * ========================================================================= */
window.SYNAPTICA = window.SYNAPTICA || {};

SYNAPTICA.Engine = (function () {
  "use strict";

  // --- deterministic PRNG so the brain looks identical every load ---------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // box-muller gaussian
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16)
    ];
  }

  // --- build the brain -----------------------------------------------------
  function build(data, seed) {
    const rng = mulberry32(seed || 1337);
    const regions = {};       // id -> region (with centroid + nodes)
    const regionList = [];
    const nodes = [];

    // 1) expand regions (mirror L to R)
    data.REGIONS.forEach(function (base) {
      const sides = base.side === "C" ? [""] : ["_L", "_R"];
      sides.forEach(function (suffix) {
        const id = base.id + suffix;
        const pos = base.pos.slice();
        if (suffix === "_R") pos[0] = -pos[0]; // mirror across midline
        const rgb = hexToRgb(base.color);
        const region = {
          id: id,
          baseId: base.id,
          name: base.name,
          short: base.short,
          side: base.side === "C" ? "C" : (suffix === "_L" ? "L" : "R"),
          kind: base.kind,
          color: base.color,
          rgb: rgb,
          pos: pos,
          size: base.size,
          label: !!base.label,
          desc: base.desc,
          centroid: pos.slice(),
          act: 0,          // activation 0..~1.2 (live)
          nodes: [],
          outEdges: []     // indices into edges[]
        };
        regions[id] = region;
        regionList.push(region);
      });
    });

    // 2) generate neuron nodes around each region centre (ellipsoid cloud)
    let nodeIndex = 0;
    regionList.forEach(function (region) {
      const count = Math.max(30, Math.min(520, Math.round(Math.pow(region.size, 3) * 26000)));
      const spread = region.size * 0.95;
      for (let i = 0; i < count; i++) {
        const p = [
          region.pos[0] + gauss(rng) * spread,
          region.pos[1] + gauss(rng) * spread * 0.8,
          region.pos[2] + gauss(rng) * spread
        ];
        const node = {
          i: nodeIndex++,
          region: region.id,
          x: p[0], y: p[1], z: p[2],
          r: 0.010 + region.size * 0.022,   // world radius
          tw: 0.4 + rng() * 0.6             // per-node brightness variance
        };
        nodes.push(node);
        region.nodes.push(node);
      }
      // centroid = average of generated nodes (more organic than the seed pos)
      let cx = 0, cy = 0, cz = 0;
      region.nodes.forEach(function (n) { cx += n.x; cy += n.y; cz += n.z; });
      const k = region.nodes.length || 1;
      region.centroid = [cx / k, cy / k, cz / k];
    });

    // 3) expand edges
    const edges = [];
    const defById = {};
    data.REGIONS.forEach(function (b) { defById[b.id] = b; });
    // resolve an expanded region id: central (side 'C') regions keep their id,
    // left/right regions get a '_L' / '_R' suffix.
    function rid(baseId, suffix) {
      const b = defById[baseId];
      return (b && b.side === "C") ? baseId : baseId + suffix;
    }
    function addEdge(fromId, toId, def) {
      const from = regions[fromId], to = regions[toId];
      if (!from || !to) return;
      const edge = {
        id: fromId + "->" + toId,
        from: fromId, to: toId,
        fromR: from, toR: to,
        synapses: def.synapses || 8000,
        trainable: !!def.trainable,
        plasticity: 0,        // Hebbian bonus 0..1 (session)
        fromC: from.centroid,
        toC: to.centroid,
        fibers: []
      };
      // a few faint fibre lines for visual richness
      const fn = Math.min(6, Math.floor(from.nodes.length / 12) + 1);
      for (let f = 0; f < fn; f++) {
        const a = from.nodes[Math.floor(rng() * from.nodes.length)];
        const b = to.nodes[Math.floor(rng() * to.nodes.length)];
        edge.fibers.push([a, b]);
      }
      const idx = edges.length;
      edges.push(edge);
      from.outEdges.push(idx);
    }

    data.EDGES.forEach(function (def) {
      if (def.mode === "mirror") {
        addEdge(rid(def.from, "_L"), rid(def.to, "_L"), def);
        addEdge(rid(def.from, "_R"), rid(def.to, "_R"), def);
      } else if (def.mode === "central") {
        addEdge(rid(def.from, ""), rid(def.to, ""), def);
      } else if (def.mode === "cross") {
        addEdge(rid(def.from, "_L"), rid(def.to, "_R"), def);
        addEdge(rid(def.from, "_R"), rid(def.to, "_L"), def);
      }
    });

    return { regions: regions, regionList: regionList, nodes: nodes, edges: edges };
  }

  // --- 3D rotation + perspective projection -------------------------------
  // cam = { yaw, pitch, camZ, f, cx, cy }
  function project(p, cam) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    let x = p[0] * cy + p[2] * sy;
    let z = -p[0] * sy + p[2] * cy;
    let y = p[1];
    const cx = Math.cos(cam.pitch), sx = Math.sin(cam.pitch);
    const y2 = y * cx - z * sx;
    const z2 = y * sx + z * cx;
    const depth = cam.camZ - z2;
    if (depth <= 0.05) return { visible: false };
    const s = cam.f / depth;
    return {
      visible: true,
      x: cam.cx + x * s,
      y: cam.cy - y2 * s,
      s: s,
      depth: depth
    };
  }

  // linear interpolate between two 3D points
  function lerp3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  return { build: build, project: project, lerp3: lerp3, hexToRgb: hexToRgb, mulberry32: mulberry32 };
})();
