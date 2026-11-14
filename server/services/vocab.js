/**
 * Personal vocabulary: listing with filters/search/sort/paging, and starring (SPEC §7.2).
 * @module server/services/vocab
 */
import { toHiragana } from '../../shared/kana.js';
import { Validator, notFound } from '../http.js';
import { meaningOf } from './wordbank.js';

export const VOCAB_FILTERS = Object.freeze(['all', 'learned', 'review', 'starred']);
export const VOCAB_SCRIPTS = Object.freeze(['all', 'hiragana', 'katakana']);
export const VOCAB_SORTS = Object.freeze(['recent', 'alpha', 'mistakes']);
export const PAGE_SIZE_MAX = 100;
const QUERY_MAX = 64;

/**
 * Validate `GET /api/vocab` query parameters.
 * @param {Record<string, unknown>} query
 * @returns {{ filter: string, script: string, q: string, sort: string, page: number, pageSize: number }}
 */
export function parseVocabQuery(query) {
  const v = new Validator(query);
  const params = {
    filter: v.oneOf('filter', VOCAB_FILTERS, { optional: true, label: 'Filter' }) ?? 'all',
    script: v.oneOf('script', VOCAB_SCRIPTS, { optional: true, label: 'Script' }) ?? 'all',
    q: v.string('q', { max: QUERY_MAX, optional: true, label: 'Search' }) ?? '',
    sort: v.oneOf('sort', VOCAB_SORTS, { optional: true, label: 'Sort' }) ?? 'recent',
    page: v.int('page', { min: 1, max: 100_000, optional: true, clamp: true, label: 'Page' }) ?? 1,
    pageSize: v.int('pageSize', { min: 1, max: PAGE_SIZE_MAX, optional: true, clamp: true, label: 'Page size' }) ?? 24,
  };
  v.assert();
  return params;
}

/**
 * Progress shape for a vocab_progress row.
 * @param {Record<string, any>} row
 * @returns {{ seen: number, correct: number, wrong: number, lastResult: string|null,
 *             lastSeenAt: string|null, starred: boolean }}
 */
export function progressOf(row) {
  return {
    seen: row.seen,
    correct: row.correct,
    wrong: row.wrong,
    lastResult: row.last_result ?? null,
    lastSeenAt: row.last_seen_at ?? null,
    starred: row.starred === 1,
  };
}

const FILTER_TESTS = Object.freeze({
  all: () => true,
  learned: (r) => r.correct > 0,
  review: (r) => r.last_result === 'wrong' || r.last_result === 'skipped',
  starred: (r) => r.starred === 1,
});

/**
 * Case-insensitive substring search over kana (script-insensitive), romaji (with or without
 * macrons), kanji and meaning.
 * @param {string} q
 * @returns {(w: import('./wordbank.js').Word) => boolean}
 */
function searchPredicate(q) {
  const needle = q.normalize('NFKC').toLowerCase();
  if (!needle) return () => true;
  const kanaNeedle = toHiragana(needle);
  const plainNeedle = stripMacrons(needle);
  return (w) => toHiragana(w.kana).includes(kanaNeedle)
    || w.romaji.includes(needle)
    || stripMacrons(w.romaji).includes(plainNeedle)
    || w.kanji.some((k) => k.includes(needle))
    || meaningOf(w).toLowerCase().includes(needle);
}

