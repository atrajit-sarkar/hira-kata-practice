/**
 * Per-question memo in sessionStorage so a reload keeps the learner's draft answer and the
 * guided-mode bookkeeping (hint2From, revealed positions) and the keyboard script. Every access tolerates storage being
 * unavailable: the page works the same, it just forgets on reload.
 * @module practice/memo
 */

const PREFIX = 'hk-practice-q-';

/**
 * @typedef {object} QuestionMemo
 * @property {string} [draft]          raw input value
 * @property {number} [hint2From]      matched prefix length when guided mode was turned on
 * @property {number[]} [revealed]     positions revealed by guided mode
 * @property {'hiragana'|'katakana'} [script] on-screen keyboard script the learner chose
 */

/**
 * Read the memo for a question.
 * @param {number} questionId
 * @returns {QuestionMemo}
 */
export function readMemo(questionId) {
  try {
    const raw = sessionStorage.getItem(PREFIX + questionId);
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/**
 * Merge fields into the memo for a question.
 * @param {number} questionId
 * @param {QuestionMemo} patch
 */
export function writeMemo(questionId, patch) {
  try {
    const next = { ...readMemo(questionId), ...patch };
    sessionStorage.setItem(PREFIX + questionId, JSON.stringify(next));
  } catch { /* storage unavailable or full: nothing to keep */ }
}

/**
 * Forget a question's memo (after it has been answered or skipped).
 * @param {number} questionId
 */
export function clearMemo(questionId) {
  try { sessionStorage.removeItem(PREFIX + questionId); } catch { /* ignore */ }
}
