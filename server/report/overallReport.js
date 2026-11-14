/**
 * Overall (all-time) progress report (SPEC §9, §15.6): KPI tiles, 30-day
 * activity, script and difficulty accuracy, practice mode and input method
 * breakdowns, the tests table, weak kana, learned words and words to review.
 */

import {
  COLORS, GRADE_KANJI, cleanText, duration, formatDate, formatNumber, isNum, num, objects, percent,
} from './theme.js';
import { Flow, createDocument, documentToBuffer, drawFooters } from './document.js';
import { drawCard, drawChip, drawEmptyNote, drawMeterRow, drawSectionTitle, drawTileGrid } from './components.js';
import { textLine } from './text.js';
import {
  drawScriptCard, drawTitleBlock, drawWeakKana, drawWordTable, learnerLine, statusChip,
} from './sections.js';
import { drawActivityBars, drawLegend } from './charts.js';
import { drawTable } from './table.js';
import { INPUT_COLORS, INPUT_METHODS, drawInputIcon, drawSpeakerIcon } from './icons.js';
import { inputLabel, modeLabel, modeOf } from './questions.js';

const ACTIVITY_DAYS = 30;
const LEVEL_CARD_HEIGHT = 128;
const LEVELS = [['1', 'Beginner'], ['2', 'Intermediate'], ['3', 'Advanced']];

/** "251 script · 125 guided", plus romaji hints once any were used. */
function hintDetail(t) {
  const parts = [`${formatNumber(t.hint1Used)} script`, `${formatNumber(t.hint2Used)} guided`];
  if (num(t.romajiHintUsed) > 0) parts.push(`${formatNumber(t.romajiHintUsed)} romaji`);
  // Three parts are tight in a quarter-width tile: commas are narrower than ' · '.
  return parts.join(parts.length > 2 ? ', ' : ' · ');
}

function drawKpis(flow, overview) {
  const t = overview?.totals ?? {};
  const streak = overview?.streak ?? {};
  const answered = num(t.answered);
  const tiles = [
    { label: 'Questions answered', value: formatNumber(answered), detail: `${formatNumber(t.correct)} correct · ${formatNumber(num(t.wrong) + num(t.skipped))} missed`, accent: COLORS.brand },
    { label: 'Accuracy', value: answered ? percent(t.accuracy) : '–', detail: answered ? `${percent(t.cleanAccuracy)} without hints` : 'No answers yet', accent: COLORS.success },
    { label: 'Total score', value: formatNumber(t.score), detail: `Across ${num(t.tests)} ${num(t.tests) === 1 ? 'test' : 'tests'}`, accent: COLORS.brandDark },
    { label: 'Time practised', value: duration(t.timeSpentMs), detail: answered ? `${duration(num(t.timeSpentMs) / answered)} per word` : 'No practice yet', accent: COLORS.kata },
    { label: 'Words learned', value: formatNumber(t.wordsLearned), detail: `Of ${formatNumber(t.wordsSeen)} words seen`, accent: COLORS.hira },
    { label: 'Words to review', value: formatNumber(t.wordsToReview), detail: 'Missed or skipped last time', accent: COLORS.danger },
    { label: 'Day streak', value: `${num(streak.current)} ${num(streak.current) === 1 ? 'day' : 'days'}`, detail: `Best ${num(streak.best)} · today ${num(streak.todayAnswered)} answered`, accent: COLORS.accent },
    { label: 'Hints used', value: formatNumber(num(t.hint1Used) + num(t.hint2Used) + num(t.romajiHintUsed)), detail: hintDetail(t), accent: COLORS.warning },
  ];
  const height = 64 * 2 + 8;
  flow.ensure(height);
  drawTileGrid(flow.doc, tiles, flow.left, flow.y, flow.width, { columns: 4, tileHeight: 64, gap: 8 });
  flow.advance(height + 14);
}

