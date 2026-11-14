/**
 * Playing a test: hints, answers and skips for the current question (SPEC §7.2 rules, §8).
 * All writes for one action happen in one atomic batch whose statements re-check, in their WHERE
 * clauses, that the question is still current — so concurrent requests cannot corrupt a test.
 * @module server/services/answers
 */
import { charOutcomes, compareAnswer, detectScript } from '../../shared/kana.js';
import { ApiError, Validator, notFound, validationError } from '../http.js';
import { questionPoints } from './scoring.js';
import { testMode } from './tests.js';

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

/** @returns {ApiError} */
const testNotActive = () => new ApiError('TEST_NOT_ACTIVE',
  'This test has already finished. Start a new test to keep practising.');
/** @returns {ApiError} */
const questionNotCurrent = () => new ApiError('QUESTION_NOT_CURRENT',
  'This question is no longer the current one. Reload to continue.');

/**
 * Enforce "active test" and "current question" on freshly read rows.
 * @param {Record<string, any>|undefined} test
 * @param {Record<string, any>|undefined} q
 * @throws {ApiError} NOT_FOUND, TEST_NOT_ACTIVE, QUESTION_NOT_CURRENT
 */
function assertCurrent(test, q) {
  if (!test) throw notFound('Test not found.');
  if (test.status !== 'active') throw testNotActive();
  if (!q) throw notFound('Question not found.');
  if (q.status !== 'pending' || q.position !== test.current_index) throw questionNotCurrent();
}

/**
 * Load the test and question in one round trip, enforcing "active test" and "current question".
 * The writes that follow re-check the same conditions in their WHERE clauses, because another
 * request may answer the question in between.
 * @returns {Promise<{ test: Record<string, any>, q: Record<string, any> }>}
 * @throws {ApiError} NOT_FOUND, TEST_NOT_ACTIVE, QUESTION_NOT_CURRENT
 */
async function loadCurrent(db, userId, testId, questionId) {
  const [[test], [q]] = await db.read([
    ['SELECT * FROM tests WHERE id = ? AND user_id = ?', [testId, userId]],
    ['SELECT * FROM test_questions WHERE id = ? AND test_id = ?', [questionId, testId]],
  ]);
  assertCurrent(test, q);
  return { test, q };
}

/**
 * Guard shared by the writes of one action, with `?1` test id, `?2` user id, `?3` position of
 * the question and `?4` question id: the test is still active at that position and the question
 * is still pending. Statements using it take those four arguments first (see {@link guardArgs}).
 */
const STILL_CURRENT = `EXISTS (SELECT 1 FROM tests WHERE id = ?1 AND user_id = ?2 AND status = 'active' AND current_index = ?3)
  AND EXISTS (SELECT 1 FROM test_questions WHERE id = ?4 AND test_id = ?1 AND position = ?3 AND status = 'pending')`;

/**
 * {@link STILL_CURRENT} plus `?5`–`?7`: the question's hint flags are still the ones the score was
 * computed from (a hint used meanwhile changes the score).
 */
const STILL_AS_READ = `${STILL_CURRENT}
  AND EXISTS (SELECT 1 FROM test_questions WHERE id = ?4 AND hint1_used = ?5 AND hint2_used = ?6 AND hint3_used = ?7)`;

/**
 * Guard arguments for {@link STILL_CURRENT} (4) or, with `withHints`, {@link STILL_AS_READ} (7).
 * @param {{ id: number }} test
 * @param {number} userId
 * @param {Record<string, any>} q question row
 * @param {boolean} withHints
 * @returns {unknown[]}
 */
function guardArgs(test, userId, q, withHints) {
  const args = [test.id, userId, q.position, q.id];
  return withHints ? [...args, q.hint1_used, q.hint2_used, q.hint3_used] : args;
}

/** errorTypes whose answers add nothing to char_stats. */
export const CHAR_STATS_SKIP = new Set(['script', 'empty', 'variant']);

/**
 * Use a hint on the current question (idempotent). The romaji hint exists only in listen mode.
 * One read, then (unless the hint was already used) one guarded write batch: the counter and the
 * flag only change while the flag is still 0, so double clicks count once.
 * @param {import('../db.js').Database} db
 * @param {number} userId
 * @param {number} testId
 * @param {number} questionId
 * @param {'script'|'spelling'|'romaji'} type
 * @param {Date} [now]
 * @returns {Promise<{ test: Record<string, any>, question: Record<string, any> }>} the test row and
 *          the updated question row
 * @throws {ApiError} VALIDATION_ERROR for the romaji hint outside listen mode
 */
