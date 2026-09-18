import './engine.js';

/**
 * ONEIRO — Sleep‑Replay Maze Observatory
 * Bootstraps the deterministic sleep‑replay simulation.
 * No other dependencies; all logic lives in engine.js.
 */
document.addEventListener('DOMContentLoaded', () => {
  window.ONEIRO = {
    runExperiment: (seed) => {
      const s = typeof seed === 'number' ? Math.max(0, seed) : 123;
      document.getElementById('seed').value = s;
      document.getElementById('runBtn').click();
    },
    getSWRCount: () => {
      if (!currentResult) return null;
      return currentResult.replayEvents.length;
    }
  };
});