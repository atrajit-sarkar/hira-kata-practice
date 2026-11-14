/**
 * Vector charts for the overall report.
 */

import { COLORS, formatDayKey, num } from './theme.js';
import { textLine } from './text.js';

/** Bar with rounded top corners and a square base anchored to the baseline. */
function topRoundedBar(doc, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h);
  doc.moveTo(x, y + h)
    .lineTo(x, y + radius)
    .quadraticCurveTo(x, y, x + radius, y)
    .lineTo(x + w - radius, y)
    .quadraticCurveTo(x + w, y, x + w, y + radius)
    .lineTo(x + w, y + h)
    .closePath();
}

/**
 * Round an axis maximum up to a "nice" even integer (1, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ),
 * so the labelled half-way gridline is a whole number too.
 */
export function niceMax(value) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const nice = [1, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude);
  return nice.find((max) => max >= value && max % 2 === 0);
}

/**
 * Stacked daily activity bars (correct at the base, missed on top) with a
 * hairline grid, a y-axis scale, weekly date labels and a legend.
 * @param {Array<{ date: string, answered: number, correct: number }>} days oldest → newest
 * @param {{ x: number, y: number, w: number, h: number }} box plot area including axis labels
 */
export function drawActivityBars(doc, days, { x, y, w, h }) {
  const axisW = 24;
  const labelH = 14;
  const plotX = x + axisW;
  const plotW = w - axisW;
  const plotH = h - labelH;
  const baseY = y + plotH;
  const max = niceMax(Math.max(0, ...days.map((d) => num(d.answered))));

  for (const fraction of [0, 0.5, 1]) {
    const gy = baseY - plotH * fraction;
    doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).lineWidth(fraction === 0 ? 0.8 : 0.5)
      .strokeColor(fraction === 0 ? COLORS.axis : COLORS.grid).stroke();
    textLine(doc, String(Math.round(max * fraction)), plotX - 6, gy + 2.4, { size: 6.8, color: COLORS.muted, align: 'right' });
  }

  const slot = plotW / Math.max(1, days.length);
  const barW = Math.min(12, slot * 0.64);
  days.forEach((day, index) => {
    const answered = Math.max(0, num(day.answered));
    const correct = Math.min(answered, Math.max(0, num(day.correct)));
    const bx = plotX + index * slot + (slot - barW) / 2;
    if (answered > 0) {
      const totalH = Math.max(2, (plotH * answered) / max);
      const correctH = (totalH * correct) / answered;
      const missedH = totalH - correctH;
      if (missedH > 0.4) {
        topRoundedBar(doc, bx, baseY - totalH, barW, missedH - (correctH > 0 ? 1 : 0), 2);
        doc.fill(COLORS.seqLight);
      }
      if (correctH > 0) {
        if (missedH > 0.4) doc.rect(bx, baseY - correctH, barW, correctH).fill(COLORS.seq);
        else {
          topRoundedBar(doc, bx, baseY - correctH, barW, correctH, 2);
          doc.fill(COLORS.seq);
        }
      }
    }
    const fromEnd = days.length - 1 - index;
    if (fromEnd % 7 === 0) {
      textLine(doc, fromEnd === 0 ? 'Today' : formatDayKey(day.date), bx + barW / 2, baseY + 11, {
        size: 6.8, color: fromEnd === 0 ? COLORS.ink : COLORS.muted, bold: fromEnd === 0, align: 'center',
      });
    }
  });
}

/** Two-entry legend drawn right-aligned at (right, baseline). */
export function drawLegend(doc, items, right, baseline) {
  let cx = right;
  for (const item of [...items].reverse()) {
    const w = textLine(doc, item.label, cx, baseline, { size: 7.5, color: COLORS.secondary, align: 'right' });
    cx -= w + 12;
    doc.roundedRect(cx, baseline - 6.5, 8, 8, 2).fill(item.color);
    cx -= 14;
  }
}
