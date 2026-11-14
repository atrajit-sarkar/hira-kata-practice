/**
 * Document scaffolding shared by both reports: pdfkit setup, the brand header,
 * page flow (vertical cursor + page breaks) and the footer pass.
 */

import PDFDocument from 'pdfkit';
import {
  COLORS, DEFAULT_ATTRIBUTION, DEFAULT_JLPT_ATTRIBUTION, DEFAULT_KANJIVG_ATTRIBUTION, FONT_FILES, FONTS, PAGE, cleanText,
  formatDateTime,
} from './theme.js';
import { textBlock, textLine } from './text.js';

const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const FOOTER_RULE_Y = PAGE.height - PAGE.margin - 14;
/** Lowest y that page content may reach. */
const CONTENT_BOTTOM = FOOTER_RULE_Y - 14;
const CONTINUATION_TOP = PAGE.margin + 24;

/**
 * Create a pdfkit document with the embedded fonts registered and pages buffered
 * (needed for "page x / y" footers).
 * @param {{ title: string, author?: string, subject: string }} info
 */
export function createDocument({ title, author, subject }) {
  const doc = new PDFDocument({
    size: PAGE.size,
    margin: PAGE.margin,
    bufferPages: true,
    autoFirstPage: false,
    compress: true,
    info: {
      Title: title,
      Author: author || 'HiraKata',
      Subject: subject,
      Creator: 'HiraKata',
      Producer: 'HiraKata (pdfkit)',
    },
    lang: 'en',
  });
  doc.registerFont(FONTS.regular, FONT_FILES.regular);
  doc.registerFont(FONTS.bold, FONT_FILES.bold);
  return doc;
}

/**
 * Finish the document and collect its bytes.
 * @param {PDFKit.PDFDocument} doc
 * @returns {Promise<Buffer>}
 */
export function documentToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Draw the HiraKata logo mark: a rounded square split diagonally into the
 * hiragana blue (あ, top-left) and katakana orange (ア, bottom-right).
 */
export function drawLogoMark(doc, x, y, size) {
  const radius = size * 0.24;
  doc.save();
  doc.roundedRect(x, y, size, size, radius).clip();
  doc.polygon([x, y], [x + size, y], [x, y + size]).fill(COLORS.hira);
  doc.polygon([x + size, y], [x + size, y + size], [x, y + size]).fill(COLORS.kata);
  doc.restore();
  const glyph = size * 0.4;
  textLine(doc, 'あ', x + size * 0.3, y + size * 0.47, { bold: true, size: glyph, color: '#ffffff', align: 'center' });
  textLine(doc, 'ア', x + size * 0.7, y + size * 0.86, { bold: true, size: glyph, color: '#ffffff', align: 'center' });
}

/** Full brand band at the top of a report's first page. */
function drawHeaderBand(doc, { reportLabel, generatedAt, tzOffset }) {
  const h = PAGE.headerHeight;
  doc.rect(0, 0, PAGE.width, h).fill(COLORS.brand);
  // Oversized, nearly transparent kana bleeding off the right edge: a quiet texture.
  doc.save();
  doc.rect(0, 0, PAGE.width, h).clip();
  doc.fillOpacity(0.07);
  textLine(doc, 'かなカナ', PAGE.width + 18, h + 26, { bold: true, size: 112, color: '#ffffff', align: 'right' });
  doc.restore();
  doc.rect(0, h, PAGE.width, 2.5).fill(COLORS.accent);

  const m = PAGE.margin;
  const logo = 38;
  const logoY = (h - logo) / 2;
  doc.roundedRect(m - 2, logoY - 2, logo + 4, logo + 4, 11).fill('#ffffff');
  drawLogoMark(doc, m, logoY, logo);
  textLine(doc, 'HiraKata', m + logo + 14, h / 2 + 1, { bold: true, size: 21, color: '#ffffff' });
  textLine(doc, 'ひらカタ  ·  Kana writing practice', m + logo + 15, h / 2 + 17, { size: 8.5, color: COLORS.brandLine });

  const right = PAGE.width - m;
  textLine(doc, reportLabel.toUpperCase(), right, h / 2 - 2, {
    bold: true, size: 8.5, color: '#ffffff', align: 'right', characterSpacing: 1,
  });
  textLine(doc, `Generated ${formatDateTime(generatedAt, tzOffset)}`, right, h / 2 + 14, {
    size: 8.5, color: COLORS.brandLine, align: 'right',
  });
}

