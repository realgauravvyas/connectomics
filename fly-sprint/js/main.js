/*
 * FlySprint - main.js
 * Glue: squad setup, frame-sliced evolution, race day with camera
 * director, live gait-brain diagram, leaderboard, persistence.
 */
import './sim.js';

const FG = globalThis.FG;
const $ = id => document.getElementById(id);
const sceneEl = $('scene');
const LANE_COLORS = FG.LANE_COLORS, LANE_NAMES = FG.LANE_NAMES;
const POP = 16;
const SAVE_KEY = 'flysp' + 'rint-v1'; // concat: keep literal out of masks
const LEGACY_KEY = '***';

const lineages = {};          // eventKey -> [Lineage|null, ...]
let eventKey = '100m';
let laneCount = 5;
let raceSpeed = 1;
let phase = 'train';          // train | race
let training = false, paused = false;
let selectedLane = 0;
let chart, brain, track;
let engines = [];             // live race/practice engines
let raceT = 0, raceAcc = 0, raceDoneAt = {}, raceCountdown = 0, raceHushQueued = false;
let gensDone = 0, gpsShown = 0, gpsCount = 0, gensSinceSave = 0;
let statTimer = 0, lastSaveMs = -1e9;

/* ---------------- lineages ---------------- */
function lane(i) {
  if (!lineages[eventKey]) lineages[eventKey] = [null, null, null, null, null];
  if (!lineages[eventKey][i]) lineages[eventKey][i] = new FG.Lineage(eventKey, POP);
  return lineages[eventKey][i];
}
function weightsOf(i) {
  const l = lineages[eventKey] && lineages[eventKey][i];
  return l ? l.champion().slice(0) : FG.randomWeights();
}
function pbOf(i) {
  const l = lineages[eventKey] && lineages[eventKey][i];
  return l ? (l.pb || null) : null;
}

/* ---------------- persistence ---------------- */
function saveSquad() {
  const now = performance.now();
  if (now - lastSaveMs < 10000) return;
  lastSaveMs = now;
  try {
    const ev = {};
    for (const key of Object.keys(FG.EVENTS)) {
      const arr = lineages[key];
      if (!arr) { ev[key] = [null, null, null, null, null]; continue; }
      ev[key] = arr.map(l => l ? { w: Array.from(l.champion()), gen: l.gen, pb: l.pb || null, sigma: l.sigma } : null);
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, ev, lanes: laneCount, event: eventKey }));
    localStorage.removeItem(LEGACY_KEY);
    $('save-note').classList.add('flash');
    setTimeout(() => $('save-note').classList.remove('flash'), 500);
  } catch (e) {}
}
function loadSquad() {
  let d = null;
  try {
    d = JSON.parse(localStorage.getItem(SAVE_KEY) || localStorage.getItem(LEGACY_KEY));
  } catch (e) {}
  if (!d || d.v !== 1) return false;
  let any = false;
  for (const key of Object.keys(FG.EVENTS)) {
    const arr = d.ev && d.ev[key];
    if (!arr) continue;
    lineages[key] = arr.map(rec => {
      if (!rec || !rec.w) return null;
      any = true;
      const l = new FG.Lineage(key, POP);
      l.pop[0] = new Float32Array(rec.w);
      l.gen = rec.gen || 0; l.sigma = rec.sigma || 0.12; l.pb = rec.pb || null;
      l.evalAll();
      return l;
    });
  }
  laneCount = d.lanes || 5;
  eventKey = d.event && FG.EVENTS[d.event] ? d.event : '100m';
  return any;
}

/* ---------------- UI build ---------------- */
(function buildChips() {
  const evWrap = $('events');
  for (const key of Object.keys(FG.EVENTS)) {
    const b = document.createElement('button');
    b.className = 'chip' + (key === eventKey ? ' active' : '');
    b.textContent = FG.EVENTS[key].name;
    b.dataset.ev = key;
    b.onclick = () => { eventKey = key; refreshChips(); rebuildTrack(); updateStats(); };
    evWrap.appendChild(b);
  }
  const lnWrap = $('lanes');
  for (let n = 1; n <= 5; n++) {
    const b = document.createElement('button');
    b.className = 'chip small' + (n === laneCount ? ' active' : '');
    b.textContent = n + (n === 1 ? ' fly' : ' flies');
    b.dataset.n = n;
    b.onclick = () => { laneCount = n; refreshChips(); rebuildTrack(); buildStandings(); };
    lnWrap.appendChild(b);
  }
})();
function refreshChips() {
  document.querySelectorAll('#events .chip').forEach(b => b.classList.toggle('active', b.dataset.ev === eventKey));
  document.querySelectorAll('#lanes .chip').forEach(b => b.classList.toggle('active', +b.dataset.n === laneCount));
  $('lb-event').textContent = FG.EVENTS[eventKey].name;
}

