/**
 * HiraKata kana engine (docs/SPEC.md §3).
 *
 * Pure, dependency-free ES module shared by the server (Node 22+) and the browser.
 * No DOM, no Node APIs. Strings are always iterated by code point (`Array.from`).
 *
 * Sections:
 *   1. Character classification & script conversion
 *   2. Answer normalization
 *   3. Romanization (kana → romaji)
 *   4. Romaji input method (romaji → kana)
 *   5. Units & difficulty analysis
 *   6. Diff, comparison & guided spelling
 *   7. On-screen keyboard data & modifiers
 */

// ---------------------------------------------------------------------------
// 1. Character classification & script conversion
// ---------------------------------------------------------------------------

const HIRAGANA_FIRST = 0x3041; // ぁ
const HIRAGANA_LAST = 0x3096; // ゖ
const KATAKANA_FIRST = 0x30a1; // ァ
const KATAKANA_LAST = 0x30fa; // ヺ
const KATAKANA_CONVERTIBLE_LAST = 0x30f6; // ヶ (last katakana with a hiragana twin)
const SCRIPT_OFFSET = 0x60;

/** The katakana long-vowel mark ー (U+30FC). */
export const LONG_MARK = 'ー';

/** Small kana that merge with the preceding kana into one unit (§3 kanaUnits). */
const COMBINING_SMALL = new Set(Array.from('ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ'));
/** Every small kana (combining ones plus sokuon and the small ka/ke counters). */
const SMALL_KANA = new Set([...COMBINING_SMALL, ...Array.from('っッゕゖヵヶ')]);

/** Coerces an optional string-like argument; `null`/`undefined` become ''. */
function asString(value) {
  return value == null ? '' : String(value);
}

/** Returns the code point of a single-code-point string, or -1 for anything else. */
function singleCodePoint(ch) {
  if (typeof ch !== 'string' || ch.length === 0 || ch.length > 2) return -1;
  const cp = ch.codePointAt(0);
  return String.fromCodePoint(cp).length === ch.length ? cp : -1;
}

/**
 * Whether `ch` is a single hiragana character (U+3041–U+3096).
 * @param {string} ch
 * @returns {boolean}
 */
export function isHiragana(ch) {
  const cp = singleCodePoint(ch);
  return cp >= HIRAGANA_FIRST && cp <= HIRAGANA_LAST;
}

/**
 * Whether `ch` is a single katakana character (U+30A1–U+30FA) or the long-vowel mark ー.
 * @param {string} ch
 * @returns {boolean}
 */
export function isKatakana(ch) {
  const cp = singleCodePoint(ch);
  return (cp >= KATAKANA_FIRST && cp <= KATAKANA_LAST) || ch === LONG_MARK;
}

/**
 * Whether `ch` is a single hiragana or katakana character (ー included).
 * @param {string} ch
 * @returns {boolean}
 */
export function isKana(ch) {
  return isHiragana(ch) || isKatakana(ch);
}

/**
 * Whether `ch` is a small kana (ゃゅょぁぃぅぇぉゎっゕゖ and their katakana forms).
 * @param {string} ch
 * @returns {boolean}
 */
export function isSmallKana(ch) {
  return SMALL_KANA.has(ch);
}

/**
 * Script of a single character: 'hiragana', 'katakana' (ー included) or null.
 * @param {string} ch
 * @returns {'hiragana'|'katakana'|null}
 */
export function scriptOf(ch) {
  if (isHiragana(ch)) return 'hiragana';
  if (isKatakana(ch)) return 'katakana';
  return null;
}

/**
 * Classifies a whole string. ー counts as katakana; any non-kana character makes it 'other'.
 * @param {string} str
 * @returns {'empty'|'hiragana'|'katakana'|'mixed'|'other'}
 */
export function detectScript(str) {
  const chars = Array.from(asString(str));
  if (chars.length === 0) return 'empty';
  let hira = false;
  let kata = false;
  for (const ch of chars) {
    const script = scriptOf(ch);
    if (script === null) return 'other';
    if (script === 'hiragana') hira = true;
    else kata = true;
  }
  if (hira && kata) return 'mixed';
  return hira ? 'hiragana' : 'katakana';
}

/** Maps every code point in `[first, last]` by `delta`, leaving all others unchanged. */
function shiftRange(str, first, last, delta) {
  let out = '';
  for (const ch of asString(str)) {
    const cp = ch.codePointAt(0);
    out += cp >= first && cp <= last ? String.fromCodePoint(cp + delta) : ch;
  }
  return out;
}

/**
 * Converts hiragana ぁ–ゖ to katakana ァ–ヶ (ゔ → ヴ); everything else is unchanged.
 * @param {string} str
 * @returns {string}
 */
