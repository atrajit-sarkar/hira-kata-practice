import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import { renderOverallReport, renderTestReport } from '../server/report/pdf.js';
import { niceMax } from '../server/report/charts.js';
import { romajiSplitPoint } from '../server/report/questions.js';

const fixture = (name) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));
const TEST_DATA = fixture('report-test.json');
const OVERALL_DATA = fixture('report-overall.json');

/** Number of pages in a PDF produced by pdfkit (counts page objects). */
function pageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

function assertPdf(buffer, { minPages = 1 } = {}) {
  assert.ok(Buffer.isBuffer(buffer), 'renderer must resolve to a Buffer');
  assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.match(buffer.subarray(-32).toString('latin1'), /%%EOF\s*$/);
  assert.ok(pageCount(buffer) >= minPages, `expected at least ${minPages} pages, got ${pageCount(buffer)}`);
}

/** The test fixture stretched to `count` questions. */
function withQuestions(count) {
  const questions = Array.from({ length: count }, (_, i) => ({
    ...TEST_DATA.questions[i % TEST_DATA.questions.length], id: i + 1, position: i,
  }));
  return { ...TEST_DATA, questions, test: { ...TEST_DATA.test, totalQuestions: count } };
}

test('test report renders the realistic fixture over several pages', async () => {
  const pdf = await renderTestReport(TEST_DATA);
  assertPdf(pdf, { minPages: 2 });
});

test('overall report renders the realistic fixture', async () => {
  const pdf = await renderOverallReport(OVERALL_DATA);
  assertPdf(pdf, { minPages: 2 });
});

test('fonts are embedded (subset), not substituted', async () => {
  const text = (await renderTestReport(TEST_DATA)).toString('latin1');
  assert.match(text, /\/FontFile2/);
  assert.match(text, /NotoSansJP/);
});

test('a 100-question report renders within the 1.5 s budget', async () => {
  const data = withQuestions(100);
  await renderTestReport(data); // warm-up: font parsing and module JIT
  const started = performance.now();
  const pdf = await renderTestReport(data);
  const elapsed = performance.now() - started;
  assertPdf(pdf, { minPages: 4 });
  assert.ok(elapsed < 1500, `rendering took ${elapsed.toFixed(0)} ms`);
});

test('test report: nothing answered yet, guest user, no weak kana', async () => {
  const questions = TEST_DATA.questions.slice(0, 8).map((q) => ({
    id: q.id, position: q.position, status: 'pending', romaji: q.romaji,
  }));
  const pdf = await renderTestReport({
    ...TEST_DATA,
    user: { displayName: 'Guest', email: null, isGuest: true },
    test: {
      ...TEST_DATA.test, status: 'active', totalQuestions: 8, answeredCount: 0, currentIndex: 0, score: 0,
      answeredMaxScore: 0, correctCount: 0, wrongCount: 0, skippedCount: 0, hint1Count: 0, hint2Count: 0,
      accuracy: 0, scorePercent: 0, grade: null, currentStreak: 0, bestStreak: 0, timeSpentMs: 0,
    },
    questions,
    byScript: { hiragana: { answered: 0, correct: 0, accuracy: 0 }, katakana: { answered: 0, correct: 0, accuracy: 0 } },
    weakChars: [],
  });
  assertPdf(pdf);
});

test('test report: very long title and meanings, missing optional fields, jlpt null', async () => {
  const long = 'An exceptionally long meaning that keeps going '.repeat(12);
  const questions = TEST_DATA.questions.map((q, i) => {
    if (!q.word) return q;
    const word = { ...q.word, meaning: long, jlpt: null };
    if (i % 3 === 0) delete word.kanji;
    if (i % 4 === 0) delete word.meaning;
    const copy = { ...q, word };
    if (i % 5 === 0) delete copy.diff;
    return copy;
  });
  const pdf = await renderTestReport({
    ...TEST_DATA,
    test: { ...TEST_DATA.test, title: 'カタカナ loanwords '.repeat(30), config: undefined, finishedAt: undefined },
    questions,
    source: undefined,
    tzOffset: undefined,
  });
  assertPdf(pdf, { minPages: 2 });
});

test('test report: every grade and status renders', async () => {
  for (const [grade, status] of [['S', 'completed'], ['A', 'closed'], ['C', 'completed'], ['D', 'closed']]) {
    assertPdf(await renderTestReport({ ...TEST_DATA, test: { ...TEST_DATA.test, grade, status, finishedAt: TEST_DATA.generatedAt } }));
  }
});

