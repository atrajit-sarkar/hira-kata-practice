/**
 * Vocabulary card for a WordInfo (SPEC §7.1): used in practice feedback, results and vocab.
 * @module ui/word-card
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { canSpeak, speak } from './tts.js';

const LEVEL_LABEL = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' };

/**
 * Script chip ("ひらがな Hiragana" / "カタカナ Katakana").
 * @param {'hiragana'|'katakana'} script
 * @param {{short?: boolean}} [opts] short omits the Japanese label
 * @returns {HTMLSpanElement}
 */
export function scriptChip(script, { short = false } = {}) {
  const kata = script === 'katakana';
  return h('span', { class: `chip ${kata ? 'chip-kata' : 'chip-hira'}` },
    short ? null : h('span', { class: 'chip-jp', lang: 'ja' }, kata ? 'カタカナ' : 'ひらがな'),
    kata ? 'Katakana' : 'Hiragana');
}

/**
 * Describe loanword origins, e.g. "From English ‘coffee’".
 * @param {Array<{lang: string, text: string|null, wasei: boolean}>} origin
 * @returns {string|null}
 */
export function originText(origin) {
  if (!origin?.length) return null;
  const parts = origin.map((o) => (o.text ? `${o.lang} ‘${o.text}’` : o.lang));
  const wasei = origin.some((o) => o.wasei);
  return wasei
    ? `Wasei-eigo: coined in Japan from ${parts.join(' + ')}`
    : `From ${parts.join(' + ')}`;
}

function listenButton(word, size) {
  const label = `Listen to ${word.kana}`;
  const btn = h('button', {
    class: ['btn', 'btn-secondary', size === 'sm' ? 'btn-icon btn-sm' : 'btn-sm', 'word-card-listen'],
    type: 'button',
    'aria-label': label,
    'data-tip': size === 'sm' ? 'Listen' : undefined,
  }, icon('volume', { size: 16 }), size === 'sm' ? null : 'Listen');
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.classList.add('is-speaking');
    await speak(word.kana);
    btn.classList.remove('is-speaking');
  });
  return btn;
}

function kanjiLine(word) {
  const kanji = word.kanji || [];
  if (!kanji.length) {
    return h('p', { class: 'word-card-kanji is-kana-only' }, icon('type', { size: 14 }), 'Usually written in kana');
  }
  return h('p', { class: 'word-card-kanji' },
    h('span', { class: 'word-card-meta-label' }, 'Kanji'),
    h('span', { class: 'word-card-kanji-forms jp', lang: 'ja' }, kanji.join('、')),
    word.usuallyKana ? h('span', { class: 'word-card-note' }, '· usually written in kana') : null);
}

function senseList(word, size) {
  const senses = word.senses?.length
    ? word.senses
    : [{ pos: [], gloss: [word.meaning].filter(Boolean), info: [] }];
  const shown = size === 'sm' ? senses.slice(0, 1) : senses;
  return h('ol', { class: 'word-card-senses', role: 'list' },
    shown.map((s, i) => h('li', { class: 'word-card-sense' },
      shown.length > 1 ? h('span', { class: 'word-card-sense-num', 'aria-hidden': 'true' }, String(i + 1)) : null,
      h('div', { class: 'word-card-sense-body' },
        size !== 'sm' && s.pos?.length
          ? h('div', { class: 'word-card-pos' }, s.pos.map((p) => h('span', { class: 'chip chip-neutral chip-xs' }, p)))
          : null,
        h('p', { class: 'word-card-gloss' }, s.gloss.join('; ')),
        size !== 'sm' && s.info?.length ? h('p', { class: 'word-card-info' }, s.info.join(' · ')) : null))));
}

/**
 * Render a word card.
 * @param {object} word WordInfo
 * @param {{size?: 'lg'|'md'|'sm', showListen?: boolean, className?: string}} [opts]
 * @returns {HTMLElement} <article class="word-card word-card-{size}">
 */
export function renderWordCard(word, { size = 'md', showListen = true, className } = {}) {
  const origin = originText(word.origin);
  const homophones = (word.homophones || []).slice(0, 3);
  const chips = h('div', { class: 'word-card-chips' },
    scriptChip(word.script, { short: size === 'sm' }),
    word.jlpt ? h('span', { class: 'chip chip-brand', title: `JLPT N${word.jlpt} vocabulary` }, `JLPT N${word.jlpt}`) : null,
    size !== 'sm' && LEVEL_LABEL[word.level]
      ? h('span', { class: 'chip chip-neutral' }, LEVEL_LABEL[word.level]) : null);

  return h('article', {
    class: ['word-card', `word-card-${size}`, `is-${word.script}`, className],
    'aria-label': `${word.kana} (${word.romaji}): ${word.meaning || ''}`,
  },
  h('div', { class: 'word-card-head' },
    h('div', { class: 'word-card-title' },
      h('div', { class: 'word-card-kana kana', lang: 'ja' }, word.kana),
      h('div', { class: 'word-card-romaji' }, word.romaji)),
    showListen && canSpeak() ? listenButton(word, size) : null),
  chips,
  kanjiLine(word),
  senseList(word, size),
  origin && size !== 'sm' ? h('p', { class: 'word-card-origin' }, icon('external', { size: 14 }), origin) : null,
  homophones.length && size !== 'sm'
    ? h('p', { class: 'word-card-homophones' },
      h('span', { class: 'word-card-meta-label' }, 'Same sound'),
      homophones.map((hp, i) => h('span', { class: 'word-card-homophone' },
        i ? ', ' : '',
        hp.kanji ? h('span', { class: 'jp', lang: 'ja' }, hp.kanji) : null,
        hp.kanji ? ` (${hp.meaning})` : hp.meaning)))
    : null);
}
