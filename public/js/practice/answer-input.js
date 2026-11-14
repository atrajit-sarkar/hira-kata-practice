/**
 * The kana answer field (SPEC §12.4, §15.3). Works with a system Japanese IME (composition-aware),
 * the on-screen keyboard and handwriting pad (caret-aware edits that never steal focus) and the
 * optional romaji → kana typing mode (`romajiToKana(…, { ime: true })` while typing, `ime: false`
 * when checking).
 *
 * Virtual mode (`setDeviceKeyboard(false)`, used on touch screens unless the learner picked the
 * device keyboard): the field is `readonly` with `inputmode="none"`, is never focused (not by
 * code, not by a tap), shows a drawn caret instead, and only on-screen input edits it, so the
 * operating system's keyboard can never pop up.
 * @module practice/answer-input
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { romajiToKana, normalizeAnswer, applyModifier } from '/shared/kana.js';

const LATIN_RE = /[A-Za-z]/;
const PENDING_RE = /[A-Za-z']+$/;
const MAX_LENGTH = 40;

const MACRON_VOWEL = { ā: 'a', ī: 'i', ū: 'u', ē: 'e', ō: 'o' };
/**
 * Display romaji (§3.1) whose romaji-typing keystrokes (§3.2) differ. The word bank has no を ぢ づ,
 * so wo/ti/di/tu/du are always the small-vowel combinations, which type as who/thi/dhi/twu/dwu.
 */
const TYPING_SPELLINGS = [
  [/[āīūēō]/g, (c) => `${MACRON_VOWEL[c]}-`], [/nn/g, 'nnn'], [/wo/g, 'who'], [/ti/g, 'thi'],
  [/di/g, 'dhi'], [/tu/g, 'twu'], [/du/g, 'dwu'], [/tyu/g, 'thu'], [/dyu/g, 'dhu'],
  [/(?<!t)si/g, 'suxi'], [/zi/g, 'zuxi'],
];

/**
 * Keystrokes that romaji typing turns into the word shown as `romaji` (kōhī → ko-hi-,
 * wokka → whokka, onna → onnna). Uses only the displayed romaji, so it reveals nothing more.
 * @param {string} romaji display romaji
 * @returns {string}
 */
export function typingRomaji(romaji) {
  return TYPING_SPELLINGS.reduce((s, [re, to]) => s.replace(re, to), String(romaji || ''));
}

/**
 * @typedef {object} AnswerInput
 * @property {HTMLElement} el
 * @property {HTMLInputElement} input
 * @property {() => string} kana         normalized kana typed so far (pending Latin removed)
 * @property {() => string} answer       the answer to submit (trailing romaji converted)
 * @property {() => string} raw          the raw field value
 * @property {(value: string) => void} setValue
 * @property {(ch: string) => void} insert
 * @property {() => void} backspace
 * @property {() => void} clear
 * @property {(mod: string) => boolean} modify  apply a modifier to the char before the caret
 * @property {(on: boolean) => void} setRomajiMode
 * @property {(romaji: string) => void} setTypingHint  show the typing keystrokes for this romaji
 * @property {(allowed: boolean) => void} setDeviceKeyboard  false = virtual mode (see module docs)
 * @property {(locked: boolean) => void} setLocked
 * @property {(state: ''|'correct'|'wrong'|'skipped') => void} setResult
 * @property {(message: string) => void} nudge
 * @property {() => void} focus
 */

/**
 * Create the answer field.
 * @param {{getScript: () => 'hiragana'|'katakana', romaji: boolean, onChange: () => void,
 *   onSubmit: () => void, onEnableRomaji: () => void, onVirtualTap?: () => void}} opts
 *   onVirtualTap: the learner tapped the field in virtual mode (offer the device keyboard)
 * @returns {AnswerInput}
 */
