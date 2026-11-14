/**
 * KPI row: five stat tiles summarising the learner's progress (StatsOverview).
 * @module dashboard/kpis
 */
import { h, animateNumber } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { percent, number, duration, plural } from '../ui/format.js';

/**
 * Accuracy change between the last 7 days and the 7 days before, in percentage points.
 * @param {{last7: {answered: number, accuracy: number}, prev7: {answered: number, accuracy: number}}} stats
 * @returns {number|null} null when either window has no answers
 */
export function accuracyDelta({ last7, prev7 }) {
  if (!last7?.answered || !prev7?.answered) return null;
  return Math.round((last7.accuracy - prev7.accuracy) * 100);
}

function deltaEl(points) {
  if (points === null) return null;
  if (points === 0) return h('span', { class: 'stat-delta' }, 'No change vs previous 7 days');
  const up = points > 0;
  const size = Math.abs(points);
  return [
    h('span', { class: ['stat-delta', up ? 'is-up' : 'is-down'] },
      h('span', { 'aria-hidden': 'true' }, up ? '▲' : '▼'),
      `${up ? '+' : '−'}${size} ${size === 1 ? 'pt' : 'pts'}`),
    h('span', { class: 'dash-kpi-note' }, 'vs previous 7 days'),
  ];
}

/**
 * One stat tile. `count` (when given) animates the value up from zero on first paint.
 * @param {{label: string, iconName: string, value: string, unit?: string, count?: {to: number, format: (n: number) => string},
 *   foot?: Array<Node|string|null>}} opts
 */
function tile({ label, iconName, value, unit, count, foot }) {
  const valueText = h('span', null, value);
  const el = h('div', { class: 'stat-tile dash-kpi' },
    h('p', { class: 'stat-label' }, icon(iconName, { size: 16 }), label),
    h('p', { class: 'stat-value' }, valueText, unit ? h('small', null, unit) : null),
    foot?.length ? h('div', { class: 'dash-kpi-foot' }, ...foot) : null);
  return { el, valueText, count };
}

/**
 * Build the KPI row.
 * @param {object} stats StatsOverview
 * @param {{animate?: boolean}} [opts] count values up from zero (first load; animateNumber honours reduced motion)
 * @returns {HTMLElement}
 */
export function renderKpis(stats, { animate = false } = {}) {
  const { totals, streak, last7 } = stats;
  const delta = accuracyDelta(stats);
  const tiles = [
    tile({
      label: 'Words practised',
      iconName: 'book',
      value: number(totals.answered),
      count: { to: totals.answered, format: (n) => number(Math.round(n)) },
      foot: [h('span', { class: 'dash-kpi-note' }, `${number(last7.answered)} in the last 7 days`)],
    }),
    tile({
      label: 'Accuracy',
      iconName: 'target',
      value: totals.answered ? percent(totals.accuracy) : '—',
      foot: [].concat(delta === null
        ? h('span', { class: 'dash-kpi-note' }, last7.answered ? `${percent(last7.accuracy)} in the last 7 days` : 'No answers in the last 7 days')
        : deltaEl(delta)),
    }),
    tile({
      label: 'Words learned',
      iconName: 'check-circle',
      value: number(totals.wordsLearned),
      count: { to: totals.wordsLearned, format: (n) => number(Math.round(n)) },
      foot: [h('span', { class: 'dash-kpi-note' },
        totals.wordsToReview ? `${plural(totals.wordsToReview, 'word')} to review` : `of ${plural(totals.wordsSeen, 'word')} seen`)],
    }),
    tile({
      label: 'Day streak',
      iconName: 'flame',
      value: number(streak.current),
      unit: streak.current === 1 ? 'day' : 'days',
      foot: [h('span', { class: 'dash-kpi-note' }, `Best ${plural(streak.best, 'day')}`)],
    }),
    tile({
      label: 'Time practised',
      iconName: 'clock',
      value: totals.timeSpentMs ? duration(totals.timeSpentMs) : '0m',
      foot: [h('span', { class: 'dash-kpi-note' }, `across ${plural(totals.tests, 'test')}`)],
    }),
  ];
  if (animate) {
    for (const t of tiles) {
      if (t.count && t.count.to > 0) animateNumber(t.valueText, 0, t.count.to, { duration: 700, format: t.count.format });
    }
  }
  return h('section', { class: 'dash-kpis', 'aria-label': 'Key figures' }, tiles.map((t) => t.el));
}
