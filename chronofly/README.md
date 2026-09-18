# CHRONOFLY · Counterfactual Neural Twin Lab

**Synthetic educational model** — A deterministic, seeded recurrent neural circuit with two identical twin branches. One branch receives a targeted intervention (silencing, stimulation, or gain modulation) while the other serves as a true control under identical inputs. The entire simulation runs client-side in your browser with zero backend, zero build steps, and zero runtime dependencies.

---

## Concept

Two identical synthetic neural circuits (6 leaky-integrate-and-fire units with fixed random synaptic weights) are driven by identical external input currents. A single intervention axis is applied *only* to the second twin:

| Intervention | Effect |
|---|---|
| **none** | Identical twins — no divergence |
| **silence** | External current clamped to zero for the intervened twin |
| **stimulate** | +1.2 external current injected into the intervened twin |
| **modulate** | Gain multiplier ×1.5 on external current for the intervened twin |

Because the weights and initial conditions are seeded deterministically, the *only* source of divergence is the intervention. This makes it a clean counterfactual experiment: “what would happen if this neuron were silenced/stimulated, given everything else stays the same?”

---

## Quick Start

```bash
# from the connectomics repo root
cd chronofly

# start a local HTTP server (any will do; Python 3 is built-in)
python -m http.server 8000

# open
open http://localhost:8000
```

Or drag `index.html` into any modern browser (Chrome, Firefox, Safari, Edge).

---

## Controls

| Control | Description |
|---|---|
| **Seed** | Integer ≥ 0. Fixes the deterministic random weights and initial states. Use the same number to reproduce an experiment. |
| **Intervention** | Choose from: `none` (identical twins), `silence`, `stimulate`, or `modulate`. |
| **Run Experiment** | Launches a 200-step simulation and renders the voltage trace of neuron N4 for both twins, plus the mean‑squared divergence. Automatically starts the twin-flight replay. |
| **Play / Pause / Restart** | Controls the animated twin-flight replay (the simulation itself always runs to completion instantly). |
| **Sound** | Toggles the procedural wing-buzz and divergence blips. Audio starts on your first click (Run/Play/Sound), following browser autoplay rules. |

---

## Outputs

- **Trajectory plot**: Solid line = control (twin A), dashed line = intervened (twin B). Both share the same time axis and y‑scale.
- **3D twin-flight arena (WebGL)**: Two realistic 3D flies race down glowing lanes toward a pulsing odor plume. Their headings are steered step-by-step by their own N4 voltages, with additive trails and a live separation link, so the treated twin visibly peels away from the control as divergence grows. Wing-buzz pitch tracks twin separation. The camera drifts with the pack.
- **Telemetry panel** below the plot shows:
  - Seed number
  - Selected intervention
  - Mean‑squared error between the two voltage traces (a quantitative measure of divergence)
  - Mean voltage of neuron N4 for each twin
- **Debug API**: after the page loads, `window.CHRONOFLY.runExperiment(seed, intervention)` reruns the same UI path, and `window.CHRONOFLY.getDivergence()` returns the latest divergence.

---

## Limitations & Scientific Scope

- **Not biological**: This is a synthetic, minimal recurrent circuit designed for education and experimentation. Synaptic weights are randomly generated from a seed; neuron dynamics are a crude leaky‑integrate‑and‑fire approximation.
- **No EM data**: Does not use or claim connection to the FlyEM or Janelia connectomics datasets.
- **Interventions are synthetic**: Silencing/stimulating/modulating a single “neuron N4” is a conceptual device; there is no mapping to real fly-brain cell types.
- **Deterministic but simplified**: The system is fully deterministic given a seed, but real neural systems exhibit far richer stochastic and structural variability.

---

## Reproducibility

Every experiment is completely reproducible given the same seed and intervention. To cite or share a result:

1. Note the **Seed** value.
2. Record the **Intervention** selected.
3. The voltage traces are deterministic functions of (seed, intervention).

The source code (`sim.js`, `engine.js`, `main.js`) is pure JavaScript with no external npm packages. You can copy the `chronofly/` directory to another location and it will run offline.

---

## Files in this directory

| File | Purpose |
|---|---|
| `index.html` | Page structure, hero, controls, canvas, telemetry |
| `style.css` | Suite-aligned dark portal styling with a purple/pink accent |
| `sim.js` | Deterministic, DOM-free twin-simulation core (LIF dynamics, N4 flight-path mapping) used by both the page and tests |
| `fly3d.js` | 3D neon fly model (body, compound eyes, flapping wings, glow disc) plus trail helper |
| `vendor/three.min.js` | Vendored WebGL library, same approach as fly-sprint/fly-gambit — zero npm dependencies |
| `audio.js` | Procedural WebAudio wing-buzz and divergence blips — zero audio files |
| `engine.js` | Browser rendering, flight animation, controls, telemetry, and debug state |
| `main.js` | Entrypoint, UI wiring, global debug API |
| `test/smoke.mjs` | Determinism, intervention-effect, isolation, and validation checks |
| `README.md` | This file |

---

## Running the verification suite (connectomics-wide)

From the repository root:

```bash
npm test
```

This runs `test-all.mjs`, including CHRONOFLY’s deterministic twin checks:

```bash
cd chronofly && node test/smoke.mjs && cd ..
```