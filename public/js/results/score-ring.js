/**
 * Circular score meter: the fill is the share of available points earned on answered words.
 * Track and fill use one hue (lighter step for the track), per the data-viz meter rules.
 * @module results/score-ring
 */
import { animateNumber, h, prefersReducedMotion, svg } from '../ui/dom.js';
import { number, percent } from '../ui/format.js';

const R = 52;
const CIRC = 2 * Math.PI * R;

/**
 * Render the score ring.
 * @param {{score: number, answeredMaxScore: number, scorePercent: number|null, answered: number}} data
 * @param {{animate?: boolean, delay?: number}} [opts]
 * @returns {{el: HTMLElement, start: () => () => void}} call start() once mounted; it returns a cancel fn
 */
export function scoreRing({ score, answeredMaxScore, scorePercent, answered }, { animate = true, delay = 250 } = {}) {
  const ratio = answered > 0 && Number.isFinite(scorePercent) ? Math.max(0, Math.min(1, scorePercent)) : 0;
  const fill = svg('circle', {
    class: 'score-ring-fill', cx: 60, cy: 60, r: R, fill: 'none', 'stroke-width': 9, 'stroke-linecap': 'round',
    'stroke-dasharray': CIRC.toFixed(2), 'stroke-dashoffset': CIRC.toFixed(2), transform: 'rotate(-90 60 60)',
  });
  const value = h('span', { class: 'score-ring-value' }, answered ? '0%' : '—');
  const caption = answered
    ? `${number(score)} / ${number(answeredMaxScore)} pts`
    : 'No answers';

  const el = h('div', {
    class: 'score-ring',
    role: 'meter',
    'aria-label': 'Score',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': String(Math.round(ratio * 100)),
    'aria-valuetext': answered ? `${percent(ratio)} of available points, ${caption}` : 'No answers yet',
  },
  svg('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true', focusable: 'false' },
    svg('circle', { class: 'score-ring-track', cx: 60, cy: 60, r: R, fill: 'none', 'stroke-width': 9 }),
    ratio > 0 ? fill : null),
  h('div', { class: 'score-ring-label', 'aria-hidden': 'true' },
    value,
    h('span', { class: 'score-ring-caption' }, caption)));

  const finalOffset = (CIRC * (1 - ratio)).toFixed(2);
  const start = () => {
    if (!answered) return () => {};
    if (!animate || prefersReducedMotion()) {
      fill.style.strokeDashoffset = finalOffset;
      value.textContent = percent(ratio);
      return () => {};
    }
    let cancelNumber = () => {};
    const timer = setTimeout(() => {
      fill.style.strokeDashoffset = finalOffset;
      cancelNumber = animateNumber(value, 0, ratio * 100, { duration: 1100, format: (n) => `${Math.round(n)}%` });
    }, delay);
    return () => { clearTimeout(timer); cancelNumber(); };
  };
  return { el, start };
}