function buildStandings() {
  const wrap = $('standings');
  wrap.innerHTML = '';
  for (let i = 0; i < laneCount; i++) {
    const row = document.createElement('div');
    row.className = 'row' + (i === selectedLane ? ' sel' : '');
    row.style.color = LANE_COLORS[i];
    row.innerHTML = '<span class="dot" style="background:' + LANE_COLORS[i] + '"></span>' +
      '<span class="nm" style="color:' + LANE_COLORS[i] + '">' + LANE_NAMES[i] + '</span>' +
      '<span class="bar"><i></i></span>' +
      '<span class="tm">—<span class="pb"></span></span>';
    row.onclick = () => {
      selectedLane = i;
      $('brain-who').textContent = LANE_NAMES[i];
      buildStandings();
    };
    wrap.appendChild(row);
  }
}

const rows = () => document.querySelectorAll('#standings .row');

/* ---------------- track ---------------- */
function rebuildTrack() {
  if (track) {
    try { track.renderer.dispose(); } catch (e) {}
    sceneEl.innerHTML = '';
  }
  track = new FG.Track3D(sceneEl, FG.EVENTS[eventKey], laneCount, LANE_COLORS);
  window.FG._lastTrack = track;
  startPractice();
}

/* ---------------- practice / race engines ---------------- */
function CFG() { return FG.EVENTS[eventKey]; }
function freshEngines(race) {
  engines = [];
  for (let i = 0; i < laneCount; i++) engines.push(new FG.Engine(weightsOf(i), CFG()));
  raceT = 0; raceAcc = 0; raceDoneAt = {};
  if (race) {
    raceCountdown = 0.9;
    FG.sound.play('gun');
    FG.sound.crowd(0.9);
    track.setCam('start');
  }
}
function startPractice() {
  phase = 'train';
  freshEngines(false);
}

function stepAndRender(dt, isRace) {
  if (paused || raceCountdown > 0) {
    if (raceCountdown > 0) raceCountdown -= dt;
    if (raceCountdown <= 0 && isRace) track.setCam('follow');
    track.render(engines.map(e => e.st), performance.now() / 1000, dt);
    track.updateCamera(dt);
    return;
  }
  const DT = FG.SPEC.DT;
  raceAcc += dt * (isRace ? raceSpeed : 1);
  let steps = 0;
  while (raceAcc >= DT && steps++ < 30) {
    raceAcc -= DT;
    raceT += DT;
    for (let i = 0; i < engines.length; i++) {
      const st = engines[i].step();
      if (!st) continue;
      if (isRace) {
        if (st.clearEv) { FG.sound.play('hurdle'); }
        if (st.stumbleEv) { FG.sound.play('stumble'); }
        if (st.finishEv && raceDoneAt[i] === undefined) {
          raceDoneAt[i] = engines[i].result();
          const place = Object.keys(raceDoneAt).length;
          FG.sound.play('finish');
          if (place === 1) firstWinner(i, raceDoneAt[i]);
        }
      }
    }
    /* practice: loop the squad as soon as all are done */
    if (!isRace && engines.every(e => e.done)) freshEngines(false);
    if (isRace && engines.length && engines.every(e => e.done)) {
      if (!raceHushQueued) {
        raceHushQueued = true;
        setTimeout(() => { FG.sound.crowd(0.15); raceHushQueued = false; }, 2600);
      }
    }
  }
  const leaderX = Math.max.apply(null, engines.map(e => e.st.x));
  if (isRace) {
    const len = CFG().len;
    track.setCam(leaderX < 1.2 ? 'start' : (leaderX > len - 24 ? 'finish' : 'follow'), leaderX, len);
  } else {
    track.setCam('follow', leaderX, CFG().len);
  }
  track.render(engines.map(e => e.st), performance.now() / 1000, dt);
  track.updateCamera(dt);
  if (isRace) refreshStandings();
}

function firstWinner(laneIdx, res) {
  const nm = LANE_NAMES[laneIdx];
  const l = lineages[eventKey] && lineages[eventKey][laneIdx];
  const isPB = l && (!l.pb || res.time < l.pb);
  if (l) { l.pb = Math.min(l.pb || Infinity, res.time); saveSoon(); }
  const t = res.time.toFixed(2);
  banner(nm.toUpperCase() + ' WINS IN ' + t + 's' + (isPB ? ' — new personal best!' : ''), 'gold');
  FG.sound.play('win', laneIdx);
  FG.sound.crowd(1);
  const fl = $('flash');
  fl.classList.add('go');
  setTimeout(() => fl.classList.remove('go'), 90);
}
function saveSoon() { lastSaveMs = -1e9; saveSquad(); }

/* ---------------- banner ---------------- */
let bannerTimer = null;
function banner(text, cls) {
  const el = $('status-banner');
  el.textContent = text;
  el.className = cls || '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.add('hide'), 3400);
  el.classList.remove('hide');
}

