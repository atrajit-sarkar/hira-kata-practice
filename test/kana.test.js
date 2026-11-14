import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isHiragana, isKatakana, isKana, isSmallKana, scriptOf, detectScript, toKatakana, toHiragana,
  normalizeAnswer, toRomaji, toImeRomaji, romajiToKana, ROMAJI_TO_KANA, kanaUnits, analyzeKana,
  KANA_FEATURES, commonPrefixLength, guideState, diffKana, compareAnswer, soundKey, charOutcomes,
  KEYBOARD, keyboardLayout, applyModifier, kanaKeyLabel, LONG_MARK,
} from '../shared/kana.js';

describe('character classification', () => {
  it('classifies single hiragana, katakana and ー by code point range', () => {
    assert.ok(isHiragana('ぁ') && isHiragana('ゖ') && isHiragana('ん'));
    assert.ok(!isHiragana('ゝ') && !isHiragana('ア') && !isHiragana('ー') && !isHiragana('a'));
    assert.ok(isKatakana('ァ') && isKatakana('ヺ') && isKatakana('ー') && isKatakana('ヴ'));
    assert.ok(!isKatakana('・') && !isKatakana('ヽ') && !isKatakana('あ') && !isKatakana('ｱ'));
    assert.ok(isKana('ね') && isKana('ネ') && isKana('ー') && !isKana('猫'));
  });

  it('rejects multi-character strings and non-strings', () => {
    for (const value of ['ねこ', '', null, undefined, 0x3042, ['あ']]) {
      assert.equal(isHiragana(value), false);
      assert.equal(isKatakana(value), false);
      assert.equal(isKana(value), false);
    }
  });

  it('identifies small kana and the script of a char', () => {
    for (const ch of 'ゃゅょぁぃぅぇぉゎっゕゖャュョァィゥェォヮッヵヶ') assert.ok(isSmallKana(ch), ch);
    for (const ch of 'やつあわアー') assert.ok(!isSmallKana(ch), ch);
    assert.equal(scriptOf('あ'), 'hiragana');
    assert.equal(scriptOf('ア'), 'katakana');
    assert.equal(scriptOf('ー'), 'katakana');
    assert.equal(scriptOf('x'), null);
  });

  it('detectScript handles empty, pure, mixed and other strings', () => {
    assert.equal(detectScript(''), 'empty');
    assert.equal(detectScript('ねこ'), 'hiragana');
    assert.equal(detectScript('コーヒー'), 'katakana');
    assert.equal(detectScript('ー'), 'katakana');
    assert.equal(detectScript('らーめん'), 'mixed');
    assert.equal(detectScript('ねコ'), 'mixed');
    assert.equal(detectScript('猫'), 'other');
    assert.equal(detectScript('ねこ '), 'other');
    assert.equal(detectScript('ねこ😺'), 'other');
  });
});

describe('script conversion', () => {
  it('toKatakana shifts ぁ\u2013ゖ only', () => {
    assert.equal(toKatakana('ひらがなゔゎゕゖー'), 'ヒラガナヴヮヵヶー');
    assert.equal(toKatakana('カタ abc 猫'), 'カタ abc 猫');
  });

  it('toHiragana shifts ァ\u2013ヶ only (ー and ヷ\u2013ヺ unchanged)', () => {
    assert.equal(toHiragana('カタカナヴヮヵヶ'), 'かたかなゔゎゕゖ');
    assert.equal(toHiragana('コーヒーヷヸヹヺ'), 'こーひーヷヸヹヺ');
  });

  it('round-trips every convertible char', () => {
    for (let cp = 0x3041; cp <= 0x3096; cp++) {
      const ch = String.fromCodePoint(cp);
      assert.equal(toHiragana(toKatakana(ch)), ch);
    }
  });
});

describe('normalizeAnswer', () => {
  it('applies NFKC: half-width katakana and full-width ASCII', () => {
    assert.equal(normalizeAnswer('ｺｰﾋｰ'), 'コーヒー');
    assert.equal(normalizeAnswer('ｶﾞｯｺｳ'), 'ガッコウ');
    assert.equal(normalizeAnswer('ﾊﾟｰﾃｨｰ'), 'パーティー');
    assert.equal(normalizeAnswer('ＡＢＣ'), 'ABC');
  });

  it('removes whitespace (incl. U+3000) and zero-width characters', () => {
    assert.equal(normalizeAnswer(' ね\tこ\n'), 'ねこ');
    assert.equal(normalizeAnswer('\u3000ねこ\u3000'), 'ねこ');
    assert.equal(normalizeAnswer('ね\u200Bこ\u200C\u200D\uFEFF\u00A0'), 'ねこ');
  });

  it('removes other invisible format characters (word joiner, soft hyphen, bidi marks)', () => {
    assert.equal(normalizeAnswer('ね\u2060こ\u00ad\u200e\u200f'), 'ねこ');
  });

  it('composes spacing and half-width (han)dakuten, even when separated by a space', () => {
    assert.equal(normalizeAnswer('か゛っこう'), 'がっこう');
    assert.equal(normalizeAnswer('は゜ん'), 'ぱん');
    assert.equal(normalizeAnswer('ｶ ﾞｯｺｳ'), 'ガッコウ');
    assert.equal(normalizeAnswer(`か${'゙'}`), 'が');
    assert.equal(compareAnswer('がっこう', 'か゛っこう').correct, true);
  });

  it('maps every dash variant to ー', () => {
    const dashes = ['-', '\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212', '\uFF0D', '\uFF70'];
    for (const dash of dashes) assert.equal(normalizeAnswer(`コ${dash}ヒ${dash}`), 'コーヒー', `U+${dash.codePointAt(0).toString(16)}`);
  });

  it('never converts between scripts and tolerates null', () => {
    assert.equal(normalizeAnswer('こーひー'), 'こーひー');
    assert.equal(normalizeAnswer('ねコ'), 'ねコ');
    assert.equal(normalizeAnswer(null), '');
    assert.equal(normalizeAnswer(undefined), '');
  });
});

