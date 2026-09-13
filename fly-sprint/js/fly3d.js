/*
 * FlySprint - fly3d.js (requires THREE)
 * The stadium: dark rubber track with fluorescent lane lines, glowing
 * hurdles, and runner flies whose six legs animate with the live CPG
 * phase from the simulation. Camera director: start wide -> side-pan
 * follow -> finish-line snap.
 *
 * Same fluorescence-microscope identity as FlyGambit, but these flies are
 * athletes, not specimens: lean forward, legs churning, wings a blur.
 */
(function (global) {
  'use strict';
  var T = global.THREE;
  var LANE_W = 1.35;
  var UNIT_CYL = null, UP = null, _dir = null, _mid = null, _qa = null, _qb = null;
  function initShared() {
    UNIT_CYL = new T.CylinderGeometry(1, 1, 1, 6);
    UP = new T.Vector3(0, 1, 0);
    _dir = new T.Vector3(); _mid = new T.Vector3();
    _qa = new T.Vector3(); _qb = new T.Vector3();
  }
  /* place a unit-height cylinder spanning a->b with radius r */
  function seg(mesh, ax, ay, az, bx, by, bz, r) {
    _dir.set(bx - ax, by - ay, bz - az);
    var len = _dir.length() || 1e-4;
    mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    mesh.scale.set(r, len, r);
    _dir.divideScalar(len);
    mesh.quaternion.setFromUnitVectors(UP, _dir);
  }

  function Track3D(container, cfg, laneCount, colors, names) {
    initShared();
    this.colors = colors;
    this.container = container;
    this.cfg = cfg;
    this.laneCount = laneCount;
    this.scene = new T.Scene();
    this.scene.fog = new T.FogExp2(0x060403, 0.016);
    this.camera = new T.PerspectiveCamera(42, 1, 0.1, 300);
    this.camPos = new T.Vector3(0, 0, 0);
    this.camLook = new T.Vector3(0, 0, 0);
    this.renderer = new T.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x060403, 1);
    container.appendChild(this.renderer.domElement);

    this.scene.add(new T.AmbientLight(0x33261a, 1.1));
    var sun = new T.DirectionalLight(0xffe2b0, 1.0); sun.position.set(6, 14, 8); this.scene.add(sun);
    var fill = new T.PointLight(0x88bbff, 0.5, 90); fill.position.set(-10, 8, -20); this.scene.add(fill);

    this.buildTrack();
    this.buildHurdles();
    this.flies = [];
    this.discGeo = new T.CircleGeometry(0.62, 18);
    for (var i = 0; i < laneCount; i++) {
      var f = this.makeFly(colors[i], i);
      this.scene.add(f.group);
      var disc = new T.Mesh(this.discGeo, new T.MeshBasicMaterial({
        color: new T.Color(colors[i]), transparent: true, opacity: 0.3,
        blending: T.AdditiveBlending, depthWrite: false
      }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(0, 0.02, this.laneZ(i));
      this.scene.add(disc);
      f.disc = disc;
      this.flies.push(f);
    }
    this.camMode = 'start';
    this.resize();
  }

  Track3D.prototype.laneZ = function (i) {
    return (i - (this.laneCount - 1) / 2) * LANE_W;
  };

  Track3D.prototype.buildTrack = function () {
    var len = this.cfg.len, W = this.laneCount * LANE_W + 2;
    var mat = new T.MeshPhongMaterial({ color: 0x1c100a, shininess: 12 });
    var road = new T.Mesh(new T.PlaneGeometry(len + 30, W), mat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(len / 2 - 4, 0, 0);
    this.scene.add(road);
    // infield glow edges
    var edgeMat = new T.MeshBasicMaterial({ color: 0xffcf5f, transparent: true, opacity: 0.5 });
    [-1, 1].forEach(function (s) {
      var e = new T.Mesh(new T.BoxGeometry(len + 20, 0.03, 0.06), edgeMat);
      e.position.set(len / 2 - 4, 0.015, s * (W / 2 - 0.5));
      this.scene.add(e);
    }, this);
    // lane divider lines, faint
    var lv = [], lc = [];
    for (var i = 0; i <= this.laneCount; i++) {
      var z = this.laneZ(i - 0.5);
      lv.push(-12, 0.02, z, len + 10, 0.02, z);
    }
    var lg = new T.BufferGeometry();
    lg.setAttribute('position', new T.Float32BufferAttribute(lv, 3));
    for (var k = 0; k < lv.length / 3; k++) lc.push(0.35, 0.5, 0.4);
    lg.setAttribute('color', new T.Float32BufferAttribute(lc, 3));
    this.scene.add(new T.LineSegments(lg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 })));
    // lane tints: each runner's lane softly glows in their colour
    for (var li = 0; li < this.laneCount; li++) {
      var pad = new T.Mesh(new T.PlaneGeometry(len + 20, LANE_W * 0.88),
        new T.MeshBasicMaterial({
          color: new T.Color(this.colors[li]), transparent: true, opacity: 0.05,
          blending: T.AdditiveBlending, depthWrite: false
        }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(len / 2 - 4, 0.011, this.laneZ(li));
      this.scene.add(pad);
    }
    // distance ticks every 10m
    for (var m = 0; m <= len; m += 10) {
      var tick = new T.Mesh(new T.BoxGeometry(0.1, 0.02, W),
        new T.MeshBasicMaterial({ color: 0x3a2a16 }));
      tick.position.set(m, 0.02, 0);
      this.scene.add(tick);
    }
    // finish band
    var fin = new T.Mesh(new T.PlaneGeometry(0.5, W),
      new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    fin.rotation.x = -Math.PI / 2;
    fin.position.set(len, 0.03, 0);
    this.scene.add(fin);
    this.finishMesh = fin;
    // start blocks
    for (var s = 0; s < this.laneCount; s++) {
      var block = new T.Mesh(new T.BoxGeometry(0.5, 0.16, LANE_W * 0.7),
        new T.MeshPhongMaterial({ color: 0x2a1a10 }));
      block.position.set(-0.6, 0.08, this.laneZ(s));
      this.scene.add(block);
    }
  };

  Track3D.prototype.buildHurdles = function () {
    this.hurdles = [];
    if (!this.cfg.hN) return;
    for (var i = 0; i < this.cfg.hN; i++) {
      var x = this.cfg.hFirst + i * this.cfg.hEvery;
      for (var l = 0; l < this.laneCount; l++) {
        var bar = new T.Mesh(new T.BoxGeometry(0.07, 0.07, LANE_W * 0.85),
          new T.MeshBasicMaterial({ color: 0xffdf9e, transparent: true, opacity: 0.9 }));
        bar.position.set(x, this.cfg.hH, this.laneZ(l));
        this.scene.add(bar);
        var rope = new T.Mesh(new T.BoxGeometry(0.03, this.cfg.hH, 0.03),
          new T.MeshBasicMaterial({ color: 0x664422 }));
        rope.position.set(x, this.cfg.hH / 2, this.laneZ(l) - LANE_W * 0.4);
        this.scene.add(rope);
      }
    }
  };

  Track3D.prototype.makeFly = function (hex, laneIdx) {
    var col = new T.Color(hex);
    var body = new T.MeshPhongMaterial({
      color: 0x6b4c2e, emissive: col.clone().multiplyScalar(0.55),
      shininess: 70, specular: 0x554433
    });
    var g = new T.Group();
    // runner pose: forward-leaning
    var thorax = new T.Mesh(new T.SphereGeometry(0.42, 16, 12), body);
    thorax.position.set(0.1, 0.52, 0); thorax.scale.set(1.1, 0.9, 0.9);
    var head = new T.Mesh(new T.SphereGeometry(0.24, 14, 10), body);
    head.position.set(0.55, 0.48, 0);
    var belly = new T.Mesh(new T.SphereGeometry(0.4, 16, 12), body.clone());
    belly.material.emissive = col.clone().multiplyScalar(0.40); belly.material.color.setHex(0x7a5634);
    belly.position.set(-0.42, 0.5, 0); belly.scale.set(1.4, 0.85, 0.85);
    g.add(thorax, head, belly);
    // glowing eyes in lane color
    var eyeMat = new T.MeshBasicMaterial({ color: col });
    [-1, 1].forEach(function (s) {
      var eye = new T.Mesh(new T.SphereGeometry(0.075, 8, 6), eyeMat);
      eye.position.set(0.72, 0.52, s * 0.13);
      g.add(eye);
    });
    // wings (motion-blurred)
    var wingMat = new T.MeshBasicMaterial({ color: 0xffe8c0, transparent: true, opacity: 0.14, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false });
    var wings = [];
    [-1, 1].forEach(function (s) {
      var w = new T.Mesh(new T.CircleGeometry(0.5, 14, 0, Math.PI), wingMat);
      w.scale.set(0.55, 1.15, 1);
      w.position.set(-0.15, 0.82, s * 0.16);
      w.rotation.x = Math.PI / 2 - s * 0.5;
      wings.push(w); g.add(w);
    });
    // legs: 6 jointed insect legs (thigh + shin cylinders), arched knees,
    // planted on the ground; animated from the CPG phase each frame.
    var legMat = new T.MeshPhongMaterial({
      color: col.clone().multiplyScalar(0.85), emissive: col.clone().multiplyScalar(0.45),
      shininess: 30
    });
    var legs = [];
    var hipX = [0.3, 0.05, -0.2], side = [1, 1, 1, -1, -1, -1];
    for (var i = 0; i < 6; i++) {
      var thigh = new T.Mesh(UNIT_CYL, legMat);
      var shin = new T.Mesh(UNIT_CYL, legMat);
      g.add(thigh); g.add(shin);
      legs.push({
        a: thigh, b: shin,
        hx: hipX[i % 3], s: side[i],
        ph: ((i % 3 === 1) ? Math.PI : 0) + (side[i] < 0 ? Math.PI : 0)
      });
    }
    // tiny feet so stance phase reads clearly
    var feet = [];
    for (var fi = 0; fi < 6; fi++) {
      var foot = new T.Mesh(new T.SphereGeometry(0.05, 6, 5), legMat);
      g.add(foot); feet.push(foot);
    }
    // lane-number halo dot above
    var halo = new T.Mesh(new T.SphereGeometry(0.05, 6, 6), new T.MeshBasicMaterial({ color: col }));
    halo.position.set(0, 1.25, 0); g.add(halo);

    g.scale.set(1.35, 1.35, 1.35);
    return { group: g, legs: legs, feet: feet, wings: wings, halo: halo, body: body, belly: belly, lane: laneIdx, flash: 0, disc: null };
  };

  /* state: {x,y,v,theta,E,o0,air,stumbles,done,time} per lane */
  Track3D.prototype.render = function (states, tSec, dt) {
    for (var i = 0; i < this.flies.length; i++) {
      var f = this.flies[i], s = states[i];
      if (!s) continue;
      var g = f.group;
      g.position.x = s.x;
      g.position.z = this.laneZ(i);
      var strideBob = s.done && s.time > 0 ? 0 : Math.abs(Math.sin(s.theta)) * 0.05;
      g.position.y = s.y + strideBob;
      g.rotation.z = -0.16 - s.o0 * 0.10 + (s.air ? 0.35 : 0);
      for (var l = 0; l < 6; l++) {
        var leg = f.legs[l];
        var ph = s.theta + leg.ph;
        var swing = Math.cos(ph), lift = Math.max(0, Math.sin(ph));
        var hipXp = leg.hx, hipY = 0.46, hipZ = leg.s * 0.22;
        var footX = leg.hx + swing * 0.38;
        var footY = lift * 0.30;
        var footZ = leg.s * 0.32;
        var kneeX = (hipXp + footX) / 2 + 0.06;
        var kneeY = 0.60 + lift * 0.14;
        var kneeZ = leg.s * 0.30;
        seg(leg.a, hipXp, hipY, hipZ, kneeX, kneeY, kneeZ, 0.034);
        seg(leg.b, kneeX, kneeY, kneeZ, footX, footY, footZ, 0.026);
        var ft = f.feet[l];
        ft.position.set(footX, footY, footZ);
        ft.scale.setScalar(1 + (lift === 0 ? 0.6 : 0)); // planted feet flatten slightly
      }
      // shadow disc: shrinks with airborne height, pulses with the stance beat
      if (f.disc) {
        f.disc.position.x = s.x;
        var alt = 1 / (1 + s.y * 1.3);
        f.disc.material.opacity = 0.30 * alt;
        var p = 1 + Math.max(0, Math.cos(s.theta)) * 0.16;
        f.disc.scale.set(alt * p, alt * p, 1);
      }
      var flap = Math.sin(tSec * 68 + i) * 0.5 + 0.5;
      f.wings[0].rotation.y = -0.9 - flap * 0.6;
      f.wings[1].rotation.y = 0.9 + flap * 0.6;
      f.halo.material.opacity = 0.9;
      if (s.stumbles > (f._st || 0)) { f.flash = 1; f._st = s.stumbles; }
      if (f.flash > 0) {
        f.flash = Math.max(0, f.flash - dt * 2.2);
        f.body.emissive.setRGB(
          0.55 + f.flash * 1.6, 0.34 * (1 - f.flash) + 0.2, 0.18);
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  Track3D.prototype.setCam = function (mode, leaderX, finishX) {
    this.camMode = mode; this.leaderX = leaderX; this.finishX = finishX;
  };

  Track3D.prototype.updateCamera = function (dt) {
    var target = { pos: [0, 0, 0], look: [0, 0, 0] };
    var lx = this.leaderX || 0;
    if (this.camMode === 'start') {
      target.pos = [-6.0, 3.2, 9.2]; target.look = [4.5, 0.7, 0];
    } else if (this.camMode === 'follow') {
      // frame the whole squad: centre between slowest and fastest, pull back
      // as they spread out (early generations run at wildly different speeds)
      var xs = this.flies.map(function (fl) { return fl.group.position.x; });
      var mn = Math.min.apply(null, xs), mxs = Math.max.apply(null, xs);
      var spread = Math.min(30, mxs - mn);
      var cen = (mn + mxs) / 2;
      target.pos = [cen + 1.4 + spread * 0.10, 1.9 + spread * 0.10, 6.9 + spread * 0.78];
      target.look = [cen, 0.6, 0];
    } else if (this.camMode === 'finish') {
      var fx = this.finishX || this.cfg.len;
      target.pos = [fx + 4.6, 1.6, 6.6]; target.look = [fx, 0.7, 0];
    }
    var k = 1 - Math.exp(-dt * 3.2);
    this.camera.position.lerp(new T.Vector3(target.pos[0], target.pos[1], target.pos[2]), k);
    this.camLook.lerp(new T.Vector3(target.look[0], target.look[1], target.look[2]), k);
    this.camera.position.y = Math.max(0.9, this.camera.position.y);
    this.camera.lookAt(this.camLook);
  };

  Track3D.prototype.resize = function () {
    var w = this.container ? this.container.clientWidth : window.innerWidth;
    var h = this.container ? this.container.clientHeight : window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
  Track3D.prototype.setContainer = function (el) { this.container = el; };

  global.FG = global.FG || {};
  global.FG.Track3D = Track3D;
  global.FG.LANE_COLORS = ['#6bffb0', '#ff5540', '#ffcf5f', '#b98aff', '#5fe8ff'];
  global.FG.LANE_NAMES = ['GFP', 'scarlet', 'yellow', 'brown', 'turquoise'];
})(window);