/** "▲ 6 pts vs previous 7 days" style comparison, or '' when not comparable. */
function weekDelta(overview) {
  const last = overview?.last7;
  const prev = overview?.prev7;
  if (!num(last?.answered) || !num(prev?.answered)) return '';
  const diff = Math.round((num(last.accuracy) - num(prev.accuracy)) * 100);
  if (diff === 0) return 'same accuracy as the previous 7 days';
  return `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} pts vs the previous 7 days`;
}

function drawActivity(flow, overview) {
  const { doc } = flow;
  const h = 196;
  flow.ensure(h);
  const x = flow.left;
  const y = flow.y;
  drawCard(doc, x, y, flow.width, h);
  textLine(doc, 'Last 30 days', x + 16, y + 22, { bold: true, size: 11, color: COLORS.ink });
  textLine(doc, 'Questions answered per day', x + 16, y + 35, { size: 7.5, color: COLORS.muted });
  drawLegend(doc, [{ label: 'Correct', color: COLORS.seq }, { label: 'Missed', color: COLORS.seqLight }], x + flow.width - 16, y + 23);

  const days = objects(overview?.daily).slice(-ACTIVITY_DAYS);
  const total = days.reduce((sum, d) => sum + num(d.answered), 0);
  const correct = days.reduce((sum, d) => sum + num(d.correct), 0);
  const activeDays = days.filter((d) => num(d.answered) > 0).length;
  const box = { x: x + 16, y: y + 52, w: flow.width - 32, h: 104 };
  if (total === 0) {
    drawEmptyNote(doc, 'No practice in the last 30 days.', box.x, box.y + 20, box.w, 56);
  } else {
    drawActivityBars(doc, days, box);
  }
  const statsY = y + h - 18;
  const stats = [
    ['Answered', formatNumber(total)],
    ['Accuracy', total ? percent(correct / total) : '–'],
    ['Active days', `${activeDays} / ${days.length || ACTIVITY_DAYS}`],
  ];
  let cx = x + 16;
  for (const [label, value] of stats) {
    const lw = textLine(doc, label, cx, statsY, { size: 7.5, color: COLORS.muted });
    cx += lw + 5 + textLine(doc, value, cx + lw + 5, statsY, { bold: true, size: 8.5, color: COLORS.ink }) + 18;
  }
  const delta = weekDelta(overview);
  if (delta) textLine(doc, `This week: ${delta}`, x + flow.width - 16, statsY, { size: 7.5, color: COLORS.secondary, align: 'right' });
  flow.advance(h + 12);
}

function drawLevelCard(doc, byLevel, x, y, w) {
  const h = LEVEL_CARD_HEIGHT;
  drawCard(doc, x, y, w, h);
  textLine(doc, 'By difficulty', x + 14, y + 21, { bold: true, size: 10, color: COLORS.ink });
  textLine(doc, 'Accuracy by word level', x + w - 14, y + 21, { size: 7.5, color: COLORS.muted, align: 'right' });
  LEVELS.forEach(([key, label], index) => {
    const stats = byLevel?.[key] ?? {};
    const answered = num(stats.answered);
    const ratio = answered ? num(stats.accuracy, num(stats.correct) / answered) : null;
    drawMeterRow(doc, {
      label, color: COLORS.brand, ratio,
      value: answered ? percent(ratio) : '–',
      detail: answered ? `${formatNumber(stats.correct)} of ${formatNumber(answered)}` : 'No answers yet',
    }, x + 14, y + 36 + index * 29, w - 28);
  });
  return h;
}

function drawBreakdownRow(flow, overview) {
  const { doc } = flow;
  const gap = 12;
  const w = (flow.width - gap) / 2;
  flow.ensure(LEVEL_CARD_HEIGHT);
  const y = flow.y;
  drawScriptCard(doc, overview?.byScript, flow.left, y, w, LEVEL_CARD_HEIGHT);
  drawLevelCard(doc, overview?.byLevel, flow.left + w + gap, y, w);
  flow.advance(LEVEL_CARD_HEIGHT + 26);
}

