/**
 * PDF progress reports (SPEC §9).
 *
 * Both renderers are pure functions of their input (no DB, no network) and
 * resolve to a complete PDF file. Fonts are Noto Sans JP, embedded and
 * subset per document by pdfkit.
 */

export { renderTestReport } from './testReport.js';
export { renderOverallReport } from './overallReport.js';
