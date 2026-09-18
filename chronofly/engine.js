import { ARENA_H, ARENA_W, MODULATE_GAIN, STEPS, flyPath, runTwins } from './sim.js';
import { drawFly } from './fly.js';
import { createAudio } from './audio.js';

const CONTROL_COLOR = '#a855f7';
const TREATED_COLOR = '#ff266d';
const CONTROL_RGB = '168,85,247';
const TREATED_RGB = '255,38,109';
const GRID_COLOR = 'rgba(255, 255, 255, 0.06)';
const AXIS_COLOR = 'rgba(255, 255, 255, 0.16)';
const LABEL_COLOR = '#8b9bb4';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const arena = document.getElementById('arena');
const actx = arena.getContext('2d');
const telemetry = document.getElementById('telemetry');
const caption = document.getElementById('flight-caption');
const runBtn = document.getElementById('runBtn');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const soundBtn = document.getElementById('soundBtn');
const seedInput = document.getElementById('seed');
const interventionSelect = document.getElementById('intervention');

const audio = createAudio();
let current = runTwins(42, 'none', MODULATE_GAIN);
let flight = null;

function setDebug(result) {
  window.CHRONOFLY = window.CHRONOFLY || {};
  window.CHRONOFLY._lastTracesA = [...result.tracesA];
  window.CHRONOFLY._lastTracesB = [...result.tracesB];
  window.CHRONOFLY._lastResult = result;
}

function fitCanvas(el, minW, minH) {
  const w = Math.max(minW, el.offsetWidth || minW);
  const h = Math.max(minH, el.offsetHeight || minH);
  el.width = w;
  el.height = h;
}

