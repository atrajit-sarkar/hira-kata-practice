# HiraKata — Build Specification (v1)

> **This document is the contract.** Every module is built by a different engineer working in
> parallel. If you own a file, implement exactly the interfaces described here. If the spec is
> ambiguous, choose the most user-friendly reading, keep the interface stable, and record the
> decision in your final report. Never silently change a shared contract (API shapes, module
> exports, CSS token names, DB schema).

---

## 0. Product summary

**HiraKata** (ひらカタ) is a web app for learning to *write* Japanese hiragana and katakana through
real dictionary vocabulary.

1. A **test** is a sequence of randomly selected dictionary words. Each question shows the word's
   **romaji**. The learner writes the word in **kana**, choosing the appropriate script — hiragana
   for native/Sino-Japanese words, katakana for loanwords and other words conventionally written in
   katakana.
2. Each answer is checked and shown as **right or wrong with polished animations**. A wrong answer
   shows the **correct spelling** with a character-level diff and an explanation (e.g. "right
   sounds, wrong script").
3. **Hint 1 — Script hint:** reveals whether the word is written in hiragana or katakana.
4. **Hint 2 — Guided spelling:** the site **live-checks** what the learner is writing and reveals
   only the **next correct character**; each time the learner writes it correctly, the following
   character is revealed, until the word is complete.
5. After a question is checked and scored, the learner sees the word's **meaning** (English
   glosses, kanji form, part of speech, loanword origin, JLPT level) so they learn vocabulary too.
6. **Accounts** (email + password, or a guest account that can later be upgraded) store all progress
   in a **SQLite database**.
7. A **dashboard** shows KPIs, charts, kana mastery, and the list of tests. Learners can start
   **multiple tests** (fresh starts), resume active ones, review finished ones, and delete them.
8. A test can be **closed at any point**. A **PDF progress report** can be downloaded at any time
   (per test, and an overall report).

