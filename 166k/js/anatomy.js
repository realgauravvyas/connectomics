/**
 * anatomy.js — the anatomical ground truth the model is grown from.
 *
 * Numbers come from the male Drosophila CNS connectome (Janelia / Google,
 * Cell 2026): 166,000 neurons, 125 million synapses, brain + ventral nerve
 * cord. Region sizes and the long-range pathways below follow published
 * Drosophila circuit anatomy.
 *
 * Coordinates are in "brain units": x = left/right, y = up, z = anterior.
 * The whole CNS fits roughly inside a sphere of radius 1.
 */

export const CNS_FACTS = {
  neurons: 166000,
  synapses: 125000000,
  paper: 'Sexual dimorphism in the complete connectome of the Drosophila male central nervous system',
  paperUrl: 'https://doi.org/10.1016/j.cell.2026.08.015',
  viewer: 'https://male-cns.janelia.org/',
  blog: 'https://research.google/blog/a-connectomics-milestone-mapping-the-complete-male-fruit-fly-brain/',
};

/**
 * Region definitions.
 *   real    – neuron count in the real connectome (both sides combined)
 *   mirror  – duplicated on both hemispheres (x -> -x)
 *   shape   – volumetric template used to place neurons in 3D
 *   groups  – cell classes inside the region; pathways reference these
 *   partOfGroup – when true, group i is placed inside shape part i
 */
