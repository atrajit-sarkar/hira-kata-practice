/**
 * Per-test progress report (SPEC §9, §15.6): header with the practice mode,
 * summary tiles + grade seal, script accuracy, answer breakdown, input methods,
 * the question table, words to review and kana to practise.
 */

import {
  COLORS, cleanText, duration, formatDateTime, formatNumber, num, objects, percent,
} from './theme.js';
import { Flow, createDocument, documentToBuffer, drawFooters } from './document.js';
import { drawCard, drawGradeSeal, drawTileGrid, gradeDescriptor } from './components.js';
import { textLine } from './text.js';
import {
  drawScriptCard, drawTitleBlock, drawWeakKana, drawWordTable, learnerLine, statusChip,
} from './sections.js';
import {
  configChips, drawBreakdownCard, drawInputStrip, drawQuestionTable, modeChip, modeLabel, modeOf,
} from './questions.js';

/** Derive the counters the report needs, tolerating missing summary fields. */
function summarize(test, questions) {
  const counted = { correct: 0, wrong: 0, skipped: 0, pending: 0 };
  for (const q of questions) {
    if (q.status in counted) counted[q.status] += 1;
  }
  const correct = num(test.correctCount, counted.correct);
  const wrong = num(test.wrongCount, counted.wrong);
  const skipped = num(test.skippedCount, counted.skipped);
  const answered = num(test.answeredCount, correct + wrong + skipped);
  const total = Math.max(num(test.totalQuestions, questions.length), answered);
  return {
    correct, wrong, skipped, answered, total,
    pending: Math.max(0, total - answered),
    score: num(test.score),
    answeredMax: num(test.answeredMaxScore, answered * 100),
    accuracy: answered > 0 ? num(test.accuracy, correct / answered) : null,
    scorePercent: answered > 0 ? num(test.scorePercent, num(test.score) / (answered * 100)) : null,
  };
}

/** "6 script · 4 guided", plus " · 3 romaji" in listen mode or when romaji hints were used. */
function hintDetail(test, listen) {
  const parts = [`${num(test.hint1Count)} script`, `${num(test.hint2Count)} guided`];
  if (listen || num(test.romajiHintCount) > 0) parts.push(`${num(test.romajiHintCount)} romaji`);
  return parts.join(' · ');
}

function drawSummary(flow, test, s, listen) {
  const { doc } = flow;
  const tileH = 64;
  const gap = 8;
  const gridH = tileH * 2 + gap;
  const sealW = 150;
  flow.ensure(gridH);
  const y = flow.y;

  drawCard(doc, flow.left, y, sealW, gridH, { fill: COLORS.surface2 });
  drawGradeSeal(doc, test.grade, flow.left + sealW / 2, y + 50, 33);
  textLine(doc, test.grade ? `Grade ${test.grade} · ${gradeDescriptor(test.grade)}` : gradeDescriptor(null), flow.left + sealW / 2, y + 105, {
    bold: true, size: 9, color: COLORS.ink, align: 'center', width: sealW - 16,
  });
  textLine(doc, s.scorePercent == null ? 'Answer a question to get graded' : `${percent(s.scorePercent)} of the possible score`, flow.left + sealW / 2, y + 119, {
    size: 7.5, color: COLORS.muted, align: 'center', width: sealW - 16,
  });

  const answeredTime = s.answered > 0 ? `${duration(num(test.timeSpentMs) / s.answered)} per word on average` : 'No answers yet';
  const hints = num(test.hint1Count) + num(test.hint2Count) + num(test.romajiHintCount);
  // A closed test keeps its unanswered words for good: no "so far" / "yet".
  const ended = test.status === 'completed' || test.status === 'closed';
  const scoreDetail = !s.answered
    ? `Up to ${formatNumber(s.total * 100)} for this test`
    : `of ${formatNumber(s.answeredMax)} possible${ended ? '' : ' so far'}`;
  const progressDetail = !s.pending
    ? 'Every word answered'
    : `${s.pending} ${ended ? 'left unanswered' : 'not answered yet'}`;
  const tiles = [
    { label: 'Score', value: formatNumber(s.score), detail: scoreDetail, accent: COLORS.brand },
    { label: 'Accuracy', value: percent(s.accuracy), detail: s.answered ? `${s.correct} of ${s.answered} correct` : 'No answers yet', accent: COLORS.success },
    { label: 'Progress', value: `${s.answered} / ${s.total}`, detail: progressDetail, accent: COLORS.hira },
    { label: 'Hints used', value: String(hints), detail: hintDetail(test, listen), accent: COLORS.warning },
    { label: 'Time', value: duration(test.timeSpentMs), detail: answeredTime, accent: COLORS.kata },
    { label: 'Best streak', value: String(num(test.bestStreak)), detail: `Current streak ${num(test.currentStreak)}`, accent: COLORS.accent },
  ];
  const gridX = flow.left + sealW + gap;
  drawTileGrid(doc, tiles, gridX, y, flow.right - gridX, { columns: 3, tileHeight: tileH, gap });
  flow.advance(gridH + 12);
}

