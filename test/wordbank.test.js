import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { analyzeKana, detectScript, toRomaji } from '../shared/kana.js';
import {
  BLOCKLIST,
  EXCLUDED_CHARS,
  MAX_GLOSSES,
  MAX_KANJI,
  MAX_LENGTH,
  MAX_ORIGINS,
  MAX_SENSES,
  POS_CATEGORIES,
} from '../scripts/lib/wordbank-rules.mjs';

const WORDS_URL = new URL('../data/words.json.gz', import.meta.url);
const LEGACY_URL = new URL('../data/words.json', import.meta.url);
const BAD_START = new Set(Array.from('ーっッんンぁぃぅぇぉゃゅょゎァィゥェォャュョヮ'));

/** @type {{ meta: any, words: any[] }} */
let bank;
/** @type {string[]} lines of the decompressed file */
let lines;
before(() => {
  const text = gunzipSync(readFileSync(WORDS_URL)).toString('utf8');
  lines = text.split('\n');
  bank = JSON.parse(text);
});

/** Assert `check(word)` for every word, reporting the first few offenders. */
function assertEvery(label, check) {
  const bad = bank.words.filter((w) => !check(w));
  assert.equal(bad.length, 0, `${label}: ${bad.slice(0, 5).map((w) => `${w.id} ${w.kana}`).join(', ')}`);
}

