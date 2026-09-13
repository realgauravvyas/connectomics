/*
 * FlySprint - audio.js : procedural WebAudio (starter pistol, footsteps,
 * hurdle blips, stumble thuds, crowd swell, finish fanfare). No files.
 */
(function (global) {
  'use strict';
  var ctx = null, master = null, enabled = false, crowdGain = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    // crowd bed: looping filtered noise, gain 0 until race
    var len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var n = ctx.createBufferSource(); n.buffer = buf; n.loop = true;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6;
    crowdGain = ctx.createGain(); crowdGain.gain.value = 0;
    n.connect(f); f.connect(crowdGain); crowdGain.connect(master); n.start();
  }
  function tone(freq, t0, dur, type, vol, freqEnd) {
    if (!ctx) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol == null ? 0.16 : vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(t0, dur, vol, freq, type) {
    if (!ctx) return;
    var n = ctx.createBufferSource(), len = Math.ceil(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.7);
    n.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq || 800;
    var g = ctx.createGain(); g.gain.value = vol == null ? 0.3 : vol;
    n.connect(f); f.connect(g); g.connect(master); n.start(t0);
  }
  var SOUNDS = {
    gun: function () { var t = ctx.currentTime; noise(t, 0.22, 0.6, 1600); tone(160, t, 0.12, 'square', 0.25, 60); },
    step: function (lane) { var t = ctx.currentTime; tone(90 + lane * 14, t, 0.035, 'triangle', 0.05); },
    hurdle: function () { var t = ctx.currentTime; tone(700, t, 0.08, 'sine', 0.08, 1200); },
    stumble: function () { var t = ctx.currentTime; noise(t, 0.25, 0.5, 300); tone(110, t, 0.3, 'sawtooth', 0.14, 40); },
    finish: function () { var t = ctx.currentTime; noise(t, 0.12, 0.35, 4000, 'highpass'); tone(1568, t, 0.25, 'triangle', 0.16); },
    win: function (lane) {
      var t = ctx.currentTime, s = [523, 659, 784, 1046];
      for (var i = 0; i < s.length; i++) tone(s[i] * (1 + lane * 0.02), t + i * 0.1, 0.34, 'triangle', 0.13);
    },
    zap: function (on) {
      var t = ctx.currentTime;
      if (on) tone(900, t, 0.2, 'sawtooth', 0.07, 120); else tone(140, t, 0.18, 'sawtooth', 0.06, 900);
    }
  };
  function play(name, arg) {
    if (!enabled) return;
    ensure(); if (!ctx) return;
    var f = SOUNDS[name]; if (f) { try { f(arg); } catch (e) {} }
  }
  function crowd(level) {
    if (!ctx || !crowdGain) return;
    crowdGain.gain.setTargetAtTime(enabled ? level * 0.05 : 0, ctx.currentTime, 0.6);
  }
  global.FG = global.FG || {};
  global.FG.sound = {
    play: play, crowd: crowd,
    toggle: function () { enabled = !enabled; if (enabled) { ensure(); play('hurdle'); } return enabled; },
    isOn: function () { return enabled; }
  };
})(window);
