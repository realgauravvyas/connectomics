/* =========================================================================
 * SYNAPTICA — Connectome dataset
 * Scientifically grounded in: "A connectomics milestone: Mapping the complete
 * male fruit fly brain" (Google Research + HHMI Janelia, Cell, Sept 2026).
 *
 *   - 166,000 neurons, ~125 million synaptic connections
 *   - Largest brain map by neuron count to date
 *   - Includes brain + ventral nerve cord (links senses -> behaviour)
 *
 * The regions, pathways and structures below reflect real Drosophila
 * neuroanatomy. Node counts rendered on screen are a stylised subset (a few
 * thousand) of the 166k real neurons; the GRAPH topology and named pathways
 * are real. See README.md for sources.
 * ========================================================================= */
window.SYNAPTICA = window.SYNAPTICA || {};

SYNAPTICA.FACTS = {
  title: "SYNAPTICA",
  subtitle: "the fruit fly brain, alive",
  neurons: 166000,
  synapses: 125000000,
  species: "Drosophila melanogaster — male",
  source: "Google Research × HHMI Janelia",
  paper: "Sexual dimorphism in the complete connectome of the Drosophila male central nervous system — Cell, 2026",
  dataset: "male-cns.janelia.org",
  tagline: "The largest brain map ever drawn — now a toy you can fire."
};

/* Region "kinds" drive the colour legend.
 * side: 'L' = left hemisphere, 'R' = right hemisphere, 'C' = midline/central.
 * pos is in arbitrary brain units (x:right, y:anterior/front, z:dorsal/up). */
SYNAPTICA.REGIONS = [
  { id:"eye",         name:"Compound Eye",                short:"Eye",          side:"L", kind:"sensory",   color:"#ffe08a", pos:[ 0.98, 1.14, 0.06], size:0.13, label:true,
    desc:"~750 ommatidia capture light. The first stage of the fly's visual system." },
  { id:"antenna",     name:"Antenna (Olfactory + Auditory)", short:"Antenna",   side:"L", kind:"sensory",   color:"#ffb4a2", pos:[ 0.30, 1.36, 0.22], size:0.06, label:true,
    desc:"Carries smell receptors AND Johnston's organ (hearing/vibration). Gateway to the olfactory brain." },
  { id:"lamina",      name:"Lamina",                      short:"Lamina",       side:"L", kind:"visual",    color:"#b98cff", pos:[ 0.86, 0.96, 0.00], size:0.14, label:true,
    desc:"First optic neuropil. Early motion & contrast processing." },
  { id:"medulla",     name:"Medulla",                     short:"Medulla",      side:"L", kind:"visual",    color:"#b98cff", pos:[ 0.82, 0.70, 0.00], size:0.20, label:true,
    desc:"The 'visual cortex' of the fly — feature detection, colour, motion." },
  { id:"lobula",      name:"Lobula",                      short:"Lobula",       side:"L", kind:"visual",    color:"#a87cff", pos:[ 0.72, 0.45,-0.05], size:0.17, label:true,
    desc:"Higher-order visual processing; feeds object & behaviour centres." },
  { id:"lobulaplate", name:"Lobula Plate",                short:"Lobula Plate", side:"L", kind:"visual",    color:"#9f6cff", pos:[ 0.62, 0.25,-0.05], size:0.15, label:true,
    desc:"Specialised for wide-field optic-flow — the fly's gyroscope." },
  { id:"antennal",    name:"Antennal Lobe",               short:"Ant. Lobe",    side:"L", kind:"olfactory", color:"#ff9f6b", pos:[ 0.34, 0.90, 0.16], size:0.13, label:true,
    desc:"Olfactory glomeruli. Maps odours to labelled lines (like the nose's relay)."},
  { id:"lateralhorn", name:"Lateral Horn",                short:"Lat. Horn",    side:"L", kind:"olfactory", color:"#46f0a0", pos:[ 0.52, 0.50, 0.12], size:0.13, label:true,
    desc:"Innate smell responses — 'this odour means approach / avoid'." },
  { id:"mb",          name:"Mushroom Body (Kenyon Cells)",short:"Mushroom Body",side:"C", kind:"memory",    color:"#46f0a0", pos:[ 0.00, 0.06, 0.30], size:0.24, label:true,
    desc:"The fly's learning & memory centre. Sparse Kenyon-cell codes let it associate odour + reward." },
  { id:"cc",          name:"Central Complex",             short:"Central Complex",side:"C",kind:"navigation",color:"#2fd6c4", pos:[ 0.00,-0.05, 0.20], size:0.17, label:true,
    desc:"Navigation, steering and action selection — turns sensory state into movement." },
  { id:"pb",          name:"Protocerebral Bridge",       short:"PB",           side:"C", kind:"navigation", color:"#2fd6c4", pos:[ 0.00, 0.00, 0.02], size:0.10, label:false,
    desc:"Part of the central complex; bridges the two brain halves." },
  { id:"vnc",         name:"Ventral Nerve Cord",         short:"Nerve Cord",   side:"C", kind:"motor",     color:"#5fb0ff", pos:[ 0.00,-0.80,-0.55], size:0.28, label:true,
    desc:"The fly's 'spinal cord'. Carries the final motor commands to the body." }
];

