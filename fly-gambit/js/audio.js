/*
 * FlyGambit - audio.js
 * Procedural WebAudio sound (no asset files): synaptic blips on moves,
 * thumps on captures, arpeggios on checkmate, zaps on brain lesions.
 * Silent until the user toggles sound ON (browser autoplay policy).
 */
(function (global) {
  'use strict';

  var ctx = null, master = null, enabled = false;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }

  function tone(freq, t0, dur, type, vol, freqEnd) {
    if (!ctx) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol == null ? 0.18 : vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noiseHit(t0, dur, vol, freq) {
    if (!ctx) return;
    var n = ctx.createBufferSource();
    var len = ctx.sampleRate * dur;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    n.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq || 900;
    var g = ctx.createGain(); g.gain.value = vol == null ? 0.3 : vol;
    n.connect(f); f.connect(g); g.connect(master);
    n.start(t0);
  }

  var PIECE_FREQ = { p: 440, n: 520, b: 600, r: 680, q: 780, k: 340 };

  var SOUNDS = {
    move: function (piece) {
      var t = ctx.currentTime;
      tone(PIECE_FREQ[piece] || 460, t, 0.09, 'triangle', 0.10);
      tone((PIECE_FREQ[piece] || 460) * 2, t, 0.05, 'sine', 0.035);
    },
    capture: function (piece) {
      var t = ctx.currentTime;
      noiseHit(t, 0.12, 0.32, 700);
      tone((PIECE_FREQ[piece] || 460) * 1.5, t, 0.14, 'square', 0.06, 180);
    },
    check: function () {
      var t = ctx.currentTime;
      tone(880, t, 0.1, 'triangle', 0.12);
      tone(1174, t + 0.09, 0.14, 'triangle', 0.12);
    },
    mate: function (win) {
      var t = ctx.currentTime, s = win ? [523, 659, 784, 1046] : [523, 466, 392, 311];
      for (var i = 0; i < s.length; i++) tone(s[i], t + i * 0.11, 0.3, 'triangle', 0.13);
    },
    newgame: function () {
      var t = ctx.currentTime;
      tone(392, t, 0.07, 'sine', 0.05);
      tone(523, t + 0.05, 0.09, 'sine', 0.05);
    },
    zapOn: function () {
      var t = ctx.currentTime;
      tone(900, t, 0.28, 'sawtooth', 0.09, 90);
      noiseHit(t, 0.1, 0.2, 2400);
    },
    zapOff: function () {
      var t = ctx.currentTime;
      tone(120, t, 0.22, 'sawtooth', 0.07, 900);
    }
  };

  function play(name, arg) {
    if (!enabled) return;
    ensure();
    if (!ctx) return;
    var f = SOUNDS[name];
    if (f) { try { f(arg); } catch (e) {} }
  }

  global.FG = global.FG || {};
  global.FG.sound = {
    play: play,
    toggle: function () {
      enabled = !enabled;
      if (enabled) { ensure(); play('newgame'); }
      return enabled;
    },
    isOn: function () { return enabled; }
  };
})(window);
