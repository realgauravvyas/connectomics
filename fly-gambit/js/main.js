/*
 * FlyGambit - main.js
 * Glue: game loop (replay / turbo / you-vs-fly), board rendering,
 * silence controls, telemetry, autosave.
 */
import { Chess } from '../vendor/chess.mjs';
import './connectome.js';
import './chessai.js';

globalThis.Chess = Chess;
const FG = globalThis.FG;

/* ---------------- state ---------------- */
const trainer = new FG.FlyTrainer();
FG._demoBrain = trainer.brain;

const SAVE_KEY = 'flygambit-v1';
const LEGACY_KEY = '***';
let game = trainer.beginGame();
let show = trainer.beginGame();   // showcase game watched in TURBO mode
let showAcc = 0;
let mode = 'replay';           // replay | turbo | human
let paused = false;
let speed = 5;                 // 1..10
let acc = 0;                   // replay move timer
let flyTimer = 0;              // human-mode fly delay
let humanSel = null;           // {from, targets:[{to,move}]}
let lastMoveEl = null;
let totalPlies = 0, totalMoves = 0;
let lastEntropy = null, lastConf = 0;
let gamesAtSave = 0, gpsShown = 0, lastSaveMs = 0;

restore();

/* ---------------- 3D viz ---------------- */
const sceneEl = document.getElementById('scene');
let viz = new FG.BrainViz(sceneEl);
window.FG._lastViz = viz; // debug/test hook

/* ---------------- DOM refs ---------------- */
const $ = id => document.getElementById(id);
const boardEl = $('board'), movesEl = $('moves'), bannerEl = $('status-banner');
const squares = [];
(function buildBoard() {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const d = document.createElement('div');
    d.className = 'sq ' + ((r + c) % 2 ? 'dark' : 'light');
    const p = document.createElement('span'); p.className = 'p';
    d.appendChild(p);
    boardEl.appendChild(d);
    squares.push({ el: d, piece: p, r, c });
  }
})();

const GLYPH = { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' };

const chart = new FG.Sparkline($('chart'));

/* ---------------- board render ---------------- */
function renderBoard(chess) {
  const board = chess.board();
  for (const s of squares) {
    const cell = board[s.r][s.c];
    s.el.className = 'sq ' + ((s.r + s.c) % 2 ? 'dark' : 'light')
      + (cell ? (cell.color === 'w' ? ' w' : ' b') : '');
    s.piece.textContent = cell ? GLYPH[cell.type] : '';
    s.el.dataset.piece = cell ? cell.color + cell.type : '';
    s.el._move = cell;
  }
  if (chess.inCheck && chess.inCheck()) {
    const turn = chess.turn();
    for (const s of squares) {
      const pc = board[s.r][s.c];
      if (pc && pc.type === 'k' && pc.color === turn) s.el.classList.add('check');
    }
  }
}
function markLast(mv) {
  if (lastMoveEl) lastMoveEl.forEach(el => el.classList.remove('last'));
  const els = [];
  for (const s of squares) {
    const sqName = 'abcdefgh'[s.c] + (8 - s.r);
    if (sqName === mv.from || sqName === mv.to) { s.el.classList.add('last'); els.push(s.el); }
  }
  lastMoveEl = els;
}
function clearTargets() {
  for (const s of squares) s.el.classList.remove('sel', 'target', 'clickable');
}
function showTargets(from) {
  clearTargets();
  const legal = game.chess.moves({ square: from, verbose: true });
  if (!legal.length) return;
  humanSel = { from, moves: legal };
  const sqToEl = n => squares.find(s => 'abcdefgh'[s.c] + (8 - s.r) === n);
  const src = sqToEl(from);
  if (src) src.el.classList.add('sel');
  const seen = {};
  for (const m of legal) {
    if (seen[m.to]) continue;
    seen[m.to] = 1;
    const t = sqToEl(m.to);
    if (t) t.el.classList.add('target', 'clickable');
  }
}
function addMoveText(san, isWhite, mover, g) {
  const span = document.createElement('span');
  if (isWhite) span.textContent = Math.floor(((g || game).plies.length + 1) / 2) + '. ';
  span.append(san + ' ');
  if (mover === 'fly') span.className = 'flym';
  movesEl.appendChild(span);
  movesEl.scrollTop = movesEl.scrollHeight;
  if (movesEl.childElementCount > 240) movesEl.removeChild(movesEl.firstChild);
}

/* ---------------- banners ---------------- */
let bannerTimer = null;
function banner(text, bad) {
  bannerEl.textContent = text;
  bannerEl.classList.toggle('bad', !!bad);
  bannerEl.classList.remove('hide');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => bannerEl.classList.add('hide'), 2600);
}

