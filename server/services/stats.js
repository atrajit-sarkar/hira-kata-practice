/**
 * Dashboard statistics: StatsOverview with local-time daily buckets and streaks (SPEC §7.2, §8).
 * @module server/services/stats
 */
import { analyzeKana } from '../../shared/kana.js';
import { Validator } from '../http.js';
import { ratio } from './scoring.js';
import { testSummary } from './serializers.js';
import { INPUT_METHODS } from './answers.js';
import { TEST_MODES, testMode } from './tests.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** getTimezoneOffset() range in minutes (UTC+14 … UTC−12, with margin). */
export const TZ_RANGE = Object.freeze({ min: -840, max: 840 });
export const DAYS_RANGE = Object.freeze({ min: 7, max: 371, default: 182 });

/**
 * Parse `tz` (minutes, as returned by Date#getTimezoneOffset) and `days` query parameters.
 * Out-of-range numbers are clamped; non-numbers are a VALIDATION_ERROR.
 * @param {Record<string, unknown>} query
 * @returns {{ tz: number, days: number }}
 */
export function parseStatsQuery(query) {
  const v = new Validator(query);
  const tz = v.int('tz', { ...TZ_RANGE, optional: true, clamp: true, label: 'Time zone offset' }) ?? 0;
  const days = v.int('days', { min: DAYS_RANGE.min, max: DAYS_RANGE.max, optional: true, clamp: true, label: 'Days' })
    ?? DAYS_RANGE.default;
  v.assert();
  return { tz, days };
}

/**
 * Local calendar date (YYYY-MM-DD) of a UTC instant for a client offset (`local = utc − tz`).
 * @param {string|Date} instant ISO string or Date
 * @param {number} tz minutes
 * @returns {string}
 */
export function localDate(instant, tz) {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  return new Date(ms - tz * 60_000).toISOString().slice(0, 10);
}

/**
 * Shift a YYYY-MM-DD date by whole days.
 * @param {string} date
 * @param {number} deltaDays
 * @returns {string}
 */
export function addDays(date, deltaDays) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + deltaDays * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Current and best streak of consecutive active days.
 * The current streak counts back from today, or from yesterday when nothing was answered today.
 * @param {Set<string>} activeDates YYYY-MM-DD
 * @param {string} today
 * @returns {{ current: number, best: number }}
 */
export function computeStreaks(activeDates, today) {
  let current = 0;
  let day = activeDates.has(today) ? today : addDays(today, -1);
  while (activeDates.has(day)) {
    current += 1;
    day = addDays(day, -1);
  }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of [...activeDates].sort()) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current) };
}

/**
 * Answered/correct/accuracy per script.
 * @param {{ script: string, status: string }[]} answered
 * @returns {{ hiragana: object, katakana: object }}
 */
export function scriptBreakdown(answered) {
  const out = { hiragana: { answered: 0, correct: 0 }, katakana: { answered: 0, correct: 0 } };
  for (const q of answered) {
    const bucket = out[q.script];
    if (!bucket) continue;
    bucket.answered += 1;
    if (q.status === 'correct') bucket.correct += 1;
  }
  for (const b of Object.values(out)) b.accuracy = ratio(b.correct, b.answered);
  return out;
}

/**
 * Answered/correct/accuracy grouped by `keyOf(question)` into fixed buckets; questions whose key
 * is not a bucket (e.g. skips, which have no input method) are left out.
 * @template Q
 * @param {Q[]} answered questions with a `status`
 * @param {readonly string[]} buckets
 * @param {(q: Q) => string|null|undefined} keyOf
 * @returns {Record<string, { answered: number, correct: number, accuracy: number }>}
 */
