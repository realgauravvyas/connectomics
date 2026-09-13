// where does the time actually go?
import { buildConnectome } from '../js/connectome.js';
import { Simulation } from '../js/sim.js';

const N = Number(process.env.N || 30000);
const conn = buildConnectome({ neurons: N, synapsesPerNeuron: 14 });
const mk = () => new Simulation(conn);

function time(label, fn, steps = 1000) {
  const sim = mk();
  // warm the JIT
  for (let s = 0; s < 300; s++) { sim.step(); sim.plasticityStep(); }
  const t = Date.now();
  fn(sim, steps);
  const ms = Date.now() - t;
  console.log(`  ${label.padEnd(34)} ${String(ms).padStart(6)} ms   ${(ms / steps).toFixed(3)} ms/step`);
}

console.log(`\n${conn.n} neurons, ${conn.E} synapses, ${conn.plasticEdges.length} plastic\n`);

time('step() only', (sim, s) => { for (let i = 0; i < s; i++) sim.step(); });
time('step() + plasticity every 2', (sim, s) => {
  for (let i = 0; i < s; i++) { sim.step(); if ((i & 1) === 0) sim.plasticityStep(); }
});
time('step() + updateRates every 16', (sim, s) => {
  for (let i = 0; i < s; i++) { sim.step(); if (i % 16 === 0) sim.updateRates(16, 16); }
});

// isolate: step with dopamine disabled
const sim = mk();
for (let s = 0; s < 300; s++) sim.step();
const t = Date.now();
let spikes = 0;
for (let s = 0; s < 1000; s++) spikes += sim.step();
console.log(`\n  spikes in last 1000 steps: ${spikes}  (${(spikes / conn.n).toFixed(2)} Hz)`);
console.log(`  kcCount: ${sim.kcCount}   dopamine: ${sim.dopamine.toFixed(4)}`);
console.log(`  step-only again: ${Date.now() - t} ms\n`);