/** Meter fields for an { answered, correct, accuracy } bucket. */
function meterFields(stats, emptyText) {
  const answered = num(stats?.answered);
  const ratio = answered ? num(stats.accuracy, num(stats.correct) / answered) : null;
  return {
    ratio,
    value: answered ? percent(ratio) : '–',
    detail: answered ? `${formatNumber(stats.correct)} of ${formatNumber(answered)} correct` : emptyText,
  };
}

/** Romaji-mode mark: a small rounded tile with a Latin "a" (the prompt the learner reads). */
function drawRomajiIcon(doc, cx, cy, size, color) {
  doc.save();
  doc.roundedRect(cx - size / 2, cy - size / 2, size, size, size * 0.22).lineWidth(Math.max(0.6, size * 0.075)).strokeColor(color).stroke();
  doc.restore();
  textLine(doc, 'a', cx, cy + size * 0.24, { bold: true, size: size * 0.72, color, align: 'center' });
}

/** Card with one icon + meter row per item, rows spread evenly over the card. */
function drawIconMeterCard(doc, { title, caption, rows }, x, y, w, h) {
  drawCard(doc, x, y, w, h);
  textLine(doc, title, x + 14, y + 21, { bold: true, size: 10, color: COLORS.ink });
  textLine(doc, caption, x + w - 14, y + 21, { size: 7.5, color: COLORS.muted, align: 'right' });
  const spacing = rows.length > 2 ? 29 : 40;
  const top = y + 36 + Math.max(0, (h - 46 - (24 + spacing * (rows.length - 1))) / 2);
  rows.forEach((row, index) => {
    const ry = top + index * spacing;
    doc.roundedRect(x + 14, ry - 1, 18, 18, 5).fill(COLORS.surface2);
    row.icon(x + 23, ry + 8);
    drawMeterRow(doc, row, x + 40, ry, w - 54);
  });
}

/**
 * Practice mode and input method breakdowns (SPEC §15.2/§15.6), side by side.
 * Skipped for data from before v2 (no byMode/byInput in the overview).
 */
function drawModeInputRow(flow, data) {
  const overview = data?.overview ?? {};
  const byMode = overview.byMode && typeof overview.byMode === 'object' ? overview.byMode : null;
  const byInput = overview.byInput && typeof overview.byInput === 'object' ? overview.byInput : null;
  if (!byMode && !byInput) return;
  const { doc } = flow;
  const gap = 12;
  const w = (flow.width - gap) / 2;
  flow.ensure(LEVEL_CARD_HEIGHT);
  const y = flow.y;
  const modes = ['romaji', 'listen'].map((mode) => ({
    label: modeLabel(mode, data?.modeLabels),
    color: mode === 'listen' ? COLORS.listen : COLORS.brand,
    icon: mode === 'listen'
      ? (cx, cy) => drawSpeakerIcon(doc, cx, cy, 11, COLORS.listen)
      : (cx, cy) => drawRomajiIcon(doc, cx, cy, 10.5, COLORS.brand),
    ...meterFields(byMode?.[mode], 'Not practised yet'),
  }));
  const inputs = INPUT_METHODS.map((method) => ({
    label: inputLabel(method, data?.inputLabels),
    color: INPUT_COLORS[method],
    icon: (cx, cy) => drawInputIcon(doc, method, cx, cy, 11),
    ...meterFields(byInput?.[method], 'Not used yet'),
  }));
  drawIconMeterCard(doc, { title: 'By practice mode', caption: 'Accuracy per mode', rows: modes }, flow.left, y, w, LEVEL_CARD_HEIGHT);
  drawIconMeterCard(doc, { title: 'By input method', caption: 'Accuracy per input', rows: inputs }, flow.left + w + gap, y, w, LEVEL_CARD_HEIGHT);
  flow.advance(LEVEL_CARD_HEIGHT + 26);
}