export function breakdownBy(answered, buckets, keyOf) {
  /** @type {Record<string, { answered: number, correct: number, accuracy?: number }>} */
  const out = Object.fromEntries(buckets.map((b) => [b, { answered: 0, correct: 0 }]));
  for (const q of answered) {
    const bucket = out[keyOf(q)];
    if (!bucket) continue;
    bucket.answered += 1;
    if (q.status === 'correct') bucket.correct += 1;
  }
  for (const b of Object.values(out)) b.accuracy = ratio(b.correct, b.answered);
  return /** @type {any} */ (out);
}

/**
 * Whether an answered question is a "clean" correct answer: no hint of any kind and the standard
 * spelling (a listen-mode sound-alike variant is correct but not clean).
 * @param {{ status: string, hint1_used: number, hint2_used: number, hint3_used?: number, error_type?: string|null }} q
 * @returns {boolean}
 */
export function isCleanCorrect(q) {
  return q.status === 'correct' && !q.hint1_used && !q.hint2_used && !q.hint3_used && q.error_type !== 'variant';
}

/**
 * Weakest characters: at least `minAttempts` attempts, accuracy ascending then wrong descending.
 * @param {{ char: string, script: string, correct: number, wrong: number }[]} chars
 * @param {{ minAttempts?: number, limit?: number }} [opts]
 * @returns {{ char: string, script: string, correct: number, wrong: number, accuracy: number }[]}
 */
export function rankWeakChars(chars, { minAttempts = 2, limit = 10 } = {}) {
  return chars
    .filter((c) => c.correct + c.wrong >= minAttempts && c.wrong > 0)
    .map((c) => ({ char: c.char, script: c.script, correct: c.correct, wrong: c.wrong,
      accuracy: ratio(c.correct, c.correct + c.wrong) }))
    .sort((a, b) => a.accuracy - b.accuracy || b.wrong - a.wrong || (a.char < b.char ? -1 : a.char > b.char ? 1 : 0))
    .slice(0, limit);
}

/**
 * Queries behind a StatsOverview, for one read batch: tests (newest first), answered questions,
 * vocabulary counts and per-character stats.
 * @param {number} userId
 * @returns {[string, unknown[]][]}
 */
export function overviewQueries(userId) {
  return [
    ['SELECT * FROM tests WHERE user_id = ? ORDER BY updated_at DESC, id DESC', [userId]],
    [`SELECT q.test_id, q.status, q.script, q.kana, q.hint1_used, q.hint2_used, q.hint3_used, q.error_type,
             q.input_method, q.points, q.answered_at
      FROM test_questions q JOIN tests t ON t.id = q.test_id
      WHERE t.user_id = ? AND q.status != 'pending'`, [userId]],
    [`SELECT COALESCE(SUM(seen > 0), 0) AS seen, COALESCE(SUM(correct > 0), 0) AS learned,
             COALESCE(SUM(last_result IN ('wrong', 'skipped')), 0) AS review
      FROM vocab_progress WHERE user_id = ?`, [userId]],
    ['SELECT char, script, correct, wrong FROM char_stats WHERE user_id = ? ORDER BY script, char', [userId]],
  ];
}

/**
 * Build the StatsOverview for a user (one database round trip).
 * @param {import('../db.js').Database} db
 * @param {number} userId
 * @param {{ tz?: number, days?: number, now?: Date }} [options]
 * @returns {Promise<object>} StatsOverview
 */
export async function computeOverview(db, userId, options = {}) {
  return buildOverview(await db.read(overviewQueries(userId)), options);
}

/**
 * StatsOverview from the rows of {@link overviewQueries}.
 * @param {Record<string, any>[][]} rows results of overviewQueries, in order
 * @param {{ tz?: number, days?: number, now?: Date }} [options]
 * @returns {object} StatsOverview
 */