function drawCharts(flow, data, s) {
  const { doc } = flow;
  const gap = 12;
  const w = (flow.width - gap) / 2;
  flow.ensure(104);
  const h1 = drawScriptCard(doc, data.byScript, flow.left, flow.y, w);
  const h2 = drawBreakdownCard(doc, s, flow.left + w + gap, flow.y, w);
  flow.advance(Math.max(h1, h2) + 26);
}

function reviewItems(questions) {
  return questions
    .filter((q) => (q.status === 'wrong' || q.status === 'skipped') && q.word)
    .map((q) => ({
      word: { ...q.word, kana: q.word.kana ?? q.expected, romaji: q.word.romaji ?? q.romaji },
      status: q.status === 'skipped'
        ? { text: 'Skipped', variant: 'neutral' }
        : { text: q.errorType === 'script' ? 'Wrong script' : q.errorType === 'empty' ? 'No answer' : 'Misspelt', variant: 'danger' },
    }));
}

/**
 * Render the PDF report for one test.
 * @param {object} data TestReportData (SPEC §9)
 * @returns {Promise<Buffer>}
 */
export async function renderTestReport(data) {
  const test = data?.test ?? {};
  const questions = objects(data?.questions).sort((a, b) => num(a.position) - num(b.position));
  const title = cleanText(test.title) || 'Practice test';
  const tz = data?.tzOffset;
  const s = summarize(test, questions);
  // data.mode is set by the backend; older data only has the config (or nothing: romaji).
  const mode = modeOf(data?.mode ?? test.config?.mode);
  const modeLabels = { [mode]: modeLabel(mode, { [mode]: data?.modeLabel }) };

  const doc = createDocument({
    title: `HiraKata practice report – ${title}`,
    author: cleanText(data?.user?.displayName),
    subject: 'Hiragana & katakana writing practice report',
  });
  const flow = new Flow(doc, { reportLabel: 'Practice report', runningTitle: title, generatedAt: data?.generatedAt, tzOffset: tz });

  const dates = [`Started ${formatDateTime(test.createdAt, tz)}`];
  if (test.finishedAt) dates.push(`${test.status === 'closed' ? 'Closed' : 'Finished'} ${formatDateTime(test.finishedAt, tz)}`);
  drawTitleBlock(flow, {
    eyebrow: `Test #${test.id ?? '–'}`,
    title,
    meta: [learnerLine(data?.user), ...dates].join('  ·  '),
    chips: [
      statusChip(test.status),
      ...(test.config && typeof test.config === 'object'
        ? configChips({ ...test.config, mode }, { modeLabels })
        : [modeChip(mode, modeLabels)]),
    ],
  });
  drawSummary(flow, test, s, mode === 'listen');
  drawCharts(flow, data, s);
  drawInputStrip(flow, data?.byInput, data?.inputLabels);
  drawQuestionTable(flow, questions, s, { mode, inputLabels: data?.inputLabels });
  drawWordTable(flow, reviewItems(questions), {
    title: 'Words to review',
    subtitle: 'Missed or skipped in this test',
    emptyText: s.answered ? 'Nothing to review: every answered word was correct.' : 'No answers yet.',
  });
  // weakChars of a test report are this test's characters (SPEC §9, reportData.js).
  drawWeakKana(flow, objects(data?.weakChars), {
    subtitle: 'Your least accurate characters in this test',
    emptyText: s.answered ? 'No misspelt kana in this test.' : 'No answers yet.',
  });

  drawFooters(doc, data?.source);
  return documentToBuffer(doc);
}