const ROMAJI_VECTORS = [
  ['ねこ', 'neko'], ['がっこう', 'gakkou'], ['きって', 'kitte'], ['ちょっと', 'chotto'],
  ['まっちゃ', 'matcha'], ['ざっし', 'zasshi'], ['しんぶん', 'shinbun'], ['ほんや', "hon'ya"],
  ['きんえん', "kin'en"], ['こんにゃく', 'konnyaku'], ['おかあさん', 'okaasan'], ['とうきょう', 'toukyou'],
  ['せんせい', 'sensei'], ['おおきい', 'ookii'], ['くうき', 'kuuki'], ['ぎゅうにゅう', 'gyuunyuu'],
  ['しゅくだい', 'shukudai'], ['じゃま', 'jama'], ['ちゅうい', 'chuui'], ['ふじさん', 'fujisan'],
  ['コーヒー', 'kōhī'], ['パーティー', 'pātī'], ['ケーキ', 'kēki'], ['スーパー', 'sūpā'],
  ['ニュース', 'nyūsu'], ['ジュース', 'jūsu'], ['シャツ', 'shatsu'], ['ファイル', 'fairu'],
  ['フォーク', 'fōku'], ['ウェブ', 'webu'], ['ウォッカ', 'wokka'], ['ディスク', 'disuku'],
  ['ティッシュ', 'tisshu'], ['チェック', 'chekku'], ['ジェット', 'jetto'], ['ヴァイオリン', 'vaiorin'],
  ['バッグ', 'baggu'], ['マッチ', 'matchi'], ['メイン', 'mein'], ['サッカー', 'sakkā'],
];

describe('toRomaji (§3.1)', () => {
  for (const [kana, romaji] of ROMAJI_VECTORS) {
    it(`${kana} → ${romaji}`, () => assert.equal(toRomaji(kana), romaji));
  }

  it('romanizes the special syllables', () => {
    assert.equal(toRomaji('しちつふじぢづをん'), 'shichitsufujididuwon');
    assert.equal(toRomaji('ぢゃぢゅぢょ'), 'dyadyudyo');
    assert.equal(toRomaji('ひゃみゅりょびゃぴゅにょぎゃ'), 'hyamyuryobyapyunyogya');
  });

  it('romanizes every extended katakana combination', () => {
    const combos = {
      ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo', フュ: 'fyu', ティ: 'ti', ディ: 'di', トゥ: 'tu',
      ドゥ: 'du', テュ: 'tyu', デュ: 'dyu', ウィ: 'wi', ウェ: 'we', ウォ: 'wo', ヴァ: 'va', ヴィ: 'vi',
      ヴ: 'vu', ヴェ: 've', ヴォ: 'vo', シェ: 'she', ジェ: 'je', チェ: 'che', ツァ: 'tsa', ツィ: 'tsi',
      ツェ: 'tse', ツォ: 'tso', イェ: 'ye', クァ: 'kwa', グァ: 'gwa', スィ: 'si', ズィ: 'zi',
    };
    for (const [kana, romaji] of Object.entries(combos)) assert.equal(toRomaji(kana), romaji, kana);
  });

  it('spells lone small kana with x', () => {
    assert.equal(toRomaji('ァ'), 'xa');
    assert.equal(toRomaji('ゃ'), 'xya');
    assert.equal(toRomaji('カァ'), 'kaxa');
    assert.equal(toRomaji('ヮ'), 'xwa');
  });

  it('doubles the right consonant cluster for sokuon', () => {
    assert.equal(toRomaji('ッシュ'), 'sshu');
    assert.equal(toRomaji('ッツ'), 'ttsu');
    assert.equal(toRomaji('ッジ'), 'jji');
    assert.equal(toRomaji('ッフ'), 'ffu');
    assert.equal(toRomaji('ッヴ'), 'vvu');
    assert.equal(toRomaji('ッチャ'), 'tcha');
    assert.equal(toRomaji('ッキョ'), 'kkyo');
  });

  it('uses xtsu when nothing consonantal follows', () => {
    assert.equal(toRomaji('っ'), 'xtsu');
    assert.equal(toRomaji('あっ'), 'axtsu');
    assert.equal(toRomaji('っあ'), 'xtsua');
    assert.equal(toRomaji('っん'), 'xtsun');
    assert.equal(toRomaji('ッー'), 'xtsu-');
    assert.equal(toRomaji('っっか'), 'xtsukka');
  });

  it("writes ん as n' only before vowels and y", () => {
    assert.equal(toRomaji('げんいん'), "gen'in");
    assert.equal(toRomaji('ほんよう'), "hon'you");
    assert.equal(toRomaji('みんな'), 'minna');
    assert.equal(toRomaji('こんにゃく'), 'konnyaku');
    assert.equal(toRomaji('ほん'), 'hon');
    assert.equal(toRomaji('ほんきゃ'), 'honkya');
  });

  it('turns ー into a macron or "-"', () => {
    assert.equal(toRomaji('ルール'), 'rūru');
    assert.equal(toRomaji('メール'), 'mēru');
    assert.equal(toRomaji('ボール'), 'bōru');
    assert.equal(toRomaji('ー'), '-');
    assert.equal(toRomaji('ーア'), '-a');
    assert.equal(toRomaji('アーー'), 'ā-');
    assert.equal(toRomaji('ンー'), 'n-');
    assert.equal(toRomaji('ッー'), 'xtsu-');
  });

  it('passes unknown characters through and handles empty input', () => {
    assert.equal(toRomaji('猫ねこ!'), '猫neko!');
    assert.equal(toRomaji('ABC'), 'ABC');
    assert.equal(toRomaji(''), '');
    assert.equal(toRomaji(null), '');
  });

  it('romanizes hiragana and katakana identically', () => {
    assert.equal(toRomaji('きょう'), toRomaji('キョウ'));
    assert.equal(toRomaji('ふぁいる'), 'fairu');
  });
});