describe('words.json.gz structure', () => {
  it('has meta and a words array covering the whole dictionary', () => {
    assert.equal(bank.meta.version, 1);
    assert.ok(Array.isArray(bank.words));
    assert.ok(bank.words.length > 100_000, `only ${bank.words.length} words`);
    assert.ok(!Number.isNaN(Date.parse(bank.meta.generatedAt)));
  });

  it('is gzip with one word per line, within the 25 MB budget, and replaces words.json', () => {
    assert.ok(readFileSync(WORDS_URL).length <= 25 * 1024 * 1024);
    const wordLines = lines.filter((l) => l.startsWith('    {'));
    assert.equal(wordLines.length, bank.words.length);
    assert.equal(existsSync(LEGACY_URL), false, 'data/words.json should be deleted (SPEC §15.1)');
  });

  it('describes its sources and licences', () => {
    const { source, jlptSource } = bank.meta;
    assert.equal(source.license, 'CC BY-SA 4.0');
    assert.match(source.version, /^\d+\.\d+\.\d+\+\d{14}$/);
    assert.match(source.dictDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(source.attribution, /Electronic Dictionary Research and Development Group/);
    assert.ok(source.url.startsWith('https://'));
    if (jlptSource !== null) {
      assert.equal(jlptSource.license, 'CC BY');
      assert.match(jlptSource.name, /Jonathan Waller/);
    }
  });

  it('meta.counts match the words', () => {
    const { counts } = bank.meta;
    const tally = (key, value) => bank.words.filter((w) => w[key] === value).length;
    assert.equal(counts.total, bank.words.length);
    assert.equal(counts.common, bank.words.filter((w) => w.common === true).length);
    assert.equal(counts.hiragana, tally('script', 'hiragana'));
    assert.equal(counts.katakana, tally('script', 'katakana'));
    assert.equal(counts.hiragana + counts.katakana, counts.total);
    for (const level of [1, 2, 3]) assert.equal(counts.byLevel[level], tally('level', level), `level ${level}`);
    assert.deepEqual(Object.keys(counts.byPos).sort(), [...POS_CATEGORIES].sort());
    for (const pos of POS_CATEGORIES) assert.equal(counts.byPos[pos], tally('posCategory', pos), pos);
    for (const n of [5, 4, 3, 2, 1]) assert.equal(counts.byJlpt[n], tally('jlpt', n), `N${n}`);
  });
});

describe('every word', () => {
  it('has a unique numeric string id', () => {
    const ids = new Set(bank.words.map((w) => w.id));
    assert.equal(ids.size, bank.words.length);
    assertEvery('id', (w) => typeof w.id === 'string' && /^\d+$/.test(w.id));
  });

  it('has a script matching detectScript(kana)', () => {
    assertEvery('script', (w) => ['hiragana', 'katakana'].includes(w.script) && detectScript(w.kana) === w.script);
  });

  it('has romaji === toRomaji(kana)', () => {
    assertEvery('romaji', (w) => w.romaji === toRomaji(w.kana) && w.romaji === w.romaji.toLowerCase());
  });

  it('has level, len and features from analyzeKana', () => {
    assertEvery('analysis', (w) => {
      const a = analyzeKana(w.kana);
      return a.level === w.level && a.length === w.len && JSON.stringify(a.features) === JSON.stringify(w.features);
    });
  });

  it('contains no excluded characters or patterns', () => {
    const excluded = new Set(EXCLUDED_CHARS);
    assertEvery('excluded chars', (w) => !Array.from(w.kana).some((c) => excluded.has(c)));
    assertEvery('hiragana extras', (w) => w.script === 'katakana' || !/[ーゔぁぃぅぇぉ]/u.test(w.kana));
    assertEvery('bad start', (w) => !BAD_START.has(Array.from(w.kana)[0]));
    assertEvery('sokuon end', (w) => !/[っッ]$/u.test(w.kana));
    assertEvery('length', (w) => w.len <= MAX_LENGTH && (w.len >= 2 || w.jlpt === 5 || w.jlpt === 4));
    assertEvery('blocklist', (w) => !BLOCKLIST.includes(w.kana));
  });

  it('has 1-3 senses with 1-4 non-empty glosses each', () => {
    assertEvery('senses', (w) =>
      Array.isArray(w.senses) &&
      w.senses.length >= 1 &&
      w.senses.length <= MAX_SENSES &&
      w.senses.every(
        (s) =>
          s.gloss.length >= 1 &&
          s.gloss.length <= MAX_GLOSSES &&
          s.gloss.every((g) => typeof g === 'string' && g.trim() === g && g !== '') &&
          s.pos.every((p) => typeof p === 'string' && p !== '') &&
          Array.isArray(s.info),
      ),
    );
  });

  it('has valid posCategory, jlpt, kanji, usuallyKana and origin', () => {
    assertEvery('posCategory', (w) => POS_CATEGORIES.includes(w.posCategory));
    assertEvery('jlpt', (w) => w.jlpt === null || [1, 2, 3, 4, 5].includes(w.jlpt));
    assertEvery('kanji', (w) => Array.isArray(w.kanji) && w.kanji.length <= MAX_KANJI && w.kanji.every((k) => /[\p{Script=Han}〆]/u.test(k)));
    assertEvery('usuallyKana', (w) => typeof w.usuallyKana === 'boolean');
    assertEvery('common', (w) => typeof w.common === 'boolean');
    assertEvery('kanji in the BMP', (w) => w.kanji.every((k) => !/[\u{10000}-\u{10FFFF}]/u.test(k)));
    assertEvery('origin', (w) =>
      Array.isArray(w.origin) &&
      w.origin.length <= MAX_ORIGINS &&
      w.origin.every((o) => typeof o.lang === 'string' && (o.text === null || typeof o.text === 'string') && typeof o.wasei === 'boolean'),
    );
  });

  it('has friendly POS labels and language names (no raw JMdict codes)', async () => {
    const { POS_LABELS } = await import('../scripts/lib/jmdict-labels.mjs');
    const labels = new Set(Object.values(POS_LABELS));
    assertEvery('pos label', (w) => w.senses.every((s) => s.pos.every((p) => labels.has(p))));
    assertEvery('origin language', (w) => w.origin.every((o) => !/^[a-z]{3}$/.test(o.lang)));
  });

  it('carries no JLPT levels when the JLPT source is missing', () => {
    if (bank.meta.jlptSource === null) assertEvery('jlpt null', (w) => w.jlpt === null);
  });
});
describe('spot checks', () => {
  const find = (kana) => bank.words.filter((w) => w.kana === kana);

  it('ねこ means cat', () => {
    const neko = find('ねこ');
    assert.ok(neko.some((w) => w.script === 'hiragana' && w.romaji === 'neko' && w.senses.some((s) => s.gloss.some((g) => /cat/i.test(g)))));
  });

  it('コーヒー is katakana romanized kōhī with a Dutch/English origin', () => {
    const [coffee] = find('コーヒー');
    assert.ok(coffee);
    assert.equal(coffee.script, 'katakana');
    assert.equal(coffee.romaji, 'kōhī');
    assert.ok(coffee.features.includes('long'));
    assert.ok(coffee.origin.some((o) => o.lang === 'Dutch' || o.lang === 'English'));
  });

  it('keeps everyday words in both scripts and drops blocklisted greetings', () => {
    for (const kana of ['がっこう', 'せんせい', 'たべる', 'おおきい', 'テレビ', 'パン']) assert.ok(find(kana).length > 0, kana);
    assert.equal(find('こんにちは').length, 0);
  });

  it('never shows the same romaji for a hiragana word and a katakana word', () => {
    // Otherwise a learner cannot know the "appropriate" script (e.g. mizu: みず water vs ミズ Ms).
    const scripts = new Map();
    for (const w of bank.words) scripts.set(w.romaji, (scripts.get(w.romaji) ?? new Set()).add(w.script));
    const ambiguous = [...scripts].filter(([, s]) => s.size > 1).map(([romaji]) => romaji);
    assert.deepEqual(ambiguous.slice(0, 10), []);
    for (const kana of ['ミズ', 'みず', 'ホット', 'ほっと']) assert.equal(find(kana).length, 0, kana);
  });

  it('never shows the same romaji for two different kana of one script', () => {
    const kanaOf = new Map();
    const clashes = bank.words.filter((w) => {
      const key = `${w.script}|${w.romaji}`;
      if (!kanaOf.has(key)) kanaOf.set(key, w.kana);
      return kanaOf.get(key) !== w.kana;
    });
    assert.deepEqual(clashes.slice(0, 10).map((w) => `${w.kana} ${w.romaji}`), []);
  });

  it('has tens of thousands of katakana words', () => {
    assert.ok(bank.meta.counts.katakana >= 20_000);
  });

  it('flags common words, which form the v1-sized core of the bank', () => {
    const common = bank.words.filter((w) => w.common);
    assert.equal(common.length, bank.meta.counts.common);
    assert.ok(common.length > 20_000 && common.length < bank.words.length / 4, `common ${common.length}`);
    for (const kana of ['ねこ', 'コーヒー', 'タオル', 'ナイフ', 'がっこう']) {
      assert.ok(find(kana).some((w) => w.common), `${kana} common`);
    }
    // Nearly all JLPT N5 words are common (a few lists point at secondary entries such as これ 2216120),
    // and core words are not lost to obscure homophones of the other script.
    const n5 = bank.words.filter((w) => w.jlpt === 5);
    assert.ok(n5.filter((w) => w.common).length >= n5.length * 0.95);
    for (const kana of ['どう', 'ちゃんと', 'タオル']) assert.ok(find(kana).length > 0, kana);
  });

  it('includes non-common vocabulary but no proper-name-only entries', () => {
    const uncommon = bank.words.filter((w) => !w.common);
    assert.ok(uncommon.length > 100_000, `non-common ${uncommon.length}`);
    for (const kana of ['すいちょくのうほう', 'トランスフォビア']) assert.ok(find(kana).some((w) => !w.common), kana);
    for (const kana of ['フーディン', 'ヨーダ', 'ビートルズ']) assert.equal(find(kana).length, 0, kana);
  });

  it('tags JLPT N5 words when the JLPT source is available', (t) => {
    if (bank.meta.jlptSource === null) return t.skip('JLPT source unavailable at build time');
    assert.ok(bank.meta.counts.byJlpt[5] > 300);
    for (const kana of ['たべる', 'ねこ', 'がっこう']) assert.ok(find(kana).some((w) => w.jlpt === 5), kana);
  });
});

describe('build helpers', () => {
  /** A minimal jmdict-simplified entry for rule tests. */
  const entry = (kana, senses, extra = {}) => ({
    id: '9000001',
    kanji: [],
    kana: [{ common: true, text: kana, tags: [], appliesToKanji: ['*'] }],
    sense: senses.map((s) => ({
      partOfSpeech: ['n'], appliesToKanji: ['*'], appliesToKana: ['*'], field: [], misc: [], info: [],
      languageSource: [], gloss: [{ lang: 'eng', text: 'thing' }], ...s,
    })),
    ...extra,
  });

  it('parseCsv handles quotes, embedded commas/newlines, CRLF and a BOM', async () => {
    const { parseCsv, parseCsvRecords } = await import('../scripts/lib/archive.mjs');
    assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x, y","he said ""hi"""\n"multi\nline",\n'), [
      ['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', ''],
    ]);
    assert.deepEqual(parseCsvRecords('jmdict_seq,kana\n1,ねこ\n'), [{ jmdict_seq: '1', kana: 'ねこ' }]);
    assert.throws(() => parseCsvRecords('kana\nx\n', ['jmdict_seq']), /missing column/);
    assert.throws(() => parseCsv('"open'), /unterminated/);
  });

  it('readTarGz extracts regular files from a gzip tar, including pax long names', async () => {
    const { gzipSync } = await import('node:zlib');
    const { readTarGz } = await import('../scripts/lib/archive.mjs');
    const header = (name, size, type) => {
      const h = Buffer.alloc(512);
      h.write(name, 0, 'utf8');
      h.write(size.toString(8).padStart(11, '0'), 124, 'ascii');
      h.write(type, 156, 'ascii');
      h.write('ustar', 257, 'ascii');
      return h;
    };
    const pad = (buf) => Buffer.concat([buf, Buffer.alloc((512 - (buf.length % 512)) % 512)]);
    const body = Buffer.from('{"ok":true}');
    const longName = `${'d'.repeat(120)}/words.json`;
    const pax = Buffer.from(`${longName.length + 9} path=${longName}\n`);
    const tar = Buffer.concat([
      header('PaxHeader', pax.length, 'x'), pad(pax),
      header('short.json', body.length, '0'), pad(body),
      header('dir/', 0, '5'),
      header('b.txt', 2, '0'), pad(Buffer.from('hi')),
      Buffer.alloc(1024),
    ]);
    const files = readTarGz(gzipSync(tar));
    assert.deepEqual(files.map((f) => f.name), [longName, 'b.txt']);
    assert.equal(files[0].data.toString(), '{"ok":true}');
  });

  it('posCategory follows the SPEC mapping', async () => {
    const { posCategory } = await import('../scripts/lib/wordbank-rules.mjs');
    assert.equal(posCategory(['n']), 'noun');
    assert.equal(posCategory(['n', 'vs', 'vt']), 'noun');
    assert.equal(posCategory(['n', 'adj-no']), 'noun');
    assert.equal(posCategory(['v5r', 'vi']), 'verb');
    assert.equal(posCategory(['vs-i']), 'verb');
    assert.equal(posCategory(['adj-na', 'n']), 'adjective');
    assert.equal(posCategory(['adj-i']), 'adjective');
    assert.equal(posCategory(['adv', 'n']), 'adverb');
    assert.equal(posCategory(['int']), 'expression');
    assert.equal(posCategory(['exp', 'n']), 'expression');
    assert.equal(posCategory(['ctr']), 'other');
  });

  it('kanaExclusionReason applies the spelling rules', async () => {
    const { kanaExclusionReason: why } = await import('../scripts/lib/wordbank-rules.mjs');
    assert.equal(why('ねこ', 'hiragana', null), null);
    assert.equal(why('コーヒー', 'katakana', null), null);
    assert.equal(why('ちぢむ', 'hiragana', null), 'excluded character');
    assert.equal(why('らーめん', 'hiragana', null), 'non-standard hiragana');
    assert.equal(why('ンゴ', 'katakana', null), 'bad first character');
    assert.equal(why('あっ', 'hiragana', null), 'ends with sokuon');
    assert.equal(why('あいうえおかきくけこ', 'hiragana', null), 'too long');
    assert.equal(why('め', 'hiragana', null), 'too short');
    assert.equal(why('め', 'hiragana', 5), null);
    assert.equal(why('こんばんは', 'hiragana', 5), 'blocklist');
  });

  it('scriptAmbiguousIds flags every word of a romaji shared by both scripts', async () => {
    const { scriptAmbiguousIds } = await import('../scripts/lib/wordbank-rules.mjs');
    const w = (id, kana, script, romaji) => ({ id, kana, script, romaji });
    const ids = scriptAmbiguousIds([
      w('1', 'みず', 'hiragana', 'mizu'), w('2', 'ミズ', 'katakana', 'mizu'), w('3', 'みず', 'hiragana', 'mizu'),
      w('4', 'はし', 'hiragana', 'hashi'), w('5', 'はし', 'hiragana', 'hashi'), w('6', 'パン', 'katakana', 'pan'),
    ]);
    assert.deepEqual([...ids].sort(), ['1', '2', '3']);
  });

  it('scriptAmbiguousIds keeps the common side when only one script has common words', async () => {
    const { scriptAmbiguousIds } = await import('../scripts/lib/wordbank-rules.mjs');
    const w = (id, script, romaji, common) => ({ id, kana: '', script, romaji, common });
    const ids = scriptAmbiguousIds([
      w('1', 'katakana', 'naifu', true), w('2', 'hiragana', 'naifu', false), w('3', 'hiragana', 'naifu', false),
      w('4', 'hiragana', 'mizu', true), w('5', 'katakana', 'mizu', true), w('6', 'katakana', 'mizu', false),
      w('7', 'hiragana', 'rare', false), w('8', 'katakana', 'rare', false),
    ]);
    assert.deepEqual([...ids].sort(), ['2', '3', '4', '5', '6', '7', '8']);
  });

  it('pickPrimaryKana prefers a common reading and falls back to the first usable one', async () => {
    const { pickPrimaryKana, isCommonEntry } = await import('../scripts/lib/wordbank-rules.mjs');
    const k = (text, common, tags = []) => ({ text, common, tags, appliesToKanji: ['*'] });
    assert.equal(pickPrimaryKana({ kana: [k('あ', false), k('い', true), k('う', true)] }).text, 'い');
    assert.equal(pickPrimaryKana({ kana: [k('あ', true, ['ok']), k('い', false), k('う', false)] }).text, 'い');
    assert.equal(pickPrimaryKana({ kana: [k('あ', false, ['rk']), k('い', true, ['sk'])] }), null);
    assert.equal(isCommonEntry({ kana: [k('あ', false)], kanji: [{ text: '亜', common: true, tags: [] }] }), true);
    assert.equal(isCommonEntry({ kana: [k('あ', false)], kanji: [] }), false);
  });

  it('buildWord applies the full-dictionary rules (common flag, non-BMP kanji, proper names)', async () => {
    const { buildWord } = await import('../scripts/lib/wordbank-rules.mjs');
    const uncommon = (kana, senses, extra) => {
      const e = entry(kana, senses, extra);
      e.kana[0].common = false;
      return e;
    };
    const kanji = [{ common: false, text: '𠮟る', tags: [] }, { common: false, text: '叱る', tags: [] }];
    const { word } = buildWord(uncommon('しかる', [{ partOfSpeech: ['v5r'] }], { kanji }), new Map());
    assert.equal(word.common, false);
    assert.deepEqual(word.kanji, ['叱る']);
    assert.equal(buildWord(entry('ねこ', [{}]), new Map()).word.common, true);
    const named = [{ misc: ['person'], gloss: [{ lang: 'eng', text: 'Yoda' }] }];
    assert.deepEqual(buildWord(uncommon('ヨーダ', named), new Map()), { reason: 'proper name or Ryukyuan only' });
    assert.equal(buildWord(entry('ショパン', named), new Map()).word.senses[0].gloss[0], 'Yoda');
    const ryukyu = uncommon('ちゅら', [{ dialect: ['rkb'] }, { gloss: [{ lang: 'eng', text: 'pretty' }] }]);
    assert.deepEqual(buildWord(ryukyu, new Map()).word.senses.map((s) => s.gloss[0]), ['pretty']);
    assert.deepEqual(buildWord(entry('しゃせい', [{ gloss: [{ lang: 'eng', text: 'ejaculation' }] }]), new Map()), { reason: 'adult content' });
  });

  it('buildWord shapes a record and applies the quality filters', async () => {
    const { buildWord } = await import('../scripts/lib/wordbank-rules.mjs');
    const kanji = [
      { common: false, text: '珈琲', tags: ['ateji'] },
      { common: true, text: '可否', tags: [] },
      { common: true, text: '咖啡', tags: ['sK'] },
      { common: true, text: 'ＣＯＦＦＥＥ', tags: [] },
    ];
    const coffee = entry('コーヒー', [
      { field: ['tradem'], gloss: [{ lang: 'eng', text: 'Coffee Co.' }] },
      { misc: ['uk'], languageSource: [{ lang: 'dut', full: true, wasei: false, text: 'koffie' }],
        gloss: ['coffee', 'a', 'b', 'c', 'd'].map((text) => ({ lang: 'eng', text })) },
      { misc: ['arch'] },
    ], { kanji });
    const { word } = buildWord(coffee, new Map([['9000001', 5]]));
    assert.equal(word.romaji, 'kōhī');
    assert.deepEqual(word.kanji, ['可否', '珈琲']);
    assert.equal(word.senses.length, 1);
    assert.deepEqual(word.senses[0].gloss, ['coffee', 'a', 'b', 'c']);
    assert.deepEqual(word.senses[0].pos, ['Noun']);
    assert.equal(word.usuallyKana, true);
    assert.deepEqual(word.origin, [{ lang: 'Dutch', text: 'koffie', wasei: false }]);
    assert.equal(word.jlpt, 5);
    assert.deepEqual(buildWord(entry('しまう', [{ partOfSpeech: ['aux-v'] }]), new Map()), { reason: 'function word or affix' });
    assert.deepEqual(buildWord(entry('エロ', [{ gloss: [{ lang: 'eng', text: 'pornography' }] }]), new Map()), { reason: 'adult content' });
    assert.deepEqual(buildWord(entry('むかし', [{ misc: ['obs'] }]), new Map()), { reason: 'no usable sense' });
  });
});
