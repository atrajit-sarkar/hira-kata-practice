/**
 * Question review: one row per question with result, expected kana, the learner's answer diff,
 * points and hints. Answered rows expand to the full explanation and word card. Filter tabs:
 * All / Wrong / Skipped / With hints.
 * @module results/review-list
 */
import { h, prefersReducedMotion, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { duration } from '../ui/format.js';
import { tabs } from '../ui/controls.js';
import { renderAnswerDiff } from '../ui/answer-diff.js';
import { renderWordCard, scriptChip } from '../ui/word-card.js';
import { inputBadge, metaIcon, INPUTS } from './practice-meta.js';

const FILTERS = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'wrong', label: 'Wrong', test: (q) => q.status === 'wrong' },
  { value: 'skipped', label: 'Skipped', test: (q) => q.status === 'skipped' },
  { value: 'hints', label: 'With hints', shortLabel: 'Hints', test: (q) => usedHint(q) },
];

const RESULT = {
  correct: { icon: 'check-circle', label: 'Correct' },
  wrong: { icon: 'x-circle', label: 'Wrong' },
  skipped: { icon: 'skip-forward', label: 'Skipped' },
  pending: { icon: 'clock', label: 'Not answered' },
};

const SCRIPT_NAME = { hiragana: 'hiragana', katakana: 'katakana' };

/** @param {object} q QuestionResult @returns {boolean} any hint (script, guided or romaji) used */
function usedHint(q) {
  return Boolean(q.hint1Used || q.hint2Used || q.romajiHintUsed);
}

/**
 * Explanation shown for a missed question.
 * @param {object} q QuestionResult
 * @returns {string}
 */
function explanation(q) {
  switch (q.errorType) {
    case 'script': return `Right sounds, wrong script: this word is written in ${SCRIPT_NAME[q.script]}.`;
    case 'spelling': return 'Check the highlighted characters against the correct spelling.';
    case 'empty': return 'No answer was submitted for this word.';
    case 'skipped': return 'You skipped this word. Here is how it is written.';
    case 'variant': return `Same sound, non-standard spelling: accepted in listen mode (−30). The standard spelling is ${q.expected}.`;
    default: return '';
  }
}

function hintIcons(q) {
  const items = [];
  if (q.hint1Used) {
    items.push(h('span', { class: 'review-hint', 'data-tip': 'Script hint used (−20)' },
      icon('lightbulb', { size: 15 }), h('span', { class: 'visually-hidden' }, 'Script hint used')));
  }
  if (q.hint2Used) {
    items.push(h('span', { class: 'review-hint', 'data-tip': `Guided spelling: ${q.hint2Revealed} revealed` },
      icon('wand', { size: 15 }), h('span', { class: 'visually-hidden' }, 'Guided spelling used')));
  }
  if (q.romajiHintUsed) {
    items.push(h('span', { class: 'review-hint', 'data-tip': 'Romaji hint used (−30)' },
      icon('type', { size: 15 }), h('span', { class: 'visually-hidden' }, 'Romaji hint used')));
  }
  return items.length ? h('span', { class: 'review-hints' }, items) : null;
}

function answerCell(q) {
  if (q.status === 'skipped') return h('span', { class: 'review-answer-note' }, 'Skipped');
  if (q.errorType === 'variant') {
    return h('span', { class: 'review-answer-script' },
      h('span', { class: 'review-answer-ok kana', lang: 'ja' }, q.userAnswer),
      h('span', { class: 'chip chip-success chip-xs', 'data-tip': `Same sound as ${q.expected}` }, 'Same sound'));
  }
  if (q.status === 'correct') {
    return h('span', { class: 'review-answer-ok kana', lang: 'ja' }, q.userAnswer,
      h('span', { class: 'visually-hidden' }, ' (your answer, correct)'));
  }
  if (!q.userAnswer) return h('span', { class: 'review-answer-note' }, 'No answer');
  if (q.errorType === 'script') {
    // Every tile would be red for a script mix-up; the plain answer plus a label reads better.
    return h('span', { class: 'review-answer-script' },
      h('span', { class: 'review-answer-bad kana', lang: 'ja' }, q.userAnswer),
      h('span', { class: 'chip chip-warning chip-xs' }, 'Wrong script'));
  }
  return renderAnswerDiff(q.diff, { show: 'actual', size: 'sm' });
}

/** Expected-view ops for a skipped word: show it plainly instead of every tile as an error. */
function plainOps(kana) {
  return Array.from(kana).map((ch) => ({ op: 'match', expected: ch, actual: ch }));
}

