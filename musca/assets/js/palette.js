/* ==========================================================================
   palette.js — colour assignments for the atlas
   ========================================================================== */

/** sRGB hex → linear-space [r,g,b] in 0..1 (what the shaders expect). */
export function lin(hex) {
  const n = parseInt(hex.slice(1), 16);
  const s = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return s;
}

/* Cell classes — ordered to read as anatomy: sensory warm, intrinsic cool,
   motor/descending hot. */
export const SUPERCLASS_COLORS = {
  ol_intrinsic:            '#2f6fd0',
  ol_sensory:              '#ff9a3c',
  visual_projection:       '#37c8e8',
  visual_centrifugal:      '#7a6cff',
  visual_projection_tbc:   '#4a7fd0',
  cb_intrinsic:            '#1fb59a',
  cb_sensory:              '#ffd24a',
  cb_sensory_tbc:          '#e0b23a',
  cb_motor:                '#ff2f5e',
  cb_efferent:             '#ff6a8a',
  cb_endocrine:            '#ff8fd0',
  cb_efferent_x:           '#ff6a8a',
  ascending_neuron:        '#8ee84f',
  descending_neuron:       '#ff35c8',
  descending_neuron_tbc:   '#c93aa8',
  sensory_ascending:       '#ffc266',
  sensory_ascending_tbc:   '#e0a850',
  sensory_descending:      '#ffb060',
  efferent_ascending:      '#ff7fa8',
  efferent_descending:     '#ff5f98',
  vnc_intrinsic:           '#3fd06a',
  vnc_sensory:             '#ffab4d',
  vnc_sensory_tbc:         '#d9903f',
  vnc_motor:               '#ff3b3b',
  vnc_efferent:            '#ff6f6f',
  vnc_endocrine:           '#ff9ad0',
  vnc_tbc:                 '#5fd0b0',
  ENS:                     '#c9d6e8',
};

export const NT_COLORS = {
  acetylcholine: '#37d6ff',
  glutamate:     '#ffb03a',
  gaba:          '#c46bff',
  histamine:     '#5cff9e',
  dopamine:      '#ffe23a',
  octopamine:    '#ff8a3a',
  serotonin:     '#ff5fa8',
  unclear:       '#54687f',
};

export const SIDE_COLORS = { L: '#3ad6ff', R: '#ff4fd8', M: '#e8f0ff', '?': '#54687f' };

export const DIM_COLORS = {
  none:                            '#2c3f56',
  'male-specific':                 '#ff35c8',
  'potentially male-specific':     '#c95ab0',
  'sexually dimorphic':            '#ffa23a',
  'potentially sexually dimorphic':'#c08040',
};

export const FALLBACK = ['#5d7fa8', '#7fa86a', '#a86a9e', '#6aa8a8', '#a89a6a', '#8a6aa8'];

export function colorFor(mode, D, i) {
  switch (mode) {
    case 'nt': {
      const k = D.nt[i];
      const name = k === 255 ? 'unclear' : D.meta.neurotransmitters[k];
      return NT_COLORS[name] || '#54687f';
    }
    case 'side':
      return SIDE_COLORS[D.meta.sides[D.side[i]]] || '#54687f';
    case 'dimorphism':
      return DIM_COLORS[D.meta.dimorphisms[D.dim[i]]] || '#54687f';
    default: {
      const name = D.meta.superclasses[D.sup[i]];
      return SUPERCLASS_COLORS[name] || FALLBACK[D.sup[i] % FALLBACK.length];
    }
  }
}

/** Legend entries for a colour mode: [{label, hex, count}] */
export function legendFor(mode, D) {
  if (mode === 'nt') {
    return D.meta.neurotransmitters.map((name, i) => ({
      label: name, hex: NT_COLORS[name] || '#54687f', count: D.ntCount[i], key: i,
    })).sort((a, b) => b.count - a.count);
  }
  if (mode === 'side') {
    return D.meta.sides.map((name, i) => ({
      label: { L: 'left', R: 'right', M: 'midline', '?': 'unknown' }[name] || name,
      hex: SIDE_COLORS[name], count: null, key: i,
    }));
  }
  if (mode === 'dimorphism') {
    const counts = new Array(D.meta.dimorphisms.length).fill(0);
    for (let i = 0; i < D.n; i++) counts[D.dim[i]]++;
    return D.meta.dimorphisms.map((name, i) => ({
      label: name === 'none' ? 'no known sex difference' : name,
      hex: DIM_COLORS[name] || '#54687f', count: counts[i], key: i,
    }));
  }
  const counts = new Array(D.meta.superclasses.length).fill(0);
  for (let i = 0; i < D.n; i++) counts[D.sup[i]]++;
  return D.meta.superclasses.map((name, i) => ({
    label: name.replace(/_/g, ' '), hex: SUPERCLASS_COLORS[name] || FALLBACK[i % FALLBACK.length],
    count: counts[i], key: i,
  })).sort((a, b) => b.count - a.count);
}
