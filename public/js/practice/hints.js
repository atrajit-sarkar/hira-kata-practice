/**
 * Hint controls (SPEC §12.4, §15.2, §15.7b): "Script hint · −20" flips into a script badge;
 * "Guide me" starts guided spelling and then reads "Reveal next letter" with its running cost;
 * in listen mode "Show romaji · −30" flips into a romaji badge. Used hints stay visible.
 * @module practice/hints
 */
import { h, prefersReducedMotion } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { guidePenalty } from './guide.js';

const SCRIPT_BADGE = {
  hiragana: { jp: 'ひらがな', en: 'Hiragana', cls: 'chip-hira' },
  katakana: { jp: 'カタカナ', en: 'Katakana', cls: 'chip-kata' },
};

/** Cost of the romaji hint in listen mode (SPEC §15.2). */
export const ROMAJI_HINT_COST = 30;

/**
 * Create the hint row.
 * @param {{onScript: () => void, onGuide: () => void, onRomaji: () => void}} handlers
 * @returns {{el: HTMLElement, sync: (question: object, opts?: {animate?: boolean}) => void,
 *   setGuide: (state: {revealed: number, len: number, canReveal: boolean}|null) => void,
 *   setBusy: (type: 'script'|'spelling'|'romaji'|null) => void, setLocked: (locked: boolean) => void}}
 */
export function createHints({ onScript, onGuide, onRomaji }) {
  const scriptBtn = h('button', {
    class: 'btn btn-secondary btn-sm hint-btn', type: 'button',
    'data-tip': 'Shows whether the word is hiragana or katakana. Costs 20 points. (Alt+1)',
    'aria-keyshortcuts': 'Alt+1',
    on: { click: () => onScript() },
  }, icon('eye', { size: 16 }), 'Script hint', h('span', { class: 'hint-cost' }, '−20'));

  const guideLabel = h('span', null, 'Guide me');
  const guideCost = h('span', { class: 'hint-cost' }, h('span', { class: 'hint-cost-prefix' }, 'up to '), '−60');
  const guideBtn = h('button', {
    class: 'btn btn-secondary btn-sm hint-btn hint-guide', type: 'button',
    'aria-keyshortcuts': 'Alt+2',
    on: { click: () => onGuide() },
  }, icon('wand', { size: 16 }), guideLabel, guideCost);

  const romajiBtn = h('button', {
    class: 'btn btn-secondary btn-sm hint-btn hint-romaji', type: 'button', hidden: true,
    'data-tip': `Shows the word in romaji. Costs ${ROMAJI_HINT_COST} points. (Alt+3)`,
    'aria-keyshortcuts': 'Alt+3',
    on: { click: () => onRomaji() },
  }, icon('type', { size: 16 }), 'Show romaji', h('span', { class: 'hint-cost' }, `−${ROMAJI_HINT_COST}`));

  const badgeSlot = h('span', { class: 'hint-badge-slot' });
  const romajiSlot = h('span', { class: 'hint-badge-slot' });
  const el = h('div', { class: 'hints', role: 'group', 'aria-label': 'Hints' },
    h('span', { class: 'hints-label' }, icon('lightbulb', { size: 16 }), 'Hints'),
    scriptBtn, badgeSlot, romajiBtn, romajiSlot, guideBtn);

  let shownScript = null;
  let shownRomaji = false;
  let guideState = null;

  function flipIn(node) {
    if (prefersReducedMotion()) return;
    node.animate([
      { transform: 'perspective(400px) rotateX(-90deg)', opacity: 0 },
      { transform: 'perspective(400px) rotateX(12deg)', opacity: 1, offset: 0.7 },
      { transform: 'perspective(400px) rotateX(0)', opacity: 1 },
    ], { duration: 460, easing: 'cubic-bezier(.22,1,.36,1)' });
  }

  function renderGuide() {
    if (!guideState) {
      guideLabel.textContent = 'Guide me';
      guideCost.replaceChildren(h('span', { class: 'hint-cost-prefix' }, 'up to '), '−60');
      guideBtn.dataset.tip = 'Reveals the word one letter per click. Costs up to 60 points. (Alt+2)';
      guideBtn.classList.remove('is-active');
      guideBtn.setAttribute('aria-label', 'Guide me: reveal the word one letter at a time, costs up to 60 points');
      return;
    }
    const { revealed, len, canReveal } = guideState;
    const cost = guidePenalty(revealed, len);
    guideLabel.textContent = 'Reveal next letter';
    guideCost.replaceChildren(`−${cost}`);
    guideBtn.classList.add('is-active');
    guideBtn.dataset.tip = canReveal
      ? `Reveals the next letter you have not written correctly. The guide costs ${cost} points so far (up to 60). (Alt+2)`
      : 'Write the revealed letter first, then reveal the next one. (Alt+2)';
    guideBtn.setAttribute('aria-label', `Reveal next letter. ${revealed} of ${len} revealed, ${cost} points so far`);
  }

  return {
    el,
    sync(question, { animate = false } = {}) {
      const script = question?.hint1Used ? question.script : null;
      if (script !== shownScript) {
        shownScript = script;
        badgeSlot.replaceChildren();
        if (script && SCRIPT_BADGE[script]) {
          const b = SCRIPT_BADGE[script];
          const badge = h('span', {
            class: ['chip', 'chip-lg', b.cls, 'hint-badge'],
            'data-tip': 'Script hint used (−20)',
          }, h('span', { class: 'chip-jp', lang: 'ja' }, b.jp), b.en);
          badgeSlot.appendChild(badge);
          if (animate) flipIn(badge);
        }
      }
      scriptBtn.hidden = Boolean(script);

      const listen = question?.mode === 'listen';
      const romajiUsed = listen && Boolean(question.romajiHintUsed);
      if (romajiUsed !== shownRomaji) {
        shownRomaji = romajiUsed;
        romajiSlot.replaceChildren();
        if (romajiUsed) {
          const badge = h('span', {
            class: 'chip chip-lg chip-brand hint-badge hint-badge-romaji',
            'data-tip': `Romaji hint used (−${ROMAJI_HINT_COST})`,
          }, icon('type', { size: 14 }), 'Romaji shown');
          romajiSlot.appendChild(badge);
          if (animate) flipIn(badge);
        }
      }
      romajiBtn.hidden = !listen || romajiUsed;
      el.classList.toggle('is-listen', listen);
    },
    setGuide(state) {
      guideState = state;
      renderGuide();
    },
    setBusy(type) {
      scriptBtn.classList.toggle('is-loading', type === 'script');
      guideBtn.classList.toggle('is-loading', type === 'spelling');
      romajiBtn.classList.toggle('is-loading', type === 'romaji');
    },
    setLocked(locked) {
      scriptBtn.disabled = Boolean(locked);
      guideBtn.disabled = Boolean(locked);
      romajiBtn.disabled = Boolean(locked);
      el.classList.toggle('is-locked', Boolean(locked));
    },
  };
}