describe('romajiToKana (§3.2)', () => {
  const vectors = [
    ['neko', 'ねこ'], ['gakkou', 'がっこう'], ['chotto', 'ちょっと'], ['tyotto', 'ちょっと'],
    ['matcha', 'まっちゃ'], ['shinbun', 'しんぶん'], ["hon'ya", 'ほんや'], ['honnya', 'ほんや'],
    ['onnna', 'おんな'], ['onna', 'おんあ'], ["kin'en", 'きんえん'], ['NEKO', 'ねこ'], ['ねko', 'ねこ'],
    ['xtu', 'っ'], ['kyo', 'きょ'],
  ];
  for (const [romaji, kana] of vectors) {
    it(`${romaji} → ${kana}`, () => assert.equal(romajiToKana(romaji), kana));
  }

  it('katakana vectors', () => {
    const k = { script: 'katakana' };
    assert.equal(romajiToKana('ko-hi-', k), 'コーヒー');
    assert.equal(romajiToKana('fairu', k), 'ファイル');
    assert.equal(romajiToKana('dhisuku', k), 'ディスク');
    assert.equal(romajiToKana('vaiorin', k), 'ヴァイオリン');
    assert.equal(romajiToKana('vu', k), 'ヴ');
    assert.equal(romajiToKana('ko-hi-'), 'こーひー');
  });

  it('ime option: trailing n and incomplete clusters', () => {
    const ime = { ime: true };
    assert.equal(romajiToKana('n', ime), 'n');
    assert.equal(romajiToKana('n'), 'ん');
    assert.equal(romajiToKana('ky', ime), 'ky');
    assert.equal(romajiToKana('ky'), 'ky');
    assert.equal(romajiToKana('kan', ime), 'かn');
    assert.equal(romajiToKana('kan'), 'かん');
    assert.equal(romajiToKana('kany', ime), 'かny');
    assert.equal(romajiToKana('kany'), 'かny');
    assert.equal(romajiToKana('kash', ime), 'かsh');
    assert.equal(romajiToKana('kats', ime), 'かts');
    assert.equal(romajiToKana('kak', ime), 'かk');
    assert.equal(romajiToKana('kakk', ime), 'かっk');
    assert.equal(romajiToKana("kan'", ime), 'かん');
    assert.equal(romajiToKana('kann', ime), 'かん');
    assert.equal(romajiToKana('KY', ime), 'KY');
  });

  it('n rules: nn, n\', xn, n before consonants and non-letters', () => {
    assert.equal(romajiToKana('nn'), 'ん');
    assert.equal(romajiToKana("n'"), 'ん');
    assert.equal(romajiToKana('xn'), 'ん');
    assert.equal(romajiToKana('kanji'), 'かんじ');
    assert.equal(romajiToKana('sanpo'), 'さんぽ');
    assert.equal(romajiToKana('hon ya'), 'ほん や');
    assert.equal(romajiToKana('ran-ki', { script: 'katakana' }), 'ランーキ');
    assert.equal(romajiToKana('konnnyaku'), 'こんにゃく');
    assert.equal(romajiToKana('konnyaku'), 'こんやく');
  });

  it('sokuon from doubled consonants and tch', () => {
    assert.equal(romajiToKana('kka'), 'っか');
    assert.equal(romajiToKana('ssha'), 'っしゃ');
    assert.equal(romajiToKana('cchi'), 'っち');
    assert.equal(romajiToKana('tchi'), 'っち');
    assert.equal(romajiToKana('zasshi'), 'ざっし');
    assert.equal(romajiToKana('tte'), 'って');
    assert.equal(romajiToKana('jji'), 'っじ');
    assert.equal(romajiToKana('vvu', { script: 'katakana' }), 'ッヴ');
  });

  it('supports every listed spelling', () => {
    const spellings = {
      shi: 'し', si: 'し', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', fu: 'ふ', hu: 'ふ', ji: 'じ', zi: 'じ',
      di: 'ぢ', du: 'づ', wo: 'を', ja: 'じゃ', jya: 'じゃ', zya: 'じゃ', cha: 'ちゃ', cya: 'ちゃ', tya: 'ちゃ',
      sha: 'しゃ', sya: 'しゃ', je: 'じぇ', jye: 'じぇ', zye: 'じぇ', che: 'ちぇ', cye: 'ちぇ', tye: 'ちぇ',
      she: 'しぇ', sye: 'しぇ', ye: 'いぇ', thi: 'てぃ', dhi: 'でぃ', dhu: 'でゅ', twu: 'とぅ', dwu: 'どぅ',
      fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ', wi: 'うぃ', we: 'うぇ', who: 'うぉ', va: 'ゔぁ', vi: 'ゔぃ',
      vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ', kwa: 'くぁ', gwa: 'ぐぁ', tsa: 'つぁ', xa: 'ぁ', la: 'ぁ', xya: 'ゃ',
      xtu: 'っ', ltu: 'っ', xtsu: 'っ', ltsu: 'っ', xwa: 'ゎ', '-': 'ー',
    };
    for (const [romaji, kana] of Object.entries(spellings)) assert.equal(romajiToKana(romaji), kana, romaji);
  });

  it('is case-insensitive and keeps unconverted Latin in its original case', () => {
    assert.equal(romajiToKana('Kyo'), 'きょ');
    assert.equal(romajiToKana('ShInBuN'), 'しんぶん');
    assert.equal(romajiToKana('NN'), 'ん');
    assert.equal(romajiToKana('Q'), 'Q');
  });

  it('preserves existing kana and other characters (mixed input)', () => {
    assert.equal(romajiToKana('ねko猫!'), 'ねこ猫!');
    assert.equal(romajiToKana('ねko', { script: 'katakana' }), 'ねコ');
    assert.equal(romajiToKana('コーhi-'), 'コーひー');
    assert.equal(romajiToKana('a b'), 'あ b');
    assert.equal(romajiToKana("it's"), "いt's");
    assert.equal(romajiToKana(''), '');
    assert.equal(romajiToKana(null), '');
  });

  it('rejects an unknown script', () => {
    assert.throws(() => romajiToKana('ka', { script: 'romaji' }), RangeError);
  });

  it('exposes a frozen copy of its table', () => {
    assert.equal(ROMAJI_TO_KANA.ka, 'か');
    assert.equal(ROMAJI_TO_KANA.xtsu, 'っ');
    assert.ok(Object.isFrozen(ROMAJI_TO_KANA));
  });
});