/** Small hanko-style grade mark: vermilion ring with the kanji, letter beside it. */
function drawGradeMark(doc, grade, cx, cy) {
  const kanji = GRADE_KANJI[grade];
  if (!kanji) {
    textLine(doc, '–', cx, cy + 3, { size: 9, color: COLORS.faint, align: 'center' });
    return;
  }
  const r = 9.5;
  const mx = cx - 6;
  doc.circle(mx, cy, r).lineWidth(1.1).strokeColor(COLORS.accent).stroke();
  textLine(doc, kanji, mx, cy + (kanji.length > 1 ? 2.2 : 3.2), {
    bold: true, size: kanji.length > 1 ? 6.2 : 9, color: COLORS.accent, align: 'center',
  });
  textLine(doc, grade, mx + r + 4, cy + 3.2, { bold: true, size: 9, color: COLORS.ink });
}

function drawTestsTable(flow, tests, tz, modeLabels) {
  const { doc } = flow;
  flow.ensure(24 + 20 + 30 * Math.min(3, Math.max(1, tests.length)) + 8);
  flow.advance(drawSectionTitle(flow, 'Tests', `${tests.length} ${tests.length === 1 ? 'test' : 'tests'} · newest first`));
  if (!tests.length) {
    flow.advance(drawEmptyNote(doc, 'No tests yet. Start a test from the dashboard to see it here.', flow.left, flow.y, flow.width) + 22);
    return;
  }
  drawTable(flow, {
    rowHeight: 32,
    rows: tests,
    columns: [
      {
        header: 'Test', flex: 1,
        render: (c) => {
          textLine(doc, cleanText(c.row.title) || 'Untitled test', c.x, c.y + 14, { bold: true, size: 8.5, color: COLORS.ink, width: c.w });
          const finished = c.row.finishedAt ? ` · ended ${formatDate(c.row.finishedAt, tz)}` : '';
          const dates = `Started ${formatDate(c.row.createdAt, tz)}${finished}`;
          if (modeOf(c.row.config?.mode) !== 'listen') {
            textLine(doc, dates, c.x, c.y + 25, { size: 7, color: COLORS.muted, width: c.w });
            return;
          }
          // Listen tests name their mode (titles can be renamed, so the title may not say it).
          drawSpeakerIcon(doc, c.x + 3.5, c.y + 22.6, 7, COLORS.listen);
          const modeW = textLine(doc, modeLabel('listen', modeLabels), c.x + 10, c.y + 25, {
            bold: true, size: 7, color: COLORS.listenText, width: c.w - 10,
          });
          // Leading spaces are trimmed when drawn, so the separator gets its own gap.
          textLine(doc, `· ${dates}`, c.x + 10 + modeW + 3, c.y + 25, { size: 7, color: COLORS.muted, width: c.w - modeW - 13 });
        },
      },
      {
        header: 'Status', width: 78,
        render: (c) => {
          const chip = statusChip(c.row.status);
          drawChip(doc, chip.text, c.x, c.y + (c.h - 13) / 2, { variant: chip.variant, size: 6.8, height: 13 });
        },
      },
      {
        header: 'Answered', width: 66,
        render: (c) => {
          const total = Math.max(1, num(c.row.totalQuestions));
          const answered = num(c.row.answeredCount);
          textLine(doc, `${answered} / ${num(c.row.totalQuestions)}`, c.x, c.y + 14.5, { size: 8.5, color: COLORS.ink });
          doc.roundedRect(c.x, c.y + 20, c.w, 3, 1.5).fill(COLORS.surface3);
          if (answered > 0) doc.roundedRect(c.x, c.y + 20, Math.max(3, (c.w * Math.min(answered, total)) / total), 3, 1.5).fill(COLORS.brand);
        },
      },
      {
        header: 'Accuracy', width: 56, align: 'right',
        text: (r) => (num(r.answeredCount) ? percent(r.accuracy) : '–'), style: { bold: true, size: 9 },
      },
      {
        header: 'Score', width: 68, align: 'right',
        render: (c) => {
          textLine(doc, formatNumber(c.row.score), c.x + c.w, c.y + 14, { bold: true, size: 9, color: COLORS.ink, align: 'right' });
          const sp = num(c.row.answeredCount) && isNum(c.row.scorePercent) ? `${percent(c.row.scorePercent)} of max` : '';
          if (sp) textLine(doc, sp, c.x + c.w, c.y + 25, { size: 7, color: COLORS.muted, align: 'right' });
        },
      },
      { header: 'Grade', width: 52, align: 'center', render: (c) => drawGradeMark(doc, c.row.grade, c.x + c.w / 2, c.y + c.h / 2) },
    ],
  });
  flow.advance(24);
}