function detailPanel(q) {
  const answerBlocks = [];
  if (q.status === 'wrong' && q.userAnswer) {
    answerBlocks.push(h('div', { class: 'review-diff-block' },
      h('span', { class: 'review-diff-label' }, 'Your answer'),
      renderAnswerDiff(q.diff, { show: 'actual', size: 'md' })));
  }
  if (q.errorType === 'variant') {
    answerBlocks.push(h('div', { class: 'review-diff-block' },
      h('span', { class: 'review-diff-label' }, 'You wrote'),
      renderAnswerDiff(plainOps(q.userAnswer), { show: 'expected', size: 'md', label: 'You wrote' })));
    answerBlocks.push(h('div', { class: 'review-diff-block' },
      h('span', { class: 'review-diff-label' }, 'Standard spelling'),
      renderAnswerDiff(q.diff, { show: 'expected', size: 'md', label: 'Standard spelling' })));
  } else if (q.status === 'correct') {
    answerBlocks.push(h('div', { class: 'review-diff-block' },
      h('span', { class: 'review-diff-label' }, 'Your answer'),
      renderAnswerDiff(q.diff, { show: 'actual', size: 'md' })));
  } else {
    answerBlocks.push(h('div', { class: 'review-diff-block' },
      h('span', { class: 'review-diff-label' }, 'Correct answer'),
      renderAnswerDiff(q.status === 'skipped' ? plainOps(q.expected) : q.diff, { show: 'expected', size: 'md' })));
  }

  const notes = [];
  const why = explanation(q);
  if (why) {
    const tone = q.errorType === 'script' || q.errorType === 'spelling' ? 'is-error' : q.errorType === 'variant' ? 'is-variant' : null;
    notes.push(h('p', { class: ['review-note', tone] }, icon(q.errorType === 'variant' ? 'volume' : 'info', { size: 16 }), why));
  }
  if (q.hint1Used) notes.push(h('p', { class: 'review-note' }, icon('lightbulb', { size: 16 }), 'Script hint used (−20 points).'));
  if (q.hint2Used) {
    notes.push(h('p', { class: 'review-note' }, icon('wand', { size: 16 }),
      `Guided spelling revealed ${q.hint2Revealed} character${q.hint2Revealed === 1 ? '' : 's'}.`));
  }
  if (q.romajiHintUsed) notes.push(h('p', { class: 'review-note' }, icon('type', { size: 16 }), 'Romaji hint used (−30 points).'));
  const method = INPUTS[q.inputMethod];

  return h('div', { class: 'review-detail-inner' },
    h('div', { class: 'review-detail-answer' },
      answerBlocks,
      notes,
      h('dl', { class: 'review-facts' },
        h('div', null, h('dt', null, 'Points'), h('dd', null, `${q.points} / 100`)),
        h('div', null, h('dt', null, 'Time'), h('dd', null, duration(q.timeMs))),
        method ? h('div', null, h('dt', null, 'Written with'),
          h('dd', { class: 'review-fact-input' }, metaIcon(method.icon, { size: 15 }), method.label)) : null)),
    renderWordCard(q.word, { size: 'md', className: 'review-word-card' }));
}

function pendingRow(q) {
  return { el: pendingItem(q), toggle: null, setOpen: () => {} };
}

function pendingItem(q) {
  return h('li', { class: 'review-item is-pending' },
    h('div', { class: 'review-row' },
      h('span', { class: 'review-num tabular' }, String(q.position + 1)),
      h('span', { class: 'review-result' }, icon(RESULT.pending.icon, { size: 18 })),
      h('span', { class: 'review-word' },
        q.romaji
          ? h('span', { class: 'review-romaji is-lead' }, q.romaji)
          : h('span', { class: 'review-romaji is-lead is-hidden-word' }, metaIcon('headphones', { size: 15 }), 'Listening word')),
      h('span', { class: 'review-answer' }, h('span', { class: 'review-answer-note' }, 'Not answered')),
      h('span', { class: 'review-meaning' }),
      h('span', { class: 'review-meta' }),
      h('span', { class: 'review-chevron' })));
}

