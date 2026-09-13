/**
 * render.js — WebGL renderer for the connectome.
 *
 * Two passes:
 *   1. Every neuron as a point. Colour comes from its brain region;
 *      brightness from a glow value the simulation decays after each spike.
 *   2. The synapses that are firing *right now* as short lines, so you can
 *      watch signals actually travel between regions instead of only seeing
 *      the endpoints light up.
 *
 * Additive blending on a dark background: where many neurons fire together
 * the light stacks up and the region blooms.
 */

const LINE_VERT = `
precision highp float;
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aAlpha;
uniform mat4 uMVP;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vColor = aColor;
  vAlpha = aAlpha;
}`;

const LINE_FRAG = `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(vColor * vAlpha * uOpacity, vAlpha * uOpacity);
}`;

const VERT = `
precision highp float;
attribute vec3 aPos;
attribute vec3 aColor;
attribute float aGlow;
attribute float aRegion;

uniform mat4 uMVP;
uniform float uW;
uniform float uPointScale;
uniform float uHighlight;   // region index to isolate, or -1
uniform float uSize;

varying vec3  vColor;
varying float vGlow;

void main() {
  vec4 p = uMVP * vec4(aPos, 1.0);
  gl_Position = p;

  float dist = max(p.w, 0.05);
  float size = clamp(uPointScale / dist, 0.9, 14.0) * uSize;

  float dim = 1.0;
  if (uHighlight >= 0.0) {
    dim = abs(aRegion - uHighlight) < 0.5 ? 1.0 : 0.10;
  }

  gl_PointSize = size * (1.0 + aGlow * 2.2);

  vColor = aColor * dim;
  vGlow  = aGlow * dim;
}`;

const FRAG = `
precision highp float;
varying vec3  vColor;
varying float vGlow;
uniform float uExposure;

void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float a = 1.0 - r;
  a = a * a;                       // soft round falloff
  vec3 c = vColor * (0.28 + vGlow * 2.0);
  gl_FragColor = vec4(c * a * uExposure, a * (0.45 + vGlow * 0.55));
}`;

// ---------------------------------------------------------------- matrices
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}
function lookAt(eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
  ]);
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                     a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