export function toKatakana(str) {
  return shiftRange(str, HIRAGANA_FIRST, HIRAGANA_LAST, SCRIPT_OFFSET);
}

/**
 * Converts katakana ァ–ヶ to hiragana ぁ–ゖ; ー, ヷ–ヺ and everything else are unchanged.
 * @param {string} str
 * @returns {string}
 */
export function toHiragana(str) {
  return shiftRange(str, KATAKANA_FIRST, KATAKANA_CONVERTIBLE_LAST, -SCRIPT_OFFSET);
}

// ---------------------------------------------------------------------------
// 2. Answer normalization
// ---------------------------------------------------------------------------

// \s covers ASCII whitespace, NBSP, U+3000 (ideographic space), U+FEFF and the Unicode spaces;
// \p{Cf} adds the other invisible format characters (U+200B to U+200D, word joiner, soft hyphen, bidi marks).
const STRIP_RE = /[\s\u200B-\u200D\uFEFF\p{Cf}]/gu;
const DASH_RE = /[-\u2010-\u2015\u2212\uFF0D\uFF70]/gu;

/**
 * Normalizes a learner's answer (§3.3): NFKC (half-width katakana → full-width, full-width ASCII →
 * ASCII), strips all whitespace and zero-width characters, maps dash-like characters to ー.
 * A final NFC pass composes (han)dakuten that only became adjacent to their kana once spaces were
 * removed (NFKC turns a spacing ゛/ﾞ into " ゙"), so `か゛` and `ｶ ﾞ` read as が / ガ.
 * Never converts between scripts.
 * @param {string} str
 * @returns {string}
 */
export function normalizeAnswer(str) {
  return asString(str).normalize('NFKC').replace(STRIP_RE, '').replace(DASH_RE, LONG_MARK).normalize('NFC');
}

// ---------------------------------------------------------------------------
// 3. Romanization (kana → romaji)
// ---------------------------------------------------------------------------

/** Parses 'かka きki …' (space-separated kana immediately followed by romaji) into entries. */
function parsePairs(spec) {
  return spec.trim().split(/\s+/).map((item) => {
    const kana = item.match(/^[^a-z']+/)[0];
    return [kana, item.slice(kana.length)];
  });
}

/** Single kana (hiragana form, plus katakana-only ヷヸヹヺ) → modified Hepburn (§3.1). */
const SINGLE_ROMAJI = new Map(parsePairs(`
  あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso
  たta ちchi つtsu てte とto なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho
  まma みmi むmu めme もmo やya ゆyu よyo らra りri るru れre ろro
  わwa ゐwi ゑwe をwo がga ぎgi ぐgu げge ごgo ざza じji ずzu ぜze ぞzo
  だda ぢdi づdu でde どdo ばba びbi ぶbu べbe ぼbo ぱpa ぴpi ぷpu ぺpe ぽpo ゔvu
  ぁxa ぃxi ぅxu ぇxe ぉxo ゃxya ゅxyu ょxyo ゎxwa ゕxka ゖxke
  ヷva ヸvi ヹve ヺvo
`));

/** Two-kana combinations (hiragana form): yōon and the extended katakana combinations. */
const PAIR_ROMAJI = new Map([
  ...[['き', 'ky'], ['ぎ', 'gy'], ['し', 'sh'], ['じ', 'j'], ['ち', 'ch'], ['ぢ', 'dy'],
    ['に', 'ny'], ['ひ', 'hy'], ['び', 'by'], ['ぴ', 'py'], ['み', 'my'], ['り', 'ry']]
    .flatMap(([base, cons]) => [[`${base}ゃ`, `${cons}a`], [`${base}ゅ`, `${cons}u`], [`${base}ょ`, `${cons}o`]]),
  ...parsePairs(`
    しぇshe じぇje ちぇche ふぁfa ふぃfi ふぇfe ふぉfo ふゅfyu
    てぃti でぃdi とぅtu どぅdu てゅtyu でゅdyu うぃwi うぇwe うぉwo
    ゔぁva ゔぃvi ゔぇve ゔぉvo ゔゃvya ゔゅvyu ゔょvyo
    つぁtsa つぃtsi つぇtse つぉtso いぇye
    くぁkwa くぃkwi くぇkwe くぉkwo ぐぁgwa ぐぃgwi ぐぇgwe ぐぉgwo すぃsi ずぃzi
  `),
]);

/**
 * Typing spellings that differ from the display romaji: the display form would convert back to
 * different kana in {@link romajiToKana} (e.g. display `ti` types ち, so ティ is typed `thi`).
 */
const IME_OVERRIDES = new Map(parsePairs(`
  てぃthi でぃdhi とぅtwu どぅdwu てゅthu でゅdhu うぉwho すぃsuxi ずぃzuxi ゐwyi ゑwye
`));

/** Kana with no romaji keystrokes; {@link toImeRomaji} passes them through unchanged. */
const UNTYPABLE = new Set(Array.from('ヷヸヹヺ'));

const MACRONS = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };
const VOWELS = 'aiueo';
/** Letters that sokuon may double (n and x never start a doublable syllable). */
const DOUBLABLE = 'bcdfghjkmpqrstvwyz';

/**
 * Splits kana into romanization tokens: syllables (`syl`), sokuon, ん, ー, and pass-through text.
 * @returns {Array<{type: 'syl'|'sokuon'|'n'|'long'|'raw', kana: string, romaji?: string}>}
 */
function tokenizeKana(kana) {
  const chars = Array.from(asString(kana));
  const tokens = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const hira = toHiragana(ch);
    if (i + 1 < chars.length) {
      const pair = hira + toHiragana(chars[i + 1]);
      const romaji = PAIR_ROMAJI.get(pair);
      if (romaji !== undefined) {
        tokens.push({ type: 'syl', kana: pair, romaji });
        i++;
        continue;
      }
    }
    if (hira === 'っ') tokens.push({ type: 'sokuon', kana: hira });
    else if (hira === 'ん') tokens.push({ type: 'n', kana: hira });
    else if (ch === LONG_MARK) tokens.push({ type: 'long', kana: ch });
    else if (SINGLE_ROMAJI.has(hira)) tokens.push({ type: 'syl', kana: hira, romaji: SINGLE_ROMAJI.get(hira) });
    else tokens.push({ type: 'raw', kana: ch });
  }
  return tokens;
}