/* ---------------- training loops ----------------
 * TURBO trains at full speed on an invisible game while one showcase
 * game is played out slowly with the same live brain.                  */
function restart(g) {
  const res = trainer.finishGame(g);
  if (res) {
    chart.push(trainer.captureRates[trainer.captureRates.length - 1] || 0, trainer.accVsGreedy);
    if (res.winner !== 'draw' && res.terminal === 1 && Math.random() < 0.06) {
      banner('checkmate in self-play - ' + (res.winner === 'w' ? 'white' : 'black') + ' side wins');
    }
    autosave();
  }
  const fresh = trainer.beginGame();
  if (g === game) game = fresh; else show = fresh;
  const visible = mode === 'turbo' ? show : game;
  if (fresh === visible) { // only reset the UI if this game is on screen
    FG.sound.play('newgame');
    renderBoard(fresh.chess);
    movesEl.innerHTML = '';
    lastMoveEl = null;
    humanSel = null;
    clearTargets();
  }
}

function stepVisible(g, temp) {
  const info = trainer.stepGame(g, temp);
  if (!info) { restart(g); return; }
  totalPlies++;
  lastEntropy = info.entropy;
  let mx = 0; for (let i = 0; i < info.probs.length; i++) mx = Math.max(mx, info.probs[i]);
  lastConf = mx;
  viz.pulseMove(info.viz);
  renderBoard(g.chess);
  markLast(info.move);
  addMoveText(info.san, info.move.color === 'w', 'fly', g);
  playMoveSound(info.move, info.gameOver ? info.status : null);
  if (info.gameOver) {
    const st = info.status;
    if (st.startsWith('checkmate')) banner('checkmate - ' + (st.split(':')[1] === 'w' ? 'white' : 'black') + ' side wins');
    else if (st === 'stalemate') banner('stalemate');
    else if (st === 'draw') banner('draw');
  }
}

/* human mode: fly moves with low temperature */
function flyMove() {
  if (game.over) return;
  const info = trainer.stepGame(game, 0.35);
  if (!info) { endHumanGame(); return; }
  totalPlies++;
  lastEntropy = info.entropy;
  let mx = 0; for (let i = 0; i < info.probs.length; i++) mx = Math.max(mx, info.probs[i]);
  lastConf = mx;
  viz.pulseMove(info.viz);
  renderBoard(game.chess);
  markLast(info.move);
  addMoveText(info.san, false, 'fly');
  playMoveSound(info.move, info.gameOver ? info.status : null);
  if (game.over) endHumanGame();
}
function endHumanGame() {
  const st = trainer.gameStatus(game.chess);
  if (st.startsWith('checkmate')) {
    const w = st.split(':')[1];
    banner(w === 'b' ? 'the fly mates you. it files the game away' : 'you beat the fly. it learns anyway', w !== 'b');
  } else if (st === 'stalemate') banner('stalemate - draw');
  else banner('game ended');
  trainer.finishGame(game);
  chart.push(trainer.captureRates[trainer.captureRates.length - 1] || 0, trainer.accVsGreedy);
  autosave();
  setTimeout(() => {
    game = trainer.beginGame();
    renderBoard(game.chess);
    movesEl.innerHTML = '';
    lastMoveEl = null;
  }, 2400);
}

/* human input */
boardEl.addEventListener('click', e => {
  if (mode !== 'human' || paused || game.over) return;
  const el = e.target.closest('.sq');
  if (!el) return;
  const s = squares.find(x => x.el === el);
  const sqName = 'abcdefgh'[s.c] + (8 - s.r);
  if (humanSel) {
    const mv = humanSel.moves.find(m => m.to === sqName);
    if (mv) {
      trainer.recordHumanMove(game, mv);
      totalPlies++;
      renderBoard(game.chess);
      markLast(mv);
      addMoveText(mv.san, mv.color === 'w', 'you');
      playMoveSound(mv, null);
      clearTargets(); humanSel = null;
      flyTimer = 0.55;
      if (game.over) endHumanGame();
      return;
    }
  }
  const pc = el._move;
  if (pc && pc.color === 'w') showTargets(sqName);
  else { clearTargets(); humanSel = null; }
});

