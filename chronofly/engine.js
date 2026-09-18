import { MODULATE_GAIN, STEPS, runTwins } from './sim.js';

const CONTROL_COLOR = '#a855f7';
const TREATED_COLOR = '#ff266d';
const GRID_COLOR = 'rgba(255, 255, 255, 0.06)';
const AXIS_COLOR = 'rgba(255, 255, 255, 0.16)';
const LABEL_COLOR = '#8b9bb4';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const telemetry = document.getElementById('telemetry');
const runBtn = document.getElementById('runBtn');
const seedInput = document.getElementById('seed');
const interventionSelect = document.getElementById('intervention');

let current = runTwins(42, 'none', MODULATE_GAIN);

function setDebug(result) {
  window.CHRONOFLY = window.CHRONOFLY || {};
  window.CHRONOFLY._lastTracesA = [...result.tracesA];
  window.CHRONOFLY._lastTracesB = [...result.tracesB];
  window.CHRONOFLY._lastResult = result;
}

function resizeCanvas() {
  canvas.width = Math.max(320, canvas.offsetWidth || 600);
  canvas.height = Math.max(260, canvas.offsetHeight || 400);
  if (current) render(current.tracesA, current.tracesB);
}
window.addEventListener('resize', resizeCanvas);

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

function updateTelemetry(result) {
  telemetry.textContent =
    `Seed: ${result.seed}\n` +
    `Intervention: ${result.intervention}\n` +
    `MSE divergence: ${result.divergence.toExponential(3)}\n` +
    `Control N4 mean: ${result.meanA.toFixed(3)}\n` +
    `Treated N4 mean: ${result.meanB.toFixed(3)}`;
}

function handleRun() {
  const seed = Math.max(0, parseInt(seedInput.value, 10) || 42);
  const intervention = interventionSelect.value;
  current = runTwins(seed, intervention, MODULATE_GAIN);
  setDebug(current);
  render(current.tracesA, current.tracesB);
  updateTelemetry(current);
}

runBtn.addEventListener('click', handleRun);
resizeCanvas();
handleRun();
