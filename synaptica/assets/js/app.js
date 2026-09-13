/* =========================================================================
 * SYNAPTICA — app logic
 * Signal propagation, Hebbian "learning", interaction, render loop, UI.
 * ========================================================================= */
(function () {
  "use strict";
  const S = window.SYNAPTICA;
  const E = S.Engine;

  let canvas, ctx, W = 0, H = 0, DPR = 1;
  let brain, cam;
  let pulses = [];
  let mode = "free";
  let stars = [];
  let labelHits = [];
  let hovered = null;
  let ambientTimer = 0;
  let lastTs = 0;
  const state = { liveSyn: 0, frameSyn: 0, trainCount: 0 };

  // render helpers / caches
  let rings = [];                       // expanding arrival ripples
  const nodeProj = [];                  // per-node projected data (indexed by node.i)
  const visNodes = [];                  // visible nodes, depth-sorted each frame
  const glowCache = {};                 // cached radial-glow sprites per colour

  // drag state
  let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, downT = 0, moved = false, btn = 0;

  const $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------------- init
  function init() {
    canvas = $("stage");
    ctx = canvas.getContext("2d");
    brain = E.build(S, 20260913);
    cam = { yaw: 0.6, pitch: -0.15, camZ: 3.0, f: 700, cx: 0, cy: 0 };

    buildLegend();
    buildStars();
    wireUI();
    resize();

    window.addEventListener("resize", resize);
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // welcome cascade so the brain is alive on load
    setTimeout(function () {
      fireRegion("eye_L", 1.0); fireRegion("eye_R", 1.0);
      fireRegion("antennal_L", 0.9); fireRegion("antennal_R", 0.9);
      fireRegion("mb", 0.7);
    }, 350);

    lastTs = performance.now();
    requestAnimationFrame(loop);
  }

  function buildStars() {
    const rng = E.mulberry32(99);
    stars = [];
    for (let i = 0; i < 160; i++) {
      stars.push({ x: rng(), y: rng(), r: rng() * 1.3 + 0.2, a: rng() * 0.5 + 0.1, p: rng() * 6.28 });
    }
  }

  function buildLegend() {
    const el = $("legend");
    el.innerHTML = "";
    S.LEGEND.forEach(function (l) {
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = '<span class="dot" style="background:' + l.color + ';box-shadow:0 0 8px ' + l.color + '"></span>' + l.label;
      el.appendChild(row);
    });
    // facts
    $("fact-neurons").textContent = S.FACTS.neurons.toLocaleString();
    $("fact-synapses").textContent = S.FACTS.synapses.toLocaleString();
    $("fact-source").textContent = S.FACTS.source;
    $("stat-mode").textContent = "Free Fire";
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cam.cx = W / 2;
    cam.cy = H / 2;
    cam.f = Math.min(W, H) * 0.92;
  }

  // ---------------------------------------------------------- signal logic
  function fireRegion(id, strength) {
    const r = brain.regions[id];
    if (!r) return;
    r.act = Math.min(1.4, r.act + strength);
    for (let k = 0; k < r.outEdges.length; k++) {
      spawnPulse(brain.edges[r.outEdges[k]], strength, 0);
    }
    toast("▶ " + r.short + " fired");
  }

  function spawnPulse(edge, strength, hop) {
    if (pulses.length > 520) return;
    const speed = 1.25 + edge.plasticity * 1.5; // learned pathways fire faster
    pulses.push({ edge: edge, t: 0, strength: strength, hop: hop, speed: speed, prev: null });
  }

  function updatePulses(dt) {
    let inst = 0;
    const keep = [];
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i];
      p.t += p.speed * dt;
      const e = p.edge;
      inst += e.synapses * p.strength * (0.5 + e.plasticity);
      if (p.t >= 1) {
        // arrival
        const target = e.toR;
        target.act = Math.min(1.4, target.act + 0.55 * p.strength * (0.6 + e.plasticity));
        if (e.trainable) e.plasticity = Math.min(1, e.plasticity + 0.03 * p.strength);
        rings.push({ r: target, t: 0, rgb: e.toR.rgb }); // expanding ripple
        // propagate onward
        if (p.strength * 0.8 > 0.05 && p.hop < 8) {
          for (let k = 0; k < target.outEdges.length; k++) {
            spawnPulse(brain.edges[target.outEdges[k]], p.strength * 0.8, p.hop + 1);
          }
        }
        continue; // drop this pulse
      }
      keep.push(p);
    }
    pulses = keep;
    state.frameSyn = inst;
    // age arrival ripples
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt * 1.6;
      if (rings[i].t >= 1) rings.splice(i, 1);
    }
  }

  function decay(dt) {
    const f = Math.pow(0.55, dt); // activation decay
    for (let i = 0; i < brain.regionList.length; i++) {
      const r = brain.regionList[i];
      r.act *= f;
      if (r.act < 0.001) r.act = 0;
    }
  }

  // ------------------------------------------------------------- render
  function render() {
    // ---- background: deep-space gradient + nebula + vignette ----
    ctx.globalCompositeOperation = "source-over";
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#070912");
    g.addColorStop(0.55, "#05060f");
    g.addColorStop(1, "#02030a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const tnow = performance.now() * 0.001;

    // soft central nebula glow behind the brain
    const neb = ctx.createRadialGradient(W / 2, H * 0.46, 8, W / 2, H * 0.46, Math.max(W, H) * 0.62);
    const nh = 0.05 + 0.02 * Math.sin(tnow * 0.25);
    neb.addColorStop(0, "rgba(70,100,180," + nh.toFixed(3) + ")");
    neb.addColorStop(0.5, "rgba(40,60,130," + (nh * 0.4).toFixed(3) + ")");
    neb.addColorStop(1, "rgba(40,60,130,0)");
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W, H);

    // ---- stars (twinkling) ----
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const tw = 0.5 + 0.5 * Math.sin(tnow * 1.6 + s.p);
      ctx.fillStyle = "rgba(185,205,255," + (s.a * tw).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, 6.2832);
      ctx.fill();
    }

    // ---- project every node once ----
    for (let i = 0; i < brain.nodes.length; i++) {
      const n = brain.nodes[i];
      nodeProj[n.i] = E.project([n.x, n.y, n.z], cam);
    }

    // ---- edges: gradient glow lines (source colour -> target colour) ----
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 0; i < brain.edges.length; i++) {
      const e = brain.edges[i];
      const glow = Math.max(e.fromR.act, e.toR.act) * 0.6 + e.plasticity * 0.55;
      if (glow < 0.012) continue;
      const a = E.project(e.fromC, cam), b = E.project(e.toC, cam);
      if (!a.visible || !b.visible) continue;
      const ca = e.fromR.rgb, cb = e.toR.rgb;
      const ga = Math.min(0.85, glow * 0.5).toFixed(3);
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, "rgba(" + ca[0] + "," + ca[1] + "," + ca[2] + "," + ga + ")");
      grad.addColorStop(1, "rgba(" + cb[0] + "," + cb[1] + "," + cb[2] + "," + ga + ")");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 0.6 + glow * 2.8;
      if (glow > 0.16) { ctx.shadowColor = "rgba(" + ca[0] + "," + ca[1] + "," + ca[2] + ",0.9)"; ctx.shadowBlur = 14 * glow; }
      else ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ---- nodes: soft bloom halos (cached sprites), depth-sorted, distance-fogged ----
    visNodes.length = 0;
    for (let i = 0; i < brain.nodes.length; i++) {
      const pr = nodeProj[brain.nodes[i].i];
      if (pr.visible) visNodes.push(brain.nodes[i]);
    }
    visNodes.sort(function (p, q) { return nodeProj[q.i].depth - nodeProj[p.i].depth; });
    for (let i = 0; i < visNodes.length; i++) {
      const n = visNodes[i], pr = nodeProj[n.i];
      const r = brain.regions[n.region];
      const act = r.act;
      const depthFade = Math.min(1, Math.max(0.22, 1.55 - pr.depth * 0.16));
      const haloR = (2.6 + act * 8) * pr.s * 0.9;
      const alpha = (0.05 + act * 0.65) * depthFade;
      if (alpha > 0.004) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(glowSprite(r.rgb), pr.x - haloR, pr.y - haloR, haloR * 2, haloR * 2);
      }
    }
    ctx.globalAlpha = 1;

    // ---- node cores ----
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < visNodes.length; i++) {
      const n = visNodes[i], pr = nodeProj[n.i];
      const r = brain.regions[n.region];
      const act = r.act;
      const sr = Math.max(0.5, n.r * pr.s * 0.8);
      const b = Math.min(255, r.rgb[0] + 115), gg = Math.min(255, r.rgb[1] + 115), bl = Math.min(255, r.rgb[2] + 115);
      ctx.fillStyle = "rgba(" + b + "," + gg + "," + bl + "," + (0.35 + act * 0.6).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(pr.x, pr.y, sr, 0, 6.2832); ctx.fill();
    }

    // ---- pulses: gradient comet trails + glowing head ----
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i], e = p.edge;
      const pos = E.lerp3(e.fromC, e.toC, p.t);
      const pr = E.project(pos, cam);
      if (!pr.visible) { p.prev = null; continue; }
      const rgb = e.toR.rgb;
      if (p.prev) {
        const tail = ctx.createLinearGradient(p.prev.x, p.prev.y, pr.x, pr.y);
        tail.addColorStop(0, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0)");
        tail.addColorStop(1, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.9)");
        ctx.strokeStyle = tail;
        ctx.lineWidth = 1.4 + p.strength * 2.8;
        ctx.beginPath(); ctx.moveTo(p.prev.x, p.prev.y); ctx.lineTo(pr.x, pr.y); ctx.stroke();
      }
      const hr = 2.6 + p.strength * 3.4;
      ctx.drawImage(glowSprite(rgb), pr.x - hr * 2, pr.y - hr * 2, hr * 4, hr * 4);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath(); ctx.arc(pr.x, pr.y, Math.max(1, hr * 0.5), 0, 6.2832); ctx.fill();
      p.prev = { x: pr.x, y: pr.y };
    }

    // ---- arrival ripples ----
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      const rp = E.project(ring.r.centroid, cam);
      if (!rp.visible) continue;
      const k = ring.t;
      const rad = (6 + k * 52) * rp.s;
      ctx.strokeStyle = "rgba(" + ring.rgb[0] + "," + ring.rgb[1] + "," + ring.rgb[2] + "," + (0.6 * (1 - k)).toFixed(3) + ")";
      ctx.lineWidth = 2.2 * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, rad, 0, 6.2832); ctx.stroke();
    }

    // ---- labels (glass chips with activation glow + dot) ----
    ctx.globalCompositeOperation = "source-over";
    labelHits = [];
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < brain.regionList.length; i++) {
      const r = brain.regionList[i];
      if (!r.label || r.side === "R") continue;
      const pr = E.project([r.centroid[0], r.centroid[1] + r.size * 0.9, r.centroid[2]], cam);
      if (!pr.visible) continue;
      const isHover = hovered === r.id;
      const lbl = r.short;
      const w = ctx.measureText(lbl).width + 16;
      ctx.save();
      if (r.act > 0.05) { ctx.shadowColor = r.color; ctx.shadowBlur = 10 + r.act * 18; }
      ctx.fillStyle = isHover ? "rgba(10,14,26,0.9)" : "rgba(6,9,18,0.6)";
      ctx.strokeStyle = r.color;
      ctx.lineWidth = isHover ? 1.6 : 0.9;
      roundRect(pr.x - w / 2, pr.y - 11, w, 22, 7);
      ctx.fill(); ctx.stroke();
      ctx.restore();
      if (r.act > 0.05) {
        ctx.fillStyle = r.color;
        ctx.beginPath(); ctx.arc(pr.x - w / 2 + 8, pr.y, 2.4, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = "#eaf2ff";
      ctx.fillText(lbl, pr.x, pr.y);
      labelHits.push({ id: r.id, x: pr.x, y: pr.y, r: 22 });
    }
  }

  // cached soft radial-glow sprite for a given colour (cheap bloom)
  function glowSprite(rgb) {
    const key = rgb[0] + "," + rgb[1] + "," + rgb[2];
    let c = glowCache[key];
    if (c) return c;
    const size = 64;
    c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",1)");
    grd.addColorStop(0.35, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.45)");
    grd.addColorStop(1, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    glowCache[key] = c;
    return c;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ------------------------------------------------------------- loop
  function loop(ts) {
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;

    if (!dragging) cam.yaw += 0.0022;
    updatePulses(dt);
    decay(dt);

    // ambient auto-fire
    if (mode === "ambient") {
      ambientTimer -= dt;
      if (ambientTimer <= 0) {
        ambientTimer = 1.5 + Math.random() * 1.2;
        const pick = ["eye_L", "eye_R", "antennal_L", "antennal_R", "mb", "cc", "lobulaplate_L"];
        fireRegion(pick[Math.floor(Math.random() * pick.length)], 0.9);
      }
    }

    // smooth live synapse counter
    state.liveSyn = state.liveSyn * 0.85 + state.frameSyn * 0.15;
    $("stat-synapses-live").textContent = Math.round(state.liveSyn).toLocaleString();

    render();
    requestAnimationFrame(loop);
  }

  // --------------------------------------------------------- interaction
  function onDown(e) {
    dragging = true; moved = false;
    lastX = downX = e.clientX; lastY = downY = e.clientY;
    downT = performance.now(); btn = e.button;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true;
      cam.yaw += dx * 0.006;
      cam.pitch += dy * 0.006;
      cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch));
      lastX = e.clientX; lastY = e.clientY;
    } else {
      // hover detection
      const x = e.clientX, y = e.clientY;
      let best = null, bestD = 22;
      for (let i = 0; i < labelHits.length; i++) {
        const h = labelHits[i];
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < bestD) { bestD = d; best = h; }
      }
      hovered = best ? best.id : null;
      canvas.style.cursor = best ? "pointer" : "grab";
      if (best) showInfo(best.id);
    }
  }
  function onUp(e) {
    if (dragging && !moved && btn === 0) {
      const x = e.clientX, y = e.clientY;
      let best = null, bestD = 24;
      for (let i = 0; i < labelHits.length; i++) {
        const h = labelHits[i];
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < bestD) { bestD = d; best = h; }
      }
      if (best) fireRegion(best.id, 1.0);
    }
    dragging = false;
  }
  function onWheel(e) {
    e.preventDefault();
    cam.camZ *= (1 + e.deltaY * 0.0009);
    cam.camZ = Math.max(2.1, Math.min(6.5, cam.camZ));
  }

  function showInfo(id) {
    const r = brain.regions[id];
    if (!r) return;
    $("info").innerHTML =
      '<div class="info-name" style="color:' + r.color + '">' + r.name + "</div>" +
      '<div class="info-kind">' + r.kind + (r.side !== "C" ? " · " + (r.side === "L" ? "left" : "right") + " hemisphere" : "") + "</div>" +
      '<div class="info-desc">' + r.desc + "</div>";
  }

  // ------------------------------------------------------------- UI / modes
  function setMode(m) {
    mode = m;
    ["free", "sensory", "train", "ambient"].forEach(function (x) {
      const b = $("mode-" + x);
      if (b) b.classList.toggle("active", x === m);
      const c = $("ctx-" + x);
      if (c) c.style.display = (x === m) ? "block" : "none";
    });
    const names = { free: "Free Fire", sensory: "Sensory Cascade", train: "Train Memory", ambient: "Ambient" };
    $("stat-mode").textContent = names[m];
    if (m === "ambient") ambientTimer = 0.4;
  }

  function wireUI() {
    ["free", "sensory", "train", "ambient"].forEach(function (x) {
      const b = $("mode-" + x);
      if (b) b.addEventListener("click", function () { setMode(x); });
    });
    $("btn-eyes").addEventListener("click", function () { fireRegion("eye_L", 1); fireRegion("eye_R", 1); });
    $("btn-odor").addEventListener("click", function () { fireRegion("antennal_L", 1); fireRegion("antennal_R", 1); });
    $("btn-train").addEventListener("click", function () {
      state.trainCount++;
      fireRegion("antennal_L", 1);
      updateMemory();
      toast("🧠 trained cue ×" + state.trainCount + " — Mushroom Body wiring strengthening");
    });
    $("btn-recall").addEventListener("click", function () {
      if (state.trainCount === 0) { toast("Train the cue a few times first!"); return; }
      fireRegion("antennal_L", 1);
      toast("⚡ recall — watch the learned pathway fire faster & brighter");
    });
    $("btn-resetmem").addEventListener("click", function () {
      brain.edges.forEach(function (e) { if (e.trainable) e.plasticity = 0; });
      state.trainCount = 0; updateMemory();
      toast("Memory wiped — plasticity reset");
    });
    $("btn-ambient").addEventListener("click", function () {
      if (mode !== "ambient") setMode("ambient"); else setMode("free");
    });
    updateMemory();
  }

  function updateMemory() {
    let sum = 0, n = 0;
    brain.edges.forEach(function (e) { if (e.trainable) { sum += e.plasticity; n++; } });
    const pct = n ? Math.round((sum / n) * 100) : 0;
    const bar = $("mem-bar");
    if (bar) bar.style.width = pct + "%";
    const p = $("mem-pct");
    if (p) p.textContent = pct + "%";
    const tc = $("train-count");
    if (tc) tc.textContent = state.trainCount;
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  if (document.readyState === "loading") window.addEventListener("load", init);
  else init();
})();
