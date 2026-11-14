/**
 * Test lifecycle: creation (word selection), lookup, listing, close, rename, delete (SPEC §7.2).
 * Every query is scoped by user id.
 * @module server/services/tests
 */
import { ApiError, Validator, notFound } from '../http.js';
import { POOLS, POS_CATEGORIES } from './wordbank.js';
import { TITLE_MAX, defaultTitle, distinctByKana, selectRandomWords } from './selection.js';

export const TEST_STATUSES = Object.freeze(['active', 'completed', 'closed']);
export const CONFIG_SCRIPTS = Object.freeze(['hiragana', 'katakana', 'mixed']);
export const CONFIG_LEVELS = Object.freeze(['all', 1, 2, 3]);
export const CONFIG_POS = Object.freeze(['any', ...POS_CATEGORIES.filter((p) => p !== 'other')]);
export const CONFIG_JLPT = Object.freeze(['any', 5, 4, 3, 2, 1]);
export const TEST_SOURCES = Object.freeze(['random', 'review', 'test-mistakes']);
/** Practice modes (SPEC §15.2). */
export const TEST_MODES = Object.freeze(['romaji', 'listen']);
export const CONFIG_POOLS = POOLS;
export const COUNT_MIN = 5;
export const COUNT_MAX = 100;
export const DEFAULT_COUNT = 20;

/**
 * Read the word filters shared by TestConfig and `GET /api/words/count`.
 * @param {Validator} v
 * @returns {{ script: string, level: string|number, pos: string, jlpt: string|number, pool: string }}
 */
export function readWordFilters(v) {
  return {
    script: v.oneOf('script', CONFIG_SCRIPTS, { optional: true, label: 'Script' }) ?? 'mixed',
    level: v.oneOf('level', CONFIG_LEVELS, { optional: true, label: 'Level' }) ?? 'all',
    pos: v.oneOf('pos', CONFIG_POS, { optional: true, label: 'Word type' }) ?? 'any',
    jlpt: v.oneOf('jlpt', CONFIG_JLPT, { optional: true, label: 'JLPT level' }) ?? 'any',
    pool: v.oneOf('pool', CONFIG_POOLS, { optional: true, label: 'Word pool' }) ?? 'all',
  };
}

/**
 * Validate a title (1–80 chars after trim, no control characters).
 * @param {Validator} v
 * @param {boolean} optional
 * @returns {string|undefined}
 */
export function readTitle(v, optional) {
  return v.string('title', { min: optional ? 0 : 1, max: TITLE_MAX, optional, noControl: true, label: 'Title' });
}

/**
 * Validate a `POST /api/tests` body.
 * @param {Record<string, unknown>} body
 * @returns {{ title: string|null, filters: ReturnType<typeof readWordFilters>, count: number|null,
 *             source: string, sourceTestId: number|null, mode: 'romaji'|'listen' }}
 * @throws {ApiError} VALIDATION_ERROR
 */
export function parseCreateInput(body) {
  const v = new Validator(body);
  const filters = readWordFilters(v);
  const source = v.oneOf('source', TEST_SOURCES, { optional: true, label: 'Source' }) ?? 'random';
  const mode = v.oneOf('mode', TEST_MODES, { optional: true, label: 'Mode' }) ?? 'romaji';
  const count = v.int('count', { min: COUNT_MIN, max: COUNT_MAX, optional: true, label: 'Word count' }) ?? null;
  const sourceTestId = source === 'test-mistakes' ? v.int('sourceTestId', { min: 1, label: 'Source test' }) : null;
  const title = readTitle(v, true);
  v.assert();
  return { title: title || null, filters, count, source, sourceTestId: sourceTestId ?? null, mode };
}

/**
 * A stored TestConfig with v2 defaults filled in: tests created before v2 have no `mode`/`pool`
 * and are romaji tests over the (then common-only) bank.
 * @param {string|object|null|undefined} config JSON text or parsed object
 * @returns {Record<string, any>}
 */
export function normalizeConfig(config) {
  let parsed = config;
  if (typeof config === 'string') {
    try {
      parsed = JSON.parse(config);
    } catch {
      parsed = {};
    }
  }
  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  return {
    ...obj,
    pool: CONFIG_POOLS.includes(obj.pool) ? obj.pool : 'all',
    mode: TEST_MODES.includes(obj.mode) ? obj.mode : 'romaji',
  };
}

/**
 * Practice mode of a tests row.
 * @param {{ config: string }} test
 * @returns {'romaji'|'listen'}
 */
export function testMode(test) {
  return normalizeConfig(test.config).mode;
}

/**
 * Load a test owned by the user.
 * @param {import('../db.js').Database} db
 * @param {number} userId
 * @param {number} testId
 * @returns {Promise<Record<string, any>>}
 * @throws {ApiError} NOT_FOUND
 */
