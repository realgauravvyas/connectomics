# ONEIRO · Sleep‑Replay Maze Observatory

**Synthetic educational model** — A deterministic hippocampal‑cortical network that learns a 1‑D maze trajectory via a simple Hebbian rule, then exhibits sharp‑wave ripple (SWR)‑like events during offline rest intervals. The entire simulation runs client‑side in your browser with zero backend, zero build steps, and zero runtime dependencies.

---

## Concept

The model contains `20` place‑field tuned neurons and a 1‑D maze of `100` positions. On each simulation step a position is deterministically advanced (with small jitter). Two populations record activity:

- **Hippocampal** (place‑field tuned) — drives SWR event detection.
- **Cortical** (identical place‑field tuning) — the synaptic target of Hebbian learning.

A tiny Hebbian update (`Δw ∝ pre × post`) potentiates cortical weights active during high hippocampal firing. Over time, the weight matrix encodes the traversed trajectory. Occasionally a sharp‑wave ripple (SWR) event is flagged when total hippocampal activity exceeds a threshold.

Because the system is fully reseeding‑deterministic, the same seed + speed always produces the same SWR events and weight evolution — making it a clean counterfactual “rest vs. no‑rest” experiment paradigm.

---

## Quick Start

```bash
# from the connectomics repo root
cd connectomics-work/oneiro

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
| **Replay Speed** | Controls the effective time‑scale of the replay visualisation: `1x` (real‑time), `5x` (accelerated, default), `20x` (fast). |
| **Run Experiment** | Launches a 300‑step simulation, flags SWR events, updates synaptic weights, and renders two panels. |

---

## Outputs

- **Left panel (heat map)**: Colour‑coded hippocampal population activity across the last ~80 steps. Brighter cells = higher firing at that position. This is where SWR events are detected (threshold > 3.0 aggregate activity).
- **Right panel (synaptic plot)**: Average synaptic weight magnitude `|W|` per step, showing the gradual Hebbian learning curve. The weight matrix itself encodes a “trace” of the maze trajectory.
- **Telemetry panel** below the plot shows:
  - Seed number
  - Number of detected SWR events
  - Mean synaptic strength (|W|) as a concise quantitative read‑out
  - Selected replay speed
- **Downloadable**: Right‑click the canvas → “Save experiment JSON” to persist seed, replay events, and the final weight matrix.

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

The source code (`engine.js`, `main.js`) is pure JavaScript — no npm packages, no build step. Copy the `oneiro/` directory anywhere and it will run offline.

---

## Files in this directory

| File | Purpose |
|---|---|
| `index.html` | Page structure, hero, controls, two‑panel canvas, telemetry |
| `style.css` | Dark‑neurophysics UI theming (emerald / cyan accent palette) |
| `engine.js` | Deterministic simulation core (place fields, SWR detection, Hebbian weight update, heat‑map & plot rendering) |
| `main.js` | Entrypoint, UI wiring, global debug API |
| `README.md` | This file |

---

## Running the verification suite (connectomics-wide)

From the repository root:

```bash
npm test
```

This runs `test-all.mjs` which verifies all sub‑projects. ONEIRO and CHRONOFLY are **not** yet included in the unified test suite; you can run lightweight syntax checks manually:

```bash
node --check oneiro/engine.js
node --check oneiro/main.js

node --check chronofly/engine.js
node --check chronofly/main.js
```