test('renderers tolerate empty or minimal input', async () => {
  assertPdf(await renderTestReport({}));
  assertPdf(await renderOverallReport({}));
  assertPdf(await renderTestReport({ test: { id: 1, title: 'x' }, questions: [] }));
  assertPdf(await renderTestReport({ ...TEST_DATA, questions: [null, ...TEST_DATA.questions.slice(0, 3), 7], weakChars: [null] }));
  assertPdf(await renderOverallReport({
    ...OVERALL_DATA, tests: [null], vocab: { learned: [null, { word: OVERALL_DATA.vocab.learned[0].word, progress: null }], review: 'x' },
  }));
});

test('text with characters outside the embedded font (emoji) still renders', async () => {
  const pdf = await renderTestReport({
    ...TEST_DATA, user: { ...TEST_DATA.user, displayName: 'Ana 🌸' }, test: { ...TEST_DATA.test, title: 'Kana 🎌 drill' },
  });
  assertPdf(pdf);
});

test('overall report: brand-new account with empty lists', async () => {
  const daily = OVERALL_DATA.overview.daily.map((d) => ({ ...d, answered: 0, correct: 0, score: 0 }));
  const pdf = await renderOverallReport({
    ...OVERALL_DATA,
    user: { displayName: 'Guest', email: null, isGuest: true },
    overview: {
      totals: { tests: 0, answered: 0, correct: 0, wrong: 0, skipped: 0, accuracy: 0, score: 0, timeSpentMs: 0 },
      byScript: {}, byLevel: {}, streak: { current: 0, best: 0, todayAnswered: 0, lastActiveDate: null },
      daily, last7: { answered: 0, accuracy: 0 }, prev7: { answered: 0, accuracy: 0 },
      recentTests: [], accuracyTrend: [], charStats: [], weakChars: [],
    },
    tests: [],
    vocab: { learned: [], review: [] },
  });
  assertPdf(pdf);
});

/** Render and collect every string the renderer draws, with its position. */
async function drawnText(render, data) {
  const original = PDFDocument.prototype.text;
  const calls = [];
  PDFDocument.prototype.text = function text(str, x, y, opts) {
    calls.push({ str: String(str), x, y });
    return original.call(this, str, x, y, opts);
  };
  try {
    assertPdf(await render(data));
  } finally {
    PDFDocument.prototype.text = original;
  }
  return calls;
}
const strings = (calls) => calls.map((c) => c.str);

test('question table: three-digit positions are printed in the # column', async () => {
  const calls = await drawnText(renderTestReport, withQuestions(100));
  // The # column is right-aligned at the left edge of the table; points are far to the right.
  const numbers = calls.filter((c) => c.x < 70).map((c) => c.str);
  for (const n of ['1', '99', '100']) assert.ok(numbers.includes(n), `row number ${n} missing`);
});

test('question table: long romaji shrinks instead of being cut', async () => {
  const data = withQuestions(3);
  data.questions[0] = { ...data.questions[0], romaji: 'herutsegobina' };
  data.questions[1] = { ...data.questions[1], romaji: 'shakaikagaku' };
  const drawn = strings(await drawnText(renderTestReport, data));
  assert.ok(drawn.includes('herutsegobina'));
  assert.ok(drawn.includes('shakaikagaku'));
});

test('test report: weak kana are labelled per test and large counts are not truncated', async () => {
  const weakChars = [{ char: 'ん', script: 'hiragana', correct: 134, wrong: 6, accuracy: 0.957 }];
  const drawn = strings(await drawnText(renderTestReport, { ...TEST_DATA, weakChars }));
  assert.ok(drawn.includes('Your least accurate characters in this test'));
  assert.ok(!drawn.some((s) => s.includes('all tests')));
  assert.ok(drawn.includes('6/140 missed'), 'tile detail must not be truncated');

  const none = strings(await drawnText(renderTestReport, { ...TEST_DATA, weakChars: [] }));
  assert.ok(none.includes('No misspelt kana in this test.'));
  assert.ok(!none.some((s) => s.includes('at least twice')));
});

test('test report: a closed test does not promise its unanswered words for later', async () => {
  const closed = strings(await drawnText(renderTestReport, {
    ...TEST_DATA, test: { ...TEST_DATA.test, status: 'closed', finishedAt: TEST_DATA.generatedAt },
  }));
  assert.ok(closed.includes('5 left unanswered'));
  assert.ok(!closed.some((s) => s.includes('not answered yet') || s.includes('so far')));

  const active = strings(await drawnText(renderTestReport, TEST_DATA));
  assert.ok(active.includes('5 not answered yet'));
  assert.ok(active.includes('of 4,000 possible so far'));
});

test('activity chart: axis maximum is an even whole number so the mid label is exact', () => {
  for (let v = 1; v <= 5000; v += 1) {
    const max = niceMax(v);
    assert.ok(max >= v && Number.isInteger(max / 2), `niceMax(${v}) = ${max}`);
  }
  assert.equal(niceMax(5), 6);
  assert.equal(niceMax(137), 200);
});

