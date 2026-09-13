/**
 * shapes.js — volumetric templates for laying out neurons in 3D.
 *
 * Each sampler writes a point into `out[o], out[o+1], out[o+2]`.
 * They are deliberately simple: we are sculpting a recognisable fly brain,
 * not reconstructing one.
 */

function ellipsoid(rng, s, out, o) {
  const r = s.shell ? Math.pow(rng.range(Math.pow(s.shell, 3), 1), 1 / 3) : Math.cbrt(rng.float());
  const th = rng.range(0, Math.PI * 2);
  const ph = Math.acos(rng.range(-1, 1));
  out[o]     = s.c[0] + r * s.r[0] * Math.sin(ph) * Math.cos(th);
  out[o + 1] = s.c[1] + r * s.r[1] * Math.cos(ph);
  out[o + 2] = s.c[2] + r * s.r[2] * Math.sin(ph) * Math.sin(th);
}

function torus(rng, s, out, o) {
  const th = rng.range(0, Math.PI * 2);      // around the ring
  const ph = rng.range(0, Math.PI * 2);      // around the tube
  const rr = s.tube * Math.sqrt(rng.float());
  const rad = s.R + rr * Math.cos(ph);
  const vert = rr * Math.sin(ph);
  if (s.plane === 'xz') {
    out[o]     = s.c[0] + rad * Math.cos(th);
    out[o + 1] = s.c[1] + vert;
    out[o + 2] = s.c[2] + rad * Math.sin(th);
  } else { // xy
    out[o]     = s.c[0] + rad * Math.cos(th);
    out[o + 1] = s.c[1] + rad * Math.sin(th);
    out[o + 2] = s.c[2] + vert;
  }
}

function arc(rng, s, out, o) {
  const th = rng.range(-s.a, s.a);
  const j = s.jitter || 0.015;
  const rad = s.R * (1 + rng.range(-j, j));
  if (s.plane === 'xy') {
    out[o]     = s.c[0] + rad * Math.sin(th);
    out[o + 1] = s.c[1] - s.R * Math.cos(th) * 0.25;
    out[o + 2] = s.c[2] + rng.range(-j, j);
  } else {
    out[o]     = s.c[0] + rad * Math.sin(th);
    out[o + 1] = s.c[1] + rng.range(-j, j);
    out[o + 2] = s.c[2] - s.R * Math.cos(th) * 0.25;
  }
}

/** Quadratic bezier swept with a varying radius — peduncles, lobes, tracts. */
function capsule(rng, s, out, o) {
  const t = Math.pow(rng.float(), 0.7);
  const u = 1 - t;
  const bx = u * u * s.p0[0] + 2 * u * t * s.p1[0] + t * t * s.p2[0];
  const by = u * u * s.p0[1] + 2 * u * t * s.p1[1] + t * t * s.p2[1];
  const bz = u * u * s.p0[2] + 2 * u * t * s.p1[2] + t * t * s.p2[2];
  const bulge = 1 + 0.9 * Math.sin(Math.PI * t);           // swell at the lobes
  const r = (s.r0 + (s.r1 - s.r0) * t) * bulge;
  const rr = r * Math.cbrt(rng.float());
  const th = rng.range(0, Math.PI * 2);
  const ph = Math.acos(rng.range(-1, 1));
  out[o]     = bx + rr * Math.sin(ph) * Math.cos(th);
  out[o + 1] = by + rr * Math.cos(ph) * 0.8;
  out[o + 2] = bz + rr * Math.sin(ph) * Math.sin(th);
}

function column(rng, s, out, o) {
  const y = s.c[1] + rng.range(-s.h / 2, s.h / 2);
  const rr = s.r * Math.sqrt(rng.float());
  const th = rng.range(0, Math.PI * 2);
  out[o]     = s.c[0] + rr * Math.cos(th);
  out[o + 1] = y;
  out[o + 2] = s.c[2] + rr * Math.sin(th);
}

/** Pick a weighted part, then sample it. */
function composite(rng, s, out, o) {
  let r = rng.float();
  for (let i = 0; i < s.parts.length; i++) {
    r -= s.parts[i].w;
    if (r <= 0) return sample(rng, s.parts[i], out, o);
  }
  return sample(rng, s.parts[s.parts.length - 1], out, o);
}

export function sample(rng, s, out, o) {
  switch (s.t) {
    case 'ellipsoid': return ellipsoid(rng, s, out, o);
    case 'torus':     return torus(rng, s, out, o);
    case 'arc':       return arc(rng, s, out, o);
    case 'capsule':   return capsule(rng, s, out, o);
    case 'column':    return column(rng, s, out, o);
    case 'composite': return composite(rng, s, out, o);
    default:          return ellipsoid(rng, s, out, o);
  }
}

/** Average point of a shape — used for region labels and camera framing. */
export function centroid(s) {
  if (s.t === 'composite') {
    let x = 0, y = 0, z = 0, w = 0;
    for (const p of s.parts) {
      const c = centroid(p);
      x += c[0] * p.w; y += c[1] * p.w; z += c[2] * p.w; w += p.w;
    }
    return [x / w, y / w, z / w];
  }
  if (s.t === 'capsule') return [(s.p0[0] + 2 * s.p1[0] + s.p2[0]) / 4, (s.p0[1] + 2 * s.p1[1] + s.p2[1]) / 4, (s.p0[2] + 2 * s.p1[2] + s.p2[2]) / 4];
  return s.c.slice();
}
