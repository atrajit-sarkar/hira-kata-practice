/**
 * Grade metadata and small result helpers shared by the results page modules (SPEC §8).
 * @module results/grade
 */

/** Japanese school grade marks for each letter grade, with reading and English meaning. */
export const GRADES = Object.freeze({
  S: Object.freeze({ kanji: '秀', reading: 'shū', label: 'Outstanding', message: 'Every stroke counted.' }),
  A: Object.freeze({ kanji: '優', reading: 'yū', label: 'Excellent', message: 'Just a few details to polish.' }),
  B: Object.freeze({ kanji: '良', reading: 'ryō', label: 'Good', message: 'Review the misses below to level up.' }),
  C: Object.freeze({ kanji: '可', reading: 'ka', label: 'Pass', message: 'Practise the mistakes to lock them in.' }),
  D: Object.freeze({ kanji: '不可', reading: 'fuka', label: 'Keep practising', message: 'Every miss is a word you now know better. Try them again.' }),
});

/** Grades that earn a celebration when the learner arrives fresh from a test. */
export const CELEBRATE_GRADES = new Set(['S', 'A', 'B']);

/**
 * @param {string|null} grade
 * @returns {{kanji: string, reading: string, label: string, message: string}|null}
 */
export function gradeInfo(grade) {
  return GRADES[grade] ?? null;
}

/** Human status labels for TestSummary.status. */
export const STATUS_LABEL = Object.freeze({ active: 'In progress', completed: 'Completed', closed: 'Ended early' });

/**
 * Per-script tallies of the answered questions (pending ones have no script snapshot exposed).
 * @param {Array<object>} questions items of GET /api/tests/:id
 * @returns {Record<'hiragana'|'katakana', {answered: number, correct: number}>}
 */
export function scriptBreakdown(questions) {
  const byScript = { hiragana: { answered: 0, correct: 0 }, katakana: { answered: 0, correct: 0 } };
  for (const q of questions) {
    const bucket = q.status === 'pending' ? null : byScript[q.script];
    if (!bucket) continue;
    bucket.answered += 1;
    if (q.status === 'correct') bucket.correct += 1;
  }
  return byScript;
}