Word data: **JMdict** common entries (EDRDG, CC BY-SA 4.0) via *jmdict-simplified*, with optional
**JLPT** level tags (Jonathan Waller's lists, CC BY, via *stephenmk/yomitan-jlpt-vocab*).

---

## 1. Stack & hard constraints

- **Node ≥ 22.13** (dev machine: Node 24.14 on Windows 11). ESM everywhere (`"type": "module"`).
- **Server:** Express 5 (installed), `node:sqlite` `DatabaseSync` (built-in, no native deps),
  `node:crypto` (scrypt, randomBytes, sha256). `pdfkit` is installed for PDFs.
  **Do not add dependencies or edit `package.json`.** If you truly need one, say so in your report.
- **Frontend:** build-less **vanilla JavaScript ES modules** + modern CSS. No frameworks, no
  bundler, no third-party JS. Google Fonts is the only external resource.
- **Tests:** `node:test` + global `fetch`. `npm test` runs `test/**/*.test.js`. Run only *your own*
  test files while other engineers are still working (their files may be mid-edit).
- **Dev screenshots / E2E:** `puppeteer-core` (installed) + the local Chrome. Use
  `node scripts/dev/shot.mjs` (usage documented in its header). It sends
  `X-Requested-With: HiraKata` on its API calls.
- **Windows safety:** never kill processes by image name (`taskkill /IM node.exe`, `pkill node`,
  `Stop-Process -Name node`) — other engineers and the tooling itself run on Node. Only kill PIDs
  you started. Always stop servers you started before you finish.
- Use `path.join`/`URL` for paths; don't assume `/` vs `\`.
- Timestamps are ISO-8601 UTC strings from `new Date().toISOString()`.

---

## 2. Repository layout & ownership

```
package.json, .gitignore, docs/SPEC.md, scripts/dev/shot.mjs      (lead — do not edit)
shared/kana.js                         kana engine (browser + Node)               [kana]
test/kana.test.js                                                                [kana]
scripts/build-wordbank.mjs             JMdict → data/words.json                   [words]
data/words.json, data/ATTRIBUTION.md                                              [words]
test/wordbank.test.js                                                            [words]
server/index.js, server/app.js, server/config.js, server/db.js                    [backend]
server/auth.js, server/http.js (errors/validation helpers), server/security.js    [backend]
server/routes/*.js, server/services/*.js                                          [backend]
test/api.test.js, test/scoring.test.js, test/helpers/*, test/fixtures/words.fixture.json [backend]
.env.example                                                                      [backend]
server/report/** (pdf.js, layout helpers, fonts/)                                 [pdf]
scripts/build-fonts.py, test/report.test.js, test/fixtures/report-*.json         [pdf]
public/index.html, public/favicon.svg, public/img/**                              [foundation]
public/css/{tokens,base,components,layout,landing,auth,settings}.css              [foundation]
public/js/{main,router,api,store,theme-init}.js, public/js/ui/**                  [foundation]
public/js/pages/{landing,login,register,settings,notfound}.js                     [foundation]
public/js/pages/dashboard.js, public/js/dashboard/**, public/css/dashboard.css     [dashboard]
public/js/pages/practice.js, public/js/practice/**, public/css/practice.css        [practice]
public/js/pages/{results,vocab}.js, public/js/{results,vocab}/**,
  public/css/{results,vocab}.css                                                  [results-vocab]
e2e/**, README.md                                                                 [integration]
```

The foundation engineer creates **placeholder** files for `pages/dashboard.js`, `pages/practice.js`,
`pages/results.js`, `pages/vocab.js` and empty `css/dashboard.css`, `css/practice.css`,
`css/results.css`, `css/vocab.css` so the shell works; the page engineers overwrite them.

Shared foundation files (`ui/*`, `components.css`, `tokens.css`) may receive **small additive
edits** from page engineers when unavoidable (re-read the file right before editing; never rewrite
or reorder existing code). Prefer keeping page-specific code in your own files.

---

## 3. Shared kana engine — `shared/kana.js`

Pure ESM, zero dependencies, no DOM access; imported by the server (`../shared/kana.js`) and the
browser (`/shared/kana.js`, served statically). Iterate strings by **code points**
(`Array.from(str)`). Export exactly these names (more helpers may be added, never removed):

```js
export function isHiragana(ch)         // one char: U+3041–U+3096
export function isKatakana(ch)         // one char: U+30A1–U+30FA, or 'ー' (U+30FC)
export function isKana(ch)
export function detectScript(str)      // 'empty' | 'hiragana' | 'katakana' | 'mixed' | 'other'
                                       // ー counts as katakana; any non-kana char → 'other'
export function toKatakana(str)        // ぁ–ゖ → ァ–ヶ (+0x60); everything else unchanged
export function toHiragana(str)        // ァ–ヶ → ぁ–ゖ (−0x60); ー, ヷ–ヺ and others unchanged
export function normalizeAnswer(str)   // §3.3
export function toRomaji(kana)         // §3.1 display romanization
export function romajiToKana(text, { script = 'hiragana', ime = false } = {})   // §3.2
export function kanaUnits(kana)        // ['きょ','う'] — base + following small ゃゅょぁぃぅぇぉゎ merged
export function analyzeKana(kana)      // { length, script, features: string[], level: 1|2|3 }  §3.4
export function commonPrefixLength(expected, typed)   // number of leading code points equal
export function guideState(expected, typed)           // §3.5
export function diffKana(expected, actual)            // §3.3 alignment ops
export function compareAnswer(expected, rawActual)    // §3.3
export function charOutcomes(expected, actual)        // §3.3
export const KEYBOARD                                 // §3.6 (hiragana layout)
export function applyModifier(ch, mod)                // §3.6
export function kanaKeyLabel(ch)                      // romaji label for an on-screen key
```

### 3.1 Display romanization — `toRomaji(kana)`

Purpose: the romaji shown in a question must let a learner reconstruct the **exact kana spelling**
(except the script choice). Rules:

- Modified Hepburn syllables: し shi, ち chi, つ tsu, ふ fu, じ ji, ぢ di, づ du, を wo, ん n,
  きゃ kya, しゃ sha, ちゃ cha, じゃ ja, にゃ nya, ひゃ hya, みゃ mya, りゃ rya, ぎゃ gya, びゃ bya,
  ぴゃ pya (and ゅ/ょ variants). Katakana is romanized identically.
- **Long vowels in hiragana are spelled out kana-by-kana**: おかあさん okaasan, とうきょう toukyou,
  せんせい sensei, おおきい ookii, くうき kuuki. (No macrons for hiragana.)
- **The long-vowel mark ー becomes a macron on the preceding vowel**: コーヒー kōhī, ケーキ kēki,
  スーパー sūpā, パーティー pātī. Precomposed ā ī ū ē ō. If ー follows something that is not a vowel
  (or starts the word, or is doubled), output `-`.
- **Sokuon** っ/ッ doubles the next consonant: きって kitte, がっこう gakkou, ざっし zasshi,
  ちょっと chotto, まっちゃ **matcha** (before ch → `t`), バッグ baggu, ジェット jetto.
  If nothing consonantal follows (vowel, end of word), output `xtsu`.
- **ん** is `n`; before a vowel or `y` it is `n'`: きんえん kin'en, ほんや hon'ya. Before other
  consonants (including n) it is plain `n`: しんぶん shinbun, こんにゃく konnyaku.
- Katakana extended combinations: ファ fa, フィ fi, フェ fe, フォ fo, フュ fyu, ティ ti, ディ di,
  トゥ tu, ドゥ du, テュ tyu, デュ dyu, ウィ wi, ウェ we, ウォ wo, ヴァ va, ヴィ vi, ヴ vu, ヴェ ve,
  ヴォ vo, シェ she, ジェ je, チェ che, ツァ tsa, ツィ tsi, ツェ tse, ツォ tso, イェ ye, クァ kwa,
  グァ gwa, スィ si, ズィ zi. A lone small vowel/ゃ that cannot combine → `x` + vowel (e.g. `xa`).
- Unknown characters pass through unchanged. Output is lowercase.

Required test vectors (all must pass):

| kana | romaji | kana | romaji |
|---|---|---|---|
| ねこ | neko | コーヒー | kōhī |
| がっこう | gakkou | パーティー | pātī |
| きって | kitte | ケーキ | kēki |
| ちょっと | chotto | スーパー | sūpā |
| まっちゃ | matcha | ニュース | nyūsu |
| ざっし | zasshi | ジュース | jūsu |
| しんぶん | shinbun | シャツ | shatsu |
| ほんや | hon'ya | ファイル | fairu |
| きんえん | kin'en | フォーク | fōku |
| こんにゃく | konnyaku | ウェブ | webu |
| おかあさん | okaasan | ウォッカ | wokka |
| とうきょう | toukyou | ディスク | disuku |
| せんせい | sensei | ティッシュ | tisshu |
| おおきい | ookii | チェック | chekku |
| くうき | kuuki | ジェット | jetto |
| ぎゅうにゅう | gyuunyuu | ヴァイオリン | vaiorin |
| しゅくだい | shukudai | バッグ | baggu |
| じゃま | jama | マッチ | matchi |
| ちゅうい | chuui | メイン | mein |
| ふじさん | fujisan | サッカー | sakkā |

### 3.2 Romaji input method — `romajiToKana(text, { script, ime })`

Used by the optional "type romaji, get kana" input mode. Converts every run of ASCII letters
(and `-`, `'`) in `text` to kana in `script` (`'hiragana' | 'katakana'`); kana already present is
preserved; other characters pass through. Case-insensitive. Rules follow **Microsoft IME**:

- `nn` → ん, `n'` → ん, `xn` → ん; `n` followed by a consonant other than `n`/`y` → ん.
  Therefore `onna` → おんあ and `onnna` → おんな (document this in the UI help).
- A doubled consonant (not `n`) → っ + the rest: `kka` → っか, `ssha` → っしゃ, `cchi` → っち,
  and `tch` → っち.
- `-` → ー (both scripts).
- `shi/si` し, `chi/ti` ち, `tsu/tu` つ, `fu/hu` ふ, `ji/zi` じ, `di` ぢ, `du` づ, `wo` を,
  `ja/jya/zya` じゃ, `cha/cya/tya` ちゃ, `sha/sya` しゃ, `je/jye/zye` じぇ, `che/cye/tye` ちぇ,
  `she/sye` しぇ, `ye` いぇ, `thi` てぃ, `dhi` でぃ, `dhu` でゅ, `twu` とぅ, `dwu` どぅ, `fa/fi/fe/fo` ふぁ…,
  `wi` うぃ, `we` うぇ, `who` うぉ, `va/vi/vu/ve/vo` ゔぁ/ゔぃ/ゔ/ゔぇ/ゔぉ, `kwa` くぁ, `gwa` ぐぁ,
  `tsa` つぁ, small kana with `x`/`l` prefix (`xa` ぁ, `xya` ゃ, `xtu/ltu/xtsu` っ, `xwa` ゎ).
- `script: 'katakana'` produces katakana (ゔ → ヴ).
- `ime: true` (live typing): a trailing lone `n` and trailing incomplete clusters (e.g. `k`, `ky`,
  `sh`, `ts`) stay as Latin letters so the user can keep typing. `ime: false`: trailing `n` → ん,
  incomplete clusters stay as-is.

Test vectors: `neko`→ねこ, `gakkou`→がっこう, `chotto`/`tyotto`→ちょっと, `matcha`→まっちゃ,
`shinbun`→しんぶん, `hon'ya`→ほんや, `honnya`→ほんや, `onnna`→おんな, `kin'en`→きんえん,
`ko-hi-` (katakana)→コーヒー, `fairu` (katakana)→ファイル, `dhisuku` (katakana)→ディスク,
`vaiorin` (katakana)→ヴァイオリン, `NEKO`→ねこ, `ねko`→ねこ, `xtu`→っ, `n` (ime) → `n`,
`n` (no ime) → ん, `kyo` → きょ, `ky` (ime) → `ky`.

### 3.3 Answer normalization, diff and comparison

`normalizeAnswer(str)`:
1. `str.normalize('NFKC')` (half-width katakana ｺｰﾋｰ → コーヒー, full-width ASCII → ASCII).
2. Remove all whitespace (incl. U+3000) and zero-width characters (U+200B–U+200D, U+FEFF).
3. Map dash-like characters to `ー`: U+002D, U+2010–U+2015, U+2212, U+FF0D, U+FF70.
4. Never convert between scripts.

`diffKana(expected, actual)` → array of ops from a Levenshtein alignment on code points
(sub/ins/del cost 1), deterministic tie-break preferring match/sub, then del, then ins:
```js
{ op: 'match', expected: 'ね', actual: 'ね' }
{ op: 'sub',   expected: 'こ', actual: 'ご' }
{ op: 'del',   expected: 'ー', actual: null }   // missing in the learner's answer
{ op: 'ins',   expected: null, actual: 'う' }   // extra character the learner wrote
```

`compareAnswer(expected, rawActual)` →
`{ correct, normalized, errorType, diff }` where `normalized = normalizeAnswer(rawActual)`,
`diff = diffKana(expected, normalized)` and `errorType` is:
- `null` when `normalized === expected` (correct),
- `'empty'` when `normalized === ''`,
- `'script'` when `toHiragana(normalized) === toHiragana(expected)` (right sounds, wrong script),
- `'spelling'` otherwise.

`charOutcomes(expected, actual)` → one entry per **expected** character, in order:
`[{ index, char, correct }]` (`match` → correct; `sub`/`del` → incorrect). Used for kana stats.

### 3.4 Kana analysis & difficulty — `analyzeKana(kana)`

Features (string tags):
- `dakuten` — any voiced kana (が…ぼ, ゔ, and katakana equivalents incl. ヴ)
- `handakuten` — ぱ…ぽ / パ…ポ
- `yoon` — small ゃゅょ/ャュョ
- `sokuon` — っ/ッ
- `long` — ー
- `extended` — small ァィゥェォ/ヮ used in katakana combinations, or ヴ

`length` = code points. `level`:
- **1 (Beginner)** — length ≤ 4 and none of `yoon`, `sokuon`, `long`, `extended`.
- **3 (Advanced)** — `extended`, or length ≥ 7, or (length ≥ 5 and at least two of
  `yoon`/`sokuon`/`long`).
- **2 (Intermediate)** — everything else.

### 3.5 Guided spelling state — `guideState(expected, typed)`

`typed` is the learner's current normalized kana (pending Latin letters removed).
Returns `{ matched, nextIndex, wrongAt, complete, overflow }`:
- `matched = commonPrefixLength(expected, typed)`
- `nextIndex = matched < len(expected) ? matched : null` (the character to reveal next)
- `wrongAt = len(typed) > matched ? matched : null` (first wrong position in `typed`)
- `complete = matched === len(expected) && len(typed) === len(expected)`
- `overflow = matched === len(expected) && len(typed) > len(expected)`

### 3.6 Keyboard data & modifiers

```js
KEYBOARD = {
  basicColumns: ['', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w', 'n'],
  basic: [            // rows = vowels a, i, u, e, o; '' = empty cell
    ['あ','か','さ','た','な','は','ま','や','ら','わ','ん'],
    ['い','き','し','ち','に','ひ','み','','り','',''],
    ['う','く','す','つ','ぬ','ふ','む','ゆ','る','',''],
    ['え','け','せ','て','ね','へ','め','','れ','',''],
    ['お','こ','そ','と','の','ほ','も','よ','ろ','を',''],
  ],
  voicedColumns: ['g', 'z', 'd', 'b', 'p'],
  voiced: [
    ['が','ざ','だ','ば','ぱ'], ['ぎ','じ','ぢ','び','ぴ'], ['ぐ','ず','づ','ぶ','ぷ'],
    ['げ','ぜ','で','べ','ぺ'], ['ご','ぞ','ど','ぼ','ぽ'],
  ],
  voicedExtra: ['ゔ'],
  small: ['ゃ','ゅ','ょ','っ','ぁ','ぃ','ぅ','ぇ','ぉ','ゎ','ー'],
}
```
Katakana layout = `toKatakana` of each key (ゔ → ヴ, ゎ → ヮ; ー unchanged).

`applyModifier(ch, mod)` with `mod ∈ 'dakuten' | 'handakuten' | 'small'` toggles in both scripts:
か↔が, う↔ゔ, ウ↔ヴ, は→ば/ぱ→ば for dakuten; は↔ぱ, ば→ぱ for handakuten; や↔ゃ, つ↔っ, あ↔ぁ, わ↔ゎ
for small. Returns `null` when the modifier doesn't apply.

`kanaKeyLabel(ch)` → romaji label for a key (し → `shi`, ゃ → `ya`, っ → `tsu`, ー → `-`).

---

## 4. Word bank — `data/words.json`

Built by `npm run build:words` (`scripts/build-wordbank.mjs`, re-runnable, caches downloads in
`.cache/`). Loaded once into memory by the server. Format:

```jsonc
{
  "meta": {
    "version": 1,
    "generatedAt": "2026-11-14T…Z",
    "source": { "name": "JMdict (common entries) via jmdict-simplified", "version": "3.6.2+20261109214828",
                "dictDate": "2026-11-09", "license": "CC BY-SA 4.0",
                "url": "https://www.edrdg.org/jmdict/j_jmdict.html",
                "attribution": "This app uses the JMdict dictionary files, the property of the Electronic Dictionary Research and Development Group, used in conformance with the Group's licence (CC BY-SA 4.0)." },
    "jlptSource": { "name": "JLPT vocabulary lists by Jonathan Waller (tanos.co.uk) via stephenmk/yomitan-jlpt-vocab",
                    "license": "CC BY", "url": "https://github.com/stephenmk/yomitan-jlpt-vocab" },   // or null
    "counts": { "total": 0, "hiragana": 0, "katakana": 0,
                "byLevel": { "1": 0, "2": 0, "3": 0 },
                "byPos": { "noun": 0, "verb": 0, "adjective": 0, "adverb": 0, "expression": 0, "other": 0 },
                "byJlpt": { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 } }
  },
  "words": [
    {
      "id": "1467640",                 // JMdict entry id (string, unique)
      "kana": "ねこ",                   // expected answer
      "script": "hiragana",            // 'hiragana' | 'katakana'
      "romaji": "neko",                // toRomaji(kana)
      "kanji": ["猫"],                  // common written forms (≤ 3), may be []
      "usuallyKana": false,            // JMdict 'uk' on the first kept sense
      "senses": [ { "pos": ["Noun"], "gloss": ["cat (esp. the domestic cat, Felis catus)", "feline"], "info": [] } ],
      "posCategory": "noun",           // noun | verb | adjective | adverb | expression | other
      "origin": [ { "lang": "Dutch", "text": "koffie", "wasei": false } ],   // loanword source(s), may be []
      "jlpt": 5,                       // 5..1 or null
      "level": 1,                      // analyzeKana(kana).level
      "len": 2,
      "features": []                   // analyzeKana(kana).features
    }
  ]
}
```
Write one word per line (diff-friendly). Target size ≤ 8 MB.

**Build rules**
1. Source: latest `jmdict-eng-common-*.json.tgz` from GitHub releases of `scriptin/jmdict-simplified`
   (`https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest`), falling back to
   `https://github.com/scriptin/jmdict-simplified/releases/download/3.6.2%2B20261109214828/jmdict-eng-common-3.6.2%2B20261109214828.json.tgz`.
   Fields: `words[].id, kanji[{common,text,tags}], kana[{common,text,tags,appliesToKanji}],
   sense[{partOfSpeech, appliesToKanji, appliesToKana, misc, info, languageSource[{lang,full,wasei,text}], gloss[{lang,text}]}]`.
   Extract the tgz in Node (zlib + a minimal tar reader) or via the `tar` CLI.
2. JLPT: `https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/main/original_data/n{1..5}.csv`
   (`jmdict_seq,kana,kanji,waller_definition`). Match **by `jmdict_seq` = JMdict id**. A word in
   several lists gets the easiest level (largest N). If unreachable, `jlpt: null` everywhere and
   `meta.jlptSource: null`.
3. Primary kana = first kana element with `common === true` whose tags contain none of
   `ok, sk, ik, rk`. Skip the entry if none.
4. `script = detectScript(kana)`; keep only `'hiragana'` or `'katakana'`.
5. Exclude kana that: contains any of ゐゑヰヱゎヮヵヶゕゖぢづヂヅをヲゝゞヽヾ・＝ or non-kana; is
   hiragana containing ー, ゔ or small ぁぃぅぇぉ; starts with ー, a small kana, っ/ッ or ん/ン; ends with
   っ/ッ; has length > 9; has length < 2 unless JLPT N5/N4; is in the blocklist
   `['こんにちは', 'こんばんは']` (particle は read "wa").
6. Senses: keep those whose `appliesToKana` is `['*']` or includes the kana; drop senses whose `misc`
   contains any of `arch, obs, vulg, X, sens, derog, rare, dated`. Skip the entry if none remain.
   Keep ≤ 3 senses, ≤ 4 English glosses each. `pos` = friendly labels (e.g. `n` → "Noun",
   `v5r` → "Godan verb (-ru)", `v1` → "Ichidan verb", `vt` → "Transitive", `vi` → "Intransitive",
   `vs` → "Suru verb", `adj-i` → "I-adjective", `adj-na` → "Na-adjective", `adj-no` → "No-adjective",
   `adv` → "Adverb", `int` → "Interjection", `exp` → "Expression", …). `info` = sense `info` strings.
7. `posCategory` from the first kept sense codes: `n, n-adv, n-t, pn, num, vs` (alone) → noun;
   any `v1/v5*/vk/vz/vs-i/vs-s/v1-s` → verb; `adj-*` → adjective; `adv, adv-to` → adverb;
   `exp, int` → expression; else other. **Skip** entries whose first kept sense POS codes are all in
   `prt, aux, aux-v, aux-adj, conj, cop, suf, pref, n-suf, n-pref, ctr, unc`.
8. `kanji` = kanji element texts without tags `sK, iK, oK, rK` (≤ 3, common ones first).
9. `origin` from the first kept sense's `languageSource` (≤ 2), language codes mapped to English
   names (eng English, dut Dutch, ger German, fre French, por Portuguese, ita Italian, spa Spanish,
   rus Russian, chi Chinese, kor Korean, lat Latin, gre Greek, …; unknown → code). `text` may be
   `null`. `wasei: true` means Japanese-coined ("wasei-eigo").
10. `romaji`, `level`, `len`, `features` from `shared/kana.js`.
11. Homophones (same kana, different entries) are all kept.
12. Print summary counts and 40 random sample words with romaji when done.

---

## 5. Database (SQLite via `node:sqlite`)

`server/db.js` opens `config.dbPath` (`:memory:` allowed for tests), sets
`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`, and migrates using
`PRAGMA user_version`. Provide a `tx(fn)` helper (`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`).

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE COLLATE NOCASE,          -- NULL for guests
  display_name TEXT NOT NULL,
  password_hash TEXT,                        -- NULL for guests
  is_guest INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',       -- JSON, see §7.1
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                       -- sha256 hex of the raw token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, user_agent TEXT
);
CREATE TABLE tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  config TEXT NOT NULL,                      -- JSON TestConfig
  status TEXT NOT NULL DEFAULT 'active',     -- active | completed | closed
  total_questions INTEGER NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0, wrong_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  hint1_count INTEGER NOT NULL DEFAULT 0, hint2_count INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0,
  time_spent_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE test_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,                 -- 0-based
  word_id TEXT NOT NULL,
  kana TEXT NOT NULL, romaji TEXT NOT NULL, script TEXT NOT NULL,   -- snapshot of the word
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | correct | wrong | skipped
  user_answer TEXT,                          -- normalized
  error_type TEXT,                           -- null | empty | script | spelling | skipped
  hint1_used INTEGER NOT NULL DEFAULT 0,
  hint2_used INTEGER NOT NULL DEFAULT 0,
  hint2_from INTEGER, hint2_revealed INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  time_ms INTEGER NOT NULL DEFAULT 0,
  answered_at TEXT,
  UNIQUE (test_id, position)
);
CREATE TABLE vocab_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, wrong INTEGER NOT NULL DEFAULT 0,
  last_result TEXT,                          -- correct | wrong | skipped
  last_seen_at TEXT, starred INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, word_id)
);
CREATE TABLE char_stats (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  char TEXT NOT NULL, script TEXT NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0, wrong INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, char)
);
-- plus sensible indexes: sessions(user_id), tests(user_id, updated_at), test_questions(test_id, position), test_questions(answered_at)
```

Startup housekeeping: delete expired sessions; delete guest users with no live session whose
`updated_at` is older than 30 days.

---

## 6. Auth & security

- **Passwords:** `crypto.scrypt` (N=16384, r=8, p=1, keylen 64, 16-byte random salt). Stored as
  `scrypt$16384$8$1$<saltB64>$<hashB64>`. Verify with `timingSafeEqual`. When the email is unknown,
  still run scrypt against a dummy hash (no timing-based user enumeration).
- **Sessions:** raw token = 32 random bytes, base64url, in cookie **`hk_sid`**; DB stores its
  sha256 hex. Cookie: `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` when `config.cookieSecure`.
  `remember: true` → `Max-Age` 30 days and server expiry 30 days; `remember: false` → session
  cookie and server expiry 24 h. Guests → 365 days. `last_seen_at` updated at most once per 5 min.
- **CSRF:** every non-GET/HEAD/OPTIONS request under `/api` must carry
  `X-Requested-With: HiraKata` and, if an `Origin` header is present, it must match the request's
  own origin → else `403 FORBIDDEN`. (`SameSite=Lax` is the second layer.)
- **Rate limits (in-memory):** `/api/auth/login|register|guest|upgrade`: 30 requests / 10 min / IP;
  login failures: 8 / 15 min per IP+email → `429 RATE_LIMITED` with `Retry-After`.
- **Validation:** email trimmed, lowercased, ≤ 254 chars, `^[^\s@]+@[^\s@]+\.[^\s@]+$`;
  password 8–128 chars; displayName 1–40 chars after trim, no control characters.
- **Headers on every response:** `Content-Security-Policy: default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:;
  img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob: data:; object-src 'none';
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
  `Cross-Origin-Opener-Policy: same-origin`. **No inline `<script>` anywhere** (CSP).
