export function createAudio() {
  let ctx = null;
  let master = null;
  let buzzOsc = null;
  let buzzGain = null;
  let started = false;
  let on = true;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    master.connect(comp);
    comp.connect(ctx.destination);
    return true;
  }

  function start() {
    if (started || !ensure()) return;
    started = true;
    if (ctx.state === 'suspended') ctx.resume();
    buzzOsc = ctx.createOscillator();
    buzzOsc.type = 'sawtooth';
    buzzOsc.frequency.value = 190;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    buzzGain = ctx.createGain();
    buzzGain.gain.value = 0;
    buzzOsc.connect(filter);
    filter.connect(buzzGain);
    buzzGain.connect(master);
    buzzOsc.start();
  }

  function setBuzz(level, freq) {
    if (!ctx || !buzzGain || !on) return;
    const target = 0.02 + 0.06 * Math.min(1, Math.max(0, level));
    buzzGain.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
    buzzOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.3);
  }

  function blip(freq) {
    if (!ctx || !on) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + 0.05);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.13);
  }

  function toggle() {
    on = !on;
    if (ctx && buzzGain) buzzGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    return on;
  }

  return {
    start,
    setBuzz,
    blip,
    toggle,
    get on() {
      return on;
    },
    get started() {
      return started;
    }
  };
}
