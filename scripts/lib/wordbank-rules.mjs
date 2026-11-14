/**
 * Pure selection and transformation rules turning JMdict (jmdict-simplified) entries into
 * HiraKata word-bank records (docs/SPEC.md section 4). No I/O happens here.
 */
import { analyzeKana, detectScript, toRomaji } from '../../shared/kana.js';
import { languageName, posLabel } from './jmdict-labels.mjs';

/** Kana tags that disqualify a reading as the primary answer (old, search-only, irregular, rare). */
export const EXCLUDED_KANA_TAGS = Object.freeze(['ok', 'sk', 'ik', 'rk']);
/** Kanji tags whose forms are never displayed. */
export const EXCLUDED_KANJI_TAGS = Object.freeze(['sK', 'iK', 'oK', 'rK']);
/** Sense misc tags that drop the sense entirely. */
export const DROPPED_SENSE_MISC = Object.freeze(['arch', 'obs', 'vulg', 'X', 'sens', 'derog', 'rare', 'dated']);
/** Characters that must never appear in an answer (obsolete, ambiguous or non-spellable kana). */
export const EXCLUDED_CHARS = Object.freeze(Array.from('ゐゑヰヱゎヮヵヶゕゖぢづヂヅをヲゝゞヽヾ・＝'));
/** Words whose spelling uses particle は read "wa", which the romaji cannot express. */
export const BLOCKLIST = Object.freeze(['こんにちは', 'こんばんは']);
/** POS codes of function words and affixes; an entry whose first sense has only these is skipped. */
export const FUNCTION_POS = Object.freeze([
  'prt', 'aux', 'aux-v', 'aux-adj', 'conj', 'cop', 'suf', 'pref', 'n-suf', 'n-pref', 'ctr', 'unc',
]);

/**
 * Quality filters beyond the SPEC rules (documented in data/ATTRIBUTION.md): an entry whose
 * main sense is adult content is skipped; elsewhere, senses whose glosses match ADULT_GLOSS
 * and senses that only describe a trademark are dropped.
 */
export const ADULT_GLOSS = new RegExp(
  '(?<![a-z])(?:penis|vagina[a-z]*|genitals|private parts|boob(?:s|ies)?|tits|porn(?:o|ography|ographic)?|obscene' +
    '|prostitut[a-z]*|brothel|semen|vibrator|sex (?:toy|position|chat|service)|[(]?having[)]? sex' +
    '|sexual (?:intercourse|desire|arousal|attraction|lubricant|play)|erection [(]of the penis[)]|rape' +
    // Added for the full dictionary (SPEC §15.1 quality review): explicit terms found in non-common entries.
    '|masturbat[a-z]*|ejaculat[a-z]*|pre-cum|jack-off|fisting|fellatio|cunnilingus|orgasm[a-z]*|clitor[a-z]*' +
    '|testicles|breasts|buggery|fuck[a-z]*|sex (?:act|aid)|(?:for|having|has|have) sex)(?![a-z])',
  'i',
);
export const DROPPED_SENSE_FIELDS = Object.freeze(['tradem']);
/**
 * Full-dictionary quality filters (SPEC §15.1), applied to NON-common entries only so the common
 * core of v1 stays intact. Senses that only name something (JMdict misc name types: a person,
 * company, product, work, fictional character, place, ...) are dropped, as are Ryukyuan-language
 * senses (dialect `rkb`), which are not standard Japanese.
 */
export const PROPER_NAME_MISC = Object.freeze([
  'char', 'company', 'creat', 'dei', 'doc', 'ev', 'fict', 'given', 'group', 'leg', 'myth', 'obj',
  'organization', 'oth', 'person', 'place', 'product', 'serv', 'ship', 'station', 'surname', 'unclass', 'work',
]);
export const UNCOMMON_DROPPED_DIALECTS = Object.freeze(['rkb']);
export const POS_CATEGORIES = Object.freeze(['noun', 'verb', 'adjective', 'adverb', 'expression', 'other']);
export const MAX_LENGTH = 9;
export const MAX_SENSES = 3;
export const MAX_GLOSSES = 4;
export const MAX_KANJI = 3;
export const MAX_ORIGINS = 2;

