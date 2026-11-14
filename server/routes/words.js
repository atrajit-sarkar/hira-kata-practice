/**
 * Public word-bank routes (SPEC §7.2 "Words"). Mounted at `/api/words`.
 * @module server/routes/words
 */
import { Router } from 'express';
import { Validator } from '../http.js';
import { readWordFilters } from '../services/tests.js';

export const SAMPLE_MAX = 20;

/**
 * Build the words router.
 * @param {{ bank: import('../services/wordbank.js').WordBank }} deps
 * @returns {import('express').Router}
 */
export function wordRoutes({ bank }) {
  const router = Router();

  router.get('/meta', (_req, res) => {
    res.json(bank.metaSummary());
  });

  router.get('/count', (req, res) => {
    const v = new Validator(req.query);
    const filters = readWordFilters(v);
    v.assert();
    res.json({ count: bank.count(filters) });
  });

  router.get('/sample', (req, res) => {
    const v = new Validator(req.query);
    const n = v.int('n', { min: 1, max: SAMPLE_MAX, optional: true, clamp: true, label: 'n' }) ?? 8;
    v.assert();
    res.json({ words: bank.sample(n).map((w) => bank.wordInfo(w)) });
  });

  return router;
}
