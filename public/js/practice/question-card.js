/**
 * Question prompt (SPEC §12.4, §15.2). Romaji mode: "Write this word in kana", the romaji set large
 * and letter-spaced with letters animating in, and a collapsible tip explaining the romaji
 * conventions (§3.1). Listen mode: "Listen, then write the word in kana" with the listen player;
 * the romaji stays hidden until the romaji hint is used or the word has been scored.
 * @module practice/question-card
 */
import { h, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Romaji convention examples: [romaji, kana, explanation]. */
const CONVENTIONS = [
  ['okaasan', 'おかあさん', 'Long vowels in hiragana are spelled out letter by letter.'],
  ['kōhī', 'コーヒー', 'A macron (ā ī ū ē ō) means the long-vowel mark ー.'],
  ['kitte · matcha', 'きって · まっちゃ', 'A doubled consonant (or "tch") is a small っ.'],
  ["kin'en", 'きんえん', "n' is ん before a vowel or y."],
  ['ti · di · du', 'ティ · ディ · ドゥ', 'Small-vowel combinations (tu is トゥ), never ち ぢ つ づ: those are chi, ji, tsu, zu.'],
  ['wo · fa · dyu', 'ウォ · ファ · デュ', 'Also combinations: wo is ウォ, never を.'],
];

/**
 * Romaji-typing keystrokes that differ from the displayed romaji (SPEC §3.2): typing the display
 * spelling would give different kana (`wo` types ヲ, `ti` types チ). [keys, kana].
 */
const TYPING = [
  ['who', 'ウォ'], ['thi', 'ティ'], ['dhi', 'ディ'], ['twu', 'トゥ'], ['dwu', 'ドゥ'],
  ['thu', 'テュ'], ['dhu', 'デュ'], ['-', 'ー'], ['nn', 'ん'],
];

/**
 * Create the question card header.
 * @param {{player?: HTMLElement}} [opts] the listen player, shown in listen mode
 * @returns {{el: HTMLElement, setQuestion: (question: {romaji: string|null, position: number,
 *   mode?: 'romaji'|'listen'}, total: number, opts?: {animate?: boolean}) => void,
 *   revealRomaji: (romaji: string, opts?: {animate?: boolean, label?: string}) => void}}
 */
export function createQuestionCard({ player } = {}) {
  const eyebrow = h('p', { class: 'q-eyebrow' });
  const instruction = h('h2', { class: 'q-instruction' }, 'Write this word in kana');
  const romajiLabel = h('p', { class: 'q-romaji-label', hidden: true });
  const romaji = h('p', { class: 'q-romaji', lang: 'en' });
  const playerSlot = h('div', { class: 'q-player', hidden: true }, player || null);
  const panelId = uid('q-help');

  const helpPanel = h('div', { class: 'q-help-panel', id: panelId, hidden: true },
    h('p', { class: 'q-help-intro' }, 'The romaji spells out every kana, so you can rebuild the exact word:'),
    h('dl', { class: 'q-help-list' }, CONVENTIONS.map(([r, k, text]) => h('div', { class: 'q-help-row' },
      h('dt', null, h('span', { class: 'q-help-romaji' }, r), icon('arrow-right', { size: 14 }),
        h('span', { class: 'q-help-kana kana', lang: 'ja' }, k)),
      h('dd', null, text)))),
    h('div', { class: 'q-help-foot' },
      h('p', { class: 'q-help-foot-title' }, 'Romaji typing: some keys differ from the romaji shown'),
      h('ul', { class: 'q-help-keys', 'aria-label': 'Romaji typing keystrokes' }, TYPING.map(([keys, kana]) => h('li', null,
        h('kbd', { class: 'kbd' }, keys), icon('arrow-right', { size: 12 }),
        h('span', { class: 'kana', lang: 'ja' }, kana)))),
      h('p', null,
        'Type ', h('kbd', { class: 'kbd' }, 'nn'), ' or ', h('kbd', { class: 'kbd' }, "n'"),
        ' for ん before a vowel, y or n (onnna → おんな), and ', h('kbd', { class: 'kbd' }, '-'),
        ' for ー (kōhī → ko-hi-).')));

  const helpBtn = h('button', {
    class: 'btn btn-ghost btn-sm q-help-btn', type: 'button',
    'aria-expanded': 'false', 'aria-controls': panelId, 'aria-label': 'Reading the romaji: how spellings map to kana',
    on: {
      click: () => {
        const open = helpPanel.hidden;
        helpPanel.hidden = !open;
        helpBtn.setAttribute('aria-expanded', String(open));
      },
    },
  }, icon('help', { size: 16 }), h('span', { class: 'q-help-label' }, 'Reading the romaji'));

  const el = h('div', { class: 'q-card' },
    h('div', { class: 'q-head' },
      h('div', null, eyebrow, instruction),
      helpBtn),
    playerSlot,
    romajiLabel,
    romaji,
    helpPanel);

  let listen = false;

  function setRomaji(text, animate) {
    const value = String(text || '');
    const letters = Array.from(value);
    romaji.hidden = !value;
    romaji.setAttribute('aria-label', value);
    romaji.style.setProperty('--q-len', String(Math.max(letters.length, 1)));
    romaji.replaceChildren(...letters.map((ch, i) => h('span', {
      class: ['q-letter', animate && 'is-entering'],
      style: { '--i': i },
      'aria-hidden': 'true',
    }, ch)));
    // The romaji conventions only matter while romaji is on screen.
    helpBtn.hidden = !value;
    if (!value) {
      helpPanel.hidden = true;
      helpBtn.setAttribute('aria-expanded', 'false');
    }
  }

  return {
    el,
    setQuestion(question, total, { animate = true } = {}) {
      listen = question.mode === 'listen';
      el.classList.toggle('is-listen', listen);
      eyebrow.textContent = `${listen ? 'Listen · ' : ''}Word ${question.position + 1} of ${total}`;
      instruction.textContent = listen ? 'Listen, then write the word in kana' : 'Write this word in kana';
      playerSlot.hidden = !listen;
      romajiLabel.hidden = true;
      if (listen && question.romaji) {
        romajiLabel.textContent = 'Romaji hint';
        romajiLabel.hidden = false;
      }
      setRomaji(question.romaji, animate);
    },
    revealRomaji(text, { animate = true, label = 'Romaji hint' } = {}) {
      if (!listen) return;
      romajiLabel.textContent = label;
      romajiLabel.hidden = !text;
      setRomaji(text, animate);
    },
  };
}
