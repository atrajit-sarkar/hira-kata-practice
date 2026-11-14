/**
 * Word selection for new tests (SPEC §7.2 "Word selection") and default test titles.
 * Pure functions: callers pass in the user's history.
 * @module server/services/selection
 */

/**
 * @typedef {{ id: string, kana: string, romaji: string, script: string }} QuestionWord
 */

/**
 * Fisher–Yates shuffle (returns a new array).
 * @template T
 * @param {readonly T[]} items
 * @param {() => number} rng
 * @returns {T[]}
 */
export function shuffle(items, rng = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Order a pool by Efraimidis–Spirakis keys (`log(u) / w`, larger first). Taking the first k items
 * is weighted sampling without replacement.
 * @template T
 * @param {readonly T[]} pool
 * @param {(item: T) => number} weightOf positive weight
 * @param {() => number} rng
 * @returns {T[]}
 */
export function weightedOrder(pool, weightOf, rng = Math.random) {
  return pool
    .map((item) => ({ item, key: Math.log(1 - rng()) / weightOf(item) }))
    .sort((a, b) => b.key - a.key)
    .map((e) => e.item);
}

/**
 * Indexes of the `k` largest keys, largest first (size-k min-heap: O(n log k)).
 * @param {Float64Array} keys
 * @param {number} k
 * @returns {number[]}
 */
function topIndices(keys, k) {
  /** @type {number[]} min-heap of indexes by key */
  const heap = [];
  const swap = (a, b) => { [heap[a], heap[b]] = [heap[b], heap[a]]; };
  for (let i = 0; i < keys.length && k > 0; i += 1) {
    if (heap.length < k) {
      heap.push(i);
      for (let c = heap.length - 1; c > 0;) {
        const parent = (c - 1) >> 1;
        if (keys[heap[parent]] <= keys[heap[c]]) break;
        swap(c, parent);
        c = parent;
      }
    } else if (keys[i] > keys[heap[0]]) {
      heap[0] = i;
      for (let c = 0; ;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let min = c;
        if (l < heap.length && keys[heap[l]] < keys[heap[min]]) min = l;
        if (r < heap.length && keys[heap[r]] < keys[heap[min]]) min = r;
        if (min === c) break;
        swap(c, min);
        c = min;
      }
    }
  }
  return heap.sort((a, b) => keys[b] - keys[a]);
}

/**
 * Lazy Efraimidis–Spirakis order of a pool: the same order as {@link weightedOrder}, but only the
 * first `prefix` items are ranked up front (whole-dictionary pools hold ~170k words while a test
 * needs ≤ 100); everything is sorted on demand when a caller reads past the prefix.
 * @template T
 * @param {readonly T[]} pool
 * @param {(item: T) => number} weightOf positive weight
 * @param {() => number} rng
 * @param {number} prefix
 * @returns {(i: number) => T|undefined} item at rank `i`
 */
function weightedSequence(pool, weightOf, rng, prefix) {
  const keys = new Float64Array(pool.length);
  for (let i = 0; i < pool.length; i += 1) keys[i] = Math.log(1 - rng()) / weightOf(pool[i]);
  let order = topIndices(keys, Math.min(prefix, pool.length));
  return (i) => {
    if (i >= order.length && order.length < pool.length) {
      order = Array.from(pool.keys()).sort((a, b) => keys[b] - keys[a]);
    }
    return i < order.length ? pool[order[i]] : undefined;
  };
}

/**
 * Cursor over a ranked sequence that hands out items whose kana was not used yet.
 * @param {(i: number) => QuestionWord|undefined} at item at rank i (undefined past the end)
 * @param {Set<string>} usedKana shared between cursors
 */
function kanaCursor(at, usedKana) {
  let i = 0;
  return (n) => {
    const out = [];
    while (out.length < n) {
      const w = at(i);
      if (w === undefined) break;
      i += 1;
      if (usedKana.has(w.kana)) continue;
      usedKana.add(w.kana);
      out.push(w);
    }
    return out;
  };
}

/** Sampling weight multipliers (SPEC §7.2, §15.1). */
export const WEIGHTS = Object.freeze({ unseen: 3, jlpt: 2, common: 4 });

/**
 * Pick up to `count` random words for a test.
 * Weight ×3 for words the user has never seen, ×2 for JLPT-tagged words when `jlpt` is 'any',
 * ×4 for common words when `commonBoost` (pool 'all'); `mixed` aims for ceil(count/2) hiragana
 * and fills any shortfall from the other script.
 * @param {{ pool: readonly (QuestionWord & { jlpt: number|null, common?: boolean })[], count: number,
 *           script: 'hiragana'|'katakana'|'mixed', jlptAny: boolean, commonBoost?: boolean,
 *           seenIds: Set<string>, rng?: () => number }} options `pool` is already filtered by
 *           script/level/pos/jlpt/pool
 * @returns {QuestionWord[]} shuffled, distinct kana, length ≤ count
 */
export function selectRandomWords({ pool, count, script, jlptAny, commonBoost = false, seenIds, rng = Math.random }) {
  const weightOf = (w) => (seenIds.has(w.id) ? 1 : WEIGHTS.unseen)
    * (jlptAny && w.jlpt != null ? WEIGHTS.jlpt : 1)
    * (commonBoost && w.common ? WEIGHTS.common : 1);
  const prefix = count * 4 + 64;
  const ranked = (items) => weightedSequence(items, weightOf, rng, prefix);
  const usedKana = new Set();
  if (script !== 'mixed') {
    return shuffle(kanaCursor(ranked(pool), usedKana)(count), rng);
  }
  const takeHira = kanaCursor(ranked(pool.filter((w) => w.script === 'hiragana')), usedKana);
  const takeKata = kanaCursor(ranked(pool.filter((w) => w.script === 'katakana')), usedKana);
  const hiraTarget = Math.ceil(count / 2);
  const hira = takeHira(hiraTarget);
  const kata = takeKata(count - hiraTarget + (hiraTarget - hira.length));
  if (hira.length + kata.length < count) hira.push(...takeHira(count - hira.length - kata.length));
  return shuffle([...hira, ...kata], rng);
}

/**
 * Keep the first word of each kana, up to `count`.
 * @template {QuestionWord} T
 * @param {readonly T[]} words ordered by priority
 * @param {number} count
 * @returns {T[]}
 */
export function distinctByKana(words, count) {
  return kanaCursor((i) => words[i], new Set())(count);
}

const SCRIPT_LABEL = Object.freeze({ hiragana: 'Hiragana', katakana: 'Katakana', mixed: 'Mixed' });
const LEVEL_LABEL = Object.freeze({ 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' });
const POS_LABEL = Object.freeze({
  noun: 'Nouns', verb: 'Verbs', adjective: 'Adjectives', adverb: 'Adverbs', expression: 'Expressions',
});

/** Maximum title length. */
export const TITLE_MAX = 80;
/** Title prefix of listen-mode tests (SPEC §15.2). */
export const LISTEN_PREFIX = 'Listen · ';

/**
 * Default title, e.g. "Mixed · All levels · 20 words", "Hiragana · JLPT N5 · 20 words",
 * "Katakana · Common · Beginner · 10 words", "Review · 12 words", "Retry · <source title>".
 * Listen-mode titles are prefixed "Listen · "; pool 'common' adds "Common" (random tests only).
 * @param {{ script: string, level: string|number, pos: string, jlpt: string|number, source: string,
 *           mode?: 'romaji'|'listen', pool?: 'all'|'common' }} config
 * @param {number} count actual number of questions
 * @param {string|null} [sourceTitle] title of the source test (test-mistakes)
 * @returns {string}
 */
export function defaultTitle(config, count, sourceTitle = null) {
  const listen = config.mode === 'listen';
  const prefix = listen ? LISTEN_PREFIX : '';
  const words = `${count} word${count === 1 ? '' : 's'}`;
  if (config.source === 'review') return `${prefix}Review · ${words}`;
  if (config.source === 'test-mistakes') {
    // Avoid "Listen · Retry · Listen · …" when retrying a listen test in listen mode.
    const source = sourceTitle ?? 'test';
    const inner = listen && source.startsWith(LISTEN_PREFIX) ? source.slice(LISTEN_PREFIX.length) : source;
    return truncate(`${prefix}Retry · ${inner}`, TITLE_MAX);
  }
  const parts = [SCRIPT_LABEL[config.script]];
  if (config.pool === 'common') parts.push('Common');
  if (config.level !== 'all') parts.push(LEVEL_LABEL[config.level]);
  else if (config.jlpt === 'any') parts.push('All levels');
  if (config.jlpt !== 'any') parts.push(`JLPT N${config.jlpt}`);
  if (config.pos !== 'any') parts.push(POS_LABEL[config.pos]);
  parts.push(words);
  return prefix + parts.join(' · ');
}

/**
 * Truncate to `max` code points, ending with an ellipsis when shortened.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}
