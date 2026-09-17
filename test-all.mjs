/**
 * test-all.mjs — Unified verification suite for the CONNECTOMICS repository.
 * Runs the test suites across all 7 in-silico applications.
 */

import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pythonBin = process.env.PYTHON || (() => {
  for (const bin of [process.platform === 'win32' ? 'python' : 'python3', 'python', 'python3']) {
    try {
      const res = spawnSync(bin, ['--version'], { stdio: 'ignore' });
      if (res.status === 0) return bin;
    } catch {}
  }
  return 'python';
})();

const suites = [
  {
    name: '166k (Electrophysiology Analysis)',
    cwd: resolve(__dirname, '166k'),
    cmd: process.execPath,
    args: ['tools/analyze.mjs'],
  },
  {
    name: '166k (Headless WebGL & SNN Smoke)',
    cwd: resolve(__dirname, '166k'),
    cmd: process.execPath,
    args: ['tools/smoke.mjs'],
  },
  {
    name: 'MUSCA (9 Behavioral Reverse Circuits)',
    cwd: resolve(__dirname, 'musca'),
    cmd: pythonBin,
    args: ['tools/behaviours.py'],
  },
  {
    name: 'FlyGambit (100-Game Sparse RL Smoke)',
    cwd: resolve(__dirname, 'fly-gambit'),
    cmd: process.execPath,
    args: ['test/smoke.mjs'],
  },
  {
    name: 'FlySprint (Genetic Gait Locomotion & Hurdles)',
    cwd: resolve(__dirname, 'fly-sprint'),
    cmd: process.execPath,
    args: ['test/smoke.mjs'],
  },
  {
    name: 'FLYMIND (Mushroom Body Learning)',
    cwd: resolve(__dirname, 'flymind'),
    cmd: process.execPath,
    args: ['tools/test-mb.js'],
  },
  {
    name: 'FLYMIND (Sensory Cascades & Connectivity)',
    cwd: resolve(__dirname, 'flymind'),
    cmd: process.execPath,
    args: ['tools/test-cascade.js'],
  },
  {
    name: 'FLYMIND (Wiring Integration)',
    cwd: resolve(__dirname, 'flymind'),
    cmd: process.execPath,
    args: ['tools/test-integration.js'],
  },
  {
    name: 'FLYKICK (16-Check Match Engine & Telemetry)',
    cwd: resolve(__dirname, 'flykick'),
    cmd: process.execPath,
    args: ['tools/test-engine.js'],
  },
];

console.log('\n🪰⚡ CONNECTOMICS SUITE — Unified Automated Verification\n' + '='.repeat(60));

let passed = 0;
let failed = 0;
const results = [];

for (const suite of suites) {
  const start = Date.now();
  process.stdout.write(`  ⏳ ${suite.name} ... `);
  
  const res = spawnSync(suite.cmd, suite.args, {
    cwd: suite.cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: false,
  });

  const duration = ((Date.now() - start) / 1000).toFixed(2);
  const ok = res.status === 0;

  if (ok) {
    passed++;
    console.log(`\x1b[32mPASS\x1b[0m (${duration}s)`);
    results.push({ name: suite.name, status: 'PASS', duration });
  } else {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m (${duration}s)`);
    console.error('\n--- Failure Output ---');
    console.error(res.stdout || '');
    console.error(res.stderr || '');
    console.error('----------------------\n');
    results.push({ name: suite.name, status: 'FAIL', duration });
  }
}

console.log('='.repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${suites.length} suites.\n`);

if (failed > 0) {
  console.error('❌ Verification failed.\n');
  process.exit(1);
} else {
  console.log('✅ ALL CONNECTOMICS SIMULATORS & ENGINES VERIFIED SUCCESSFULLY.\n');
  process.exit(0);
}
