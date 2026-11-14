/**
 * Results page (`/results/:id`, SPEC §12.5): grade seal, score ring, stat tiles, script meters,
 * words to practise and the question review. `?fresh=1` (set by the practice page after a test
 * ends) celebrates once and is then stripped from the URL.
 * @module pages/results
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { date, number } from '../ui/format.js';
import { celebrate } from '../ui/confetti.js';
import { toast } from '../ui/toast.js';
import { setLoading } from '../ui/form.js';
import { CELEBRATE_GRADES, STATUS_LABEL, gradeInfo, scriptBreakdown } from '../results/grade.js';
import { gradeSeal } from '../results/seal.js';
import { scoreRing } from '../results/score-ring.js';
import { missedWords, scriptMeters, statTiles } from '../results/summary.js';
import { reviewList } from '../results/review-list.js';
import { modeChip, modeOf } from '../results/practice-meta.js';

const STATUS_CHIP = { active: 'chip-brand', completed: 'chip-success', closed: 'chip-neutral' };
const STAMP_DELAY_MS = 520;

function loadingView() {
  return h('div', { class: 'results-loading', 'aria-busy': 'true', 'aria-label': 'Loading results' },
    h('div', { class: 'skeleton', style: { height: '220px', borderRadius: 'var(--r-xl)' } }),
    h('div', { class: 'results-tiles' }, Array.from({ length: 5 }, () => h('div', { class: 'skeleton', style: { height: '112px', borderRadius: 'var(--r-lg)' } }))),
    h('div', { class: 'skeleton', style: { height: '320px', borderRadius: 'var(--r-lg)' } }));
}

function notFoundView() {
  return h('div', { class: 'card' }, h('div', { class: 'empty-state' },
    h('div', { class: 'empty-state-icon' }, icon('search', { size: 26 })),
    h('h2', null, 'Test not found'),
    h('p', null, 'It may have been deleted, or it belongs to another account.'),
    h('div', { class: 'empty-state-actions' },
      h('a', { class: 'btn btn-primary', href: '#/dashboard' }, icon('home', { size: 18 }), 'Go to dashboard'))));
}

function resumeBanner(test) {
  const answered = test.correctCount + test.wrongCount + test.skippedCount;
  return h('div', { class: 'results-banner', role: 'status' },
    h('span', { class: 'results-banner-icon' }, icon('play', { size: 18 })),
    h('div', { class: 'results-banner-text' },
      h('strong', null, 'This test is still in progress'),
      h('span', null, `${number(answered)} of ${number(test.totalQuestions)} words answered. These are your results so far.`)),
    h('a', { class: 'btn btn-primary btn-sm', href: `#/practice/${test.id}` }, 'Resume test', icon('arrow-right', { size: 16 })));
}

function heroMessage(test, answered) {
  const info = gradeInfo(test.grade);
  if (info) return h('p', { class: 'results-hero-message' }, h('strong', null, info.label), ' · ', info.message);
  if (test.status === 'active') return h('p', { class: 'results-hero-message' }, 'Answer your first word to get a grade.');
  return h('p', { class: 'results-hero-message' },
    answered ? 'No grade for this test.' : 'This test ended before any words were answered.');
}

function metaLine(test) {
  const when = test.finishedAt
    ? `${test.status === 'closed' ? 'Ended' : 'Finished'} ${date(test.finishedAt, { time: true })}`
    : `Started ${date(test.createdAt, { time: true })}`;
  return h('p', { class: 'results-hero-meta' },
    h('span', { class: ['chip', 'chip-dot', STATUS_CHIP[test.status] || 'chip-neutral'] }, STATUS_LABEL[test.status] || test.status),
    modeChip(modeOf(test.config), { size: 'md', full: true }),
    test.config?.pool === 'common' ? h('span', { class: 'chip chip-neutral' }, 'Common words') : null,
    h('span', null, `${number(test.totalQuestions)} words · ${when}`));
}

/**
 * Action buttons for the hero card.
 * @param {object} test TestSummary
 * @param {object} ctx page context
 * @returns {HTMLElement}
 */
