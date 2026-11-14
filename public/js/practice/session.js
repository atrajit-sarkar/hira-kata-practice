/**
 * Practice session: the client-side state machine for one test and its API calls.
 *
 *   loading ──► question ──► checking ──► feedback ──► question …
 *                  ▲             │            └──────► complete (last answer)
 *                  └── error ────┘  (network/server error: back to question, answer kept)
 *
 * The session never touches the DOM. It emits `change` events that the page controller renders.
 * @module practice/session
 */
import { ApiError } from '../api.js';

/** Session phases. */
export const PHASE = Object.freeze({
  LOADING: 'loading',
  QUESTION: 'question',
  CHECKING: 'checking',
  FEEDBACK: 'feedback',
  COMPLETE: 'complete',
});

/** Error codes that mean "our view of the test is stale". */
const STALE_CODES = new Set(['QUESTION_NOT_CURRENT']);

export class PracticeSession {
  /**
   * @param {string|number} testId
   * @param {object} api the `api` object from api.js
   */
  constructor(testId, api) {
    this.testId = testId;
    this.api = api;
    /** @type {string} */
    this.phase = PHASE.LOADING;
    /** @type {object|null} TestSummary */
    this.test = null;
    /** @type {Array<{id: number, position: number, status: string}>} */
    this.questions = [];
    /** @type {object|null} QuestionPublic */
    this.current = null;
    /** @type {object|null} QuestionResult of the most recent answer */
    this.result = null;
    /** True when the most recent result was the first time the learner met the word. */
    this.firstSeen = false;
    /** @type {object|null} next QuestionPublic, held while feedback is shown */
    this.pendingNext = null;
    this.listeners = new Set();
    this.hintInFlight = null;
  }

  /**
   * Subscribe to state changes.
   * @param {(event: {type: string, session: PracticeSession, [k: string]: any}) => void} fn
   *   event types: 'change' (phase or data changed), 'stale' (resynced after a 409),
   *   'inactive' (test is no longer active)
   * @returns {() => void} unsubscribe
   */
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, extra = {}) {
    for (const fn of this.listeners) fn({ type, session: this, ...extra });
  }

  setPhase(phase) {
    const previous = this.phase;
    this.phase = phase;
    this.emit('change', { previous });
  }

  /** @returns {boolean} true while the test can still be answered */
  get isActive() {
    return this.test?.status === 'active';
  }

  /**
   * Load (or reload) the test state from the server.
   * @returns {Promise<boolean>} false when the test is no longer active (caller redirects)
   * @throws {ApiError} on network/server errors or 404
   */
  async load() {
    const data = await this.api.tests.state(this.testId);
    this.test = data.test;
    this.questions = data.questions || [];
    this.current = data.current || null;
    this.result = null;
    this.pendingNext = null;
    if (!this.isActive || !this.current) return false;
    this.setPhase(PHASE.QUESTION);
    return true;
  }

  /**
   * Use a hint on the current question (idempotent on the server).
   * @param {'script'|'spelling'} type
   * @returns {Promise<object>} updated QuestionPublic
   */
  async useHint(type) {
    if (this.phase !== PHASE.QUESTION || !this.current) throw new Error('No question to hint.');
    if (this.hintInFlight) return this.hintInFlight;
    const qid = this.current.id;
    this.hintInFlight = this.api.tests.hint(this.testId, qid, type)
      .then(({ question }) => {
        if (this.current?.id === qid) this.current = question;
        return question;
      })
      .catch((err) => this.handleError(err))
      .finally(() => { this.hintInFlight = null; });
    return this.hintInFlight;
  }

  /**
   * Submit an answer for the current question.
   * @param {{answer: string, timeMs: number, hint2From?: number, hint2Revealed?: number}} payload
   * @returns {Promise<object|null>} AnswerResponse, or null when a submit is already running
   */
  submit(payload) {
    return this.send((id, qid) => this.api.tests.answer(id, qid, payload));
  }

  /**
   * Skip the current question.
   * @param {number} timeMs
   * @returns {Promise<object|null>} AnswerResponse, or null when a submit is already running
   */
  skip(timeMs) {
    return this.send((id, qid) => this.api.tests.skip(id, qid, { timeMs }));
  }

  async send(call) {
    if (this.phase !== PHASE.QUESTION || !this.current) return null;
    this.setPhase(PHASE.CHECKING);
    try {
      const res = await call(this.testId, this.current.id);
      this.test = res.test;
      this.result = res.result;
      this.firstSeen = Boolean(res.firstSeen);
      this.pendingNext = res.next;
      this.questions = this.questions.map((q) => (q.id === res.result.id ? { ...q, status: res.result.status } : q));
      this.setPhase(res.completed || !res.next ? PHASE.COMPLETE : PHASE.FEEDBACK);
      return res;
    } catch (err) {
      this.phase = PHASE.QUESTION;
      this.emit('change', { previous: PHASE.CHECKING });
      return this.handleError(err);
    }
  }

  /** Move from feedback to the next question. */
  advance() {
    if (this.phase !== PHASE.FEEDBACK || !this.pendingNext) return;
    this.current = this.pendingNext;
    this.pendingNext = null;
    this.result = null;
    this.setPhase(PHASE.QUESTION);
  }

  /**
   * Close (end) the test. Idempotent on the server.
   * @returns {Promise<object>} TestSummary
   */
  async close() {
    const { test } = await this.api.tests.close(this.testId);
    this.test = test;
    return test;
  }

  /**
   * Translate API conflicts into resyncs; rethrow everything else for the UI.
   * @param {unknown} err
   * @returns {never|Promise<never>}
   */
  async handleError(err) {
    if (err instanceof ApiError && err.code === 'TEST_NOT_ACTIVE') {
      this.emit('inactive');
      throw err;
    }
    if (err instanceof ApiError && STALE_CODES.has(err.code)) {
      try {
        const active = await this.load();
        this.emit(active ? 'stale' : 'inactive');
      } catch { /* the original conflict is the more useful error */ }
    }
    throw err;
  }
}

/**
 * @param {unknown} err
 * @returns {boolean} true for errors worth retrying (network, 5xx, rate limiting)
 */
export function isRetryable(err) {
  return err instanceof ApiError && (err.status === 0 || err.status >= 500 || err.status === 429);
}