export function createAnswerInput({ getScript, romaji, onChange, onSubmit, onEnableRomaji, onVirtualTap }) {
  let romajiMode = Boolean(romaji);
  let composing = false;
  let selection = { start: 0, end: 0 };
  let locked = false;
  let typingAllowed = true;
  let lastPointerAt = -1e9;

  const input = h('input', {
    class: 'answer-input kana',
    type: 'text',
    lang: 'ja',
    autocomplete: 'off',
    spellcheck: false,
    maxLength: MAX_LENGTH,
    placeholder: 'かな',
    attrs: { autocapitalize: 'off', autocorrect: 'off', enterkeyhint: 'done' },
    'aria-label': 'Your answer in kana',
  });
  const pending = h('span', { class: 'answer-pending', hidden: true, 'aria-hidden': 'true' });
  // Virtual mode: an invisible copy of the text followed by a blinking caret, laid over the field.
  const mirrorText = h('span', { class: 'answer-mirror-text' });
  const mirror = h('span', { class: 'answer-mirror kana', 'aria-hidden': 'true' }, mirrorText, h('span', { class: 'answer-caret' }));
  const fieldWrap = h('div', { class: 'answer-field' }, input, mirror, pending);

  const tipText = h('span', null);
  const enableBtn = h('button', {
    class: 'btn btn-sm btn-secondary', type: 'button',
    on: { click: () => onEnableRomaji() },
  }, icon('type', { size: 16 }), 'Turn on romaji typing');
  const latinTip = h('div', { class: 'answer-tip', hidden: true },
    icon('lightbulb', { size: 16, className: 'answer-tip-icon' }), tipText, enableBtn);
  const nudgeEl = h('div', { class: 'answer-nudge', hidden: true });
  const notes = h('div', { class: 'answer-notes', role: 'status' }, latinTip, nudgeEl);
  // Romaji typing: the exact keystrokes when they differ from the romaji shown (wo → who).
  let typingKeys = '';
  const typingKbd = h('kbd', { class: 'kbd' });
  const typingNote = h('p', { class: 'answer-typing', hidden: true },
    icon('type', { size: 15 }), h('span', null, 'Romaji typing: type '), typingKbd);

  const el = h('div', { class: 'answer', dataset: { result: '' } }, fieldWrap, typingNote, notes);

  function refreshTyping() {
    typingKbd.textContent = typingKeys;
    typingNote.hidden = !romajiMode || !typingKeys || input.readOnly;
  }

  function syncMirror() {
    mirrorText.textContent = input.value;
    mirror.classList.toggle('is-empty', !input.value);
  }

  function syncMode() {
    input.readOnly = locked || !typingAllowed;
    input.inputMode = typingAllowed ? 'text' : 'none';
    input.setAttribute('aria-readonly', String(locked));
    el.classList.toggle('is-virtual', !typingAllowed);
    if (!typingAllowed && document.activeElement === input) input.blur();
    syncMirror();
    refreshTyping();
  }

  // Virtual mode: a tap must neither focus the field nor open the device keyboard.
  const blockPress = (e) => {
    if (typingAllowed) return;
    lastPointerAt = performance.now();
    e.preventDefault();
  };
  input.addEventListener('pointerdown', blockPress);
  input.addEventListener('mousedown', blockPress);
  input.addEventListener('focus', () => {
    // Fallback for engines that still focus after a cancelled press (keyboard Tab focus is kept).
    if (!typingAllowed && performance.now() - lastPointerAt < 1000) input.blur();
  });
  fieldWrap.addEventListener('click', () => { if (!typingAllowed && !locked) onVirtualTap?.(); });

  const remember = () => {
    selection = { start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length };
  };

  /** Convert typed romaji in place, keeping the caret after the converted text. */
  function convert() {
    if (!romajiMode || composing) return;
    const v = input.value;
    const caret = input.selectionStart ?? v.length;
    const opts = { script: getScript(), ime: true };
    const before = romajiToKana(v.slice(0, caret), opts);
    const after = romajiToKana(v.slice(caret), opts);
    if (before + after !== v) {
      input.value = before + after;
      input.setSelectionRange(before.length, before.length);
    }
  }

  function refreshNotes() {
    const v = input.value;
    const caret = input.selectionStart ?? v.length;
    const tail = romajiMode ? PENDING_RE.exec(v.slice(0, caret)) : null;
    pending.hidden = !tail;
    pending.textContent = tail ? tail[0] : '';
    const showTip = !romajiMode && LATIN_RE.test(v);
    if (showTip !== !latinTip.hidden) {
      tipText.textContent = 'Typing romaji? Let HiraKata convert it to kana as you type.';
      latinTip.hidden = !showTip;
    }
    if (v) nudgeEl.hidden = true;
  }

  function changed() {
    remember();
    refreshNotes();
    syncMirror();
    onChange();
  }

  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; convert(); changed(); });
  input.addEventListener('input', (e) => {
    if (composing || e.isComposing) return;
    convert();
    changed();
  });
  for (const type of ['select', 'keyup', 'click', 'blur']) input.addEventListener(type, () => { remember(); refreshNotes(); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // Enter confirms an IME conversion; it must never submit while composing.
    if (e.isComposing || composing || e.keyCode === 229) return;
    e.preventDefault();
    if (!e.repeat) onSubmit();
  });

  /** Current selection: live when focused, otherwise the last known caret. */
  function range() {
    if (document.activeElement === input) return { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 };
    const len = input.value.length;
    return { start: Math.min(selection.start, len), end: Math.min(selection.end, len) };
  }

  function replace(text, start, end) {
    if (locked) return;
    input.setRangeText(text, start, end, 'end');
    convert();
    changed();
  }

  return {
    el,
    input,
    kana: () => normalizeAnswer(input.value.replace(/[A-Za-z']/g, '')),
    answer: () => (romajiMode ? romajiToKana(input.value, { script: getScript(), ime: false }) : input.value),
    raw: () => input.value,
    setValue(value) {
      input.value = value || '';
      const end = input.value.length;
      selection = { start: end, end };
      refreshNotes();
      syncMirror();
    },
    insert(ch) {
      if (input.value.length + ch.length > MAX_LENGTH) return;
      const { start, end } = range();
      replace(ch, start, end);
    },
    backspace() {
      const { start, end } = range();
      if (start !== end) { replace('', start, end); return; }
      if (start === 0) return;
      const code = input.value.charCodeAt(start - 1);
      const width = code >= 0xdc00 && code <= 0xdfff && start > 1 ? 2 : 1;
      replace('', start - width, start);
    },
    clear() { if (input.value) replace('', 0, input.value.length); },
    modify(mod) {
      const { start, end } = range();
      if (start !== end || start === 0) return false;
      const ch = input.value.slice(start - 1, start);
      const next = applyModifier(ch, mod);
      if (!next) return false;
      replace(next, start - 1, start);
      return true;
    },
    setRomajiMode(on) {
      if (romajiMode === Boolean(on)) return;
      romajiMode = Boolean(on);
      refreshTyping();
      convert();
      changed();
    },
    setTypingHint(romaji) {
      const keys = typingRomaji(romaji);
      typingKeys = keys !== romaji ? keys : '';
      refreshTyping();
    },
    setDeviceKeyboard(allowed) {
      if (typingAllowed === Boolean(allowed)) return;
      typingAllowed = Boolean(allowed);
      // Edits made while virtual always append, so start from the end of the text.
      if (!typingAllowed) selection = { start: input.value.length, end: input.value.length };
      syncMode();
    },
    setLocked(value) {
      locked = Boolean(value);
      syncMode();
    },
    setResult(state) { el.dataset.result = state || ''; },
    nudge(message) {
      nudgeEl.textContent = message;
      nudgeEl.hidden = false;
      fieldWrap.classList.remove('is-shaking');
      void fieldWrap.offsetWidth;
      fieldWrap.classList.add('is-shaking');
    },
    focus() { if (typingAllowed && !locked) input.focus({ preventScroll: true }); },
    get virtual() { return !typingAllowed; },
  };
}
