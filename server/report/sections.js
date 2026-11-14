/**
 * Report sections shared by the test and overall reports: the title block,
 * the hiragana/katakana card, weak-kana tiles and word lists.
 */

import {
  COLORS, capitalize, cleanText, num, percent,
} from './theme.js';
import { canDraw, centerBaseline, fitSize, measure, textLine, wrapLines } from './text.js';
import {
  drawCard, drawChip, drawChipRow, drawEmptyNote, drawMeterRow, drawSectionTitle, scriptMeterRows,
} from './components.js';
import { drawTable } from './table.js';

const STATUS_CHIPS = {
  active: { text: 'In progress', variant: 'brand' },
  completed: { text: 'Completed', variant: 'success' },
  closed: { text: 'Closed early', variant: 'neutral' },
};

/** Chip spec for a test status. */
export function statusChip(status) {
  return STATUS_CHIPS[status] ?? { text: capitalize(status || 'Unknown'), variant: 'neutral' };
}

/** "Atrajit · a@b.com", "Kenji · Guest account" or "Guest account". */
export function learnerLine(user) {
  const name = cleanText(user?.displayName) || 'Learner';
  if (user?.isGuest) return name === 'Guest' ? 'Guest account' : `${name} · Guest account`;
  return user?.email ? `${name} · ${cleanText(user.email)}` : name;
}

/**
 * Title block: large title (≤ 2 lines), a meta line and a row of chips.
 * @param {{ eyebrow: string, title: string, meta: string, chips: Array<{text: string, variant?: string}> }} block
 */
export function drawTitleBlock(flow, { eyebrow, title, meta, chips }) {
  const { doc } = flow;
  textLine(doc, eyebrow.toUpperCase(), flow.left, flow.y + 8, {
    bold: true, size: 7.5, color: COLORS.brand, characterSpacing: 0.85, width: flow.width,
  });
  const titleStyle = { bold: true, size: 19, color: COLORS.ink };
  const lines = wrapLines(doc, title, flow.width, titleStyle, 2);
  let baseline = flow.y + 32;
  lines.forEach((line, index) => textLine(doc, line, flow.left, baseline + index * 25, titleStyle));
  baseline += (lines.length - 1) * 25 + 18;
  textLine(doc, meta, flow.left, baseline, { size: 9, color: COLORS.secondary, width: flow.width });
  const chipsHeight = chips.length ? drawChipRow(doc, chips, flow.left, baseline + 9, flow.width) : 0;
  flow.y = baseline + 9 + chipsHeight + 20;
}

/**
 * Card with hiragana vs katakana accuracy meters, centred vertically in a card
 * of height `h`.
 * @returns {number} height consumed
 */
export function drawScriptCard(doc, byScript, x, y, w, h = 104) {
  drawCard(doc, x, y, w, h);
  textLine(doc, 'Hiragana vs katakana', x + 14, y + 21, { bold: true, size: 10, color: COLORS.ink });
  textLine(doc, 'Accuracy by script', x + w - 14, y + 21, { size: 7.5, color: COLORS.muted, align: 'right' });
  const spacing = h > 110 ? 42 : 32;
  const top = y + 36 + Math.max(0, (h - 46 - (24 + spacing)) / 2);
  scriptMeterRows(byScript).forEach((row, index) => {
    drawMeterRow(doc, row, x + 14, top + index * spacing, w - 28);
  });
  return h;
}

/**
 * Weak-kana tiles: big character in its script colour plus accuracy, in a grid.
 * @param {Array<{ char: string, script: string, correct: number, wrong: number, accuracy?: number }>} chars
 */
export function drawWeakKana(flow, chars, {
  title = 'Kana to practise', subtitle,
  emptyText = 'No weak kana yet. Characters you miss at least twice will appear here.',
} = {}) {
  const { doc } = flow;
  const columns = 5;
  const gap = 8;
  const tileH = 54;
  const tileW = (flow.width - gap * (columns - 1)) / columns;
  const rows = Math.max(1, Math.ceil(chars.length / columns));
  flow.ensure(24 + (chars.length ? tileH : 40) + 8);
  flow.advance(drawSectionTitle(flow, title, subtitle));
  if (!chars.length) {
    flow.advance(drawEmptyNote(doc, emptyText, flow.left, flow.y, flow.width) + 22);
    return;
  }
  for (let row = 0; row < rows; row += 1) {
    flow.ensure(tileH);
    const y = flow.y;
    chars.slice(row * columns, row * columns + columns).forEach((item, col) => {
      const x = flow.left + col * (tileW + gap);
      const isKata = item.script === 'katakana';
      const attempts = num(item.correct) + num(item.wrong);
      const accuracy = num(item.accuracy, attempts ? num(item.correct) / attempts : 0);
      drawCard(doc, x, y, tileW, tileH, { fill: COLORS.surface2 });
      doc.roundedRect(x + 8, y + 9, 36, 36, 8).fill(isKata ? COLORS.kataSoft : COLORS.hiraSoft);
      textLine(doc, item.char, x + 26, centerBaseline(y + 9, 36, 21), {
        bold: true, size: 21, color: COLORS.ink, align: 'center',
      });
      textLine(doc, percent(accuracy), x + 52, y + 24, { bold: true, size: 12, color: COLORS.ink });
      // Shrinks for large attempt counts ("12/140 missed") instead of truncating.
      const detail = `${num(item.wrong)}/${attempts} missed`;
      textLine(doc, detail, x + 52, y + 36, {
        size: fitSize(doc, detail, tileW - 58, { maxSize: 6.8, minSize: 5.4 }), color: COLORS.muted, width: tileW - 58,
      });
      doc.rect(x + 52, y + 42, tileW - 62, 2.5).fill(COLORS.surface3);
      doc.rect(x + 52, y + 42, (tileW - 62) * Math.max(0, Math.min(1, accuracy)), 2.5).fill(isKata ? COLORS.kata : COLORS.hira);
    });
    flow.advance(tileH + gap);
  }
  flow.advance(14);
}