export const REGION_DEFS = [
  {
    id: 'OL', name: 'Optic lobe', role: 'sensory', color: '#7C5CFF',
    real: 88000, mirror: true,
    blurb: 'Lamina → medulla → lobula → lobula plate. Early vision: motion, looming, colour. Over half of every neuron in the fly CNS lives here.',
    groups: [
      { k: 'LA',  f: 0.10, name: 'Lamina monopolar' },
      { k: 'ME',  f: 0.55, name: 'Medulla' },
      { k: 'LO',  f: 0.20, name: 'Lobula' },
      { k: 'LOP', f: 0.15, name: 'Lobula plate' },
    ],
    partOfGroup: true,
    shape: { t: 'composite', parts: [
      { w: 0.10, t: 'ellipsoid', c: [ 0.80,  0.10, -0.06], r: [0.06, 0.19, 0.17] },
      { w: 0.55, t: 'ellipsoid', c: [ 0.62,  0.10, -0.08], r: [0.14, 0.23, 0.20] },
      { w: 0.20, t: 'ellipsoid', c: [ 0.46,  0.05, -0.02], r: [0.09, 0.12, 0.12] },
      { w: 0.15, t: 'ellipsoid', c: [ 0.46,  0.22, -0.16], r: [0.08, 0.09, 0.09] },
    ] },
  },
  {
    id: 'VNC', name: 'Ventral nerve cord', role: 'motor', color: '#4DA6FF',
    real: 30000, mirror: false,
    blurb: 'The fly’s spinal cord. Leg, wing, haltere and abdominal motor circuits — where every decision finally becomes movement.',
    groups: [
      { k: 'IN',   f: 0.45, name: 'VNC interneuron' },
      { k: 'LEG',  f: 0.25, name: 'Leg motor' },
      { k: 'WING', f: 0.12, name: 'Wing motor' },
      { k: 'JUMP', f: 0.06, name: 'Jump / escape motor' },
      { k: 'ABD',  f: 0.12, name: 'Abdominal motor' },
    ],
    shape: { t: 'ellipsoid', c: [0, -0.46, -0.18], r: [0.14, 0.09, 0.19] },
  },
  {
    id: 'CB', name: 'Central brain', role: 'association', color: '#98A2B3',
    real: 12000, mirror: false,
    blurb: 'Superior / inferior protocerebrum and the rest of the association mass. Also hosts the giant fibre, the escape command neuron.',
    groups: [
      { k: 'IN',  f: 0.85, name: 'Association neuron' },
      { k: 'GF',  f: 0.05, name: 'Giant fibre (escape)' },
      { k: 'DNp', f: 0.10, name: 'Premotor descending' },
    ],
    shape: { t: 'ellipsoid', c: [0, 0.10, 0.02], r: [0.48, 0.28, 0.32], shell: 0.42 },
  },
  {
    id: 'MB', name: 'Mushroom body', role: 'memory', color: '#FF4D9D',
    real: 11000, mirror: true,
    blurb: 'Olfactory learning and memory. Kenyon cells hold a sparse odour code; dopamine rewrites their output synapses. This is where the fly remembers.',
    groups: [
      { k: 'KC',   f: 0.75, name: 'Kenyon cell' },
      { k: 'MBON', f: 0.12, name: 'Mushroom body output' },
      { k: 'APL',  f: 0.13, name: 'APL (feedback inhibition)' },
    ],
    shape: { t: 'composite', parts: [
      { w: 0.42, t: 'ellipsoid', c: [0.27, 0.20, -0.03], r: [0.085, 0.075, 0.075] },
      { w: 0.58, t: 'capsule', p0: [0.27, 0.20, -0.03], p1: [0.17, 0.09, 0.01], p2: [0.05, 0.02, 0.07], r0: 0.055, r1: 0.050 },
    ] },
  },
  {
    id: 'SEZ', name: 'Subesophageal zone', role: 'sensory', color: '#FF7A45',
    real: 5000, mirror: false,
    blurb: 'Taste and feeding. Gustatory neurons report sweet and bitter; motor neurons drive the proboscis.',
    groups: [
      { k: 'GRN',   f: 0.20, name: 'Gustatory receptor' },
      { k: 'SEZIN', f: 0.50, name: 'SEZ interneuron' },
      { k: 'MN',    f: 0.30, name: 'Proboscis motor' },
    ],
    shape: { t: 'ellipsoid', c: [0, -0.22, 0.14], r: [0.17, 0.075, 0.13] },
  },
  {
    id: 'CX', name: 'Central complex', role: 'navigation', color: '#4DFF88',
    real: 4500, mirror: false,
    blurb: 'The navigation centre. A ring attractor in the ellipsoid body holds heading; the fan-shaped body turns it into steering commands.',
    groups: [
      { k: 'EB', f: 0.30, name: 'Ellipsoid body' },
      { k: 'FB', f: 0.35, name: 'Fan-shaped body' },
      { k: 'PB', f: 0.15, name: 'Protocerebral bridge' },
      { k: 'NO', f: 0.20, name: 'Noduli' },
    ],
    partOfGroup: true,
    shape: { t: 'composite', parts: [
      { w: 0.30, t: 'torus',     c: [0, 0.14, 0.00], R: 0.085, tube: 0.022, plane: 'xz' },
      { w: 0.35, t: 'ellipsoid', c: [0, 0.045, 0.03], r: [0.15, 0.022, 0.055] },
      { w: 0.15, t: 'arc',       c: [0, 0.27, -0.15], R: 0.13, a: 0.95, plane: 'xy', jitter: 0.018 },
      { w: 0.20, t: 'ellipsoid', c: [0, -0.02, -0.05], r: [0.09, 0.030, 0.040] },
    ] },
  },
  {
    id: 'LH', name: 'Lateral horn', role: 'association', color: '#FFB020',
    real: 4400, mirror: true,
    blurb: 'Innate odour meaning. Hard-wired, fast, and shared with every other fly — the reflex side of smell.',
    groups: [
      { k: 'LHON', f: 0.50, name: 'Lateral horn output' },
      { k: 'LHIN', f: 0.50, name: 'Lateral horn local' },
    ],
    shape: { t: 'ellipsoid', c: [0.33, 0.14, 0.13], r: [0.10, 0.09, 0.09] },
  },
  {
    id: 'AL', name: 'Antennal lobe', role: 'sensory', color: '#37E2D5',
    real: 2400, mirror: true,
    blurb: 'The olfactory bulb of the fly. Receptor neurons converge into ~60 glomeruli; projection neurons carry the code onward.',
    groups: [
      { k: 'ORN', f: 0.10, name: 'Olfactory receptor' },
      { k: 'PN',  f: 0.45, name: 'Projection neuron' },
      { k: 'LN',  f: 0.45, name: 'Local interneuron' },
    ],
    shape: { t: 'ellipsoid', c: [0.11, -0.07, 0.30], r: [0.075, 0.07, 0.07] },
  },
  {
    id: 'AMMC', name: 'Antennal mechanosensory', role: 'sensory', color: '#C77DFF',
    real: 2000, mirror: true,
    blurb: 'Hearing and mechanosensation. Johnston’s organ hears the courtship song; air currents and touch arrive here too.',
    groups: [
      { k: 'JO', f: 0.35, name: 'Johnston’s organ' },
      { k: 'IN', f: 0.65, name: 'AMMC interneuron' },
    ],
    shape: { t: 'ellipsoid', c: [0.15, -0.15, 0.20], r: [0.055, 0.05, 0.05] },
  },
  {
    id: 'DN', name: 'Descending neurons', role: 'motor', color: '#8DE9FF',
    real: 1300, mirror: false,
    blurb: 'The bottleneck. Every command from the brain to the body passes through ~1,300 descending neurons.',
    groups: [
      { k: 'DN', f: 1.00, name: 'Descending neuron' },
    ],
    shape: { t: 'column', c: [0, -0.14, 0.00], h: 0.46, r: 0.055 },
  },
  {
    id: 'P1', name: 'P1 courtship', role: 'modulatory', color: '#FF3B6B',
    real: 800, mirror: true,
    blurb: 'Male-specific, fruitless-expressing. Drives courtship and song, and it recurs onto itself to hold the state.',
    groups: [
      { k: 'P1', f: 1.00, name: 'P1 (fru+)' },
    ],
    shape: { t: 'ellipsoid', c: [0.18, 0.26, -0.10], r: [0.045, 0.04, 0.04] },
  },
  {
    id: 'DAN', name: 'Dopaminergic', role: 'modulatory', color: '#FFE066',
    real: 700, mirror: true,
    blurb: 'The teaching signal. PPL1 carries punishment, PAM carries reward. Neither senses the world — they just say "remember this".',
    groups: [
      { k: 'PPL1', f: 0.45, name: 'PPL1 (punishment)' },
      { k: 'PAM',  f: 0.55, name: 'PAM (reward)' },
    ],
    shape: { t: 'ellipsoid', c: [0.15, 0.09, -0.01], r: [0.05, 0.045, 0.05] },
  },
];