/** @param {string} s @returns {string} */
function stripMacrons(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byRecent = (a, b) => byText(b.row.last_seen_at ?? '', a.row.last_seen_at ?? '');
const byAlpha = (a, b) => byText(toHiragana(a.word.kana), toHiragana(b.word.kana)) || byText(a.word.kana, b.word.kana);

const SORTS = Object.freeze({
  recent: (a, b) => byRecent(a, b) || byAlpha(a, b),
  alpha: (a, b) => byAlpha(a, b) || byText(a.word.id, b.word.id),
  mistakes: (a, b) => b.row.wrong - a.row.wrong
    || (b.row.wrong / Math.max(1, b.row.seen)) - (a.row.wrong / Math.max(1, a.row.seen))
    || byRecent(a, b) || byAlpha(a, b),
});

/**
 * Query for all of a user's vocab_progress rows.
 * @param {number} userId
 * @returns {[string, unknown[]]}
 */
export function vocabQuery(userId) {
  return ['SELECT * FROM vocab_progress WHERE user_id = ?', [userId]];
}

/**
 * List the user's vocabulary. `counts` are totals over the whole vocabulary (not affected by
 * search or script filters) so tab badges stay stable.
 * @param {import('../db.js').Database} db
 * @param {import('./wordbank.js').WordBank} bank
 * @param {number} userId
 * @param {ReturnType<typeof parseVocabQuery>} params
 * @returns {Promise<{ items: object[], total: number, page: number, pageSize: number, counts: object }>}
 */
export async function listVocab(db, bank, userId, params) {
  return vocabListing(await db.all(...vocabQuery(userId)), bank, params);
}

/**
 * The {@link listVocab} result for already loaded vocab_progress rows.
 * @param {Record<string, any>[]} rows the user's vocab_progress rows
 * @param {import('./wordbank.js').WordBank} bank
 * @param {ReturnType<typeof parseVocabQuery>} params
 * @returns {{ items: object[], total: number, page: number, pageSize: number, counts: object }}
 */
export function vocabListing(rows, bank, params) {
  const entries = rows
    .map((row) => ({ row, word: bank.get(row.word_id) }))
    .filter((e) => e.word);
  const counts = Object.fromEntries(VOCAB_FILTERS.map((f) => [f, entries.filter((e) => FILTER_TESTS[f](e.row)).length]));
  const matchesSearch = searchPredicate(params.q);
  const filtered = entries
    .filter((e) => FILTER_TESTS[params.filter](e.row)
      && (params.script === 'all' || e.word.script === params.script)
      && matchesSearch(e.word))
    .sort(SORTS[params.sort]);
  const start = (params.page - 1) * params.pageSize;
  return {
    items: filtered.slice(start, start + params.pageSize)
      .map((e) => ({ word: bank.wordInfo(e.word), progress: progressOf(e.row) })),
    total: filtered.length,
    page: params.page,
    pageSize: params.pageSize,
    counts,
  };
}

/**
 * Star or unstar a word (one atomic batch). Rows that end up unseen and unstarred are removed.
 * @param {import('../db.js').Database} db
 * @param {import('./wordbank.js').WordBank} bank
 * @param {number} userId
 * @param {string} wordId
 * @param {boolean} starred
 * @returns {Promise<boolean>} the new starred state
 * @throws {import('../http.js').ApiError} NOT_FOUND for unknown words
 */
export async function setStarred(db, bank, userId, wordId, starred) {
  if (!bank.get(wordId)) throw notFound('Word not found.');
  /** @type {import('../db.js').Stmt[]} */
  const statements = [[`INSERT INTO vocab_progress (user_id, word_id, starred) VALUES (?, ?, ?)
    ON CONFLICT (user_id, word_id) DO UPDATE SET starred = excluded.starred`, [userId, wordId, starred ? 1 : 0]]];
  if (!starred) {
    statements.push(['DELETE FROM vocab_progress WHERE user_id = ? AND word_id = ? AND seen = 0 AND starred = 0',
      [userId, wordId]]);
  }
  await db.batch(statements);
  return starred;
}

/**
 * Learned and to-review vocabulary for the overall PDF report (≤ `limit` each, most recent first).
 * @param {Record<string, any>[]} rows the user's vocab_progress rows ({@link vocabQuery})
 * @param {import('./wordbank.js').WordBank} bank
 * @param {number} [limit=60]
 * @returns {{ learned: object[], review: object[] }}
 */
export function vocabForReport(rows, bank, limit = 60) {
  const pick = (filter) => vocabListing(rows, bank, {
    filter, script: 'all', q: '', sort: filter === 'review' ? 'mistakes' : 'recent', page: 1, pageSize: limit,
  }).items;
  return { learned: pick('learned'), review: pick('review') };
}