/** Shared romanizer; `ime` selects typing spellings (see {@link toImeRomaji}). */
function romanize(kana, ime) {
  const tokens = tokenizeKana(kana);
  const spell = (token) => {
    if (!ime) return token.romaji;
    return UNTYPABLE.has(token.kana) ? token.kana : IME_OVERRIDES.get(token.kana) ?? token.romaji;
  };
  let out = '';
  tokens.forEach((token, k) => {
    const next = tokens[k + 1];
    const nextRomaji = next && next.type === 'syl' ? spell(next) : '';
    switch (token.type) {
      case 'syl':
        out += spell(token);
        break;
      case 'sokuon':
        if (nextRomaji && DOUBLABLE.includes(nextRomaji[0])) {
          out += nextRomaji.startsWith('ch') ? 't' : nextRomaji[0];
        } else {
          out += 'xtsu';
        }
        break;
      case 'n':
        if (nextRomaji && `${VOWELS}y`.includes(nextRomaji[0])) out += "n'";
        else if (ime && (!next || next.type === 'n' || nextRomaji.startsWith('n'))) out += 'nn';
        else out += 'n';
        break;
      case 'long': {
        // Only a syllable's own vowel lengthens; after っ ("xtsu"), ん, ー or raw text it is "-".
        const last = out.slice(-1);
        const afterVowel = tokens[k - 1]?.type === 'syl' && Object.hasOwn(MACRONS, last);
        out = !ime && afterVowel ? out.slice(0, -1) + MACRONS[last] : `${out}-`;
        break;
      }
      default:
        out += token.kana;
    }
  });
  return out;
}

/**
 * Display romanization (§3.1): modified Hepburn that lets a learner reconstruct the exact kana.
 * Hiragana long vowels are spelled out; ー becomes a macron on the preceding vowel (else `-`);
 * っ doubles the next consonant (`t` before `ch`, `xtsu` when nothing consonantal follows);
 * ん is `n'` before a vowel or `y`. Unknown characters pass through unchanged.
 * @param {string} kana
 * @returns {string} e.g. `toRomaji('コーヒー') === 'kōhī'`
 */
export function toRomaji(kana) {
  return romanize(kana, false);
}

/**
 * Romaji keystrokes that {@link romajiToKana} converts back to exactly this kana (script aside):
 * ー → `-`, ん → `nn` before n-syllables/ん/end of word, typing spellings such as `thi` (ティ) and
 * `who` (ウォ). Characters with no romaji spelling (e.g. ヷ) are passed through as-is.
 * @param {string} kana
 * @returns {string} e.g. `toImeRomaji('コーヒー') === 'ko-hi-'`
 */
export function toImeRomaji(kana) {
  return romanize(kana, true);
}

// ---------------------------------------------------------------------------
// 4. Romaji input method (romaji → kana), Microsoft-IME style (§3.2)
// ---------------------------------------------------------------------------

const ROW_VOWELS = ['a', 'i', 'u', 'e', 'o'];