/* ---------------- regions / silence ---------------- */
const REGIONS = [
  { id: 'optic', name: 'Optic neuropil', sub: 'sensory inputs', color: '#ffe0a0', frac: 0.6 },
  { id: 'lobula', name: 'Lobula complex', sub: '256 neurons - k=20', color: '#6bffb0', frac: 0.6 },
  { id: 'mb', name: 'Mushroom body', sub: '128 neurons - judgment', color: '#ff5540', frac: 0.6 },
  { id: 'cc', name: 'Central complex', sub: '64 - action selection', color: '#ffcf5f', frac: 1 }
];
(function buildRegions() {
  const wrap = $('regions');
  for (const r of REGIONS) {
    const div = document.createElement('div');
    div.className = 'region';
    div.innerHTML =
      '<span class="dot" style="color:' + r.color + ';background:' + r.color + '"></span>' +
      '<div class="meta">' + r.name + '<small>' + r.sub + '</small></div>';
    const btn = document.createElement('button');
    btn.className = 'silence-btn';
    btn.textContent = 'SILENCE';
    btn.onclick = () => {
      const on = btn.classList.toggle('on');
      trainer.brain.setSilence(r.id, on ? r.frac : 0);
      FG.sound.play(on ? 'zapOn' : 'zapOff');
      if (on) banner('silencing ' + r.name.toLowerCase() + '... watch the play degrade', true);
    };
    div.appendChild(btn);
    wrap.appendChild(div);
  }
})();

/* ---------------- controls ---------------- */
function setMode(m) {
  mode = m;
  for (const id of ['replay', 'turbo', 'human']) $('mode-' + id).classList.toggle('active', id === m);
  $('human-hint').classList.toggle('hide', m !== 'human');
  game = trainer.beginGame();
  show = trainer.beginGame();
  acc = 0; showAcc = 0;
  renderBoard(game.chess);
  movesEl.innerHTML = '';
  humanSel = null; lastMoveEl = null; clearTargets();
  if (m === 'human') {
    const b = trainer.brain;
    for (const r of REGIONS) b.setSilence(r.id, 0);
    document.querySelectorAll('.silence-btn').forEach(el => el.classList.remove('on'));
  }
}
$('mode-replay').onclick = () => setMode('replay');
$('mode-turbo').onclick = () => setMode('turbo');
$('mode-human').onclick = () => setMode('human');
$('speed').oninput = e => speed = +e.target.value;
$('btn-sound').onclick = () => {
  const on = FG.sound.toggle();
  $('btn-sound').textContent = on ? 'SOUND ON' : 'SOUND OFF';
  $('btn-sound').classList.toggle('active', on);
};
function playMoveSound(mv, status) {
  if (status && status.startsWith('checkmate')) { FG.sound.play('mate', mv.color === 'w' ? 1 : 0); return; }
  if (mv.san.indexOf('#') >= 0) { FG.sound.play('mate', 1); return; }
  if (mv.san.indexOf('+') >= 0) FG.sound.play('check');
  else if (mv.captured) FG.sound.play('capture', mv.piece);
  else FG.sound.play('move', mv.piece);
}
$('btn-pause').onclick = togglePause;
$('btn-reset').onclick = () => {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(LEGACY_KEY);
  trainer.gamesPlayed = 0; totalPlies = 0;
  trainer.captureRates.length = 0; trainer.returns.length = 0;
  trainer.accVsGreedy = 0; trainer._nAcc = 0;
  trainer.brain = new FG.FlyBrain();
  FG._demoBrain = trainer.brain;
  gamesAtSave = 0; lastSaveMs = 0;
  chart.a.length = 0; chart.b.length = 0;
  disposeViz();
  viz = new FG.BrainViz(sceneEl);
  window.FG._lastViz = viz;
  setMode('replay');
  banner('a fresh fly brain. it knows nothing about chess. yet');
};
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && !/^(BUTTON|INPUT)$/.test(e.target.tagName)) { e.preventDefault(); togglePause(); }
});
function togglePause() {
  paused = !paused;
  $('btn-pause').textContent = paused ? 'RESUME' : 'PAUSE';
}
function disposeViz() {
  try {
    viz.renderer.dispose();
    if (viz.renderer.domElement.parentNode) viz.renderer.domElement.parentNode.innerHTML = '';
  } catch (e) {}
}

