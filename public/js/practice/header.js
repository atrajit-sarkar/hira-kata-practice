/**
 * Practice header (SPEC §12.4): Exit, title, progress bar "7 / 20", animated score, streak flame
 * and the ⋯ options menu.
 * @module practice/header
 */
import { h, animateNumber, prefersReducedMotion } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { attachMenu } from '../ui/menu.js';
import { number } from '../ui/format.js';

/** Streak at which the flame starts to glow. */
const HOT_STREAK = 3;

/**
 * Create the header.
 * @param {{onExit: () => void, menuItems: () => Array<object>}} opts
 * @returns {{el: HTMLElement, update: (test: object, opts?: {animate?: boolean}) => void,
 *   scoreEl: HTMLElement, destroy: () => void}}
 */
export function createHeader({ onExit, menuItems }) {
  const exitBtn = h('button', {
    class: 'btn btn-ghost btn-sm pr-exit', type: 'button',
    'data-tip': 'Your progress is saved', 'data-tip-pos': 'bottom',
    on: { click: () => onExit() },
  }, icon('arrow-left', { size: 18 }), h('span', { class: 'pr-exit-label' }, 'Exit'));

  const title = h('h1', { class: 'pr-title' });
  const bar = h('div', { class: 'progress-bar' });
  const progress = h('div', {
    class: 'progress progress-sm pr-progress', role: 'progressbar',
    'aria-valuemin': '0', 'aria-label': 'Words answered',
  }, bar);
  const count = h('span', { class: 'pr-count tabular' });

  const scoreValue = h('span', { class: 'pr-score-value tabular' }, '0');
  const score = h('div', { class: 'pr-score', 'data-tip': 'Score', 'data-tip-pos': 'bottom' },
    icon('star-filled', { size: 16, className: 'pr-score-icon' }), scoreValue,
    h('span', { class: 'visually-hidden' }, ' points'));

  const streakValue = h('span', { class: 'pr-streak-value tabular' }, '0');
  const streak = h('div', { class: 'pr-streak', 'data-tip': 'Streak · correct answers in a row', 'data-tip-pos': 'bottom' },
    icon('flame', { size: 16, className: 'pr-streak-icon' }), streakValue,
    h('span', { class: 'visually-hidden' }, ' in a row'));

  const moreBtn = h('button', {
    class: 'btn btn-ghost btn-icon btn-sm pr-more', type: 'button', 'aria-label': 'Test options',
  }, icon('more', { size: 20 }));
  const menu = attachMenu(moreBtn, menuItems, { align: 'end', label: 'Test options' });

  const el = h('header', { class: 'pr-header' },
    h('div', { class: 'pr-header-inner' },
      exitBtn,
      h('div', { class: 'pr-header-main' },
        title,
        h('div', { class: 'pr-progress-row' }, progress, count)),
      h('div', { class: 'pr-header-stats' }, score, streak),
      moreBtn));

  let shown = null;
  let cancelScore = () => {};

  function bump(node) {
    if (prefersReducedMotion()) return;
    node.animate([
      { transform: 'scale(1)' }, { transform: 'scale(1.28)', offset: 0.35 }, { transform: 'scale(1)' },
    ], { duration: 520, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  }

  return {
    el,
    scoreEl: score,
    update(test, { animate = false } = {}) {
      title.textContent = test.title;
      title.title = test.title;
      const answered = test.answeredCount ?? (test.correctCount + test.wrongCount + test.skippedCount);
      const total = test.totalQuestions;
      bar.style.width = `${total ? (answered / total) * 100 : 0}%`;
      progress.setAttribute('aria-valuemax', String(total));
      progress.setAttribute('aria-valuenow', String(answered));
      progress.setAttribute('aria-valuetext', `${answered} of ${total} words answered`);
      count.textContent = `${answered} / ${total}`;

      const prev = shown;
      shown = { score: test.score, streak: test.currentStreak };
      cancelScore();
      if (animate && prev && prev.score !== test.score) {
        cancelScore = animateNumber(scoreValue, prev.score, test.score, { duration: 900, format: (n) => number(Math.round(n)) });
        bump(score);
      } else {
        scoreValue.textContent = number(test.score);
      }
      streakValue.textContent = String(test.currentStreak);
      streak.classList.toggle('is-cold', test.currentStreak === 0);
      streak.classList.toggle('is-hot', test.currentStreak >= HOT_STREAK);
      if (animate && prev && test.currentStreak > prev.streak) bump(streak);
    },
    destroy() {
      cancelScore();
      menu.destroy();
    },
  };
}
