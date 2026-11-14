/**
 * Test-report specifics: config chips, the answer-breakdown card, the
 * input-method strip and the question table with highlighted answer diffs,
 * vector result marks and input-method icons.
 */

import { COLORS, capitalize, cleanText, num, percent } from './theme.js';
import { centerBaseline, fitSize, measure, textLine, wrapLines } from './text.js';
import { drawCard, drawChip, drawSectionTitle } from './components.js';
import { drawKanaWithDot, wordKanji, wordMeaning } from './sections.js';
import { drawTable } from './table.js';
import {
  DEFAULT_INPUT_LABELS, DEFAULT_MODE_LABELS, INPUT_COLORS, INPUT_METHODS, drawInputIcon, drawSpeakerIcon,
} from './icons.js';

const LEVEL_NAMES = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' };
const SOURCE_NAMES = { review: 'Review of mistakes', 'test-mistakes': 'Retry of a test' };
const ERROR_LABELS = { script: 'Wrong script', spelling: 'Spelling', empty: 'No answer' };
const POOL_NAMES = { common: 'Common words', all: 'Full dictionary' };
const ROW_HEIGHT = 31;
/** Taller rows for the few questions that carry three hint pills. */
const ROW_HEIGHT_3_HINTS = 38;
const LINE1 = 13.5;
const LINE2 = 24.5;

/** 'listen' or 'romaji' (the default, also for tests made before modes existed). */
export function modeOf(value) {
  return value === 'listen' ? 'listen' : 'romaji';
}

/** Display label of a practice mode, preferring the labels sent with the report data. */
export function modeLabel(mode, labels) {
  const key = modeOf(mode);
  return cleanText(labels?.[key]) || DEFAULT_MODE_LABELS[key];
}

/** Display label of an input method ('' for unknown methods). */
export function inputLabel(method, labels) {
  return cleanText(labels?.[method]) || DEFAULT_INPUT_LABELS[method] || '';
}

/** Chip for a practice mode (listen mode in violet). */
export function modeChip(mode, labels) {
  return { text: modeLabel(mode, labels), variant: modeOf(mode) === 'listen' ? 'listen' : 'neutral' };
}

/**
 * Chips describing a TestConfig: practice mode first, then script, word pool,
 * level and filters.
 * @param {object} config TestConfig
 * @param {{ modeLabels?: Record<string, string> }} [opts]
 */
export function configChips(config, { modeLabels } = {}) {
  if (!config || typeof config !== 'object') return [];
  const chips = [];
  chips.push(modeChip(config.mode, modeLabels));
  if (config.script === 'hiragana') chips.push({ text: 'ひらがな Hiragana', variant: 'hira' });
  else if (config.script === 'katakana') chips.push({ text: 'カタカナ Katakana', variant: 'kata' });
  else if (config.script) chips.push({ text: 'Mixed scripts', variant: 'neutral' });
  // Review and retry tests reuse earlier words, so the pool only describes random tests.
  if (POOL_NAMES[config.pool] && !SOURCE_NAMES[config.source]) chips.push({ text: POOL_NAMES[config.pool], variant: 'neutral' });
  const level = LEVEL_NAMES[config.level];
  chips.push({ text: level ?? 'All levels', variant: 'neutral' });
  if (config.pos && config.pos !== 'any') chips.push({ text: `${capitalize(config.pos)}s`, variant: 'neutral' });
  if (config.jlpt && config.jlpt !== 'any') chips.push({ text: `JLPT N${config.jlpt}`, variant: 'neutral' });
  if (num(config.count) > 0) chips.push({ text: `${config.count} words`, variant: 'neutral' });
  if (SOURCE_NAMES[config.source]) chips.push({ text: SOURCE_NAMES[config.source], variant: 'warning' });
  return chips;
}

/**
 * Stacked bar of correct / wrong / skipped / not answered with a legend.
 * @returns {number} height consumed
 */
