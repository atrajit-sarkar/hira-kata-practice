/**
 * Assembles TestReportData / OverallReportData for server/report/pdf.js (SPEC §9).
 * @module server/services/reportData
 */
import { charOutcomes, detectScript } from '../../shared/kana.js';
import { CHAR_STATS_SKIP, INPUT_METHODS } from './answers.js';
import { questionDetail, testSummary } from './serializers.js';
import { breakdownBy, computeOverview, rankWeakChars, scriptBreakdown } from './stats.js';
import { findTest, listTests, testMode, testQuestions } from './tests.js';
import { vocabForReport } from './vocab.js';

/** Attribution lines (SPEC §14). */
export const JMDICT_ATTRIBUTION =
  'Dictionary data: JMdict © Electronic Dictionary Research and Development Group, used under CC BY-SA 4.0';
export const JLPT_ATTRIBUTION =
  'JLPT levels: Jonathan Waller (tanos.co.uk), CC BY, via stephenmk/yomitan-jlpt-vocab';

/**
 * @param {import('./wordbank.js').WordBank} bank
 * @returns {{ attribution: string, jlptAttribution: string|null }}
 */
export function sourceAttribution(bank) {
  return { attribution: JMDICT_ATTRIBUTION, jlptAttribution: bank.meta.jlptSource ? JLPT_ATTRIBUTION : null };
}

/** @param {Record<string, any>} user users row */
function reportUser(user) {
  return { displayName: user.display_name, email: user.email ?? null, isGuest: user.is_guest === 1 };
}

/**
 * Per-character outcomes within one test, following the char_stats rules (SPEC §8).
 * @param {Record<string, any>[]} questions test_questions rows
 * @returns {{ char: string, script: string, correct: number, wrong: number }[]}
 */
export function testCharStats(questions) {
  /** @type {Map<string, { char: string, script: string, correct: number, wrong: number }>} */
  const stats = new Map();
  for (const q of questions) {
    if ((q.status !== 'correct' && q.status !== 'wrong') || CHAR_STATS_SKIP.has(q.error_type)) {
      continue;
    }
    const limit = q.hint2_used === 1 ? (q.hint2_from ?? 0) : Infinity;
    for (const o of charOutcomes(q.kana, q.user_answer ?? '')) {
      if (o.index >= limit) continue;
      const entry = stats.get(o.char)
        ?? { char: o.char, script: detectScript(o.char) === 'hiragana' ? 'hiragana' : 'katakana', correct: 0, wrong: 0 };
      if (o.correct) entry.correct += 1;
      else entry.wrong += 1;
      stats.set(o.char, entry);
    }
  }
  return [...stats.values()];
}

/** Display labels for practice modes and input methods (SPEC §15.6). */
export const MODE_LABELS = Object.freeze({ romaji: 'Romaji → write', listen: 'Listen → write' });
export const INPUT_LABELS = Object.freeze({ keys: 'Kana keys', handwriting: 'Handwriting', device: 'Device keyboard' });

/**
 * Data for a single-test PDF. Besides the TestSummary (whose `config.mode` is always set) it
 * carries `mode`/`modeLabel`, `byInput` (answered/correct/accuracy per input method) and
 * `inputLabels`; each answered question carries `inputMethod` and `romajiHintUsed`.
 * @param {{ db: import('node:sqlite').DatabaseSync, bank: import('./wordbank.js').WordBank }} deps
 * @param {Record<string, any>} user users row
 * @param {number} testId
 * @param {{ tz?: number, now?: Date }} [options]
 * @returns {object} TestReportData
 */
export function buildTestReportData({ db, bank }, user, testId, { tz = 0, now = new Date() } = {}) {
  const test = findTest(db, user.id, testId);
  const questions = testQuestions(db, test.id);
  const mode = testMode(test);
  const answered = questions.filter((q) => q.status !== 'pending');
  return {
    generatedAt: now.toISOString(),
    tzOffset: tz,
    user: reportUser(user),
    test: testSummary(test),
    mode,
    modeLabel: MODE_LABELS[mode],
    questions: questions.map((q) => questionDetail(bank, q, mode)),
    byScript: scriptBreakdown(answered),
    byInput: breakdownBy(answered, INPUT_METHODS, (q) => q.input_method),
    inputLabels: INPUT_LABELS,
    weakChars: rankWeakChars(testCharStats(questions), { minAttempts: 1 }),
    source: sourceAttribution(bank),
  };
}

/**
 * Data for the overall progress PDF (`overview.byMode` / `overview.byInput` carry the mode and
 * input-method breakdowns; each test's `config.mode` is always set).
 * @param {{ db: import('node:sqlite').DatabaseSync, bank: import('./wordbank.js').WordBank }} deps
 * @param {Record<string, any>} user users row
 * @param {{ tz?: number, now?: Date }} [options]
 * @returns {object} OverallReportData
 */
export function buildOverallReportData({ db, bank }, user, { tz = 0, now = new Date() } = {}) {
  return {
    generatedAt: now.toISOString(),
    tzOffset: tz,
    user: reportUser(user),
    overview: computeOverview(db, user.id, { tz, now }),
    modeLabels: MODE_LABELS,
    inputLabels: INPUT_LABELS,
    tests: listTests(db, user.id).map(testSummary),
    vocab: vocabForReport(db, bank, user.id),
    source: sourceAttribution(bank),
  };
}