const EXCLUDED_CHAR_SET = new Set(EXCLUDED_CHARS);
const HAS_KANJI = /[\p{Script=Han}〆]/u;
// Characters outside the Basic Multilingual Plane (rare CJK extension kanji) lack font coverage.
const NON_BMP = /[\u{10000}-\u{10FFFF}]/u;
const HIRAGANA_ONLY_BANNED = new Set(Array.from('ーゔぁぃぅぇぉ'));
const BAD_START = new Set(Array.from('ーっッんンぁぃぅぇぉゃゅょゎァィゥェォャュョヮ'));
// 'adj-no' (nouns taking の) and 'adj-f' (prenominal nouns) behave as nouns for learners.
const NOUN_CODES = new Set(['n', 'n-adv', 'n-t', 'pn', 'num', 'vs', 'adj-no', 'adj-f']);
const VERB_CODE = /^(?:v1|v1-s|v2.+|v4.+|v5.+|vk|vn|vr|vz|vs-i|vs-s|vs-c)$/;

/**
 * Choose the primary kana element (SPEC §15.1): the first reading without disqualifying tags,
 * preferring a common one when the entry has several.
 * @param {object} entry jmdict-simplified word
 * @returns {object|null} the kana element, or null when the entry has none
 */
export function pickPrimaryKana(entry) {
  const usable = entry.kana.filter((k) => !k.tags.some((t) => EXCLUDED_KANA_TAGS.includes(t)));
  return usable.find((k) => k.common === true) ?? usable[0] ?? null;
}

/**
 * True when the entry has any common kana or kanji element (JMdict news1/ichi1/spec1/gai1 ...).
 * @param {object} entry jmdict-simplified word
 * @returns {boolean}
 */
export function isCommonEntry(entry) {
  return entry.kana.some((k) => k.common === true) || entry.kanji.some((k) => k.common === true);
}

/**
 * Check a candidate answer against the spelling rules of SPEC §4 rule 5.
 * @param {string} kana
 * @param {'hiragana'|'katakana'} script
 * @param {number|null} jlpt
 * @returns {string|null} a short exclusion reason, or null when the kana is acceptable
 */
export function kanaExclusionReason(kana, script, jlpt) {
  const chars = Array.from(kana);
  if (BLOCKLIST.includes(kana)) return 'blocklist';
  if (chars.some((c) => EXCLUDED_CHAR_SET.has(c))) return 'excluded character';
  if (script === 'hiragana' && chars.some((c) => HIRAGANA_ONLY_BANNED.has(c))) return 'non-standard hiragana';
  if (BAD_START.has(chars[0])) return 'bad first character';
  const last = chars[chars.length - 1];
  if (last === 'っ' || last === 'ッ') return 'ends with sokuon';
  if (chars.length > MAX_LENGTH) return 'too long';
  if (chars.length < 2 && jlpt !== 5 && jlpt !== 4) return 'too short';
  return null;
}

/**
 * Keep the senses that apply to `kana`, are not archaic/offensive/rare, are not adult
 * content and are not trademark-only, and that carry at least one English gloss. In non-common
 * entries, proper-name and Ryukyuan senses are dropped as well (see PROPER_NAME_MISC).
 * @param {object} entry
 * @param {string} kana
 * @returns {object[]} raw jmdict-simplified senses, in dictionary order
 */
export function selectSenses(entry, kana) {
  const common = isCommonEntry(entry);
  return entry.sense.filter(
    (s) =>
      appliesToKana(s, kana) &&
      !s.misc.some((m) => DROPPED_SENSE_MISC.includes(m)) &&
      !s.field.some((f) => DROPPED_SENSE_FIELDS.includes(f)) &&
      s.gloss.some((g) => g.lang === 'eng' && g.text.trim()) &&
      !isAdultSense(s) &&
      (common || !isUncommonOnlySense(s)),
  );
}