/** Romaji rows: prefix → kana for a, i, u, e, o (string = one kana each; array = explicit). */
const ROMAJI_ROWS = {
  '': 'あいうえお', k: 'かきくけこ', g: 'がぎぐげご', s: 'さしすせそ', z: 'ざじずぜぞ',
  t: 'たちつてと', d: 'だぢづでど', n: 'なにぬねの', h: 'はひふへほ', b: 'ばびぶべぼ',
  p: 'ぱぴぷぺぽ', m: 'まみむめも', r: 'らりるれろ', x: 'ぁぃぅぇぉ', l: 'ぁぃぅぇぉ',
  xy: 'ゃぃゅぇょ', ly: 'ゃぃゅぇょ',
  y: ['や', 'い', 'ゆ', 'いぇ', 'よ'],
  w: ['わ', 'うぃ', 'う', 'うぇ', 'を'],
  wh: ['うぁ', 'うぃ', 'う', 'うぇ', 'うぉ'],
  c: ['か', 'し', 'く', 'せ', 'こ'],
  q: ['くぁ', 'くぃ', 'く', 'くぇ', 'くぉ'],
  f: ['ふぁ', 'ふぃ', 'ふ', 'ふぇ', 'ふぉ'],
  v: ['ゔぁ', 'ゔぃ', 'ゔ', 'ゔぇ', 'ゔぉ'],
  ts: ['つぁ', 'つぃ', 'つ', 'つぇ', 'つぉ'],
  sh: ['しゃ', 'し', 'しゅ', 'しぇ', 'しょ'],
  ch: ['ちゃ', 'ち', 'ちゅ', 'ちぇ', 'ちょ'],
  j: ['じゃ', 'じ', 'じゅ', 'じぇ', 'じょ'],
  th: ['てゃ', 'てぃ', 'てゅ', 'てぇ', 'てょ'],
  dh: ['でゃ', 'でぃ', 'でゅ', 'でぇ', 'でょ'],
  tw: ['とぁ', 'とぃ', 'とぅ', 'とぇ', 'とぉ'],
  dw: ['どぁ', 'どぃ', 'どぅ', 'どぇ', 'どぉ'],
  kw: ['くぁ', 'くぃ', 'くぅ', 'くぇ', 'くぉ'],
  gw: ['ぐぁ', 'ぐぃ', 'ぐぅ', 'ぐぇ', 'ぐぉ'],
};

/** Yōon prefixes: prefix + vowel → base kana + small ゃぃゅぇょ. */
const YOON_BASES = {
  ky: 'き', gy: 'ぎ', sy: 'し', zy: 'じ', jy: 'じ', ty: 'ち', cy: 'ち', dy: 'ぢ', ny: 'に',
  hy: 'ひ', by: 'び', py: 'ぴ', my: 'み', ry: 'り', fy: 'ふ', vy: 'ゔ',
};

/** Complete romaji → hiragana table (ん via nn / n' / xn and っ via doubling are handled in code). */
const ROMAJI_TABLE = (() => {
  const table = new Map();
  for (const [prefix, row] of Object.entries(ROMAJI_ROWS)) {
    const kana = Array.isArray(row) ? row : Array.from(row);
    ROW_VOWELS.forEach((vowel, idx) => table.set(prefix + vowel, kana[idx]));
  }
  for (const [prefix, base] of Object.entries(YOON_BASES)) {
    Array.from('ゃぃゅぇょ').forEach((small, idx) => table.set(prefix + ROW_VOWELS[idx], base + small));
  }
  const extras = {
    shi: 'し', chi: 'ち', tsu: 'つ', xtu: 'っ', ltu: 'っ', xtsu: 'っ', ltsu: 'っ', xwa: 'ゎ', lwa: 'ゎ',
    xka: 'ゕ', lka: 'ゕ', xke: 'ゖ', lke: 'ゖ', xn: 'ん', wyi: 'ゐ', wye: 'ゑ', '-': LONG_MARK,
  };
  for (const [romaji, kana] of Object.entries(extras)) table.set(romaji, kana);
  return table;
})();

const MAX_ROMAJI_KEY = Math.max(...[...ROMAJI_TABLE.keys()].map((key) => key.length));

/** Proper prefixes of table keys — a trailing run equal to one of these is an incomplete cluster. */
const ROMAJI_PREFIXES = new Set(
  [...ROMAJI_TABLE.keys()].flatMap((key) => Array.from({ length: key.length - 1 }, (_, n) => key.slice(0, n + 1))),
);

/**
 * Frozen copy of the romaji → hiragana table used by {@link romajiToKana} (e.g. for help pages).
 * Does not list the rule-based spellings: `nn`/`n'` → ん and doubled consonants → っ.
 * @type {Readonly<Record<string, string>>}
 */
export const ROMAJI_TO_KANA = Object.freeze(Object.fromEntries(ROMAJI_TABLE));

/** Lowercases ASCII A–Z only (never touches kana or other scripts). */
function asciiLower(ch) {
  return ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch;
}

function isRomajiChar(ch) {
  return (ch >= 'a' && ch <= 'z') || ch === '-' || ch === "'";
}