export function drawBreakdownCard(doc, s, x, y, w) {
  const h = 104;
  drawCard(doc, x, y, w, h);
  textLine(doc, 'Answer breakdown', x + 14, y + 21, { bold: true, size: 10, color: COLORS.ink });
  textLine(doc, `${s.total} words`, x + w - 14, y + 21, { size: 7.5, color: COLORS.muted, align: 'right' });
  const parts = [
    { label: 'Correct', value: s.correct, color: COLORS.success },
    { label: 'Wrong', value: s.wrong, color: COLORS.danger },
    { label: 'Skipped', value: s.skipped, color: COLORS.faint },
    { label: 'Not answered', value: s.pending, color: COLORS.surface3 },
  ];
  const barX = x + 14;
  const barW = w - 28;
  const barY = y + 36;
  const barH = 12;
  doc.save();
  doc.roundedRect(barX, barY, barW, barH, barH / 2).clip();
  doc.rect(barX, barY, barW, barH).fill(COLORS.surface3);
  const total = Math.max(1, s.total);
  let cx = barX;
  for (const part of parts) {
    if (part.value <= 0) continue;
    const segW = (barW * part.value) / total;
    doc.rect(cx, barY, segW, barH).fill(part.color);
    cx += segW;
    // 2 pt paper gap between adjacent segments.
    if (cx < barX + barW - 0.5) doc.rect(cx - 1, barY, 2, barH).fill(COLORS.paper);
  }
  doc.restore();

  const colW = barW / 2;
  parts.forEach((part, index) => {
    const lx = barX + (index % 2) * colW;
    const ly = y + 66 + Math.floor(index / 2) * 18;
    doc.roundedRect(lx, ly - 7, 8, 8, 2).fill(part.color);
    if (part.color === COLORS.surface3) doc.roundedRect(lx, ly - 7, 8, 8, 2).lineWidth(0.5).strokeColor(COLORS.borderStrong).stroke();
    const labelW = textLine(doc, part.label, lx + 13, ly, { size: 8.5, color: COLORS.secondary });
    textLine(doc, String(part.value), lx + 13 + labelW + 5, ly, { bold: true, size: 8.5, color: COLORS.ink });
  });
  return h;
}

/** Vector result mark: ○ correct, × wrong, – skipped. */
function drawResultMark(doc, status, cx, cy) {
  doc.save();
  if (status === 'correct') {
    doc.circle(cx, cy, 5.2).lineWidth(1.7).strokeColor(COLORS.success).stroke();
  } else if (status === 'wrong') {
    doc.lineWidth(1.7).lineCap('round').strokeColor(COLORS.danger);
    doc.moveTo(cx - 4.4, cy - 4.4).lineTo(cx + 4.4, cy + 4.4).stroke();
    doc.moveTo(cx + 4.4, cy - 4.4).lineTo(cx - 4.4, cy + 4.4).stroke();
  } else if (status === 'skipped') {
    doc.lineWidth(1.7).lineCap('round').strokeColor(COLORS.faint);
    doc.moveTo(cx - 4.5, cy).lineTo(cx + 4.5, cy).stroke();
  }
  doc.restore();
}

/** Ops to render for the learner's answer; falls back to plain matches without a diff. */
function answerOps(q) {
  if (Array.isArray(q.diff) && q.diff.length) return q.diff;
  return Array.from(q.userAnswer ?? '').map((ch) => ({ op: 'match', expected: ch, actual: ch }));
}

/** Highlight colours for answer differences: red for mistakes, amber for same-sound spellings. */
const DIFF_TONES = {
  danger: { soft: COLORS.dangerSoft, text: COLORS.dangerText, line: COLORS.danger },
  variant: { soft: COLORS.warningSoft, text: COLORS.warningText, line: COLORS.warning },
};

/**
 * Draw the learner's answer with wrong characters highlighted:
 * substituted chars on a tint, extra chars struck through, missing chars
 * as dashed empty slots. Same-sound spellings (listen mode) use amber, not red.
 */