/* ---------------- persistence ---------------- */
function autosave() {
  const nowMs = performance.now();
  if (trainer.gamesPlayed - gamesAtSave < 8 && nowMs - lastSaveMs < 30000) return;
  if (nowMs - lastSaveMs < 5000) return;
  gamesAtSave = trainer.gamesPlayed;
  lastSaveMs = nowMs;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, brain: trainer.brain.save(), g: trainer.gamesPlayed,
      tp: totalPlies, acc: trainer.accVsGreedy, n: trainer._nAcc
    }));
    $('save-note').classList.add('flash');
    setTimeout(() => $('save-note').classList.remove('flash'), 600);
  } catch (e) {}
}
function restore() {
  try {
    const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1) return;
    trainer.brain.load(d.brain);
    trainer.gamesPlayed = d.g || 0;
    trainer.accVsGreedy = d.acc || 0;
    trainer._nAcc = d.n || 0;
    totalPlies = d.tp || 0;
    gamesAtSave = trainer.gamesPlayed;
    setTimeout(() => banner('memory restored: ' + (d.g || 0) + ' games of practice'), 700);
  } catch (e) {}
}

/* ---------------- telemetry ---------------- */
const SIZE = FG.FlyBrain.SIZE;
const NEURONS = SIZE.optic + SIZE.lobula + SIZE.mb + SIZE.cc;
$('st-neurons').textContent = NEURONS.toLocaleString();
$('st-syn').textContent = FG.FlyBrain.SYNAPSES.toLocaleString();
let statTimer = 0;
function updateStats() {
  $('st-games').textContent = trainer.gamesPlayed.toLocaleString();
  $('st-plies').textContent = totalPlies.toLocaleString();
  const cr = trainer.captureRates;
  const mean = cr.length ? cr.slice(-40).reduce((a, x) => a + x, 0) / Math.min(40, cr.length) : 0;
  $('st-caps').textContent = Math.round(mean * 100) + '%';
  $('st-acc').textContent = Math.round(trainer.accVsGreedy * 100) + '%';
  $('st-ent').textContent = lastEntropy == null ? '-' : lastEntropy.toFixed(2);
  $('st-gps').textContent = mode === 'turbo' ? gpsShown : '-';
  $('conf-fill').style.width = Math.round(lastConf * 100) + '%';
  // region activity dots
  const b = trainer.brain;
  const dots = document.querySelectorAll('.region .dot');
  const norm = m => m / (m + 0.5);
  const acts = [
    Math.min(1, meanAct(b.optic) * 14),
    norm(meanAct(b.h1)), norm(meanAct(b.h2)),
    b.silence.cc > 0 ? 0 : 0.45
  ];
  dots.forEach((d, i) => { d.style.opacity = 0.25 + acts[i] * 0.75; });
}
function meanAct(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

/* ---------------- main loop ---------------- */
renderBoard(game.chess);
let prev = performance.now() / 1000;
function loop() {
  const now = performance.now() / 1000;
  let dt = Math.min(0.1, now - prev);
  prev = now;

  if (!paused) {
    if (mode === 'replay') {
      const interval = 1.7 - speed * 0.16;
      acc += dt;
      while (acc >= interval) { acc -= interval; stepVisible(game, 1.0); }
    } else if (mode === 'turbo') {
      // train at full speed invisibly (game) while the visible board shows
      // a single showcase game (show) at a watchable pace
      const deadline = performance.now() + 4 + speed * 0.9;
      let guard = 0;
      while (performance.now() < deadline && guard++ < 3000) {
        const info = trainer.stepGame(game, 1.0);
        if (!info) restart(game);
        else totalPlies++;
      }
      const interval = 1.4 - speed * 0.11; // ~0.3-1.3s per showcase move
      showAcc += dt;
      while (showAcc >= interval) { showAcc -= interval; stepVisible(show, 1.0); }
    } else if (mode === 'human') {
      if (flyTimer > 0) {
        flyTimer -= dt;
        if (flyTimer <= 0 && !game.over) flyMove();
      }
    }
  }

  statTimer += dt;
  if (statTimer > 0.25) { statTimer = 0; updateStats(); chart.draw(); }
  viz.render(dt, now);
  requestAnimationFrame(loop);
}
/* games/sec tracking */
let gamesAtGps = 0;
setInterval(() => {
  if (mode === 'turbo') {
    gpsShown = trainer.gamesPlayed - gamesAtGps;
    gamesAtGps = trainer.gamesPlayed;
  }
}, 1000);
loop();