// -------------------------------------------------------------- palette
// Distinct hues that stay readable when additively blended on black.
const REGION_COLORS = {
  OL: [0.35, 0.72, 1.00], AL: [1.00, 0.78, 0.28], MB: [0.72, 0.45, 1.00],
  LH: [1.00, 0.42, 0.55], VNC: [0.45, 0.95, 0.70], CX: [0.98, 0.98, 0.55],
  CB: [0.55, 0.85, 0.95], SEZ: [1.00, 0.62, 0.30], AMMC: [0.60, 0.90, 1.00],
  DN: [0.85, 0.85, 0.95], P1: [1.00, 0.35, 0.85], DAN: [0.55, 1.00, 0.45],
};
function colorFor(uid) {
  const base = uid.split('_')[0];
  const c = REGION_COLORS[base] || [0.8, 0.8, 0.8];
  // right hemisphere slightly dimmer/cooler so the two sides read apart
  return uid.endsWith('_R') ? [c[0] * 0.82, c[1] * 0.86, c[2] * 1.0] : c;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      antialias: false, alpha: false, depth: false,
      premultipliedAlpha: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;

    this.yaw = 0.6;
    this.pitch = -0.25;
    this.dist = 3.2;
    this.target = [0, 0, 0];
    this.autoRotate = true;
    this.spin = 0.045;         // radians per second
    this.highlight = -1;
    this.size = 1;
    this.exposure = 1;

    // synapse pass
    this.showWires = true;
    this.wireOpacity = 1;
    this.lineCount = 0;

    this._initGL();
    this._initLines();
    this._initInput();
  }

  _initLines() {
    const gl = this.gl;
    const prog = gl.createProgram();
    const add = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('line shader: ' + gl.getShaderInfoLog(s));
      }
      gl.attachShader(prog, s);
    };
    add(gl.VERTEX_SHADER, LINE_VERT);
    add(gl.FRAGMENT_SHADER, LINE_FRAG);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('line link: ' + gl.getProgramInfoLog(prog));
    }
    this.lineProg = prog;
    this.laPos = gl.getAttribLocation(prog, 'aPos');
    this.laColor = gl.getAttribLocation(prog, 'aColor');
    this.laAlpha = gl.getAttribLocation(prog, 'aAlpha');
    this.luMVP = gl.getUniformLocation(prog, 'uMVP');
    this.luOpacity = gl.getUniformLocation(prog, 'uOpacity');

    // Two vertices per line, capped so the per-frame upload stays small.
    this.MAX_LINES = 9000;
    const m = this.MAX_LINES * 2;
    this.lPos = new Float32Array(m * 3);
    this.lCol = new Float32Array(m * 3);
    this.lAlpha = new Float32Array(m);
    this.lBufPos = gl.createBuffer();
    this.lBufCol = gl.createBuffer();
    this.lBufAlpha = gl.createBuffer();
    for (const [b, arr] of [[this.lBufPos, this.lPos], [this.lBufCol, this.lCol], [this.lBufAlpha, this.lAlpha]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    }
  }

  /**
   * Rebuild the synapse geometry from a ring buffer of recent spikes.
   * `ids`/`times` are parallel arrays; `now` is the current sim time in ms.
   * Only spikes younger than `windowMs` contribute, and each contributes a
   * handful of outgoing synapses — the point is to suggest traffic, not to
   * draw 2.3 million lines.
   */
  buildWires(ids, times, count, now, windowMs = 26) {
    const c = this.conn;
    if (!c) return;
    const pos = c.pos, off = c.outOffset, tgt = c.outTarget;
    const col = this.regionColor, regionOf = c.regionOf;
    const lp = this.lPos, lc = this.lCol, la = this.lAlpha;
    const maxVerts = this.MAX_LINES * 2;

    let vi = 0;
    let used = 0;
    const maxSpikes = 700;
    for (let k = 0; k < count && used < maxSpikes; k++) {
      const age = now - times[k];
      if (age < 0 || age > windowMs) continue;
      const s = ids[k];
      const sr = regionOf[s];
      const e0 = off[s], e1 = off[s + 1];
      const deg = e1 - e0;
      if (deg <= 0) continue;
      const stride = deg > 4 ? Math.ceil(deg / 4) : 1;
      const alpha = (1 - age / windowMs) * 0.55;
      for (let e = e0; e < e1 && vi + 2 <= maxVerts; e += stride) {
        const t = tgt[e];
        const a = vi * 3, b = (vi + 1) * 3;
        lp[a] = pos[s * 3]; lp[a + 1] = pos[s * 3 + 1]; lp[a + 2] = pos[s * 3 + 2];
        lp[b] = pos[t * 3]; lp[b + 1] = pos[t * 3 + 1]; lp[b + 2] = pos[t * 3 + 2];
        // colour the wire by its source region, blended toward the target's
        const tr = regionOf[t];
        const s3 = sr * 3, t3 = tr * 3;
        lc[a] = col[s3]; lc[a + 1] = col[s3 + 1]; lc[a + 2] = col[s3 + 2];
        lc[b] = col[t3]; lc[b + 1] = col[t3 + 1]; lc[b + 2] = col[t3 + 2];
        la[vi] = alpha; la[vi + 1] = alpha * 0.25;
        vi += 2;
      }
      used++;
    }
    this.lineCount = vi;

    const gl = this.gl;
    if (vi > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lBufPos);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lp.subarray(0, vi * 3));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lBufCol);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, lc.subarray(0, vi * 3));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lBufAlpha);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, la.subarray(0, vi));
    }
  }

  _initGL() {
    const gl = this.gl;
    const prog = gl.createProgram();
    const add = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error('shader: ' + gl.getShaderInfoLog(s));
      }
      gl.attachShader(prog, s);
    };
    add(gl.VERTEX_SHADER, VERT);
    add(gl.FRAGMENT_SHADER, FRAG);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    this.prog = prog;

    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aColor = gl.getAttribLocation(prog, 'aColor');
    this.aGlow = gl.getAttribLocation(prog, 'aGlow');
    this.aRegion = gl.getAttribLocation(prog, 'aRegion');
    this.uMVP = gl.getUniformLocation(prog, 'uMVP');
    this.uPointScale = gl.getUniformLocation(prog, 'uPointScale');
    this.uHighlight = gl.getUniformLocation(prog, 'uHighlight');
    this.uSize = gl.getUniformLocation(prog, 'uSize');
    this.uExposure = gl.getUniformLocation(prog, 'uExposure');

    this.bufPos = gl.createBuffer();
    this.bufColor = gl.createBuffer();
    this.bufGlow = gl.createBuffer();
    this.bufRegion = gl.createBuffer();

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);   // additive
    gl.clearColor(0.016, 0.019, 0.031, 1);
  }

  /** Upload the (static) geometry once the connectome exists. */
  setConnectome(conn) {
    const gl = this.gl, n = conn.n;
    this.conn = conn;
    this.n = n;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, conn.pos, gl.STATIC_DRAW);

    const col = new Float32Array(n * 3);
    const reg = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = conn.regionOf[i];
      const c = colorFor(conn.regions[r].uid);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      reg[i] = r;
    }
    this.regionColor = col;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufColor);
    gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufRegion);
    gl.bufferData(gl.ARRAY_BUFFER, reg, gl.STATIC_DRAW);

    this.glow = new Float32Array(n);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufGlow);
    gl.bufferData(gl.ARRAY_BUFFER, this.glow, gl.DYNAMIC_DRAW);

    // frame the whole brain
    let minx = 1e9, miny = 1e9, minz = 1e9, maxx = -1e9, maxy = -1e9, maxz = -1e9;
    const p = conn.pos;
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    this.center = [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2];
    this.target = this.center.slice();
    const span = Math.max(maxx - minx, maxy - miny, maxz - minz) || 1;
    this.dist = span * 1.5;
    this.span = span;
  }

  /**
   * Grey out (or restore) a whole region. Used to show what has been
   * lesioned — an ablated region should look dead, not merely quiet.
   */
  setRegionMuted(i, muted) {
    const c = this.conn;
    if (!c || !c.regions[i]) return;
    const r = c.regions[i];
    const col = this.regionColor;
    const base = colorFor(r.uid);
    for (let n = r.start; n < r.start + r.count; n++) {
      if (muted) {
        col[n * 3] = 0.13; col[n * 3 + 1] = 0.14; col[n * 3 + 2] = 0.17;
      } else {
        col[n * 3] = base[0]; col[n * 3 + 1] = base[1]; col[n * 3 + 2] = base[2];
      }
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufColor);
    gl.bufferSubData(gl.ARRAY_BUFFER, r.start * 3 * 4, col.subarray(r.start * 3, (r.start + r.count) * 3));
  }

  updateGlow(glowArr) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufGlow);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, glowArr);
  }

  _initInput() {
    const cv = this.canvas;
    let lx = 0, ly = 0, moved = 0;
    this.dragging = false;   // exposed so the app can suppress hover picking

    cv.addEventListener('pointerdown', (e) => {
      this.dragging = true; moved = 0; lx = e.clientX; ly = e.clientY;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      this.yaw += dx * 0.006;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.006));
      if (moved > 6) this.autoRotate = false;
    });
    const up = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
      if (moved < 6 && this.onPick) this.onPick(e);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { this.dragging = false; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist *= Math.exp(e.deltaY * 0.0012);
      this.dist = Math.max(this.span * 0.12, Math.min(this.span * 6, this.dist));
    }, { passive: false });
  }

  /** Convert a click into a neuron index (nearest point along the ray). */
  pick(clientX, clientY) {
    if (!this.conn) return -1;
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;

    const { mvp, eye } = this._camera();
    // Ray through the cursor: unproject at two depths.
    const p0 = this._unproject(ndcX, ndcY, -1, mvp);
    const p1 = this._unproject(ndcX, ndcY, 1, mvp);
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / dl, uy = dy / dl, uz = dz / dl;

    const p = this.conn.pos, n = this.n;
    let best = -1, bestT = 1e9, bestPerp = this.span * 0.03;
    for (let i = 0; i < n; i++) {
      const vx = p[i * 3] - p0[0], vy = p[i * 3 + 1] - p0[1], vz = p[i * 3 + 2] - p0[2];
      const t = vx * ux + vy * uy + vz * uz;
      if (t < 0) continue;
      const px = vx - ux * t, py = vy - uy * t, pz = vz - uz * t;
      const perp = Math.hypot(px, py, pz);
      // prefer close-to-cursor, and among those prefer nearer the camera
      if (perp < bestPerp) { bestPerp = perp * 0.85; bestT = t; best = i; }
      else if (perp < bestPerp * 1.2 && t < bestT) { bestT = t; best = i; }
    }
    return best;
  }

  _unproject(x, y, z, mvp) {
    // invert mvp (general 4x4 inverse)
    const m = mvp, inv = new Float32Array(16);
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return [0, 0, 0];
    det = 1 / det;
    inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
    return [
      (inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) / w,
      (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) / w,
      (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) / w,
    ];
  }

  _camera() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const cw = Math.max(1, Math.floor(w * dpr)), ch = Math.max(1, Math.floor(h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw; this.canvas.height = ch;
    }
    const proj = perspective(Math.PI / 4, cw / ch, this.span * 0.01, this.span * 20);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const t = this.target;
    const eye = [
      t[0] + this.dist * cp * sy,
      t[1] + this.dist * sp,
      t[2] + this.dist * cp * cy,
    ];
    const view = lookAt(eye, t, [0, 1, 0]);
    return { mvp: mul(proj, view), eye, w: cw, h: ch };
  }

  draw(dt) {
    if (!this.conn) return;
    const gl = this.gl;
    if (this.autoRotate) this.yaw += this.spin * (dt || 0.016);

    const { mvp, w, h } = this._camera();
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uMVP, false, mvp);
    gl.uniform1f(this.uPointScale, this.canvas.height * 0.0022 * this.span * 2.2);
    gl.uniform1f(this.uHighlight, this.highlight);
    gl.uniform1f(this.uSize, this.size);
    gl.uniform1f(this.uExposure, this.exposure);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufColor);
    gl.enableVertexAttribArray(this.aColor);
    gl.vertexAttribPointer(this.aColor, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufRegion);
    gl.enableVertexAttribArray(this.aRegion);
    gl.vertexAttribPointer(this.aRegion, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufGlow);
    gl.enableVertexAttribArray(this.aGlow);
    gl.vertexAttribPointer(this.aGlow, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, this.n);

    // ------------------------------------------------------ synapse pass
    if (!this.showWires || this.lineCount === 0) return;
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(this.luMVP, false, mvp);
    gl.uniform1f(this.luOpacity, this.wireOpacity);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lBufPos);
    gl.enableVertexAttribArray(this.laPos);
    gl.vertexAttribPointer(this.laPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lBufCol);
    gl.enableVertexAttribArray(this.laColor);
    gl.vertexAttribPointer(this.laColor, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lBufAlpha);
    gl.enableVertexAttribArray(this.laAlpha);
    gl.vertexAttribPointer(this.laAlpha, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.LINES, 0, this.lineCount);
  }
}