describe('toImeRomaji', () => {
  it('produces typing spellings that convert back exactly', () => {
    const cases = {
      コーヒー: 'ko-hi-', ティッシュ: 'thisshu', ディスク: 'dhisuku', ウォッカ: 'whokka',
      こんにゃく: 'konnnyaku', みんな: 'minnna', ほんや: "hon'ya", ほん: 'honn', トゥ: 'twu',
      デュエット: 'dhuetto', スィ: 'suxi', ゐ: 'wyi', ヷ: 'ヷ', っ: 'xtsu', ッティ: 'tthi',
    };
    for (const [kana, romaji] of Object.entries(cases)) {
      assert.equal(toImeRomaji(kana), romaji, kana);
      const script = detectScript(kana) === 'katakana' ? 'katakana' : 'hiragana';
      assert.equal(romajiToKana(romaji, { script }), kana, romaji);
    }
  });
});

/** Deterministic PRNG (mulberry32) so property failures are reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASIC_KANA = [...KEYBOARD.basic.flat(), ...KEYBOARD.voiced.flat()].filter(Boolean);
const YOON_UNITS = Array.from('きぎしじちにひびぴみり').flatMap((base) => Array.from('ゃゅょ').map((s) => base + s));
const N_INITIAL = new Set(['な', 'に', 'ぬ', 'ね', 'の', 'にゃ', 'にゅ', 'にょ', 'ん']);

function randomWord(next, units, { avoidAfterN = null } = {}) {
  const length = 1 + Math.floor(next() * 7);
  const word = [];
  while (word.length < length) {
    const unit = units[Math.floor(next() * units.length)];
    if (avoidAfterN && word.at(-1) === 'ん' && avoidAfterN.has(unit)) continue;
    word.push(unit);
  }
  return word.join('');
}

describe('round-trip properties', () => {
  it('KEYBOARD keys convert back from their standard romaji (both scripts)', () => {
    for (const script of ['hiragana', 'katakana']) {
      const layout = keyboardLayout(script);
      const typed = [...layout.basic.flat(), ...layout.voiced.flat(), ...layout.voicedExtra].filter(Boolean);
      for (const key of typed) assert.equal(romajiToKana(kanaKeyLabel(key), { script }), key, `${script} ${key}`);
      for (const key of layout.small) {
        const romaji = key === LONG_MARK ? '-' : `x${kanaKeyLabel(key)}`;
        assert.equal(romajiToKana(romaji, { script }), key, `${script} ${key}`);
      }
    }
  });

  // Display romaji is designed to be typed back with the IME. The one inherent ambiguity is ん
  // before an n-syllable or another ん (Hepburn "konnyaku" types こんやく in MS IME), so this
  // generator never places ん there; that case is covered by the toImeRomaji property below.
  it('romajiToKana(toRomaji(w)) === w for random hiragana words', () => {
    const next = rng(20261114);
    const units = [...BASIC_KANA, ...YOON_UNITS, 'っ', 'っ', 'ん', 'ん'];
    for (let n = 0; n < 400; n++) {
      const word = randomWord(next, units, { avoidAfterN: N_INITIAL });
      assert.equal(romajiToKana(toRomaji(word)), word, `${word} via ${toRomaji(word)}`);
    }
  });

  it('romajiToKana(toImeRomaji(w)) === w for unrestricted words in both scripts', () => {
    const next = rng(42);
    const units = [
      ...BASIC_KANA, ...YOON_UNITS, ...KEYBOARD.small, 'ゔ', 'ゐ', 'ゑ', 'ゕ', 'ゖ', 'ん', 'ん', 'っ',
      'ふぁ', 'てぃ', 'でぃ', 'とぅ', 'どぅ', 'てゅ', 'でゅ', 'うぃ', 'うぇ', 'うぉ', 'ゔぁ', 'しぇ', 'じぇ',
      'ちぇ', 'つぁ', 'つぃ', 'いぇ', 'くぁ', 'ぐぁ', 'すぃ', 'ずぃ', 'ぢゃ', 'ふゅ',
    ];
    for (let n = 0; n < 400; n++) {
      const word = randomWord(next, units);
      assert.equal(romajiToKana(toImeRomaji(word)), word, `${word} via ${toImeRomaji(word)}`);
      const kata = toKatakana(word);
      assert.equal(romajiToKana(toImeRomaji(kata), { script: 'katakana' }), kata, kata);
    }
  });
});

describe('kanaUnits', () => {
  it('merges small ゃゅょぁぃぅぇぉゎ into the preceding kana', () => {
    assert.deepEqual(kanaUnits('きょう'), ['きょ', 'う']);
    assert.deepEqual(kanaUnits('ティッシュ'), ['ティ', 'ッ', 'シュ']);
    assert.deepEqual(kanaUnits('クヮ'), ['クヮ']);
    assert.deepEqual(kanaUnits('コーヒー'), ['コ', 'ー', 'ヒ', 'ー']);
  });

  it('keeps small kana alone when nothing can carry them', () => {
    assert.deepEqual(kanaUnits('ゃあ'), ['ゃ', 'あ']);
    assert.deepEqual(kanaUnits('っゃ'), ['っ', 'ゃ']);
    assert.deepEqual(kanaUnits('ーァ'), ['ー', 'ァ']);
    assert.deepEqual(kanaUnits('aゃ'), ['a', 'ゃ']);
    assert.deepEqual(kanaUnits(''), []);
  });
});

describe('analyzeKana (§3.4)', () => {
  const tags = (kana) => analyzeKana(kana).features;

  it('detects each feature in canonical order', () => {
    assert.deepEqual(KANA_FEATURES, ['dakuten', 'handakuten', 'yoon', 'sokuon', 'long', 'extended']);
    assert.deepEqual(tags('ねこ'), []);
    assert.deepEqual(tags('ねご'), ['dakuten']);
    assert.deepEqual(tags('ゔ'), ['dakuten', 'extended']);
    assert.deepEqual(tags('ヴ'), ['dakuten', 'extended']);
    assert.deepEqual(tags('パン'), ['handakuten']);
    assert.deepEqual(tags('ぱぽ'), ['handakuten']);
    assert.deepEqual(tags('きょ'), ['yoon']);
    assert.deepEqual(tags('ちゃ'), ['yoon']);
    assert.deepEqual(tags('きって'), ['sokuon']);
    assert.deepEqual(tags('ケーキ'), ['long']);
    assert.deepEqual(tags('ファ'), ['extended']);
    assert.deepEqual(tags('クヮ'), ['extended']);
    assert.deepEqual(tags('ぎゅっぱー'), ['dakuten', 'handakuten', 'yoon', 'sokuon', 'long']);
  });

  it('reports length in code points and the script', () => {
    assert.deepEqual(analyzeKana('ねこ'), { length: 2, script: 'hiragana', features: [], level: 1 });
    assert.equal(analyzeKana('コーヒー').script, 'katakana');
    assert.equal(analyzeKana('').script, 'empty');
    assert.equal(analyzeKana('').level, 1);
  });

  it('level 1: length ≤ 4 without yoon/sokuon/long/extended', () => {
    assert.equal(analyzeKana('ねこ').level, 1);
    assert.equal(analyzeKana('がくせい').level, 1); // dakuten alone keeps level 1
    assert.equal(analyzeKana('ぱん').level, 1);
    assert.equal(analyzeKana('さかなや').level, 1); // length 4
  });

  it('level 2: everything else', () => {
    assert.equal(analyzeKana('たまごやき').level, 2); // length 5, no complex feature
    assert.equal(analyzeKana('ケーキ').level, 2); // one complex feature
    assert.equal(analyzeKana('きょう').level, 2);
    assert.equal(analyzeKana('きって').level, 2);
    assert.equal(analyzeKana('ちゅうしゃ').level, 2); // length 5, only yoon
    assert.equal(analyzeKana('きゃっと').level, 2); // length 4 with two complex features
    assert.equal(analyzeKana('あいうえおか').level, 2); // length 6
  });

  it('level 3: extended, length ≥ 7, or length ≥ 5 with two of yoon/sokuon/long', () => {
    assert.equal(analyzeKana('ファ').level, 3);
    assert.equal(analyzeKana('ヴ').level, 3);
    assert.equal(analyzeKana('あいうえおかき').level, 3); // length 7
    assert.equal(analyzeKana('ちょっとま').level, 3); // length 5, yoon + sokuon
    assert.equal(analyzeKana('しゅっぱつ').level, 3);
    assert.equal(analyzeKana('シャーベット').level, 3); // yoon + long + sokuon
    assert.equal(analyzeKana('サッカー').level, 2); // two features but length 4
  });
});

const m = (e) => ({ op: 'match', expected: e, actual: e });
const sub = (e, a) => ({ op: 'sub', expected: e, actual: a });
const del = (e) => ({ op: 'del', expected: e, actual: null });
const ins = (a) => ({ op: 'ins', expected: null, actual: a });

/** Reference Levenshtein distance on code points. */
function levenshtein(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[y.length];
}

