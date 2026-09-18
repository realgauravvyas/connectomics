import './engine.js';

/**
 * ONEIRO — Sleep‑Replay Maze Observatory
 * Bootstraps the deterministic sleep‑replay simulation.
 * No other dependencies; all logic lives in engine.js.
 */
document.addEventListener('DOMContentLoaded', () => {
  const previous = window.ONEIRO || {};
  window.ONEIRO = {
    ...previous,
    runExperiment: (seed) => {
      const s = typeof seed === 'number' ? Math.max(0, seed) : 123;
      document.getElementById('seed').value = s;
      document.getElementById('runBtn').click();
    },
    getSWRCount: () => {
      const result = window.ONEIRO._lastResult;
      if (!result) return null;
      return result.replayEvents.length;
    }
  };
});