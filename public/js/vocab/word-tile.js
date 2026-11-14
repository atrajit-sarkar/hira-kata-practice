/**
 * Vocabulary word tile: kana, kanji, romaji, meaning, mastery meter, last-result chip, star and
 * listen. The tile body is a disclosure button for a full-width detail panel (`wordDetail`).
 * @module vocab/word-tile
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { number, percent, relative } from '../ui/format.js';
import { canSpeak, speak } from '../ui/tts.js';
import { renderWordCard } from '../ui/word-card.js';

const LAST_RESULT = {
  correct: { label: 'Correct', chip: 'chip-success' },
  wrong: { label: 'Missed', chip: 'chip-danger' },
  skipped: { label: 'Skipped', chip: 'chip-warning' },
};

/**
 * Mastery = share of attempts answered correctly. Bands drive the meter colour only; the
 * figures are always printed beside it.
 * @param {{seen: number, correct: number}} progress
 * @returns {{ratio: number, band: 'high'|'mid'|'low'|'none'}}
 */
export function mastery({ seen, correct }) {
  if (!seen) return { ratio: 0, band: 'none' };
  const ratio = Math.max(0, Math.min(1, correct / seen));
  return { ratio, band: ratio >= 0.75 ? 'high' : ratio >= 0.4 ? 'mid' : 'low' };
}

function resultChip(progress) {
  const info = LAST_RESULT[progress.lastResult];
  if (!info) return h('span', { class: 'chip chip-neutral chip-xs' }, 'Not practised');
  return h('span', { class: ['chip', 'chip-xs', 'chip-dot', info.chip] }, info.label);
}

/**
 * Mastery row: figures and the last-result chip on one line, the meter underneath.
 * @param {object} word WordInfo
 * @param {object} progress
 * @returns {HTMLElement}
 */
function masteryBlock(word, progress) {
  const { ratio, band } = mastery(progress);
  const text = progress.seen
    ? `${number(progress.correct)} of ${number(progress.seen)} correct`
    : 'Not practised yet';
  return h('div', { class: ['vocab-mastery', `is-${band}`] },
    h('div', { class: 'vocab-mastery-head' },
      h('span', { class: 'vocab-mastery-text' },
        progress.seen ? h('strong', null, `${percent(ratio)} mastery`) : null,
        progress.seen ? ` · ${text}` : text),
      resultChip(progress)),
    h('div', {
      class: 'vocab-mastery-track',
      role: 'meter',
      'aria-label': `Mastery of ${word.kana}`,
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(ratio * 100)),
      'aria-valuetext': progress.seen ? `${percent(ratio)}, ${text}` : text,
    }, h('span', { class: 'vocab-mastery-fill', style: { '--meter': String(ratio) } })));
}

function historyPanel(progress) {
  const facts = [
    ['Practised', progress.seen ? `${number(progress.seen)} ${progress.seen === 1 ? 'time' : 'times'}` : 'Not yet'],
    ['Correct', number(progress.correct)],
    ['Missed', number(progress.wrong)],
    ['Last practised', progress.lastSeenAt ? relative(progress.lastSeenAt) : '—'],
  ];
  return h('div', { class: 'vocab-history' },
    // h2: the page outline is h1 "Vocabulary" > this (word tiles carry no headings).
    h('h2', { class: 'vocab-history-title' }, 'Your practice'),
    h('dl', { class: 'vocab-history-facts' },
      facts.map(([dt, dd]) => h('div', null, h('dt', null, dt), h('dd', null, dd)))),
    h('div', { class: 'vocab-history-result' }, h('span', null, 'Last result'), resultChip(progress)));
}

/**
 * Full-width detail panel for an expanded tile: the complete word card and practice history.
 * @param {{word: object, progress: object}} item
 * @param {{id: string, onClose: () => void}} opts id is referenced by the tile's aria-controls
 * @returns {HTMLLIElement}
 */
export function wordDetail(item, { id, onClose }) {
  const close = h('button', {
    class: 'btn btn-ghost btn-icon btn-sm vocab-detail-close',
    type: 'button',
    'aria-label': `Close details for ${item.word.kana}`,
    on: { click: onClose },
  }, icon('x', { size: 18 }));
  return h('li', { class: ['vocab-detail', `is-${item.word.script}`], id, role: 'region', 'aria-label': `Details for ${item.word.kana}` },
    renderWordCard(item.word, { size: 'lg', className: 'vocab-word-card' }),
    historyPanel(item.progress),
    close);
}

/**
 * Render a vocabulary tile. The page owns the (single) detail panel; the tile only reports
 * toggles through `onToggle` and reflects its state through `setOpen`.
 * @param {{word: object, progress: object}} item one entry of `GET /api/vocab` items
 * @param {{detailId: string, onStar: (item: object, starred: boolean, tile: object) => void,
 *   onToggle: (tile: object) => void}} opts
 * @returns {{el: HTMLLIElement, main: HTMLButtonElement, item: object,
 *   setStarred: (on: boolean) => void, setOpen: (open: boolean) => void}}
 */
export function wordTile(item, { detailId, onStar, onToggle }) {
  const { word, progress } = item;
  const kanji = word.kanji?.[0] || '';

  const main = h('button', {
    class: 'vocab-tile-main',
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': detailId,
    'aria-label': `${word.kana}, ${word.romaji}: ${word.meaning || ''}. Show details`,
  },
  h('span', { class: 'vocab-tile-kana kana', lang: 'ja' }, word.kana),
  h('span', { class: 'vocab-tile-sub' },
    h('span', { class: 'vocab-tile-romaji' }, word.romaji),
    kanji ? h('span', { class: 'vocab-tile-kanji jp', lang: 'ja' }, kanji) : null),
  h('span', { class: 'vocab-tile-meaning' }, word.meaning || ''));

  const star = h('button', { class: 'btn btn-ghost btn-icon btn-sm vocab-star', type: 'button' });
  const setStarred = (on) => {
    item.progress.starred = on;
    star.setAttribute('aria-pressed', String(on));
    star.setAttribute('aria-label', on ? `Unstar ${word.kana}` : `Star ${word.kana}`);
    star.dataset.tip = on ? 'Starred' : 'Star';
    star.replaceChildren(icon(on ? 'star-filled' : 'star', { size: 18 }));
  };
  setStarred(Boolean(progress.starred));

  const tools = h('div', { class: 'vocab-tile-tools' }, star);
  if (canSpeak()) {
    const listen = h('button', {
      class: 'btn btn-ghost btn-icon btn-sm vocab-listen',
      type: 'button',
      'aria-label': `Listen to ${word.kana}`,
      'data-tip': 'Listen',
    }, icon('volume', { size: 18 }));
    listen.addEventListener('click', async () => {
      listen.classList.add('is-speaking');
      await speak(word.kana);
      listen.classList.remove('is-speaking');
    });
    tools.appendChild(listen);
  }

  const el = h('li', { class: ['vocab-tile', `is-${word.script}`] },
    h('div', { class: 'vocab-tile-top' }, main, tools),
    h('div', { class: 'vocab-tile-foot' }, masteryBlock(word, progress)));

  const tile = {
    el,
    main,
    item,
    setStarred,
    setOpen(open) {
      main.setAttribute('aria-expanded', String(open));
      main.setAttribute('aria-label', `${word.kana}, ${word.romaji}: ${word.meaning || ''}. ${open ? 'Hide' : 'Show'} details`);
      el.classList.toggle('is-expanded', open);
    },
  };
  main.addEventListener('click', () => onToggle(tile));
  star.addEventListener('click', () => onStar(item, !item.progress.starred, tile));
  return tile;
}
