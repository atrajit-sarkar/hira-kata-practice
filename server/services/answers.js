/**
 * Playing a test: hints, answers and skips for the current question (SPEC §7.2 rules, §8).
 * All writes for one action happen in a single transaction.
 * @module server/services/answers
 */
import { charOutcomes, compareAnswer, detectScript } from '../../shared/kana.js';
import { stmt, tx } from '../db.js';
import { ApiError, Validator, notFound, validationError } from '../http.js';
import { questionPoints } from './scoring.js';
import { findTest, testMode } from './tests.js';

export const HINT_TYPES = Object.freeze(['script', 'spelling', 'romaji']);
/** Input methods an answer can be given with (SPEC §15.3). */
export const INPUT_METHODS = Object.freeze(['keys', 'handwriting', 'device']);
/** Hint type → [test_questions flag column, tests counter column]. */
const HINT_COLUMNS = Object.freeze({
  script: ['hint1_used', 'hint1_count'],
  spelling: ['hint2_used', 'hint2_count'],
  romaji: ['hint3_used', 'hint3_count'],
});
export const ANSWER_MAX_CHARS = 64;
export const TIME_MS_MAX = 3_600_000;

/**
 * Read an optional finite number as a non-negative integer.
 * @param {Validator} v
 * @param {string} key
 * @param {string} label
 * @returns {number|null}
 */
