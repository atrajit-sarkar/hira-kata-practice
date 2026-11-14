/**
 * "Continue" strip: the learner's active tests as compact cards with a progress ring, the practice
 * mode and Resume.
 * @module dashboard/continue-strip
 */
import { h, svg } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { relative, plural } from '../ui/format.js';
import { modeChip, modeOf } from '../results/practice-meta.js';

const MAX_CARDS = 3;
const R = 22;
const CIRC = 2 * Math.PI * R;

/**
 * Circular progress ring (answered / total) with the percentage in the middle.
 * @param {number} answered
 * @param {number} total
 * @returns {HTMLElement}
 */
export function progressRing(answered, total) {
  const ratio = total ? Math.min(1, answered / total) : 0;
  return h('div', {
    class: 'dash-ring',
    role: 'img',
    'aria-label': `${answered} of ${total} answered`,
  },
  svg('svg', { width: 52, height: 52, viewBox: '0 0 52 52', 'aria-hidden': 'true' },
    svg('circle', { class: 'dash-ring-track', cx: 26, cy: 26, r: R, fill: 'none', 'stroke-width': 4 }),
    svg('circle', {
      class: 'dash-ring-fill', cx: 26, cy: 26, r: R, fill: 'none', 'stroke-width': 4, 'stroke-linecap': 'round',
      'stroke-dasharray': CIRC.toFixed(2), 'stroke-dashoffset': (CIRC * (1 - ratio)).toFixed(2),
    })),
  h('span', { class: 'dash-ring-label', 'aria-hidden': 'true' }, `${Math.round(ratio * 100)}%`));
}

/**
 * Build the Continue strip, or null when there is nothing to resume.
 * @param {object[]} tests TestSummary list (any status, newest first)
 * @param {{navigate: (path: string) => void}} opts
 * @returns {HTMLElement|null}
 */
export function renderContinue(tests, { navigate }) {
  const active = tests.filter((t) => t.status === 'active');
  if (!active.length) return null;
  const shown = active.slice(0, MAX_CARDS);
  const extra = active.length - shown.length;
  return h('section', { class: 'dash-continue', 'aria-labelledby': 'dash-continue-title' },
    h('div', { class: 'dash-section-head' },
      h('div', null,
        h('h2', { id: 'dash-continue-title' }, 'Continue where you left off'),
        h('p', null, extra > 0
          ? `${plural(active.length, 'test')} in progress · showing the latest ${shown.length}`
          : `${plural(active.length, 'test')} in progress`))),
    h('div', { class: 'dash-continue-list' }, shown.map((t) => {
      const left = t.totalQuestions - t.answeredCount;
      return h('article', { class: 'card dash-resume' },
        progressRing(t.answeredCount, t.totalQuestions),
        h('div', { class: 'dash-resume-text' },
          h('h3', { class: 'dash-resume-title', title: t.title }, t.title),
          h('p', { class: 'dash-resume-meta' },
            modeChip(modeOf(t.config)),
            h('span', null, `${plural(left, 'word')} left`), ' · ', h('span', null, relative(t.updatedAt)))),
        h('button', {
          class: 'btn btn-primary btn-sm dash-resume-btn',
          type: 'button',
          'aria-label': `Resume ${t.title}`,
          on: { click: () => navigate(`/practice/${t.id}`) },
        }, icon('play', { size: 16 }), 'Resume'));
    })));
}
