/**
 * Test lifecycle: creation (word selection), lookup, listing, close, rename, delete (SPEC §7.2).
 * Every query is scoped by user id.
 * @module server/services/tests
 */
import { stmt, tx } from '../db.js';
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
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @param {number} testId
 * @returns {Record<string, any>}
 * @throws {ApiError} NOT_FOUND
 */
export function findTest(db, userId, testId) {
  const row = stmt(db, 'SELECT * FROM tests WHERE id = ? AND user_id = ?').get(testId, userId);
  if (!row) throw notFound('Test not found.');
  return row;
}

/**
 * Words for a `review` test: the user's wrong/skipped words, most-missed first.
 * @returns {import('./selection.js').QuestionWord[]}
 */
function reviewWords(db, bank, userId, script) {
  const rows = stmt(db, `
    SELECT word_id FROM vocab_progress
    WHERE user_id = ? AND last_result IN ('wrong', 'skipped')
    ORDER BY wrong DESC, last_seen_at DESC, word_id`).all(userId);
  return rows
    .map((r) => bank.get(r.word_id))
    .filter((w) => w && (script === 'mixed' || w.script === script));
}

/**
 * Words for a `test-mistakes` test: wrong/skipped questions of the source test, in order.
 * @returns {{ words: import('./selection.js').QuestionWord[], sourceTitle: string }}
 */
function mistakeWords(db, userId, sourceTestId) {
  const source = stmt(db, 'SELECT id, title FROM tests WHERE id = ? AND user_id = ?').get(sourceTestId, userId);
  if (!source) throw notFound('Source test not found.');
  const rows = stmt(db, `
    SELECT word_id AS id, kana, romaji, script FROM test_questions
    WHERE test_id = ? AND status IN ('wrong', 'skipped') ORDER BY position`).all(source.id);
  return { words: rows, sourceTitle: source.title };
}

/**
 * Create a test and its questions.
 * @param {{ db: import('node:sqlite').DatabaseSync, bank: import('./wordbank.js').WordBank }} deps
 * @param {number} userId
 * @param {ReturnType<typeof parseCreateInput>} input
 * @param {{ rng?: () => number, now?: Date }} [options]
 * @returns {number} new test id
 * @throws {ApiError} NOT_ENOUGH_WORDS, NO_REVIEW_WORDS, NOT_FOUND (source test)
 */
export function createTest({ db, bank }, userId, input, { rng = Math.random, now = new Date() } = {}) {
  const { filters, source } = input;
  let words;
  let sourceTitle = null;
  if (source === 'random') {
    const pool = bank.filter(filters);
    if (pool.length < 1) {
      throw new ApiError('NOT_ENOUGH_WORDS', 'No words match these filters. Try a broader selection.');
    }
    const seenIds = new Set(stmt(db, 'SELECT word_id FROM vocab_progress WHERE user_id = ? AND seen > 0')
      .all(userId).map((r) => r.word_id));
    words = selectRandomWords({
      pool, count: input.count ?? DEFAULT_COUNT, script: filters.script,
      jlptAny: filters.jlpt === 'any', commonBoost: filters.pool === 'all', seenIds, rng,
    });
  } else {
    const found = source === 'review'
      ? { words: reviewWords(db, bank, userId, filters.script), sourceTitle: null }
      : mistakeWords(db, userId, input.sourceTestId);
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
  return tx(db, () => {
    const { lastInsertRowid } = stmt(db, `
      INSERT INTO tests (user_id, title, config, status, total_questions, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)`)
      .run(userId, title, JSON.stringify(config), words.length, nowIso, nowIso);
    const testId = Number(lastInsertRowid);
    const insert = stmt(db, `INSERT INTO test_questions (test_id, position, word_id, kana, romaji, script)
                             VALUES (?, ?, ?, ?, ?, ?)`);
    words.forEach((w, i) => insert.run(testId, i, w.id, w.kana, w.romaji, w.script));
    return testId;
  });
}

/**
 * The user's tests, newest `updated_at` first.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @param {'all'|'active'|'completed'|'closed'} status
 * @returns {Record<string, any>[]}
 */
export function listTests(db, userId, status = 'all') {
  if (status === 'all') {
    return stmt(db, 'SELECT * FROM tests WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(userId);
  }
  return stmt(db, 'SELECT * FROM tests WHERE user_id = ? AND status = ? ORDER BY updated_at DESC, id DESC')
    .all(userId, status);
}

/**
 * All questions of a test in position order.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} testId
 * @returns {Record<string, any>[]}
 */
export function testQuestions(db, testId) {
  return stmt(db, 'SELECT * FROM test_questions WHERE test_id = ? ORDER BY position').all(testId);
}

/**
 * The current pending question of an active test, or null.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Record<string, any>} test tests row
 * @returns {Record<string, any>|null}
 */
export function currentQuestion(db, test) {
  if (test.status !== 'active') return null;
  return stmt(db, "SELECT * FROM test_questions WHERE test_id = ? AND position = ? AND status = 'pending'")
    .get(test.id, test.current_index) ?? null;
}

/**
 * The most recently answered question (highest position that is not pending), or null.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} testId
 * @returns {Record<string, any>|null}
 */
export function lastAnsweredQuestion(db, testId) {
  return stmt(db, `SELECT * FROM test_questions WHERE test_id = ? AND status != 'pending'
                   ORDER BY position DESC LIMIT 1`).get(testId) ?? null;
}

/**
 * Close an active test (idempotent for finished tests).
 * @returns {Record<string, any>} updated tests row
 */
export function closeTest(db, userId, testId, now = new Date()) {
  const test = findTest(db, userId, testId);
  if (test.status !== 'active') return test;
  const nowIso = now.toISOString();
  stmt(db, "UPDATE tests SET status = 'closed', finished_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso, nowIso, test.id);
  return findTest(db, userId, testId);
}

/**
 * Rename a test. `updated_at` is left alone: it tracks practice activity (the tests list is
 * ordered by it and shows it as the test's date), and a rename is not activity.
 * @returns {Record<string, any>} updated tests row
 */
export function renameTest(db, userId, testId, title) {
  findTest(db, userId, testId);
  stmt(db, 'UPDATE tests SET title = ? WHERE id = ?').run(title, testId);
  return findTest(db, userId, testId);
}

/**
 * Delete a test and its questions.
 * @throws {ApiError} NOT_FOUND
 */
export function deleteTest(db, userId, testId) {
  const { changes } = stmt(db, 'DELETE FROM tests WHERE id = ? AND user_id = ?').run(testId, userId);
  if (!Number(changes)) throw notFound('Test not found.');
}
