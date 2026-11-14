# HiraKata · ひらカタ

**Learn to *write* Japanese hiragana and katakana through real dictionary vocabulary.**

HiraKata shows a word in romaji, or speaks it aloud. You write it in kana, picking the right
script yourself: hiragana for native and Sino-Japanese words, katakana for loanwords. Write
with a shuffled on-screen kana keyboard, by hand on a handwriting pad that recognises what you
draw, or with your device keyboard when you ask for it. Every answer is checked on the spot,
scored, and followed by the word's meaning, so you learn vocabulary while you practise the
kana. The words come from the whole JMdict dictionary (168,267 words). Your progress is stored
in SQLite and shown on a dashboard. You can download it as a PDF report at any time.

No build step, no framework and no third-party browser JavaScript. It runs on Node.js with
Express 5, the built-in `node:sqlite`, and vanilla ES modules in the browser.

---

## Features

Each feature from the original brief and where to find it in the app:

| Requirement | What HiraKata does |
|---|---|
| **Romaji → write** | Each question shows the romaji (`kōhī`, `gakkou`, `hon'ya`) and you write the word in kana. The romaji follows rules that keep the exact kana spelling recoverable (§3.1 of the spec; there is an in-app "Reading the romaji" help panel). |
| **Listen → write** | The word is spoken in Japanese (text-to-speech) and you write what you hear. Play it again or at a slower speed (Alt+P, or Space when not typing). A spelling that *sounds* the same but is not the standard one (コオヒイ for コーヒー, せんせえ for せんせい, つずく for つづく) counts as correct with a −30 point penalty, and the standard spelling is shown. The **Show romaji** hint (Alt+3, −30 points) reveals the word's romaji when you can't make it out. See [Listening](#listening-text-to-speech) for voice requirements. |
| **Three input methods** | A switcher on the practice card chooses **Kana keys**, **Handwriting** or **Device keyboard**. The on-screen pad and keys never open the phone or tablet keyboard: in those modes the answer field is read-only to the OS (`inputmode="none"`). The device keyboard (system IME, or optional romaji typing that converts `ko-hi-` to コーヒー as you type) only appears when you pick it. On a desktop, physical typing works in every mode. Results, dashboard and PDFs record which method you used. |
| **Shuffled kana keyboard** | The on-screen keyboard (Basic / Voiced ゛゜ / Small & ー sections, with ゛ ゜ 小 modifier keys) shuffles the keys of each section for every question and every script switch. There are no romaji column labels, so you have to recognise each character. Turn off **Shuffle keys** (practice ⋯ menu or Settings) for gojūon table order; in that order you can also turn on **Romaji column labels** (k, s, t …). **Romaji on keys** is a separate opt-in. |
| **Handwriting recognition** | Write each kana with a finger, pen or mouse on a practice-paper square. About 0.65 s after your last stroke the recogniser reads the character and adds it to your answer. Candidate chips let you swap in the second or third guess, unless strict mode is on. The pad also has Undo stroke, Clear, 小 (small kana) and ⌫. See [Handwriting recognition](#handwriting-recognition). |
| **Right / wrong animations + the correct version** | Correct: a check mark that draws itself, floating points, an encouraging phrase (完璧! Perfect!, すごい! Great!, いいね! Nice!), confetti and sound. Wrong: the card shakes, a cross draws, and "Your answer" and "Correct answer" rows flip in with a character-level diff (wrong, missing and extra characters highlighted). Each error type gets its own explanation, e.g. *"Right sounds, wrong script — this word is written in katakana."* |
| **Hint 1: script hint** | Shows whether the word is hiragana or katakana (−20 points) and switches the keyboard to that script. |
| **Hint 2: reveal next letter** | Each click of **Guide me** / **Reveal next letter** reveals one more character: the first one you have not yet written correctly. The matching key pulses until you write it. Characters you have not revealed stay "?" and give no live right/wrong feedback, so the hint never gives away more than you paid for. You still press Check yourself. It costs up to −60 points, scaled by how many letters were revealed. |
| **Hint 3: Show romaji (listen mode)** | Reveals the romaji of the spoken word (−30 points). |
| **Meaning after each word** | After every answer (including skips) a word card slides up: kana, romaji, kanji forms, numbered senses with parts of speech, loanword origin, JLPT level, homophones, a Listen button (text-to-speech), and a "New word" ribbon the first time you see a word. |
| **PDF reports** | A per-test report (practice mode, summary tiles, grade seal, how you answered per input method, question table with diffs, an input-method icon per row, romaji-hint and "Same sound" markers, words to review, weak kana) and an overall report (all-time totals, 30-day activity, accuracy by practice mode and by input method, tests, learned words). Both are available at any time, including in the middle of a test. |
| **Accounts + SQLite** | Email and password accounts (scrypt, HttpOnly session cookie, "remember me"), or **Try as guest**: a guest can later save their progress as a full account and keeps all data. Everything is stored in one SQLite file. |
| **Dashboard with multiple tests** | KPIs, accuracy by test, hiragana vs katakana, romaji vs listen mode and input-method breakdowns, a 26-week activity heatmap, a kana mastery grid, weakest kana, and a tests list with filters. You can start as many tests as you like, resume active ones, review finished ones, rename or delete them, and end any test early. "Practise mistakes" and "Review my mistakes" build new tests from the words you missed. |
| **The whole JMdict dictionary** | 168,267 words (135,556 hiragana, 32,711 katakana), of which 21,671 are marked common, with English meanings, three difficulty levels and JLPT N5–N1 tags. The New-test dialog picks the **word pool**: *All dictionary words* (the default; common words are drawn four times as often) or *Common words* only, with live counts. A **Vocabulary** page lets you search, filter, sort and star your words. |

Also included: light and dark themes, a textbook (Klee One) or gothic kana font, layouts that
work down to 390 px phones, keyboard shortcuts (Enter, Alt+1 script hint, Alt+2 reveal next
letter, Alt+3 romaji hint, Alt+P play, Alt+S skip, Alt+K switch keyboard script),
reduced-motion support, and accessible live-region announcements.

---

## Quick start

Requirements: **Node.js ≥ 22.13** (for unflagged `node:sqlite`; developed on Node 24) and
npm. You do not need a database server, a build step or network access at runtime.

```bash
npm install
npm start
```

Open **http://localhost:3000**. On first start the server creates `data/hirakata.db`.

The word bank `data/words.json.gz` (gzip, 7.8 MB; 53.6 MB of JSON) is committed, so the app
works straight away. To rebuild it from the latest full JMdict release (downloads about
11.5 MB; needs network access; about 5 s from the cache):

```bash
npm run build:words              # uses the download cache in .cache/wordbank/
npm run build:words -- --refresh # force a fresh download
```

The handwriting stroke templates `public/data/kana-strokes.json` are committed too. To rebuild
them from KanjiVG (cache in `.cache/kanjivg/`): `npm run build:strokes` (add `-- --refresh` to re-download).

---

## Configuration

`npm start` and `npm run dev` load a `.env` file automatically if it exists (Node's
`--env-file-if-exists`). Copy `.env.example` to `.env` to change the defaults:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Listen address (use `0.0.0.0` to expose it on your network) |
| `DB_PATH` | `data/hirakata.db` | SQLite file, relative to the project root (`:memory:` is allowed) |
| `WORDS_PATH` | `data/words.json.gz` | Word bank built by `npm run build:words`. Gzip or plain `.json`, detected from the content; if the file is missing, the other spelling (`.json` ⇄ `.json.gz`) is tried |
| `NODE_ENV` | `development` | `production` hides error details and turns on Secure cookies |
| `COOKIE_SECURE` | on only in production | Force the `Secure` cookie flag on or off (needs HTTPS when on) |
| `TRUST_PROXY` | unset | Set behind a reverse proxy: `true`, a hop count, or an Express trust value such as `loopback` |

---

## npm scripts

| Script | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with `node --watch` (restarts on server changes; reload the browser for frontend changes) |
| `npm test` | Run all unit and API tests (`node:test`) |
| `npm run e2e` | Run the full browser journey against a temporary server and database (see [Testing](#testing)) |
| `npm run build:words` | Rebuild `data/words.json.gz` from the full JMdict and the JLPT lists (`--samples=N`, `--uncommon-samples=N` print random words for review) |
| `npm run shot -- …` | Developer screenshot helper (`scripts/dev/shot.mjs`; its header lists the options) |

---

## Architecture

```
Browser (vanilla ES modules, hash router)          Node.js (Express 5)
┌──────────────────────────────────────┐   JSON   ┌─────────────────────────────────────────┐
│ pages/   landing · login · register  │ ───────▶ │ routes/   auth · tests · stats · vocab  │
│          dashboard · practice ·      │  /api/*  │           words · reports               │
│          results · vocab · settings  │ ◀─────── │ services/ selection · scoring · answers │
│ handwriting/ recognizer · pad        │          │           stats · vocab · reportData    │
│ ui/      shared components, tts      │          │ report/   pdfkit PDF renderer + fonts   │
│ api.js · store.js · router.js        │          │                                         │
└──────────────────┬───────────────────┘          │ db.js     node:sqlite (WAL, migrations) │
                   │ import                       └───────┬───────────────────────┬─────────┘
                   ▼                                      │ import                │ load once
        shared/kana.js  ◀─────────────────────────────────┘                       ▼
        (romaji ⇄ kana, normalization, diff, soundKey)                  data/words.json.gz
```

- **`shared/kana.js`** is one dependency-free module used by both the server and the browser:
  romanization, the romaji input method, answer normalization, the Levenshtein diff, the
  same-sound key used in listen mode (`soundKey`, `compareAnswer(…, { mode })`), difficulty
  analysis, guided-spelling state and the keyboard layout. Answers are scored on the server
  only. The browser uses the same code for live feedback.
- **Server** (`server/`): `app.js` builds the Express app (`createApp({ config, db, wordbank })`,
  which tests use without listening), and `index.js` boots it. The word bank is loaded into
  memory once (about 1 s for the full dictionary; the server uses roughly 300 MB). Tests, questions, vocabulary progress and per-character statistics live in
  SQLite (schema and migrations in `db.js`).
- **Frontend** (`public/`): `index.html` loads `main.js`. The router lazy-loads one module
  per page from `js/pages/`. Each page area has its own folder (`js/dashboard/`,
  `js/practice/`, `js/results/`, `js/vocab/`) and shared components live in `js/ui/`.
  Charts are hand-built SVG with tooltips, table views and colour-blind-safe palettes. DOM is
  built with a small `h()` helper and never with `innerHTML`. Handwriting recognition
  (`js/handwriting/`) and speech (`js/ui/tts.js`) run entirely in the browser.
- **PDF reports** (`server/report/`) are pure functions (`renderTestReport`,
  `renderOverallReport`) built on pdfkit with an embedded Noto Sans JP subset. They take no DB
  or network access; `services/reportData.js` assembles their input.

The full contract (API shapes, database schema, scoring rules, design tokens) is in
[`docs/SPEC.md`](docs/SPEC.md); section 15 covers version 2.

---

## Listening (text-to-speech)

Listen mode and the Listen buttons on word cards use the browser's built-in speech synthesis
(`speechSynthesis`, `ja-JP`). Nothing is sent to a server, but you need a **Japanese voice**:

- **Chrome and Edge** ship online Japanese voices (Google 日本語, Microsoft Nanami/Keita
  Online (Natural)). They work out of the box while you are online.
- **Windows, offline or in other browsers:** install the Japanese speech pack in
  *Settings → Time & language → Language & region → Add a language → Japanese* (tick
  *Text-to-speech*), or *Settings → Time & language → Speech → Add voices*. Then restart the
  browser.
- **macOS / iOS:** Kyoko and Otoya are built in; more voices are under *System Settings →
  Accessibility → Spoken Content*. **Android:** install Japanese in Google's
  *Speech Services* text-to-speech settings.

**Settings → Listening** lists the Japanese voices found (the best one is picked
automatically), sets the speech rate (0.5–1.2, default 0.9) with a test button, and turns
autoplay on or off. When no Japanese voice exists, *Listen → write* is disabled in the
New-test dialog with an explanation, and inside a listen test the **Show romaji** hint is
offered instead. Browsers only allow speech after a tap or click, so the first word of a
session may show "Tap to listen".

---

## Handwriting recognition

The handwriting pad recognises one kana at a time, entirely in the browser (no server, no
model download). It is a template matcher, not a neural network:

- **Templates:** stroke-by-stroke outlines of all 165 keyboard kana in both scripts (hiragana,
  katakana, voiced forms, ー), taken from [KanjiVG](https://kanjivg.tagaini.net/) and stored
  in `public/data/kana-strokes.json` (27.7 KiB). Small kana (ゃ ゅ ょ っ …) have the same shape
  as the full-size ones once the drawing is scaled, so the pad's **小** key produces them.
- **Matching:** the drawing is normalised for size and position (thin shapes such as ー keep
  their proportions), then compared stroke by stroke in writing order. Two strokes written as
  one, or one written as two, are allowed; a split across a long pen jump costs more, so ン is
  not read as レ. A second, order-free comparison handles unusual stroke order. Stroke
  direction counts, which separates シ/ツ and ソ/ン. A wrong stroke count costs a little.
  The expected word's script is a soft preference, which is the only way to tell the
  identical shapes へ/ヘ, べ/ベ and ぺ/ペ apart.
- **Scores:** a confidence per candidate (softmax, calibrated on synthetic samples). Drawings
  that match nothing well (score below 0.15, such as a circle or a scribble) are rejected
  with "Couldn't read that. Try again."
- **Speed:** about 4–5 ms per character on a desktop.

**Accuracy** on seeded synthetic handwriting (the templates distorted with noise, stroke
splits and merges, and shuffled stroke order), with the script hint:

| Script | Top-1 | Top-3 |
|---|---|---|
| Hiragana | 98.7 % | 100 % |
| Katakana | 99.5 % | 100 % |

Without the script hint, top-1 is 98.4 %. In a browser, all 73 hiragana and 73 katakana
templates drawn with the mouse, and 25 of 25 drawn by touch on a 390 px phone viewport, were
recognised correctly.

**Limits.** These figures come from synthetic samples, not from real learners' handwriting,
which varies more. The weakest characters are れ (≈ 80 %), ぬ (≈ 85 %) and ね (≈ 88 %); their
usual mix-ups are れ→わ, ぬ→め and ね→わ when the distinguishing tail is short. Write one
character per box and let the pad commit it before starting the next. If the top guess is
wrong, tap the right candidate chip; *strict handwriting* (Settings or the practice ⋯ menu)
hides the chips so only your drawing counts.

---

## Data sources and licences

- **Dictionary data:** [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) © Electronic
  Dictionary Research and Development Group, used under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), via
  [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) (the full English
  release, about 219,000 entries). `data/words.json.gz` is a derived work and is distributed
  under **CC BY-SA 4.0**, not MIT. `data/ATTRIBUTION.md` documents how it was built and
  filtered (adult terms, proper-name and Ryukyuan senses of uncommon entries, and romaji that
  would be ambiguous between the scripts are left out).
- **JLPT levels:** Jonathan Waller ([tanos.co.uk](http://www.tanos.co.uk/jlpt/)), CC BY, via
  [stephenmk/yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab).
- **Handwriting stroke data:** [KanjiVG](https://kanjivg.tagaini.net/) © Ulrich Apel, used
  under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
  `public/data/kana-strokes.json` is a derived work (stroke point lists extracted from the
  KanjiVG SVGs by `scripts/build-kana-strokes.mjs`) and is distributed under **CC BY-SA 3.0**;
  its `meta` records the source, author, licence and URL.
- **Fonts:** Inter, Klee One and Noto Sans JP (SIL Open Font License). The web app loads them
  from Google Fonts. PDFs embed a Noto Sans JP subset from `server/report/fonts/` (licence in
  `OFL.txt`). `python scripts/build-fonts.py` rebuilds it (needs fontTools) and checks that
  it covers every character of the word bank; `--verify-only` checks the committed fonts.
  Noto Sans JP itself lacks four rare kanji of the full dictionary (欙 疍 皻 饃); a PDF leaves
  a kanji form containing one of them out, and folds the few accented Latin letters it lacks
  in glosses (ą, ł, ṭ …) to their base letter.

The app footer and every PDF page carry this attribution:

> Dictionary data: JMdict © Electronic Dictionary Research and Development Group, used under
> CC BY-SA 4.0 · JLPT levels: Jonathan Waller (tanos.co.uk), CC BY, via
> stephenmk/yomitan-jlpt-vocab · Handwriting stroke data: KanjiVG © Ulrich Apel, CC BY-SA 3.0.

The application source code is MIT-licensed (see `package.json`).

---

## Testing

```bash
npm test      # unit + API tests, about 20 s
npm run e2e   # full browser journey, about 100 s
```

**Unit and API tests** (`test/`, `node:test`):

| File | Covers |
|---|---|
| `kana.test.js` | Every romanization and IME vector from the spec, normalization, diff, analysis, keyboard and modifiers, `soundKey` and listen-mode same-sound answers, plus seeded round-trip property tests |
| `wordbank.test.js` | Every word in `data/words.json.gz` (script, romaji, level, senses, `common`, exclusions, the 25 MB budget) and the build helpers |
| `scoring.test.js` | Points (including the romaji-hint and same-sound penalties), grades, streaks and ratios |
| `api.test.js` | Every REST endpoint: auth, CSRF, rate limits, test lifecycle, word pools, both modes, hints (including the romaji hint), answers and input methods, stats, settings, vocabulary and PDFs, plus the in-place upgrade of a v1 database. It runs against an in-memory database and a 46-word fixture bank |
| `handwriting.test.js` | Recognition accuracy per script on seeded synthetic handwriting with shuffled and merged strokes (top-1 ≥ 92 %, top-3 ≥ 98 %), confusable groups (シ/ツ, ソ/ン, ぬ/め, わ/れ/ね …), stroke direction, the script hint, junk input, stroke-data coverage and attribution, and speed |
| `report.test.js` | PDF rendering of fixtures for both modes, input-method and same-sound markers, mode/input breakdowns, pre-v2 data, kanji forms the font lacks (and font coverage of the whole bank), edge cases (empty, very long or odd input), font embedding and speed |

**End-to-end** (`e2e/smoke.mjs`, puppeteer-core with your local Chrome or Edge; set
`CHROME_PATH` to choose a browser). It starts the real server on a free port with a temporary
database and drives the whole journey in a browser:

landing → register → empty dashboard → New test (mixed, 10 words) → practice: script hint,
Guide me revealing one letter per click (with one wrong key, no live feedback on unrevealed
letters and no auto-check), a clean answer on the shuffled on-screen keys, a wrong-script
answer, a skip, and a romaji-typing answer, checking the meaning card after each → per-test PDF
in the middle of the test → End test → results (grade seal, review list) → Practise mistakes →
vocabulary search and star → settings (dark theme, display name) → logout → login → resume the
active test → overall PDF → a 390 px phone pass (no horizontal overflow) → Try as guest → answer
a word → upgrade, which keeps the data.

A second learner then covers v2, with `speechSynthesis` replaced by a stub that offers one
Japanese voice: a **Listen → write** test on the common pool from the New test dialog (the word
is spoken, the romaji stays hidden until answered, Slow and Alt+P replay, the romaji hint, a
same-sound spelling accepted as a variant) → results with the mode chip → on a touch-emulated
phone, **Kana keys** and **Handwriting** keep the answer field `readonly` with
`inputmode="none"` and never focus it, while **Device keyboard** makes it a normal focused input;
the shuffled keyboard has no column labels and a new order per word; a word is handwritten by
touch and another by mouse from the KanjiVG template strokes → the practice menu's Shuffle keys
and Romaji column labels toggles → results with input-method badges → Settings (input method,
layout, column labels, strict handwriting, voice, rate, Test voice) applied on the practice page →
dashboard mode and input-method cards → listen, input-method and overall PDFs → dark phone
screenshots, including listen practice without a Japanese voice. `E2E_FLOWS=listen,methods`
runs a subset of the flows while debugging.

It fails on any failed assertion, browser console error, page error, failed request or HTTP
5xx, and on any visible `null`/`undefined` text. The one exception is the expected logged-out
`GET /api/auth/me` 401. Screenshots are saved to `e2e/screenshots/` and downloaded PDFs to
`e2e/downloads/` (both gitignored). The script stops its server and deletes its database when
it finishes.

---

## Security notes

- Passwords are hashed with scrypt (N=16384, r=8, p=1) and a random salt, and compared in
  constant time. Unknown emails still run scrypt, so response timing does not reveal which
  accounts exist.
- Sessions use 32-byte random tokens in an `HttpOnly; SameSite=Lax` cookie (`Secure` in
  production). Only their SHA-256 hash is stored. Changing your password signs out your other
  sessions.
- CSRF: every state-changing `/api` request must send `X-Requested-With: HiraKata`, and
  cross-origin `Origin` headers are rejected.
- Rate limits: 30 auth requests per 10 minutes per IP, and 8 failed logins per 15 minutes per
  IP and email (`429` with `Retry-After`). The limits are kept in memory per process.
- A strict Content-Security-Policy (no inline scripts), `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy` and COOP headers are sent on every response. JSON bodies are capped at
  64 kB.
- Every test, question and vocabulary lookup is scoped to the signed-in user (another user's
  ids return 404). Stack traces are never sent when `NODE_ENV=production`.
- The UI builds all DOM with `textContent` and element APIs; API strings are never inserted as
  HTML.

---

## Project structure

```
data/            words.json.gz (CC BY-SA 4.0), ATTRIBUTION.md; the SQLite DB is created here
docs/SPEC.md     build specification and API contract
e2e/             smoke.mjs + flows/ and lib/ for the browser journey
public/          index.html, css/, js/ (main, router, api, store, pages/, ui/, dashboard/,
                 practice/, handwriting/, results/, vocab/), data/kana-strokes.json
                 (CC BY-SA 3.0), img/
scripts/         build-wordbank.mjs (+ lib/), build-kana-strokes.mjs, build-fonts.py,
                 dev/shot.mjs
server/          index.js, app.js, config.js, db.js, auth.js, security.js, http.js,
                 routes/, services/, report/ (PDF renderer and fonts)
shared/kana.js   kana engine used by the server and the browser
test/            node:test suites, helpers/ and fixtures/
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Port 3000 is already in use` | Another program is using the port. Start on a different one: `PORT=3001 npm start` (PowerShell: `$env:PORT=3001; npm start`), or set `PORT` in `.env`. |
| `No such built-in module: node:sqlite`, or syntax errors on start | Your Node.js is too old. Install Node **22.13 or newer** (`node -v`). |
| `The word bank was not found` | `data/words.json.gz` is missing. Restore it or run `npm run build:words` (needs network access). An old `.env` with `WORDS_PATH=data/words.json` still works: the server falls back to the `.gz` file. |
| Fonts look different offline | The web app loads Inter, Klee One and Noto Sans JP from Google Fonts. Offline, it falls back to system fonts and stays fully usable. PDF fonts are bundled, so reports never need the network. Only `python scripts/build-fonts.py` (rebuilding the PDF font subset) downloads fonts. |
| `Too many attempts` when logging in | The auth rate limit was hit. Wait for the time in the message, or restart the server in development (the limits are kept in memory). |
| `npm run e2e` cannot find a browser | Install Chrome or Edge, or set `CHROME_PATH` to a Chromium-based browser executable. |
| A Listen button is missing, or *Listen → write* is greyed out | Text-to-speech needs a Japanese (`ja-JP`) voice. Use Chrome or Edge online, or install the Windows Japanese speech pack (see [Listening](#listening-text-to-speech)), then restart the browser. |
| Listen mode is silent on a phone | Browsers block speech until you tap. Tap **Play** (or "Tap to listen") once; later words play automatically if autoplay is on. Check that the phone is not in silent mode. |
| The handwriting pad shows a Retry button | The stroke templates (`/data/kana-strokes.json`) failed to load. Check the connection to the server and tap Retry. |
| The handwriting pad reads the wrong character | Write one character per box, wait for it to be entered, and tap the right candidate chip if the first guess is wrong. へ/ヘ, べ/ベ and ぺ/ペ look identical, so the pad uses the expected script to choose. |
| The phone keyboard pops up | It only should with **Device keyboard** selected. Switch to Kana keys or Handwriting with the input-method switcher on the practice card. |