- JSON body limit 64 kb. Unknown `/api/*` → `404 NOT_FOUND` JSON. Never leak stack traces when
  `NODE_ENV=production`.
- Every test/question/vocab lookup is scoped by `user_id` — another user's test id returns `404`.

---

## 7. REST API

All JSON. Errors: `{ "error": { "code": "…", "message": "Human readable", "fields": { "email": "…" } } }`
with codes `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFLICT` (409), `TEST_NOT_ACTIVE` (409), `QUESTION_NOT_CURRENT` (409), `NOT_ENOUGH_WORDS` (422),
`NO_REVIEW_WORDS` (422), `RATE_LIMITED` (429), `SERVER_ERROR` (500).

### 7.1 Types

```jsonc
// User
{ "id": 1, "email": "a@b.com", "displayName": "Atrajit", "isGuest": false, "createdAt": "ISO",
  "settings": { "theme": "system", "kanaFont": "textbook", "sound": true, "autoSpeak": false,
                "showRomajiOnKeys": false, "romajiInput": false, "autoAdvance": false,
                "keyboardVisible": true } }
// settings value domains: theme system|light|dark; kanaFont textbook|gothic; the rest booleans.

// TestConfig
{ "script": "mixed", "level": "all", "pos": "any", "jlpt": "any", "count": 20,
  "source": "random", "sourceTestId": null }
// script hiragana|katakana|mixed; level "all"|1|2|3; pos any|noun|verb|adjective|adverb|expression;
// jlpt "any"|5|4|3|2|1; count 5..100; source random|review|test-mistakes.

// TestSummary
{ "id": 12, "title": "Mixed · All levels · 20 words", "status": "active",
  "config": TestConfig,
  "totalQuestions": 20, "answeredCount": 7, "currentIndex": 7,
  "score": 560, "maxScore": 2000, "answeredMaxScore": 700,
  "correctCount": 5, "wrongCount": 1, "skippedCount": 1,
  "hint1Count": 2, "hint2Count": 1,
  "accuracy": 0.714, "scorePercent": 0.8, "grade": "A",      // grade null when nothing answered
  "currentStreak": 2, "bestStreak": 4, "timeSpentMs": 123456,
  "createdAt": "ISO", "updatedAt": "ISO", "finishedAt": null }

// WordInfo (words.json word + derived fields)
{ "id": "1049180", "kana": "コーヒー", "romaji": "kōhī", "script": "katakana",
  "kanji": ["珈琲"], "usuallyKana": true,
  "senses": [ { "pos": ["Noun"], "gloss": ["coffee"], "info": [] } ],
  "meaning": "coffee",                 // first sense glosses joined with "; "
  "posCategory": "noun", "origin": [ { "lang": "English", "text": "coffee", "wasei": false } ],
  "jlpt": 5, "level": 2, "features": ["long"],
  "homophones": [ { "id": "…", "kanji": "紙", "meaning": "paper" } ] }   // same kana, ≤ 3

// QuestionPublic — a pending question (never contains the answer unless hint 2 was used)
{ "id": 345, "position": 7, "status": "pending", "romaji": "kōhī",
  "hint1Used": false, "hint2Used": false,
  "script": null,        // "hiragana"|"katakana" once hint 1 was used
  "answer": null }       // full expected kana once hint 2 was used (client does the live check)

// QuestionResult — an answered question
{ "id": 345, "position": 7, "status": "correct",     // correct | wrong | skipped
  "romaji": "kōhī", "expected": "コーヒー", "script": "katakana", "userAnswer": "コーヒー",
  "errorType": null,      // null | empty | script | spelling | skipped
  "points": 80, "hint1Used": true, "hint2Used": false, "hint2Revealed": 0, "timeMs": 5400,
  "diff": [ { "op": "match", "expected": "コ", "actual": "コ" } ],
  "word": WordInfo,
  "answeredAt": "ISO" }

// QuestionStub — compact entry for progress dots
{ "id": 345, "position": 7, "status": "pending" }
```