export async function findTest(db, userId, testId) {
  const row = await db.get('SELECT * FROM tests WHERE id = ? AND user_id = ?', [testId, userId]);
  if (!row) throw notFound('Test not found.');
  return row;
}

/**
 * Load a test owned by the user and all its questions (position order) in one round trip.
 * @param {import('../db.js').Database} db
 * @param {number} userId
 * @param {number} testId
 * @returns {Promise<{ test: Record<string, any>, questions: Record<string, any>[] }>}
 * @throws {ApiError} NOT_FOUND
 */
export async function loadTest(db, userId, testId) {
  const [[test], questions] = await db.read([
    ['SELECT * FROM tests WHERE id = ? AND user_id = ?', [testId, userId]],
    [`SELECT * FROM test_questions WHERE test_id = ?1
      AND EXISTS (SELECT 1 FROM tests WHERE id = ?1 AND user_id = ?2) ORDER BY position`, [testId, userId]],
  ]);
  if (!test) throw notFound('Test not found.');
  return { test, questions };
}

/**
 * Words for a `review` test: the user's wrong/skipped words, most-missed first.
 * @returns {Promise<import('./selection.js').QuestionWord[]>}
 */
async function reviewWords(db, bank, userId, script) {
  const rows = await db.all(`
    SELECT word_id FROM vocab_progress
    WHERE user_id = ? AND last_result IN ('wrong', 'skipped')
    ORDER BY wrong DESC, last_seen_at DESC, word_id`, [userId]);
  return rows
    .map((r) => bank.get(r.word_id))
    .filter((w) => w && (script === 'mixed' || w.script === script));
}

/**
 * Words for a `test-mistakes` test: wrong/skipped questions of the source test, in order.
 * @returns {Promise<{ words: import('./selection.js').QuestionWord[], sourceTitle: string }>}
 */
async function mistakeWords(db, userId, sourceTestId) {
  const [[source], rows] = await db.read([
    ['SELECT id, title FROM tests WHERE id = ? AND user_id = ?', [sourceTestId, userId]],
    [`SELECT word_id AS id, kana, romaji, script FROM test_questions
      WHERE test_id = ?1 AND status IN ('wrong', 'skipped')
        AND EXISTS (SELECT 1 FROM tests WHERE id = ?1 AND user_id = ?2) ORDER BY position`, [sourceTestId, userId]],
  ]);
  if (!source) throw notFound('Source test not found.');
  return { words: rows, sourceTitle: source.title };
}

/** The newest test of a user — inside a write batch, the one the batch just inserted. */
const NEWEST_TEST = '(SELECT MAX(id) FROM tests WHERE user_id = ?)';

/**
 * Create a test and its questions: one read (word history) and one atomic write batch.
 * @param {{ db: import('../db.js').Database, bank: import('./wordbank.js').WordBank }} deps
 * @param {number} userId
 * @param {ReturnType<typeof parseCreateInput>} input
 * @param {{ rng?: () => number, now?: Date }} [options]
 * @returns {Promise<{ test: Record<string, any>, current: Record<string, any> }>} the new tests row
 *          and its first question
 * @throws {ApiError} NOT_ENOUGH_WORDS, NO_REVIEW_WORDS, NOT_FOUND (source test)
 */
export async function createTest({ db, bank }, userId, input, { rng = Math.random, now = new Date() } = {}) {
  const { filters, source } = input;
  let words;
  let sourceTitle = null;
  if (source === 'random') {
    const pool = bank.filter(filters);
    if (pool.length < 1) {
      throw new ApiError('NOT_ENOUGH_WORDS', 'No words match these filters. Try a broader selection.');
    }
    const seenIds = new Set((await db.all('SELECT word_id FROM vocab_progress WHERE user_id = ? AND seen > 0', [userId]))
      .map((r) => r.word_id));
    words = selectRandomWords({
      pool, count: input.count ?? DEFAULT_COUNT, script: filters.script,
      jlptAny: filters.jlpt === 'any', commonBoost: filters.pool === 'all', seenIds, rng,
    });
  } else {
    const found = source === 'review'
      ? { words: await reviewWords(db, bank, userId, filters.script), sourceTitle: null }
      : await mistakeWords(db, userId, input.sourceTestId);
    sourceTitle = found.sourceTitle;
    words = distinctByKana(found.words, input.count ?? COUNT_MAX);
    if (!words.length) {
      throw new ApiError('NO_REVIEW_WORDS', source === 'review'
        ? 'There are no words to review yet. Words you miss or skip will appear here.'
        : 'That test has no mistakes to practise.');
    }
  }
  const config = { ...filters, mode: input.mode ?? 'romaji', count: words.length, source, sourceTestId: input.sourceTestId };
  const title = input.title ?? defaultTitle(config, words.length, sourceTitle);
  const nowIso = now.toISOString();
  // The questions reference the test through NEWEST_TEST: the batch is one write transaction and
  // ids are AUTOINCREMENT, so that is the row inserted just before.
  const results = await db.batch([
    [`INSERT INTO tests (user_id, title, config, status, total_questions, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)`, [userId, title, JSON.stringify(config), words.length, nowIso, nowIso]],
    [`INSERT INTO test_questions (test_id, position, word_id, kana, romaji, script)
      SELECT ${NEWEST_TEST}, column1, column2, column3, column4, column5
      FROM (VALUES ${words.map(() => '(?, ?, ?, ?, ?)').join(', ')})`,
    [userId, ...words.flatMap((w, i) => [i, String(w.id), w.kana, w.romaji, w.script])]],
    [`SELECT * FROM tests WHERE id = ${NEWEST_TEST}`, [userId]],
    [`SELECT * FROM test_questions WHERE test_id = ${NEWEST_TEST} AND position = 0`, [userId]],
  ]);
  return { test: results[2].rows[0], current: results[3].rows[0] };
}

