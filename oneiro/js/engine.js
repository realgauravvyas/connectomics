import { MAZE_LENGTH, TOTAL_STEPS, runReplay } from './sim.js';
import { createFly3D, createTrail } from './fly3d.js';
import { createAudio } from './audio.js';

const LABEL_COLOR = '#7f8bad';
const PANEL_FILL = '#070b14';
const PANEL_LINE = '#1b2740';
const HEAT_LOW = [5, 18, 34];
const HEAT_HIGH = [0, 229, 255];
const PLOT_COLOR = '#3ddc97';
const EVENT_COLOR = '#ffd166';
const FLY_HEX = 0x3ddc97;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const flightEl = document.getElementById('flight');
const telemetry = document.getElementById('telemetry');
const caption = document.getElementById('flight-caption');
const runBtn = document.getElementById('runBtn');
const playBtn = document.getElementById('playBtn');
const restartBtn = document.getElementById('restartBtn');
const soundBtn = document.getElementById('soundBtn');
const seedInput = document.getElementById('seed');
const speedSelect = document.getElementById('speed');

const audio = createAudio();
let current = runReplay(123);
let anim = null;

const T = window.THREE;
let renderer = null;
let scene = null;
let camera = null;
let camLook = null;
let fly = null;
let trail = null;
let trailPts = [];
let rings = [];
let ringGeo = null;
let flash = null;
let webglOK = !!T;

function setDebug(result) {
  window.ONEIRO = window.ONEIRO || {};
  window.ONEIRO._lastResult = result;
}

function speedWindow(speed) {
  if (speed === '20x') return { window: TOTAL_STEPS, stride: 3 };
  if (speed === '5x') return { window: 200, stride: 2 };
  return { window: 80, stride: 1 };
}

function advanceFor(speed) {
  if (speed === '20x') return 5;
  if (speed === '5x') return 2;
  return 1;
}

function drawPanel(x, y, w, h, title) {
  ctx.fillStyle = PANEL_FILL;
  ctx.strokeStyle = PANEL_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillText(title, x + 10, y + 18);
}

