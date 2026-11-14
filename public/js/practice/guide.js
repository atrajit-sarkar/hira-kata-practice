/**
 * Guided spelling (hint 2, SPEC §12.4 as changed by §15.7b): a strip of boxes, one per expected
 * character. Every "Reveal next letter" click reveals ONE character: the first position the learner
 * has not yet written correctly (`guideState(...).nextIndex`). Revealed boxes show their character
 * (green once written correctly, a red shake when something else is written there); unrevealed
 * boxes show a neutral "?" and give no right/wrong feedback, so nothing leaks. There is no
 * auto-check: the learner presses Check.
 *
 * Tracks `hint2From` (matched length at the first click) and the revealed positions
 * (`hint2Revealed` = their count) for the answer payload.
 * @module practice/guide
 */
import { h, prefersReducedMotion } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { guideState, kanaKeyLabel } from '/shared/kana.js';

/** Maximum guide penalty and the floor once it has been used (SPEC §8). */
const GUIDE_MAX = 60;
const GUIDE_MIN = 10;

/**
 * Points the guide costs after revealing `revealed` of `len` characters (SPEC §8 / §15.7b).
 * @param {number} revealed
 * @param {number} len
 * @returns {number}
 */
export function guidePenalty(revealed, len) {
  if (!len) return GUIDE_MIN;
  return Math.max(GUIDE_MIN, Math.round((GUIDE_MAX * Math.min(revealed, len)) / len));
}

/**
 * @typedef {object} GuideView
 * @property {'none'|'key'|'backspace'} pulse  what the on-screen keyboard should point at
 * @property {string} [ch]                     the key to pulse when pulse = 'key'
 */

/**
 * Create the guide strip.
 * @param {{onReveal?: (positions: number[]) => void}} [opts] onReveal is called with the revealed
 *   positions whenever one is added (persist it to survive reloads)
 */