function optionalCount(v, key, label) {
  if (!v.has(key)) return null;
  const raw = v.source[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return v.fail(key, `${label} must be a number.`) ?? null;
  return Math.max(0, Math.floor(raw));
}

/**
 * Read `timeMs`, clamped to 0..3 600 000 (missing → 0).
 * @param {Validator} v
 * @returns {number}
 */
function readTimeMs(v) {
  if (!v.has('timeMs')) return 0;
  const raw = v.source.timeMs;
  if (typeof raw !== 'number' || Number.isNaN(raw)) return v.fail('timeMs', 'Time must be a number.') ?? 0;
  return Math.min(TIME_MS_MAX, Math.max(0, Math.round(raw)));
}

/**
 * Validate an answer body `{ answer, timeMs, hint2From?, hint2Revealed?, inputMethod? }`.
 * @param {Record<string, unknown>} body
 * @returns {{ answer: string, timeMs: number, hint2From: number|null, hint2Revealed: number|null,
 *             inputMethod: 'keys'|'handwriting'|'device' }}
 */
export function parseAnswerInput(body) {
  const v = new Validator(body);
  const answer = v.has('answer')
    ? v.string('answer', { max: ANSWER_MAX_CHARS, trim: false, label: 'Answer' })
    : '';
  const timeMs = readTimeMs(v);
  const hint2From = optionalCount(v, 'hint2From', 'hint2From');
  const hint2Revealed = optionalCount(v, 'hint2Revealed', 'hint2Revealed');
  const inputMethod = v.oneOf('inputMethod', INPUT_METHODS, { optional: true, label: 'Input method' }) ?? 'keys';
  v.assert();
  return { answer, timeMs, hint2From, hint2Revealed, inputMethod };
}

/**
 * Validate a skip body `{ timeMs }`.
 * @param {Record<string, unknown>} body
 * @returns {{ timeMs: number }}
 */
export function parseSkipInput(body) {
  const v = new Validator(body);
  const timeMs = readTimeMs(v);
  v.assert();
  return { timeMs };
}

/**
 * Load the test and question, enforcing "active test" and "current question".
 * @returns {{ test: Record<string, any>, q: Record<string, any> }}
 * @throws {ApiError} NOT_FOUND, TEST_NOT_ACTIVE, QUESTION_NOT_CURRENT
 */
function loadCurrent(db, userId, testId, questionId) {
  const test = findTest(db, userId, testId);
  if (test.status !== 'active') {
    throw new ApiError('TEST_NOT_ACTIVE', 'This test has already finished. Start a new test to keep practising.');
  }
  const q = stmt(db, 'SELECT * FROM test_questions WHERE id = ? AND test_id = ?').get(questionId, test.id);
  if (!q) throw notFound('Question not found.');
  if (q.status !== 'pending' || q.position !== test.current_index) {
    throw new ApiError('QUESTION_NOT_CURRENT', 'This question is no longer the current one. Reload to continue.');
  }
  return { test, q };
}

/** errorTypes whose answers add nothing to char_stats. */
export const CHAR_STATS_SKIP = new Set(['script', 'empty', 'variant']);

const getQuestion = (db, id) => stmt(db, 'SELECT * FROM test_questions WHERE id = ?').get(id);

/**
 * Use a hint on the current question (idempotent). The romaji hint exists only in listen mode.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @param {number} testId
 * @param {number} questionId
 * @param {'script'|'spelling'|'romaji'} type
 * @param {Date} [now]
 * @returns {{ test: Record<string, any>, question: Record<string, any> }} the test row and the
 *          updated question row
 * @throws {ApiError} VALIDATION_ERROR for the romaji hint outside listen mode
 */
export function useHint(db, userId, testId, questionId, type, now = new Date()) {
  return tx(db, () => {
    const { test, q } = loadCurrent(db, userId, testId, questionId);
    if (type === 'romaji' && testMode(test) !== 'listen') {
      const message = 'The romaji hint is only available in listen mode.';
      throw validationError({ type: message }, message);
    }
    const [usedColumn, countColumn] = HINT_COLUMNS[type];
    if (q[usedColumn] !== 1) {
      stmt(db, `UPDATE test_questions SET ${usedColumn} = 1 WHERE id = ?`).run(q.id);
      stmt(db, `UPDATE tests SET ${countColumn} = ${countColumn} + 1, updated_at = ? WHERE id = ?`)
        .run(now.toISOString(), test.id);
    }
    return { test: findTest(db, userId, test.id), question: getQuestion(db, q.id) };
  });
}

/**
 * Persist the outcome of the current question and advance the test.
 * @returns {{ test: Record<string, any>, question: Record<string, any>, next: Record<string, any>|null,
 *             completed: boolean, firstSeen: boolean }}
 */
function finishQuestion(db, userId, test, q, outcome, now) {
  const nowIso = now.toISOString();
  const { status, userAnswer, errorType, points, timeMs, hint2From, hint2Revealed, inputMethod = null } = outcome;
  stmt(db, `UPDATE test_questions SET status = ?, user_answer = ?, error_type = ?, points = ?, time_ms = ?,
              hint2_from = ?, hint2_revealed = ?, input_method = ?, answered_at = ? WHERE id = ?`)
    .run(status, userAnswer, errorType, points, timeMs, hint2From, hint2Revealed, inputMethod, nowIso, q.id);

  const nextIndex = test.current_index + 1;
  const completed = nextIndex >= test.total_questions;
  const correct = status === 'correct';
  const streak = correct ? test.current_streak + 1 : 0;
  stmt(db, `UPDATE tests SET current_index = ?, score = score + ?,
              correct_count = correct_count + ?, wrong_count = wrong_count + ?, skipped_count = skipped_count + ?,
              current_streak = ?, best_streak = MAX(best_streak, ?), time_spent_ms = time_spent_ms + ?,
              status = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
    .run(nextIndex, points, correct ? 1 : 0, status === 'wrong' ? 1 : 0, status === 'skipped' ? 1 : 0,
      streak, streak, timeMs, completed ? 'completed' : 'active', completed ? nowIso : null, nowIso, test.id);

  const previous = stmt(db, 'SELECT seen FROM vocab_progress WHERE user_id = ? AND word_id = ?').get(userId, q.word_id);
  stmt(db, `INSERT INTO vocab_progress (user_id, word_id, seen, correct, wrong, last_result, last_seen_at)
            VALUES (?, ?, 1, ?, ?, ?, ?)
            ON CONFLICT (user_id, word_id) DO UPDATE SET seen = seen + 1, correct = correct + excluded.correct,
              wrong = wrong + excluded.wrong, last_result = excluded.last_result, last_seen_at = excluded.last_seen_at`)
    .run(userId, q.word_id, correct ? 1 : 0, correct ? 0 : 1, status, nowIso);
  stmt(db, 'UPDATE users SET updated_at = ? WHERE id = ?').run(nowIso, userId);

  const updatedTest = findTest(db, userId, test.id);
  const next = completed ? null
    : stmt(db, 'SELECT * FROM test_questions WHERE test_id = ? AND position = ?').get(test.id, nextIndex) ?? null;
  return { test: updatedTest, question: getQuestion(db, q.id), next, completed, firstSeen: !previous || previous.seen === 0 };
}

/**
 * Add per-character outcomes to char_stats.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @param {{ char: string, correct: boolean }[]} outcomes
 */
function recordCharStats(db, userId, outcomes) {
  const upsert = stmt(db, `INSERT INTO char_stats (user_id, char, script, correct, wrong) VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT (user_id, char) DO UPDATE SET correct = correct + excluded.correct,
                             wrong = wrong + excluded.wrong`);
  for (const o of outcomes) {
    upsert.run(userId, o.char, detectScript(o.char) === 'hiragana' ? 'hiragana' : 'katakana',
      o.correct ? 1 : 0, o.correct ? 0 : 1);
  }
}

/**
 * Check and score an answer for the current question.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @param {number} testId
 * @param {number} questionId
 * @param {ReturnType<typeof parseAnswerInput>} input
 * @param {Date} [now]
 * @returns {ReturnType<typeof finishQuestion>}
 */
export function answerQuestion(db, userId, testId, questionId, input, now = new Date()) {
  return tx(db, () => {
    const { test, q } = loadCurrent(db, userId, testId, questionId);
    const len = [...q.kana].length;
    const cmp = compareAnswer(q.kana, input.answer, { mode: testMode(test) });
    const status = cmp.correct ? 'correct' : 'wrong';
    const hint2Used = q.hint2_used === 1;
    const hint2From = hint2Used && input.hint2From !== null ? Math.min(len, input.hint2From) : null;
    const hint2Revealed = !hint2Used ? 0
      : input.hint2Revealed !== null ? Math.min(len, input.hint2Revealed) : len - (hint2From ?? 0);
    const points = questionPoints({
      status, hint1Used: q.hint1_used === 1, hint2Used, hint2Revealed, len,
      romajiHintUsed: q.hint3_used === 1, variant: cmp.errorType === 'variant',
    });

    // Script errors, empty answers and accepted sound-alike variants say nothing reliable about
    // individual characters (SPEC §8, §15.2).
    if (!CHAR_STATS_SKIP.has(cmp.errorType)) {
      const limit = hint2Used ? (hint2From ?? 0) : Infinity;
      recordCharStats(db, userId, charOutcomes(q.kana, cmp.normalized).filter((o) => o.index < limit));
    }
    return finishQuestion(db, userId, test, q, {
      status, userAnswer: cmp.normalized, errorType: cmp.errorType, points,
      timeMs: input.timeMs, hint2From, hint2Revealed, inputMethod: input.inputMethod ?? 'keys',
    }, now);
  });
}

/**
 * Skip the current question (0 points, counts as a miss).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @param {number} testId
 * @param {number} questionId
 * @param {ReturnType<typeof parseSkipInput>} input
 * @param {Date} [now]
 * @returns {ReturnType<typeof finishQuestion>}
 */
export function skipQuestion(db, userId, testId, questionId, input, now = new Date()) {
  return tx(db, () => {
    const { test, q } = loadCurrent(db, userId, testId, questionId);
    return finishQuestion(db, userId, test, q, {
      status: 'skipped', userAnswer: null, errorType: 'skipped', points: 0,
      timeMs: input.timeMs, hint2From: null, hint2Revealed: 0,
    }, now);
  });
}
