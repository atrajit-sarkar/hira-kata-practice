/**
 * Pure scoring, grading and ratio helpers (SPEC §8).
 * @module server/services/scoring
 */

/** Maximum points for one question. */
export const MAX_POINTS = 100;
/** Points a correct answer is worth at minimum, whatever hints were used. */
export const MIN_CORRECT_POINTS = 10;
/** Penalty for the script hint. */
export const HINT1_PENALTY = 20;
/** Maximum penalty for guided spelling (scaled by revealed characters). */
export const HINT2_MAX_PENALTY = 60;
/** Minimum penalty once guided spelling was used. */
export const HINT2_MIN_PENALTY = 10;
/** Penalty for the romaji hint (listen mode, SPEC §15.2). */
export const ROMAJI_HINT_PENALTY = 30;
/** Penalty for a same-sound, non-standard spelling accepted in listen mode (SPEC §15.2). */
export const VARIANT_PENALTY = 30;

/** Grade thresholds, best first. */
export const GRADES = Object.freeze([
  Object.freeze({ grade: 'S', kanji: '秀', min: 0.95 }),
  Object.freeze({ grade: 'A', kanji: '優', min: 0.85 }),
  Object.freeze({ grade: 'B', kanji: '良', min: 0.7 }),
  Object.freeze({ grade: 'C', kanji: '可', min: 0.5 }),
  Object.freeze({ grade: 'D', kanji: '不可', min: -Infinity }),
]);

/**
 * Points for one question (SPEC §8, §15.2):
 * `penalty = 20·hint1 + hint2Penalty + 30·romajiHint + 30·variant`, `points = max(10, 100 − penalty)`
 * for correct answers, 0 otherwise.
 * @param {{ status: 'correct'|'wrong'|'skipped', hint1Used?: boolean, hint2Used?: boolean,
 *           hint2Revealed?: number, romajiHintUsed?: boolean, variant?: boolean, len: number }} q
 *           `len` = expected length in code points; `variant` = accepted non-standard spelling
 * @returns {number} 0..100
 */
export function questionPoints({
  status, hint1Used = false, hint2Used = false, hint2Revealed = 0, romajiHintUsed = false, variant = false, len,
}) {
  if (status !== 'correct') return 0;
  let penalty = hint1Used ? HINT1_PENALTY : 0;
  if (hint2Used) {
    const ratio = len > 0 ? Math.min(1, Math.max(0, hint2Revealed) / len) : 1;
    penalty += Math.max(HINT2_MIN_PENALTY, Math.round(HINT2_MAX_PENALTY * ratio));
  }
  if (romajiHintUsed) penalty += ROMAJI_HINT_PENALTY;
  if (variant) penalty += VARIANT_PENALTY;
  return Math.max(MIN_CORRECT_POINTS, MAX_POINTS - penalty);
}

/**
 * Letter grade for a score ratio.
 * @param {number|null} scorePercent 0..1, or null when nothing was answered
 * @returns {'S'|'A'|'B'|'C'|'D'|null}
 */
export function gradeFor(scorePercent) {
  if (scorePercent === null || scorePercent === undefined || Number.isNaN(scorePercent)) return null;
  return GRADES.find((g) => scorePercent >= g.min).grade;
}

/**
 * Round a ratio to 3 decimals.
 * @param {number} value
 * @returns {number}
 */
export function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * `part / whole` rounded to 3 decimals, 0 when `whole` is 0.
 * @param {number} part
 * @param {number} whole
 * @returns {number}
 */
export function ratio(part, whole) {
  return whole > 0 ? round3(part / whole) : 0;
}

/**
 * Derived test metrics (SPEC §8).
 * @param {{ totalQuestions: number, score: number, correct: number, wrong: number, skipped: number }} t
 * @returns {{ answered: number, accuracy: number, maxScore: number, answeredMaxScore: number,
 *             scorePercent: number, grade: string|null }}
 */
export function testMetrics({ totalQuestions, score, correct, wrong, skipped }) {
  const answered = correct + wrong + skipped;
  const answeredMaxScore = answered * MAX_POINTS;
  const scorePercent = ratio(score, answeredMaxScore);
  return {
    answered,
    accuracy: ratio(correct, answered),
    maxScore: totalQuestions * MAX_POINTS,
    answeredMaxScore,
    scorePercent,
    grade: answered > 0 ? gradeFor(answeredMaxScore > 0 ? score / answeredMaxScore : 0) : null,
  };
}