/**
 * True when a sense is only kept for common entries: a proper name or a Ryukyuan-language sense.
 * @param {object} sense
 * @returns {boolean}
 */
export function isUncommonOnlySense(sense) {
  return (
    sense.misc.some((m) => PROPER_NAME_MISC.includes(m)) ||
    (sense.dialect ?? []).some((d) => UNCOMMON_DROPPED_DIALECTS.includes(d))
  );
}

/**
 * True when a sense applies to the given reading.
 * @param {object} sense
 * @param {string} kana
 * @returns {boolean}
 */
export function appliesToKana(sense, kana) {
  return sense.appliesToKana.includes('*') || sense.appliesToKana.includes(kana);
}

/**
 * True when any gloss of the sense is adult content.
 * @param {object} sense
 * @returns {boolean}
 */
export function isAdultSense(sense) {
  return sense.gloss.some((g) => ADULT_GLOSS.test(g.text));
}

/**
 * Map the POS codes of a word's first kept sense to a coarse category.
 * Pure noun codes give 'noun'; otherwise verb > adjective > adverb > expression; a remaining
 * mix that still contains a noun code (e.g. n + vs + vt, n + suf) is a noun as well.
 * @param {string[]} codes
 * @returns {'noun'|'verb'|'adjective'|'adverb'|'expression'|'other'}
 */
export function posCategory(codes) {
  if (codes.length > 0 && codes.every((c) => NOUN_CODES.has(c))) return 'noun';
  if (codes.some((c) => VERB_CODE.test(c))) return 'verb';
  if (codes.some((c) => c.startsWith('adj-') && !NOUN_CODES.has(c))) return 'adjective';
  if (codes.some((c) => c === 'adv' || c === 'adv-to')) return 'adverb';
  if (codes.some((c) => c === 'exp' || c === 'int')) return 'expression';
  if (codes.some((c) => NOUN_CODES.has(c))) return 'noun';
  return 'other';
}

/**
 * True when every POS code marks a function word or affix (particle, suffix, counter, ...).
 * @param {string[]} codes
 * @returns {boolean}
 */
export function isFunctionWord(codes) {
  return codes.length > 0 && codes.every((c) => FUNCTION_POS.includes(c));
}

/**
 * Kanji forms the primary reading belongs to, minus search-only/irregular/outdated/rare
 * forms, forms without any kanji (e.g. Ｔシャツ, ＯＫ, １つ) and forms with characters outside the
 * BMP (SPEC §15.1); common forms first, at most MAX_KANJI.
 * @param {object} entry
 * @param {object} kanaEl the primary kana element
 * @returns {string[]}
 */
export function pickKanji(entry, kanaEl) {
  const applies = kanaEl.appliesToKanji ?? ['*'];
  const forms = entry.kanji.filter(
    (k) =>
      (applies.includes('*') || applies.includes(k.text)) &&
      !k.tags.some((t) => EXCLUDED_KANJI_TAGS.includes(t)) &&
      HAS_KANJI.test(k.text) &&
      !NON_BMP.test(k.text),
  );
  const ordered = [...forms.filter((k) => k.common), ...forms.filter((k) => !k.common)];
  return ordered.slice(0, MAX_KANJI).map((k) => k.text);
}

/**
 * Loanword origin of a sense.
 * @param {object} sense
 * @returns {{ lang: string, text: string|null, wasei: boolean }[]}
 */
export function buildOrigin(sense) {
  return (sense.languageSource ?? []).slice(0, MAX_ORIGINS).map((ls) => ({
    lang: languageName(ls.lang),
    text: ls.text ?? null,
    wasei: ls.wasei === true,
  }));
}