/** Longest table key starting at `i` in the lowercased code-point array, or null. */
function longestRomajiMatch(lower, i) {
  for (let len = Math.min(MAX_ROMAJI_KEY, lower.length - i); len > 0; len--) {
    const key = lower.slice(i, i + len).join('');
    const kana = ROMAJI_TABLE.get(key);
    if (kana !== undefined) return { kana, length: len };
  }
  return null;
}

/**
 * Converts romaji to kana like Microsoft IME (§3.2). Runs of ASCII letters, `-` and `'` are
 * converted (case-insensitive) with greedy longest match; kana and other characters pass through.
 *
 * - `nn`, `n'`, `xn` → ん; `n` before a consonant other than n/y (or before a non-letter) → ん,
 *   so `onna` → おんあ and `onnna` → おんな.
 * - A doubled consonant other than n → っ (`kka` → っか); `tch` → っち. `-` → ー.
 * - `ime: true` (live typing): a trailing lone `n` stays Latin so the user can keep typing.
 *   With `ime: false` a trailing `n` becomes ん. Incomplete clusters (`k`, `ky`, `sh`) always stay
 *   Latin, in their original case.
 *
 * @param {string} text
 * @param {{script?: 'hiragana'|'katakana', ime?: boolean}} [options]
 * @returns {string}
 * @throws {RangeError} when `script` is not 'hiragana' or 'katakana'
 */