/**
 * The user's tests, newest `updated_at` first.
 * @param {import('../db.js').Database} db
 * @param {number} userId
 * @param {'all'|'active'|'completed'|'closed'} status
 * @returns {Promise<Record<string, any>[]>}
 */
export function listTests(db, userId, status = 'all') {
  return db.all(...listTestsQuery(userId, status));
}

/**
 * Query behind {@link listTests} (also used inside read batches).
 * @param {number} userId
 * @param {'all'|'active'|'completed'|'closed'} [status]
 * @returns {[string, unknown[]]}
 */
export function listTestsQuery(userId, status = 'all') {
  if (status === 'all') return ['SELECT * FROM tests WHERE user_id = ? ORDER BY updated_at DESC, id DESC', [userId]];
  return ['SELECT * FROM tests WHERE user_id = ? AND status = ? ORDER BY updated_at DESC, id DESC', [userId, status]];
}

/**
 * The current pending question of an active test, or null.
 * @param {Record<string, any>} test tests row
 * @param {Record<string, any>[]} questions the test's questions
 * @returns {Record<string, any>|null}
 */
export function currentQuestion(test, questions) {
  if (test.status !== 'active') return null;
  return questions.find((q) => q.position === test.current_index && q.status === 'pending') ?? null;
}

/**
 * The most recently answered question (highest position that is not pending), or null.
 * @param {Record<string, any>[]} questions
 * @returns {Record<string, any>|null}
 */
export function lastAnsweredQuestion(questions) {
  let last = null;
  for (const q of questions) {
    if (q.status !== 'pending' && (!last || q.position > last.position)) last = q;
  }
  return last;
}

/**
 * Close an active test (idempotent for finished tests). The status check is in the UPDATE, so a
 * close racing with the last answer cannot reopen or double-finish the test.
 * @returns {Promise<Record<string, any>>} updated tests row
 * @throws {ApiError} NOT_FOUND
 */
export async function closeTest(db, userId, testId, now = new Date()) {
  const nowIso = now.toISOString();
  const [, { rows: [test] }] = await db.batch([
    [`UPDATE tests SET status = 'closed', finished_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND status = 'active'`, [nowIso, nowIso, testId, userId]],
    ['SELECT * FROM tests WHERE id = ? AND user_id = ?', [testId, userId]],
  ]);
  if (!test) throw notFound('Test not found.');
  return test;
}

/**
 * Rename a test. `updated_at` is left alone: it tracks practice activity (the tests list is
 * ordered by it and shows it as the test's date), and a rename is not activity.
 * @returns {Promise<Record<string, any>>} updated tests row
 * @throws {ApiError} NOT_FOUND
 */
export async function renameTest(db, userId, testId, title) {
  const [, { rows: [test] }] = await db.batch([
    ['UPDATE tests SET title = ? WHERE id = ? AND user_id = ?', [title, testId, userId]],
    ['SELECT * FROM tests WHERE id = ? AND user_id = ?', [testId, userId]],
  ]);
  if (!test) throw notFound('Test not found.');
  return test;
}

/**
 * Delete a test and its questions (explicitly: foreign-key cascades are not relied on).
 * @throws {ApiError} NOT_FOUND
 */
export async function deleteTest(db, userId, testId) {
  const [, { changes }] = await db.batch([
    [`DELETE FROM test_questions WHERE test_id = ?1
      AND EXISTS (SELECT 1 FROM tests WHERE id = ?1 AND user_id = ?2)`, [testId, userId]],
    ['DELETE FROM tests WHERE id = ? AND user_id = ?', [testId, userId]],
  ]);
  if (!changes) throw notFound('Test not found.');
}
