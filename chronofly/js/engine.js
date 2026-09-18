import { ARENA_H, ARENA_W, MODULATE_GAIN, STEPS, flyPath, runTwins } from './sim.js';
import { createFly3D, createTrail } from './fly3d.js';
import { createAudio } from './audio.js';

const CONTROL_HEX = 0xa855f7;
const TREATED_HEX = 0xff266d;
const CONTROL_CSS = '#a855f7';
const TREATED_CSS = '#ff266d';
const GRID_COLOR = 'rgba(255, 255, 255, 0.06)';
const AXIS_COLOR = 'rgba(255, 255, 255, 0.16)';
const LABEL_COLOR = '#8b9bb4';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const arenaEl = document.getElementById('arena');
const telemetry = document.getElementById('telemetry');
const caption = document.getElementById('flight-caption');
const runBtn = document.getElementById('runBtn');
const playBtn = document.getElementById('playBtn');
const restartBtn = document.getElementById('restartBtn');
const soundBtn = document.getElementById('soundBtn');
const seedInput = document.getElementById('seed');
const interventionSelect = document.getElementById('intervention');

const audio = createAudio();
let current = runTwins(42, 'none', MODULATE_GAIN);
let flight = null;

const T = window.THREE;
let renderer = null;
let scene = null;
let camera = null;
let camLook = null;
let flyA = null;
let flyB = null;
let trailA = null;
let trailB = null;
let linkLine = null;
let linkGeo = null;
let plume = null;
let plumeRing = null;
let plumeLight = null;
let dust = null;
let dustVel = null;
let webglOK = !!T;

function setDebug(result) {
  window.CHRONOFLY = window.CHRONOFLY || {};
  window.CHRONOFLY._lastTracesA = [...result.tracesA];
  window.CHRONOFLY._lastTracesB = [...result.tracesB];
  window.CHRONOFLY._lastResult = result;
}

