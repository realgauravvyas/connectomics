import './engine.js';

/**
 * CHRONOFLY — Counterfactual Neural Twin Lab
 * Entrypoint. Handles UI interactions and bootstraps the engine.
 * No other dependencies; all logic lives in engine.js.
 */

document.addEventListener('DOMContentLoaded', () => {
  // expose globally for debugging in console
  window.CHRONOFLY = {
    runExperiment: (seed, intervention) => {
      // re-init weights anew each call if desired
      // simply delegate to engine run logic via seed and intervention
      const seedNum = Math.max(0, typeof seed === 'number' ? seed : 42);
      const inter = intervention || 'none';
      document.getElementById('seed').value = seedNum;
      document.getElementById('intervention').value = inter;
      document.getElementById('runBtn').click();
    },
    getDivergence: () => {
      const tracesA = window.CHRONOFLY._lastTracesA;
      const tracesB = window.CHRONOFLY._lastTracesB;
      if (!tracesA) return null;
      let s = 0;
      for (let i = 0; i < tracesA.length; i++) {
        const d = tracesA[i] - tracesB[i];
        s += d * d;
      }
      return s / tracesA.length;
    }
  };
});