/**
 * Long range pathways. Each entry is one tract.
 *   in:  n  -> every target neuron receives ~n inputs from this source
 *   out: n  -> every source neuron makes ~n outputs onto this target
 *   contra – fraction rerouted to the opposite hemisphere (default 0.08)
 * These are the wiring rules published for Drosophila.
 */
export const PATHWAYS = [
  // ---- olfaction -------------------------------------------------------
  { from: 'AL.ORN', to: 'AL.PN',   in: 6,  note: 'Receptor → projection neuron (glomerulus)' },
  { from: 'AL.ORN', to: 'AL.LN',   in: 4 },
  { from: 'AL.PN',  to: 'AL.LN',   out: 4 },
  { from: 'AL.LN',  to: 'AL.PN',   in: 14, inhib: true, note: 'Lateral inhibition sharpens odour code' },
  { from: 'AL.PN',  to: 'MB.KC',   in: 10, note: 'Sparse, random PN→KC expansion' },
  { from: 'AL.PN',  to: 'LH.LHON', in: 8,  note: 'Innate odour pathway' },
  { from: 'AL.PN',  to: 'P1',      in: 3,  note: 'Pheromone route to courtship' },
  { from: 'AL.PN',  to: 'CB.IN',   in: 2 },
  // ---- taste -----------------------------------------------------------
  { from: 'SEZ.GRN',   to: 'SEZ.SEZIN', in: 6 },
  { from: 'SEZ.SEZIN', to: 'SEZ.MN',    in: 8, note: 'Proboscis extension reflex' },
  // ---- vision ----------------------------------------------------------
  { from: 'OL.LA',  to: 'OL.ME',   out: 8 },
  { from: 'OL.ME',  to: 'OL.ME',   in: 2,  contra: 0.03 },
  { from: 'OL.ME',  to: 'OL.LO',   out: 3 },
  { from: 'OL.LO',  to: 'OL.LOP',  out: 3 },
  { from: 'OL.LO',  to: 'CB.IN',   in: 1 },
  { from: 'OL.LOP', to: 'CB.IN',   in: 1 },
  { from: 'OL.LOP', to: 'CX.EB',   in: 1, contra: 0.5, note: 'Wide-field motion → heading' },
  { from: 'OL.LOP', to: 'CX.FB',   in: 1, contra: 0.5 },
  { from: 'OL.LOP', to: 'CB.GF',   in: 8, note: 'Looming → giant fibre → escape' },
  // ---- hearing / escape -------------------------------------------------
  { from: 'AMMC.JO', to: 'AMMC.IN',  in: 6 },
  { from: 'AMMC.IN', to: 'CB.GF',    in: 3 },
  { from: 'AMMC.IN', to: 'CB.IN',    in: 3 },
  { from: 'AMMC.IN', to: 'DN',       in: 2 },
  { from: 'CB.GF',   to: 'VNC.JUMP', out: 45, strong: true },
  { from: 'CB.GF',   to: 'VNC.WING', out: 10, strong: true },
  // ---- mushroom body ----------------------------------------------------
  { from: 'MB.KC',   to: 'MB.MBON', out: 12, plastic: true, note: 'The only plastic synapse class in the model' },
  { from: 'MB.KC',   to: 'MB.APL',  out: 2 },
  { from: 'MB.APL',  to: 'MB.KC',   out: 55, inhib: true, note: 'Global feedback inhibition → sparse code' },
  { from: 'MB.MBON', to: 'MB.MBON', in: 4 },
  { from: 'MB.MBON', to: 'LH.LHON', in: 6 },
  { from: 'MB.MBON', to: 'CX.FB',   in: 3 },
  { from: 'MB.MBON', to: 'CB.IN',   in: 3 },
  { from: 'DAN.PPL1', to: 'MB.KC',   out: 26, neuromod: true },
  { from: 'DAN.PAM',  to: 'MB.KC',   out: 26, neuromod: true },
  { from: 'DAN.PPL1', to: 'MB.MBON', out: 8,  neuromod: true },
  { from: 'DAN.PAM',  to: 'MB.MBON', out: 8,  neuromod: true },
  { from: 'DAN.PPL1', to: 'CX.FB',   in: 1,  neuromod: true },
  { from: 'DAN.PAM',  to: 'CX.FB',   in: 1,  neuromod: true },
  // ---- central complex (navigation) -------------------------------------
  { from: 'CX.EB', to: 'CX.EB', in: 14, note: 'Ring attractor' },
  { from: 'CX.EB', to: 'CX.FB', in: 8 },
  { from: 'CX.FB', to: 'CX.EB', in: 6 },
  { from: 'CX.PB', to: 'CX.EB', in: 8 },
  { from: 'CX.EB', to: 'CX.PB', in: 6 },
  { from: 'CX.NO', to: 'CX.FB', in: 4 },
  { from: 'CX.FB', to: 'CX.NO', in: 4 },
  { from: 'CX.FB', to: 'DN',    in: 8, note: 'Steering command' },
  { from: 'CX.EB', to: 'DN',    in: 4 },
  // ---- association ------------------------------------------------------
  { from: 'CB.IN',   to: 'CB.IN',     in: 8 },
  { from: 'CB.IN',   to: 'DN',        in: 5 },
  { from: 'CB.IN',   to: 'CX.FB',     in: 4 },
  { from: 'CB.IN',   to: 'LH.LHON',   in: 4 },
  { from: 'CB.IN',   to: 'SEZ.SEZIN', in: 3 },
  { from: 'LH.LHON', to: 'CB.IN',     in: 4 },
  { from: 'LH.LHON', to: 'DN',        in: 6 },
  { from: 'LH.LHON', to: 'LH.LHIN',   in: 6 },
  { from: 'LH.LHIN', to: 'LH.LHON',   in: 8, inhib: true },
  // ---- courtship --------------------------------------------------------
  { from: 'P1', to: 'P1',        in: 10, note: 'Recurrent — sustains the courtship state' },
  { from: 'P1', to: 'DN',        out: 8 },
  { from: 'P1', to: 'CB.IN',     out: 2 },
  { from: 'P1', to: 'VNC.WING',  out: 4, note: 'Wing vibration → courtship song' },
  // ---- descending → body -------------------------------------------------
  { from: 'DN', to: 'VNC.IN',     out: 12 },
  { from: 'DN', to: 'VNC.LEG',    out: 6 },
  { from: 'DN', to: 'VNC.WING',   out: 4 },
  { from: 'DN', to: 'SEZ.SEZIN',  in: 2 },
  // ---- ventral nerve cord ------------------------------------------------
  { from: 'VNC.IN',   to: 'VNC.IN',   in: 10 },
  { from: 'VNC.IN',   to: 'VNC.LEG',  in: 10, note: 'Leg motor pattern' },
  { from: 'VNC.IN',   to: 'VNC.WING', in: 8 },
  { from: 'VNC.IN',   to: 'VNC.JUMP', in: 6 },
  { from: 'VNC.IN',   to: 'VNC.ABD',  in: 6 },
  { from: 'VNC.LEG',  to: 'VNC.IN',   out: 4 },
  { from: 'VNC.IN',   to: 'CB.IN',    in: 1, note: 'Ascending feedback' },
  { from: 'VNC.IN',   to: 'SEZ.SEZIN', in: 1 },
  { from: 'SEZ.SEZIN', to: 'VNC.IN',  out: 3 },
];