function renderHeatmap(result, speed, x, y, w, h) {
  drawPanel(x, y, w, h, `HIPPOCAMPAL ACTIVITY · ${speed}`);
  const { window: windowSize, stride } = speedWindow(speed);
  const start = Math.max(0, result.hippocampal.length - windowSize);
  const frames = [];
  for (let i = start; i < result.hippocampal.length; i += stride) frames.push(result.hippocampal[i]);
  const neurons = result.hippocampal[0].length;
  const plotX = x + 10;
  const plotY = y + 28;
  const plotW = w - 20;
  const plotH = h - 48;
  let max = 0;
  for (const frame of frames) {
    for (const value of frame) max = Math.max(max, value);
  }
  if (!(max > 0)) max = 1;

  const cellW = plotW / frames.length;
  const cellH = plotH / neurons;
  for (let t = 0; t < frames.length; t += 1) {
    for (let n = 0; n < neurons; n += 1) {
      const v = Math.sqrt(Math.min(1, Math.max(0, frames[t][n] / max)));
      const r = Math.round(HEAT_LOW[0] + (HEAT_HIGH[0] - HEAT_LOW[0]) * v);
      const g = Math.round(HEAT_LOW[1] + (HEAT_HIGH[1] - HEAT_LOW[1]) * v);
      const b = Math.round(HEAT_LOW[2] + (HEAT_HIGH[2] - HEAT_LOW[2]) * v);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(plotX + t * cellW, plotY + n * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }

  ctx.fillStyle = EVENT_COLOR;
  for (const event of result.replayEvents) {
    if (event < start) continue;
    const index = event - start;
    if (index % stride !== 0) continue;
    const ex = plotX + (index / stride) * cellW;
    ctx.fillRect(ex, plotY, 1.5, plotH);
  }
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText('neurons', plotX, y + h - 6);
}

function renderLearning(result, x, y, w, h) {
  drawPanel(x, y, w, h, 'HEBBIAN LEARNING CURVE');
  const evolution = result.synapticEvolution;
  const margin = { t: 28, r: 12, b: 24, l: 48 };
  const plotW = w - margin.l - margin.r;
  const plotH = h - margin.t - margin.b;
  const min = Math.min(...evolution);
  const max = Math.max(...evolution);
  const span = Math.max(1e-9, max - min);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  ctx.moveTo(x + margin.l, y + margin.t);
  ctx.lineTo(x + margin.l, y + margin.t + plotH);
  ctx.lineTo(x + margin.l + plotW, y + margin.t + plotH);
  ctx.stroke();

  ctx.strokeStyle = PLOT_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < evolution.length; i += 1) {
    const px = x + margin.l + (i / Math.max(1, evolution.length - 1)) * plotW;
    const py = y + margin.t + plotH - ((evolution[i] - min) / span) * plotH;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText('steps', x + margin.l + plotW - 36, y + h - 6);
}

function render(result, speed) {
  ctx.fillStyle = '#050a12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const gap = 12;
  const panelW = (canvas.width - gap * 3) / 2;
  const panelH = canvas.height - 24;
  renderHeatmap(result, speed, gap, 12, panelW, panelH);
  renderLearning(result, gap * 2 + panelW, 12, panelW, panelH);
}

function mazeX(pos) {
  return -30 + (pos / (MAZE_LENGTH - 1)) * 60;
}

function initGL() {
  if (!T) {
    webglOK = false;
    caption.textContent = 'WebGL library failed to load — science panels above still work.';
    return;
  }
  try {
    renderer = new T.WebGLRenderer({ canvas: flightEl, antialias: true });
  } catch (e) {
    webglOK = false;
    caption.textContent = 'WebGL unavailable in this browser — science panels above still work.';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  scene = new T.Scene();
  scene.background = new T.Color(0x050a12);
  scene.fog = new T.FogExp2(0x050a12, 0.014);
  camera = new T.PerspectiveCamera(48, 1, 0.1, 250);
  camera.position.set(-38, 6, 12);
  camLook = new T.Vector3(-28, 1, 0);

  scene.add(new T.AmbientLight(0x445566, 1.0));
  const sun = new T.DirectionalLight(0xcfe8ff, 0.9);
  sun.position.set(4, 14, 8);
  scene.add(sun);
  flash = new T.PointLight(0xffd166, 0, 30);
  scene.add(flash);

  const floor = new T.Mesh(
    new T.PlaneGeometry(70, 12),
    new T.MeshPhongMaterial({ color: 0x0a1220, shininess: 24 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const railMat = new T.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.5 });
  [-4.4, 4.4].forEach((z) => {
    const rail = new T.Mesh(new T.BoxGeometry(66, 0.12, 0.12), railMat);
    rail.position.set(0, 0.35, z);
    scene.add(rail);
  });
  const wallMat = new T.MeshBasicMaterial({
    color: 0x0e5f74, transparent: true, opacity: 0.1,
    side: T.DoubleSide, depthWrite: false
  });
  [-4.4, 4.4].forEach((z) => {
    const wall = new T.Mesh(new T.PlaneGeometry(66, 3.4), wallMat);
    wall.position.set(0, 1.7, z);
    scene.add(wall);
  });

  for (let m = 0; m < MAZE_LENGTH; m += 10) {
    const tick = new T.Mesh(
      new T.BoxGeometry(0.18, 0.04, 8.8),
      new T.MeshBasicMaterial({ color: 0x27435f })
    );
    tick.position.set(mazeX(m), 0.02, 0);
    scene.add(tick);
  }

  const gateMat = new T.MeshBasicMaterial({ color: 0x3ddc97 });
  const goalMat = new T.MeshBasicMaterial({ color: 0xffd166 });
  [[mazeX(0), gateMat], [mazeX(MAZE_LENGTH - 1), goalMat]].forEach(([gx, mat]) => {
    const post1 = new T.Mesh(new T.BoxGeometry(0.3, 3.4, 0.3), mat);
    post1.position.set(gx, 1.7, -4.2);
    const post2 = post1.clone();
    post2.position.z = 4.2;
    const beam = new T.Mesh(new T.BoxGeometry(0.3, 0.3, 8.7), mat);
    beam.position.set(gx, 3.4, 0);
    scene.add(post1, post2, beam);
  });

  for (let i = 0; i < 20; i += 1) {
    const pref = (i / 20) * MAZE_LENGTH;
    const dot = new T.Mesh(
      new T.CircleGeometry(0.5, 16),
      new T.MeshBasicMaterial({
        color: 0x00e5ff, transparent: true, opacity: 0.22,
        blending: T.AdditiveBlending, depthWrite: false
      })
    );
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(mazeX(pref), 0.03, 0);
    scene.add(dot);
  }

  fly = createFly3D(FLY_HEX);
  scene.add(fly.group, fly.disc);
  trail = createTrail(FLY_HEX, 48);
  scene.add(trail.line);
  ringGeo = new T.RingGeometry(0.6, 0.85, 40);

  resizeGL();
}

function resizeGL() {
  const w = Math.max(320, flightEl.clientWidth || 900);
  const h = Math.max(220, flightEl.clientHeight || 220);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function startFlight() {
  if (anim && anim.raf) cancelAnimationFrame(anim.raf);
  for (const r of rings) {
    scene.remove(r.mesh);
    r.mesh.material.dispose();
  }
  rings = [];
  trailPts = [];
  anim = {
    step: 0,
    playing: true,
    raf: 0,
    flyX: mazeX(current.positions[0]),
    heading: 0,
    events: new Set(current.replayEvents)
  };
  playBtn.textContent = 'Pause Flight';
  const loop = (now) => {
    anim.raf = requestAnimationFrame(loop);
    if (anim.playing) anim.step = Math.min(TOTAL_STEPS - 1, anim.step + advanceFor(speedSelect.value));
    drawFlight(now);
  };
  loop(performance.now());
}

function pauseFlight() {
  if (!anim || !anim.playing) return;
  anim.playing = false;
  playBtn.textContent = 'Play Flight';
  audio.setBuzz(0, 190);
}

function resumeFlight() {
  if (!anim || anim.playing) return;
  anim.playing = true;
  playBtn.textContent = 'Pause Flight';
}

function drawFlight(now) {
  const t = now / 1000;
  const step = Math.min(anim.step, TOTAL_STEPS - 1);
  const targetX = mazeX(current.positions[step]);
  const prevX = anim.flyX;
  anim.flyX += (targetX - anim.flyX) * 0.16;
  const dx = anim.flyX - prevX;
  if (Math.abs(targetX - anim.flyX) > 0.4) {
    anim.heading = targetX >= anim.flyX ? 0 : Math.PI;
  }
  const flyY = 2.4 + Math.sin(t * 5.2) * 0.18;
  fly.group.position.set(anim.flyX, flyY, Math.sin(t * 1.7) * 0.5);
  fly.group.rotation.y = anim.heading === 0 ? 0 : Math.PI;
  fly.group.rotation.z = Math.sin(t * 5.2) * 0.05;
  fly.setFlap(t * 52);
  fly.disc.position.set(anim.flyX, 0.03, fly.group.position.z);
  const alt = 1 / (1 + flyY * 0.25);
  fly.disc.material.opacity = 0.3 * alt;

  trailPts.push({ x: anim.flyX, y: flyY, z: fly.group.position.z });
  if (trailPts.length > 48) trailPts.shift();
  trail.set(trailPts, trailPts.length);

  const active = anim.events.has(step);
  if (active && anim.playing) {
    const ring = new T.Mesh(ringGeo, new T.MeshBasicMaterial({
      color: 0xffd166, transparent: true, opacity: 0.9,
      side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false
    }));
    ring.position.set(anim.flyX, flyY, fly.group.position.z);
    ring.rotation.y = anim.heading === 0 ? 0 : Math.PI;
    scene.add(ring);
    rings.push({ mesh: ring, life: 1 });
    audio.chime();
  }
  rings = rings.filter((r) => {
    r.life -= 0.025;
    if (r.life <= 0) {
      scene.remove(r.mesh);
      r.mesh.material.dispose();
      return false;
    }
    r.mesh.scale.setScalar(1 + (1 - r.life) * 4);
    r.mesh.material.opacity = r.life * 0.9;
    r.mesh.lookAt(camera.position);
    return true;
  });
  flash.position.set(anim.flyX, flyY + 1, fly.group.position.z);
  flash.intensity += ((active ? 2.2 : 0) - flash.intensity) * 0.2;

  const k = 0.05;
  camera.position.x += ((anim.flyX - 9) - camera.position.x) * k;
  camera.position.y += (5.5 - camera.position.y) * k;
  camera.position.z += (11 - camera.position.z) * k;
  camLook.x += ((anim.flyX + 3) - camLook.x) * k;
  camLook.y += (1 - camLook.y) * k;
  camLook.z += (0 - camLook.z) * k;
  camera.lookAt(camLook);

  audio.setBuzz(active ? 0.9 : 0.45, active ? 225 : 190);
  caption.textContent =
    `Maze step ${step + 1}/${TOTAL_STEPS} · position ${current.positions[step]}` +
    (active ? ' · SWR REPLAY' : '');

  if (anim.playing && anim.step >= TOTAL_STEPS - 1) {
    anim.playing = false;
    playBtn.textContent = 'Play Flight';
    audio.setBuzz(0, 190);
  }
  renderer.render(scene, camera);
}

function updateTelemetry(result, speed) {
  telemetry.textContent =
    `Seed: ${result.seed}\n` +
    `SWR events: ${result.replayEvents.length}\n` +
    `Mean synaptic strength: ${result.meanWeight.toExponential(3)}\n` +
    `Replay speed: ${speed} (playback rate and plot compression)`;
}

function handleRun() {
  audio.start();
  audio.ui();
  const seed = Math.max(0, parseInt(seedInput.value, 10) || 123);
  const speed = speedSelect.value;
  current = runReplay(seed);
  setDebug(current);
  render(current, speed);
  updateTelemetry(current, speed);
  if (webglOK) startFlight();
}

function fitPanels() {
  canvas.width = Math.max(320, canvas.offsetWidth || 900);
  canvas.height = 440;
  render(current, speedSelect.value);
}

runBtn.addEventListener('click', handleRun);
playBtn.addEventListener('click', () => {
  audio.start();
  if (!anim) {
    startFlight();
    return;
  }
  if (anim.playing) pauseFlight();
  else resumeFlight();
});
restartBtn.addEventListener('click', () => {
  audio.start();
  startFlight();
});
soundBtn.addEventListener('click', () => {
  audio.start();
  const on = audio.toggle();
  soundBtn.textContent = on ? 'Sound: On' : 'Sound: Off';
});
speedSelect.addEventListener('change', () => {
  render(current, speedSelect.value);
  updateTelemetry(current, speedSelect.value);
});
window.addEventListener('resize', () => {
  fitPanels();
  if (webglOK) resizeGL();
});

initGL();
fitPanels();
handleRun();