### 7.2 Endpoints

**Auth**
| Method & path | Body | Response |
|---|---|---|
| `POST /api/auth/register` | `{displayName,email,password}` | `201 {user}` + cookie; `409 CONFLICT` if email taken |
| `POST /api/auth/login` | `{email,password,remember}` | `200 {user}` + cookie; `401 UNAUTHORIZED` "Email or password is incorrect." |
| `POST /api/auth/guest` | `{}` | `201 {user}` (guest, displayName "Guest") + cookie |
| `POST /api/auth/upgrade` | `{displayName,email,password}` | `200 {user}` — guest → full account, same id & data |
| `POST /api/auth/logout` | `{}` | `204`, cookie cleared, session deleted |
| `GET /api/auth/me` | — | `200 {user}` or `401` |
| `PATCH /api/auth/me` | `{displayName?, settings?}` (partial settings merged, unknown keys rejected) | `200 {user}` |
| `POST /api/auth/password` | `{currentPassword,newPassword}` | `204`; other sessions revoked |
| `DELETE /api/auth/me` | `{password}` (guests: `{}`) | `204`; account + all data deleted, cookie cleared |
| `DELETE /api/progress` | `{password}` (guests: `{}`) | `204`; deletes tests, vocab_progress, char_stats (fresh start) |

**Words (public)**
| `GET /api/words/meta` | → `{ total, byScript:{hiragana,katakana}, byLevel:{1,2,3}, byPos:{…}, jlptAvailable, byJlpt:{5..1}, source:{name,version,license,url,attribution}, jlptSource }` |
|---|---|
| `GET /api/words/count?script=&level=&pos=&jlpt=` | → `{ count }` (same filters as TestConfig) |
| `GET /api/words/sample?n=8` | → `{ words: WordInfo[] }` random, n ≤ 20 (landing page demo) |

**Tests** (auth required)
| Method & path | Body | Response |
|---|---|---|
| `GET /api/tests?status=all\|active\|completed\|closed` | — | `{ tests: TestSummary[] }` newest `updated_at` first |
| `POST /api/tests` | `{title?, ...TestConfig}` | `201 { test: TestSummary, current: QuestionPublic }` |
| `GET /api/tests/:id` | — | `{ test, questions: (QuestionResult \| QuestionStub & {romaji})[] }` — answered ones full |
| `GET /api/tests/:id/state` | — | `{ test, questions: QuestionStub[], current: QuestionPublic \| null, lastResult: QuestionResult \| null }` |
| `POST /api/tests/:id/questions/:qid/hint` | `{type:"script"\|"spelling"}` | `{ question: QuestionPublic }` (idempotent) |
| `POST /api/tests/:id/questions/:qid/answer` | `{answer, timeMs, hint2From?, hint2Revealed?}` | `AnswerResponse` |
| `POST /api/tests/:id/questions/:qid/skip` | `{timeMs}` | `AnswerResponse` |
| `POST /api/tests/:id/close` | `{}` | `{ test }` (idempotent; active → closed) |
| `PATCH /api/tests/:id` | `{title}` (1–80 chars) | `{ test }` |
| `DELETE /api/tests/:id` | — | `204` |
| `GET /api/tests/:id/report.pdf` | — | PDF, `Content-Disposition: attachment; filename="hirakata-test-<id>-<yyyy-mm-dd>.pdf"` |

`AnswerResponse = { result: QuestionResult, test: TestSummary, next: QuestionPublic | null, completed: boolean }`

Rules:
- Answer/skip/hint only for the **current** question (`position === current_index`, status
  `pending`) of an **active** test → else `409 QUESTION_NOT_CURRENT` / `409 TEST_NOT_ACTIVE`.
- `answer` ≤ 64 chars; `timeMs` clamped to 0..3 600 000. `hint2From` (0..len) and
  `hint2Revealed` (0..len) are honoured only if hint 2 was used for that question; if hint 2 was
  used and `hint2Revealed` is missing, assume `len − (hint2From ?? 0)`.
- The last answer of a test sets `status = 'completed'`, `finished_at`, `completed: true`,
  `next: null`.
- Creating: `source: 'review'` uses the user's words with `last_result IN ('wrong','skipped')`
  (most-missed first; script filter applies; level/pos/jlpt ignored); `source: 'test-mistakes'`
  uses the wrong/skipped words of `sourceTestId` (must belong to the user). `count` is reduced to
  what is available; none → `422 NO_REVIEW_WORDS`. Random pools with < 1 word → `422 NOT_ENOUGH_WORDS`;
  smaller than `count` → use all.
- Default titles: `"Mixed · All levels · 20 words"`, `"Katakana · Beginner · 10 words"`,
  `"Hiragana · JLPT N5 · 20 words"`, `"Review · 12 words"`, `"Retry · <source title>"`.

**Word selection (random source)**
1. Pool = bank filtered by script/level/pos/jlpt.
2. `mixed`: hiragana target = `ceil(count/2)`, katakana = rest; shortfalls are filled from the
   other script. Final order shuffled.
3. Weighted sampling without replacement (Efraimidis–Spirakis): weight ×3 if the user has never
   seen the word, ×2 if `jlpt !== null` (only when the jlpt filter is `"any"`).
4. Never two questions with the same kana in one test.

**Stats & vocab** (auth required)
| `GET /api/stats/overview?tz=<getTimezoneOffset() minutes>&days=<7..371, default 182>` | → `StatsOverview` |
|---|---|
| `GET /api/vocab?filter=all\|learned\|review\|starred&script=all\|hiragana\|katakana&q=&sort=recent\|alpha\|mistakes&page=1&pageSize=24` | → `{ items: [{ word: WordInfo, progress: { seen, correct, wrong, lastResult, lastSeenAt, starred } }], total, page, pageSize, counts: { all, learned, review, starred } }` |
| `POST /api/vocab/:wordId/star` `{starred}` | → `{ starred }` |
| `GET /api/reports/overall.pdf?tz=` | PDF `hirakata-progress-<yyyy-mm-dd>.pdf` |

