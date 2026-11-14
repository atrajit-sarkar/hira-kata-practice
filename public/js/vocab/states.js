/**
 * Loading, empty and error states for the vocabulary page.
 * @module vocab/states
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const TAB_EMPTY = {
  learned: {
    icon: 'award',
    title: 'No learned words yet',
    text: 'Answer a word correctly in a test and it shows up here.',
  },
  review: {
    icon: 'sparkles',
    title: 'Nothing to review',
    text: 'Words you miss or skip appear here so you can practise them again.',
  },
  starred: {
    icon: 'star',
    title: 'No starred words',
    text: 'Select the star on any word to keep it here for quick review.',
  },
};

/**
 * Placeholder tiles shown while a page of words loads.
 * @param {number} count
 * @returns {HTMLLIElement[]}
 */
export function skeletonTiles(count) {
  return Array.from({ length: count }, () => h('li', { class: 'vocab-tile is-skeleton', 'aria-hidden': 'true' },
    h('div', { class: 'skeleton', style: { width: '46%', height: '30px' } }),
    h('div', { class: 'skeleton', style: { width: '30%', height: '12px' } }),
    h('div', { class: 'skeleton', style: { width: '88%', height: '12px' } }),
    h('div', { class: 'skeleton', style: { width: '100%', height: '8px', marginTop: 'auto' } })));
}

function emptyBox(iconName, title, text, actions) {
  return h('div', { class: 'card vocab-empty' }, h('div', { class: 'empty-state' },
    h('div', { class: 'empty-state-icon' }, icon(iconName, { size: 26 })),
    h('h2', null, title),
    h('p', null, text),
    actions?.length ? h('div', { class: 'empty-state-actions' }, actions) : null));
}

/**
 * Empty state for the current view.
 * @param {{kind: 'first'|'no-match'|'tab', filter?: string, onClear?: () => void}} opts
 *   first: the learner has no vocabulary at all; no-match: search/script filter excludes
 *   everything; tab: the selected tab (learned/review/starred) is empty.
 * @returns {HTMLElement}
 */
export function emptyView({ kind, filter, onClear }) {
  if (kind === 'first') {
    return h('div', { class: 'card vocab-empty vocab-empty-first' }, h('div', { class: 'empty-state' },
      h('div', { class: 'vocab-empty-art', 'aria-hidden': 'true' },
        h('span', { class: 'kana is-hira', lang: 'ja' }, 'ことば'),
        h('span', { class: 'kana is-kata', lang: 'ja' }, 'ワード')),
      h('h2', null, 'Your word list starts here'),
      h('p', null, 'Every word you practise is collected here with its meaning, kanji and your progress. Take a test to add your first words.'),
      h('div', { class: 'empty-state-actions' },
        h('a', { class: 'btn btn-primary', href: '#/dashboard?new=1' }, icon('play', { size: 18 }), 'Start a test'))));
  }
  if (kind === 'no-match') {
    const clear = h('button', { class: 'btn btn-secondary', type: 'button', on: { click: onClear } },
      icon('x', { size: 18 }), 'Clear search and filters');
    return emptyBox('search', 'No matching words', 'Nothing in this list matches your search or script filter.', [clear]);
  }
  const info = TAB_EMPTY[filter] ?? TAB_EMPTY.learned;
  const actions = filter === 'review'
    ? [h('a', { class: 'btn btn-secondary', href: '#/dashboard?new=1' }, icon('plus', { size: 18 }), 'New test')]
    : [];
  return emptyBox(info.icon, info.title, info.text, actions);
}

/**
 * Error panel with a retry button.
 * @param {string} message
 * @param {() => void} onRetry
 * @returns {HTMLElement}
 */
export function errorView(message, onRetry) {
  const retry = h('button', { class: 'btn btn-primary', type: 'button', on: { click: onRetry } },
    icon('refresh', { size: 18 }), 'Try again');
  return emptyBox('alert-triangle', 'Your words could not load', message || 'Check your connection and try again.', [retry]);
}
