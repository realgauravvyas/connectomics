# ONEIRO · Sleep‑Replay Maze Observatory

**Synthetic educational model** — A deterministic hippocampal‑cortical network that learns a 1‑D maze trajectory via a simple Hebbian rule, then exhibits sharp‑wave ripple (SWR)‑like events during offline rest intervals. The entire simulation runs client‑side in your browser with zero backend, zero build steps, and zero runtime dependencies.

---

## Concept

The model contains `20` place‑field tuned neurons and a 1‑D maze of `100` positions. On each simulation step a position is deterministically advanced (with small jitter). Two populations record activity:

- **Hippocampal** (place‑field tuned) — drives SWR event detection.
- **Cortical** (identical place‑field tuning) — the synaptic target of Hebbian learning.

A tiny Hebbian update (`Δw ∝ pre × post`) potentiates cortical weights active during high hippocampal firing. Over time, the weight matrix encodes the traversed trajectory. A synthetic sharp‑wave ripple (SWR) event is flagged when a seeded random draw falls below a fixed probability while total hippocampal activity exceeds a calibrated synthetic threshold.

Because the system is fully reseeding‑deterministic, the same seed always produces the same SWR events and weight evolution. Replay speed only changes plot compression; it does not change the underlying simulation.

---

## Quick Start

```bash
# from the connectomics repo root
cd oneiro

# start a local HTTP server (Python 3 built‑in)
python -m http.server 8000

# open
open http://localhost:8000
```

Or drag `index.html` into any modern browser.

---

## Controls

| Control | Description |
|---|---|
| **Seed** | Integer ≥ 0. Fixes the deterministic random weights, place fields, and position walk. Use the same number to reproduce an experiment. |
| **Replay Speed** | Controls plot compression only: `1x` shows the latest 80 steps, `5x` samples the latest 200 steps, and `20x` samples all 300 steps. |
| **Run Experiment** | Launches a 300‑step simulation, flags SWR events, updates synaptic weights, and renders two panels. |

---

## Outputs

- **Left panel (heat map)**: Hippocampal activity normalized within the displayed window; brighter cells mean stronger relative firing. Gold ticks mark SWR events.
- **Right panel (synaptic plot)**: Accumulated Hebbian potentiation over 300 steps, showing the gradual learning curve.
- **Telemetry panel** below the plot shows:
  - Seed number
  - Number of detected SWR events
  - Mean synaptic strength (`|W|`) as a concise quantitative read‑out
  - Selected replay speed
- **Debug API**: after the page loads, `window.ONEIRO.runExperiment(seed)` reruns the same UI path, and `window.ONEIRO.getSWRCount()` returns the latest event count.

---

## Limitations & Scientific Scope

- **Not biological**: This is a synthetic, minimal spiking‑rate model designed for education and experimentation. Place‑field tuning is Gaussian; SWR detection is a simple amplitude threshold; Hebbian learning is a single‑step potentiation rule.
- **No real data**: Does not use or claim connection to actual electrophysiology datasets, maze‑learning experiments, or the FlyEM/HHMI Janelia connectomics datasets.
- **SWR model is synthetic**: The ripple event detection is a threshold on summed place‑field activity; real sharp‑wave ripples involve complex circuitry, population bursts, and thalamic modulation.
- **Learning is incremental**: The weight evolution is monotonic (potentiation only) with a very small learning rate (`0.001`). Real cortical‑hippocampal plasticity involves depression, metaplasticity, and structural changes.

---

## Reproducibility

Every experiment is completely reproducible given the same seed and speed. To cite or share a result:

1. Note the **Seed** value.
2. Record the **Replay Speed**.
3. The SWR event timestamps, weight evolution, and heat‑map colours are deterministic functions of (seed, speed).

The source code (`sim.js`, `engine.js`, `main.js`) is pure JavaScript — no npm packages, no build step. Copy the `oneiro/` directory anywhere and it will run offline.

---

## Files in this directory

| File | Purpose |
|---|---|
| `index.html` | Page structure, hero, controls, two‑panel canvas, telemetry |
| `style.css` | Suite-aligned dark portal styling with an emerald/cyan accent |
| `sim.js` | Deterministic, DOM-free replay core used by both the page and tests |
| `engine.js` | Browser rendering, controls, telemetry, and debug state |
| `main.js` | Entrypoint, UI wiring, global debug API |
| `test/smoke.mjs` | Determinism, event-range, monotonic-learning, and validation checks |
| `README.md` | This file |

---

## Running the verification suite (connectomics-wide)

From the repository root:

```bash
npm test
```

This runs `test-all.mjs`, including ONEIRO’s deterministic replay checks:

```bash
cd oneiro && node test/smoke.mjs && cd ..
```