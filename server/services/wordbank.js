/**
 * In-memory word bank loaded once from data/words.json.gz (or a plain .json file) (SPEC §4, §15.1):
 * validation, indexes, filtering, counting, sampling and WordInfo serialization.
 * @module server/services/wordbank
 */
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const gunzip = promisify(zlib.gunzip);

export const SCRIPTS = Object.freeze(['hiragana', 'katakana']);
export const LEVELS = Object.freeze([1, 2, 3]);
export const POS_CATEGORIES = Object.freeze(['noun', 'verb', 'adjective', 'adverb', 'expression', 'other']);
export const JLPT_LEVELS = Object.freeze([5, 4, 3, 2, 1]);
/** Word pools (SPEC §15.1): the whole dictionary, or only JMdict "common" words. */
export const POOLS = Object.freeze(['all', 'common']);

/** Error raised when words.json is missing or malformed. */
export class WordBankError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: 'MISSING'|'INVALID', cause?: unknown }} [opts]
   */
  constructor(message, { code = 'INVALID', cause } = {}) {
    super(message, { cause });
    this.name = 'WordBankError';
    this.code = code;
  }
}

/**
 * @typedef {object} Word  one entry of words.json (frozen)
 * @property {string} id
 * @property {string} kana
 * @property {'hiragana'|'katakana'} script
 * @property {string} romaji
 * @property {string[]} kanji
 * @property {boolean} common       JMdict common entry (missing in v1 banks → true: they held only
 *                                  common entries)
 * @property {boolean} usuallyKana
 * @property {{ pos: string[], gloss: string[], info: string[] }[]} senses
 * @property {string} posCategory
 * @property {{ lang: string, text: string|null, wasei: boolean }[]} origin
 * @property {number|null} jlpt
 * @property {1|2|3} level
 * @property {number} len
 * @property {string[]} features
 */

/**
 * @typedef {object} WordFilter
 * @property {'hiragana'|'katakana'|'mixed'} [script]
 * @property {'all'|1|2|3} [level]
 * @property {'any'|string} [pos]
 * @property {'any'|1|2|3|4|5} [jlpt]
 * @property {'all'|'common'} [pool]
 */

const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

/**
 * Validate one word; returns an error description or null.
 * @param {any} w
 * @returns {string|null}
 */
function wordProblem(w) {
  if (!w || typeof w !== 'object') return 'not an object';
  if (typeof w.id !== 'string' || !w.id) return 'id must be a non-empty string';
  if (typeof w.kana !== 'string' || !w.kana) return 'kana must be a non-empty string';
  if (!SCRIPTS.includes(w.script)) return `script must be one of ${SCRIPTS.join('/')}`;
  if (typeof w.romaji !== 'string' || !w.romaji) return 'romaji must be a non-empty string';
  if (!isStringArray(w.kanji)) return 'kanji must be a string array';
  if (w.common !== undefined && typeof w.common !== 'boolean') return 'common must be a boolean';
  if (!Array.isArray(w.senses) || !w.senses.length) return 'senses must be a non-empty array';
  for (const s of w.senses) {
    if (!s || !isStringArray(s.pos) || !isStringArray(s.gloss) || !isStringArray(s.info ?? [])) {
      return 'each sense needs pos/gloss/info string arrays';
    }
  }
  if (!POS_CATEGORIES.includes(w.posCategory)) return 'posCategory is invalid';
  if (!Array.isArray(w.origin)) return 'origin must be an array';
  if (w.jlpt !== null && !JLPT_LEVELS.includes(w.jlpt)) return 'jlpt must be 1..5 or null';
  if (!LEVELS.includes(w.level)) return 'level must be 1, 2 or 3';
  if (!isStringArray(w.features)) return 'features must be a string array';
  return null;
}

/**
 * Deep-freeze a plain JSON value.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/**
 * Normalise a filter to the canonical values used for matching.
 * @param {WordFilter} [filter]
 * @returns {{ script: string, level: string|number, pos: string, jlpt: string|number, pool: string }}
 */
function canonicalFilter({ script = 'mixed', level = 'all', pos = 'any', jlpt = 'any', pool = 'all' } = {}) {
  return { script, level, pos, jlpt, pool };
}

/**
 * Compile a filter into a predicate (canonicalised once, not per word).
 * @param {WordFilter} filter
 * @returns {(word: Word) => boolean}
 */