function drawAnswerDiff(doc, q, x, baseline, maxWidth) {
  const tone = q.errorType === 'variant' ? DIFF_TONES.variant : DIFF_TONES.danger;
  const ops = answerOps(q);
  const natural = ops.map((op) => (op.op === 'del' ? '　' : op.actual ?? '')).join('');
  const size = fitSize(doc, natural, maxWidth - ops.length * 0.6, { maxSize: 11, minSize: 7, bold: true });
  const style = { size, bold: true };
  const slotW = size * 0.72;
  const top = baseline - size * 0.9;
  const boxH = size * 1.12;
  let cx = x;
  for (const op of ops) {
    const ch = op.op === 'del' ? null : op.actual ?? '';
    const w = ch === null ? slotW : measure(doc, ch, style);
    if (cx + w > x + maxWidth) {
      textLine(doc, '…', cx, baseline, { size: 9, color: COLORS.muted });
      return;
    }
    if (op.op === 'match') {
      textLine(doc, ch, cx, baseline, { ...style, color: COLORS.ink });
    } else if (op.op === 'sub') {
      doc.roundedRect(cx - 0.8, top, w + 1.6, boxH, 2.5).fill(tone.soft);
      textLine(doc, ch, cx, baseline, { ...style, color: tone.text });
    } else if (op.op === 'ins') {
      // Extra character: tinted and struck through diagonally.
      doc.roundedRect(cx - 0.8, top, w + 1.6, boxH, 2.5).fill(tone.soft);
      textLine(doc, ch, cx, baseline, { ...style, color: tone.text });
      doc.save();
      doc.moveTo(cx, top + boxH - 1.5).lineTo(cx + w, top + 1.5).lineWidth(1).lineCap('round')
        .strokeColor(tone.line).stroke();
      doc.restore();
    } else {
      // Missing character: dashed empty slot.
      doc.save();
      doc.roundedRect(cx + 0.6, top + 1, w - 1.2, boxH - 2, 2).lineWidth(0.8).dash(1.6, { space: 1.4 })
        .strokeColor(tone.line).stroke();
      doc.undash();
      doc.restore();
    }
    cx += w + 0.6;
  }
}

function answerCell(c) {
  const { doc, row: q } = c;
  if (q.status === 'pending') {
    textLine(doc, 'Not answered', c.x, centerBaseline(c.y, c.h, 8), { size: 8, color: COLORS.faint });
    return;
  }
  if (q.status === 'skipped') {
    textLine(doc, 'Skipped', c.x, centerBaseline(c.y, c.h, 8.5), { size: 8.5, color: COLORS.muted });
    return;
  }
  const variant = q.status === 'correct' && q.errorType === 'variant';
  const label = variant ? 'Same sound' : q.status === 'wrong' ? ERROR_LABELS[q.errorType] : null;
  const hasAnswer = Boolean(q.userAnswer);
  const top = c.y + (c.h - ROW_HEIGHT) / 2;
  if (hasAnswer) {
    drawAnswerDiff(doc, q, c.x, label ? top + LINE1 + 1 : centerBaseline(c.y, c.h, 11), c.w);
  }
  if (label) {
    const style = { size: hasAnswer ? 6.8 : 8, color: variant ? COLORS.warningText : COLORS.dangerText, bold: hasAnswer };
    textLine(doc, label, c.x, hasAnswer ? top + LINE2 + 1 : centerBaseline(c.y, c.h, 8), {
      ...style, size: fitSize(doc, label, c.w, { maxSize: style.size, minSize: 5.8, bold: style.bold }), width: c.w,
    });
  }
}

