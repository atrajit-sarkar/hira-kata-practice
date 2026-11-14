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
  TEST_STATUSES, closeTest, createTest, currentQuestion, deleteTest, findTest, lastAnsweredQuestion,
  listTests, parseCreateInput, readTitle, renameTest, testMode, testQuestions,
} from '../services/tests.js';

/**
 * Build the tests router.
 * @param {{ db: import('node:sqlite').DatabaseSync, bank: import('../services/wordbank.js').WordBank }} deps
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

  router.get('/', (req, res) => {
    const v = new Validator(req.query);
    const status = v.oneOf('status', ['all', ...TEST_STATUSES], { optional: true, label: 'Status' }) ?? 'all';
    v.assert();
    res.json({ tests: listTests(db, req.user.id, status).map(testSummary) });
  });

  router.post('/', (req, res) => {
    const id = createTest(deps, req.user.id, parseCreateInput(bodyOf(req)));
    const test = findTest(db, req.user.id, id);
    res.status(201).json({ test: testSummary(test), current: questionPublic(currentQuestion(db, test), testMode(test)) });
  });

  router.get('/:id', (req, res) => {
    const test = findTest(db, req.user.id, testId(req));
    res.json({
      test: testSummary(test),
      questions: testQuestions(db, test.id).map((q) => questionDetail(bank, q, testMode(test))),
    });
  });

  router.get('/:id/state', (req, res) => {
    const test = findTest(db, req.user.id, testId(req));
    const current = currentQuestion(db, test);
    const last = lastAnsweredQuestion(db, test.id);
    res.json({
      test: testSummary(test),
      questions: testQuestions(db, test.id).map(questionStub),
      current: current ? questionPublic(current, testMode(test)) : null,
      lastResult: last ? questionResult(bank, last) : null,
    });
  });

  router.post('/:id/questions/:qid/hint', (req, res) => {
    const v = new Validator(bodyOf(req));
    const type = v.oneOf('type', HINT_TYPES, { label: 'Hint type' });
    v.assert();
    const { test, question } = useHint(db, req.user.id, testId(req), questionId(req), type);
    res.json({ question: questionPublic(question, testMode(test)) });
  });

  router.post('/:id/questions/:qid/answer', (req, res) => {
    const input = parseAnswerInput(bodyOf(req));
    res.json(answerResponse(answerQuestion(db, req.user.id, testId(req), questionId(req), input)));
  });

  router.post('/:id/questions/:qid/skip', (req, res) => {
    const input = parseSkipInput(bodyOf(req));
    res.json(answerResponse(skipQuestion(db, req.user.id, testId(req), questionId(req), input)));
  });

  router.post('/:id/close', (req, res) => {
    res.json({ test: testSummary(closeTest(db, req.user.id, testId(req))) });
  });

  router.patch('/:id', (req, res) => {
    const id = testId(req);
    const v = new Validator(bodyOf(req));
    const title = readTitle(v, false);
    v.assert();
    res.json({ test: testSummary(renameTest(db, req.user.id, id, title)) });
  });

  router.delete('/:id', (req, res) => {
    deleteTest(db, req.user.id, testId(req));
    res.status(204).end();
  });

  return router;
}
