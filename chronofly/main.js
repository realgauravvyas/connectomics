import './engine.js';

/**
 * CHRONOFLY — Counterfactual Neural Twin Lab
 * Entrypoint. Handles UI interactions and bootstraps the engine.
 * No other dependencies; all logic lives in engine.js.
 */

document.addEventListener('DOMContentLoaded', () => {
  const previous = window.CHRONOFLY || {};
  window.CHRONOFLY = {
    ...previous,
    runExperiment: (seed, intervention) => {
      const seedNum = Math.max(0, typeof seed === 'number' ? seed : 42);
      const inter = intervention || 'none';
      document.getElementById('seed').value = seedNum;
      document.getElementById('intervention').value = inter;
      document.getElementById('runBtn').click();
    },
    getDivergence: () => {
      const tracesA = window.CHRONOFLY._lastTracesA;
      const tracesB = window.CHRONOFLY._lastTracesB;
      if (!tracesA || !tracesB) return null;
      let sum = 0;
      for (let i = 0; i < tracesA.length; i += 1) {
        const d = tracesA[i] - tracesB[i];
        sum += d * d;
      }
      return sum / tracesA.length;
    }
  };
});