/**
 * Convert one kept sense into the word-bank shape (friendly POS labels, ≤ MAX_GLOSSES English glosses).
 * @param {object} sense
 * @returns {{ pos: string[], gloss: string[], info: string[] }}
 */
export function buildSense(sense) {
  const pos = [...new Set(sense.partOfSpeech.map(posLabel))];
  const gloss = sense.gloss
    .filter((g) => g.lang === 'eng')
    .map((g) => g.text.trim())
    .filter(Boolean)
    .slice(0, MAX_GLOSSES);
  return { pos, gloss, info: [...sense.info] };
}

/**
 * Ids of words to drop because their romaji is shared by words of both scripts (e.g. "mizu": みず
 * water and ミズ Ms, "hotto": ほっと and ホット). A question only shows the romaji, so for these the
 * learner cannot tell which script is "appropriate". Computed over the whole bank (SPEC §15.1):
 * when exactly one script has `common` words for that romaji, only the other script's (non-common)
 * words are dropped, so an obscure homophone never removes a core word (ナイフ stays, the rare
 * hiragana ないふ goes); otherwise every word of the romaji is dropped. Either way, no romaji is
 * left shared by both scripts.
 * @param {{ id: string, script: string, romaji: string, common?: boolean }[]} words
 * @returns {Set<string>}
 */
export function scriptAmbiguousIds(words) {
  /** @type {Map<string, { scripts: Set<string>, commonScripts: Set<string> }>} */
  const byRomaji = new Map();
  for (const w of words) {
    if (!byRomaji.has(w.romaji)) byRomaji.set(w.romaji, { scripts: new Set(), commonScripts: new Set() });
    const group = byRomaji.get(w.romaji);
    group.scripts.add(w.script);
    if (w.common === true) group.commonScripts.add(w.script);
  }
  return new Set(
    words
      .filter((w) => {
        const { scripts, commonScripts } = byRomaji.get(w.romaji);
        if (scripts.size < 2) return false;
        return commonScripts.size !== 1 || !commonScripts.has(w.script);
      })
      .map((w) => w.id),
  );
}

/**
 * Apply every rule of SPEC §4 to one dictionary entry.
 * @param {object} entry jmdict-simplified word
 * @param {Map<string, number>} jlptById JMdict id → easiest JLPT level (5..1)
 * @returns {{ word: object } | { reason: string }} the word-bank record, or why it was skipped
 */
export function buildWord(entry, jlptById) {
  const kanaEl = pickPrimaryKana(entry);
  if (!kanaEl) return { reason: 'no usable kana reading' };
  const kana = kanaEl.text;
  const script = detectScript(kana);
  if (script !== 'hiragana' && script !== 'katakana') return { reason: `script ${script}` };
  const jlpt = jlptById.get(entry.id) ?? null;
  const excluded = kanaExclusionReason(kana, script, jlpt);
  if (excluded) return { reason: excluded };

  const main = entry.sense.find((s) => appliesToKana(s, kana));
  if (main && isAdultSense(main)) return { reason: 'adult content' };
  const kept = selectSenses(entry, kana);
  if (kept.length === 0) {
    const named = entry.sense.some((s) => appliesToKana(s, kana) && isUncommonOnlySense(s));
    return { reason: named ? 'proper name or Ryukyuan only' : 'no usable sense' };
  }
  const [first] = kept;
  if (isFunctionWord(first.partOfSpeech)) return { reason: 'function word or affix' };
  const senses = kept.slice(0, MAX_SENSES).map(buildSense);

  const { level, length, features } = analyzeKana(kana);
  return {
    word: {
      id: entry.id,
      kana,
      script,
      romaji: toRomaji(kana),
      kanji: pickKanji(entry, kanaEl),
      common: isCommonEntry(entry),
      usuallyKana: first.misc.includes('uk'),
      senses,
      posCategory: posCategory(first.partOfSpeech),
      origin: buildOrigin(first),
      jlpt,
      level,
      len: length,
      features,
    },
  };
}
