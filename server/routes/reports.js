/**
 * PDF report downloads (SPEC §7.2, §9). Mounted at `/api`.
 * The PDF renderer is imported lazily so the API works even while it is unavailable.
 * @module server/routes/reports
 */
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { Validator, parseId } from '../http.js';
import { buildOverallReportData, buildTestReportData } from '../services/reportData.js';
import { TZ_RANGE, localDate } from '../services/stats.js';

/**
 * Read the optional `tz` query parameter (minutes, clamped).
 * @param {Record<string, unknown>} query
 * @returns {number}
 */
function readTz(query) {
  const v = new Validator(query);
  const tz = v.int('tz', { ...TZ_RANGE, optional: true, clamp: true, label: 'Time zone offset' }) ?? 0;
  v.assert();
  return tz;
}

/**
 * Send a PDF buffer as a download.
 * @param {import('express').Response} res
 * @param {Buffer} pdf
 * @param {string} filename
 */
function sendPdf(res, pdf, filename) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'Content-Length': String(pdf.length),
  });
  res.end(pdf);
}

/**
 * Build the reports router.
 * @param {{ db: import('node:sqlite').DatabaseSync, bank: import('../services/wordbank.js').WordBank }} deps
 * @returns {import('express').Router}
 */
export function reportRoutes(deps) {
  const router = Router();

  router.get('/tests/:id/report.pdf', requireAuth, async (req, res) => {
    const id = parseId(req.params.id, 'Test');
    const tz = readTz(req.query);
    const now = new Date();
    const data = buildTestReportData(deps, req.user, id, { tz, now });
    const { renderTestReport } = await import('../report/pdf.js');
    sendPdf(res, await renderTestReport(data), `hirakata-test-${id}-${localDate(now, tz)}.pdf`);
  });

  router.get('/reports/overall.pdf', requireAuth, async (req, res) => {
    const tz = readTz(req.query);
    const now = new Date();
    const data = buildOverallReportData(deps, req.user, { tz, now });
    const { renderOverallReport } = await import('../report/pdf.js');
    sendPdf(res, await renderOverallReport(data), `hirakata-progress-${localDate(now, tz)}.pdf`);
  });

  return router;
}