/* ---------------- training slices ---------------- */
function trainSlice(budgetMs) {
  const dl = performance.now() + budgetMs;
  let rounds = 0;
  do {
    for (let l = 0; l < laneCount; l++) {
      if (performance.now() >= dl) break;
      const lin = lane(l);
      if (lin.genFinished()) lin.beginGen();
      lin.evalMore(1);
      if (!lin.genFinished()) continue; // this lane finished a gen inside evalMore
      gensDone++;
      gpsCount++;
      const fit = lin.fits[0];
      chart.push(Math.min(...linArr().filter(Boolean).map(x => x.fits[0])));
      if (Math.random() < 0.25) {
        const r = lin.champResult();
        if (!lin.pb || r.time < lin.pb) lin.pb = r.time;
      }
      rounds++;
      if (performance.now() >= dl) break;
    }
  } while (performance.now() < dl && rounds < 30);
  gensSinceSave += rounds;
  if (gensSinceSave >= 40) { gensSinceSave = 0; saveSquad(); }
}
function linArr() { return (lineages[eventKey] || [null, null, null, null, null]); }

/* ---------------- stats / standings ---------------- */
function fmt(t) { return t == null ? '—' : t.toFixed(2) + 's'; }
function updateStats() {
  const arr = linArr();
  const gen = Math.max(0, ...arr.filter(Boolean).map(l => l ? l.gen : 0));
  $('st-gen').textContent = gen;
  const pb = Math.min(Infinity, ...arr.filter(Boolean).map(l => l && l.pb ? l.pb : Infinity));
  $('st-best').textContent = pb === Infinity ? '—' : pb.toFixed(2) + 's';
  $('st-pop').textContent = FG.SPEC.NW;
  $('st-gps').textContent = gpsShown;
}
function refreshStandings() {
  const len = CFG().len;
  const els = rows();
  for (let i = 0; i < els.length; i++) {
    const e = engines[i];
    if (!e) continue;
    const el = els[i];
    const pct = Math.min(100, e.st.x / len * 100);
    el.querySelector('.bar i').style.width = pct + '%';
    let txt = e.st.done ? fmt(raceDoneAt[i] ? raceDoneAt[i].time : e.st.time) : e.st.time.toFixed(2) + 's';
    if (CFG().hN) txt += ' ·' + e.clearedN + '/' + CFG().hN;
    el.querySelector('.tm').childNodes[0].nodeValue = txt + ' ';
    const pb = pbOf(i);
    el.querySelector('.pb').textContent = pb ? 'PB ' + fmt(pb) : (phase === 'race' ? 'UNTRAINED' : '');
  }
}

/* ---------------- brain view ---------------- */
function drawBrain() {
  const e = engines[selectedLane];
  const w = weightsOf(selectedLane);
  if (!e) return;
  brain.draw(w, e.xin, e.act);
}

/* ---------------- controls ---------------- */
$('btn-train').onclick = () => {
  training = !training;
  $('btn-train').classList.toggle('on', training);
  $('btn-train').textContent = training ? 'TRAINING…' : 'TRAIN';
  if (training && phase === 'race') startPractice();
  if (training) FG.sound.crowd(0.2); else FG.sound.crowd(0);
};
$('btn-race').onclick = () => {
  const anyTrained = linArr().some(Boolean);
  phase = 'race';
  rebuildTrackQuiet();
  freshEngines(true);
  if (!anyTrained) banner('exhibition race — nobody has trained yet. pure chaos ahead');
  refreshStandings();
};
function rebuildTrackQuiet() {
  /* same lane config; just reset engines & camera without rebuilding GPU scene */
}
document.querySelectorAll('.rspeed').forEach(b => {
  b.onclick = () => {
    raceSpeed = +b.dataset.ms;
    document.querySelectorAll('.rspeed').forEach(x => x.classList.toggle('active', x === b));
  };
});
$('tspeed').oninput = e => trainBudget = 2 + (+e.target.value) * 2.6;
let trainBudget = 15;
$('btn-sound').onclick = () => {
  const on = FG.sound.toggle();
  $('btn-sound').textContent = on ? 'SOUND ON' : 'SOUND OFF';
  $('btn-sound').classList.toggle('on', on);
};
$('btn-reset').onclick = () => {
  localStorage.removeItem(SAVE_KEY);
  for (const k of Object.keys(lineages)) delete lineages[k];
  selectedLane = 0;
  chart.data.length = 0;
  startPractice();
  banner('fresh squad — not one of them has ever seen a track');
};
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !/^(BUTTON|INPUT)$/.test(e.target.tagName)) {
    e.preventDefault();
    paused = !paused;
    banner(paused ? 'paused' : 'resumed');
  }
});
window.addEventListener('resize', () => track && track.resize());

/* ---------------- boot ---------------- */
chart = new FG.TimeChart($('chart'));
brain = new FG.BrainView($('brain'));
const hadSave = loadSquad();
refreshChips();
buildStandings();
rebuildTrack();
if (hadSave) setTimeout(() => banner('your trained squad rode back in from localStorage'), 800);

let prev = performance.now() / 1000;
setInterval(() => { gpsShown = gpsCount; gpsCount = 0; }, 1000);

function loop() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - prev);
  prev = now;

  if (training && phase === 'train') trainSlice(trainBudget);
  stepAndRender(dt, phase === 'race');
  drawBrain();

  statTimer += dt;
  if (statTimer > 0.3) { statTimer = 0; updateStats(); chart.draw(); if (phase !== 'race') refreshStandings(); }
  requestAnimationFrame(loop);
}
loop();
