/**
 * Small vector icons for the reports (SPEC §15.6): the three input methods
 * (kana keys, handwriting, device keyboard) and the listen-mode speaker.
 * Every icon is drawn centred on (cx, cy) inside a square of side `size`, in
 * strokes and fills only, so it stays crisp at any zoom and needs no glyphs.
 */

import { COLORS } from './theme.js';

/** Input methods in display order. */
export const INPUT_METHODS = Object.freeze(['keys', 'handwriting', 'device']);

/** Fallback labels when the report data carries none (SPEC §15.6). */
export const DEFAULT_INPUT_LABELS = Object.freeze({
  keys: 'Kana keys', handwriting: 'Handwriting', device: 'Device keyboard',
});
export const DEFAULT_MODE_LABELS = Object.freeze({ romaji: 'Romaji → write', listen: 'Listen → write' });

/** Accent colour per input method (icons and meters). */
export const INPUT_COLORS = Object.freeze({
  keys: COLORS.brand, handwriting: COLORS.pen, device: COLORS.device,
});

/** On-screen kana keys: a keyboard with two rows of keys and a space bar. */
function drawKeysIcon(doc, cx, cy, size, color) {
  const w = size;
  const h = size * 0.68;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const line = Math.max(0.6, size * 0.075);
  doc.roundedRect(x, y, w, h, size * 0.13).lineWidth(line).strokeColor(color).stroke();
  const key = size * 0.11;
  const gapX = (w - size * 0.2 - key * 4) / 3;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const kx = x + size * 0.1 + col * (key + gapX);
      const ky = y + h * 0.2 + row * key * 1.7;
      doc.rect(kx, ky, key, key).fill(color);
    }
  }
  doc.roundedRect(cx - w * 0.26, y + h * 0.72, w * 0.52, key * 0.95, key * 0.45).fill(color);
}

/** Handwriting: a brush pen at an angle above a short ink stroke. */
function drawPenIcon(doc, cx, cy, size, color) {
  const line = Math.max(0.6, size * 0.075);
  doc.save();
  doc.translate(cx + size * 0.08, cy - size * 0.1).rotate(45);
  const bodyW = size * 0.24;
  const bodyH = size * 0.7;
  doc.roundedRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH * 0.78, bodyW * 0.3).lineWidth(line).strokeColor(color).stroke();
  // Nib: a filled tip below the barrel.
  doc.polygon([-bodyW / 2, bodyH * 0.28], [bodyW / 2, bodyH * 0.28], [0, bodyH * 0.56]).fill(color);
  doc.restore();
  // The ink stroke the pen just made.
  doc.save();
  doc.lineWidth(line).lineCap('round').strokeColor(color);
  doc.moveTo(cx - size * 0.48, cy + size * 0.4)
    .bezierCurveTo(cx - size * 0.32, cy + size * 0.22, cx - size * 0.18, cy + size * 0.52, cx - size * 0.04, cy + size * 0.36)
    .stroke();
  doc.restore();
}

/** Device keyboard: a phone with its own keyboard in the lower half. */
function drawDeviceIcon(doc, cx, cy, size, color) {
  const w = size * 0.6;
  const h = size;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const line = Math.max(0.6, size * 0.075);
  doc.roundedRect(x, y, w, h, size * 0.12).lineWidth(line).strokeColor(color).stroke();
  const dot = size * 0.085;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      doc.rect(cx + (col - 1) * w * 0.26 - dot / 2, y + h * 0.5 + row * dot * 2, dot, dot).fill(color);
    }
  }
  doc.roundedRect(cx - w * 0.2, y + h * 0.83, w * 0.4, dot * 0.8, dot * 0.4).fill(color);
}

/**
 * Draw the icon of an input method; unknown methods draw nothing.
 * @param {PDFKit.PDFDocument} doc
 * @param {'keys'|'handwriting'|'device'} method
 * @returns {boolean} whether an icon was drawn
 */
export function drawInputIcon(doc, method, cx, cy, size = 10, color = INPUT_COLORS[method]) {
  const draw = { keys: drawKeysIcon, handwriting: drawPenIcon, device: drawDeviceIcon }[method];
  if (!draw) return false;
  doc.save();
  draw(doc, cx, cy, size, color ?? COLORS.secondary);
  doc.restore();
  return true;
}

/** Speaker with two sound waves (listen mode). */
export function drawSpeakerIcon(doc, cx, cy, size = 10, color = COLORS.brand) {
  const s = size;
  const left = cx - s * 0.5;
  doc.save();
  doc.polygon(
    [left, cy - s * 0.16], [left + s * 0.2, cy - s * 0.16], [left + s * 0.46, cy - s * 0.4],
    [left + s * 0.46, cy + s * 0.4], [left + s * 0.2, cy + s * 0.16], [left, cy + s * 0.16],
  ).fill(color);
  doc.lineWidth(Math.max(0.6, s * 0.08)).lineCap('round').strokeColor(color);
  const ox = left + s * 0.48;
  for (const r of [s * 0.2, s * 0.38]) {
    const a = Math.PI / 3.4;
    doc.moveTo(ox + r * Math.cos(-a), cy + r * Math.sin(-a));
    doc.bezierCurveTo(
      ox + r * 1.32 * Math.cos(-a / 2), cy + r * 1.32 * Math.sin(-a / 2),
      ox + r * 1.32 * Math.cos(a / 2), cy + r * 1.32 * Math.sin(a / 2),
      ox + r * Math.cos(a), cy + r * Math.sin(a),
    ).stroke();
  }
  doc.restore();
}
