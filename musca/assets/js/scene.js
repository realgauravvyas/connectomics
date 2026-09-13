/* ==========================================================================
   scene.js — the 3D brain
   Point clouds (166,700 somas + 1.1M synapses), GPU picking, activity waves.
   ========================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { colorFor, lin } from './palette.js';

const V = 1 / 1000;            // 8nm voxels → world units

/* ------------------------------------------------------------- shaders --- */

const NEURON_VS = /* glsl */`
attribute vec3 aColor;
attribute float aSize;
attribute float aAct;
attribute float aId;
uniform float uScale, uSize, uOpacity, uPixelRatio, uMax;
varying vec3 vColor;
varying float vAct;
void main() {
  vColor = aColor;
  vAct = aAct;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float s = uSize * aSize * (1.0 + 2.2 * aAct);
  gl_PointSize = clamp(s * uScale * uPixelRatio / max(-mv.z, 0.001), 0.7, uMax);
  gl_Position = projectionMatrix * mv;
}`;

const NEURON_FS = /* glsl */`
precision highp float;
varying vec3 vColor;
varying float vAct;
uniform float uOpacity, uAmp;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float fall = smoothstep(0.25, 0.0, r2);
  float core = smoothstep(0.08, 0.0, r2);
  // firing cells stay tinted by their own colour — only the very core goes white
  vec3 lit = mix(vColor * 1.9, vec3(1.0), 0.35);
  vec3 base = mix(vColor * 0.62, lit, clamp(vAct * 1.1, 0.0, 1.0));
  float amp = ((0.55 + vAct * 2.0) * fall + core * 0.30) * uAmp;
  gl_FragColor = vec4(base * amp * uOpacity, 1.0);
}`;

const SYNAPSE_VS = /* glsl */`
attribute float aId;
uniform float uScale, uSize, uPixelRatio, uMax;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(uSize * uScale * uPixelRatio / max(-mv.z, 0.001), 0.6, uMax);
  gl_Position = projectionMatrix * mv;
  vFade = 1.0;
}`;

const SYNAPSE_FS = /* glsl */`
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  gl_FragColor = vec4(uColor * smoothstep(0.25, 0.0, r2) * uOpacity, 1.0);
}`;

const EDGE_VS = /* glsl */`
attribute float aHop;
attribute float aInt;
uniform float uT, uOpacity, uPersist;
varying float vA;
void main() {
  float rise = smoothstep(aHop - 1.2, aHop, uT);
  float fade = exp(-max(uT - aHop, 0.0) * 0.42);
  vA = aInt * rise * mix(fade, 0.85, uPersist) * uOpacity;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const EDGE_FS = /* glsl */`
