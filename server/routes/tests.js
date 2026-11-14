/**
 * Test routes (SPEC §7.2 "Tests"). Mounted at `/api/tests`; every route requires a session.
 * @module server/routes/tests
 */
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { Validator, bodyOf, parseId } from '../http.js';
import {
  HINT_TYPES, answerQuestion, parseAnswerInput, parseSkipInput, skipQuestion, useHint,
} from '../services/answers.js';
import {
  questionDetail, questionPublic, questionResult, questionStub, testSummary,
} from '../services/serializers.js';
import {
  TEST_STATUSES, closeTest, createTest, currentQuestion, deleteTest, lastAnsweredQuestion, listTests,
  loadTest, parseCreateInput, readTitle, renameTest, testMode,
} from '../services/tests.js';

/**
 * Build the tests router.
 * @param {{ db: import('../db.js').Database, bank: import('../services/wordbank.js').WordBank }} deps
 * @returns {import('express').Router}
 */
export function testRoutes(deps) {
  const { db, bank } = deps;
  const router = Router();
  router.use(requireAuth);

  const testId = (req) => parseId(req.params.id, 'Test');
  const questionId = (req) => parseId(req.params.qid, 'Question');

  /** AnswerResponse for an answer or skip. */
  const answerResponse = ({ test, question, next, completed, firstSeen }) => ({
    result: questionResult(bank, question),
    test: testSummary(test),
    next: next ? questionPublic(next, testMode(test)) : null,
    completed,
    firstSeen,
  });

  router.get('/', async (req, res) => {
    const v = new Validator(req.query);
    const status = v.oneOf('status', ['all', ...TEST_STATUSES], { optional: true, label: 'Status' }) ?? 'all';
    v.assert();
    res.json({ tests: (await listTests(db, req.user.id, status)).map(testSummary) });
  });

  router.post('/', async (req, res) => {
    const { test, current } = await createTest(deps, req.user.id, parseCreateInput(bodyOf(req)));
    res.status(201).json({ test: testSummary(test), current: questionPublic(current, testMode(test)) });
  });

  router.get('/:id', async (req, res) => {
    const { test, questions } = await loadTest(db, req.user.id, testId(req));
    res.json({
      test: testSummary(test),
      questions: questions.map((q) => questionDetail(bank, q, testMode(test))),
    });
  });

  router.get('/:id/state', async (req, res) => {
    const { test, questions } = await loadTest(db, req.user.id, testId(req));
    const current = currentQuestion(test, questions);
    const last = lastAnsweredQuestion(questions);
    res.json({
      test: testSummary(test),
      questions: questions.map(questionStub),
      current: current ? questionPublic(current, testMode(test)) : null,
      lastResult: last ? questionResult(bank, last) : null,
    });
  });

  router.post('/:id/questions/:qid/hint', async (req, res) => {
    const v = new Validator(bodyOf(req));
    const type = v.oneOf('type', HINT_TYPES, { label: 'Hint type' });
    v.assert();
    const { test, question } = await useHint(db, req.user.id, testId(req), questionId(req), type);
    res.json({ question: questionPublic(question, testMode(test)) });
  });

  router.post('/:id/questions/:qid/answer', async (req, res) => {
    const input = parseAnswerInput(bodyOf(req));
    res.json(answerResponse(await answerQuestion(db, req.user.id, testId(req), questionId(req), input)));
  });

  router.post('/:id/questions/:qid/skip', async (req, res) => {
    const input = parseSkipInput(bodyOf(req));
    res.json(answerResponse(await skipQuestion(db, req.user.id, testId(req), questionId(req), input)));
  });

  router.post('/:id/close', async (req, res) => {
    res.json({ test: testSummary(await closeTest(db, req.user.id, testId(req))) });
  });

  router.patch('/:id', async (req, res) => {
    const id = testId(req);
    const v = new Validator(bodyOf(req));
    const title = readTitle(v, false);
    v.assert();
    res.json({ test: testSummary(await renameTest(db, req.user.id, id, title)) });
  });

  router.delete('/:id', async (req, res) => {
    await deleteTest(db, req.user.id, testId(req));
    res.status(204).end();
  });

  return router;
}