function hintsCell(c) {
  const { doc, row: q } = c;
  const pills = [];
  if (q.hint1Used) pills.push({ text: 'Script', variant: 'brand' });
  if (q.hint2Used) pills.push({ text: 'Guided', variant: 'warning' });
  if (q.romajiHintUsed) pills.push({ text: 'Romaji', variant: 'listen' });
  if (!pills.length) return;
  const pillH = 11;
  const gap = 2.5;
  let y = c.y + (c.h - (pills.length * pillH + (pills.length - 1) * gap)) / 2;
  for (const pill of pills) {
    drawChip(doc, pill.text, c.x, y, { variant: pill.variant, size: 6.2, height: pillH });
    y += pillH + gap;
  }
}

function expectedCell(c) {
  const { doc, row: q } = c;
  if (!q.expected) {
    textLine(doc, '—', c.x, centerBaseline(c.y, c.h, 9), { size: 9, color: COLORS.faint });
    return;
  }
  const extra = [wordKanji(q.word, doc), q.word?.jlpt ? `N${q.word.jlpt}` : ''].filter(Boolean).join(' · ');
  const top = c.y + (c.h - ROW_HEIGHT) / 2;
  const baseline = extra ? top + LINE1 + 1 : centerBaseline(c.y, c.h, 11);
  // Bank words have at most 9 kana; 7 pt fits them all in this column.
  drawKanaWithDot(doc, q.expected, q.script, c.x, baseline, { size: 11, width: c.w, minSize: 7 });
  if (extra) textLine(doc, extra, c.x + 9, top + LINE2 + 1, { size: 6.8, color: COLORS.muted, width: c.w - 9 });
}

/**
 * Romaji prompt: long words shrink (down to 7 pt) before they are truncated.
 * A listen-mode question whose romaji was never revealed shows a faint speaker.
 */
const ROMAJI_VOWELS = new Set(Array.from('aeiouāīūēōâîûêô'));

/**
 * Where to break long romaji over two lines: the kana boundary nearest the
 * middle, so "biseibutsubunkai" splits as "biseibu / tsubunkai", never
 * "biseibut / subunkai". A boundary follows a vowel, a syllabic n (shin / bun),
 * the first consonant of a doubled one (sukurat / chimatchi), an apostrophe,
 * space or hyphen. Falls back to the exact middle when there is none.
 * @param {string[]} chars
 * @returns {number} index of the first character of the second line
 */
export function romajiSplitPoint(chars) {
  const lower = chars.map((ch) => ch.toLowerCase());
  const isVowel = (ch) => ROMAJI_VOWELS.has(ch);
  /** A syllabic n (ん): an n not followed by a vowel or y. */
  const syllabicN = (i) => lower[i] === 'n' && !isVowel(lower[i + 1]) && lower[i + 1] !== 'y';
  /** First letter of a doubled consonant (っ): tt, kk, ss, pp …, or the t of "tch". */
  const geminate = (i) => {
    const ch = lower[i];
    if (!ch || isVowel(ch) || ch === 'n' || !/[a-z]/.test(ch)) return false;
    return lower[i + 1] === ch || (ch === 't' && lower[i + 1] === 'c' && lower[i + 2] === 'h');
  };
  const middle = chars.length / 2;
  let best = -1;
  for (let i = 1; i < chars.length; i += 1) {
    const prev = lower[i - 1];
    const next = lower[i];
    const boundary = ((isVowel(prev) || prev === "'" || prev === ' ' || prev === '-') && !syllabicN(i))
      || (syllabicN(i - 1) && next !== "'")
      || geminate(i - 1);
    if (!boundary || next === "'" || next === '-') continue;
    if (best < 0 || Math.abs(i - middle) < Math.abs(best - middle)) best = i;
  }
  return best > 0 ? best : Math.ceil(middle);
}