function answeredRow(q) {
  const detailId = uid('review-detail');
  const result = RESULT[q.status];
  const detail = h('div', { class: 'review-detail', id: detailId, hidden: true });
  const toggle = h('button', {
    class: 'review-row',
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': detailId,
  },
  h('span', { class: 'review-num tabular' }, String(q.position + 1)),
  h('span', { class: 'review-result' }, icon(result.icon, { size: 18 }), h('span', { class: 'visually-hidden' }, `${result.label}.`)),
  h('span', { class: 'review-word' },
    h('span', { class: 'review-kana kana', lang: 'ja' }, q.expected),
    // The chip shares the romaji line so a long word never pushes it onto a line of its own.
    h('span', { class: 'review-sub' },
      scriptChip(q.script, { short: true }),
      h('span', { class: 'review-romaji' }, q.romaji))),
  h('span', { class: 'review-answer' }, answerCell(q)),
  h('span', { class: 'review-meaning' }, q.word?.meaning || ''),
  h('span', { class: 'review-meta' },
    inputBadge(q.inputMethod),
    hintIcons(q),
    h('span', { class: ['review-points', 'tabular', q.points === 0 && 'is-zero'] }, q.points ? `+${q.points}` : '0',
      h('span', { class: 'visually-hidden' }, ' points'))),
  h('span', { class: 'review-chevron', 'aria-hidden': 'true' }, icon('chevron-down', { size: 18 })));

  const item = h('li', { class: ['review-item', `is-${q.status}`] }, toggle, detail);
  const setOpen = (open) => {
    if (open && !detail.firstChild) detail.appendChild(detailPanel(q));
    toggle.setAttribute('aria-expanded', String(open));
    detail.hidden = !open;
    item.classList.toggle('is-open', open);
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  return { el: item, toggle, setOpen };
}

/**
 * Render the review card.
 * @param {Array<object>} questions items of GET /api/tests/:id (QuestionResult or pending stub)
 * @param {{initialFilter?: string}} [opts]
 * @returns {{el: HTMLElement, reveal: (position: number) => void}} reveal expands that question's
 *   row (switching back to the All filter when it is hidden), scrolls to it and focuses it.
 */
export function reviewList(questions, { initialFilter = 'all' } = {}) {
  const ordered = [...questions].sort((a, b) => a.position - b.position);
  const answered = ordered.filter((q) => q.status !== 'pending');
  const pending = ordered.filter((q) => q.status === 'pending');
  const rows = answered.map((q) => ({ q, ...answeredRow(q) }))
    .concat(pending.map((q) => ({ q, ...pendingRow(q) })));

  const empty = h('p', { class: 'review-empty', hidden: true });
  const list = h('ol', { class: 'review-list', role: 'list' }, rows.map((r) => r.el));
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, f.value === 'all' ? ordered.length : answered.filter(f.test).length]));
  const valid = FILTERS.some((f) => f.value === initialFilter) ? initialFilter : 'all';

  const apply = (value) => {
    const filter = FILTERS.find((f) => f.value === value) ?? FILTERS[0];
    let shown = 0;
    for (const { q, el } of rows) {
      const visible = value === 'all' || (q.status !== 'pending' && filter.test(q));
      el.hidden = !visible;
      if (visible) shown += 1;
    }
    empty.hidden = shown > 0;
    empty.textContent = value === 'hints' ? 'No hints were used in this test.' : `No ${filter.label.toLowerCase()} answers in this test.`;
  };

  const filterTabs = tabs({
    label: 'Filter questions',
    value: valid,
    // Narrow screens swap in the short label via CSS so every tab and count fits.
    items: FILTERS.map((f) => ({
      value: f.value,
      label: f.shortLabel
        ? h('span', null, h('span', { class: 'review-tab-long' }, f.label), h('span', { class: 'review-tab-short' }, f.shortLabel))
        : f.label,
      count: counts[f.value],
    })),
    onChange: apply,
  });
  apply(valid);

  const el = h('section', { class: 'card results-review', id: 'question-review', 'aria-labelledby': 'results-review-title' },
    h('div', { class: 'card-header results-review-head' },
      h('div', null,
        h('h2', { class: 'card-title', id: 'results-review-title' }, 'Question review'),
        h('p', { class: 'card-subtitle' }, 'Select a word to see the full explanation and meaning.')),
      filterTabs.el),
    h('div', { class: 'results-review-body' }, list, empty));

  const reveal = (position) => {
    const row = rows.find((r) => r.q.position === position);
    if (!row?.toggle) return;
    if (row.el.hidden) {
      filterTabs.setValue('all');
      apply('all');
    }
    row.setOpen(true);
    row.el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    row.toggle.focus({ preventScroll: true });
  };
  return { el, reveal };
}