export async function useHint(db, userId, testId, questionId, type, now = new Date()) {
  const { test, q } = await loadCurrent(db, userId, testId, questionId);
  if (type === 'romaji' && testMode(test) !== 'listen') {
    const message = 'The romaji hint is only available in listen mode.';
    throw validationError({ type: message }, message);
  }
  const [usedColumn, countColumn] = HINT_COLUMNS[type];
  if (q[usedColumn] === 1) return { test, question: q };
  const guard = guardArgs(test, userId, q, false);
  const results = await db.batch([
    [`UPDATE tests SET ${countColumn} = ${countColumn} + 1, updated_at = ?5
      WHERE id = ?1 AND ${STILL_CURRENT}
        AND EXISTS (SELECT 1 FROM test_questions WHERE id = ?4 AND ${usedColumn} = 0)`, [...guard, now.toISOString()]],
    [`UPDATE test_questions SET ${usedColumn} = 1 WHERE id = ?4 AND ${usedColumn} = 0 AND ${STILL_CURRENT}`, guard],
    ['SELECT * FROM tests WHERE id = ? AND user_id = ?', [test.id, userId]],
    ['SELECT * FROM test_questions WHERE id = ?', [q.id]],
  ]);
  const [updated] = results[2].rows;
  const [question] = results[3].rows;
  // Lost a race with an answer, skip, close or delete: report it like a sequential request would.
  if (question?.[usedColumn] !== 1) assertCurrent(updated, question);
  return { test: updated, question };
}

/**
 * Persist the outcome of the current question and advance the test, in one atomic write batch.
 * Every write is guarded by {@link STILL_AS_READ} and the test update comes last, guarded by
 * "still at this position and the question now carries this answer's timestamp": of two
 * concurrent answers (double submit, two tabs) exactly one batch applies and the other changes
 * nothing and gets QUESTION_NOT_CURRENT (or TEST_NOT_ACTIVE), as if it had arrived second.
 * @param {import('../db.js').Database} db
 * @param {number} userId
 * @param {Record<string, any>} test tests row read before
 * @param {Record<string, any>} q the current question, read before
 * @param {object} outcome
 * @param {{ char: string, correct: boolean }[]} chars per-character results for char_stats
 * @param {Date} now
 * @returns {Promise<{ test: Record<string, any>, question: Record<string, any>,
 *             next: Record<string, any>|null, completed: boolean, firstSeen: boolean }|null>}
 *          null when nothing was written only because a hint was used meanwhile (recompute)
 * @throws {ApiError} TEST_NOT_ACTIVE / QUESTION_NOT_CURRENT / NOT_FOUND when another request won
 */
async function finishQuestion(db, userId, test, q, outcome, chars, now) {
  const nowIso = now.toISOString();
  const { status, userAnswer, errorType, points, timeMs, hint2From, hint2Revealed, inputMethod = null } = outcome;
  const nextIndex = test.current_index + 1;
  const completed = nextIndex >= test.total_questions;
  const correct = status === 'correct' ? 1 : 0;
  const guard = guardArgs(test, userId, q, true);

  const results = await db.batch([
    ['SELECT seen FROM vocab_progress WHERE user_id = ? AND word_id = ?', [userId, q.word_id]],
    ...chars.map((o) => [`INSERT INTO char_stats (user_id, char, script, correct, wrong)
      SELECT ?2, ?8, ?9, ?10, ?11 WHERE ${STILL_AS_READ}
      ON CONFLICT (user_id, char) DO UPDATE SET correct = correct + excluded.correct, wrong = wrong + excluded.wrong`,
    [...guard, o.char, detectScript(o.char) === 'hiragana' ? 'hiragana' : 'katakana', o.correct ? 1 : 0, o.correct ? 0 : 1]]),
    [`INSERT INTO vocab_progress (user_id, word_id, seen, correct, wrong, last_result, last_seen_at)
      SELECT ?2, ?8, 1, ?9, ?10, ?11, ?12 WHERE ${STILL_AS_READ}
      ON CONFLICT (user_id, word_id) DO UPDATE SET seen = seen + 1, correct = correct + excluded.correct,
        wrong = wrong + excluded.wrong, last_result = excluded.last_result, last_seen_at = excluded.last_seen_at`,
    [...guard, q.word_id, correct, 1 - correct, status, nowIso]],
    [`UPDATE users SET updated_at = ?8 WHERE id = ?2 AND ${STILL_AS_READ}`, [...guard, nowIso]],
    [`UPDATE test_questions SET status = ?8, user_answer = ?9, error_type = ?10, points = ?11, time_ms = ?12,
        hint2_from = ?13, hint2_revealed = ?14, input_method = ?15, answered_at = ?16
      WHERE id = ?4 AND ${STILL_AS_READ}`,
    [...guard, status, userAnswer, errorType, points, timeMs, hint2From, hint2Revealed, inputMethod, nowIso]],
    // Last: once current_index moves on, the guards above no longer hold for anyone.
    [`UPDATE tests SET current_index = ?3 + 1, score = score + ?5,
        correct_count = correct_count + ?6, wrong_count = wrong_count + ?7, skipped_count = skipped_count + ?8,
        current_streak = CASE WHEN ?6 = 1 THEN current_streak + 1 ELSE 0 END,
        best_streak = MAX(best_streak, CASE WHEN ?6 = 1 THEN current_streak + 1 ELSE 0 END),
        time_spent_ms = time_spent_ms + ?9, status = ?10, finished_at = ?11, updated_at = ?12
      WHERE id = ?1 AND user_id = ?2 AND status = 'active' AND current_index = ?3
        AND EXISTS (SELECT 1 FROM test_questions WHERE id = ?4 AND status != 'pending' AND answered_at = ?12)`,
    [test.id, userId, test.current_index, q.id, points, correct, status === 'wrong' ? 1 : 0,
      status === 'skipped' ? 1 : 0, timeMs, completed ? 'completed' : 'active', completed ? nowIso : null, nowIso]],
    ['SELECT * FROM tests WHERE id = ? AND user_id = ?', [test.id, userId]],
    ['SELECT * FROM test_questions WHERE id = ?', [q.id]],
    ['SELECT * FROM test_questions WHERE test_id = ? AND position = ?', [test.id, nextIndex]],
  ]);
  const [previous] = results[0].rows;
  const [advanced, { rows: [updatedTest] }, { rows: [question] }, { rows: [next] }] = results.slice(-4);
  if (advanced.changes !== 1) {
    assertCurrent(updatedTest, question); // throws unless the question is still current
    return null;
  }
  return {
    test: updatedTest,
    question,
    next: completed ? null : next ?? null,
    completed,
    firstSeen: !previous || previous.seen === 0,
  };
}

