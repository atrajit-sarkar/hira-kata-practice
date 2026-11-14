/**
 * DB row → API shape converters for tests and questions (SPEC §7.1).
 * @module server/services/serializers
 */
import { analyzeKana, diffKana } from '../../shared/kana.js';
import { testMetrics } from './scoring.js';
import { normalizeConfig } from './tests.js';

/**
 * TestSummary for a `tests` row.
 * @param {Record<string, any>} row
 * @returns {object}
 */
export function testSummary(row) {
  const m = testMetrics({
    totalQuestions: row.total_questions,
    score: row.score,
    correct: row.correct_count,
    wrong: row.wrong_count,
    skipped: row.skipped_count,
  });
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    config: normalizeConfig(row.config),
    totalQuestions: row.total_questions,
    answeredCount: m.answered,
    currentIndex: row.current_index,
    score: row.score,
    maxScore: m.maxScore,
    answeredMaxScore: m.answeredMaxScore,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    skippedCount: row.skipped_count,
    hint1Count: row.hint1_count,
    hint2Count: row.hint2_count,
    romajiHintCount: row.hint3_count ?? 0,
    accuracy: m.accuracy,
    scorePercent: m.scorePercent,
    grade: m.grade,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
    timeSpentMs: row.time_spent_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? null,
  };
}

/**
 * QuestionStub (progress dots).
 * @param {Record<string, any>} q test_questions row
 * @returns {{ id: number, position: number, status: string }}
 */
export function questionStub(q) {
  return { id: q.id, position: q.position, status: q.status };
}

/**
 * The romaji a pending question may show: always in romaji mode; in listen mode only once the
 * romaji hint was used (SPEC §15.2).
 * @param {Record<string, any>} q test_questions row
 * @param {'romaji'|'listen'} mode
 * @returns {string|null}
 */
function visibleRomaji(q, mode) {
  return mode !== 'listen' || q.hint3_used === 1 ? q.romaji : null;
}

/**
 * QuestionPublic for a pending question: never reveals the answer unless hint 2 was used. In
 * listen mode `speak` carries the kana the client pronounces (speech is client-side) and
 * `romaji` stays null until the romaji hint is used.
 * @param {Record<string, any>} q
 * @param {'romaji'|'listen'} [mode='romaji'] the test's practice mode
 * @returns {object}
 */
export function questionPublic(q, mode = 'romaji') {
  const listen = mode === 'listen';
  return {
    id: q.id,
    position: q.position,
    status: q.status,
    mode: listen ? 'listen' : 'romaji',
    romaji: visibleRomaji(q, mode),
    speak: listen ? q.kana : null,
    hint1Used: q.hint1_used === 1,
    hint2Used: q.hint2_used === 1,
    romajiHintUsed: q.hint3_used === 1,
    script: q.hint1_used === 1 ? q.script : null,
    answer: q.hint2_used === 1 ? q.kana : null,
  };
}

/**
 * WordInfo from the bank, or a minimal one rebuilt from the question snapshot when the word
 * is no longer in the bank (e.g. after a word-bank rebuild).
 * @param {import('./wordbank.js').WordBank} bank
 * @param {{ word_id: string, kana: string, romaji: string, script: string }} q
 * @returns {object}
 */
export function wordInfoFor(bank, q) {
  const info = bank.wordInfo(q.word_id);
  if (info) return info;
  const a = analyzeKana(q.kana);
  return {
    id: q.word_id, kana: q.kana, romaji: q.romaji, script: q.script, kanji: [], usuallyKana: false,
    senses: [], meaning: '', posCategory: 'other', origin: [], jlpt: null,
    level: a.level, features: a.features, homophones: [],
  };
}

/**
 * QuestionResult for an answered (correct/wrong/skipped) question.
 * @param {import('./wordbank.js').WordBank} bank
 * @param {Record<string, any>} q
 * @returns {object}
 */
export function questionResult(bank, q) {
  return {
    id: q.id,
    position: q.position,
    status: q.status,
    romaji: q.romaji,
    expected: q.kana,
    script: q.script,
    userAnswer: q.user_answer ?? null,
    errorType: q.error_type ?? null,
    points: q.points,
    hint1Used: q.hint1_used === 1,
    hint2Used: q.hint2_used === 1,
    hint2Revealed: q.hint2_revealed,
    romajiHintUsed: q.hint3_used === 1,
    inputMethod: q.input_method ?? null,
    timeMs: q.time_ms,
    diff: diffKana(q.kana, q.user_answer ?? ''),
    word: wordInfoFor(bank, q),
    answeredAt: q.answered_at,
  };
}

/**
 * Entry for `GET /api/tests/:id`: full result when answered, stub + romaji when pending (romaji is
 * null for pending listen-mode questions until the romaji hint is used).
 * @param {import('./wordbank.js').WordBank} bank
 * @param {Record<string, any>} q
 * @param {'romaji'|'listen'} [mode='romaji'] the test's practice mode
 * @returns {object}
 */
export function questionDetail(bank, q, mode = 'romaji') {
  return q.status === 'pending' ? { ...questionStub(q), romaji: visibleRomaji(q, mode) } : questionResult(bank, q);
}