/** First-sense meaning of a WordInfo (falls back to the glosses). */
export function wordMeaning(word) {
  if (!word) return '';
  if (word.meaning) return cleanText(word.meaning);
  const gloss = word.senses?.[0]?.gloss;
  return Array.isArray(gloss) ? cleanText(gloss.join('; ')) : '';
}

/**
 * Kanji forms joined, or '' when none. With `doc`, forms containing a
 * character the embedded font lacks (a handful of rare kanji in the full
 * dictionary) are left out rather than printed with a "?".
 */
export function wordKanji(word, doc) {
  if (!Array.isArray(word?.kanji)) return '';
  return word.kanji
    .filter((form) => typeof form === 'string' && form && (!doc || canDraw(doc, form)))
    .join('、');
}

/**
 * Draw kana with a small script-coloured dot in front; long words shrink (down
 * to `minSize`) to fit `width`, then truncate.
 */
export function drawKanaWithDot(doc, kana, script, x, baseline, { size = 11, width, minSize = 8 } = {}) {
  const color = script === 'katakana' ? COLORS.kata : script === 'hiragana' ? COLORS.hira : COLORS.faint;
  const textWidth = width ? width - 9 : undefined;
  const fitted = textWidth ? fitSize(doc, kana, textWidth, { maxSize: size, minSize, bold: true }) : size;
  doc.circle(x + 2.5, baseline - size * 0.36, 2.5).fill(color);
  return textLine(doc, kana, x + 9, baseline, { bold: true, size: fitted, color: COLORS.ink, width: textWidth });
}

/**
 * Word list table: kana (with script dot), romaji, kanji, meaning and a status cell.
 * @param {Array<{ word: object, status?: { text: string, variant: string } }>} items
 */
export function drawWordTable(flow, items, { title, subtitle, emptyText }) {
  const { doc } = flow;
  flow.ensure(24 + (items.length ? 20 + 30 * Math.min(3, items.length) : 40) + 8);
  flow.advance(drawSectionTitle(flow, title, subtitle));
  if (!items.length) {
    flow.advance(drawEmptyNote(doc, emptyText, flow.left, flow.y, flow.width) + 22);
    return;
  }
  drawTable(flow, {
    rowHeight: 30,
    rows: items,
    columns: [
      {
        header: 'Word', width: 112,
        render: (c) => drawKanaWithDot(doc, c.row.word?.kana ?? '', c.row.word?.script, c.x, centerBaseline(c.y, c.h, 11.5), { size: 11.5, width: c.w }),
      },
      { header: 'Romaji', width: 84, text: (r) => r.word?.romaji ?? '', style: { size: 8.5, color: COLORS.secondary } },
      { header: 'Kanji', width: 74, text: (r) => wordKanji(r.word, doc) || '—', style: { size: 9.5, color: COLORS.ink } },
      {
        header: 'Meaning', flex: 1,
        render: (c) => {
          const jlpt = c.row.word?.jlpt;
          const textWidth = c.w - (jlpt ? 28 : 0);
          const style = { size: 8, color: COLORS.ink };
          const lines = wrapLines(doc, wordMeaning(c.row.word) || '—', textWidth, style, 2);
          const first = centerBaseline(c.y, c.h, 8) - (lines.length - 1) * 5;
          lines.forEach((line, index) => textLine(doc, line, c.x, first + index * 10, style));
          if (jlpt) drawChip(doc, `N${jlpt}`, c.x + c.w - 22, c.y + (c.h - 12) / 2, { size: 6.5, height: 12 });
        },
      },
      {
        header: 'Status', width: 84, align: 'right',
        render: (c) => {
          if (!c.row.status) return;
          const w = measure(doc, c.row.status.text, { bold: true, size: 6.8 }) + 13 * 0.84;
          drawChip(doc, c.row.status.text, c.x + c.w - w, c.y + (c.h - 13) / 2, { variant: c.row.status.variant, size: 6.8, height: 13 });
        },
      },
    ],
  });
  flow.advance(22);
}