function romajiCell(c) {
  const { doc, row: q } = c;
  const text = cleanText(q.romaji);
  if (!text) {
    drawSpeakerIcon(doc, c.x + 5, c.y + c.h / 2, 10, COLORS.faint);
    return;
  }
  const size = fitSize(doc, text, c.w, { maxSize: 9, minSize: 7 });
  if (measure(doc, text, { size }) <= c.w) {
    textLine(doc, text, c.x, centerBaseline(c.y, c.h, size), { size, color: COLORS.secondary, width: c.w });
    return;
  }
  // Very long romaji (full-dictionary compounds run to 22 letters): split over two lines.
  const chars = Array.from(text);
  const half = romajiSplitPoint(chars);
  const lines = [chars.slice(0, half).join('').trimEnd(), chars.slice(half).join('').trimStart()];
  const small = Math.min(...lines.map((line) => fitSize(doc, line, c.w, { maxSize: 7.5, minSize: 6 })));
  const first = centerBaseline(c.y, c.h, small) - small * 0.62;
  lines.forEach((line, index) => textLine(doc, line, c.x, first + index * small * 1.24, {
    size: small, color: COLORS.secondary, width: c.w,
  }));
}

function meaningCell(c) {
  const { doc, row: q } = c;
  if (!q.word) return;
  const style = { size: 7.8, color: COLORS.ink };
  const lines = wrapLines(doc, wordMeaning(q.word) || '—', c.w, style, 2);
  const first = centerBaseline(c.y, c.h, style.size) - (lines.length - 1) * 5;
  lines.forEach((line, index) => textLine(doc, line, c.x, first + index * 10, style));
}

/** Input-method icon of an answered question (nothing for skips, pending or pre-v2 answers). */
function inputCell(c) {
  drawInputIcon(c.doc, c.row.inputMethod, c.x + c.w / 2, c.y + c.h / 2, 10.5);
}

/**
 * Right-aligned legend of icons and labels, ending at `right`, on `baseline`.
 * @param {Array<{ icon: (cx: number, cy: number) => void, label: string }>} items
 */
function drawIconLegend(doc, items, right, baseline) {
  const style = { size: 7.2, color: COLORS.muted };
  const iconW = 11;
  const widths = items.map((item) => iconW + 3.5 + measure(doc, item.label, style));
  let x = right - widths.reduce((sum, w) => sum + w, 0) - (items.length - 1) * 10;
  items.forEach((item, index) => {
    item.icon(x + iconW / 2, baseline - 2.6);
    textLine(doc, item.label, x + iconW + 3.5, baseline, style);
    x += widths[index] + 10;
  });
}

/** Height of a question row: taller only when it carries three hint pills. */
function rowHeightOf(q) {
  const hints = [q.hint1Used, q.hint2Used, q.romajiHintUsed].filter(Boolean).length;
  return hints >= 3 ? ROW_HEIGHT_3_HINTS : ROW_HEIGHT;
}

/**
 * Question table section.
 * @param {import('./document.js').Flow} flow
 * @param {object[]} questions
 * @param {object} s counters from the test summary
 * @param {{ mode?: string, inputLabels?: Record<string, string> }} [opts]
 */
export function drawQuestionTable(flow, questions, s, { mode = 'romaji', inputLabels } = {}) {
  const { doc } = flow;
  const listen = modeOf(mode) === 'listen';
  flow.ensure(24 + 20 + ROW_HEIGHT);
  const subtitle = `${questions.length} words · ${s.answered} answered`;
  const titleY = flow.y;
  flow.advance(drawSectionTitle(flow, 'Questions', subtitle));
  if (!questions.length) return;

  // Legend for the icons used in the Input column (only methods that occur).
  const used = INPUT_METHODS.filter((m) => questions.some((q) => q.inputMethod === m));
  const legend = used.map((m) => ({
    icon: (cx, cy) => drawInputIcon(doc, m, cx, cy, 9.5), label: inputLabel(m, inputLabels),
  }));
  if (listen) legend.unshift({ icon: (cx, cy) => drawSpeakerIcon(doc, cx, cy, 9.5, COLORS.listen), label: 'Listen mode' });
  if (legend.length) drawIconLegend(doc, legend, flow.right, titleY + 11.5);

  drawTable(flow, {
    rowHeight: rowHeightOf,
    rows: questions,
    columns: [
      // Wide enough for three-digit positions (tests have up to 100 questions).
      { header: '#', width: 26, align: 'right', text: (q) => String(num(q.position) + 1), style: { size: 8, color: COLORS.muted } },
      { header: listen ? 'Heard' : 'Romaji', width: 66, render: romajiCell },
      { header: 'Correct', width: 88, render: expectedCell },
      { header: 'Your answer', width: 88, render: answerCell },
      {
        header: 'Result', width: 40, align: 'center',
        render: (c) => drawResultMark(doc, c.row.status, c.x + c.w / 2, c.y + c.h / 2),
      },
      {
        header: 'Pts', width: 28, align: 'right',
        render: (c) => {
          if (c.row.status === 'pending') return;
          const points = num(c.row.points);
          textLine(doc, String(points), c.x + c.w, centerBaseline(c.y, c.h, 9), {
            bold: points > 0, size: 9, color: points > 0 ? COLORS.ink : COLORS.faint, align: 'right',
          });
        },
      },
      { header: 'Input', width: 38, align: 'center', render: inputCell },
      { header: 'Hints', width: 44, render: hintsCell },
      { header: 'Meaning', flex: 1, render: meaningCell },
    ],
  });
  flow.advance(24);
}

