#!/usr/bin/env node
/**
 * Build data/words.json.gz from the full English JMdict (+ JLPT levels).
 * See docs/SPEC.md section 4 and section 15.1.
 *
 * Usage: npm run build:words [-- --refresh] [-- --samples=N] [-- --uncommon-samples=N]
 *   --refresh             ignore cached downloads in .cache/wordbank and fetch fresh copies
 *   --samples=N           number of random sample words printed at the end (default 40)
 *   --uncommon-samples=N  number of random non-common sample words printed (default 40)
 *
 * Downloads are cached under .cache/wordbank/ and only ever parsed as data (gzip/tar, JSON, CSV).
 */
import { mkdir, rename, writeFile, rm } from 'node:fs/promises';
import { gzipSync, constants as zlibConstants } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWord, POS_CATEGORIES, scriptAmbiguousIds } from './lib/wordbank-rules.mjs';
import { loadJlpt, loadJmdict, JLPT_LEVELS } from './lib/sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_ROOT = path.join(ROOT, '.cache', 'wordbank');
const OUT_FILE = path.join(ROOT, 'data', 'words.json.gz');
// The uncompressed bank of v1; removed after a successful build so only one bank ships.
const LEGACY_FILE = path.join(ROOT, 'data', 'words.json');
const MAX_BYTES = 25 * 1024 * 1024;

const SOURCE_INFO = Object.freeze({
  name: 'JMdict via jmdict-simplified',
  license: 'CC BY-SA 4.0',
  url: 'https://www.edrdg.org/jmdict/j_jmdict.html',
  attribution:
    "This app uses the JMdict dictionary files, the property of the Electronic Dictionary Research and Development Group, used in conformance with the Group's licence (CC BY-SA 4.0).",
});
const JLPT_SOURCE = Object.freeze({
  name: 'JLPT vocabulary lists by Jonathan Waller (tanos.co.uk) via stephenmk/yomitan-jlpt-vocab',
  license: 'CC BY',
  url: 'https://github.com/stephenmk/yomitan-jlpt-vocab',
});

const log = (msg) => console.log(msg);

/**
 * Parse command-line flags.
 * @param {string[]} argv
 * @returns {{ refresh: boolean, samples: number, uncommonSamples: number }}
 */
function parseArgs(argv) {
  const opts = { refresh: false, samples: 40, uncommonSamples: 40 };
  for (const arg of argv) {
    const num = /^--(samples|uncommon-samples)=(\d+)$/.exec(arg);
    if (arg === '--refresh') opts.refresh = true;
    else if (num?.[1] === 'samples') opts.samples = Number(num[2]);
    else if (num) opts.uncommonSamples = Number(num[2]);
    else throw new Error(`Unknown argument "${arg}". Supported: --refresh, --samples=N, --uncommon-samples=N`);
  }
  return opts;
}

/**
 * Run every dictionary entry through the SPEC rules.
 * @param {object[]} entries
 * @param {Map<string, number>|null} jlptById
 * @returns {{ words: object[], skipped: Map<string, number> }}
 */
function buildWords(entries, jlptById) {
  const words = [];
  const skipped = new Map();
  const seen = new Set();
  for (const entry of entries) {
    const result = buildWord(entry, jlptById ?? new Map());
    if (result.word) {
      if (seen.has(result.word.id)) throw new Error(`Duplicate JMdict id ${result.word.id}`);
      seen.add(result.word.id);
      words.push(result.word);
    } else {
      skipped.set(result.reason, (skipped.get(result.reason) ?? 0) + 1);
    }
  }
  const ambiguous = scriptAmbiguousIds(words);
  if (ambiguous.size) skipped.set('romaji shared by both scripts', ambiguous.size);
  return { words: words.filter((w) => !ambiguous.has(w.id)), skipped };
}

/**
 * Aggregate counts for meta.counts.
 * @param {object[]} words
 */
function countWords(words) {
  const counts = {
    total: words.length,
    common: 0,
    hiragana: 0,
    katakana: 0,
    byLevel: { 1: 0, 2: 0, 3: 0 },
    byPos: Object.fromEntries(POS_CATEGORIES.map((p) => [p, 0])),
    byJlpt: Object.fromEntries(JLPT_LEVELS.map((n) => [n, 0])),
  };
  for (const w of words) {
    counts[w.script] += 1;
    if (w.common) counts.common += 1;
    counts.byLevel[w.level] += 1;
    counts.byPos[w.posCategory] += 1;
    if (w.jlpt !== null) counts.byJlpt[w.jlpt] += 1;
  }
  return counts;
}

/**
 * Serialize the bank with one word per line so diffs stay readable.
 * @param {object} meta
 * @param {object[]} words
 * @returns {string}
 */