`q` matches kana, romaji, kanji or meaning (case-insensitive substring).

```jsonc
// StatsOverview
{
  "totals": { "tests": 5, "activeTests": 1, "completedTests": 3, "closedTests": 1,
              "answered": 120, "correct": 98, "wrong": 15, "skipped": 7,
              "accuracy": 0.816, "cleanCorrect": 80, "cleanAccuracy": 0.667,
              "score": 9000, "timeSpentMs": 3600000, "hint1Used": 10, "hint2Used": 6,
              "wordsSeen": 110, "wordsLearned": 90, "wordsToReview": 12 },
  "byScript": { "hiragana": { "answered": 70, "correct": 60, "accuracy": 0.857 },
                "katakana": { "answered": 50, "correct": 38, "accuracy": 0.76 } },
  "byLevel": { "1": { "answered": 0, "correct": 0, "accuracy": 0 }, "2": {…}, "3": {…} },
  "streak": { "current": 3, "best": 7, "todayAnswered": 12, "lastActiveDate": "2026-11-14" },
  "daily": [ { "date": "2026-05-17", "answered": 0, "correct": 0, "score": 0 } ],   // `days` entries, oldest → today (local)
  "last7": { "answered": 40, "accuracy": 0.85 }, "prev7": { "answered": 22, "accuracy": 0.78 },
  "recentTests": [ TestSummary ],            // ≤ 5 by updated_at
  "accuracyTrend": [ { "testId": 3, "title": "…", "date": "ISO", "accuracy": 0.8, "scorePercent": 0.74, "answered": 20 } ],  // ≤ 20 tests with answers, oldest → newest
  "charStats": [ { "char": "ツ", "script": "katakana", "correct": 2, "wrong": 5 } ],     // every char seen
  "weakChars": [ { "char": "ツ", "script": "katakana", "correct": 2, "wrong": 5, "accuracy": 0.286 } ]  // ≤ 10, attempts ≥ 2, accuracy asc then wrong desc
}
```

---

## 8. Scoring, grading and statistics

Per question (max **100**):
```
wrong / skipped / empty → 0
correct → penalty = (hint1Used ? 20 : 0)
                  + (hint2Used ? max(10, round(60 * hint2Revealed / len)) : 0)
          points  = max(10, 100 − penalty)
```
- *Clean* correct = correct with no hints. Streak = consecutive correct answers (assisted ones
  count); wrong/skip resets it. `bestStreak` = max.
- `answered = correct + wrong + skipped`; `accuracy = correct / answered` (0 if none);
  `answeredMaxScore = answered × 100`; `scorePercent = score / answeredMaxScore`;
  `maxScore = totalQuestions × 100`.
- **Grade** from `scorePercent`: ≥ 0.95 **S** (秀), ≥ 0.85 **A** (優), ≥ 0.70 **B** (良),
  ≥ 0.50 **C** (可), else **D** (不可). `null` when nothing answered.
- **vocab_progress** upsert on every answer/skip: `seen+1`, `correct+1` or `wrong+1` (skips count
  as wrong), `last_result`, `last_seen_at`.
- **char_stats** on correct/wrong answers whose `errorType` is not `script`/`empty`: for each
  `charOutcomes(expected, userAnswer)` entry with index `< hint2From` (all indexes if hint 2 unused),
  increment `correct` or `wrong` for that kana char (`script` from `detectScript(char)`; ー counts as
  katakana).
- wordsLearned = vocab rows with `correct > 0`; wordsToReview = rows with `last_result` wrong or
  skipped; wordsSeen = all rows.
- Daily buckets and streaks use the client's `tz` offset (`local = utc − tz minutes`). The current
  streak counts back from today, or from yesterday if nothing was answered today.

---

## 9. PDF reports — `server/report/pdf.js`

```js
export async function renderTestReport(data /* TestReportData */) { /* → Promise<Buffer> */ }
export async function renderOverallReport(data /* OverallReportData */) { /* → Promise<Buffer> */ }
```
```jsonc
// TestReportData (assembled by the backend in server/services/reportData.js)
{ "generatedAt": "ISO", "tzOffset": -540,
  "user": { "displayName": "Atrajit", "email": "a@b.com", "isGuest": false },
  "test": TestSummary,
  "questions": [ QuestionResult | { "id": 1, "position": 3, "status": "pending", "romaji": "neko" } ],
  "byScript": { "hiragana": { "answered": 5, "correct": 4, "accuracy": 0.8 }, "katakana": { … } },
  "weakChars": [ { "char": "ツ", "script": "katakana", "correct": 0, "wrong": 2, "accuracy": 0 } ],
  "source": { "attribution": "…", "jlptAttribution": "…" } }

// OverallReportData
{ "generatedAt": "ISO", "tzOffset": -540, "user": { … },
  "overview": StatsOverview,
  "tests": [ TestSummary ],
  "vocab": { "learned": [ { "word": WordInfo, "progress": { … } } ], "review": [ … ] },   // ≤ 60 each
  "source": { … } }
```
Content (A4, Noto Sans JP regular/bold embedded from `server/report/fonts/`, which must cover
Latin-1, Latin Extended-A (ā ī ū ē ō), punctuation, kana and all kanji in `words.json`):
- Branded header (HiraKata wordmark + "Practice report"), learner, dates, test config, status.
- Summary tiles: score/max, grade (with 秀/優/良/可/不可), accuracy, correct/wrong/skipped,
  hints used, time, best streak.
- Hiragana vs katakana accuracy bars (vector drawing).
- Question table: #, romaji, correct kana, learner's answer (wrong chars highlighted when
  feasible), result (○ correct / × wrong / – skipped), points, hints, meaning (truncated). Repeat
  the table header on new pages. Pending questions listed as "not answered".
- "Words to review" (wrong/skipped with kanji + meaning) and "Kana to practise" (weak chars).
- Overall report: all-time totals, 30-day activity bars, tests table, weak kana, learned words and
  words to review.
- Footer on every page: page x / y and the JMdict (+ JLPT) attribution.

---

## 10. Frontend architecture

`public/index.html` (no inline scripts):
```html
<html lang="en"> <head> … Google Fonts link (Inter 400–800, Klee One 400/600, Noto Sans JP 400/500/700),
  <script src="/js/theme-init.js"></script>  (sync, sets data-theme / data-kana-font from localStorage before paint)
  all CSS files: tokens, base, components, layout, landing, auth, settings, dashboard, practice, results, vocab
  <script type="module" src="/js/main.js"></script> </head>
<body><div id="app"><header id="topbar"></header><main id="view" tabindex="-1"></main><footer id="footer"></footer></div>
  <div id="toast-root" aria-live="polite"></div><div id="modal-root"></div><canvas id="fx-canvas" aria-hidden="true"></canvas></body>
```
Static serving: `/` → `public/`, `/shared/` → `shared/`. SPA uses **hash routing**, so the server
only needs to serve `index.html` at `/`.

### 10.1 Router (`public/js/router.js`)
Routes: `/` landing (public), `/login`, `/register` (public), `/dashboard`, `/practice/:id`,
`/results/:id`, `/vocab`, `/settings` (auth), fallback `notfound`. Hash format
`#/path?query`. Pages are loaded lazily with `import()`.

Every page module **default-exports**:
```js
export default {
  title: 'Dashboard',            // or (ctx) => string
  layout: 'app',                 // 'public' | 'app' | 'focus' (focus = no topbar/footer; page draws its own header)
  auth: true,                    // redirect to /login?next=… when logged out
  publicOnly: false,             // redirect full (non-guest) users to /dashboard
  async render(root, ctx) {      // ctx = { params, query, user, navigate, store, api }
    // build DOM inside root; return an optional cleanup function
  },
};
```
`navigate(path, { replace })` changes the hash. The router calls the previous page's cleanup,
clears `#view`, runs a short fade/slide transition, sets `document.title = "<title> · HiraKata"`,
and moves focus to `#view`. `/dashboard?new=1` opens the New-test dialog (used by other pages).
A guest user visiting `/register` sees the **upgrade** variant ("Save your progress").

### 10.2 API client (`public/js/api.js`)
```js
export class ApiError extends Error { /* status, code, message, fields */ }
export async function request(method, path, body)  // JSON; headers Accept + Content-Type + X-Requested-With: HiraKata; credentials 'same-origin'
export const api = {
  auth:   { me, register, login, guest, upgrade, logout, updateMe, changePassword, deleteAccount, resetProgress },
  tests:  { list, create, get, state, hint(id, qid, type), answer(id, qid, payload), skip(id, qid, payload),
            close, rename(id, title), remove, reportUrl(id) },
  stats:  { overview({ tz, days }) },
  vocab:  { list(params), star(wordId, starred) },
  words:  { meta, count(params), sample(n) },
  reports:{ overallUrl({ tz }) },
};
```
A `401` from any call (except `auth.me`/`login`) dispatches `window` event `hk:unauthorized`;
`main.js` clears the user and routes to `/login?next=…`.

### 10.3 Store (`public/js/store.js`)
`store.user`, `store.settings` (user settings or defaults), `store.setUser(u)`,
`store.updateSettings(patch)` (applies immediately, persists via `PATCH /api/auth/me`, debounced
400 ms), `store.subscribe(fn) → unsubscribe`. Theme: `html[data-theme="light|dark"]` (absent =
system) and `localStorage['hk-theme']`; kana font: `html[data-kana-font="gothic"]` and
`localStorage['hk-kana-font']`.

