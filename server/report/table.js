/**
 * Paginating table: zebra rows, header repeated on every page, rows never split,
 * the header never left alone at the bottom of a page and the last row never
 * alone at the top of one.
 */

import { COLORS } from './theme.js';
import { centerBaseline, textLine } from './text.js';

const CELL_PAD = 6;

/**
 * @typedef {object} TableColumn
 * @property {string} header         header label
 * @property {number} [width]        fixed width in points
 * @property {number} [flex]         share of the remaining width (when no `width`)
 * @property {'left'|'center'|'right'} [align]
 * @property {(row: any) => string} [text]  plain single-line cell text (truncated)
 * @property {object} [style]        text style for `text` cells
 * @property {(cell: CellContext) => void} [render]  custom cell drawing
 *
 * @typedef {object} CellContext
 * @property {PDFKit.PDFDocument} doc
 * @property {any} row
 * @property {number} index
 * @property {number} x  cell content left (padding applied)
 * @property {number} y  row top
 * @property {number} w  content width (padding applied)
 * @property {number} h  row height
 */

/** Resolve column widths; flex columns share whatever the fixed ones leave. */
function layoutColumns(columns, totalWidth) {
  const fixed = columns.reduce((sum, c) => sum + (c.width ?? 0), 0);
  const flexTotal = columns.reduce((sum, c) => sum + (c.width == null ? c.flex ?? 1 : 0), 0);
  const free = Math.max(0, totalWidth - fixed);
  let x = 0;
  return columns.map((column) => {
    const width = column.width ?? (free * (column.flex ?? 1)) / flexTotal;
    const placed = { ...column, x, width };
    x += width;
    return placed;
  });
}

function drawHeader(doc, columns, left, y, width, height) {
  doc.roundedRect(left, y, width, height, 5).fill(COLORS.surface3);
  for (const column of columns) {
    const align = column.align ?? 'left';
    const anchor = align === 'right'
      ? left + column.x + column.width - CELL_PAD
      : align === 'center' ? left + column.x + column.width / 2 : left + column.x + CELL_PAD;
    textLine(doc, column.header.toUpperCase(), anchor, centerBaseline(y, height, 6.8), {
      bold: true, size: 6.8, color: COLORS.secondary, align, characterSpacing: 0.5,
      width: column.width - CELL_PAD * 2,
    });
  }
}

function drawTextCell(cell, column) {
  const style = { size: 8.5, color: COLORS.ink, ...column.style };
  const align = column.align ?? 'left';
  const anchor = align === 'right' ? cell.x + cell.w : align === 'center' ? cell.x + cell.w / 2 : cell.x;
  textLine(cell.doc, column.text(cell.row), anchor, centerBaseline(cell.y, cell.h, style.size), {
    ...style, align, width: cell.w,
  });
}

/**
 * Draw a table at the flow cursor, paginating as needed.
 * @param {import('./document.js').Flow} flow
 * @param {{ columns: TableColumn[], rows: any[], rowHeight?: number | ((row: any) => number),
 *           headerHeight?: number }} spec
 */
export function drawTable(flow, { columns, rows, rowHeight = 22, headerHeight = 20 }) {
  const { doc } = flow;
  const placed = layoutColumns(columns, flow.width);
  const heightOf = typeof rowHeight === 'function' ? rowHeight : () => rowHeight;
  const header = () => {
    drawHeader(doc, placed, flow.left, flow.y, flow.width, headerHeight);
    flow.advance(headerHeight);
  };

  flow.ensure(headerHeight + (rows.length ? heightOf(rows[0]) : 0));
  header();
  rows.forEach((row, index) => {
    const h = heightOf(row);
    // Widow control: never leave the last row alone at the top of a new page.
    const keepWithLast = index >= 1 && index === rows.length - 2 ? heightOf(rows[index + 1]) : 0;
    const fitsAlone = flow.y + h <= flow.bottom;
    if (!fitsAlone || (keepWithLast && flow.y + h + keepWithLast > flow.bottom)) {
      flow.newPage();
      header();
    }
    const y = flow.y;
    if (index % 2 === 1) doc.rect(flow.left, y, flow.width, h).fill(COLORS.zebra);
    doc.moveTo(flow.left, y + h).lineTo(flow.right, y + h).lineWidth(0.5).strokeColor(COLORS.border).stroke();
    for (const column of placed) {
      const cell = {
        doc, row, index, x: flow.left + column.x + CELL_PAD, y, w: column.width - CELL_PAD * 2, h,
      };
      if (column.render) column.render(cell);
      else if (column.text) drawTextCell(cell, column);
    }
    flow.advance(h);
  });
}