export function buildOverview([tests, answered, [vocab], charRows],
  { tz = 0, days = DAYS_RANGE.default, now = new Date() } = {}) {
  const charStats = charRows.map((c) => ({ char: c.char, script: c.script, correct: c.correct, wrong: c.wrong }));

  const today = localDate(now, tz);
  const levelOf = new Map();
  const byLevel = { 1: { answered: 0, correct: 0 }, 2: { answered: 0, correct: 0 }, 3: { answered: 0, correct: 0 } };
  /** @type {Map<string, { answered: number, correct: number, score: number }>} */
  const perDay = new Map();
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  let cleanCorrect = 0;
  for (const q of answered) {
    const isCorrect = q.status === 'correct';
    if (isCorrect) correct += 1;
    else if (q.status === 'wrong') wrong += 1;
    else skipped += 1;
    if (isCleanCorrect(q)) cleanCorrect += 1;
    if (!levelOf.has(q.kana)) levelOf.set(q.kana, analyzeKana(q.kana).level);
    const lvl = byLevel[levelOf.get(q.kana)];
    lvl.answered += 1;
    if (isCorrect) lvl.correct += 1;
    const date = localDate(q.answered_at, tz);
    const day = perDay.get(date) ?? { answered: 0, correct: 0, score: 0 };
    day.answered += 1;
    if (isCorrect) day.correct += 1;
    day.score += q.points;
    perDay.set(date, day);
  }
  for (const b of Object.values(byLevel)) b.accuracy = ratio(b.correct, b.answered);

  const daily = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    daily.push({ date, ...(perDay.get(date) ?? { answered: 0, correct: 0, score: 0 }) });
  }
  const windowTotals = (fromDaysAgo, toDaysAgo) => {
    const from = addDays(today, -fromDaysAgo);
    const to = addDays(today, -toDaysAgo);
    let n = 0;
    let c = 0;
    for (const [date, d] of perDay) {
      if (date >= from && date <= to) {
        n += d.answered;
        c += d.correct;
      }
    }
    return { answered: n, accuracy: ratio(c, n) };
  };

  const activeDates = new Set([...perDay.keys()].filter((d) => d <= today));
  const streaks = computeStreaks(activeDates, today);
  const summaries = tests.map(testSummary);
  const sum = (key) => tests.reduce((acc, t) => acc + t[key], 0);
  const countStatus = (status) => tests.filter((t) => t.status === status).length;
  const total = answered.length;
  const modeOf = new Map(tests.map((t) => [t.id, testMode(t)]));

  return {
    totals: {
      tests: tests.length,
      activeTests: countStatus('active'),
      completedTests: countStatus('completed'),
      closedTests: countStatus('closed'),
      answered: total, correct, wrong, skipped,
      accuracy: ratio(correct, total),
      cleanCorrect,
      cleanAccuracy: ratio(cleanCorrect, total),
      score: sum('score'),
      timeSpentMs: sum('time_spent_ms'),
      hint1Used: sum('hint1_count'),
      hint2Used: sum('hint2_count'),
      romajiHintUsed: sum('hint3_count'),
      wordsSeen: vocab.seen,
      wordsLearned: vocab.learned,
      wordsToReview: vocab.review,
    },
    byScript: scriptBreakdown(answered),
    byLevel,
    byMode: breakdownBy(answered, TEST_MODES, (q) => modeOf.get(q.test_id)),
    byInput: breakdownBy(answered, INPUT_METHODS, (q) => q.input_method),
    streak: {
      current: streaks.current,
      best: streaks.best,
      todayAnswered: perDay.get(today)?.answered ?? 0,
      lastActiveDate: activeDates.size ? [...activeDates].sort().at(-1) : null,
    },
    daily,
    last7: windowTotals(6, 0),
    prev7: windowTotals(13, 7),
    recentTests: summaries.slice(0, 5),
    accuracyTrend: summaries
      .filter((t) => t.answeredCount > 0)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id))
      .slice(-20)
      .map((t) => ({ testId: t.id, title: t.title, date: t.createdAt, accuracy: t.accuracy,
        scorePercent: t.scorePercent, answered: t.answeredCount })),
    charStats,
    weakChars: rankWeakChars(charStats),
  };
}