### 10.4 Shared UI modules (`public/js/ui/`) — built by foundation, used by everyone
- `dom.js`: `h(tag, props, ...children)` (props: `class`, `style` object, `dataset`, `attrs`,
  `on: {click: fn}`, plus direct properties; string children become text nodes — never innerHTML),
  `svg(tag, attrs, ...children)`, `clear(el)`, `qs/qsa`, `debounce`, `animateNumber(el, from, to,
  {duration, format})`, `prefersReducedMotion()`.
- `icons.js`: `icon(name, { size = 20, stroke = 2, className })` → SVG element (Lucide-style 24×24
  strokes, hand-written). Names: check, x, arrow-right, arrow-left, plus, trash, download, log-out,
  settings, user, book, chart, flame, clock, lightbulb, eye, eye-off, volume, volume-off, keyboard,
  sun, moon, monitor, star, star-filled, refresh, play, more, edit, close, info, sparkles, trophy,
  target, search, filter, menu, chevron-down, chevron-right, home, wand, type, help, shield,
  delete-left, list, grid, calendar, award, check-circle, x-circle, skip-forward, flag, external.
- `toast.js`: `toast(message, { type: 'info'|'success'|'error', timeout = 3500, action })`.
- `modal.js`: `openModal({ title, body, actions: [{label, variant, onClick, autofocus}], size,
  dismissible, onClose })` → `{ el, close }` (native `<dialog>`, animated);
  `confirmDialog({ title, message, confirmLabel, cancelLabel, danger }) → Promise<boolean>`;
  `promptDialog({ title, message, label, type, placeholder, confirmLabel }) → Promise<string|null>`.
- `menu.js`: `attachMenu(button, items: [{ label, icon, onClick, href, download, danger, divider }])`.
- `confetti.js`: `burst({ x, y, count = 80, spread = 70, colors })`, `burstFrom(el, opts)`,
  `celebrate()` (full screen). No-ops under reduced motion.
- `sound.js`: `play('correct'|'wrong'|'tap'|'hint'|'complete'|'streak')` — synthesized with
  WebAudio (no assets), respects `store.settings.sound`.
- `tts.js`: `canSpeak()`, `speak(text, { rate })` — `speechSynthesis`, `ja-JP` voice.
- `format.js`: `percent(0.857) → "86%"`, `number`, `compact`, `duration(ms) → "4m 12s"`,
  `date(iso)`, `relative(iso) → "2 hours ago"`, `localDateKey(date)`.
