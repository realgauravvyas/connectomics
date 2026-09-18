import { TOTAL_STEPS, runReplay } from './sim.js';

const LABEL_COLOR = '#7f8bad';
const PANEL_FILL = '#070b14';
const PANEL_LINE = '#1b2740';
const HEAT_LOW = [5, 18, 34];
const HEAT_HIGH = [0, 229, 255];
const PLOT_COLOR = '#3ddc97';
const EVENT_COLOR = '#ffd166';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const telemetry = document.getElementById('telemetry');
const runBtn = document.getElementById('runBtn');
const seedInput = document.getElementById('seed');
const speedSelect = document.getElementById('speed');

let current = runReplay(123);

function setDebug(result) {
  window.ONEIRO = window.ONEIRO || {};
  window.ONEIRO._lastResult = result;
}

function resizeCanvas() {
  canvas.width = Math.max(320, canvas.offsetWidth || 900);
  canvas.height = Math.max(320, canvas.offsetHeight || 440);
  if (current) render(current, speedSelect.value);
}
window.addEventListener('resize', resizeCanvas);

function speedWindow(speed) {
  if (speed === '20x') return { window: TOTAL_STEPS, stride: 3 };
  if (speed === '5x') return { window: 200, stride: 2 };
  return { window: 80, stride: 1 };
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

function updateTelemetry(result, speed) {
  telemetry.textContent =
    `Seed: ${result.seed}\n` +
    `SWR events: ${result.replayEvents.length}\n` +
    `Mean synaptic strength: ${result.meanWeight.toExponential(3)}\n` +
    `Replay speed: ${speed} (plot compression only)`;
}

function handleRun() {
  const seed = Math.max(0, parseInt(seedInput.value, 10) || 123);
  const speed = speedSelect.value;
  current = runReplay(seed);
  setDebug(current);
  render(current, speed);
  updateTelemetry(current, speed);
}

runBtn.addEventListener('click', handleRun);
speedSelect.addEventListener('change', () => {
  if (current) {
    render(current, speedSelect.value);
    updateTelemetry(current, speedSelect.value);
  }
});
resizeCanvas();
handleRun();