function actions(test, ctx) {
  const mistakes = test.wrongCount + test.skippedCount;
  const practise = h('button', {
    class: ['btn', mistakes ? 'btn-primary' : 'btn-secondary'],
    type: 'button',
    disabled: !mistakes,
    title: mistakes ? undefined : 'No mistakes to practise in this test',
  }, icon('refresh', { size: 18 }), mistakes ? `Practise mistakes (${number(mistakes)})` : 'No mistakes to practise');
  practise.addEventListener('click', async () => {
    setLoading(practise, true);
    try {
      const { test: retry } = await ctx.api.tests.create({ source: 'test-mistakes', sourceTestId: test.id });
      ctx.navigate(`/practice/${retry.id}`);
    } catch (err) {
      setLoading(practise, false);
      toast(err.message, { type: 'error' });
    }
  });

  const pdfHref = `${ctx.api.tests.reportUrl(test.id)}?tz=${new Date().getTimezoneOffset()}`;
  return h('div', { class: 'results-actions' },
    practise,
    h('a', { class: 'btn btn-secondary', href: pdfHref, download: '' }, icon('download', { size: 18 }), 'Download PDF'),
    h('a', { class: 'btn btn-secondary', href: '#/dashboard?new=1' }, icon('plus', { size: 18 }), 'New test'),
    h('a', { class: 'btn btn-ghost', href: '#/dashboard' }, icon('home', { size: 18 }), 'Dashboard'));
}

/**
 * Build the full results view.
 * @param {{test: object, questions: object[]}} data GET /api/tests/:id
 * @param {object} ctx page context
 * @param {boolean} fresh the learner just finished the test
 * @returns {{el: HTMLElement, start: () => () => void}}
 */
function resultsView({ test, questions }, ctx, fresh) {
  const answered = test.correctCount + test.wrongCount + test.skippedCount;
  const seal = gradeSeal(test.grade, { animate: fresh });
  const ring = scoreRing({ score: test.score, answeredMaxScore: test.answeredMaxScore, scorePercent: test.scorePercent, answered });
  const review = reviewList(questions);

  const hero = h('section', { class: ['card', 'results-hero', `is-${test.status}`], 'aria-labelledby': 'results-title' },
    h('div', { class: 'results-hero-seal' }, seal),
    h('div', { class: 'results-hero-text' },
      h('p', { class: 'eyebrow' }, fresh && test.status !== 'active' ? 'Test complete' : 'Test results'),
      h('h1', { id: 'results-title' }, test.title.replace(/ · /g, `${String.fromCharCode(0xa0)}· `)), // wrap after a dot, never before it
      metaLine(test),
      heroMessage(test, answered)),
    h('div', { class: 'results-hero-ring' }, ring.el),
    actions(test, ctx));

  const el = h('div', { class: 'results-content' },
    test.status === 'active' ? resumeBanner(test) : null,
    hero,
    statTiles(test),
    h('div', { class: 'results-grid' },
      scriptMeters(scriptBreakdown(questions)),
      missedWords(questions, { answered, onSelect: review.reveal })),
    review.el);

  const start = () => {
    const stopRing = ring.start();
    let timer = 0;
    if (fresh && CELEBRATE_GRADES.has(test.grade)) timer = setTimeout(celebrate, STAMP_DELAY_MS);
    return () => { stopRing(); clearTimeout(timer); };
  };
  return { el, start };
}

export default {
  title: 'Results',
  layout: 'app',
  auth: true,
  async render(root, ctx) {
    const { id } = ctx.params;
    const fresh = ctx.query.fresh === '1';
    if (fresh) ctx.navigate(`/results/${encodeURIComponent(id)}`, { replace: true, silent: true });

    const page = h('div', { class: 'container page results-page' }, loadingView());
    root.appendChild(page);

    let data;
    try {
      data = await ctx.api.tests.get(id);
    } catch (err) {
      if (err.status === 404) {
        page.replaceChildren(notFoundView());
        return undefined;
      }
      throw err;
    }
    if (!page.isConnected) return undefined;

    document.title = `${data.test.title} · Results · HiraKata`;
    const view = resultsView(data, ctx, fresh);
    page.replaceChildren(view.el);
    return view.start();
  },
};