- `word-card.js`: `renderWordCard(word: WordInfo, { size: 'lg'|'md'|'sm', showListen = true })` →
  element: kana (kana font) + script chip, romaji, kanji line ("Kanji: 猫" or "Usually written in
  kana"), numbered senses with POS chips, origin line ("From English 'coffee'"; wasei-eigo note),
  JLPT chip, homophones line, Listen button (hidden when TTS unavailable).
- `answer-diff.js`: `renderAnswerDiff(diff, { show: 'actual'|'expected' })` → element rendering
  each op as a kana tile: match (neutral/success), sub (danger), ins (danger, struck through),
  del (dashed empty slot in `actual` view / highlighted in `expected` view); includes an
  accessible text summary.
- `brand.js`: `logoMark({ size })` (rounded square, あ and ア split diagonally in the hiragana-blue
  and katakana-orange), `wordmark()`.
- `kana-bg.js`: subtle animated floating-kana background for landing/auth (reduced-motion aware).

---

## 11. Visual design system

**Art direction — "modern Japanese stationery":** warm paper backgrounds, ink text, indigo (藍)
primary, vermilion (朱) reserved for the brand mark and the hanko grade seal, generous whitespace,
soft layered shadows, 12–20 px radii. Kana are the hero: large, set in **Klee One** (a
textbook/handwriting style that shows real stroke shapes), switchable to Noto Sans JP. Motion is
quick (150–320 ms) with spring easing reserved for celebration. Everything must look deliberate
and premium in **both light and dark mode** and at **390 px mobile width**.

`public/css/tokens.css` defines (light on `:root`; dark under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` **and**
`:root[data-theme="dark"] {…}`):

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f6f5f1` | `#0d0d0d` |
| `--surface-1` (cards) | `#ffffff` | `#1a1a19` |
| `--surface-2` | `#fbfaf7` | `#212120` |
| `--surface-3` | `#f0eee8` | `#2a2a28` |
| `--border` | `rgba(11,11,11,.10)` | `rgba(255,255,255,.10)` |
| `--border-strong` | `rgba(11,11,11,.18)` | `rgba(255,255,255,.18)` |
| `--text-primary` | `#1b1a17` | `#f0efec` |
| `--text-secondary` | `#52514e` | `#c3c2b7` |
| `--text-muted` | `#6f6d68` | `#9a998f` |
| `--brand-50…900` | indigo ramp `#eef0ff #e0e4ff #c7cdfe #a5affc #818cf8 #6366f1 #4f46e5 #4338ca #3730a3 #312e81` | same ramp; buttons use 500/400 |
| `--brand` / `--brand-contrast` | `#4f46e5` / `#ffffff` | `#6d72f3` / `#ffffff` |
| `--accent` (vermilion) | `#d13c2f` | `#e5533f` |
| `--hira` / `--hira-soft` | `#2a78d6` / `rgba(42,120,214,.12)` | `#3987e5` / `rgba(57,135,229,.18)` |
| `--kata` / `--kata-soft` | `#eb6834` / `rgba(235,104,52,.12)` | `#d95926` / `rgba(217,89,38,.20)` |
| `--success` / `--success-text` / `--success-soft` | `#0ca30c` / `#006300` / `rgba(12,163,12,.12)` | `#0ca30c` / `#3fcf6a` / `rgba(12,163,12,.18)` |
| `--danger` / `--danger-text` / `--danger-soft` | `#d03b3b` / `#b42323` / `rgba(208,59,59,.10)` | `#e66767` / `#f08b8b` / `rgba(230,103,103,.16)` |
| `--warning` | `#fab219` (text on it `#0b0b0b`) | `#fab219` |
| `--chart-grid` / `--chart-axis` / `--chart-muted` | `#e1e0d9` / `#c3c2b7` / `#898781` | `#2c2c2a` / `#383835` / `#898781` |
| `--seq-100…700` (blue ramp) | `#cde2fb #b7d3f6 #9ec5f4 #86b6ef #6da7ec #5598e7 #3987e5 #2a78d6 #256abf #1c5cab #184f95 #104281 #0d366b` (steps 100,150,…,700) | same |

Also: `--font-ui: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;`
`--font-jp: "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;`
`--font-kana: "Klee One", var(--font-jp);` (`[data-kana-font="gothic"]` → `var(--font-jp)`),
radii `--r-sm 8px --r-md 12px --r-lg 16px --r-xl 24px --r-pill 999px`, shadows
`--shadow-1/2/3` (soft, layered; stronger + subtle glow in dark), spacing `--s-1…--s-10`
(4,8,12,16,20,24,32,40,48,64), motion `--ease-out cubic-bezier(.22,1,.36,1)`,
`--ease-spring cubic-bezier(.34,1.56,.64,1)`, `--dur-1 120ms --dur-2 200ms --dur-3 320ms --dur-4 500ms`.
`prefers-reduced-motion: reduce` collapses non-essential animation.

`components.css` classes (foundation): `.btn` (+ `.btn-primary .btn-secondary .btn-ghost .btn-danger
.btn-success .btn-sm .btn-lg .btn-icon .is-loading`), `.card .card-header .card-title
.card-subtitle .card-body`, `.field .label .input .help .error-text .input-group`, `.switch`,
`.segmented`, `.chip` (+ `.chip-hira .chip-kata .chip-success .chip-danger .chip-brand
.chip-neutral`), `.grade-badge[data-grade]`, `.progress .progress-bar`, `.tabs .tab`, `.menu
.menu-item`, `.modal…`, `.toast…`, `[data-tip]` tooltips, `.table`, `.empty-state`, `.kbd`,
`.spinner`, `.stat-tile .stat-label .stat-value .stat-delta`, `.word-card…`, `.answer-diff…`,
`.container`, `.page-header`, `.visually-hidden`.

**Charts** (dashboard/results) follow the data-viz rules in
`C:\Users\atraj\AppData\Local\Temp\claude\bundled-skills\2.1.318\839746066e2f928d072fc506726b357f\dataviz\`
(read `SKILL.md` and `references/*.md`): hand-built SVG, thin marks, 2 px lines, hairline grids,
text in text tokens (never series colour), tooltip on hover **and focus**, a table view per chart,
legend for ≥ 2 series, hiragana = series slot 1 (blue), katakana = slot 2 (orange), sequential =
blue ramp. Validate palettes with `node <dataviz>/scripts/validate_palette.js`.

---

## 12. Pages

### 12.1 Landing (`/`, public) — foundation
Hero: "Write Japanese, one word at a time." Animated demo card (romaji "kōhī" → kana コーヒー typed in,
✓ check, meaning slides in), CTA **Create free account**, **Log in**, **Try as guest**. Feature grid
(Smart hints, Guided live spelling, Vocabulary with meanings, Dashboard analytics, PDF reports,
Kana mastery). "How it works" (3 steps). Footer with attribution. Logged-in users → `/dashboard`.

### 12.2 Login / Register — foundation
Split layout: brand panel (floating kana, quote) + form card. Inline validation, password
show/hide, remember me, "Continue as guest". Register → dashboard. Guest on `/register` → upgrade.
`?next=` respected after login.

### 12.3 Dashboard (`/dashboard`) — dashboard engineer
- Greeting ("おかえり, Name" + date), streak chip, primary **New test**, secondary
  **Overall report (PDF)**. Guest banner with "Save your progress" when `user.isGuest`.
- **Continue** strip: active tests with progress ring + Resume.
- KPI row (stat tiles): Words practised, Accuracy (delta vs previous 7 days), Words learned,
  Day streak (best), Time practised.
- Charts: accuracy over recent tests (line + area wash, crosshair tooltip); hiragana vs katakana
  (two meters); activity calendar heatmap (26 weeks, sequential blue + scale legend); **kana mastery
  grid** (gojūon table from `KEYBOARD`, tabs Hiragana/Katakana, cells shaded by accuracy, unseen
  cells neutral, tooltip); weakest kana (ranked bars). Each chart: tooltip, table view toggle,
  empty state.
- **Tests** list: filter tabs All/Active/Completed/Closed; each row: title, config chips, status
  chip, progress bar, score + grade badge, accuracy, relative date; actions Resume/Review, PDF,
  ⋯ (Rename, Delete with confirm).
- **New test dialog** (`openNewTestDialog`): Script (Hiragana / Katakana / Mixed — big segmented
  cards with あ/ア/あア), Difficulty (All/Beginner/Intermediate/Advanced with one-line
  explanations), Words (10/20/30/50 + custom 5–100), Word type, JLPT (hidden if unavailable),
  Source (New words / Review my mistakes — disabled when none), optional title; live
  "N words match" via `/api/words/count`; Start → create → `/practice/:id`.
- First-time empty state: illustration + "Start your first test".

### 12.4 Practice (`/practice/:id`, layout focus) — practice engineer
- **Header:** Exit, title, progress bar "7 / 20", animated score, streak flame, ⋯ menu (Download
  progress PDF, End test, Sound, Romaji on keys, Romaji typing, Show keyboard).
- **Question card:** "Write this word in kana", the romaji large and letter-spaced (letters animate
  in), a help tip explaining the romaji conventions (§3.1).
- **Hints:** `Script hint · −20` → flips in a badge "カタカナ Katakana" / "ひらがな Hiragana".
  `Guide me · up to −60` → guided mode (below). Used hints stay visible; costs shown in tooltips.
- **Answer input:** large kana input (`lang="ja"`, no autocorrect/capitalize/spellcheck) that works
  with a system Japanese IME (ignore Enter while `isComposing`), the on-screen keyboard (inserts at
  the caret, never steals focus), and optional romaji→kana typing (`romajiToKana(…, {ime:true})`
  using the keyboard's current script). If Latin letters are typed while romaji typing is off, show
  an inline tip with a one-click enable. On touch devices with the on-screen keyboard visible use
  `inputmode="none"`.
- **On-screen kana keyboard:** script toggle (あ ひらがな / ア カタカナ), sections Basic / Voiced
  ゛゜ / Small & ー (side by side on wide screens, tabs on narrow), modifier keys ゛ ゜ 小 (apply to
  the char before the caret via `applyModifier`), ⌫, Clear. Optional romaji labels. Keys show
  pressed animation.
- **Guided mode (hint 2):** a strip of boxes, one per expected character: matched → filled green;
  the next expected char → revealed with a pulsing highlight; a wrong typed char → red shake with
  "should be X"; later chars → hidden dots. Updates live on every input. The matching keyboard key
  pulses (or the script toggle / section tab if the char lives elsewhere). When `complete`, auto-check
  after ~350 ms. Track `hint2From` (matched length at activation) and `hint2Revealed` (distinct
  positions revealed) and send them with the answer.
- **Check / Skip:** Enter or button. **Correct:** green glow, SVG check that draws itself,
  "+80" floating up, an encouraging phrase (すごい! Great!, 完璧! Perfect!, いいね! Nice!),
  confetti (bigger for clean answers), sound, score counter animates, streak flame bumps.
  **Wrong:** card shake, red ✕ draws, "Your answer" diff row and "Correct answer" row flipping in,
  error explanation (script → "Right sounds, wrong script — this word is written in katakana.";
  spelling → "Check the highlighted characters."; empty/skip → neutral). Live region announces
  the result.
- **Meaning:** after scoring, the `renderWordCard` slides up ("New word" ribbon when first seen),
  Listen button (auto-speak if enabled). **Next word →** (Enter). `autoAdvance` moves on after
  1.5 s for correct answers.
- **Progress dots** for all questions (pending / correct / wrong / skipped colours).
- **End test** → confirm → `close` → `/results/:id`. Last question → "See results" →
  `/results/:id`. Resume works after reload (state endpoint; hints restored). Inactive test →
  redirect to results. Keyboard shortcuts: Enter (check/next), Alt+1 (script hint), Alt+2 (guide),
  Alt+S (skip), Alt+K (toggle keyboard script). Time per question measured while the tab is visible.

### 12.5 Results (`/results/:id`) — results-vocab engineer
Hanko-style **grade seal** stamping in (vermilion circle with 秀/優/良/可/不可 + letter), animated
score ring (meter), stat tiles (accuracy, correct/wrong/skipped, hints, time, best streak),
hiragana vs katakana meters, then the **question review** list (romaji, expected kana with script
chip, learner's answer via `renderAnswerDiff`, result icon, points, hint icons, meaning; expandable
full `renderWordCard`). Actions: **Download PDF**, **Practice mistakes** (`source:
'test-mistakes'`, disabled if none), **New test** (`/dashboard?new=1`), Dashboard. Active test →
"Resume" banner.

### 12.6 Vocabulary (`/vocab`) — results-vocab engineer
Header with counts; search; filter tabs (All / Learned / Needs review / Starred); script filter;
sort. Responsive grid of word tiles (kana, kanji, romaji, meaning, mastery bar, last result chip,
star, listen) that expand to the full word card. "Load more" pagination. CTA **Practise words that
need review** (creates a `review` test). Empty states.

### 12.7 Settings (`/settings`) — foundation
Profile (display name, email, account type), guest upgrade form, Appearance (theme, kana font),
Practice (sound, auto-speak, romaji on keys, romaji typing, auto-advance, show keyboard), Change
password, Danger zone (Reset progress = fresh start, Delete account). Saves via `store`.

### 12.8 Not found — foundation. Friendly 404 with a big 「？」 and a link home.

---

## 13. Engineer conventions

- Each engineer gets a **port** and a **scratch directory** in their brief. Run the server with
  `PORT=<port> DB_PATH=<scratch>/<name>.db node --disable-warning=ExperimentalWarning server/index.js`
  (background), use `http://127.0.0.1:<port>`, and kill only that PID when done.
- Config env vars: `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (`data/hirakata.db`), `WORDS_PATH`
  (`data/words.json.gz` since v2, §15.1), `NODE_ENV`, `COOKIE_SECURE` (true only if set or production),
  `TRUST_PROXY`.
- `server/app.js` exports `createApp({ config, db, wordbank })` (no listening) for tests;
  `server/index.js` boots and prints the URL.
- UI engineers: take screenshots with `scripts/dev/shot.mjs` (light + dark, 1280 px + `--mobile`),
  **look at them** with the Read tool, and iterate until the page looks professional. Check the
  browser console output the script prints — zero errors expected.
- Accessibility: semantic elements, labels, visible focus rings, `aria-live` for results,
  keyboard operability, contrast ≥ 4.5:1 for text, reduced-motion support.
- Security in UI: build DOM with `h()` / `textContent`; never insert API strings via `innerHTML`.

## 14. Attribution (footer, PDF, README)
"Dictionary data: JMdict © Electronic Dictionary Research and Development Group, used under
CC BY-SA 4.0 · JLPT levels: Jonathan Waller (tanos.co.uk), CC BY, via stephenmk/yomitan-jlpt-vocab."
Fonts: Inter, Klee One, Noto Sans JP (SIL OFL).

---

## 15. Version 2 — full dictionary, listen mode, input methods, handwriting

Everything in sections 0–14 still holds unless changed here. Keep every existing behaviour and test
working; extend, don't rewrite.

### 15.1 Word pool: the whole dictionary
- Build from the **full** `jmdict-eng-<version>.json.tgz` release (all ~210k entries), not only the
  common subset. Primary kana = first kana element whose tags contain none of `ok, sk, ik, rk`
  (prefer a `common` one when the entry has several). All other §4 rules still apply (scripts,
  exclusions, sense filters, POS skip list, blocklist, script-ambiguous-romaji filter computed over
  the whole bank). Additionally drop kanji forms containing characters outside the BMP.
- Each word gains `"common": boolean` (true when the entry has any common kana or kanji element).
  `meta.counts` gains `"common"`. JLPT tagging unchanged.
- Output **`data/words.json.gz`** (gzip of the same JSON layout, one word per line before
  compression); delete `data/words.json`. Budget ≤ 25 MB. `WORDS_PATH` default becomes
  `data/words.json.gz`; the loader accepts `.json.gz` or `.json`.
- TestConfig gains **`pool: 'all' | 'common'`** (default `'all'`). Sampling weight in pool `all`:
  common words ×4 (on top of unseen ×3 and, when the jlpt filter is `"any"`, JLPT ×2).
- `GET /api/words/meta` adds `byPool: { all, common }`; `/api/words/count` accepts `pool`.

### 15.2 Practice modes: romaji → write, listen → write
- TestConfig gains **`mode: 'romaji' | 'listen'`** (default `'romaji'`). Default titles in listen
  mode are prefixed `"Listen · "` (e.g. `"Listen · Mixed · All levels · 20 words"`).
- `QuestionPublic` gains `mode`, `speak` (the kana to pronounce in listen mode, else `null`) and
  `romajiHintUsed`. In listen mode `romaji` is `null` until the romaji hint is used.
- New hint type **`"romaji"`** (listen mode only; romaji mode → `400 VALIDATION_ERROR`) reveals the
  romaji. Stored in `test_questions.hint3_used` (migration v2). `QuestionResult` gains
  `romajiHintUsed`, `inputMethod`, and always includes `romaji`.
- `shared/kana.js` adds `soundKey(kana)` and `compareAnswer(expected, raw, { mode })`.
  `soundKey`: to hiragana; ー → the vowel kana of the previous mora; を→お, づ→ず, ぢ→じ;
  long o `おう`→`おお`, long e `えい`→`ええ` (after any e-column mora). In **listen mode only**, when
  the answer is not exact, is not a script error, has the expected script, and
  `soundKey(answer) === soundKey(expected)`, the result is `{ correct: true, errorType: 'variant' }`
  (same sound, non-standard spelling; the standard spelling is shown).
- Scoring (§8) becomes: `penalty = 20·hint1 + hint2Penalty + 30·romajiHint + 30·variant`,
  `points = max(10, 100 − penalty)` for correct answers. Variants keep the streak and count as
  correct in vocab progress; they are excluded from char_stats (like script errors).
- `StatsOverview` gains `byMode: { romaji: {answered, correct, accuracy}, listen: {…} }` and
  `byInput: { keys: {…}, handwriting: {…}, device: {…} }`.
- Speech is client-side (`speechSynthesis`, `ja-JP`). `public/js/ui/tts.js` adds
  `listJapaneseVoices() → Promise<SpeechSynthesisVoice[]>` (waits ≤ 1.5 s for voices),
  `hasJapaneseVoice() → Promise<boolean>`, `stop()`, and `speak(text, { rate, voiceName })`
  (falls back to the best ja voice). Chrome/Edge ship online Japanese voices; Windows needs the
  Japanese speech pack for offline voices. When no Japanese voice exists, listen mode is disabled in
  the New-test dialog with an explanation, and inside a listen test the romaji hint is offered.

### 15.3 Input methods — the device keyboard only when asked for
- Answer bodies accept `inputMethod: 'keys' | 'handwriting' | 'device'` (default `'keys'`), stored
  in `test_questions.input_method`.
- Settings keys (server whitelist + client defaults): `inputMethod` (`'keys'`), `keyLayout`
  (`'shuffled' | 'gojuon'`, default `'shuffled'`), `handwritingStrict` (`false`), `ttsRate`
  (number 0.5–1.2, default `0.9`), `ttsVoice` (string, `''` = automatic), `listenAutoplay` (`true`).
  `keyboardVisible` stays accepted but is superseded by `inputMethod`.
- The practice card has a segmented switcher **Kana keys / Handwriting / Device keyboard**.
  **On touch / coarse-pointer devices the OS keyboard must never appear unless the method is
  `device`**: in `keys` and `handwriting` the answer field uses `inputmode="none"` and `readonly`,
  is never programmatically focused, and taps on it don't open a keyboard. On desktop (fine
  pointer) physical typing still works in every method. In `device` mode the field is a normal
  input (IME or the romaji-typing conversion).

### 15.4 On-screen kana keyboard
- **No romaji row/column headers** (no k, s, t … / a, i, u …) in any layout.
- `keyLayout: 'shuffled'` (default): the keys of each section (Basic, Voiced, Small & ー) are
  randomly permuted for every question and whenever the script toggles, packed without gaps, so the
  learner must recognise each character. `'gojuon'`: table order, still without headers.
- Romaji labels on keys remain an opt-in setting (default off). Guided-mode key pulses keep working.

### 15.5 Handwriting pad
- `scripts/build-kana-strokes.mjs` fetches KanjiVG SVGs (CC BY-SA 3.0, Ulrich Apel) for every
  kana in `KEYBOARD` in both scripts into `.cache/kanjivg/` and writes
  **`public/data/kana-strokes.json`**: `{ meta: { source, license, url }, chars: { "あ": [[[x,y], …], …] } }`
  (stroke point lists in the 109×109 KanjiVG space, in stroke order).
- `public/js/handwriting/recognizer.js` (pure ESM, browser + Node):
  `createRecognizer(data) → { recognize(strokes, { script = null, topN = 5 } = {}) }` returning
  `[{ char, score, confidence }]` best first; `strokes` = `Array<Array<{x, y}>>` in any coordinate
  space; `loadRecognizer(url = '/data/kana-strokes.json')`. Scale/translation invariant, tolerant
  of stroke order and stroke-count deviations, uses stroke direction/shape so confusable pairs
  (シ/ツ, ソ/ン, ク/ケ/タ, ぬ/め, わ/れ/ね, は/ほ, る/ろ, さ/ち/き, い/り, ろ/る) separate.
  Targets on synthetic distorted samples: top-1 ≥ 92 %, top-3 ≥ 98 % per script.
- `public/js/handwriting/pad.js`:
  `createHandwritingPad({ onCommit(char), onBackspace(), getScript(), strict })` →
  `{ el, clear(), destroy(), setStrict(bool), setScriptHint(script | null) }`. Square canvas with
  pointer events (mouse, touch, pen), `touch-action: none`, HiDPI, smoothed ink, faint four-square
  guide; recognises ~650 ms after the last stroke and commits the top candidate; candidate chips
  replace the last committed character unless `strict`; Undo stroke, Clear, 小 (small toggle via
  `applyModifier`), ⌫. Never focuses an input. Styles in `public/css/handwriting.css`.
- Handwritten answers score like any other answer; `inputMethod: 'handwriting'` is recorded so
  stats, results and PDFs can show it.

### 15.6 UI surfaces
- New-test dialog: **Mode** (Romaji → write / Listen → write) and **Word pool** (All dictionary
  words / Common words, with live counts).
- Settings: default input method, keyboard layout, handwriting strict mode, listening voice picker
  (Japanese voices), speech rate with a test button, autoplay.
- Dashboard, results and PDFs show the mode, and results/PDF rows show the input method. The
  dashboard adds romaji-vs-listen and input-method breakdowns.
- Attribution adds: "Handwriting stroke data: KanjiVG © Ulrich Apel, CC BY-SA 3.0."

### 15.7 Late user changes — these SUPERSEDE §12.4, §15.4 and any brief that says otherwise
**(a) Romaji column labels are a toggle, not removed.**
- New setting **`showKeyHeaders`** (boolean, default `false`; add it to the server settings
  whitelist and client defaults). When on, the on-screen keyboard shows the romaji column labels
  (k, s, t, n, h, m, y, r, w … and g, z, d, b, p for voiced) above the columns again.
- Column labels only make sense in table order, so they apply to `keyLayout: 'gojuon'`. In the
  practice ⋯ menu, under **Practice options**, right next to "Romaji on keys", add:
  - **"Shuffle keys"** (checkbox ↔ `keyLayout` shuffled/gojuon), and
  - **"Romaji column labels"** (checkbox ↔ `showKeyHeaders`). While keys are shuffled it is shown
    disabled with the hint "Turn off Shuffle keys to use column labels" (or turning it on switches
    to gojūon order — pick one and make it obvious).
  Replace the obsolete "Show keyboard" item with the input-method switcher from §15.3. The Settings
  page offers the same options.

**(b) Hint 2 ("Guide me") reveals ONE character per click.**
- Each click of **Guide me** reveals only the next character: the character at the first position
  the learner has not yet written correctly (`guideState(...).nextIndex`). After that character is
  written correctly, nothing further is revealed until the learner clicks again. The button then
  reads **"Reveal next letter"** with its running cost.
- The guide strip shows one box per expected character: revealed positions show their character
  (green when written correctly; a red shake when something else is written there); unrevealed
  positions show a neutral "?" and give **no** live right/wrong feedback (no green/red for
  characters the learner writes on their own — that would leak the answer).
- No auto-check: the learner presses Check. The on-screen key pulse applies only to the currently
  revealed character, until it is written.
- Scoring is unchanged (§8/§15.2): `hint2Revealed` = number of characters revealed by clicks,
  `hint2From` = matched length at the first click; penalty `max(10, round(60·revealed/len))`.
  The server API is unchanged (the spelling hint still returns the answer; the client reveals it
  one character per click). Resume after reload restores the revealed positions (persist them in
  `sessionStorage` per question; if unavailable, treat everything up to the stored count as revealed).

---

## 16. Hosting (Render + Turso) — supersedes the driver details in §1 and §5

- **Driver:** `@libsql/client` is the only database driver. `server/db.js` connects to Turso when
  `TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN`) is set, otherwise to the local file `file:<DB_PATH>`.
  `node:sqlite` is no longer used by the server (e2e tooling may still read a run's DB file).
- **API (async):** `db.get/all/run(sql, args)`, `db.read([stmts])` (one snapshot, one round trip),
  `db.batch([stmts])` (one atomic write transaction, one round trip). No interactive `tx(fn)`:
  each action is one guarded write batch, with race guards in the SQL `WHERE` clauses.
- **Schema version:** a `schema_meta` table replaces `PRAGMA user_version` (seeded from it for older
  local files). Foreign keys are not relied on remotely: child rows are deleted explicitly.
- **Round-trip budget:** session lookup 1; answer/skip/hint/create test 3; dashboard, test state and
  each PDF 2; `/api/health` and `/api/words/*` 0 (enforced by tests).
- **Deploy:** `render.yaml` (free web service, `NODE_ENV=production`, `HOST=0.0.0.0`,
  `TRUST_PROXY=1`, health check `GET /api/health` → `{ ok: true }`). `TRUST_PROXY` digits parse as a
  hop count. Render region and Turso location must be close together (both Singapore by default).
