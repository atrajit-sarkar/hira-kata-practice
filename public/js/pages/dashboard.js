/**
 * Dashboard page (SPEC 12.3, 15.6): greeting, guest banner, Continue strip, KPI row, charts
 * (including the romaji-vs-listening and input-method breakdowns), the tests
 * list and the New test dialog (also opened by /dashboard?new=1).
 *
 * Data: GET /api/tests and GET /api/stats/overview load in parallel. The first load shows a
 * skeleton only if it takes longer than a moment; later refreshes keep the current view at
 * reduced opacity and swap in the new data (no skeleton flash).
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { renderHero, renderGuestBanner, renderWelcome } from '../dashboard/hero.js';
import { renderContinue } from '../dashboard/continue-strip.js';
import { renderKpis } from '../dashboard/kpis.js';
import { testsList } from '../dashboard/tests-list.js';
import { openNewTestDialog } from '../dashboard/new-test-dialog.js';
import { accuracyChart } from '../dashboard/accuracy-chart.js';
import { scriptMeters } from '../dashboard/script-meters.js';
import { activityHeatmap } from '../dashboard/heatmap.js';
import { kanaMastery } from '../dashboard/kana-mastery.js';
import { weakKana } from '../dashboard/weak-kana.js';
import { modeBreakdown, inputBreakdown } from '../dashboard/practice-mix.js';

const SKELETON_DELAY_MS = 180;

function skeleton() {
  const block = (cls) => h('div', { class: ['skeleton', cls] });
  return h('div', { class: 'dash-skeleton', 'aria-hidden': 'true' },
    h('div', { class: 'dash-kpis' }, Array.from({ length: 5 }, () => block('dash-skel-tile'))),
    h('div', { class: 'dash-charts' }, block('dash-skel-chart is-wide'), block('dash-skel-chart')),
    block('dash-skel-list'));
}

function errorPanel(err, onRetry) {
  const offline = err?.code === 'NETWORK_ERROR';
  return h('div', { class: 'card' }, h('div', { class: 'empty-state', role: 'alert' },
    h('div', { class: 'empty-state-icon' }, icon('alert-triangle', { size: 26 })),
    h('h2', null, offline ? 'You seem to be offline' : 'We couldn’t load your dashboard'),
    h('p', null, offline ? 'Check your connection and try again.' : (err?.message || 'Something went wrong. Please try again.')),
    h('div', { class: 'empty-state-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', on: { click: onRetry } }, icon('refresh', { size: 18 }), 'Try again'))));
}

export default {
  title: 'Dashboard',
  layout: 'app',
  auth: true,
  async render(root, ctx) {
    const { api, store, navigate } = ctx;
    const tz = new Date().getTimezoneOffset();
    let stats = null;
    let mode = null;
    let loadSeq = 0;
    let disposed = false;
    let dialogOpen = false;
    const dialogAbort = new AbortController();

    async function newTest(initial) {
      if (dialogOpen) return;
      dialogOpen = true;
      try {
        await openNewTestDialog({ reviewCount: stats?.totals.wordsToReview, initial, signal: dialogAbort.signal });
      } catch (err) {
        toast(err.message || 'Could not open the New test dialog.', { type: 'error' });
      } finally {
        dialogOpen = false;
      }
    }

    const hero = renderHero({
      name: store.user?.displayName || ctx.user?.displayName || 'there',
      reportUrl: api.reports.overallUrl({ tz }),
      onNewTest: () => newTest(),
    });
    const content = h('div', { class: 'dash-content', 'aria-busy': 'true' });
    const page = h('div', { class: 'container page dash' },
      hero.el,
      store.isGuest ? renderGuestBanner({ onSave: () => navigate('/register') }) : null,
      content);
    root.appendChild(page);

    // Persistent pieces: built once, updated in place on every refresh.
    const charts = {
      accuracy: accuracyChart(),
      scripts: scriptMeters(),
      modes: modeBreakdown({ onTryListen: () => newTest({ mode: 'listen' }) }),
      inputs: inputBreakdown(),
      heatmap: activityHeatmap(),
      mastery: kanaMastery(),
      weak: weakKana(),
    };
    const list = testsList({ navigate, onNewTest: () => newTest(), onMutate: () => load({ refresh: true }) });
    const reviewLabel = h('span');
    const reviewCta = h('div', { class: 'dash-chart-cta', hidden: true },
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', on: { click: () => newTest({ source: 'review' }) } },
        icon('refresh', { size: 16 }), reviewLabel));
    charts.weak.el.appendChild(reviewCta);
    const continueHost = h('div', { class: 'dash-continue-host' });
    const kpiHost = h('div', { class: 'dash-kpi-host' });
    const fullView = [
      continueHost,
      kpiHost,
      // The chart cards use h3 titles; this hidden h2 keeps the outline h1 > h2 > h3 (without it
      // they would sit under "Continue where you left off", or straight under the h1).
      h('section', { class: 'dash-charts', 'aria-labelledby': 'dash-charts-title' },
        h('h2', { class: 'visually-hidden', id: 'dash-charts-title' }, 'Progress charts'),
        charts.accuracy.el, charts.scripts.el, charts.modes.el, charts.inputs.el, charts.heatmap.el, charts.mastery.el, charts.weak.el),
      list.el,
    ];

    function show(tests, overview, { first }) {
      stats = overview;
      hero.update(stats);
      const welcome = !tests.length && !stats.totals.answered;
      const nextMode = welcome ? 'welcome' : 'full';
      if (nextMode !== mode) {
        mode = nextMode;
        content.replaceChildren(...(welcome ? [renderWelcome({ onStart: (initial) => newTest(initial) })] : fullView));
      }
      if (welcome) return;
      continueHost.replaceChildren(renderContinue(tests, { navigate }) || '');
      kpiHost.replaceChildren(renderKpis(stats, { animate: first }));
      charts.accuracy.update(stats.accuracyTrend);
      charts.scripts.update(stats.byScript);
      charts.modes.update(stats.byMode);
      charts.inputs.update(stats.byInput);
      charts.heatmap.update(stats.daily);
      charts.mastery.update(stats.charStats);
      charts.weak.update(stats.weakChars);
      const toReview = stats.totals.wordsToReview;
      reviewCta.hidden = !toReview || !stats.weakChars.length;
      reviewLabel.textContent = `Review ${toReview === 1 ? 'the word' : `${toReview} words`} you missed`;
      list.setTests(tests);
    }

    let lastLoadedAt = 0;
    async function load({ refresh = false } = {}) {
      const seq = ++loadSeq;
      let timer = 0;
      content.setAttribute('aria-busy', 'true');
      if (refresh && mode) content.classList.add('is-refreshing');
      else timer = setTimeout(() => { if (seq === loadSeq && !disposed) content.replaceChildren(skeleton()); }, SKELETON_DELAY_MS);
      try {
        const [{ tests }, overview] = await Promise.all([api.tests.list('all'), api.stats.overview({ tz })]);
        if (disposed || seq !== loadSeq) return;
        lastLoadedAt = Date.now();
        show(tests, overview, { first: !refresh });
      } catch (err) {
        if (disposed || seq !== loadSeq || err.status === 401) return;
        if (refresh && mode) {
          toast(err.message || 'Could not refresh your dashboard.', { type: 'error' });
        } else {
          mode = null;
          content.replaceChildren(errorPanel(err, () => load()));
        }
      } finally {
        clearTimeout(timer);
        if (seq === loadSeq && !disposed) {
          content.classList.remove('is-refreshing');
          content.setAttribute('aria-busy', 'false');
        }
      }
    }

    // Coming back to a tab that has been in the background for a while (e.g. after practising in
    // another tab) quietly refreshes the numbers.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && mode && Date.now() - lastLoadedAt > 60_000) load({ refresh: true });
    };
    document.addEventListener('visibilitychange', onVisible);

    const wantsNew = ctx.query?.new === '1';
    if (wantsNew) navigate('/dashboard', { replace: true, silent: true });
    load().then(() => {
      if (wantsNew && !disposed) newTest();
    });

    return () => {
      disposed = true;
      dialogAbort.abort();
      document.removeEventListener('visibilitychange', onVisible);
      for (const c of Object.values(charts)) c.destroy();
      list.destroy();
    };
  },
};