function resizeAll() {
  fitCanvas(canvas, 320, 400);
  fitCanvas(arena, 320, 420);
  render(current.tracesA, current.tracesB);
  if (flight) drawArena(performance.now());
}
window.addEventListener('resize', resizeAll);

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
  ctx.strokeStyle = CONTROL_COLOR;
  ctx.beginPath();
  for (let i = 0; i < tracesA.length; i += 1) {
    const x = toX(i);
    const y = toY(tracesA[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = TREATED_COLOR;
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
  ctx.fillStyle = CONTROL_COLOR;
  ctx.fillText('— control', margin.l, 22);
  ctx.fillStyle = TREATED_COLOR;
  ctx.fillText('- - treated', margin.l + 84, 22);
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`0–${STEPS} steps · neuron N4`, margin.l + 184, 22);
}

function toArena(p) {
  return {
    x: 24 + (p.x / ARENA_W) * (arena.width - 48),
    y: 24 + (p.y / ARENA_H) * (arena.height - 48)
  };
}

function startFlight(result) {
  stopFlight();
  flight = {
    pathA: flyPath(result.tracesA),
    pathB: flyPath(result.tracesB),
    frame: 0,
    playing: true,
    raf: 0,
    ripples: [],
    lastBlip: 0
  };
  const tick = (now) => {
    if (!flight || !flight.playing) return;
    flight.frame = Math.min(STEPS - 1, flight.frame + 2);
    drawArena(now);
    if (flight.frame >= STEPS - 1) {
      flight.playing = false;
      playBtn.textContent = 'Play Flight';
      return;
    }
    flight.raf = requestAnimationFrame(tick);
  };
  flight.raf = requestAnimationFrame(tick);
}

function stopFlight() {
  if (flight && flight.raf) cancelAnimationFrame(flight.raf);
  flight = null;
}

function pauseFlight() {
  if (!flight || !flight.playing) return;
  flight.playing = false;
  cancelAnimationFrame(flight.raf);
  playBtn.textContent = 'Play Flight';
  audio.setBuzz(0, 190);
}

function resumeFlight() {
  if (!flight || flight.playing) return;
  flight.playing = true;
  playBtn.textContent = 'Pause Flight';
  const tick = (now) => {
    if (!flight || !flight.playing) return;
    flight.frame = Math.min(STEPS - 1, flight.frame + 2);
    drawArena(now);
    if (flight.frame >= STEPS - 1) {
      flight.playing = false;
      playBtn.textContent = 'Play Flight';
      return;
    }
    flight.raf = requestAnimationFrame(tick);
  };
  flight.raf = requestAnimationFrame(tick);
}

function drawTrail(path, frame, rgb) {
  for (let i = 0; i <= frame; i += 1) {
    const a = 0.08 + 0.5 * (i / Math.max(1, frame));
    const p = toArena(path[i]);
    actx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
    actx.beginPath();
    actx.arc(p.x, p.y, 1.6 + 1.4 * (i / STEPS), 0, 7);
    actx.fill();
  }
}

function drawArena(now) {
  const w = arena.width;
  const h = arena.height;
  actx.fillStyle = '#0a0e1a';
  actx.fillRect(0, 0, w, h);

  const plume = actx.createRadialGradient(w - 40, h / 2, 8, w - 40, h / 2, w * 0.45);
  plume.addColorStop(0, 'rgba(255,183,0,0.20)');
  plume.addColorStop(1, 'rgba(255,183,0,0)');
  actx.fillStyle = plume;
  actx.fillRect(0, 0, w, h);

  actx.strokeStyle = GRID_COLOR;
  actx.lineWidth = 1;
  for (let x = 0; x < w; x += 44) {
    actx.beginPath();
    actx.moveTo(x, 0);
    actx.lineTo(x, h);
    actx.stroke();
  }
  for (let y = 0; y < h; y += 44) {
    actx.beginPath();
    actx.moveTo(0, y);
    actx.lineTo(w, y);
    actx.stroke();
  }

  actx.strokeStyle = 'rgba(255,183,0,0.65)';
  actx.lineWidth = 2;
  actx.beginPath();
  actx.arc(w - 44, h / 2, 16 + 3 * Math.sin(now / 300), 0, 7);
  actx.stroke();
  actx.fillStyle = LABEL_COLOR;
  actx.font = '11px "JetBrains Mono", monospace';
  actx.fillText('ODOR', w - 66, h / 2 - 26);

  const f = flight.frame;
  drawTrail(flight.pathA, f, CONTROL_RGB);
  drawTrail(flight.pathB, f, TREATED_RGB);

  const a = toArena(flight.pathA[f]);
  const b = toArena(flight.pathB[f]);
  drawFly(actx, a.x, a.y, flight.pathA[f].heading, 1.0, CONTROL_RGB, now, true);
  drawFly(actx, b.x, b.y, flight.pathB[f].heading, 1.0, TREATED_RGB, now, true);

  actx.fillStyle = CONTROL_COLOR;
  actx.fillText('CONTROL', 14, 22);
  actx.fillStyle = TREATED_COLOR;
  actx.fillText('TREATED', 104, 22);

  const da = flight.pathA[f];
  const db = flight.pathB[f];
  const gap = Math.hypot(da.x - db.x, da.y - db.y);
  const buzz = Math.min(1, gap / 40);
  audio.setBuzz(0.25 + buzz * 0.75, 175 + buzz * 70);
  if (gap > 12 && now - flight.lastBlip > 600) {
    flight.lastBlip = now;
    audio.blip(660 + Math.min(660, gap * 12));
  }
  caption.textContent = `Flight step ${f + 1}/${STEPS} · twin separation ${gap.toFixed(1)} arena units`;
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
  const seed = Math.max(0, parseInt(seedInput.value, 10) || 42);
  const intervention = interventionSelect.value;
  current = runTwins(seed, intervention, MODULATE_GAIN);
  setDebug(current);
  render(current.tracesA, current.tracesB);
  updateTelemetry(current);
  playBtn.textContent = 'Pause Flight';
  startFlight(current);
}

runBtn.addEventListener('click', handleRun);
playBtn.addEventListener('click', () => {
  audio.start();
  if (!flight) {
    playBtn.textContent = 'Pause Flight';
    startFlight(current);
    return;
  }
  if (flight.playing) pauseFlight();
  else resumeFlight();
});
pauseBtn.addEventListener('click', pauseFlight);
restartBtn.addEventListener('click', () => {
  audio.start();
  playBtn.textContent = 'Pause Flight';
  startFlight(current);
});
soundBtn.addEventListener('click', () => {
  audio.start();
  const on = audio.toggle();
  soundBtn.textContent = on ? 'Sound: On' : 'Sound: Off';
});

resizeAll();
handleRun();