function render(tracesA, tracesB) {
  const width = canvas.width;
  const height = canvas.height;
  const margin = { t: 44, r: 24, b: 44, l: 58 };
  const plotWidth = width - margin.l - margin.r;
  const plotHeight = height - margin.t - margin.b;

  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, width, height);

  const all = [...tracesA, ...tracesB];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = Math.max(0.1, (max - min) * 0.12);
  const minY = min - pad;
  const maxY = max + pad;
  const toX = (i) => margin.l + (i / (tracesA.length - 1)) * plotWidth;
  const toY = (v) => margin.t + plotHeight - ((v - minY) / (maxY - minY)) * plotHeight;

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i += 1) {
    const x = margin.l + (i / 5) * plotWidth;
    ctx.beginPath();
    ctx.moveTo(x, margin.t);
    ctx.lineTo(x, margin.t + plotHeight);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i += 1) {
    const y = margin.t + (i / 5) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(margin.l, y);
    ctx.lineTo(margin.l + plotWidth, y);
    ctx.stroke();
  }

  ctx.strokeStyle = AXIS_COLOR;
  ctx.beginPath();
  ctx.moveTo(margin.l, margin.t);
  ctx.lineTo(margin.l, margin.t + plotHeight);
  ctx.lineTo(margin.l + plotWidth, margin.t + plotHeight);
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeStyle = CONTROL_CSS;
  ctx.beginPath();
  for (let i = 0; i < tracesA.length; i += 1) {
    const x = toX(i);
    const y = toY(tracesA[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = TREATED_CSS;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  for (let i = 0; i < tracesB.length; i += 1) {
    const x = toX(i);
    const y = toY(tracesB[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = LABEL_COLOR;
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillText('Time (steps)', margin.l + plotWidth / 2 - 34, margin.t + plotHeight + 24);
  ctx.fillText('Voltage', 8, margin.t + 12);
  ctx.fillStyle = CONTROL_CSS;
  ctx.fillText('— control', margin.l, 22);
  ctx.fillStyle = TREATED_CSS;
  ctx.fillText('- - treated', margin.l + 84, 22);
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`0–${STEPS} steps · neuron N4`, margin.l + 184, 22);
}

function worldFromPath(p, lane) {
  return {
    x: -14 + (p.x / ARENA_W) * 28,
    y: 2.3,
    z: lane + ((p.y - ARENA_H / 2) / ARENA_H) * 6
  };
}

function initGL() {
  if (!T) {
    webglOK = false;
    caption.textContent = 'WebGL library failed to load — voltage plot above still works.';
    return;
  }
  try {
    renderer = new T.WebGLRenderer({ canvas: arenaEl, antialias: true });
  } catch (e) {
    webglOK = false;
    caption.textContent = 'WebGL unavailable in this browser — voltage plot above still works.';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  scene = new T.Scene();
  scene.background = new T.Color(0x0a0e1a);
  scene.fog = new T.FogExp2(0x0a0e1a, 0.02);
  camera = new T.PerspectiveCamera(46, 1, 0.1, 200);
  camera.position.set(-20, 8, 14);
  camLook = new T.Vector3(0, 1, 0);

  scene.add(new T.AmbientLight(0x445566, 1.0));
  const sun = new T.DirectionalLight(0xffe2b0, 0.9);
  sun.position.set(6, 14, 8);
  scene.add(sun);
  const rim = new T.PointLight(0xa855f7, 0.8, 60);
  rim.position.set(-10, 6, -8);
  scene.add(rim);

  const ground = new T.Mesh(
    new T.PlaneGeometry(70, 30),
    new T.MeshPhongMaterial({ color: 0x0d1424, shininess: 20 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new T.GridHelper(60, 60, 0x2a3f66, 0x16233c);
  grid.position.y = 0.01;
  scene.add(grid);

  [-1.6, 1.6].forEach((z, i) => {
    const pad = new T.Mesh(
      new T.PlaneGeometry(30, 2.4),
      new T.MeshBasicMaterial({
        color: new T.Color(i === 0 ? CONTROL_HEX : TREATED_HEX),
        transparent: true, opacity: 0.07,
        blending: T.AdditiveBlending, depthWrite: false
      })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, 0.02, z);
    scene.add(pad);
    const gate = new T.Mesh(
      new T.BoxGeometry(0.25, 1.6, 2.4),
      new T.MeshBasicMaterial({ color: i === 0 ? CONTROL_HEX : TREATED_HEX, transparent: true, opacity: 0.5 })
    );
    gate.position.set(-14.6, 0.8, z);
    scene.add(gate);
  });

  plume = new T.Mesh(
    new T.CylinderGeometry(1.4, 2.4, 9, 20, 1, true),
    new T.MeshBasicMaterial({
      color: 0xffb700, transparent: true, opacity: 0.14,
      blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide
    })
  );
  plume.position.set(15.5, 4.5, 0);
  scene.add(plume);
  plumeRing = new T.Mesh(
    new T.TorusGeometry(1.8, 0.09, 10, 40),
    new T.MeshBasicMaterial({ color: 0xffd166 })
  );
  plumeRing.rotation.x = -Math.PI / 2;
  plumeRing.position.set(15.5, 0.06, 0);
  scene.add(plumeRing);
  plumeLight = new T.PointLight(0xffb700, 1.2, 26);
  plumeLight.position.set(15.5, 4, 0);
  scene.add(plumeLight);

  flyA = createFly3D(CONTROL_HEX);
  flyB = createFly3D(TREATED_HEX);
  scene.add(flyA.group, flyB.group, flyA.disc, flyB.disc);
  trailA = createTrail(CONTROL_HEX, STEPS);
  trailB = createTrail(TREATED_HEX, STEPS);
  scene.add(trailA.line, trailB.line);

  linkGeo = new T.BufferGeometry();
  linkGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
  linkLine = new T.Line(linkGeo, new T.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.3
  }));
  scene.add(linkLine);

  const dustGeo = new T.BufferGeometry();
  const dustArr = new Float32Array(150 * 3);
  dustVel = new Float32Array(150);
  for (let i = 0; i < 150; i += 1) {
    dustArr[i * 3] = -20 + Math.random() * 44;
    dustArr[i * 3 + 1] = 0.3 + Math.random() * 8;
    dustArr[i * 3 + 2] = -10 + Math.random() * 20;
    dustVel[i] = 0.2 + Math.random() * 0.8;
  }
  dustGeo.setAttribute('position', new T.BufferAttribute(dustArr, 3));
  dust = new T.Points(dustGeo, new T.PointsMaterial({
    color: 0x8fb8ff, size: 0.09, transparent: true, opacity: 0.6,
    blending: T.AdditiveBlending, depthWrite: false
  }));
  scene.add(dust);

  resizeGL();
}

function resizeGL() {
  const w = Math.max(320, arenaEl.clientWidth || 600);
  const h = Math.max(300, arenaEl.clientHeight || 420);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function startFlight(result) {
  if (flight && flight.raf) cancelAnimationFrame(flight.raf);
  flight = {
    worldA: flyPath(result.tracesA).map((p) => worldFromPath(p, -1.6)),
    worldB: flyPath(result.tracesB).map((p) => worldFromPath(p, 1.6)),
    frame: 0,
    playing: true,
    raf: 0,
    lastBlip: 0
  };
  playBtn.textContent = 'Pause Flight';
  const loop = (now) => {
    flight.raf = requestAnimationFrame(loop);
    if (flight.playing) flight.frame = Math.min(STEPS - 1, flight.frame + 2);
    drawScene(now);
  };
  loop(performance.now());
}

function pauseFlight() {
  if (!flight || !flight.playing) return;
  flight.playing = false;
  playBtn.textContent = 'Play Flight';
  audio.setBuzz(0, 190);
}

function resumeFlight() {
  if (!flight || flight.playing) return;
  flight.playing = true;
  playBtn.textContent = 'Pause Flight';
}

function drawScene(now) {
  const t = now / 1000;
  const f = Math.min(flight.frame, STEPS - 1);
  const a = flight.worldA[f];
  const b = flight.worldB[f];

  const bobA = Math.sin(t * 6) * 0.12;
  const bobB = Math.sin(t * 6 + 1.4) * 0.12;
  flyA.group.position.set(a.x, a.y + bobA, a.z);
  flyB.group.position.set(b.x, b.y + bobB, b.z);
  const headA = flight.worldA[Math.min(STEPS - 1, f + 1)];
  const headB = flight.worldB[Math.min(STEPS - 1, f + 1)];
  flyA.group.rotation.y = Math.atan2(-(headA.z - a.z), headA.x - a.x);
  flyB.group.rotation.y = Math.atan2(-(headB.z - b.z), headB.x - b.x);
  flyA.group.rotation.z = Math.sin(t * 6) * 0.06;
  flyB.group.rotation.z = Math.sin(t * 6 + 1.4) * 0.06;
  flyA.setFlap(t * 52);
  flyB.setFlap(t * 52 + 1.1);
  flyA.disc.position.set(a.x, 0.03, a.z);
  flyB.disc.position.set(b.x, 0.03, b.z);

  trailA.set(flight.worldA, f + 1);
  trailB.set(flight.worldB, f + 1);

  const lp = linkGeo.attributes.position.array;
  lp[0] = a.x; lp[1] = a.y + bobA; lp[2] = a.z;
  lp[3] = b.x; lp[4] = b.y + bobB; lp[5] = b.z;
  linkGeo.attributes.position.needsUpdate = true;

  const pulse = (Math.sin(t * 2.2) + 1) / 2;
  plume.material.opacity = 0.1 + pulse * 0.08;
  plumeRing.scale.setScalar(1 + pulse * 0.15);
  plumeLight.intensity = 1.0 + pulse * 0.6;

  const dp = dust.geometry.attributes.position.array;
  for (let i = 0; i < 150; i += 1) {
    dp[i * 3] += dustVel[i] * 0.008;
    dp[i * 3 + 1] += Math.sin(t + i) * 0.0012;
    if (dp[i * 3] > 24) dp[i * 3] = -20;
  }
  dust.geometry.attributes.position.needsUpdate = true;

  const midX = (a.x + b.x) / 2;
  const k = 0.04;
  camera.position.x += ((midX - 7) - camera.position.x) * k;
  camera.position.y += (7.5 - camera.position.y) * k;
  camera.position.z += (13 - camera.position.z) * k;
  camLook.x += ((midX + 3) - camLook.x) * k;
  camLook.y += (1 - camLook.y) * k;
  camLook.z += (0 - camLook.z) * k;
  camera.lookAt(camLook);

  const gap = Math.hypot(a.x - b.x, a.z - b.z);
  const buzz = Math.min(1, gap / 8);
  if (flight.playing) {
    audio.setBuzz(0.25 + buzz * 0.75, 175 + buzz * 70);
    if (gap > 2.5 && now - flight.lastBlip > 600) {
      flight.lastBlip = now;
      audio.blip(660 + Math.min(660, gap * 90));
    }
  }
  if (flight.playing && flight.frame >= STEPS - 1) {
    flight.playing = false;
    playBtn.textContent = 'Play Flight';
    audio.setBuzz(0, 190);
  }
  caption.textContent = `Flight step ${f + 1}/${STEPS} · twin separation ${gap.toFixed(1)} world units`;

  renderer.render(scene, camera);
}

function updateTelemetry(result) {
  telemetry.textContent =
    `Seed: ${result.seed}\n` +
    `Intervention: ${result.intervention}\n` +
    `MSE divergence: ${result.divergence.toExponential(3)}\n` +
    `Control N4 mean: ${result.meanA.toFixed(3)}\n` +
    `Treated N4 mean: ${result.meanB.toFixed(3)}`;
}

function handleRun() {
  audio.start();
  const seed = Math.min(0xffffffff, Math.max(0, parseInt(seedInput.value, 10) || 42));
  const intervention = interventionSelect.value;
  current = runTwins(seed, intervention, MODULATE_GAIN);
  setDebug(current);
  render(current.tracesA, current.tracesB);
  updateTelemetry(current);
  if (webglOK) startFlight(current);
}

function fitPlot() {
  canvas.width = Math.max(320, canvas.offsetWidth || 600);
  canvas.height = Math.max(300, canvas.offsetHeight || 400);
  render(current.tracesA, current.tracesB);
}

runBtn.addEventListener('click', handleRun);
playBtn.addEventListener('click', () => {
  if (!webglOK) return;
  audio.start();
  if (!flight) {
    startFlight(current);
    return;
  }
  if (flight.playing) pauseFlight();
  else resumeFlight();
});
restartBtn.addEventListener('click', () => {
  if (!webglOK) return;
  audio.start();
  startFlight(current);
});
soundBtn.addEventListener('click', () => {
  audio.start();
  const on = audio.toggle();
  soundBtn.textContent = on ? 'Sound: On' : 'Sound: Off';
});
window.addEventListener('resize', () => {
  fitPlot();
  if (webglOK) resizeGL();
});

initGL();
fitPlot();
handleRun();
