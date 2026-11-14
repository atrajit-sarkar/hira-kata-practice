/**
 * Low-level text primitives for the report renderers.
 *
 * All text is placed by its alphabetic baseline and never through pdfkit's own
 * line wrapper, which would add pages on its own. Wrapping and truncation are
 * done here with exact glyph metrics, so layout code always knows where text
 * ends and pagination stays fully under the renderer's control.
 */

import { COLORS, FONTS, cleanText } from './theme.js';

const ELLIPSIS = '…';
/** Distance from the baseline to the visual centre of mixed Latin/kana text, in em. */
const OPTICAL_CENTER = 0.36;

/**
 * Select font, size and fill colour in one call.
 * @param {PDFKit.PDFDocument} doc
 * @param {{ bold?: boolean, size?: number, color?: string }} style
 */
export function setStyle(doc, { bold = false, size = 10, color = COLORS.ink } = {}) {
  doc.font(bold ? FONTS.bold : FONTS.regular).fontSize(size).fillColor(color);
  return doc;
}

/** Code point → whether the embedded fonts have a glyph for it. */
const coverage = new Map();

function hasGlyph(doc, cp) {
  let known = coverage.get(cp);
  if (known === undefined) {
    // pdfkit exposes the fontkit font of an embedded TTF as `_font.font`.
    const font = doc._font?.font;
    known = typeof font?.hasGlyphForCodePoint === 'function' ? font.hasGlyphForCodePoint(cp) : true;
    coverage.set(cp, known);
  }
  return known;
}

/**
 * Look-alike replacements for letters Noto Sans JP lacks and Unicode
 * decomposition cannot fold (dictionary glosses use a few: Łódź, ʿUmar …).
 */
const LOOKALIKES = new Map([
  ['ł', 'l'], ['Ł', 'L'], ['đ', 'd'], ['Đ', 'D'], ['ħ', 'h'], ['ı', 'i'], ['ŀ', 'l'],
  ['ʿ', '‘'], ['ʾ', '’'], ['ʻ', '‘'], ['ʼ', '’'], ['≒', '≈'],
]);

/** True when every character of `text` has a glyph in the current font. */
function allGlyphs(doc, text) {
  for (const ch of text) if (!hasGlyph(doc, ch.codePointAt(0))) return false;
  return true;
}

/**
 * A drawable stand-in for a character the font lacks: a look-alike, or the
 * base letter without its accents (ą → a, ṭ → t, ș → s); null when none.
 */
function substitute(doc, ch) {
  const lookalike = LOOKALIKES.get(ch);
  if (lookalike && allGlyphs(doc, lookalike)) return lookalike;
  const base = ch.normalize('NFD').replace(/\p{M}+/gu, '');
  return base && base !== ch && allGlyphs(doc, base) ? base : null;
}

/**
 * Whether the embedded fonts draw every character of `text` as written (no
 * substitution). Used to leave out kanji forms the font cannot show.
 * @param {PDFKit.PDFDocument} doc
 * @param {string} text
 * @returns {boolean}
 */
export function canDraw(doc, text) {
  doc.font(FONTS.regular);
  return allGlyphs(doc, String(text ?? ''));
}

/**
 * Normalise user text for drawing in the current font: collapse whitespace,
 * fold accented letters the font lacks to their base letter, and replace each
 * remaining run of characters the font cannot draw (emoji, rare scripts) with a
 * single '?', so nothing renders as an empty box.
 */
function printable(doc, text) {
  let out = '';
  let missing = false;
  for (const ch of cleanText(text)) {
    const fallback = hasGlyph(doc, ch.codePointAt(0)) ? ch : substitute(doc, ch);
    if (fallback) {
      out += fallback;
      missing = false;
    } else if (!missing) {
      out += '?';
      missing = true;
    }
  }
  return out;
}

/** Width of `text` in the given style. */
export function measure(doc, text, style) {
  setStyle(doc, style);
  return doc.widthOfString(printable(doc, text));
}

/**
 * Truncate `text` with an ellipsis so it fits `maxWidth` in the current style.
 * With `force`, the ellipsis is appended even when the text already fits.
 */