function predicateFor(filter) {
  const f = canonicalFilter(filter);
  return (word) => (f.script === 'mixed' || word.script === f.script)
    && (f.level === 'all' || word.level === f.level)
    && (f.pos === 'any' || word.posCategory === f.pos)
    && (f.jlpt === 'any' || word.jlpt === f.jlpt)
    && (f.pool !== 'common' || word.common);
}

/** Immutable, indexed word bank. */
export class WordBank {
  /**
   * @param {{ meta: object, words: object[] }} data parsed words.json
   * @throws {WordBankError}
   */
  constructor(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.words)) {
      throw new WordBankError('words.json must be an object with a "words" array.');
    }
    if (!data.words.length) throw new WordBankError('words.json contains no words.');
    /** @type {Map<string, Word>} */
    this.byId = new Map();
    /** @type {Map<string, Word[]>} words sharing the same kana (homophones) */
    this.byKana = new Map();
    data.words.forEach((raw, index) => {
      const problem = wordProblem(raw);
      if (problem) throw new WordBankError(`Invalid word at index ${index} (id ${raw?.id ?? '?'}): ${problem}.`);
      if (this.byId.has(raw.id)) throw new WordBankError(`Duplicate word id "${raw.id}" at index ${index}.`);
      const word = deepFreeze({
        ...raw,
        common: raw.common ?? true,
        usuallyKana: Boolean(raw.usuallyKana),
        senses: raw.senses.map((s) => ({ pos: s.pos, gloss: s.gloss, info: s.info ?? [] })),
        len: [...raw.kana].length,
      });
      this.byId.set(word.id, word);
      const group = this.byKana.get(word.kana);
      if (group) group.push(word);
      else this.byKana.set(word.kana, [word]);
    });
    /** @type {readonly Word[]} */
    this.words = Object.freeze([...this.byId.values()]);
    this.meta = deepFreeze(structuredClone(data.meta ?? {}));
    this.counts = this.computeCounts();
    /** @type {Map<string, number>} */
    this.countCache = new Map();
  }

  /** Counts recomputed from the words themselves (meta.counts is not trusted). */
  computeCounts() {
    const counts = {
      total: this.words.length,
      common: 0,
      byScript: { hiragana: 0, katakana: 0 },
      byLevel: { 1: 0, 2: 0, 3: 0 },
      byPos: Object.fromEntries(POS_CATEGORIES.map((p) => [p, 0])),
      byJlpt: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
    };
    for (const w of this.words) {
      if (w.common) counts.common += 1;
      counts.byScript[w.script] += 1;
      counts.byLevel[w.level] += 1;
      counts.byPos[w.posCategory] += 1;
      if (w.jlpt !== null) counts.byJlpt[w.jlpt] += 1;
    }
    return deepFreeze(counts);
  }

  /** @returns {boolean} whether any word carries a JLPT level */
  get jlptAvailable() {
    return Object.values(this.counts.byJlpt).some((n) => n > 0);
  }

  /**
   * @param {string} id
   * @returns {Word|undefined}
   */
  get(id) {
    return this.byId.get(id);
  }

  /**
   * Whether `word` passes `filter` (script 'mixed' matches both scripts).
   * @param {Word} word
   * @param {WordFilter} filter
   * @returns {boolean}
   */
  matches(word, filter) {
    return predicateFor(filter)(word);
  }

  /**
   * All words matching the filter.
   * @param {WordFilter} [filter]
   * @returns {Word[]}
   */
  filter(filter = {}) {
    return this.words.filter(predicateFor(filter));
  }

  /**
   * Number of words matching the filter (memoised).
   * @param {WordFilter} [filter]
   * @returns {number}
   */
  count(filter = {}) {
    const f = canonicalFilter(filter);
    const key = `${f.script}|${f.level}|${f.pos}|${f.jlpt}|${f.pool}`;
    let n = this.countCache.get(key);
    if (n === undefined) {
      n = this.filter(f).length;
      this.countCache.set(key, n);
    }
    return n;
  }

  /**
   * `n` random words with distinct kana (uniform).
   * @param {number} n
   * @param {() => number} [rng=Math.random]
   * @returns {Word[]}
   */
  sample(n, rng = Math.random) {
    const out = [];
    const usedKana = new Set();
    const ids = new Set();
    const maxTries = n * 20;
    for (let tries = 0; out.length < n && tries < maxTries && ids.size < this.words.length; tries += 1) {
      const w = this.words[Math.floor(rng() * this.words.length)];
      if (ids.has(w.id)) continue;
      ids.add(w.id);
      if (usedKana.has(w.kana)) continue;
      usedKana.add(w.kana);
      out.push(w);
    }
    return out;
  }

  /**
   * Full WordInfo (SPEC §7.1) for a word or word id.
   * @param {Word|string} wordOrId
   * @returns {object|null} null when the id is unknown
   */
  wordInfo(wordOrId) {
    const w = typeof wordOrId === 'string' ? this.byId.get(wordOrId) : wordOrId;
    if (!w) return null;
    const homophones = (this.byKana.get(w.kana) ?? [])
      .filter((h) => h.id !== w.id)
      .slice(0, 3)
      .map((h) => ({ id: h.id, kanji: h.kanji[0] ?? null, meaning: meaningOf(h) }));
    return {
      id: w.id,
      kana: w.kana,
      romaji: w.romaji,
      script: w.script,
      kanji: w.kanji,
      common: w.common,
      usuallyKana: w.usuallyKana,
      senses: w.senses,
      meaning: meaningOf(w),
      posCategory: w.posCategory,
      origin: w.origin,
      jlpt: w.jlpt,
      level: w.level,
      features: w.features,
      homophones,
    };
  }

  /** Response body of `GET /api/words/meta`. */
  metaSummary() {
    const src = this.meta.source ?? {};
    const jlpt = this.meta.jlptSource ?? null;
    return {
      total: this.counts.total,
      byPool: { all: this.counts.total, common: this.counts.common },
      byScript: this.counts.byScript,
      byLevel: this.counts.byLevel,
      byPos: this.counts.byPos,
      jlptAvailable: this.jlptAvailable,
      byJlpt: this.counts.byJlpt,
      source: {
        name: src.name ?? 'JMdict',
        version: src.version ?? null,
        license: src.license ?? 'CC BY-SA 4.0',
        url: src.url ?? 'https://www.edrdg.org/jmdict/j_jmdict.html',
        attribution: src.attribution ?? null,
      },
      jlptSource: jlpt ? { name: jlpt.name ?? null, license: jlpt.license ?? null, url: jlpt.url ?? null } : null,
    };
  }
}