/**
 * Things you can do to the fly. Each stimulus drives a fixed, deterministic
 * subset of a sensory group — the same "odour" always means the same neurons.
 */
export const STIMULI = [
  { id: 'odorA',   label: 'Food odour',      key: 'AL.ORN',     frac: 0.30, amp: 0.30, color: '#37E2D5', hint: 'Smell of fermenting fruit' },
  { id: 'odorB',   label: 'CO₂ / danger',    key: 'AL.ORN',     frac: 0.30, amp: 0.30, color: '#37E2D5', hint: 'Stress odour from other flies' },
  { id: 'phero',   label: 'Pheromone',       key: 'AL.ORN',     frac: 0.25, amp: 0.34, color: '#FF3B6B', hint: 'A female is nearby' },
  { id: 'sweet',   label: 'Sweet taste',     key: 'SEZ.GRN',    frac: 0.50, amp: 0.40, color: '#FF7A45', hint: 'Sugar on the tarsi' },
  { id: 'bitter',  label: 'Bitter taste',    key: 'SEZ.GRN',    frac: 0.50, amp: 0.40, color: '#FF7A45', hint: 'Quinine — reject' },
  { id: 'looming', label: 'Looming shadow',  key: 'OL.LOP',     frac: 0.16, amp: 0.55, color: '#7C5CFF', hint: 'Something is coming' },
  { id: 'light',   label: 'Light flash',     key: 'OL.LA',      frac: 0.40, amp: 0.30, color: '#7C5CFF', hint: 'Whole-field flash' },
  { id: 'sound',   label: 'Courtship song',  key: 'AMMC.JO',    frac: 0.45, amp: 0.34, color: '#C77DFF', hint: '200 Hz pulse song' },
  { id: 'airpuff', label: 'Air puff',        key: 'AMMC.JO',    frac: 0.80, amp: 0.50, color: '#C77DFF', hint: 'Mechanical startle' },
  { id: 'shock',   label: 'Electric shock',  key: 'DAN.PPL1',   frac: 1.00, amp: 0.50, color: '#FFE066', hint: 'Punishment teaching signal' },
  { id: 'sugar',   label: 'Sugar reward',    key: 'DAN.PAM',    frac: 1.00, amp: 0.50, color: '#FFE066', hint: 'Reward teaching signal' },
];

/** Fraction of neurons that are inhibitory, per region (GABA / GluCl). */
export const INHIB_FRACTION = {
  OL: 0.35, VNC: 0.30, CB: 0.28, MB: 0.15, SEZ: 0.30, CX: 0.34,
  LH: 0.30, AL: 0.42, AMMC: 0.32, DN: 0.22, P1: 0.35, DAN: 0.25,
};
