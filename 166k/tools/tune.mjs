/**
 * tune.mjs — grid search for spontaneous dynamics.
 * We want the unstimulated network to idle at 0.5–6 Hz (a fly brain is never
 * silent, but it is also never seizing), and to produce visible avalanches.
 *
 *   node tools/tune.mjs
 */
import { buildConnectome } from '../js/connectome.js';
import { Simulation } from '../js/sim.js';

const N = Number(process.env.N || 20000);
const conn = buildConnectome({ neurons: N, synapsesPerNeuron: 14 });
console.log(`tuning on ${conn.n} neurons / ${conn.E} synapses\n`);
console.log('  gain   drive  kick    meanHz   maxHz   hottest  verdict');

const gains = [0.20, 0.22, 0.24, 0.26, 0.28, 0.32];
const drives = [0.030];
const kicks = [1.25];

for (const gain of gains) {
  for (const drive of drives) {
    for (const kickAmp of kicks) {
      const sim = new Simulation(conn, { gain, drive, kickAmp });
      // 1 s settle
      for (let s = 0; s < 1000; s++) { sim.step(); if (s % 16 === 0) sim.updateRates(16, 16); }
      // 1 s measure
      let spikes = 0;
      for (let s = 0; s < 1000; s++) { spikes += sim.step(); if (s % 16 === 0) sim.updateRates(16, 16); }
      const hz = spikes / conn.n;
      const maxHz = Math.max(...sim.regionRate);
      const hot = conn.regions[sim.regionRate.indexOf(maxHz)].uid;
      let verdict = 'quiet';
      if (hz > 60) verdict = 'SEIZING';
      else if (hz > 15) verdict = 'too hot';
      else if (hz >= 0.4) verdict = 'GOOD';
      console.log(`  ${gain.toFixed(2)}   ${drive.toFixed(3)}  ${kickAmp.toFixed(2)}   ${hz.toFixed(2).padStart(7)}  ${maxHz.toFixed(1).padStart(6)}   ${hot.padEnd(7)} ${verdict}`);
    }
  }
}
console.log('');
