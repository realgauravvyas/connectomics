# CONNECTOMICS 🪰⚡
### In-Silico Drosophila Central Nervous System Simulation & Behavioral Mapping Suite

<p align="center">
  <a href="https://realgauravvyas.github.io/connectomics/">
    <img src="https://img.shields.io/badge/🚀_LAUNCH_CONNECTOMICS_PORTAL-realgauravvyas.github.io%2Fconnectomics-00e5ff?style=for-the-badge&logo=google-chrome&logoColor=black" alt="Launch Connectomics Suite" />
  </a>
  <a href="https://realgauravvyas.github.io/connectomics/">
    <img src="https://img.shields.io/badge/GitHub_Pages-LIVE-00ff88?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Pages Status" />
  </a>
</p>

[![Connectome Milestone](https://img.shields.io/badge/Connectome-Cell%202026-00e5ff.svg)](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/)
[![Total Neurons](https://img.shields.io/badge/Neurons-166%2C700-00e5ff)](https://realgauravvyas.github.io/connectomics/)
[![Total Synapses](https://img.shields.io/badge/Synapses-124M+-ff007f)](https://realgauravvyas.github.io/connectomics/)
[![WebGL](https://img.shields.io/badge/WebGL-60_FPS-00ff88.svg)](https://realgauravvyas.github.io/connectomics/)
[![Dependencies](https://img.shields.io/badge/Dependencies-None-brightgreen)](https://realgauravvyas.github.io/connectomics/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 🌐 **Experience the Complete Suite Live Online:**  
> 👉 **[https://realgauravvyas.github.io/connectomics/](https://realgauravvyas.github.io/connectomics/)**  
> *Four interconnected neuro-computational paradigms running client-side in your web browser with zero backend, zero build steps, and zero dependencies.*

Inspired by the landmark Google Research, Howard Hughes Medical Institute (HHMI Janelia), and FlyEM Consortium publication:  
**"Sexual dimorphism in the complete connectome of the Drosophila male central nervous system"** (*Cell*, September 2026).

---

## 🌟 The Simulation Suite at a Glance

The **CONNECTOMICS** suite brings together multiple distinct in-silico modeling paradigms, spanning from micro-scale electron-microscopy connectivity matrices to whole-organism cybernetic embodiment.

```
                                  CONNECTOMICS SUITE
                   (Google Research × HHMI Janelia MaleCNS Data)
                                         │
     ┌───────────────────┬───────────────┴───────────────┬───────────────────┐
     ▼                   ▼                               ▼                   ▼
 [ MUSCA ]            [ 166k ]                     [ SYNAPTICA ]       [ DROSOMIND ]
Full EM Connectome  Spiking Neural Network        3D Neuropil Circuit  Cybernetic Organism
• 166.7k Reconst.   • 166k Procedural Neurons     • 12 Neuropil Hubs   • Articulated 3D Body
• 2.82M Edges       • 2.3M Synapses               • Hebbian Memory     • Courtship Song Synth
• Reverse Circuit   • LIF Spiking Dynamics        • Sensory Injection  • Ring Attractor Compass
• Atlas / Poke      • Aversive Conditioning       • Free Fire / Ambient• Male P1 Hub (Cell '26)
```

---

## 🔬 Comparative Simulator Matrix

| Project | Target Scope | Neurons / Synapses | Core Mechanism | Behavioral Integration | Launch |
|---|---|---|---|---|:---:|
| [**MUSCA**](musca/) | Reconstructed EM Connectome | 166,700 neurons<br>2,822,334 edges | Reconstructed 3D soma coordinates + 1.1M synapse point-cloud | **Reverse Search:** 9 verified sensory-motor circuits (escape jump, song, odor, shadow) | [Launch MUSCA](https://realgauravvyas.github.io/connectomics/musca/) |
| [**166k**](166k/) | Large-Scale SNN Electrophysiology | 166,000 neurons<br>2,300,000 synapses | Leaky Integrate-and-Fire (LIF) + 4:1 E/I population balance | **Associative Conditioning:** PPL1 dopamine shock pairing + ablation proof | [Launch 166k](https://realgauravvyas.github.io/connectomics/166k/) |
| [**SYNAPTICA**](synaptica/) | Macro Neuropil Circuit Play | 12 mapped neuropils<br>125M mapped synapses | Topologically-routed action potential cascades | **Hebbian Learning:** Real-time Mushroom Body synaptic plasticity gauge | [Launch SYNAPTICA](https://realgauravvyas.github.io/connectomics/synaptica/) |
| [**DROSOMIND**](https://github.com/realgauravvyas/drosomind) | Closed-Loop Bio-Organism | 166,000 neurons<br>125M synapses | Dual-split connectome Holo-Deck + Articulated male fly body | **Acoustic Synthesizer:** Web Audio species-specific courtship song (Pulse & Sine) | [Launch DROSOMIND](https://realgauravvyas.github.io/drosomind/) |

---

## 🧠 Complete Nervous System Architecture

```
  [ SENSORY PERCEPTION ]
    • Photons & Optical Flow   ──►  Optic Lobes (Lamina → Medulla → Lobula → LPTCs)
    • Odorants & Pheromones    ──►  Antennal Lobes (Glomeruli) → Mushroom Body (Kenyon Cells)
    • Acoustic Vibrations      ──►  Johnston's Organ (JO-A1) → Antennal Mechanosensory Center (AMMC)
             │
             ▼
  [ CENTRAL INTEGRATION & MEMORY ]
    • Heading Navigation       ──►  Central Complex (Ellipsoid Body Ring Attractor)
    • Associative Learning     ──►  Mushroom Body Output Neurons (MBONs) + Dopamine (PPL1 / PAM)
    • Courtship & Mate Choice  ──►  P1 Courtship Hub (Male-Specific Fru+/Dsx+ Clusters)
             │
             ▼
  [ MOTOR COMMAND (DESCENDING PATHWAYS) ]
    • Giant Fiber Takeoff      ──►  DNp01 (Escape Jump Command)
    • Courtship Sing Back      ──►  DNp02 (Unilateral Wing Extension)
    • Steering Modulation      ──►  DNp31 (Flight Motor Coordination)
             │
             ▼
  [ VENTRAL NERVE CORD & EFFECTORS ]
    • T1 Neuromeres            ──►  Forelegs (Grooming & Substrate Sensing)
    • T2 Neuromeres            ──►  Flight & Wing Vibration (Pulse & Sine Song)
    • T3 Neuromeres            ──►  Tergal Trochanter Jump Muscles (TTMn)
```

---

## 🚀 Quick Start & Local Serving

Every simulator in the suite is built with **zero dependencies** and requires **no compilation step**:

```bash
# Clone the repository
git clone https://github.com/realgauravvyas/connectomics.git
cd connectomics

# Start any local HTTP server (Python 3):
python -m http.server 8000

# Open in your browser:
# http://localhost:8000/
```

### Running Sub-Project Offline Tests
```bash
# 166k headless WebGL and electrophysiology test
cd 166k && node tools/analyze.mjs && cd ..

# MUSCA 9-circuit biological reverse search verification
cd musca && python tools/behaviours.py && cd ..
```

---

## 🌐 Instant GitHub Pages Deployment

The repository includes an automated GitHub Actions deployment workflow ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)).
Pushing to the `main` branch automatically deploys the suite to:  
`https://realgauravvyas.github.io/connectomics/`

---

## 📚 Scientific References & Data Provenance

1. **Cell Publication:**  
   Google Research, Howard Hughes Medical Institute (HHMI Janelia), and the FlyEM Consortium.  
   *"Sexual dimorphism in the complete connectome of the Drosophila male central nervous system"*, **Cell** (September 2026). DOI: [10.1016/j.cell.2026.08.015](https://doi.org/10.1016/j.cell.2026.08.015).
2. **Google Research Blog:**  
   [A connectomics milestone: Mapping the complete male fruit fly brain](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/).
3. **HHMI Janelia MaleCNS Portal:**  
   [male-cns.janelia.org](https://male-cns.janelia.org/).
4. **Google Neuroglancer:**  
   [Open-source connectomics 3D volume viewer](https://github.com/google/neuroglancer).

---

## 👤 Author & Research

**Gaurav Vyas**  
- 🌐 **Personal Website & Academic Profile:** [socialpsychology.org/member/gaurav-vyas](https://www.socialpsychology.org/member/gaurav-vyas)  
- 🔶 **Interactive Portfolio:** [realgauravvyas.github.io](https://realgauravvyas.github.io/)  
- 🐙 **GitHub:** [@realgauravvyas](https://github.com/realgauravvyas)  
- 🪰 **Living Fly Simulator:** [DROSOMIND](https://realgauravvyas.github.io/drosomind/)

---

## 📄 License

MIT License &copy; 2026 Gaurav Vyas. Open-source science for everyone.