/**
 * "How you answered" strip: one cell per input method with its icon, the
 * number of answers and their accuracy. Drawn only when some answer recorded
 * its input method (answers saved before v2 did not).
 * @param {import('./document.js').Flow} flow
 * @param {Record<string, { answered?: number, correct?: number, accuracy?: number }> | undefined} byInput
 * @param {Record<string, string> | undefined} labels
 */
export function drawInputStrip(flow, byInput, labels) {
  if (!byInput || typeof byInput !== 'object') return;
  const stats = INPUT_METHODS.map((m) => ({ method: m, ...(byInput[m] ?? {}) }));
  if (!stats.some((st) => num(st.answered) > 0)) return;
  const { doc } = flow;
  const h = 52;
  flow.ensure(h);
  const { y } = flow;
  drawCard(doc, flow.left, y, flow.width, h);
  const introW = 118;
  textLine(doc, 'How you answered', flow.left + 14, y + 23, { bold: true, size: 10, color: COLORS.ink });
  textLine(doc, 'Answers and accuracy per input', flow.left + 14, y + 36, { size: 7.5, color: COLORS.muted });
  const cellW = (flow.width - introW) / stats.length;
  stats.forEach((st, index) => {
    const x = flow.left + introW + index * cellW;
    const answered = num(st.answered);
    doc.moveTo(x, y + 10).lineTo(x, y + h - 10).lineWidth(0.5).strokeColor(COLORS.border).stroke();
    const color = answered ? INPUT_COLORS[st.method] : COLORS.faint;
    doc.roundedRect(x + 10, y + 13, 26, 26, 7).fill(answered ? COLORS.surface2 : COLORS.paper);
    doc.roundedRect(x + 10, y + 13, 26, 26, 7).lineWidth(0.5).strokeColor(COLORS.border).stroke();
    drawInputIcon(doc, st.method, x + 23, y + 26, 13, color);
    const textX = x + 43;
    const textW = cellW - 49;
    const label = inputLabel(st.method, labels);
    const labelStyle = { bold: true, size: 8.8, color: answered ? COLORS.ink : COLORS.muted };
    textLine(doc, label, textX, y + 23, { ...labelStyle, size: fitSize(doc, label, textW, { maxSize: 8.8, minSize: 7.5, bold: true }), width: textW });
    const accuracy = answered ? num(st.accuracy, num(st.correct) / answered) : null;
    const detail = answered ? `${answered} ${answered === 1 ? 'answer' : 'answers'} · ${percent(accuracy)}` : 'Not used';
    textLine(doc, detail, textX, y + 36, { size: fitSize(doc, detail, textW, { maxSize: 7.5, minSize: 6.6 }), color: COLORS.muted, width: textW });
  });
  flow.advance(h + 22);
}