function serialize(meta, words) {
  const lines = words.map((w, i) => `    ${JSON.stringify(w)}${i < words.length - 1 ? ',' : ''}`);
  const metaJson = JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ');
  return `{\n  "meta": ${metaJson},\n  "words": [\n${lines.join('\n')}\n  ]\n}\n`;
}

/** Write a file atomically (temp file + rename). */
async function writeAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Format a count map as "key value · key value". */
const formatCounts = (obj) => Object.entries(obj).map(([k, v]) => `${k} ${v}`).join(' · ');
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/**
 * Pick up to `n` distinct random items.
 * @template T
 * @param {T[]} items
 * @param {number} n
 * @returns {T[]}
 */
function sample(items, n) {
  const pool = [...items];
  const picks = [];
  while (picks.length < Math.min(n, pool.length)) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return picks;
}

/**
 * Print sample words, one per line.
 * @param {string} title
 * @param {object[]} picks
 */
function printSamples(title, picks) {
  if (!picks.length) return;
  log(`\n${picks.length} ${title} (kana · romaji · script · pos · level · JLPT · meaning):`);
  for (const w of picks) {
    const jlpt = w.jlpt === null ? '-' : `N${w.jlpt}`;
    const meaning = w.senses[0].gloss.slice(0, 2).join('; ');
    log(`  ${w.kana}  ${w.romaji} · ${w.script} · ${w.posCategory} · L${w.level} · ${jlpt} · ${meaning}`);
  }
}

/**
 * Print the build summary and random samples (all words, then non-common words only).
 * @param {object} counts
 * @param {Map<string, number>} skipped
 * @param {object[]} words
 * @param {{ raw: number, gz: number }} bytes
 * @param {{ samples: number, uncommonSamples: number }} opts
 */
function printReport(counts, skipped, words, bytes, opts) {
  log('');
  log(`Words: ${counts.total} (common ${counts.common}; hiragana ${counts.hiragana}, katakana ${counts.katakana})`);
  log(`By level: ${formatCounts(counts.byLevel)}`);
  log(`By POS:   ${formatCounts(counts.byPos)}`);
  log(`By JLPT:  ${formatCounts(counts.byJlpt)}`);
  const skippedTotal = [...skipped.values()].reduce((a, b) => a + b, 0);
  log(`Skipped ${skippedTotal} entries:`);
  for (const [reason, n] of [...skipped].sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(6)}  ${reason}`);
  log(`Wrote ${path.relative(ROOT, OUT_FILE)} (${megabytes(bytes.gz)} gzip, ${megabytes(bytes.raw)} JSON)`);
  printSamples('random samples', sample(words, opts.samples));
  printSamples('random non-common samples', sample(words.filter((w) => !w.common), opts.uncommonSamples));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  log(`Loading JMdict${opts.refresh ? ' (refreshing cache)' : ''}…`);
  const { dict, releaseVersion, fromCache } = await loadJmdict({ cacheRoot: CACHE_ROOT, refresh: opts.refresh, log });
  log(`JMdict ${releaseVersion} (${dict.dictDate}): ${dict.words.length} entries${fromCache ? ' [cache]' : ''}`);
  const jlptById = await loadJlpt({ cacheRoot: CACHE_ROOT, refresh: opts.refresh, log });
  if (jlptById) log(`JLPT lists: ${jlptById.size} JMdict ids`);

  const { words, skipped } = buildWords(dict.words, jlptById);
  const counts = countWords(words);
  const meta = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      name: SOURCE_INFO.name,
      version: releaseVersion,
      dictDate: dict.dictDate,
      license: SOURCE_INFO.license,
      url: SOURCE_INFO.url,
      attribution: SOURCE_INFO.attribution,
    },
    jlptSource: jlptById ? { ...JLPT_SOURCE } : null,
    counts,
  };
  const raw = Buffer.from(serialize(meta, words), 'utf8');
  const gz = gzipSync(raw, { level: zlibConstants.Z_BEST_COMPRESSION });
  if (gz.length > MAX_BYTES) {
    throw new Error(`words.json.gz would be ${megabytes(gz.length)}, above the ${megabytes(MAX_BYTES)} budget; nothing written.`);
  }
  await writeAtomic(OUT_FILE, gz);
  await rm(LEGACY_FILE, { force: true });
  printReport(counts, skipped, words, { raw: raw.length, gz: gz.length }, opts);
}

main().catch((err) => {
  console.error(`\nbuild-wordbank failed: ${err.message}`);
  if (err.name === 'DownloadError') {
    console.error('Check your internet connection; once downloaded, sources are cached in .cache/wordbank/.');
  }
  process.exitCode = 1;
});