describe('diffKana (§3.3)', () => {
  it('aligns matches, substitutions, deletions and insertions', () => {
    assert.deepEqual(diffKana('ねこ', 'ねこ'), [m('ね'), m('こ')]);
    assert.deepEqual(diffKana('ねこ', 'ねご'), [m('ね'), sub('こ', 'ご')]);
    assert.deepEqual(diffKana('コーヒー', 'コヒー'), [m('コ'), del('ー'), m('ヒ'), m('ー')]);
    assert.deepEqual(diffKana('コーヒー', 'コーヒ'), [m('コ'), m('ー'), m('ヒ'), del('ー')]);
    assert.deepEqual(diffKana('ねこ', 'ねこう'), [m('ね'), m('こ'), ins('う')]);
    assert.deepEqual(diffKana('きて', 'きって'), [m('き'), ins('っ'), m('て')]);
  });

  it('breaks ties deterministically: match/sub, then del, then ins', () => {
    assert.deepEqual(diffKana('ああ', 'あ'), [m('あ'), del('あ')]);
    assert.deepEqual(diffKana('あ', 'ああ'), [m('あ'), ins('あ')]);
    assert.deepEqual(diffKana('あ', 'い'), [sub('あ', 'い')]);
    assert.deepEqual(diffKana('ねこ', 'こね'), [sub('ね', 'こ'), sub('こ', 'ね')]);
    assert.deepEqual(diffKana('あい', 'う'), [sub('あ', 'う'), del('い')]);
  });

  it('handles empty strings', () => {
    assert.deepEqual(diffKana('', ''), []);
    assert.deepEqual(diffKana('ねこ', ''), [del('ね'), del('こ')]);
    assert.deepEqual(diffKana('', 'ねこ'), [ins('ね'), ins('こ')]);
  });

  it('iterates by code point (surrogate pairs stay whole)', () => {
    assert.deepEqual(diffKana('𠀋ね', '𠀋ね'), [m('𠀋'), m('ね')]);
    assert.deepEqual(diffKana('ね', '😺ね'), [ins('😺'), m('ね')]);
  });

  it('is a minimal alignment that reconstructs both strings (random check)', () => {
    const next = rng(7);
    const alphabet = Array.from('あいうアイ😺ー');
    const word = () => Array.from({ length: Math.floor(next() * 7) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
    for (let n = 0; n < 300; n++) {
      const [a, b] = [word(), word()];
      const ops = diffKana(a, b);
      assert.equal(ops.filter((op) => op.op !== 'ins').map((op) => op.expected).join(''), a);
      assert.equal(ops.filter((op) => op.op !== 'del').map((op) => op.actual).join(''), b);
      assert.equal(ops.filter((op) => op.op !== 'match').length, levenshtein(a, b), `${a} / ${b}`);
      for (const op of ops) assert.equal(op.op === 'match', op.expected === op.actual && op.expected !== null);
    }
  });
});

describe('compareAnswer (§3.3)', () => {
  it('accepts the exact answer after normalization', () => {
    const r = compareAnswer('コーヒー', ' ｺｰﾋｰ\u3000');
    assert.equal(r.correct, true);
    assert.equal(r.errorType, null);
    assert.equal(r.normalized, 'コーヒー');
    assert.deepEqual(r.diff, [m('コ'), m('ー'), m('ヒ'), m('ー')]);
    assert.equal(compareAnswer('コーヒー', 'コ\u2212ヒ\u2014').correct, true); // U+2212, U+2014
  });

  it('flags empty answers', () => {
    for (const raw of ['', '   ', '\u3000', '\u200B', null]) {
      const r = compareAnswer('ねこ', raw);
      assert.equal(r.errorType, 'empty');
      assert.equal(r.correct, false);
      assert.deepEqual(r.diff, [del('ね'), del('こ')]);
    }
  });

  it('flags right sounds in the wrong script (including mixed-script answers)', () => {
    assert.equal(compareAnswer('ねこ', 'ネコ').errorType, 'script');
    assert.equal(compareAnswer('ねこ', 'ねコ').errorType, 'script');
    assert.equal(compareAnswer('コーヒー', 'こーひー').errorType, 'script');
    assert.equal(compareAnswer('ねこ', 'ﾈｺ').errorType, 'script');
  });

  it('flags spelling mistakes with a diff', () => {
    const r = compareAnswer('がっこう', 'がこう');
    assert.equal(r.errorType, 'spelling');
    assert.deepEqual(r.diff, [m('が'), del('っ'), m('こ'), m('う')]);
    assert.equal(compareAnswer('ねこ', 'ネゴ').errorType, 'spelling');
    assert.equal(compareAnswer('ねこ', 'neko').errorType, 'spelling');
  });
});

describe('soundKey (§15.2)', () => {
  it('converts to hiragana and resolves ー to the vowel of the previous mora', () => {
    assert.equal(soundKey('コーヒー'), 'こおひい');
    assert.equal(soundKey('ラーメン'), 'らあめん');
    assert.equal(soundKey('スーパー'), 'すうぱあ');
    assert.equal(soundKey('ケーキ'), 'けえき');
    assert.equal(soundKey('メール'), 'めえる');
    assert.equal(soundKey('ねこ'), 'ねこ');
  });

  it('uses the vowel of a combined mora for ー (yōon and extended katakana)', () => {
    assert.equal(soundKey('ジュース'), 'じゅうす');
    assert.equal(soundKey('ショー'), 'しょお');
    assert.equal(soundKey('ティー'), 'てぃい');
    assert.equal(soundKey('フォーク'), 'ふぉおく');
    assert.equal(soundKey('チェーン'), 'ちぇえん');
  });

  it('keeps ー when there is no previous vowel (start, after ん or っ) and chains repeated marks', () => {
    assert.equal(soundKey('ー'), 'ー');
    assert.equal(soundKey('ンー'), 'んー');
    assert.equal(soundKey('ッー'), 'っー');
    assert.equal(soundKey('アーー'), 'あああ');
  });

  it('maps を→お, づ→ず, ぢ→じ in both scripts', () => {
    assert.equal(soundKey('を'), 'お');
    assert.equal(soundKey('ヲ'), 'お');
    assert.equal(soundKey('つづく'), 'つずく');
    assert.equal(soundKey('はなぢ'), 'はなじ');
    assert.equal(soundKey('ヂ'), 'じ');
    assert.equal(soundKey('ヅ'), 'ず');
  });

  it('folds long o (おう/おお/ー) and long e (えい/ええ/ー) onto one key', () => {
    for (const s of ['こう', 'こお', 'こー', 'コウ', 'コオ', 'コー']) assert.equal(soundKey(s), 'こお', s);
    for (const s of ['けい', 'けえ', 'けー', 'ケイ', 'ケエ', 'ケー']) assert.equal(soundKey(s), 'けえ', s);
    assert.equal(soundKey('とおり'), 'とおり');
    assert.equal(soundKey('とうり'), 'とおり');
    assert.equal(soundKey('せんせい'), 'せんせえ');
    assert.equal(soundKey('きょう'), 'きょお');
    assert.equal(soundKey('おう'), 'おお');
    assert.equal(soundKey('えい'), 'ええ');
    assert.equal(soundKey('ぇい'), 'ぇえ');
  });

  it('leaves う/い after other vowels, and after ん/っ, unchanged', () => {
    assert.equal(soundKey('くう'), 'くう');
    assert.equal(soundKey('かい'), 'かい');
    assert.equal(soundKey('こい'), 'こい');
    assert.equal(soundKey('けう'), 'けう');
    assert.equal(soundKey('こんい'), 'こんい');
    assert.equal(soundKey('こっう'), 'こっう');
  });

  it('does not lengthen a mora that already lengthens a vowel (kōun ≠ kōon)', () => {
    assert.equal(soundKey('こううん'), 'こおうん');
    assert.equal(soundKey('こうおん'), 'こおおん');
    assert.equal(soundKey('こーおん'), 'こおおん');
    assert.equal(soundKey('けいい'), 'けえい');
    assert.equal(soundKey('こうおう'), soundKey('こおおお'));
    assert.equal(soundKey('おおい'), soundKey('おうい'));
    assert.notEqual(soundKey('こううん'), soundKey('こうおん'));
  });

  it('passes non-kana through and tolerates null/undefined', () => {
    assert.equal(soundKey('abc'), 'abc');
    assert.equal(soundKey(''), '');
    assert.equal(soundKey(null), '');
    assert.equal(soundKey(undefined), '');
  });
});

describe('compareAnswer modes (§15.2)', () => {
  const listen = { mode: 'listen' };

  it('accepts same-sound spellings as a correct variant in listen mode', () => {
    for (const [expected, answer] of [
      ['コーヒー', 'コオヒイ'], ['コーヒー', 'コウヒイ'], ['ケーキ', 'ケエキ'], ['ケーキ', 'ケイキ'],
      ['がっこう', 'がっこお'], ['とおい', 'とうい'], ['せんせい', 'せんせえ'], ['おねえさん', 'おねいさん'],
      ['つづく', 'つずく'], ['はなぢ', 'はなじ'], ['ちぢむ', 'ちじむ'], ['をかし', 'おかし'],
      ['ラーメン', 'ラアメン'], ['ジュース', 'ジュウス'],
    ]) {
      const r = compareAnswer(expected, answer, listen);
      assert.equal(r.errorType, 'variant', `${expected} / ${answer}`);
      assert.equal(r.correct, true, `${expected} / ${answer}`);
      assert.equal(r.normalized, answer);
      assert.ok(r.diff.some((op) => op.op !== 'match'), 'diff still shows the standard spelling');
    }
  });

  it('normalizes the raw answer before the variant check', () => {
    const r = compareAnswer('コーヒー', ' ｺｵﾋｲ ', listen);
    assert.equal(r.errorType, 'variant');
    assert.equal(r.normalized, 'コオヒイ');
  });

  it('keeps exact, empty and script results unchanged in listen mode', () => {
    assert.deepEqual(compareAnswer('コーヒー', 'コーヒー', listen), compareAnswer('コーヒー', 'コーヒー'));
    assert.equal(compareAnswer('コーヒー', 'コーヒー', listen).errorType, null);
    assert.equal(compareAnswer('ねこ', '', listen).errorType, 'empty');
    assert.equal(compareAnswer('ねこ', 'ネコ', listen).errorType, 'script');
    assert.equal(compareAnswer('コーヒー', 'こーひー', listen).errorType, 'script');
  });

  it('never accepts a variant written in the wrong or a mixed script', () => {
    for (const [expected, answer] of [
      ['コーヒー', 'こおひい'], ['コーヒー', 'コおヒい'], ['がっこう', 'ガッコオ'], ['せんせい', 'せんせー'],
    ]) {
      const r = compareAnswer(expected, answer, listen);
      assert.equal(r.errorType, 'spelling', `${expected} / ${answer}`);
      assert.equal(r.correct, false);
    }
  });

  it('still flags different sounds as spelling in listen mode', () => {
    for (const [expected, answer] of [
      ['コーヒー', 'コヒ'], ['コーヒー', 'コーヒ'], ['がっこう', 'がこう'], ['ねこ', 'ねご'],
      ['くう', 'くお'], ['かい', 'かえ'], ['おばさん', 'おばあさん'], ['ねこ', 'neko'],
      ['こううん', 'こうおん'], ['こうおん', 'こううん'],
    ]) {
      const r = compareAnswer(expected, answer, listen);
      assert.equal(r.errorType, 'spelling', `${expected} / ${answer}`);
      assert.equal(r.correct, false);
    }
  });

  it('never returns variant in romaji mode (default or explicit)', () => {
    for (const opts of [undefined, {}, { mode: 'romaji' }, { mode: 'unknown' }]) {
      const r = compareAnswer('コーヒー', 'コオヒイ', opts);
      assert.equal(r.errorType, 'spelling');
      assert.equal(r.correct, false);
      assert.equal(compareAnswer('つづく', 'つずく', opts).errorType, 'spelling');
      assert.equal(compareAnswer('ねこ', 'ネコ', opts).errorType, 'script');
    }
  });
});

describe('charOutcomes', () => {
  it('returns one entry per expected character', () => {
    assert.deepEqual(charOutcomes('ねこ', 'ねご'), [
      { index: 0, char: 'ね', correct: true }, { index: 1, char: 'こ', correct: false },
    ]);
    assert.deepEqual(charOutcomes('ねこ', 'ねうこ').map((o) => o.correct), [true, true]);
    assert.deepEqual(charOutcomes('コーヒー', 'コヒー').map((o) => o.correct), [true, false, true, true]);
    assert.deepEqual(charOutcomes('ねこ', '').map((o) => o.correct), [false, false]);
    assert.deepEqual(charOutcomes('', 'ねこ'), []);
    assert.deepEqual(charOutcomes('𠀋ね', '𠀋'), [{ index: 0, char: '𠀋', correct: true }, { index: 1, char: 'ね', correct: false }]);
  });
});

describe('commonPrefixLength & guideState (§3.5)', () => {
  it('counts shared leading code points', () => {
    assert.equal(commonPrefixLength('ねこ', 'ねご'), 1);
    assert.equal(commonPrefixLength('ねこ', 'ねこ'), 2);
    assert.equal(commonPrefixLength('', 'ね'), 0);
    assert.equal(commonPrefixLength('😺あ', '😺い'), 1);
  });

  it('describes progress, errors, completion and overflow', () => {
    const state = (matched, nextIndex, wrongAt, complete, overflow) => ({ matched, nextIndex, wrongAt, complete, overflow });
    assert.deepEqual(guideState('コーヒー', ''), state(0, 0, null, false, false));
    assert.deepEqual(guideState('コーヒー', 'コー'), state(2, 2, null, false, false));
    assert.deepEqual(guideState('コーヒー', 'コヒ'), state(1, 1, 1, false, false));
    assert.deepEqual(guideState('コーヒー', 'コーヒー'), state(4, null, null, true, false));
    assert.deepEqual(guideState('コーヒー', 'コーヒーー'), state(4, null, 4, false, true));
    assert.deepEqual(guideState('ねこ', 'ネ'), state(0, 0, 0, false, false));
    assert.deepEqual(guideState('😺ね', '😺'), state(1, 1, null, false, false));
  });
});

describe('KEYBOARD & keyboardLayout (§3.6)', () => {
  it('matches the spec layout', () => {
    assert.deepEqual(KEYBOARD.basicColumns, ['', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w', 'n']);
    assert.equal(KEYBOARD.basic.length, 5);
    for (const row of KEYBOARD.basic) assert.equal(row.length, 11);
    assert.deepEqual(KEYBOARD.basic.map((row) => row[0]).join(''), 'あいうえお');
    assert.deepEqual(KEYBOARD.basic[0][10], 'ん');
    assert.deepEqual(KEYBOARD.basic[4][9], 'を');
    assert.deepEqual(KEYBOARD.voicedColumns, ['g', 'z', 'd', 'b', 'p']);
    assert.deepEqual(KEYBOARD.voiced.map((row) => row.join('')), ['がざだばぱ', 'ぎじぢびぴ', 'ぐずづぶぷ', 'げぜでべぺ', 'ごぞどぼぽ']);
    assert.deepEqual(KEYBOARD.voicedExtra, ['ゔ']);
    assert.deepEqual(KEYBOARD.small.join(''), 'ゃゅょっぁぃぅぇぉゎー');
  });

  it('is deep-frozen', () => {
    assert.ok(Object.isFrozen(KEYBOARD));
    assert.ok(Object.isFrozen(KEYBOARD.basic) && Object.isFrozen(KEYBOARD.basic[0]));
    assert.ok(Object.isFrozen(KEYBOARD.voiced[4]) && Object.isFrozen(KEYBOARD.small));
    assert.throws(() => { KEYBOARD.small.push('x'); }, TypeError);
    assert.throws(() => { KEYBOARD.basic[0][0] = 'x'; }, TypeError);
  });

  it('provides the katakana twin layout', () => {
    assert.equal(keyboardLayout('hiragana'), KEYBOARD);
    const kata = keyboardLayout('katakana');
    assert.equal(kata.basic[0][0], 'ア');
    assert.equal(kata.basic[4][9], 'ヲ');
    assert.deepEqual(kata.voicedExtra, ['ヴ']);
    assert.equal(kata.small.join(''), 'ャュョッァィゥェォヮー');
    assert.deepEqual(kata.basicColumns, KEYBOARD.basicColumns);
    assert.equal(kata.basic[1][7], '');
    assert.ok(Object.isFrozen(kata.voiced[0]));
    assert.throws(() => keyboardLayout('romaji'), RangeError);
  });
});

describe('applyModifier (§3.6)', () => {
  it('toggles dakuten in both scripts', () => {
    const pairs = [['か', 'が'], ['し', 'じ'], ['つ', 'づ'], ['ほ', 'ぼ'], ['う', 'ゔ'], ['ウ', 'ヴ'], ['カ', 'ガ'], ['テ', 'デ']];
    for (const [plain, voiced] of pairs) {
      assert.equal(applyModifier(plain, 'dakuten'), voiced);
      assert.equal(applyModifier(voiced, 'dakuten'), plain);
    }
    assert.equal(applyModifier('ぱ', 'dakuten'), 'ば');
    assert.equal(applyModifier('ペ', 'dakuten'), 'ベ');
  });

  it('toggles handakuten on the h-row', () => {
    assert.equal(applyModifier('は', 'handakuten'), 'ぱ');
    assert.equal(applyModifier('ぱ', 'handakuten'), 'は');
    assert.equal(applyModifier('ば', 'handakuten'), 'ぱ');
    assert.equal(applyModifier('フ', 'handakuten'), 'プ');
    assert.equal(applyModifier('プ', 'handakuten'), 'フ');
  });

  it('toggles small forms', () => {
    const pairs = [['や', 'ゃ'], ['ゆ', 'ゅ'], ['よ', 'ょ'], ['つ', 'っ'], ['あ', 'ぁ'], ['お', 'ぉ'], ['わ', 'ゎ'],
      ['ヤ', 'ャ'], ['ツ', 'ッ'], ['ア', 'ァ'], ['ワ', 'ヮ']];
    for (const [large, small] of pairs) {
      assert.equal(applyModifier(large, 'small'), small);
      assert.equal(applyModifier(small, 'small'), large);
    }
  });

  it('round-trips every voiced key of both layouts', () => {
    for (const script of ['hiragana', 'katakana']) {
      const { voiced, voicedExtra } = keyboardLayout(script);
      for (const key of [...voiced.flat(), ...voicedExtra]) {
        const mod = key.normalize('NFD').endsWith('\u309A') ? 'handakuten' : 'dakuten';
        const plain = applyModifier(key, mod);
        assert.ok(plain && plain !== key, key);
        assert.equal(applyModifier(plain, mod), key);
      }
    }
  });

  it('returns null when the modifier does not apply', () => {
    for (const ch of ['な', 'あ', 'ん', 'ー', 'ワ', 'a', '', 'ねこ', null]) assert.equal(applyModifier(ch, 'dakuten'), null, String(ch));
    for (const ch of ['か', 'が', 'ん', 'ー']) assert.equal(applyModifier(ch, 'handakuten'), null, ch);
    for (const ch of ['か', 'ん', 'が', 'ー', 'ぱ']) assert.equal(applyModifier(ch, 'small'), null, ch);
  });

  it('throws on an unknown modifier', () => {
    assert.throws(() => applyModifier('か', 'tenten'), RangeError);
  });
});

describe('kanaKeyLabel', () => {
  it('labels keys with romaji', () => {
    const labels = {
      し: 'shi', ゃ: 'ya', っ: 'tsu', ー: '-', ぁ: 'a', ゎ: 'wa', ん: 'n', を: 'wo', ぢ: 'di', づ: 'du',
      ゔ: 'vu', シ: 'shi', ャ: 'ya', ッ: 'tsu', ヴ: 'vu', ふ: 'fu',
    };
    for (const [key, label] of Object.entries(labels)) assert.equal(kanaKeyLabel(key), label, key);
  });

  it('labels every layout key and returns "" for empty cells', () => {
    for (const script of ['hiragana', 'katakana']) {
      const layout = keyboardLayout(script);
      for (const key of [...layout.basic.flat(), ...layout.voiced.flat(), ...layout.small].filter(Boolean)) {
        assert.match(kanaKeyLabel(key), /^([a-z]+|-)$/, key);
      }
    }
    assert.equal(kanaKeyLabel(''), '');
    assert.equal(kanaKeyLabel('a'), '');
    assert.equal(kanaKeyLabel('きゃ'), '');
  });
});
