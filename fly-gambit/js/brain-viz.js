/*
 * FlyGambit - brain-viz.js  (requires THREE, three.min.js loaded first)
 *
 * A stylized Drosophila melanogaster rendered in 3D. Its head contains the
 * live connectome of the playing network, with regions placed roughly where
 * the real anatomy sits:
 *
 *   input units (773)     -> optic neuropil: 64-square "retina" curved over
 *                            the head, 12 piece-planes stacked as shells
 *   hidden1  (256, k=20)  -> lobula complex (two lateral lobes)
 *   hidden2  (128, k=20)  -> mushroom body lobes (paired, dorsal)
 *   action   (64)          -> central complex (ellipsoid + fan-shaped body)
 *
 * Synapse curves are quadratic beziers bulged radially outward, colored
 * additively by pre-synaptic activity * |weight|.
 */
(function (global) {
  'use strict';

  var T = global.THREE;
  var SIZE = null; // set from FG.FlyBrain.SIZE

  function gauss(sx, sy, sz) {
    return [FG.randn() * sx, FG.randn() * sy, FG.randn() * sz];
  }

  function headPos(x, y, z) { return new T.Vector3(x, y, z); }

  /* ------- neuron layout (head-local space, head radius ~1.35) -------- */
  function layoutNeurons() {
    var pos = {};
    // optic: shells: plane p (0..11), square s (0..63)
    var optic = [];
    var nR = 1.30, nG = 0.09; // neuron center
    for (var p = 0; p < 12; p++) {
      var shell = 0.62 + p * 0.055;
      for (var s = 0; s < 64; s++) {
        var r = (s >> 3) / 7, c = (s & 7) / 7;
        var az = (c - 0.5) * 1.85, el = (0.5 - r) * 1.35;
        var x = Math.sin(az) * Math.cos(el) * shell;
        var y = Math.sin(el) * shell * 0.92 + 0.08;
        var z = Math.cos(az) * Math.cos(el) * shell;
        optic.push([x + nR * 0.0, y + nG * 0.2, z - nG]);
      }
    }
    pos.optic = optic; // 768 piece-planes + the 5 state units appended below
    // turn + castling units: a tiny antenna-side cluster (the "context ring")
    for (var st = 0; st < 5; st++) {
      var ang = -0.9 + st * 0.16;
      optic.push([Math.sin(ang) * 1.15, 0.95 + st * 0.05, 1.0 + Math.cos(ang) * 0.15]);
    }
    // lobula complex: two lateral-posterior lobes
    var lob = [];
    for (var i = 0; i < 256; i++) {
      var side = i % 2 === 0 ? -1 : 1;
      var g = gauss(0.16, 0.30, 0.20);
      lob.push([side * 0.78 + g[0], 0.02 + g[1], -0.62 + g[2]]);
    }
    pos.lobula = lob;
    // mushroom body: paired dorsal vertical lobes
    var mb = [];
    for (var m = 0; m < 128; m++) {
      var sd = m < 64 ? -1 : 1;
      var gg = gauss(0.11, 0.42, 0.10);
      mb.push([sd * 0.24 + gg[0], 0.62 + gg[1], -0.05 + gg[2]]);
    }
    pos.mb = mb;
    // central complex: midline ribbon (ellipsoid + bulb)
    var cc = [];
    for (var k = 0; k < 64; k++) {
      var t = k / 63;
      var gc = gauss(0.07, 0.07, 0.07);
      cc.push([gc[0], 0.18 + gc[1], -0.30 + t * 0.28 + gc[2]]);
    }
    pos.cc = cc;
    return pos;
  }

  /* --------------------- the fly body --------------------- */
  function buildFly(bodyMat, eyeMat, wingMat) {
    var g = new T.Group();
    // head shell (translucent so brain shows through)
    var head = new T.Mesh(new T.SphereGeometry(1.35, 28, 22), bodyMat);
    head.position.set(0, 0.12, 0.35);
    head.scale.set(1.05, 0.95, 0.9);
    g.add(head);
    // eyes
    var eL = new T.Mesh(new T.SphereGeometry(0.52, 18, 14), eyeMat);
    eL.position.set(-0.62, 0.18, 1.42); eL.scale.set(0.8, 1.15, 0.62); g.add(eL);
    var eR = eL.clone(); eR.position.x = 0.62; g.add(eR);
    // antennae
    var antMat = new T.MeshBasicMaterial({ color: 0x241a14 });
    [-1, 1].forEach(function (sd) {
      var pts = [];
      for (var i = 0; i <= 8; i++) {
        var t = i / 8;
        pts.push(new T.Vector3(sd * (0.28 + t * 0.34), 0.52 + t * 0.34 - t * t * 0.5, 1.5 + t * 0.5));
      }
      var line = new T.Line(new T.BufferGeometry().setFromPoints(pts),
        new T.LineBasicMaterial({ color: 0x3a2b20 }));
      g.add(line);
      var arista = new T.Mesh(new T.SphereGeometry(0.045, 6, 6), antMat);
      arista.position.copy(pts[8]); g.add(arista);
    });
    // thorax
    var thorax = new T.Mesh(new T.SphereGeometry(1.05, 24, 18), bodyMat);
    thorax.position.set(0, 0.05, -1.35); thorax.scale.set(0.95, 0.82, 1.0); g.add(thorax);
    // scutellum hump
    var scut = new T.Mesh(new T.SphereGeometry(0.55, 16, 12), bodyMat);
    scut.position.set(0, 0.62, -1.15); g.add(scut);
    // abdomen: tapered segments with striped hue shift
    var abd1 = new T.Mesh(new T.SphereGeometry(0.95, 22, 16), bodyMat.clone());
    abd1.position.set(0, -0.02, -2.6); abd1.scale.set(0.92, 0.8, 1.15); g.add(abd1);
    var abd2Mat = bodyMat.clone(); abd2Mat.color.setHex(0x8a5a22);
    var abd2 = new T.Mesh(new T.SphereGeometry(0.72, 20, 14), abd2Mat);
    abd2.position.set(0, -0.06, -3.62); abd2.scale.set(0.88, 0.72, 1.25); g.add(abd2);
    var tip = new T.Mesh(new T.SphereGeometry(0.42, 14, 10), bodyMat);
    tip.position.set(0, -0.08, -4.32); tip.scale.set(0.8, 0.62, 1.3); g.add(tip);
    // legs
    var legMat = new T.LineBasicMaterial({ color: 0x241912 });
    for (var side = -1; side <= 1; side += 2) {
      for (var lg = 0; lg < 3; lg++) {
        var z0 = -1.0 - lg * 0.42;
        var pts = [
          new T.Vector3(side * 0.6, -0.25, z0),
          new T.Vector3(side * (1.15 + lg * 0.1), 0.35 - lg * 0.28, z0 + 0.28),
          new T.Vector3(side * (1.5 + lg * 0.18), -0.75 - lg * 0.12, z0 + 0.55),
          new T.Vector3(side * (1.32 + lg * 0.16), -1.42, z0 + 0.95)
        ];
        g.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), legMat));
      }
    }
    // wings
    var wg = new T.Group();
    var wingGeo = new T.CircleGeometry(1.0, 20, 0, Math.PI);
    [-1, 1].forEach(function (sd) {
      var wm = wingMat.clone();
      var wing = new T.Mesh(wingGeo, wm);
      wing.scale.set(0.62, 1.9, 1);
      wing.rotation.z = sd > 0 ? 0.35 : Math.PI - 0.35;
      wing.position.set(sd * 0.35, 0.75, -1.6);
      wm.opacity = 0.0; wm.side = T.DoubleSide;
      wing.userData.side = sd;
      wg.add(wing);
    });
    g.add(wg);
    g.userData.wings = wg;
    return g;
  }

  /* ---------------------- main viz class ---------------------- */
  function BrainViz(container) {
    SIZE = global.FG.FlyBrain.SIZE;
    this.container = container;
    this.scene = new T.Scene();
    this.scene.fog = new T.FogExp2(0x080503, 0.02);
    this.camera = new T.PerspectiveCamera(52, 1, 0.1, 100);
    this.camDist = 6.9;
    this.theta = 0.62; this.phi = 1.30;
    this.autoSpin = 0.045;
    this.lastInteract = 0;

    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x080503, 1);
    container.appendChild(this.renderer.domElement);

    this.scene.add(new T.AmbientLight(0x223344, 0.9));
    var l1 = new T.PointLight(0xffe8b8, 1.05, 60); l1.position.set(8, 6, 10); this.scene.add(l1);
    var l2 = new T.PointLight(0x44ff99, 0.55, 60); l2.position.set(-9, -4, -6); this.scene.add(l2);
    var l3 = new T.PointLight(0x9944ff, 0.30, 60); l3.position.set(0, -10, 4); this.scene.add(l3);

    this.brainGroup = new T.Group(); // parented to the fly head below

    var shellMat = new T.MeshPhongMaterial({
      color: 0x3a2a16, transparent: true, opacity: 0.34,
      shininess: 60, specular: 0x665533, depthWrite: false, side: T.DoubleSide
    });
    var eyeMat = new T.MeshPhongMaterial({
      color: 0x6b1f18, emissive: 0x330b08, transparent: true, opacity: 0.92, shininess: 90
    });
    var wingMat = new T.MeshBasicMaterial({
      color: 0xffd8a0, transparent: true, opacity: 0.12, blending: T.AdditiveBlending, depthWrite: false
    });
    this.fly = buildFly(shellMat, eyeMat, wingMat);
    this.fly.position.set(0, 0, 0);
    this.fly.rotation.y = 0.6; // 3/4 view facing camera
    this.scene.add(this.fly);
    this.fly.add(this.brainGroup); // the brain lives INSIDE the head
    this.brainGroup.position.set(0, 0.12, 0.35);

    this.layout = layoutNeurons();
    this.buildNeurons();
    this.buildSynapses();
    this.buildStarfield();
    this.bindControls();
    this.resize();

    this.pulse = null;
    this.targets = {
      optic: new Float32Array(SIZE.optic), lobula: new Float32Array(SIZE.lobula),
      mb: new Float32Array(SIZE.mb), cc: new Float32Array(SIZE.cc)
    };
    this.current = {
      optic: new Float32Array(SIZE.optic), lobula: new Float32Array(SIZE.lobula),
      mb: new Float32Array(SIZE.mb), cc: new Float32Array(SIZE.cc)
    };
    this.edgeSrc = null; // per-edge pre index+layer for coloring
  }

  var POINT_VS = [
    'attribute float aSize;', 'attribute vec3 aColor;', 'attribute float aAct;',
    'varying vec3 vColor;', 'varying float vAct;',
    'void main() {',
    '  vColor = aColor; vAct = aAct;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aSize * (1.0 + 3.2 * aAct) * (240.0 / -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var POINT_FS = [
    'varying vec3 vColor;', 'varying float vAct;',
    'void main() {',
    '  vec2 uv = gl_PointCoord - 0.5;',
    '  float d = length(uv);',
    '  float a = smoothstep(0.5, 0.05, d);',
    '  float glow = exp(-d * d * 9.0);',
    '  vec3 col = vColor * (0.62 + 2.6 * vAct) + vec3(1.0, 0.93, 0.72) * glow * vAct * 1.6;',
    '  gl_FragColor = vec4(col, a * (0.5 + 1.3 * vAct));',
    '}'
  ].join('\n');

  BrainViz.prototype.makePoints = function (positions, colors, sizes) {
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new T.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new T.Float32BufferAttribute(sizes, 1));
    var act = new Float32Array(positions.length / 3);
    geo.setAttribute('aAct', new T.BufferAttribute(act, 1));
    var mat = new T.ShaderMaterial({
      vertexShader: POINT_VS, fragmentShader: POINT_FS,
      transparent: true, blending: T.AdditiveBlending, depthWrite: false
    });
    var pts = new T.Points(geo, mat);
    pts.userData.act = act;
    return pts;
  };

  BrainViz.prototype.buildNeurons = function () {
    var PIECE_HUES = [
      [0.85, 0.95, 1.0],   // white pawn  - ice
      [0.45, 1.0, 0.55],   // knight - green
      [0.35, 0.65, 1.0],   // bishop - blue
      [1.0, 0.85, 0.30],   // rook - gold
      [1.0, 0.40, 0.95],   // queen - magenta
      [1.0, 0.35, 0.25]    // king - red
    ];
    // optic points
    var op = this.layout.optic, oc = [], oz = [], os = [];
    for (var i = 0; i < op.length; i++) {
      var plane = (i / 64) | 0, hue = PIECE_HUES[plane % 6];
      var dim = plane < 6 ? 1.0 : 0.55;
      oc.push(hue[0] * dim, hue[1] * dim, hue[2] * dim);
      oz.push(op[i][0], op[i][1], op[i][2]);
      os.push(0.045);
    }
    this.opticPts = this.makePoints(oz, oc, os);
    // lobula: cyan family
    var lp = this.layout.lobula, lc = [], lz = [], ls = [];
    for (var j = 0; j < lp.length; j++) {
      var v = 0.55 + Math.random() * 0.45;
      lc.push(0.35 * v, 1.0 * v, 0.45 * v);
      lz.push(lp[j][0], lp[j][1], lp[j][2]);
      ls.push(0.10);
    }
    this.lobulaPts = this.makePoints(lz, lc, ls);
    // MB: violet
    var mp = this.layout.mb, mc = [], mz = [], ms = [];
    for (var m = 0; m < mp.length; m++) {
      mc.push(1.0, 0.30, 0.22);
      mz.push(mp[m][0], mp[m][1], mp[m][2]);
      ms.push(0.11);
    }
    this.mbPts = this.makePoints(mz, mc, ms);
    // CC: warm white/gold
    var cp = this.layout.cc, cc = [], cz = [], cs = [];
    for (var k = 0; k < cp.length; k++) {
      cc.push(1.0, 0.75, 0.35);
      cz.push(cp[k][0], cp[k][1], cp[k][2]);
      cs.push(0.15);
    }
    this.ccPts = this.makePoints(cz, cc, cs);
    this.brainGroup.add(this.opticPts, this.lobulaPts, this.mbPts, this.ccPts);
  };

  /* synapse curve between two neurons, bulged radially out of the head.
   * Writes SEG line segments (SEG*2 vertices, SEG*6 floats) into out. */
  function axonCurve(a, b, seg, out) {
    var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    var mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    var len = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
    var bulge = 0.20 + 0.10 * Math.random();
    var cx = mx + (mx / len) * bulge, cy = my + (my / len) * bulge * 0.6, cz = mz + (mz / len) * bulge;
    var idx = 0;
    var pxx = ax, pyy = ay, pzz = az;
    for (var i = 1; i <= seg; i++) {
      var t = i / seg, u = 1 - t;
      var x = u * u * ax + 2 * u * t * cx + t * t * bx;
      var y = u * u * ay + 2 * u * t * cy + t * t * by;
      var z = u * u * az + 2 * u * t * cz + t * t * bz;
      out[idx++] = pxx; out[idx++] = pyy; out[idx++] = pzz;
      out[idx++] = x; out[idx++] = y; out[idx++] = z;
      pxx = x; pyy = y; pzz = z;
    }
  }

  BrainViz.prototype.buildSynapses = function () {
    var self = this;
    var brain = global.FG._demoBrain;
    var SEG = this.SEG = 3; // bezier segments (line segments) per axon
    var L1n = SIZE.lobula, L2n = SIZE.mb;
    var e1 = L1n * SIZE.K1, e2 = L2n * SIZE.K2;
    // dense CC layer has ~17k weights; draw only the strongest TOPK per neuron
    var ccEdges = [];
    var w = brain.CC.W, nIn = SIZE.mb + SIZE.ACT_DIM, nOut = brain.CC.n;
    var TOPK = 6;
    for (var pn = 0; pn < nOut; pn++) {
      var cols = [];
      for (var q = 0; q < nIn; q++) cols.push(q);
      cols.sort(function (a, b) {
        return Math.abs(w[b * nOut + pn]) - Math.abs(w[a * nOut + pn]);
      });
      for (var t = 0; t < TOPK; t++) ccEdges.push([cols[t], pn]);
    }
    var e3 = ccEdges.length;
    var totalE = e1 + e2 + e3;
    var vPerE = SEG * 2;
    var positions = new Float32Array(totalE * vPerE * 3);
    var colors = new Float32Array(totalE * vPerE * 3);
    this.edgeMeta = new Array(totalE * vPerE);
    var layout = this.layout;
    var tmp = new Float32Array(vPerE * 3);
    var edgeNo = 0;
    function writeEdge(pre, a, b, wgt) {
      axonCurve(a, b, SEG, tmp);
      var base = edgeNo * vPerE * 3;
      for (var q = 0; q < vPerE * 3; q++) positions[base + q] = tmp[q];
      var mbase = edgeNo * vPerE;
      for (var s2 = 0; s2 < vPerE; s2++) self.edgeMeta[mbase + s2] = { pre: pre, w: wgt };
      edgeNo++;
    }
    // L1 edges: optic -> lobula
    for (var i = 0; i < L1n; i++) {
      for (var j = 0; j < SIZE.K1; j++) {
        var ix = brain.L1.idx[i * SIZE.K1 + j];
        var wgt = Math.abs(brain.L1.W[i * SIZE.K1 + j]);
        writeEdge({ l: 0, n: ix }, layout.optic[ix], layout.lobula[i], Math.min(1.5, wgt * 2.4));
      }
    }
    // L2 edges: lobula -> mb
    for (var i2 = 0; i2 < L2n; i2++) {
      for (var j2 = 0; j2 < SIZE.K2; j2++) {
        var ix2 = brain.L2.idx[i2 * SIZE.K2 + j2];
        var wgt2 = Math.abs(brain.L2.W[i2 * SIZE.K2 + j2]);
        writeEdge({ l: 1, n: ix2 }, layout.lobula[ix2], layout.mb[i2], Math.min(1.5, wgt2 * 2.4));
      }
    }
    // CC strongest projections: mb-side or action-side (mapped onto optic shells)
    for (var i3 = 0; i3 < e3; i3++) {
      var fr = ccEdges[i3][0], to = ccEdges[i3][1];
      var wgt3 = Math.abs(w[fr * nOut + to]);
      var fromMb = fr < SIZE.mb;
      var pre = fromMb ? { l: 2, n: fr } : { l: 0, n: ((fr - SIZE.mb) * 59) % 768 };
      var aP = fromMb ? layout.mb[fr] : layout.optic[pre.n];
      writeEdge(pre, aP, layout.cc[to], Math.min(1.5, wgt3 * 14));
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(positions, 3));
    geo.setAttribute('color', new T.BufferAttribute(colors, 3));
    var mat = new T.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.8,
      blending: T.AdditiveBlending, depthWrite: false
    });
    this.synapses = new T.LineSegments(geo, mat);
    this.synColors = colors;
    this.brainGroup.add(this.synapses);
  };

  BrainViz.prototype.buildStarfield = function () {
    var n = 700, pos = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var r = 30 + Math.random() * 40;
      var th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.6;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    var m = new T.PointsMaterial({ color: 0x6a5233, size: 0.07, transparent: true, opacity: 0.7 });
    this.stars = new T.Points(g, m);
    this.scene.add(this.stars);
  };

  BrainViz.prototype.bindControls = function () {
    var self = this, el = this.renderer.domElement;
    var down = false, px = 0, py = 0;
    el.addEventListener('pointerdown', function (e) {
      down = true; px = e.clientX; py = e.clientY; self.lastInteract = performance.now();
    });
    window.addEventListener('pointerup', function () { down = false; });
    window.addEventListener('pointermove', function (e) {
      if (!down) return;
      self.theta -= (e.clientX - px) * 0.005;
      self.phi -= (e.clientY - py) * 0.004;
      self.phi = Math.max(0.35, Math.min(2.6, self.phi));
      px = e.clientX; py = e.clientY;
      self.lastInteract = performance.now();
    });
    el.addEventListener('wheel', function (e) {
      self.camDist = Math.max(4, Math.min(16, self.camDist + e.deltaY * 0.01));
      self.lastInteract = performance.now();
      e.preventDefault();
    }, { passive: false });
  };

  /* called once per visualized move: ignite the brain */
  BrainViz.prototype.pulseMove = function (viz, moveColor) {
    if (!viz) return;
    var tg = this.targets;
    // normalize activations
    var optic = viz.optic, h1 = viz.h1, h2 = viz.h2, ccH = viz.ccH;
    for (var i = 0; i < tg.optic.length; i++) tg.optic[i] = optic[i] ? 1 : 0;
    normalizeInto(h1, tg.lobula, 0.9);
    normalizeInto(h2, tg.mb, 0.9);
    if (ccH) {
      for (var c = 0; c < tg.cc.length; c++) tg.cc[c] = Math.min(1.4, ccH[c] * 0.5);
    }
    this.flashT = 1;
  };

  function normalizeInto(src, dst, gain) {
    var max = 1e-6;
    for (var i = 0; i < src.length; i++) if (src[i] > max) max = src[i];
    for (var j = 0; j < dst.length; j++) dst[j] = Math.min(1.4, (src[j] / max) * gain);
  }

  BrainViz.prototype.decay = function (dt, speed) {
    var k = Math.exp(-dt * speed);
    var names = ['optic', 'lobula', 'mb', 'cc'];
    var flux = 0;
    for (var n = 0; n < 4; n++) {
      var cur = this.current[names[n]], tgt = this.targets[names[n]];
      for (var i = 0; i < cur.length; i++) {
        var nv = cur[i] * k + (1 - k) * tgt[i];
        flux += Math.abs(nv - cur[i]);
        cur[i] = nv;
        tgt[i] = tgt[i] * k; // targets themselves fade, re-ignited per pulse
      }
    }
    this._flux = flux;
  };

  var LAYER_KEYS = ['optic', 'lobula', 'mb', 'cc'];
  BrainViz.prototype.applyActivations = function (t) {
    t = t || 0;
    var pts = [this.opticPts, this.lobulaPts, this.mbPts, this.ccPts];
    for (var p = 0; p < pts.length; p++) {
      var act = pts[p].userData.act, cur = this.current[LAYER_KEYS[p]];
      for (var i = 0; i < act.length; i++) {
        // resting shimmer so the brain is never fully dark
        var idle = 0.05 + 0.045 * Math.sin(t * 1.7 + i * 1.618 + p * 2.1);
        act[i] = Math.max(cur[i], idle);
      }
      pts[p].geometry.attributes.aAct.needsUpdate = true;
    }
    // synapse colors: skip the 82k-vertex recolor when nothing is firing
    var colors = this.synColors, meta = this.edgeMeta, vPerE = this.SEG * 2;
    if (this._flux < 0.02 && this.flashT <= 0) {
      // only the faint idle shimmer remains; static synapse colors are fine
      return;
    }
    var nVerts = colors.length / 3;
    for (var v = 0; v < nVerts; v++) {
      var m = meta[v];
      var a = m.pre.l === 3 ? 0 : this.current[LAYER_KEYS[m.pre.l]][m.pre.n] * m.w;
      var fade = 1 - 0.65 * ((v % vPerE) / (vPerE - 1));
      var base = v * 3, I = a * fade;
      colors[base] = I * 0.22;
      colors[base + 1] = I * 1.0;
      colors[base + 2] = I * 0.45;
    }
    this.synapses.geometry.attributes.color.needsUpdate = true;
  };

  BrainViz.prototype.resize = function () {
    var w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  BrainViz.prototype.render = function (dt, t) {
    this.decay(dt, 3.2);
    this.applyActivations(t);
    // camera
    if (t - this.lastInteract > 2600) this.theta += this.autoSpin * dt;
    var sp = Math.sin(this.phi);
    this.camera.position.set(
      this.camDist * sp * Math.sin(this.theta),
      this.camDist * Math.cos(this.phi) + 0.5,
      this.camDist * sp * Math.cos(this.theta)
    );
    this.camera.lookAt(0, 0.35, 0.2);
    // fly idle motion: bobbing + wing flutter + gentle yaw around base pose
    var fly = this.fly;
    fly.position.y = Math.sin(t * 1.4) * 0.09;
    fly.rotation.z = Math.sin(t * 0.9) * 0.04;
    fly.rotation.y = 0.6 + Math.sin(t * 0.3) * 0.16;
    var wg = fly.userData.wings;
    wg.children.forEach(function (wing) {
      var sd = wing.userData.side;
      var flap = Math.sin(t * 62 + (sd > 0 ? 0.6 : 0)) * 0.5 + 0.5;
      wing.rotation.x = -0.6 + flap * (sd > 0 ? 1.1 : -1.1);
    });
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt * 1.4);
    }
    this.renderer.render(this.scene, this.camera);
  };

  global.FG = global.FG || {};
  global.FG.BrainViz = BrainViz;
})(window);