test('overall report: capped word lists say how many are shown', async () => {
  const drawn = strings(await drawnText(renderOverallReport, OVERALL_DATA));
  const { learned, review } = OVERALL_DATA.vocab;
  assert.ok(drawn.includes(`Answered correctly at least once · ${learned.length} most recent of 1,105`));
  assert.ok(drawn.includes(`Missed or skipped the last time you saw them · ${review.length} most missed of 96`));
});

test('overall report: a learner with no answers is not congratulated', async () => {
  const drawn = strings(await drawnText(renderOverallReport, {
    ...OVERALL_DATA,
    overview: { ...OVERALL_DATA.overview, totals: { tests: 0, answered: 0 }, weakChars: [] },
    tests: [],
    vocab: { learned: [], review: [] },
  }));
  assert.ok(!drawn.some((s) => s.includes('well done')));
  assert.ok(drawn.includes('Words you miss or skip will appear here.'));
});

// ---------------------------------------------------------------------------
// v2 (SPEC §15): practice modes, input methods, romaji hint, same-sound
// spellings, and kanji forms from the full dictionary.
// ---------------------------------------------------------------------------

const LISTEN_DATA = fixture('report-test-listen.json');

/** A pre-v2 test report: no mode, input methods, romaji hints or byInput. */
function legacyTestData() {
  const { mode, modeLabel, byInput, inputLabels, ...rest } = TEST_DATA;
  const { mode: _mode, pool: _pool, ...config } = TEST_DATA.test.config;
  const questions = TEST_DATA.questions.map(({ inputMethod, romajiHintUsed, ...q }) => q);
  return { ...rest, test: { ...TEST_DATA.test, config }, questions };
}

test('test report: listen mode shows the mode, Heard column, same-sound and romaji-hint markers', async () => {
  const drawn = strings(await drawnText(renderTestReport, LISTEN_DATA));
  for (const s of ['Listen → write', 'HEARD', 'Same sound', 'Romaji', 'Listen mode', 'How you answered', 'Handwriting', 'Kana keys']) {
    assert.ok(drawn.includes(s), `"${s}" missing`);
  }
  assert.ok(!drawn.includes('Romaji → write'));
  const romajiHints = LISTEN_DATA.test.romajiHintCount; // includes a pending question's hint
  assert.ok(drawn.some((s) => s.endsWith(`${romajiHints} romaji`)), 'romaji hints missing from the hint tile');
  assert.ok(drawn.includes('Not used'), 'the unused device keyboard should say so');
});

test('test report: listen questions not yet heard keep their romaji hidden', async () => {
  const drawn = strings(await drawnText(renderTestReport, LISTEN_DATA));
  assert.ok(drawn.includes('hikouki'), 'a pending question that used the romaji hint shows it');
  assert.ok(!drawn.some((s) => s === 'null' || s === 'undefined'));
});

test('test report: romaji mode labels the column Romaji and shows each input method', async () => {
  const drawn = strings(await drawnText(renderTestReport, TEST_DATA));
  for (const s of ['Romaji → write', 'ROMAJI', 'Kana keys', 'Handwriting', 'Device keyboard', 'How you answered']) {
    assert.ok(drawn.includes(s), `"${s}" missing`);
  }
  for (const s of ['HEARD', 'Same sound', 'Listen mode']) assert.ok(!drawn.includes(s), `"${s}" in a romaji test`);
});

test('test report: data from before v2 renders as romaji mode without the input strip', async () => {
  const drawn = strings(await drawnText(renderTestReport, legacyTestData()));
  assert.ok(drawn.includes('Romaji → write'));
  assert.ok(!drawn.includes('How you answered'));
  assert.ok(!drawn.includes('HEARD'));
  assert.ok(drawn.includes('ROMAJI'));
});

test('test report: a same-sound spelling is a correct answer with its own label', async () => {
  const q = LISTEN_DATA.questions.find((x) => x?.errorType === 'variant');
  assert.ok(q, 'fixture needs a variant answer');
  const drawn = strings(await drawnText(renderTestReport, { ...LISTEN_DATA, questions: [q] }));
  assert.ok(drawn.includes('Same sound'));
  assert.ok(!drawn.includes('Spelling'));
  assert.ok(drawn.includes('Nothing to review: every answered word was correct.'), 'a same-sound spelling is not a word to review');
});

