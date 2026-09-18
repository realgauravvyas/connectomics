import { MAZE_LENGTH, TOTAL_STEPS, runReplay } from './sim.js';
import { drawFly } from './fly.js';
import { createAudio } from './audio.js';

const LABEL_COLOR = '#7f8bad';
const PANEL_FILL = '#070b14';
const PANEL_LINE = '#1b2740';
const HEAT_LOW = [5, 18, 34];
const HEAT_HIGH = [0, 229, 255];
const PLOT_COLOR = '#3ddc97';
const EVENT_COLOR = '#ffd166';
const FLY_RGB = '61,220,151';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const flight = document.getElementById('flight');
const fctx = flight.getContext('2d');
const telemetry = document.getElementById('telemetry');
const caption = document.getElementById('flight-caption');
const runBtn = document.getElementById('runBtn');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const soundBtn = document.getElementById('soundBtn');
const seedInput = document.getElementById('seed');
const speedSelect = document.getElementById('speed');

const audio = createAudio();
let current = runReplay(123);
let anim = null;

function setDebug(result) {
  window.ONEIRO = window.ONEIRO || {};
  window.ONEIRO._lastResult = result;
}

function fitCanvas(el, minW, minH) {
  el.width = Math.max(minW, el.offsetWidth || minW);
  el.height = Math.max(minH, el.offsetHeight || minH);
}

function resizeAll() {
  fitCanvas(canvas, 320, 440);
  fitCanvas(flight, 320, 220);
  render(current, speedSelect.value);
  if (anim) drawFlight(performance.now());
}
window.addEventListener('resize', resizeAll);

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
  const pad = 46;
  return pad + (pos / (MAZE_LENGTH - 1)) * (flight.width - pad * 2);
}

function startFlight() {
  stopFlight();
  anim = {
    step: 0,
    playing: true,
    raf: 0,
    ripples: [],
    events: new Set(current.replayEvents)
  };
  const tick = (now) => {
    if (!anim || !anim.playing) return;
    anim.step = Math.min(TOTAL_STEPS - 1, anim.step + advanceFor(speedSelect.value));
    drawFlight(now);
    if (anim.step >= TOTAL_STEPS - 1) {
      anim.playing = false;
      playBtn.textContent = 'Play Flight';
      audio.setBuzz(0, 190);
      return;
    }
    anim.raf = requestAnimationFrame(tick);
  };
  anim.raf = requestAnimationFrame(tick);
}

function stopFlight() {
  if (anim && anim.raf) cancelAnimationFrame(anim.raf);
  anim = null;
}

function pauseFlight() {
  if (!anim || !anim.playing) return;
  anim.playing = false;
  cancelAnimationFrame(anim.raf);
  playBtn.textContent = 'Play Flight';
  audio.setBuzz(0, 190);
}

function resumeFlight() {
  if (!anim || anim.playing) return;
  anim.playing = true;
  playBtn.textContent = 'Pause Flight';
  const tick = (now) => {
    if (!anim || !anim.playing) return;
    anim.step = Math.min(TOTAL_STEPS - 1, anim.step + advanceFor(speedSelect.value));
    drawFlight(now);
    if (anim.step >= TOTAL_STEPS - 1) {
      anim.playing = false;
      playBtn.textContent = 'Play Flight';
      audio.setBuzz(0, 190);
      return;
    }
    anim.raf = requestAnimationFrame(tick);
  };
  anim.raf = requestAnimationFrame(tick);
}

function drawFlight(now) {
  const w = flight.width;
  const h = flight.height;
  const midY = h / 2;
  fctx.fillStyle = '#050a12';
  fctx.fillRect(0, 0, w, h);

  const vg = fctx.createRadialGradient(w / 2, midY, 10, w / 2, midY, w * 0.55);
  vg.addColorStop(0, 'rgba(61,220,151,0.07)');
  vg.addColorStop(1, 'rgba(61,220,151,0)');
  fctx.fillStyle = vg;
  fctx.fillRect(0, 0, w, h);

  fctx.strokeStyle = 'rgba(0,229,255,0.4)';
  fctx.lineWidth = 1.6;
  fctx.beginPath();
  fctx.moveTo(30, midY - 26);
  fctx.lineTo(w - 30, midY - 26);
  fctx.moveTo(30, midY + 26);
  fctx.lineTo(w - 30, midY + 26);
  fctx.stroke();

  fctx.fillStyle = LABEL_COLOR;
  fctx.font = '10px "JetBrains Mono", monospace';
  for (let m = 0; m < MAZE_LENGTH; m += 10) {
    const x = mazeX(m);
    fctx.fillRect(x, midY - 30, 1, 8);
    fctx.fillText(String(m), x - 6, midY - 36);
  }

  fctx.fillStyle = '#3ddc97';
  fctx.fillText('START', 30, midY + 44);
  fctx.fillStyle = '#ffd166';
  fctx.fillText('GOAL', w - 58, midY + 44);

  const step = anim.step;
  const trail = Math.min(14, step);
  for (let i = step - trail; i <= step; i += 1) {
    if (i < 0) continue;
    const a = 0.06 + 0.4 * ((i - (step - trail)) / Math.max(1, trail));
    const x = mazeX(current.positions[i]);
    const y = midY + Math.sin((i + now / 300) / 2.2) * 8;
    fctx.fillStyle = `rgba(${FLY_RGB},${a.toFixed(3)})`;
    fctx.beginPath();
    fctx.arc(x, y, 2.2, 0, 7);
    fctx.fill();
  }

  const pos = current.positions[step];
  const fx = mazeX(pos);
  const fy = midY + Math.sin((step + now / 300) / 2.2) * 8;
  const next = current.positions[Math.min(TOTAL_STEPS - 1, step + 1)];
  const heading = next >= pos ? 0 : Math.PI;
  drawFly(fctx, fx, fy, heading, 0.9, FLY_RGB, now, true);

  if (anim.events.has(step)) {
    anim.ripples.push({ x: fx, y: fy, r: 6, a: 1 });
    audio.chime();
  }
  anim.ripples = anim.ripples.filter((r) => {
    r.r += 1.6;
    r.a -= 0.03;
    if (r.a <= 0) return false;
    fctx.strokeStyle = `rgba(255,209,102,${r.a.toFixed(3)})`;
    fctx.lineWidth = 2;
    fctx.beginPath();
    fctx.arc(r.x, r.y, r.r, 0, 7);
    fctx.stroke();
    return true;
  });

  const active = anim.events.has(step);
  audio.setBuzz(active ? 0.9 : 0.45, active ? 225 : 190);
  caption.textContent =
    `Maze step ${step + 1}/${TOTAL_STEPS} · position ${pos}` +
    (active ? ' · SWR REPLAY' : '');
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
  playBtn.textContent = 'Pause Flight';
  startFlight();
}

runBtn.addEventListener('click', handleRun);
playBtn.addEventListener('click', () => {
  audio.start();
  if (!anim) {
    playBtn.textContent = 'Pause Flight';
    startFlight();
    return;
  }
  if (anim.playing) pauseFlight();
  else resumeFlight();
});
pauseBtn.addEventListener('click', pauseFlight);
restartBtn.addEventListener('click', () => {
  audio.start();
  playBtn.textContent = 'Pause Flight';
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

resizeAll();
handleRun();
