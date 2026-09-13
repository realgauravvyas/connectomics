/*
 * FlyGambit - chessai.js
 * Teaches the fly-brain connectome to play chess via self-play REINFORCE
 * with a learned value baseline and material-capture shaping.
 * Expects chess.js (global `Chess`) and connectome.js (global `FG`).
 * No DOM - Node-testable.
 */
(function (global) {
  'use strict';

  var PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  var CODE = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };
  var GAMMA = 0.97;
  var MAX_PLIES = 120;

  function sqIndex(s) {
    return (8 - parseInt(s[1], 10)) * 8 + 'abcdefgh'.indexOf(s[0]);
  }

  /* 773-dim sensory state: 12 piece-planes x 64 squares + turn + castling. */
  function encodeState(chess) {
    var s = new Float32Array(FG.FlyBrain.SIZE.STATE_DIM);
    var board = chess.board();
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (!p) continue;
        var plane = (p.color === 'w' ? 0 : 6) + CODE[p.type];
        s[plane * 64 + r * 8 + c] = 1;
      }
    }
    s[768] = chess.turn() === 'w' ? 1 : 0;
    var cast = chess.fen().split(' ')[2] || '-';
    s[769] = cast.indexOf('K') >= 0 ? 1 : 0;
    s[770] = cast.indexOf('Q') >= 0 ? 1 : 0;
    s[771] = cast.indexOf('k') >= 0 ? 1 : 0;
    s[772] = cast.indexOf('q') >= 0 ? 1 : 0;
    return s;
  }

  /* 132-dim action encoding per legal move. */
  function encodeMoves(chess) {
    var moves = chess.moves({ verbose: true });
    var feats = [];
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var a = new Float32Array(FG.FlyBrain.SIZE.ACT_DIM);
      a[sqIndex(m.from)] = 1;
      var toSq = m.to;
      if (m.flags.indexOf('e') >= 0) {
        toSq = m.to[0] + String(parseInt(m.to[1], 10) + (m.color === 'w' ? -1 : 1));
      }
      a[64 + sqIndex(toSq)] = 1;
      if (m.promotion) a[128] = 1;
      if (m.captured || m.flags.indexOf('e') >= 0) a[129] = 1;
      if (m.flags.indexOf('k') >= 0 || m.flags.indexOf('q') >= 0) a[130] = 1;
      if (m.san && m.san.indexOf('+') >= 0) a[131] = 1;
      feats.push(a);
    }
    return { moves: moves, feats: feats };
  }

  /* Baseline bot: grab the most valuable piece. */
  function greedyPick(chess) {
    var enc = encodeMoves(chess);
    var bi = 0, bv = -1;
    for (var i = 0; i < enc.moves.length; i++) {
      var m = enc.moves[i];
      var v = m.captured ? PIECE_VAL[m.captured] : 0;
      if (m.san.indexOf('#') >= 0) v += 100;
      if (v > bv || (v === bv && Math.random() < 0.5)) { bv = v; bi = i; }
    }
    return enc.moves[bi];
  }

  function cloneVec(v) { return v.slice(0); }

  /* ---------------- Trainer ---------------- */
  function FlyTrainer() {
    this.brain = new FG.FlyBrain();
    this.gamesPlayed = 0;
    this.captureRates = [];   // rolling, one per game
    this.returns = [];        // mean |return| magnitude per game (learning signal)
    this.accVsGreedy = 0;     // policy agreement with greedy baseline, rolling
    this._nAcc = 0;
  }

  FlyTrainer.prototype.beginGame = function () {
    return { chess: new global.Chess(), plies: [], over: false };
  };

  /* Play one ply inside an open game. Returns info for the UI. */
  FlyTrainer.prototype.stepGame = function (game, temp) {
    var chess = game.chess, brain = this.brain;
    if (game.over || chess.isGameOver() || game.plies.length >= MAX_PLIES) {
      game.over = true;
      return null;
    }
    var state = encodeState(chess);
    var enc = encodeMoves(chess);
    var V = brain.forwardState(state);
    var sc = brain.scoreMoves(enc.feats, temp);
    var idx = FG.sampleIndex(sc.probs);
    var mv = enc.moves[idx];
    game.plies.push({
      idx: idx, probs: sc.probs, caches: sc.caches, feats: enc.feats,
      h2: cloneVec(brain.h2), vZ: cloneVec(brain.vZ), vH: cloneVec(brain.vH),
      h1: cloneVec(brain.h1), z1: cloneVec(brain.z1), z2: cloneVec(brain.z2),
      optic: cloneVec(brain.optic),
      V: V, temp: temp, nMoves: enc.feats.length,
      mover: mv.color, captured: mv.captured ? PIECE_VAL[mv.captured] : 0
    });
    // agreement stat vs greedy baseline (sampled: keeps turbo mode fast)
    if (Math.random() < 0.15) {
      var g = greedyPick(chess);
      var agree = g && mv.from === g.from && mv.to === g.to && (mv.promotion || '') === (g.promotion || '');
      this.accVsGreedy = (this.accVsGreedy * this._nAcc + (agree ? 1 : 0)) / (this._nAcc + 1);
      this._nAcc = Math.min(this._nAcc + 1, 300);
    }
    chess.move(mv);
    if (chess.isGameOver() || game.plies.length >= MAX_PLIES) game.over = true;
    var lastPl = game.plies[game.plies.length - 1];
    return {
      move: mv, san: mv.san, idx: idx, nMoves: enc.moves.length,
      probs: sc.probs, entropy: FG.entropy(sc.probs), V: V,
      viz: {
        optic: lastPl.optic, h1: lastPl.h1, h2: lastPl.h2,
        ccH: lastPl.caches[idx] ? lastPl.caches[idx].ccH : null
      },
      board: chess.board(), turn: chess.turn(), over: game.over,
      gameOver: chess.isGameOver(), status: this.gameStatus(chess)
    };
  };

  /* Record a human move into an open training game so the fly can learn
   * from playing against you (only the fly's own plies get policy grads). */
  FlyTrainer.prototype.recordHumanMove = function (game, mvObj) {
    game.chess.move(mvObj);
    game.plies.push({ lite: true, mover: mvObj.color,
      captured: mvObj.captured ? PIECE_VAL[mvObj.captured] : 0 });
    if (game.chess.isGameOver() || game.plies.length >= MAX_PLIES) game.over = true;
  };

  FlyTrainer.prototype.gameStatus = function (chess) {
    if (chess.isCheckmate()) return 'checkmate:' + (chess.turn() === 'w' ? 'b' : 'w');
    if (chess.isStalemate()) return 'stalemate';
    if (chess.isInsufficientMaterial()) return 'draw';
    if (chess.isThreefoldRepetition()) return 'draw';
    if (chess.isDraw()) return 'draw';
    return 'ongoing';
  };

  /* Finish game: backprop discounted returns through the trajectory. */
  FlyTrainer.prototype.finishGame = function (game) {
    var chess = game.chess, brain = this.brain;
    var plies = game.plies;
    if (!plies.length) return null;

    var terminal = 0, winner = null;
    if (chess.isCheckmate()) { terminal = 1; winner = chess.turn() === 'w' ? 'b' : 'w'; }
    else if (chess.isGameOver()) { terminal = 0.5; }

    var returns = new Array(plies.length);
    var acc = 0;
    for (var t = plies.length - 1; t >= 0; t--) {
      var p = plies[t];
      var r = 0.15 * p.captured;
      if (t === plies.length - 1 && terminal === 1) r += (p.mover === winner ? 1 : -1);
      acc = r + GAMMA * acc;
      returns[t] = acc;
    }

    brain.zeroGrads();
    var dLdh2 = new Float32Array(FG.FlyBrain.SIZE.mb);
    for (var u = 0; u < plies.length; u++) {
      var pl = plies[u];
      if (pl.lite) continue;
      var adv = Math.max(-4, Math.min(4, returns[u] - pl.V));
      var nm = pl.nMoves;
      var dScores = new Float32Array(nm);
      for (var j = 0; j < nm; j++) {
        dScores[j] = (pl.probs[j] - (j === pl.idx ? 1 : 0)) * adv / pl.temp;
      }
      dLdh2.fill(0);
      brain.backwardMove(pl.caches, pl.feats, dScores, dLdh2, pl.h2);
      brain.backwardValue(returns[u], pl.h2, pl.vZ, pl.vH, pl.V, dLdh2);
      brain.backpropTrunk(pl, dLdh2);
    }
    brain.stepAdam();

    this.gamesPlayed++;
    var caps = 0;
    for (var q = 0; q < plies.length; q++) caps += plies[q].captured > 0 ? 1 : 0;
    this.captureRates.push(caps / plies.length);
    if (this.captureRates.length > 250) this.captureRates.shift();
    this.returns.push(Math.abs(acc));
    if (this.returns.length > 250) this.returns.shift();
    return {
      moves: plies.length, winner: winner || 'draw', terminal: terminal,
      captureRate: caps / plies.length
    };
  };

  /* Fly plays one move greedily (low temperature). For human games. */
  FlyTrainer.prototype.pickMoveGreedy = function (chess) {
    var state = encodeState(chess);
    this.brain.forwardState(state);
    var enc = encodeMoves(chess);
    var sc = brainScores(this.brain, enc.feats);
    var mv = enc.moves[sc.best];
    return { move: mv, all: enc.moves, probs: sc.probs, best: sc.best, entropy: FG.entropy(sc.probs) };
  };
  function brainScores(brain, feats) {
    var sc = brain.scoreMoves(feats, 0.3);
    return { probs: sc.probs, best: FG.argmaxIndex(sc.scores), scores: sc.scores };
  }

  /* Evaluate: fly (sampled low-temp) vs greedy-capture bot. No learning. */
  FlyTrainer.prototype.evalVsGreedy = function (nGames) {
    nGames = nGames || 6;
    var wins = 0;
    for (var g = 0; g < nGames; g++) {
      var chess = new global.Chess();
      var flyWhite = g % 2 === 0;
      var plies = 0;
      while (!chess.isGameOver() && plies < 100) {
        var isFly = (chess.turn() === 'w') === flyWhite;
        var mv;
        if (isFly) {
          var enc = encodeMoves(chess);
          var st = encodeState(chess);
          this.brain.forwardState(st);
          var sc = this.brain.scoreMoves(enc.feats, 0.2);
          mv = enc.moves[FG.argmaxIndex(sc.scores)];
        } else {
          mv = greedyPick(chess);
        }
        chess.move(mv);
        plies++;
      }
      if (chess.isCheckmate()) {
        var winner = chess.turn() === 'w' ? 'b' : 'w';
        if ((winner === 'w') === flyWhite) wins++;
      } else if (!chess.isDraw()) {
        wins += 0.5;
      }
    }
    return wins / nGames;
  };

  global.FG = global.FG || {};
  global.FG.FlyTrainer = FlyTrainer;
  global.FG.encodeState = encodeState;
  global.FG.encodeMoves = encodeMoves;
  global.FG.greedyPick = greedyPick;
  global.FG.sqIndex = sqIndex;
  global.FG.PIECE_VAL = PIECE_VAL;
})(typeof window !== 'undefined' ? window : globalThis);