export function romajiToKana(text, { script = 'hiragana', ime = false } = {}) {
  if (script !== 'hiragana' && script !== 'katakana') {
    throw new RangeError(`romajiToKana: unknown script "${script}"`);
  }
  const emit = script === 'katakana' ? toKatakana : (kana) => kana;
  const chars = Array.from(asString(text));
  const lower = chars.map(asciiLower);
  let out = '';
  let i = 0;
  while (i < chars.length) {
    const c = lower[i];
    const next = lower[i + 1];
    if (!isRomajiChar(c)) {
      out += chars[i++];
      continue;
    }
    if (DOUBLABLE.includes(c) && (next === c || (c === 't' && next === 'c' && lower[i + 2] === 'h'))) {
      out += emit('っ');
      i++;
      continue;
    }
    const match = longestRomajiMatch(lower, i);
    if (match) {
      out += emit(match.kana);
      i += match.length;
      continue;
    }
    if (c === 'n') {
      if (next === 'n' || next === "'") {
        out += emit('ん');
        i += 2;
      } else if (next === undefined) {
        out += ime ? chars[i] : emit('ん');
        i++;
      } else if (ROMAJI_PREFIXES.has(lower.slice(i).join(''))) {
        out += chars.slice(i).join(''); // trailing incomplete cluster such as "ny"
        i = chars.length;
      } else {
        out += emit('ん');
        i++;
      }
      continue;
    }
    out += chars[i++];
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Units & difficulty analysis
// ---------------------------------------------------------------------------

const COMBINING_DAKUTEN = '\u3099';
const COMBINING_HANDAKUTEN = '\u309A';
const NON_BASE = new Set(['っ', 'ッ', LONG_MARK]);

/**
 * Splits kana into pronunciation units: a base kana plus any following small ゃゅょぁぃぅぇぉゎ
 * (or katakana equivalents) form one unit. A small kana with no preceding base (start of string,
 * after っ/ッ/ー or after a non-kana character) stands alone.
 * @param {string} kana
 * @returns {string[]} e.g. `kanaUnits('きょう')` → `['きょ', 'う']`
 */
export function kanaUnits(kana) {
  const units = [];
  let canCombine = false;
  for (const ch of asString(kana)) {
    if (COMBINING_SMALL.has(ch) && canCombine) {
      units[units.length - 1] += ch;
    } else {
      units.push(ch);
      canCombine = isKana(ch) && !NON_BASE.has(ch);
    }
  }
  return units;
}

/** Feature tags in their canonical order (§3.4). */
export const KANA_FEATURES = Object.freeze(['dakuten', 'handakuten', 'yoon', 'sokuon', 'long', 'extended']);

const YOON_SMALL = new Set(Array.from('ゃゅょャュョ'));
const EXTENDED_CHARS = new Set(Array.from('ァィゥェォヮヴぁぃぅぇぉゎゔ'));
const COMPLEX_FEATURES = ['yoon', 'sokuon', 'long'];

/** Which feature tags a single character contributes. */
function charFeatures(ch) {
  const tags = [];
  if (!isKana(ch)) return tags;
  const decomposed = ch.normalize('NFD');
  if (decomposed.includes(COMBINING_DAKUTEN)) tags.push('dakuten');
  if (decomposed.includes(COMBINING_HANDAKUTEN)) tags.push('handakuten');
  if (YOON_SMALL.has(ch)) tags.push('yoon');
  if (ch === 'っ' || ch === 'ッ') tags.push('sokuon');
  if (ch === LONG_MARK) tags.push('long');
  if (EXTENDED_CHARS.has(ch)) tags.push('extended');
  return tags;
}

/**
 * Analyzes a word for difficulty (§3.4).
 *
 * Features: `dakuten` (any voiced kana incl. ゔ/ヴ), `handakuten` (ぱ…ぽ), `yoon` (small ゃゅょ),
 * `sokuon` (っ), `long` (ー), `extended` (small ぁぃぅぇぉゎ in either script, or ゔ/ヴ).
 * Level 1: length ≤ 4 with none of yoon/sokuon/long/extended. Level 3: extended, or length ≥ 7,
 * or length ≥ 5 with at least two of yoon/sokuon/long. Level 2 otherwise.
 *
 * @param {string} kana
 * @returns {{length: number, script: string, features: string[], level: 1|2|3}}
 */
export function analyzeKana(kana) {
  const chars = Array.from(asString(kana));
  const found = new Set(chars.flatMap(charFeatures));
  const features = KANA_FEATURES.filter((tag) => found.has(tag));
  const length = chars.length;
  const complexCount = COMPLEX_FEATURES.filter((tag) => found.has(tag)).length;
  let level = 2;
  if (found.has('extended') || length >= 7 || (length >= 5 && complexCount >= 2)) level = 3;
  else if (length <= 4 && complexCount === 0) level = 1;
  return { length, script: detectScript(chars.join('')), features, level };
}

// ---------------------------------------------------------------------------
// 6. Diff, comparison & guided spelling
// ---------------------------------------------------------------------------

/**
 * Character-level alignment of `actual` against `expected` (§3.3): Levenshtein on code points with
 * unit costs. The alignment is walked from the start, preferring match/sub, then del, then ins, so
 * equal-cost ambiguities resolve deterministically toward matching earlier characters.
 *
 * Ops: `match` / `sub` (both chars), `del` (expected char missing, `actual: null`),
 * `ins` (extra learner char, `expected: null`).
 *
 * @param {string} expected
 * @param {string} actual
 * @returns {Array<{op: 'match'|'sub'|'del'|'ins', expected: string|null, actual: string|null}>}
 */
export function diffKana(expected, actual) {
  const exp = Array.from(asString(expected));
  const act = Array.from(asString(actual));
  const rows = exp.length + 1;
  const cols = act.length + 1;
  // dist[i * cols + j] = edit distance between exp[i:] and act[j:] (suffix table, so we can walk forward).
  const dist = new Uint32Array(rows * cols);
  for (let i = exp.length; i >= 0; i--) {
    for (let j = act.length; j >= 0; j--) {
      const at = i * cols + j;
      if (i === exp.length) dist[at] = act.length - j;
      else if (j === act.length) dist[at] = exp.length - i;
      else {
        const diag = dist[at + cols + 1] + (exp[i] === act[j] ? 0 : 1);
        dist[at] = Math.min(diag, dist[at + cols] + 1, dist[at + 1] + 1);
      }
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < exp.length || j < act.length) {
    const here = dist[i * cols + j];
    if (i < exp.length && j < act.length) {
      const same = exp[i] === act[j];
      if (dist[(i + 1) * cols + j + 1] + (same ? 0 : 1) === here) {
        ops.push({ op: same ? 'match' : 'sub', expected: exp[i], actual: act[j] });
        i++;
        j++;
        continue;
      }
    }
    if (i < exp.length && dist[(i + 1) * cols + j] + 1 === here) {
      ops.push({ op: 'del', expected: exp[i], actual: null });
      i++;
    } else {
      ops.push({ op: 'ins', expected: null, actual: act[j] });
      j++;
    }
  }
  return ops;
}

/** Spellings that sound identical in modern standard Japanese (hiragana form). */
const SAME_SOUND = new Map([['を', 'お'], ['づ', 'ず'], ['ぢ', 'じ']]);
const VOWEL_KANA = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お' };

/** Vowel ('a'…'o') a single hiragana mora ends in (small kana included), or null (ん, っ, ー, other). */
function moraVowel(ch) {
  const vowel = SINGLE_ROMAJI.get(ch)?.slice(-1);
  return vowel && Object.hasOwn(VOWEL_KANA, vowel) ? vowel : null;
}

/**
 * Pronunciation key (§15.2): two spellings with the same key sound the same when read aloud.
 * Converts to hiragana; ー becomes the vowel kana of the previous mora (kept when there is none,
 * e.g. after ん/っ or at the start); を→お, づ→ず, ぢ→じ; long o `おう`→`おお` and long e
 * `えい`→`ええ` after any o-/e-column mora (so こう, こお and コー all give こお). A mora that
 * itself lengthens a vowel is not lengthened again by う/い, so こううん (kōun) ≠ こうおん (kōon).
 * Pass normalized kana ({@link normalizeAnswer}); other characters pass through unchanged.
 * @param {string} kana
 * @returns {string} e.g. `soundKey('コーヒー') === 'こおひい'`, `soundKey('せんせい') === 'せんせえ'`
 */
export function soundKey(kana) {
  let out = '';
  let prevVowel = null;
  let prevLengthens = false; // previous mora was the second half of a long vowel
  for (const raw of toHiragana(asString(kana))) {
    let ch = SAME_SOUND.get(raw) ?? raw;
    if (ch === LONG_MARK && prevVowel) ch = VOWEL_KANA[prevVowel];
    else if (!prevLengthens && ch === 'う' && prevVowel === 'o') ch = 'お';
    else if (!prevLengthens && ch === 'い' && prevVowel === 'e') ch = 'え';
    const vowel = moraVowel(ch);
    prevLengthens = Boolean(vowel) && !prevLengthens && ch === VOWEL_KANA[vowel] && vowel === prevVowel;
    out += ch;
    prevVowel = vowel;
  }
  return out;
}

/**
 * Checks a raw learner answer (§3.3, §15.2).
 * `errorType`: null (correct), 'empty', 'script' (right sounds, wrong script), 'variant' (listen
 * mode only: same script and same {@link soundKey}, non-standard spelling — counts as correct) or
 * 'spelling'. Romaji mode (the default) never returns 'variant'.
 * @param {string} expected the stored (already clean) kana
 * @param {string} rawActual the learner's raw input
 * @param {{mode?: 'romaji'|'listen'}} [options]
 * @returns {{correct: boolean, normalized: string,
 *   errorType: null|'empty'|'script'|'variant'|'spelling', diff: ReturnType<typeof diffKana>}}
 */
export function compareAnswer(expected, rawActual, { mode = 'romaji' } = {}) {
  const exp = asString(expected);
  const normalized = normalizeAnswer(rawActual);
  let errorType;
  if (normalized === exp) errorType = null;
  else if (normalized === '') errorType = 'empty';
  else if (toHiragana(normalized) === toHiragana(exp)) errorType = 'script';
  else if (mode === 'listen' && detectScript(normalized) === detectScript(exp)
    && soundKey(normalized) === soundKey(exp)) errorType = 'variant';
  else errorType = 'spelling';
  const correct = errorType === null || errorType === 'variant';
  return { correct, normalized, errorType, diff: diffKana(exp, normalized) };
}

/**
 * One outcome per expected character, in order (`match` → correct, `sub`/`del` → incorrect;
 * insertions are ignored). Pass the normalized answer (as stored by the backend).
 * @param {string} expected
 * @param {string} actual
 * @returns {Array<{index: number, char: string, correct: boolean}>}
 */
export function charOutcomes(expected, actual) {
  const outcomes = [];
  for (const op of diffKana(expected, actual)) {
    if (op.op === 'ins') continue;
    outcomes.push({ index: outcomes.length, char: op.expected, correct: op.op === 'match' });
  }
  return outcomes;
}

/**
 * Number of leading code points that `expected` and `typed` share.
 * @param {string} expected
 * @param {string} typed
 * @returns {number}
 */
export function commonPrefixLength(expected, typed) {
  const exp = Array.from(asString(expected));
  const got = Array.from(asString(typed));
  let n = 0;
  while (n < exp.length && n < got.length && exp[n] === got[n]) n++;
  return n;
}

/**
 * Guided-spelling state (§3.5) for the learner's current normalized kana (pending Latin removed).
 * @param {string} expected
 * @param {string} typed
 * @returns {{matched: number, nextIndex: number|null, wrongAt: number|null, complete: boolean,
 *   overflow: boolean}}
 */
export function guideState(expected, typed) {
  const expLen = Array.from(asString(expected)).length;
  const typedLen = Array.from(asString(typed)).length;
  const matched = commonPrefixLength(expected, typed);
  return {
    matched,
    nextIndex: matched < expLen ? matched : null,
    wrongAt: typedLen > matched ? matched : null,
    complete: matched === expLen && typedLen === expLen,
    overflow: matched === expLen && typedLen > expLen,
  };
}

// ---------------------------------------------------------------------------
// 7. On-screen keyboard data & modifiers (§3.6)
// ---------------------------------------------------------------------------

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Maps every string leaf of a nested array/object structure. */
function mapLeaves(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapLeaves(item, fn));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapLeaves(item, fn)]));
}

