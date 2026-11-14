/**
 * Reusable vector components for the reports: section headings, chips, stat
 * tiles, the hanko grade seal and accuracy meters.
 */

import {
  COLORS, GRADE_KANJI, GRADE_LABEL, clamp, formatNumber, isNum, num, percent,
} from './theme.js';
import { centerBaseline, fitSize, measure, textLine, truncate } from './text.js';

/** Chip colour variants: [background, text]. */
const CHIP_VARIANTS = {
  neutral: [COLORS.surface3, COLORS.secondary],
  brand: [COLORS.brandSoft, COLORS.brandDark],
  hira: [COLORS.hiraSoft, '#1c5cab'],
  kata: [COLORS.kataSoft, '#a8431a'],
  success: [COLORS.successSoft, COLORS.successText],
  danger: [COLORS.dangerSoft, COLORS.dangerText],
  warning: [COLORS.warningSoft, COLORS.warningText],
  listen: [COLORS.listenSoft, COLORS.listenText],
};

/**
 * Section heading with a short indigo accent bar.
 * @returns {number} height consumed
 */
export function drawSectionTitle(flow, title, subtitle) {
  const { doc } = flow;
  const y = flow.y;
  doc.roundedRect(flow.left, y + 1, 3, 13, 1.5).fill(COLORS.brand);
  const titleWidth = textLine(doc, title, flow.left + 10, y + 12, { bold: true, size: 12.5, color: COLORS.ink });
  if (subtitle) {
    textLine(doc, subtitle, flow.left + 10 + titleWidth + 10, y + 11.5, {
      size: 8.5, color: COLORS.muted, width: flow.width - titleWidth - 30,
    });
  }
  return 24;
}

/**
 * Small rounded label.
 * @returns {number} chip width
 */
export function drawChip(doc, text, x, y, { variant = 'neutral', size = 7.5, height = 15, bold = true } = {}) {
  const [bg, fg] = CHIP_VARIANTS[variant] ?? CHIP_VARIANTS.neutral;
  const padX = height * 0.42;
  const w = measure(doc, text, { bold, size }) + padX * 2;
  doc.roundedRect(x, y, w, height, height / 2).fill(bg);
  textLine(doc, text, x + padX, centerBaseline(y, height, size), { bold, size, color: fg });
  return w;
}

/**
 * A row of chips that wraps onto further lines.
 * @param {Array<{ text: string, variant?: string }>} chips
 * @returns {number} height consumed
 */
export function drawChipRow(doc, chips, x, y, maxWidth, opts = {}) {
  const height = opts.height ?? 15;
  const gap = 5;
  let cx = x;
  let cy = y;
  for (const chip of chips) {
    const w = measure(doc, chip.text, { bold: true, size: opts.size ?? 7.5 }) + height * 0.84;
    if (cx > x && cx + w > x + maxWidth) {
      cx = x;
      cy += height + gap;
    }
    cx += drawChip(doc, chip.text, cx, cy, { ...opts, variant: chip.variant }) + gap;
  }
  return cy - y + height;
}

/**
 * Stat tile: caption, big value, optional detail line and optional accent stripe.
 * @param {{ label: string, value: string, detail?: string, accent?: string, valueColor?: string }} tile
 */
export function drawStatTile(doc, tile, x, y, w, h) {
  doc.lineWidth(0.6).roundedRect(x, y, w, h, 8).fillAndStroke(COLORS.surface2, COLORS.border);
  if (tile.accent) {
    doc.save();
    doc.roundedRect(x, y, w, h, 8).clip();
    doc.rect(x, y, 3, h).fill(tile.accent);
    doc.restore();
  }
  const pad = 11;
  const inner = w - pad * 2;
  textLine(doc, tile.label.toUpperCase(), x + pad, y + 17, {
    bold: true, size: 6.8, color: COLORS.muted, width: inner, characterSpacing: 0.7,
  });
  textLine(doc, tile.value, x + pad, y + 39, { bold: true, size: 17, color: tile.valueColor ?? COLORS.ink, width: inner });
  if (tile.detail) {
    // Long details ("6 script · 4 guided · 12 romaji") shrink a little before they truncate.
    const size = fitSize(doc, tile.detail, inner, { maxSize: 7.5, minSize: 6.2 });
    textLine(doc, tile.detail, x + pad, y + h - 10, { size, color: COLORS.secondary, width: inner });
  }
}

/**
 * Lay out tiles in a grid.
 * @returns {number} height consumed
 */
export function drawTileGrid(doc, tiles, x, y, width, { columns, tileHeight = 64, gap = 8 }) {
  const w = (width - gap * (columns - 1)) / columns;
  tiles.forEach((tile, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    drawStatTile(doc, tile, x + col * (w + gap), y + row * (tileHeight + gap), w, tileHeight);
  });
  const rows = Math.ceil(tiles.length / columns);
  return rows * tileHeight + (rows - 1) * gap;
}

