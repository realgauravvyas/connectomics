# 166k 🪰⚡
### In-Silico Spiking Neural Network of the Complete Male Drosophila Central Nervous System

<p align="center">
  <a href="https://realgauravvyas.github.io/connectomics/166k/">
    <img src="https://img.shields.io/badge/🚀_LAUNCH_166k_SIMULATOR-realgauravvyas.github.io%2Fconnectomics%2F166k-00e5ff?style=for-the-badge&logo=google-chrome&logoColor=black" alt="Launch 166k Simulator" />
  </a>
  <a href="https://realgauravvyas.github.io/connectomics/">
    <img src="https://img.shields.io/badge/CONNECTOMICS_HUB-SUITE_HOME-00ff88?style=for-the-badge&logo=github&logoColor=white" alt="Connectomics Suite" />
  </a>
</p>

[![Neurons](https://img.shields.io/badge/Neurons-166%2C000-00e5ff)](https://realgauravvyas.github.io/connectomics/166k/)
[![Synapses](https://img.shields.io/badge/Synapses-2.3M-ff007f)](https://realgauravvyas.github.io/connectomics/166k/)
[![Connectome Milestone](https://img.shields.io/badge/Connectome-Cell%202026-00e5ff.svg)](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/)
[![WebGL](https://img.shields.io/badge/WebGL-60_FPS-00ff88.svg)](https://realgauravvyas.github.io/connectomics/166k/)
[![Dependencies](https://img.shields.io/badge/Dependencies-None-brightgreen)](https://realgauravvyas.github.io/connectomics/166k/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 🌐 **Experience the Live Simulation Online:**  
> 👉 **[https://realgauravvyas.github.io/connectomics/166k/](https://realgauravvyas.github.io/connectomics/166k/)**  
> *Grown and simulated client-side. Zero backend, zero precomputed datasets, zero dependencies.*

---

## 📸 Visual Showcase

<p align="center">
  <a href="https://realgauravvyas.github.io/connectomics/166k/">
    <img src="shot.png" alt="166k Spiking Connectome Simulation" width="100%" />
  </a>
</p>

<p align="center">
  <i>166,000 neurons rendered as additively blended glowing points. Color indicates anatomical neuropil region; brightness indicates decaying trace of recent action potentials. Firing synapses illuminate signal cascades in real time.</i>
</p>

---

## 🔬 What You Are Looking At

Two synchronized WebGL passes, additively blended on a dark background:

1. **Every neuron as a colored point:**
   - Color = anatomical brain region (Optic Lobes, Central Brain, Mushroom Body, Central Complex, VNC, P1 courtship clusters).
   - Brightness = decaying trace of recent membrane spikes. Regions that fire synchronously bloom together.
2. **Dynamic Synapse Lighting:**
   - Synapses active in the preceding ~25 ms render as short vectors, letting you watch action potentials travel between neuropils rather than just observing static endpoints illuminate. Toggle via the *Stimuli* panel.

### Biophysical Dynamics
- **Leaky Integrate-and-Fire (LIF):** Neurons accumulate current with membrane capacitance leakage, fire at threshold (-50 mV), and enter a 2 ms refractory period.
- **Axonal Conduction Delays:** Distances across brain regions impose realistic propagation latency.
- **E/I Balance:** Employs an authoritative ~4:1 excitatory-to-inhibitory population ratio with region-calibrated inhibitory fractions.

---

## 🎮 Interactive Controls & Behavioral Modes

| Tab | Functionality & Physiological Correlate |
|---|---|
| **behaviour** | Decodes motor-pool firing rates into observable actions: walking, turning, unilateral wing extension (courtship song), proboscis extension, and jumping. Includes real-time valence balance (approach vs. avoid). |
| **stimuli** | Injects sensory drives: odors, tastants, light, sound, and air puffs. Supports momentary pulse (400 ms) or sustained drive. Controls visual toggles (synapse lines, point size, auto-rotation). |
| **train** | Associative conditioning sandbox. Pair Odor A with PPL1 dopamine shock or PAM sugar reward to shift behavioral valence. Quantifies the percentage of Kenyon Cell $\rightarrow$ MBON plastic synapses rewritten. |
| **network** | Real-time per-region firing frequencies (Hz). Click to isolate any neuropil; click **◌** to induce a targeted micro-ablation / lesion. |

### Keyboard Shortcuts
- **`Space`**: Pause / Resume simulation
- **`1` – `9`**: Trigger sensory stimuli (odors, light, sound, grooming)
- **`0`**: Inject aversive PPL1 shock
- **`M`**: Measure memory plasticity shift
- **`R`**: Reset orbital camera

### URL Query Parameters
Share pre-configured neurological states via query parameters:
```
?stim=odorA      # Starts with Odor A cascade active
?stim=shock      # Continuous PPL1 shock (sustained elevated dopamine)
?n=60000         # Runs at 60,000 neurons for low-power mobile GPUs
?n=166000        # Default: Full 166,000 neuron central nervous system
```

---

## 🧪 In-Silico Lesion & Ablation Proof

Every region in the *Network* tab features a **◌** micro-ablation control: its efferent synaptic weights are zeroed, silencing its influence on downstream targets while keeping baseline cellular dynamics intact.

Running the automated benchmark (`npm run analyze`) tests the biological validity of the memory circuit:
```
ablation test (lesion mushroom body, then try to learn)
  with MB lesioned   bias -0.039 → 0.001 (shift +0.040)
  synapse change     0.00%  NO PLASTICITY ✓ (as expected)
  intact control     51.55% (weights actively adapt)
  lesioned/intact    0.00% vs 51.55% → LESION BLOCKS ASSOCIATIVE LEARNING ✓
```

---

## 💻 Quick Start & Verification

```bash
# Clone the repository
git clone https://github.com/realgauravvyas/connectomics.git
cd connectomics/166k

# Run headless verification test suite
node tools/analyze.mjs
node tools/smoke.mjs

# Launch local server
npm run serve
# → Open http://localhost:8080/
```

---

## 🌐 Complete Connectomics Ecosystem

166k is an integral engine in the [**CONNECTOMICS**](https://realgauravvyas.github.io/connectomics/) simulation suite:

- 🔬 **[MUSCA](https://realgauravvyas.github.io/connectomics/musca/):** 166,700 reconstructed neurons with 2.82M edges and reverse behavior search.
- 🌌 **[SYNAPTICA](https://realgauravvyas.github.io/connectomics/synaptica/):** 12 mapped neuropil hubs with real-time Hebbian plasticity tracking.
- ♟️ **[FlyGambit](https://realgauravvyas.github.io/connectomics/fly-gambit/):** Sparse *Drosophila* connectome learning chess with interactive mid-game brain lesioning.
- 🏃 **[FlySprint](https://realgauravvyas.github.io/connectomics/fly-sprint/):** 1–5 evolved flies with 94-weight neural gait controllers racing 100m–400m and hurdles.
- 🧠 **[FLYMIND](https://realgauravvyas.github.io/connectomics/flymind/):** Interactive connectome playground: poke senses, train mushroom body, explore 42 neuron classes.
- ⚽ **[FLYKICK](https://realgauravvyas.github.io/connectomics/flykick/):** 2 teams of neural flies play football with real-time Brain Cam and manual possession override.

---

## 📚 Scientific References

- **Google Research & HHMI Janelia**: *"Sexual dimorphism in the complete connectome of the Drosophila male central nervous system"*, **Cell** (September 2026).
- **Google Research Announcement**: [A connectomics milestone: Mapping the complete male fruit fly brain](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/).
- **HHMI Janelia MaleCNS**: [male-cns.janelia.org](https://male-cns.janelia.org/).

---

## 👤 Author & Research

**Gaurav Vyas**  
- 🌐 **Personal Website & Academic Profile:** [socialpsychology.org/member/gaurav-vyas](https://www.socialpsychology.org/member/gaurav-vyas)  
- 🔶 **Interactive Portfolio:** [realgauravvyas.github.io](https://realgauravvyas.github.io/)  
- 🐙 **GitHub:** [@realgauravvyas](https://github.com/realgauravvyas)  

---

## 📄 License

MIT License &copy; 2026 Gaurav Vyas. Open-source science under the MIT License.