/** Slim running header for continuation pages. */
function drawRunningHeader(doc, { reportLabel, runningTitle }) {
  const m = PAGE.margin;
  doc.rect(0, 0, PAGE.width, 5).fill(COLORS.brand);
  drawLogoMark(doc, m, m - 18, 16);
  textLine(doc, 'HiraKata', m + 22, m - 5.5, { bold: true, size: 9.5, color: COLORS.ink });
  textLine(doc, `${reportLabel} · ${runningTitle}`, PAGE.width - m, m - 5.5, {
    size: 8, color: COLORS.muted, align: 'right', width: CONTENT_WIDTH - 90,
  });
  doc.moveTo(m, m + 4).lineTo(PAGE.width - m, m + 4).lineWidth(0.6).strokeColor(COLORS.border).stroke();
}

/**
 * Vertical layout cursor that owns page creation. Content is drawn at
 * `flow.y`; callers reserve space with `ensure()` before drawing a block that
 * must not be split across pages.
 */
export class Flow {
  /**
   * @param {PDFKit.PDFDocument} doc
   * @param {{ reportLabel: string, runningTitle: string, generatedAt?: string, tzOffset?: number }} header
   */
  constructor(doc, header) {
    this.doc = doc;
    this.header = header;
    this.left = PAGE.margin;
    this.width = CONTENT_WIDTH;
    this.right = PAGE.width - PAGE.margin;
    this.bottom = CONTENT_BOTTOM;
    /** Callbacks run after a page break (e.g. to repeat a table header). */
    this.onPageBreak = null;
    doc.addPage();
    drawHeaderBand(doc, header);
    this.y = PAGE.headerHeight + 26;
  }

  /** Remaining vertical space on the current page. */
  get remaining() {
    return this.bottom - this.y;
  }

  /** Start a new page below a running header. */
  newPage() {
    this.doc.addPage();
    drawRunningHeader(this.doc, this.header);
    this.y = CONTINUATION_TOP;
    if (this.onPageBreak) this.onPageBreak();
  }

  /**
   * Make sure `height` points are available, breaking the page when not.
   * @returns {boolean} true when a page break happened
   */
  ensure(height) {
    if (this.y + height <= this.bottom) return false;
    this.newPage();
    return true;
  }

  /** Advance the cursor. */
  advance(height) {
    this.y += height;
  }
}

/**
 * Draw the footer on every buffered page: attribution on the left and
 * "Page x / y" on the right. Must run after all content is laid out.
 * @param {PDFKit.PDFDocument} doc
 * @param {{ attribution?: string, jlptAttribution?: string|null, kanjivgAttribution?: string|null } | undefined} source
 *   a null jlpt/KanjiVG attribution leaves that line out
 */
export function drawFooters(doc, source) {
  const parts = [cleanText(source?.attribution) || DEFAULT_ATTRIBUTION];
  const jlpt = source?.jlptAttribution === null ? '' : cleanText(source?.jlptAttribution) || DEFAULT_JLPT_ATTRIBUTION;
  if (jlpt) parts.push(jlpt);
  const kanjivg = source?.kanjivgAttribution === null ? '' : cleanText(source?.kanjivgAttribution) || DEFAULT_KANJIVG_ATTRIBUTION;
  if (kanjivg) parts.push(kanjivg);
  parts.push('Font: Noto Sans JP (SIL OFL)');
  const attribution = parts.join('  ·  ');

  const range = doc.bufferedPageRange();
  const m = PAGE.margin;
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Footer text sits inside the bottom margin; keep pdfkit from paginating.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(m, FOOTER_RULE_Y).lineTo(PAGE.width - m, FOOTER_RULE_Y).lineWidth(0.6).strokeColor(COLORS.border).stroke();
    textBlock(doc, attribution, m, FOOTER_RULE_Y + 11, CONTENT_WIDTH - 70, {
      size: 6.3, color: COLORS.muted, lineHeight: 8.6, maxLines: 3,
    });
    textLine(doc, `Page ${i - range.start + 1} / ${range.count}`, PAGE.width - m, FOOTER_RULE_Y + 11, {
      bold: true, size: 7.5, color: COLORS.secondary, align: 'right',
    });
    doc.page.margins.bottom = savedBottom;
  }
}