/**
 * Hanko-style grade seal centred at (cx, cy), with the grade descriptor below.
 * A null grade draws a neutral "not graded" seal.
 */
export function drawGradeSeal(doc, grade, cx, cy, radius) {
  const kanji = GRADE_KANJI[grade];
  const color = kanji ? COLORS.accent : COLORS.faint;
  doc.save();
  doc.circle(cx, cy, radius).lineWidth(2.4).strokeColor(color).stroke();
  doc.circle(cx, cy, radius - 4.5).lineWidth(0.8).strokeColor(color).stroke();
  doc.restore();
  if (!kanji) {
    textLine(doc, '–', cx, centerBaseline(cy - radius, radius * 2, 26), { bold: true, size: 26, color, align: 'center' });
    return;
  }
  const kanjiSize = kanji.length > 1 ? radius * 0.62 : radius * 0.86;
  textLine(doc, kanji, cx, cy + kanjiSize * 0.22, { bold: true, size: kanjiSize, color, align: 'center' });
  const badgeW = 22;
  const badgeY = cy + radius * 0.42;
  doc.roundedRect(cx - badgeW / 2, badgeY, badgeW, 14, 7).fill(color);
  textLine(doc, grade, cx, centerBaseline(badgeY, 14, 8.5), { bold: true, size: 8.5, color: '#ffffff', align: 'center' });
}

/** Descriptor for a grade letter ("Excellent"), or "Not graded yet". */
export function gradeDescriptor(grade) {
  return GRADE_LABEL[grade] ?? 'Not graded yet';
}

/**
 * Labelled meter: label + sublabel and value + detail on one line, a full-width
 * rounded track with the fill below. Height 30.
 * @param {{ label: string, sublabel?: string, ratio: number|null, color: string, value: string, detail?: string }} row
 */
export function drawMeterRow(doc, row, x, y, width) {
  const baseline = y + 10;
  const labelW = textLine(doc, row.label, x, baseline, { bold: true, size: 10, color: COLORS.ink });
  if (row.sublabel) textLine(doc, row.sublabel, x + labelW + 6, baseline - 0.5, { size: 7.5, color: COLORS.muted });
  const valueW = textLine(doc, row.value, x + width, baseline, { bold: true, size: 10, color: COLORS.ink, align: 'right' });
  if (row.detail) {
    textLine(doc, row.detail, x + width - valueW - 7, baseline - 0.5, { size: 7.5, color: COLORS.muted, align: 'right' });
  }
  const barH = 7;
  const barY = y + 17;
  doc.roundedRect(x, barY, width, barH, barH / 2).fill(COLORS.surface3);
  if (isNum(row.ratio) && row.ratio > 0) {
    doc.roundedRect(x, barY, Math.max(barH, width * clamp(row.ratio, 0, 1)), barH, barH / 2).fill(row.color);
  }
}

/** Meter rows for hiragana vs katakana accuracy from a `{ answered, correct, accuracy }` pair. */
export function scriptMeterRows(byScript) {
  const row = (key, label, sublabel, color) => {
    const stats = byScript?.[key] ?? {};
    const answered = num(stats.answered);
    return {
      label,
      sublabel,
      color,
      ratio: answered > 0 ? num(stats.accuracy, num(stats.correct) / answered) : null,
      value: answered > 0 ? percent(num(stats.accuracy, num(stats.correct) / answered)) : '–',
      detail: answered > 0 ? `${formatNumber(stats.correct)} of ${formatNumber(answered)} correct` : 'No answers yet',
    };
  };
  return [
    row('hiragana', 'ひらがな', 'Hiragana', COLORS.hira),
    row('katakana', 'カタカナ', 'Katakana', COLORS.kata),
  ];
}

/**
 * Card frame with a soft border.
 */
export function drawCard(doc, x, y, w, h, { fill = COLORS.paper, stroke = COLORS.border } = {}) {
  doc.lineWidth(0.6);
  doc.roundedRect(x, y, w, h, 10).fillAndStroke(fill, stroke);
}

/**
 * Muted "nothing here yet" message inside a dashed frame.
 * @returns {number} height consumed
 */
export function drawEmptyNote(doc, text, x, y, width, height = 40) {
  doc.save();
  doc.roundedRect(x, y, width, height, 8).lineWidth(0.8).dash(3, { space: 3 }).strokeColor(COLORS.borderStrong).stroke();
  doc.undash();
  doc.restore();
  textLine(doc, truncate(doc, text, width - 24, { size: 9 }), x + width / 2, centerBaseline(y, height, 9), {
    size: 9, color: COLORS.muted, align: 'center',
  });
  return height;
}