export function createGuide({ onReveal } = {}) {
  let expected = [];
  let active = false;
  let from = 0;
  let revealed = new Set();
  let lastWrong = '';
  let boxes = [];
  let typedNow = '';

  const strip = h('div', { class: 'guide-strip', 'aria-hidden': 'true' });
  const message = h('p', { class: 'guide-message', 'aria-live': 'polite' });
  const el = h('section', { class: 'guide', hidden: true, 'aria-label': 'Guided spelling' },
    h('div', { class: 'guide-head' },
      icon('wand', { size: 16 }),
      h('span', null, 'Guided spelling'),
      h('span', { class: 'guide-head-note' }, 'One letter per click')),
    strip, message);

  function build() {
    strip.replaceChildren();
    boxes = expected.map((_, i) => {
      const box = h('span', { class: 'guide-box is-hidden', style: { '--i': i } },
        h('span', { class: 'guide-char kana', lang: 'ja' }));
      strip.appendChild(box);
      return box;
    });
  }

  function kanaSpan(ch) {
    const label = kanaKeyLabel(ch);
    return h('span', { class: 'guide-msg-kana' },
      h('strong', { class: 'kana', lang: 'ja' }, ch),
      label ? h('span', { class: 'guide-msg-romaji' }, ` (${label})`) : null);
  }

  function shake(box) {
    if (!box || prefersReducedMotion()) return;
    box.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' },
      { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' },
    ], { duration: 320, easing: 'ease-out' });
  }

  /** Re-render the strip for the typed kana and return what the keyboard should point at. */
  function render(typed) {
    typedNow = typed;
    const state = guideState(expected.join(''), typed);
    const typedChars = Array.from(typed);
    let firstWrong = null;
    boxes.forEach((box, i) => {
      let cls = 'is-hidden';
      let text = '?';
      if (revealed.has(i)) {
        text = expected[i];
        if (typedChars[i] === expected[i]) cls = 'is-done';
        else if (typedChars[i] != null) { cls = 'is-wrong'; if (firstWrong == null) firstWrong = i; } else if (i === state.nextIndex) cls = 'is-next';
        else cls = 'is-revealed';
      }
      box.className = `guide-box ${cls}`;
      box.firstChild.textContent = text;
    });

    const wrongKey = firstWrong != null ? `${firstWrong}:${typedChars[firstWrong]}` : '';
    if (wrongKey && wrongKey !== lastWrong) shake(boxes[firstWrong]);
    lastWrong = wrongKey;

    const target = state.nextIndex != null && revealed.has(state.nextIndex) && typedChars[state.nextIndex] == null
      ? state.nextIndex : null;
    if (firstWrong != null) {
      message.replaceChildren(icon('x-circle', { size: 16 }), ` Character ${firstWrong + 1} should be `,
        kanaSpan(expected[firstWrong]), '. Delete it and try again.');
    } else if (target != null) {
      message.replaceChildren('Next: ', kanaSpan(expected[target]));
    } else {
      message.replaceChildren('Write the rest yourself, then press Check. Stuck? Reveal the next letter.');
    }
    el.dataset.state = firstWrong != null ? 'wrong' : 'typing';

    /** @type {GuideView} */
    const view = { pulse: 'none' };
    if (state.nextIndex != null && revealed.has(state.nextIndex)) {
      if (typedChars[state.nextIndex] == null) Object.assign(view, { pulse: 'key', ch: expected[state.nextIndex] });
      else view.pulse = 'backspace';
    }
    return view;
  }

  return {
    el,
    /**
     * Show the strip (first click, or restoring after a reload).
     * @param {string} answer
     * @param {string} typed
     * @param {{hint2From?: number, revealed?: number[]}} [restore]
     * @returns {GuideView}
     */
    activate(answer, typed, restore = {}) {
      expected = Array.from(answer);
      const initial = guideState(answer, typed);
      from = Number.isInteger(restore.hint2From) ? Math.min(restore.hint2From, expected.length) : initial.matched;
      revealed = new Set((restore.revealed || []).filter((i) => Number.isInteger(i) && i >= 0 && i < expected.length));
      lastWrong = '';
      active = true;
      build();
      el.hidden = false;
      return render(typed);
    },
    /**
     * Reveal the first position not yet written correctly.
     * @param {string} typed
     * @returns {{index: number|null, added: boolean, view: GuideView}}
     *   index null when everything is already written correctly
     */
    reveal(typed) {
      if (!active) return { index: null, added: false, view: { pulse: 'none' } };
      const { nextIndex } = guideState(expected.join(''), typed);
      const added = nextIndex != null && !revealed.has(nextIndex);
      if (added) {
        revealed.add(nextIndex);
        onReveal?.([...revealed].sort((a, b) => a - b));
      }
      const view = render(typed);
      const box = boxes[nextIndex];
      if (box && !prefersReducedMotion()) {
        box.animate([
          { transform: 'perspective(300px) rotateY(90deg)', opacity: 0.4 },
          { transform: 'perspective(300px) rotateY(0)', opacity: 1 },
        ], { duration: added ? 380 : 260, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
      return { index: nextIndex, added, view };
    },
    /** @param {string} typed @returns {GuideView|null} */
    update(typed) {
      return active ? render(typed) : null;
    },
    deactivate() {
      active = false;
      el.hidden = true;
      strip.replaceChildren();
      message.replaceChildren();
      boxes = [];
      expected = [];
      revealed = new Set();
      typedNow = '';
    },
    /** True when a click would reveal a new character right now. */
    canReveal(typed = typedNow) {
      if (!active) return true;
      const { nextIndex } = guideState(expected.join(''), typed);
      return nextIndex != null && !revealed.has(nextIndex);
    },
    get active() { return active; },
    get hint2From() { return from; },
    get revealedCount() { return revealed.size; },
    get revealed() { return [...revealed].sort((a, b) => a - b); },
    get length() { return expected.length; },
    expectedAt: (i) => expected[i] ?? '',
  };
}