/**
 * Hiragana keyboard layout (deep-frozen). `basic`/`voiced` rows are the vowels a, i, u, e, o;
 * `''` marks an empty cell. Column headers are romaji consonants.
 */
export const KEYBOARD = deepFreeze({
  basicColumns: ['', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w', 'n'],
  basic: [
    ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', 'ん'],
    ['い', 'き', 'し', 'ち', 'に', 'ひ', 'み', '', 'り', '', ''],
    ['う', 'く', 'す', 'つ', 'ぬ', 'ふ', 'む', 'ゆ', 'る', '', ''],
    ['え', 'け', 'せ', 'て', 'ね', 'へ', 'め', '', 'れ', '', ''],
    ['お', 'こ', 'そ', 'と', 'の', 'ほ', 'も', 'よ', 'ろ', 'を', ''],
  ],
  voicedColumns: ['g', 'z', 'd', 'b', 'p'],
  voiced: [
    ['が', 'ざ', 'だ', 'ば', 'ぱ'], ['ぎ', 'じ', 'ぢ', 'び', 'ぴ'], ['ぐ', 'ず', 'づ', 'ぶ', 'ぷ'],
    ['げ', 'ぜ', 'で', 'べ', 'ぺ'], ['ご', 'ぞ', 'ど', 'ぼ', 'ぽ'],
  ],
  voicedExtra: ['ゔ'],
  small: ['ゃ', 'ゅ', 'ょ', 'っ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゎ', 'ー'],
});

const KATAKANA_KEYBOARD = deepFreeze(mapLeaves(KEYBOARD, toKatakana));

/**
 * The keyboard layout for a script: {@link KEYBOARD} itself for 'hiragana', or its deep-frozen
 * katakana twin (each key through toKatakana: ゔ → ヴ, ゎ → ヮ, ー unchanged; column headers kept).
 * @param {'hiragana'|'katakana'} script
 * @returns {typeof KEYBOARD}
 * @throws {RangeError} for any other script
 */
export function keyboardLayout(script) {
  if (script === 'hiragana') return KEYBOARD;
  if (script === 'katakana') return KATAKANA_KEYBOARD;
  throw new RangeError(`keyboardLayout: unknown script "${script}"`);
}

/** Full-size ↔ small pairs for the 小 modifier, both scripts. */
const SMALL_TO_LARGE = new Map(
  ['ぁあ', 'ぃい', 'ぅう', 'ぇえ', 'ぉお', 'ゃや', 'ゅゆ', 'ょよ', 'っつ', 'ゎわ']
    .flatMap((pair) => [pair, toKatakana(pair)])
    .map((pair) => Array.from(pair)),
);
const LARGE_TO_SMALL = new Map([...SMALL_TO_LARGE].map(([small, large]) => [large, small]));

/** Composes base + combining mark into one kana with a hiragana/katakana twin, else null. */
function composeMark(base, mark) {
  const composed = (base + mark).normalize('NFC');
  const cp = singleCodePoint(composed);
  const ok = (cp >= HIRAGANA_FIRST && cp <= HIRAGANA_LAST) || (cp >= KATAKANA_FIRST && cp <= KATAKANA_CONVERTIBLE_LAST);
  return ok ? composed : null;
}

/**
 * Applies an on-screen modifier key to a kana, toggling in both scripts:
 * `dakuten` か↔が, う↔ゔ, ウ↔ヴ, ぱ→ば; `handakuten` は↔ぱ, ば→ぱ; `small` や↔ゃ, つ↔っ, あ↔ぁ, わ↔ゎ.
 * @param {string} ch a single kana
 * @param {'dakuten'|'handakuten'|'small'} mod
 * @returns {string|null} the modified kana, or null when the modifier does not apply
 * @throws {RangeError} for an unknown modifier
 */
export function applyModifier(ch, mod) {
  if (mod !== 'dakuten' && mod !== 'handakuten' && mod !== 'small') {
    throw new RangeError(`applyModifier: unknown modifier "${mod}"`);
  }
  if (!isKana(ch) || ch === LONG_MARK) return null;
  if (mod === 'small') return SMALL_TO_LARGE.get(ch) ?? LARGE_TO_SMALL.get(ch) ?? null;
  const [base, existing] = Array.from(ch.normalize('NFD'));
  const mark = mod === 'dakuten' ? COMBINING_DAKUTEN : COMBINING_HANDAKUTEN;
  if (existing === mark) return base;
  return composeMark(base, mark);
}

/**
 * Romaji label for an on-screen key: し → `shi`, ゃ → `ya`, っ → `tsu`, ー → `-`.
 * Small kana are labelled with their full-size reading. Returns '' for anything that is not a
 * single kana (e.g. an empty cell).
 * @param {string} ch
 * @returns {string}
 */
export function kanaKeyLabel(ch) {
  if (ch === LONG_MARK) return '-';
  if (!isKana(ch)) return '';
  return toRomaji(SMALL_TO_LARGE.get(ch) ?? ch);
}