/* Pathways. mode:
 *   'mirror'  -> build from_L->to_L and from_R->to_R
 *   'central' -> from->to (both midline regions)
 *   'cross'   -> from_L->to_R and from_R->to_L (commissure between halves)
 * synapses = approximate connection strength used for the live counter. */
SYNAPTICA.EDGES = [
  // --- sensory in ---
  { from:"eye",     to:"lamina",   mode:"mirror", synapses: 9000 },
  { from:"antenna", to:"antennal", mode:"mirror", synapses: 6000 },

  // --- visual chain ---
  { from:"lamina",      to:"medulla",     mode:"mirror", synapses: 40000 },
  { from:"medulla",     to:"lobula",      mode:"mirror", synapses: 30000 },
  { from:"lobula",      to:"lobulaplate", mode:"mirror", synapses: 25000 },
  { from:"lobulaplate", to:"cc",          mode:"mirror", synapses: 15000 },
  { from:"medulla",     to:"cc",          mode:"mirror", synapses: 12000 },
  { from:"lobula",      to:"vnc",         mode:"mirror", synapses: 18000 },
  { from:"lobulaplate", to:"vnc",         mode:"mirror", synapses: 16000 },

  // --- olfactory chain ---
  { from:"antennal",    to:"mb",          mode:"mirror", synapses: 20000, trainable:true },
  { from:"antennal",    to:"lateralhorn", mode:"mirror", synapses: 14000 },
  { from:"lateralhorn", to:"cc",          mode:"mirror", synapses: 9000 },
  { from:"lateralhorn", to:"vnc",         mode:"mirror", synapses: 7000 },
  { from:"mb",          to:"cc",          mode:"central", synapses: 11000, trainable:true },
  { from:"mb",          to:"vnc",         mode:"central", synapses: 8000,  trainable:true },

  // --- action selection -> motor out ---
  { from:"cc",          to:"vnc",         mode:"central", synapses: 22000 },

  // --- within central complex ---
  { from:"pb",          to:"cc",          mode:"central", synapses: 5000 },

  // --- cross-hemisphere commissures (let signals spill to the other side) ---
  { from:"medulla",     to:"medulla",     mode:"cross",   synapses: 7000 },
  { from:"lobula",      to:"lobula",      mode:"cross",   synapses: 6000 }
];

SYNAPTICA.LEGEND = [
  { kind:"sensory",   label:"Sensory organs (eye / antenna)", color:"#ffe08a" },
  { kind:"visual",    label:"Optic lobes (vision)",           color:"#b98cff" },
  { kind:"olfactory", label:"Antennal lobe (smell)",          color:"#ff9f6b" },
  { kind:"memory",    label:"Mushroom body (memory)",         color:"#46f0a0" },
  { kind:"navigation",label:"Central complex (action)",       color:"#2fd6c4" },
  { kind:"motor",     label:"Ventral nerve cord (motor)",     color:"#5fb0ff" }
];