function fitWithEllipsis(doc, text, maxWidth, force = false) {
  if (!force && doc.widthOfString(text) <= maxWidth) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = chars.slice(0, mid).join('').trimEnd() + ELLIPSIS;
    if (doc.widthOfString(candidate) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '' : chars.slice(0, lo).join('').trimEnd() + ELLIPSIS;
}

/**
 * Truncate `text` to fit `maxWidth` in `style`, adding an ellipsis when cut.
 * @returns {string}
 */
export function truncate(doc, text, maxWidth, style) {
  setStyle(doc, style);
  return fitWithEllipsis(doc, printable(doc, text), maxWidth);
}

/**
 * Draw a single line of text with its baseline at `y`.
 * @param {PDFKit.PDFDocument} doc
 * @param {string} text
 * @param {number} x left edge (or right edge for align 'right', centre for 'center')
 * @param {number} y baseline
 * @param {{ bold?: boolean, size?: number, color?: string, width?: number,
 *           align?: 'left'|'center'|'right', characterSpacing?: number }} [opts]
 *   `width` truncates with an ellipsis.
 * @returns {number} the drawn width
 */
export function textLine(doc, text, x, y, opts = {}) {
  const { align = 'left', width, characterSpacing = 0 } = opts;
  setStyle(doc, opts);
  let str = printable(doc, text);
  if (Number.isFinite(width)) str = fitWithEllipsis(doc, str, width);
  if (!str) return 0;
  const w = doc.widthOfString(str, { characterSpacing });
  const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  doc.text(str, left, y, { lineBreak: false, baseline: 'alphabetic', characterSpacing });
  return w;
}

/**
 * Largest font size in [minSize, maxSize] at which `text` fits `width`.
 * @returns {number}
 */
export function fitSize(doc, text, width, { maxSize, minSize, bold = false }) {
  const w = measure(doc, text, { bold, size: maxSize });
  if (w <= width) return maxSize;
  return Math.max(minSize, Math.floor((maxSize * width * 10) / w) / 10);
}

/** Baseline that visually centres text of `size` inside a box starting at `top` with `height`. */
export function centerBaseline(top, height, size) {
  return top + height / 2 + size * OPTICAL_CENTER;
}

/** True when a line may break after `ch` without a space (CJK and kana). */
function isBreakableChar(ch) {
  const cp = ch.codePointAt(0);
  return (cp >= 0x3000 && cp <= 0x30ff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xffef);
}

/** Split text into wrap units: words with their trailing space, or single CJK characters. */
function tokenize(text) {
  const tokens = [];
  let current = '';
  for (const ch of Array.from(text)) {
    if (isBreakableChar(ch)) {
      if (current) tokens.push(current);
      tokens.push(ch);
      current = '';
    } else if (ch === ' ') {
      tokens.push(current + ' ');
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Wrap `text` into at most `maxLines` lines of `width`; the last line gets an
 * ellipsis when text remains. Over-long words are broken by character.
 * @returns {string[]}
 */
export function wrapLines(doc, text, width, style, maxLines = Infinity) {
  setStyle(doc, style);
  const lines = [];
  let line = '';
  let truncated = false;
  const push = (value) => {
    if (lines.length >= maxLines) {
      truncated = true;
      return false;
    }
    lines.push(value.trimEnd());
    return true;
  };
  for (const token of tokenize(printable(doc, text))) {
    if (truncated) break;
    if (doc.widthOfString((line + token).trimEnd()) <= width) {
      line += token;
      continue;
    }
    if (line && !push(line)) break;
    line = '';
    if (doc.widthOfString(token.trimEnd()) <= width) {
      line = token;
      continue;
    }
    // A single word wider than the line: hard-break it by characters.
    for (const ch of Array.from(token)) {
      if (line && doc.widthOfString(line + ch) > width) {
        if (!push(line)) break;
        line = '';
      }
      line += ch;
    }
  }
  if (!truncated && line.trim()) push(line);
  if (truncated && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = fitWithEllipsis(doc, lines[last], width, true);
  }
  return lines;
}

/**
 * Draw wrapped text; the first baseline is `y` and each next one `lineHeight` lower.
 * @returns {number} the baseline of the last drawn line
 */
export function textBlock(doc, text, x, y, width, opts = {}) {
  const { lineHeight = (opts.size ?? 10) * 1.45, maxLines = Infinity } = opts;
  const lines = wrapLines(doc, text, width, opts, maxLines);
  lines.forEach((line, index) => {
    textLine(doc, line, x, y + index * lineHeight, { ...opts, width: undefined });
  });
  return y + Math.max(0, lines.length - 1) * lineHeight;
}
