/**
 * Per-question stopwatch that only counts while the tab is visible (SPEC §12.4).
 * @module practice/timer
 */

/** Upper bound accepted by the API (1 hour). */
const MAX_MS = 3_600_000;

/**
 * Create a visibility-aware stopwatch.
 * @returns {{start: () => void, stop: () => void, reset: () => void, elapsed: () => number,
 *   destroy: () => void}}
 */
export function createQuestionTimer() {
  let accumulated = 0;
  let runningSince = null;
  let wanted = false;

  const now = () => performance.now();
  const pause = () => {
    if (runningSince != null) {
      accumulated += now() - runningSince;
      runningSince = null;
    }
  };
  const resume = () => {
    if (wanted && runningSince == null && document.visibilityState === 'visible') runningSince = now();
  };
  const onVisibility = () => (document.visibilityState === 'visible' ? resume() : pause());
  document.addEventListener('visibilitychange', onVisibility);

  return {
    /** Start (or continue) counting. */
    start() { wanted = true; resume(); },
    /** Stop counting; elapsed time is kept. */
    stop() { wanted = false; pause(); },
    /** Zero the stopwatch and stop it. */
    reset() { wanted = false; runningSince = null; accumulated = 0; },
    /** @returns {number} visible milliseconds, clamped to the API range */
    elapsed() {
      const live = runningSince != null ? now() - runningSince : 0;
      return Math.min(MAX_MS, Math.max(0, Math.round(accumulated + live)));
    },
    destroy() { document.removeEventListener('visibilitychange', onVisibility); },
  };
}
