/**
 * Vocabulary routes (SPEC §7.2 "Stats & vocab"). Mounted at `/api/vocab`.
 * @module server/routes/vocab
 */
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { Validator, bodyOf } from '../http.js';
import { listVocab, parseVocabQuery, setStarred } from '../services/vocab.js';

/**
 * Build the vocab router.
 * @param {{ db: import('../db.js').Database, bank: import('../services/wordbank.js').WordBank }} deps
 * @returns {import('express').Router}
 */
export function vocabRoutes({ db, bank }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    res.json(await listVocab(db, bank, req.user.id, parseVocabQuery(req.query)));
  });

  router.post('/:wordId/star', async (req, res) => {
    const v = new Validator(bodyOf(req));
    const starred = v.bool('starred', { label: 'Starred' });
    v.assert();
    res.json({ starred: await setStarred(db, bank, req.user.id, req.params.wordId, starred) });
  });

  return router;
}