test('kanji forms the embedded font lacks are left out, other forms stay', async () => {
  const base = TEST_DATA.questions.find((x) => x?.word && x.status === 'wrong');
  const word = { ...base.word, kanji: ['欙子', '漢字'] };
  const only = { ...base.word, kanji: ['饃'] };
  const questions = [{ ...base, id: 1, position: 0, word }, { ...base, id: 2, position: 1, word: only }];
  const drawn = strings(await drawnText(renderTestReport, { ...TEST_DATA, questions }));
  assert.ok(drawn.some((s) => s.includes('漢字')), 'drawable kanji form missing');
  assert.ok(!drawn.some((s) => s.includes('欙') || s.includes('饃')), 'undrawable kanji was printed');
  assert.ok(!drawn.some((s) => s.includes('?子') || s.includes('?、')), 'undrawable kanji became "?"');

  const overall = strings(await drawnText(renderOverallReport, {
    ...OVERALL_DATA,
    vocab: {
      learned: [{ word, progress: { seen: 2, correct: 2, wrong: 0 } }],
      review: [{ word: only, progress: { seen: 1, correct: 0, wrong: 1 } }],
    },
  }));
  assert.ok(overall.some((s) => s.includes('漢字')));
  assert.ok(!overall.some((s) => s.includes('欙') || s.includes('饃')));
});

test('the embedded font covers every kanji of the full dictionary except the documented few', async (t) => {
  const bankPath = fileURLToPath(new URL('../data/words.json.gz', import.meta.url));
  if (!fs.existsSync(bankPath)) return t.skip('data/words.json.gz is not built');
  const bank = JSON.parse(gunzipSync(fs.readFileSync(bankPath)).toString('utf8'));
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont('noto', fileURLToPath(new URL('../server/report/fonts/NotoSansJP-Regular.ttf', import.meta.url)));
  doc.font('noto');
  const font = doc._font.font;
  const missing = new Set();
  for (const w of bank.words) {
    for (const form of w.kanji ?? []) {
      for (const ch of form) if (!font.hasGlyphForCodePoint(ch.codePointAt(0))) missing.add(ch);
    }
  }
  // Noto Sans JP itself has no glyph for these (KNOWN_UNSUPPORTED in scripts/build-fonts.py).
  assert.deepEqual([...missing].sort(), [...'欙疍皻饃'].sort());
});

test('overall report: practice mode and input method breakdowns', async () => {
  const drawn = strings(await drawnText(renderOverallReport, OVERALL_DATA));
  for (const s of ['By practice mode', 'By input method', 'Romaji → write', 'Listen → write', 'Kana keys', 'Handwriting', 'Device keyboard']) {
    assert.ok(drawn.includes(s), `"${s}" missing`);
  }
  const { listen } = OVERALL_DATA.overview.byMode;
  assert.ok(drawn.includes(`${listen.correct.toLocaleString('en-US')} of ${listen.answered.toLocaleString('en-US')} correct`));
  assert.ok(drawn.some((s) => s.endsWith(`${OVERALL_DATA.overview.totals.romajiHintUsed} romaji`)));
});

test('overall report: unused modes say so and pre-v2 overviews skip the breakdowns', async () => {
  const zero = { answered: 0, correct: 0, accuracy: 0 };
  const { overview } = OVERALL_DATA;
  const fresh = strings(await drawnText(renderOverallReport, {
    ...OVERALL_DATA,
    overview: { ...overview, byMode: { ...overview.byMode, listen: zero }, byInput: { ...overview.byInput, device: zero } },
  }));
  assert.ok(fresh.includes('Not practised yet'));
  assert.ok(fresh.includes('Not used yet'));

  const { byMode, byInput, ...legacy } = overview;
  const old = strings(await drawnText(renderOverallReport, { ...OVERALL_DATA, overview: legacy, modeLabels: undefined, inputLabels: undefined }));
  assert.ok(!old.includes('By practice mode'));
  assert.ok(!old.includes('By input method'));
});

test('footer credits the KanjiVG handwriting data', async () => {
  const drawn = strings(await drawnText(renderTestReport, TEST_DATA)).join(' ');
  assert.match(drawn, /KanjiVG © Ulrich Apel, CC BY-SA 3\.0/);
});

test('question table: very long romaji wraps at a kana boundary', () => {
  const split = (w) => {
    const chars = Array.from(w);
    const i = romajiSplitPoint(chars);
    return `${chars.slice(0, i).join('')}/${chars.slice(i).join('')}`;
  };
  assert.equal(split('biseibutsubunkai'), 'biseibu/tsubunkai');
  assert.equal(split('kanzensaishoku'), 'kanzen/saishoku');
  assert.equal(split('shinbun'), 'shin/bun');
  assert.equal(split('sukuratchimatchi'), 'sukurat/chimatchi');
  assert.equal(split("taiwan'yuuji"), "taiwan'/yuuji");
  assert.equal(split('kyuuniiwaretemo'), 'kyuunii/waretemo');
  assert.equal(split('xxxxxxxxxx'), 'xxxxx/xxxxx');
});
