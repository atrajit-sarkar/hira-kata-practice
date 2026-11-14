/**
 * Progress dots: one per question, coloured by status (SPEC §12.4).
 * @module practice/progress-dots
 */
import { h } from '../ui/dom.js';

const STATUS_LABEL = { pending: 'not answered', correct: 'correct', wrong: 'wrong', skipped: 'skipped' };

/**
 * Create the dot row.
 * @returns {{el: HTMLElement, update: (questions: Array<{id: number, position: number, status: string}>,
 *   currentId: number|null) => void}}
 */
export function createProgressDots() {
  const list = h('div', { class: 'pr-dots-list', 'aria-hidden': 'true' });
  const summary = h('span', { class: 'visually-hidden' });
  const el = h('div', { class: 'pr-dots' }, list, summary);
  let dots = [];

  return {
    el,
    update(questions, currentId) {
      if (dots.length !== questions.length) {
        list.replaceChildren();
        dots = questions.map(() => list.appendChild(h('span', { class: 'pr-dot' })));
        el.classList.toggle('is-dense', questions.length > 40);
      }
      const tally = { correct: 0, wrong: 0, skipped: 0, pending: 0 };
      questions.forEach((q, i) => {
        const dot = dots[i];
        const changed = dot.dataset.status && dot.dataset.status !== q.status;
        dot.dataset.status = q.status;
        dot.title = `Word ${q.position + 1}: ${STATUS_LABEL[q.status] || q.status}`;
        dot.classList.toggle('is-current', q.id === currentId);
        if (changed) {
          dot.classList.remove('is-new');
          void dot.offsetWidth;
          dot.classList.add('is-new');
        }
        tally[q.status] = (tally[q.status] || 0) + 1;
      });
      summary.textContent = `Progress: ${tally.correct} correct, ${tally.wrong} wrong, ${tally.skipped} skipped, ${tally.pending} remaining.`;
    },
  };
}