/**
 * First sense glosses joined with "; ".
 * @param {Word} w
 * @returns {string}
 */
export function meaningOf(w) {
  return w.senses[0]?.gloss.join('; ') ?? '';
}

/** gzip magic bytes. */
const GZIP_MAGIC = Object.freeze([0x1f, 0x8b]);

/**
 * Read, decompress (gzip is detected by its magic bytes, whatever the extension), parse and
 * validate a word bank file (`words.json.gz` or `words.json`).
 * @param {string} filePath
 * @returns {Promise<WordBank>}
 * @throws {WordBankError} code 'MISSING' when the file does not exist
 */
export async function loadWordBank(filePath) {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new WordBankError(`Word bank not found at ${filePath}.`, { code: 'MISSING', cause: err });
    }
    throw new WordBankError(`Could not read ${filePath}: ${err.message}`, { cause: err });
  }
  if (buffer[0] === GZIP_MAGIC[0] && buffer[1] === GZIP_MAGIC[1]) {
    try {
      buffer = await gunzip(buffer);
    } catch (err) {
      throw new WordBankError(`${filePath} is not a valid gzip file: ${err.message}`, { cause: err });
    }
  }
  let data;
  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch (err) {
    throw new WordBankError(`${filePath} is not valid JSON: ${err.message}`, { cause: err });
  }
  return new WordBank(data);
}

/**
 * Load the word bank from `filePath`, or from `fallbackPath` when the first does not exist
 * (e.g. a legacy `words.json` while `words.json.gz` has not been built yet).
 * @param {string} filePath
 * @param {string|null} [fallbackPath]
 * @returns {Promise<{ bank: WordBank, path: string }>}
 * @throws {WordBankError} code 'MISSING' (about `filePath`) when neither exists
 */
export async function loadWordBankWithFallback(filePath, fallbackPath = null) {
  try {
    return { bank: await loadWordBank(filePath), path: filePath };
  } catch (err) {
    if (!(err instanceof WordBankError) || err.code !== 'MISSING' || !fallbackPath || fallbackPath === filePath) throw err;
    try {
      return { bank: await loadWordBank(fallbackPath), path: fallbackPath };
    } catch (fallbackErr) {
      if (fallbackErr instanceof WordBankError && fallbackErr.code === 'MISSING') throw err;
      throw fallbackErr;
    }
  }
}