/** Recompute-and-write attempts when hints keep landing between an answer's read and write. */
const FINISH_ATTEMPTS = 3;

/**
 * Read the current question, compute its outcome and write it, recomputing when a hint was used
 * in between (optimistic concurrency).
 * @param {import('../db.js').Database} db
 * @param {number} userId
 * @param {number} testId
 * @param {number} questionId
 * @param {(test: Record<string, any>, q: Record<string, any>) => { outcome: object,
 *          chars: { char: string, correct: boolean }[] }} compute
 * @param {Date} now
 * @returns {Promise<NonNullable<Awaited<ReturnType<typeof finishQuestion>>>>}
 */
async function settleQuestion(db, userId, testId, questionId, compute, now) {
  for (let attempt = 1; ; attempt += 1) {
    const { test, q } = await loadCurrent(db, userId, testId, questionId);
    const { outcome, chars } = compute(test, q);
    const done = await finishQuestion(db, userId, test, q, outcome, chars, now);
    if (done) return done;
    if (attempt >= FINISH_ATTEMPTS) throw questionNotCurrent();
  }
}

/**
 * Check and score an answer for the current question: one read and one write batch.
 * @param {import('../db.js').Database} db
 * @param {number} userId
 * @param {number} testId
 * @param {number} questionId
 * @param {ReturnType<typeof parseAnswerInput>} input
 * @param {Date} [now]
 * @returns {ReturnType<typeof settleQuestion>}
 */
export function answerQuestion(db, userId, testId, questionId, input, now = new Date()) {
  return settleQuestion(db, userId, testId, questionId, (test, q) => {
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
    const limit = hint2Used ? (hint2From ?? 0) : Infinity;
    const chars = CHAR_STATS_SKIP.has(cmp.errorType) ? []
      : charOutcomes(q.kana, cmp.normalized).filter((o) => o.index < limit);
    return {
      outcome: {
        status, userAnswer: cmp.normalized, errorType: cmp.errorType, points,
        timeMs: input.timeMs, hint2From, hint2Revealed, inputMethod: input.inputMethod ?? 'keys',
      },
      chars,
    };
  }, now);
}

/**
 * Skip the current question (0 points, counts as a miss).
 * @param {import('../db.js').Database} db
 * @param {number} userId
 * @param {number} testId
 * @param {number} questionId
 * @param {ReturnType<typeof parseSkipInput>} input
 * @param {Date} [now]
 * @returns {ReturnType<typeof settleQuestion>}
 */
export function skipQuestion(db, userId, testId, questionId, input, now = new Date()) {
  return settleQuestion(db, userId, testId, questionId, () => ({
    outcome: {
      status: 'skipped', userAnswer: null, errorType: 'skipped', points: 0,
      timeMs: input.timeMs, hint2From: null, hint2Revealed: 0,
    },
    chars: [],
  }), now);
}
