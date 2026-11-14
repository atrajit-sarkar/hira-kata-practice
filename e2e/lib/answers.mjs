/**
 * Answer key for the E2E run. The API never reveals the expected kana of an unanswered question,
 * so the journey reads it from the run's own throw-away SQLite file (read-only; WAL allows this
 * while the server writes).
 * @module e2e/lib/answers
 */
import { DatabaseSync } from 'node:sqlite';
import { compareAnswer, toHiragana, toKatakana } from '../../shared/kana.js';

/**
 * Expected word of a test's current question.
 * @param {string} dbPath
 * @param {number|string} testId
 * @returns {{ id: number, position: number, kana: string, script: 'hiragana'|'katakana', romaji: string }}
 */
export function currentWord(dbPath, testId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare(`
      SELECT q.id, q.position, q.kana, q.script, q.romaji
      FROM test_questions q JOIN tests t ON t.id = q.test_id
      WHERE q.test_id = ? AND q.position = t.current_index`).get(Number(testId));
    if (!row) throw new Error(`Test ${testId} has no current question`);
    return { ...row };
  } finally {
    db.close();
  }
}

/**
 * The same word written in the other script (a "right sounds, wrong script" answer).
 * @param {{ kana: string, script: string }} word
 */
export function otherScript(word) {
  return word.script === 'katakana' ? toHiragana(word.kana) : toKatakana(word.kana);
}

/**
 * A kana of the word's script that differs from `ch` and has a basic on-screen key.
 * @param {string} ch
 * @param {'hiragana'|'katakana'} script
 */
export function wrongKanaFor(ch, script) {
  const pool = script === 'katakana' ? ['ヌ', 'ネ'] : ['ぬ', 'ね'];
  return pool[0] === ch ? pool[1] : pool[0];
}

/**
 * Every expected word of a test, in question order.
 * @param {string} dbPath
 * @param {number|string} testId
 * @returns {{ id: number, position: number, kana: string, script: 'hiragana'|'katakana', romaji: string }[]}
 */
export function testWords(dbPath, testId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT id, position, kana, script, romaji FROM test_questions WHERE test_id = ? ORDER BY position')
      .all(Number(testId)).map((r) => ({ ...r }));
  } finally {
    db.close();
  }
}

/** Kana that a same-sound spelling may swap in (long vowels, ー, を/お, づ/ず, ぢ/じ). */
const SAME_SOUND_SWAPS = Array.from('あいうえおアイウエオーをずづじぢヲズヅジヂ');

/**
 * A non-standard spelling of `kana` that sounds the same (SPEC §15.2), e.g. コオヒイ for コーヒー,
 * or null when the word has none. Verified with the shared compareAnswer in listen mode.
 * @param {string} kana
 * @returns {string|null}
 */
export function sameSoundSpelling(kana) {
  const chars = Array.from(kana);
  for (let i = 0; i < chars.length; i += 1) {
    for (const swap of SAME_SOUND_SWAPS) {
      if (swap === chars[i]) continue;
      const candidate = [...chars.slice(0, i), swap, ...chars.slice(i + 1)].join('');
      if (compareAnswer(kana, candidate, { mode: 'listen' }).errorType === 'variant') return candidate;
    }
  }
  return null;
}
