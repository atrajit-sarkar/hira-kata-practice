/**
 * Statistics route (SPEC §7.2 "Stats & vocab"). Mounted at `/api/stats`.
 * @module server/routes/stats
 */
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { computeOverview, parseStatsQuery } from '../services/stats.js';

/**
 * Build the stats router.
 * @param {{ db: import('../db.js').Database }} deps
 * @returns {import('express').Router}
 */
export function statsRoutes({ db }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/overview', async (req, res) => {
    const { tz, days } = parseStatsQuery(req.query);
    res.json(await computeOverview(db, req.user.id, { tz, days }));
  });

  return router;
}