function vocabRows(list, kind) {
  return objects(list).filter((item) => item.word).map(({ word, progress: rawProgress }) => {
    const progress = rawProgress ?? {};
    if (kind === 'learned') {
      return { word, status: { text: `${num(progress.correct)} / ${num(progress.seen)} correct`, variant: 'success' } };
    }
    const status = progress.lastResult === 'skipped'
      ? { text: 'Skipped', variant: 'neutral' }
      : { text: `Missed ${Math.max(1, num(progress.wrong))}×`, variant: 'danger' };
    return { word, status };
  });
}

/** Section subtitle that says when a word list is capped (the backend sends ≤ 60 words). */
function listSubtitle(text, shown, total, order) {
  return shown > 0 && num(total) > shown ? `${text} · ${shown} ${order} of ${formatNumber(total)}` : text;
}

/**
 * Render the overall (all-time) progress report.
 * @param {object} data OverallReportData (SPEC §9)
 * @returns {Promise<Buffer>}
 */
export async function renderOverallReport(data) {
  const overview = data?.overview ?? {};
  const tests = objects(data?.tests);
  const tz = data?.tzOffset;
  const name = cleanText(data?.user?.displayName);
  const totals = overview.totals ?? {};

  const doc = createDocument({
    title: 'HiraKata progress report',
    author: name,
    subject: 'Hiragana & katakana writing practice – all-time progress',
  });
  const flow = new Flow(doc, { reportLabel: 'Progress report', runningTitle: name || 'All-time progress', generatedAt: data?.generatedAt, tzOffset: tz });

  const lastActive = overview.streak?.lastActiveDate;
  const meta = [learnerLine(data?.user)];
  if (lastActive) meta.push(`Last practised ${formatDate(`${lastActive}T12:00:00Z`, 0)}`);
  const chips = [{ text: `${num(totals.tests)} ${num(totals.tests) === 1 ? 'test' : 'tests'}`, variant: 'brand' }];
  if (num(totals.completedTests)) chips.push({ text: `${num(totals.completedTests)} completed`, variant: 'success' });
  if (num(totals.activeTests)) chips.push({ text: `${num(totals.activeTests)} in progress`, variant: 'neutral' });
  if (num(overview.streak?.current)) chips.push({ text: `${num(overview.streak.current)}-day streak`, variant: 'warning' });
  drawTitleBlock(flow, {
    eyebrow: 'All-time progress',
    title: name && !(data?.user?.isGuest && name === 'Guest') ? `${name}’s kana progress` : 'Your kana progress',
    meta: meta.join('  ·  '),
    chips,
  });

  drawKpis(flow, overview);
  drawActivity(flow, overview);
  drawBreakdownRow(flow, overview);
  drawModeInputRow(flow, data);
  drawTestsTable(flow, tests, tz, data?.modeLabels);
  drawWeakKana(flow, objects(overview.weakChars), {
    title: 'Weakest kana', subtitle: 'Lowest accuracy, at least two attempts',
  });
  const review = vocabRows(data?.vocab?.review, 'review');
  const learned = vocabRows(data?.vocab?.learned, 'learned');
  drawWordTable(flow, review, {
    title: 'Words to review',
    subtitle: listSubtitle('Missed or skipped the last time you saw them', review.length, totals.wordsToReview, 'most missed'),
    emptyText: num(totals.answered) ? 'Nothing to review: well done!' : 'Words you miss or skip will appear here.',
  });
  drawWordTable(flow, learned, {
    title: 'Words learned',
    subtitle: listSubtitle('Answered correctly at least once', learned.length, totals.wordsLearned, 'most recent'),
    emptyText: 'Words you answer correctly will appear here.',
  });

  drawFooters(doc, data?.source);
  return documentToBuffer(doc);
}