precision mediump float;
uniform vec3 uColor;
varying float vA;
void main() {
  if (vA < 0.004) discard;
  gl_FragColor = vec4(uColor * vA * 1.5, 1.0);
}`;

const PICK_VS = /* glsl */`
attribute float aId;
attribute float aSize;
uniform float uScale, uSize, uPixelRatio, uMax;
varying float vId;
void main() {
  vId = aId;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp((uSize + 3.0) * aSize * uScale * uPixelRatio / max(-mv.z, 0.001), 2.0, uMax);
  gl_Position = projectionMatrix * mv;
}`;

const PICK_FS = /* glsl */`
precision highp float;
varying float vId;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  float id = vId + 1.0;
  float r = floor(id / 65536.0);
  float g = floor(mod(id, 65536.0) / 256.0);
  float b = mod(id, 256.0);
  gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}`;

/* --------------------------------------------------------------- class --- */

export class Brain {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x04070d, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x04070d, 0.0022);

    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 6000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 1400;
    this.controls.autoRotateSpeed = 0.35;

    this.clock = new THREE.Clock();
    this.t = 0;
    this.anim = null;
    this.animT = 0;
    this.playing = false;
    this.animSpeed = 1;

    this.onResize();
    addEventListener('resize', () => this.onResize());

    this._pickRT = null;
    this._px = new Uint8Array(4);
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  onResize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
    if (this._pickRT) { this._pickRT.setSize(w, h); }
  }

  /* ------------------------------------------------------------ setup --- */
  setData(D) {
    this.D = D;
    const n = D.n;
    const b = D.meta.bounds;

    // centre on the centroid of the cells rather than the bounding box, so the
    // brain sits in the middle of the frame instead of drifting to one side
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += D.pos[3 * i]; my += D.pos[3 * i + 1]; mz += D.pos[3 * i + 2]; }
    this.centre = [mx / n, my / n, mz / n];
    const span = Math.max(b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0]) * V;
    this.span = span;

    // voxel (x,y,z) → world (z, y, x): long body axis on X, dorsal up
    const C = this.centre;
    this.toWorld = (x, y, z, out) => {
      out[0] = (z - C[2]) * V;
      out[1] = (y - C[1]) * V;
      out[2] = (x - C[0]) * V;
      return out;
    };

    /* ---- neuron cloud ---- */
    const pos = new Float32Array(3 * n);
    const col = new Float32Array(3 * n);
    const size = new Float32Array(n);
    const act = new Float32Array(n);
    const tmp = [0, 0, 0];
    let maxDeg = 1;
    for (let i = 0; i < n; i++) if (D.pre[i] + D.post[i] > maxDeg) maxDeg = D.pre[i] + D.post[i];
    const lmax = Math.log1p(maxDeg);
    for (let i = 0; i < n; i++) {
      this.toWorld(D.pos[3 * i], D.pos[3 * i + 1], D.pos[3 * i + 2], tmp);
      pos[3 * i] = tmp[0]; pos[3 * i + 1] = tmp[1]; pos[3 * i + 2] = tmp[2];
      const d = D.pre[i] + D.post[i];
      size[i] = 0.62 + 0.85 * (Math.log1p(d) / lmax);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAct', new THREE.BufferAttribute(act, 1));
    geo.setAttribute('aId', new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), span * 1.4);

    this.neuronMat = new THREE.ShaderMaterial({
      vertexShader: NEURON_VS, fragmentShader: NEURON_FS,
      uniforms: {
        uScale: { value: 1 }, uSize: { value: 2.2 }, uMax: { value: 22 },
        uOpacity: { value: 1 }, uAmp: { value: 1 }, uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.neurons = new THREE.Points(geo, this.neuronMat);
    this.neurons.frustumCulled = false;
    this.scene.add(this.neurons);
    this.act = act;
    this.colAttr = geo.getAttribute('aColor');
    this.actAttr = geo.getAttribute('aAct');

    this.pickMat = new THREE.ShaderMaterial({
      vertexShader: PICK_VS, fragmentShader: PICK_FS,
      uniforms: {
        uScale: { value: 1 }, uSize: { value: 2.2 }, uMax: { value: 46 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
    });

    /* ---- synapse cloud ---- */
    const m = D.sn;
    const spos = new Float32Array(3 * m);
    for (let i = 0; i < m; i++) {
      this.toWorld(D.synPos[3 * i], D.synPos[3 * i + 1], D.synPos[3 * i + 2], tmp);
      spos[3 * i] = tmp[0]; spos[3 * i + 1] = tmp[1]; spos[3 * i + 2] = tmp[2];
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
    sgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), span * 1.4);
    this.synMat = new THREE.ShaderMaterial({
      vertexShader: SYNAPSE_VS, fragmentShader: SYNAPSE_FS,
      uniforms: {
        uScale: { value: 1 }, uSize: { value: 1.5 }, uMax: { value: 2.6 },
        uOpacity: { value: 0.16 }, uColor: { value: new THREE.Vector3(...lin('#5fa8e8')) },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.synapses = new THREE.Points(sgeo, this.synMat);
    this.synapses.frustumCulled = false;
    this.scene.add(this.synapses);

    /* ---- dynamic layers ---- */
    this.hiGeo = new THREE.BufferGeometry();
    this.hiGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.hiMat = new THREE.ShaderMaterial({
      vertexShader: NEURON_VS, fragmentShader: NEURON_FS,
      uniforms: {
        uScale: { value: 1 }, uSize: { value: 5.5 }, uMax: { value: 22 },
        uOpacity: { value: 1 }, uAmp: { value: 0.5 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.hi = new THREE.Points(this.hiGeo, this.hiMat);
    this.hi.frustumCulled = false;
    this.scene.add(this.hi);

    this.edgeGeo = new THREE.BufferGeometry();
    this.edgeMat = new THREE.ShaderMaterial({
      vertexShader: EDGE_VS, fragmentShader: EDGE_FS,
      uniforms: {
        uT: { value: 0 }, uOpacity: { value: 1 }, uPersist: { value: 0 },
        uColor: { value: new THREE.Vector3(...lin('#7fe6ff')) },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.edges = new THREE.LineSegments(this.edgeGeo, this.edgeMat);
    this.edges.frustumCulled = false;
    this.edges.visible = false;
    this.scene.add(this.edges);

    this.setColorMode('superclass');
    this.resetCamera();
  }

  resetCamera() {
    const d = this.span * 0.86;
    this.camera.position.set(d * 0.62, d * 0.40, d * 0.84);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.updateScale();
  }

  updateScale() {
    // point size ∝ 1/distance so the cloud keeps a constant apparent density
    const dist = this.camera.position.distanceTo(this.controls.target);
    const k = this.h / 900 * (this.span * 1.15) / Math.max(dist, 1);
    for (const m of [this.neuronMat, this.pickMat, this.hiMat]) m.uniforms.uScale.value = k * 26;
    this.synMat.uniforms.uScale.value = k * 26;
  }

  /* --------------------------------------------------------- colouring --- */
  setColorMode(mode, D = this.D) {
    this.colorMode = mode;
    const col = this.colAttr.array;
    const cache = new Map();
    for (let i = 0; i < D.n; i++) {
      const hex = colorFor(mode, D, i);
      let c = cache.get(hex);
      if (!c) { c = lin(hex); cache.set(hex, c); }
      col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
    }
    this.colAttr.needsUpdate = true;
  }

  /* ---------------------------------------------------------- highlight --- */
  setHighlight(indices) {
    const n = indices.length;
    const p = new Float32Array(3 * n);
    const c = new Float32Array(3 * n);
    const s = new Float32Array(n);
    const a = new Float32Array(n);
    const tmp = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      const i = indices[k];
      this.toWorld(this.D.pos[3 * i], this.D.pos[3 * i + 1], this.D.pos[3 * i + 2], tmp);
      p[3 * k] = tmp[0]; p[3 * k + 1] = tmp[1]; p[3 * k + 2] = tmp[2];
      const l = lin(colorFor(this.colorMode, this.D, i));
      c[3 * k] = l[0] * 1.6; c[3 * k + 1] = l[1] * 1.6; c[3 * k + 2] = l[2] * 1.6;
      s[k] = 1; a[k] = 0.55 + 0.45 * Math.sin(k);
    }
    this.hiGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.hiGeo.setAttribute('aColor', new THREE.BufferAttribute(c, 3));
    this.hiGeo.setAttribute('aSize', new THREE.BufferAttribute(s, 1));
    this.hiGeo.setAttribute('aAct', new THREE.BufferAttribute(a, 1));
    this.hiGeo.setDrawRange(0, n);
    this.hiGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.span * 1.5);
    this.hiGeo.computeBoundingSphere();
  }

  clearHighlight() { this.hiGeo.setDrawRange(0, 0); }

  /* ------------------------------------------------------------- waves --- */
  /**
   * @param {object} res   result of cascade() — act/hop/parent/order
   * @param {number} speed hops per second
   */
  playCascade(res, speed = 3.4, opts = {}) {
    this.anim = res;
    this.animT = 0;
    this.playing = true;
    this.animSpeed = speed;
    // leaving this set after Reverse mode makes the loop animate the cascade's
    // whole edge tree as if it were a 3-hop route, on a permanent 3s cycle
    this.isRoute = false;
    this.act.fill(0);
    this.actAttr.needsUpdate = true;
    this.clearHighlight();
    this.setHighlight(opts.highlight || []);
    this.buildEdges(res, opts.edgeColor || '#7fe6ff');
  }

  stopCascade() {
    this.playing = false;
    this.anim = null;
    this.isRoute = false;
    this.act.fill(0);
    this.actAttr.needsUpdate = true;
    this.edges.visible = false;
  }

  buildEdges(res, colorHex) {
    const D = this.D;
    const order = res.order;
    const maxE = 26000;
    const step = Math.max(1, Math.ceil(order.length / maxE));
    const list = [];
    for (let k = 0; k < order.length; k += step) {
      const i = order[k];
      if (res.parent[i] >= 0) list.push(i);
    }
    const n = list.length;
    const p = new Float32Array(6 * n);
    const hop = new Float32Array(2 * n);
    const inten = new Float32Array(2 * n);
    const tmp = [0, 0, 0];
    const D3 = D;
    for (let k = 0; k < n; k++) {
      const i = list[k], par = res.parent[i];
      this.toWorld(D3.pos[3 * par], D3.pos[3 * par + 1], D3.pos[3 * par + 2], tmp);
      p[6 * k] = tmp[0]; p[6 * k + 1] = tmp[1]; p[6 * k + 2] = tmp[2];
      this.toWorld(D3.pos[3 * i], D3.pos[3 * i + 1], D3.pos[3 * i + 2], tmp);
      p[6 * k + 3] = tmp[0]; p[6 * k + 4] = tmp[1]; p[6 * k + 5] = tmp[2];
      const h = res.hop[i];
      hop[2 * k] = h - 0.6; hop[2 * k + 1] = h;
      const a = Math.min(1, 0.35 + res.act[i] * 1.6);
      inten[2 * k] = a * 0.5; inten[2 * k + 1] = a;
    }
    this.edgeGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.edgeGeo.setAttribute('aHop', new THREE.BufferAttribute(hop, 1));
    this.edgeGeo.setAttribute('aInt', new THREE.BufferAttribute(inten, 1));
    this.edgeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.span * 1.6);
    this.edgeMat.uniforms.uColor.value.set(...lin(colorHex));
    this.edgeMat.uniforms.uPersist.value = 0;
    this.edges.visible = true;
    this.edgeCount = n;
  }

  /** Draw a fixed route (Reverse mode) as a slow-motion chain. */
  playRoute(indices, speed = 1.6) {
    const D = this.D;
    const n = indices.length;
    const p = new Float32Array(6 * (n - 1));
    const hop = new Float32Array(2 * (n - 1));
    const inten = new Float32Array(2 * (n - 1)).fill(1);
    const tmp = [0, 0, 0];
    for (let k = 0; k < n - 1; k++) {
      const a = indices[k], b = indices[k + 1];
      this.toWorld(D.pos[3 * a], D.pos[3 * a + 1], D.pos[3 * a + 2], tmp);
      p[6 * k] = tmp[0]; p[6 * k + 1] = tmp[1]; p[6 * k + 2] = tmp[2];
      this.toWorld(D.pos[3 * b], D.pos[3 * b + 1], D.pos[3 * b + 2], tmp);
      p[6 * k + 3] = tmp[0]; p[6 * k + 4] = tmp[1]; p[6 * k + 5] = tmp[2];
      hop[2 * k] = k - 0.5; hop[2 * k + 1] = k;
    }
    this.edgeGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.edgeGeo.setAttribute('aHop', new THREE.BufferAttribute(hop, 1));
    this.edgeGeo.setAttribute('aInt', new THREE.BufferAttribute(inten, 1));
    this.edgeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.span * 1.6);
    this.edgeMat.uniforms.uColor.value.set(...lin('#ff4fd8'));
    this.edgeMat.uniforms.uPersist.value = 0.72;
    this.edges.visible = true;
    this.anim = null;
    this.playing = false;
    this.routeLen = n - 1;
    this.routeT = 0;
    this.routeSpeed = speed;
    this.isRoute = true;
  }

  /* -------------------------------------------------------------- loop --- */
  _loop() {
    requestAnimationFrame(this._loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;

    if (this.anim && this.playing) {
      this.animT += dt * this.animSpeed;
      const res = this.anim;
      const A = this.act;
      const o = res.order;
      for (let k = 0; k < o.length; k++) {
        const i = o[k];
        const d = this.animT - res.hop[i];
        // rise fast, decay to a persistent floor so the reached territory stays lit.
        // act ** 0.6 compresses the dynamic range: activity falls off by decay per
        // hop, so raw values are ~0.05 five hops out and the footprint would be
        // invisible. Gamma keeps the ranking (strong near the seed, weak far away)
        // while letting the whole reached set actually read on screen.
        const a = Math.pow(res.act[i], 0.6);
        A[i] = d < 0 ? 0
          : a * (1 - Math.exp(-d * 3.2)) * (0.42 + 0.58 * Math.exp(-d * 0.30));
      }
      this.actAttr.needsUpdate = true;
      this.edgeMat.uniforms.uT.value = this.animT;
      if (this.animT > res.hops + 6) this.playing = false;
    } else if (this.isRoute && this.edges.visible) {
      this.routeT += dt * this.routeSpeed;
      this.edgeMat.uniforms.uT.value = this.routeT % (this.routeLen + 3);
    }

    if (this.hiGeo.getAttribute('aAct')) {
      // gentle shimmer on highlighted cells
      const a = this.hiGeo.getAttribute('aAct');
      if (a.count > 0) {
        const arr = a.array;
        for (let i = 0; i < a.count; i++) arr[i] = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.t * 2.2 + i * 0.6));
        a.needsUpdate = true;
      }
    }

    this.controls.update();
    this.updateScale();
    this.renderer.render(this.scene, this.camera);
  }

  /* ------------------------------------------------------------ picking --- */
  /** @returns {number} neuron index under the cursor, or -1 */
  pick(clientX, clientY) {
    if (!this._pickRT) this._pickRT = new THREE.WebGLRenderTarget(this.w, this.h);
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.round(clientX - rect.left);
    const y = Math.round(rect.height - (clientY - rect.top) - 1);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;

    const prevMat = this.neurons.material;
    const synVis = this.synapses.visible;
    const hiVis = this.hi.visible;
    const edVis = this.edges.visible;
    this.neurons.material = this.pickMat;
    this.synapses.visible = false;
    this.hi.visible = false;
    this.edges.visible = false;

    this.renderer.setRenderTarget(this._pickRT);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.readRenderTargetPixels(this._pickRT, x, y, 1, 1, this._px);

    this.neurons.material = prevMat;
    this.synapses.visible = synVis;
    this.hi.visible = hiVis;
    this.edges.visible = edVis;

    const [r, g, b] = this._px;
    if (r === 0 && g === 0 && b === 0) return -1;
    const id = r * 65536 + g * 256 + b - 1;
    return id >= 0 && id < this.D.n ? id : -1;
  }

  /* --------------------------------------------------------------- misc --- */
  worldOf(i, out = new THREE.Vector3()) {
    const D = this.D, t = [0, 0, 0];
    this.toWorld(D.pos[3 * i], D.pos[3 * i + 1], D.pos[3 * i + 2], t);
    return out.set(t[0], t[1], t[2]);
  }

  flyTo(i, dist = this.span * 0.45) {
    const p = this.worldOf(i);
    this.controls.target.copy(p);
    const dir = new THREE.Vector3().subVectors(this.camera.position, p).normalize();
    this.camera.position.copy(p).addScaledVector(dir, dist);
    this.controls.update();
  }

  /** Pull the camera back just far enough to hold a set of neurons. */
  /**
   * Move the camera so `indices` are all on screen.
   * `pad` is slack around the bounding sphere; `zoomOut` pulls the camera
   * further back so a small circuit is still seen in the context of the whole
   * CNS instead of filling the frame on its own.
   */
  frameIndices(indices, pad = 1.7, zoomOut = 1) {
    if (!indices || !indices.length) return;
    const a = new THREE.Vector3(Infinity, Infinity, Infinity);
    const b = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const v = new THREE.Vector3();
    for (const i of indices) {
      this.worldOf(i, v);
      a.min(v); b.max(v);
    }
    const c = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const radius = Math.max(b.distanceTo(a) * 0.5, this.span * 0.09);
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = Math.min((radius * pad * zoomOut) / Math.tan(fov / 2), this.span * 0.78);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.controls.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, dist);
    this.controls.update();
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }
  setSynapseVisible(on) { this.synapses.visible = on; }
  setNeuronVisible(on) { this.neurons.visible = on; }
  setSynapseOpacity(v) { this.synMat.uniforms.uOpacity.value = v; }
  setNeuronOpacity(v) { this.neuronMat.uniforms.uOpacity.value = v; }
}
