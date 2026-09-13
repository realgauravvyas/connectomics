# SYNAPTICA 🪰⚡
### Playable 3D Fruit Fly Brain Connectome & Hebbian Memory Simulation

<p align="center">
  <a href="https://realgauravvyas.github.io/connectomics/synaptica/">
    <img src="https://img.shields.io/badge/🚀_LAUNCH_SYNAPTICA-realgauravvyas.github.io%2Fconnectomics%2Fsynaptica-ff007f?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Launch SYNAPTICA" />
  </a>
  <a href="https://realgauravvyas.github.io/connectomics/">
    <img src="https://img.shields.io/badge/CONNECTOMICS_HUB-SUITE_HOME-00ff88?style=for-the-badge&logo=github&logoColor=white" alt="Connectomics Suite" />
  </a>
</p>

[![Neuropils](https://img.shields.io/badge/Neuropils-12_Mapped-00e5ff)](https://realgauravvyas.github.io/connectomics/synaptica/)
[![Synapses](https://img.shields.io/badge/Synapses-125M_(Mapped)-ff007f)](https://realgauravvyas.github.io/connectomics/synaptica/)
[![Connectome Milestone](https://img.shields.io/badge/Connectome-Cell%202026-00e5ff.svg)](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/)
[![Plasticity](https://img.shields.io/badge/Plasticity-Hebbian_Learning-00ff88.svg)](https://realgauravvyas.github.io/connectomics/synaptica/)
[![Dependencies](https://img.shields.io/badge/Dependencies-None-brightgreen)](https://realgauravvyas.github.io/connectomics/synaptica/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 🌐 **Experience the Live Simulation Online:**  
> 👉 **[https://realgauravvyas.github.io/connectomics/synaptica/](https://realgauravvyas.github.io/connectomics/synaptica/)**  
> *Zero installation required. Runs directly in any modern browser with Canvas & WebGL.*

---

## 🌟 Overview: The Connectome Alive

**SYNAPTICA** turns the Google Research & HHMI Janelia male *Drosophila melanogaster* connectome (*Cell*, September 2026) into an interactive, playable 3D neuro-computational sandbox.

Instead of navigating passive static meshes, SYNAPTICA treats the connectome as an active, living organ:
- **Anatomical Neuropils:** Organized into 12 anatomically authentic brain structures (Optic Lobes, Antennal Lobes, Mushroom Body, Central Complex, Ventral Nerve Cord).
- **Playable Neural Conduction:** Click any glowing anatomical label or inject sensory impulses to witness signals cascade along named synaptic highways.
- **Biophysical Memory Training:** Directly interact with the **Mushroom Body**—the fruit fly's associative memory hub. Repeated cue training strengthens synaptic conductance via **Hebbian plasticity** (*"neurons that fire together, wire together"*). Trigger *Recall* to watch the learned pathway fire with accelerated velocity and radiant intensity.

---

## 🎮 Operational Modes

| Mode | Gameplay & Biological Action |
|---|---|
| **Free Fire** | Orbital camera rotation and zoom. **Click any glowing neuropil label** to inject an action potential and trace how signals traverse the connectome network. |
| **Sensory** | Injects real-world sensory inputs:<br>• **Flash Eyes:** Traces the visual pathway: Photons $\rightarrow$ Lamina $\rightarrow$ Medulla $\rightarrow$ Lobula $\rightarrow$ Central Complex $\rightarrow$ Ventral Nerve Cord.<br>• **Puff Odor:** Injects olfactory signals: Antenna $\rightarrow$ Antennal Lobe glomeruli $\rightarrow$ Mushroom Body $\rightarrow$ Lateral Horn. |
| **Train Memory** | Associative memory sandbox. Press **Train Cue** repeatedly to induce Long-Term Potentiation (LTP). Watch the live **Memory Strength meter** fill as synaptic weights adapt. Hit **Recall** to witness the conditioned pathway fire faster and brighter. |
| **Ambient** | Hands-free cinematic mode. The brain autonomously generates rhythmic physiological oscillations and stochastic firing cascades. |

---

## 🧠 Scientific Authenticity

- **Topological Validity:** Faithfully captures the 12 primary neuropil classes, bilateral hemisphere symmetry, and validated inter-region projection highways.
- **Hebbian Learning Dynamics:** Implements real-time synaptic weight modulation ($W_{t+1} = W_t + \eta \cdot x_{pre} \cdot x_{post}$). Training directly mimics dopaminergic reinforcement in the Drosophila Mushroom Body.
- **Data Provenance:** Built upon the open-access MaleCNS dataset released by Google Research, HHMI Janelia, and the FlyEM Consortium (*Cell*, September 2026).

---

## 💻 Quick Start & Local Setup

```bash
# Clone the repository
git clone https://github.com/realgauravvyas/connectomics.git
cd connectomics/synaptica

# Start any local HTTP server (e.g. Python)
python -m http.server 8000

# Open in browser:
# http://localhost:8000/
```

---

## 📚 Scientific References

- **Google Research & HHMI Janelia**: *"Sexual dimorphism in the complete connectome of the Drosophila male central nervous system"*, **Cell** (September 2026).
- **Google Research Blog**: [A connectomics milestone: Mapping the complete male fruit fly brain](https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/).
- **HHMI Janelia MaleCNS**: [male-cns.janelia.org](https://male-cns.janelia.org/).

---

## 👤 Author & Research

**Gaurav Vyas**  
- 🌐 **Personal Website & Academic Profile:** [socialpsychology.org/member/gaurav-vyas](https://www.socialpsychology.org/member/gaurav-vyas)  
- 🔶 **Interactive Portfolio:** [realgauravvyas.github.io](https://realgauravvyas.github.io/)  
- 🐙 **GitHub:** [@realgauravvyas](https://github.com/realgauravvyas)  
- 🪰 **Parent Suite:** [CONNECTOMICS](https://realgauravvyas.github.io/connectomics/)

---

## 📄 License

MIT License &copy; 2026 Gaurav Vyas. Open-source science under the MIT License.
