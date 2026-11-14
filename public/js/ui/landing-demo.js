/**
 * Looping animated practice demo for the landing page: romaji appears, kana is typed in, a check
 * mark draws itself and the meaning slides in. Static final frame under reduced motion.
 * @module ui/landing-demo
 */
import { h, svg, clear, prefersReducedMotion } from './dom.js';
import { scriptChip } from './word-card.js';

/** Fallback words so the demo never depends on the API. */
export const DEMO_WORDS = [
  { kana: 'コーヒー', romaji: 'kōhī', script: 'katakana', kanji: ['珈琲'], meaning: 'coffee', jlpt: 5, origin: 'From Dutch ‘koffie’' },
  { kana: 'ねこ', romaji: 'neko', script: 'hiragana', kanji: ['猫'], meaning: 'cat', jlpt: 5 },
  { kana: 'さくら', romaji: 'sakura', script: 'hiragana', kanji: ['桜'], meaning: 'cherry blossom; cherry tree', jlpt: 4 },
  { kana: 'テレビ', romaji: 'terebi', script: 'katakana', kanji: [], meaning: 'television; TV', jlpt: 5, origin: 'From English ‘television’' },
  { kana: 'がっこう', romaji: 'gakkou', script: 'hiragana', kanji: ['学校'], meaning: 'school', jlpt: 5 },
];

const PRAISE = ['すごい! Great!', '完璧! Perfect!', 'いいね! Nice!'];

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

function checkMark() {
  return svg('svg', { class: 'demo-check', viewBox: '0 0 52 52', width: 44, height: 44, 'aria-hidden': 'true' },
    svg('circle', { class: 'demo-check-circle', cx: 26, cy: 26, r: 23, fill: 'none' }),
    svg('path', { class: 'demo-check-path', d: 'M15 27l7.5 7.5L37.5 19', fill: 'none' }));
}

/**
 * Build the demo. Call `start()` after inserting it into the DOM; `stop()` on page cleanup.
 * @param {{words?: object[]}} [opts] words: {kana, romaji, script, kanji[], meaning, jlpt, origin?}
 * @returns {{el: HTMLElement, start: () => void, stop: () => void, setWords: (w: object[]) => void}}
 */
export function createLandingDemo({ words = DEMO_WORDS } = {}) {
  let list = words.length ? words : DEMO_WORDS;
  let controller = null;

  const romajiEl = h('div', { class: 'demo-romaji', 'aria-hidden': 'true' });
  const kanaEl = h('span', { class: 'demo-kana kana', lang: 'ja' });
  const caret = h('span', { class: 'demo-caret', 'aria-hidden': 'true' });
  const placeholder = h('span', { class: 'demo-placeholder' }, 'Type in kana…');
  const check = checkMark();
  const inputEl = h('div', { class: 'demo-input' }, h('div', { class: 'demo-input-text' }, placeholder, kanaEl, caret), check);
  const praiseEl = h('div', { class: 'demo-praise' });
  const pointsEl = h('div', { class: 'demo-points', 'aria-hidden': 'true' }, '+100');
  const meaningEl = h('div', { class: 'demo-meaning' });
  const progressBar = h('div', { class: 'progress-bar' });
  const counterEl = h('span', { class: 'demo-counter tabular' });

  const card = h('div', { class: 'demo-card' },
    h('div', { class: 'demo-top' },
      h('span', { class: 'demo-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      counterEl,
      h('div', { class: 'progress progress-sm demo-progress' }, progressBar)),
    h('p', { class: 'demo-label' }, 'Write this word in kana'),
    romajiEl,
    inputEl,
    h('div', { class: 'demo-feedback' }, praiseEl, pointsEl),
    meaningEl);

  const el = h('div', { class: 'demo', role: 'img', 'aria-label': 'Animated example: the romaji “kōhī” is written as コーヒー in katakana, checked as correct, and its meaning “coffee” is shown.' },
    h('div', { class: 'demo-paper demo-paper-2', 'aria-hidden': 'true' }),
    h('div', { class: 'demo-paper demo-paper-1', 'aria-hidden': 'true' }),
    card);

  function renderMeaning(word) {
    clear(meaningEl);
    meaningEl.append(
      h('div', { class: 'demo-meaning-head' },
        word.kanji?.length ? h('span', { class: 'demo-kanji jp', lang: 'ja' }, word.kanji[0]) : null,
        h('span', { class: 'demo-gloss' }, word.meaning)),
      h('div', { class: 'demo-meaning-chips' },
        scriptChip(word.script),
        word.jlpt ? h('span', { class: 'chip chip-brand' }, `JLPT N${word.jlpt}`) : null,
        word.origin ? h('span', { class: 'chip chip-neutral' }, word.origin) : null));
  }

  function reset(word, index) {
    card.classList.remove('is-correct', 'is-checked', 'is-typing', 'is-exit');
    clear(romajiEl);
    Array.from(word.romaji).forEach((ch, i) => {
      romajiEl.appendChild(h('span', { style: { '--i': i } }, ch));
    });
    kanaEl.textContent = '';
    placeholder.hidden = false;
    praiseEl.textContent = PRAISE[index % PRAISE.length];
    renderMeaning(word);
    counterEl.textContent = `${index + 1} / ${list.length}`;
    progressBar.style.width = `${(index / list.length) * 100}%`;
  }

  function showFinal(word, index) {
    reset(word, index);
    romajiEl.classList.add('is-in');
    placeholder.hidden = true;
    kanaEl.textContent = word.kana;
    card.classList.add('is-checked', 'is-correct');
    progressBar.style.width = `${((index + 1) / list.length) * 100}%`;
  }

  async function loop(signal) {
    let i = 0;
    for (;;) {
      const word = list[i % list.length];
      const idx = i % list.length;
      reset(word, idx);
      romajiEl.classList.remove('is-in');
      void romajiEl.offsetWidth;
      romajiEl.classList.add('is-in');
      await sleep(700 + word.romaji.length * 60, signal);
      card.classList.add('is-typing');
      placeholder.hidden = true;
      for (const ch of Array.from(word.kana)) {
        kanaEl.textContent += ch;
        await sleep(260 + Math.random() * 120, signal);
      }
      card.classList.remove('is-typing');
      await sleep(380, signal);
      card.classList.add('is-checked', 'is-correct');
      progressBar.style.width = `${((idx + 1) / list.length) * 100}%`;
      await sleep(3400, signal);
      card.classList.add('is-exit');
      await sleep(360, signal);
      i += 1;
    }
  }

  return {
    el,
    start() {
      if (controller) return;
      if (prefersReducedMotion()) { showFinal(list[0], 0); return; }
      controller = new AbortController();
      loop(controller.signal).catch(() => {});
    },
    stop() {
      controller?.abort();
      controller = null;
    },
    setWords(next) {
      if (next?.length) list = next;
    },
  };
}
