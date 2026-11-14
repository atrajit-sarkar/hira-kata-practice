/**
 * Input-method switcher (SPEC §15.3): Kana keys / Handwriting / Device keyboard, plus the short
 * panel shown in device-keyboard mode. Pressing the switcher never moves focus away from the
 * answer field, so desktop typing carries on uninterrupted.
 * @module practice/input-method
 */
import { h, svg, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { segmented } from '../ui/controls.js';

/** @typedef {'keys'|'handwriting'|'device'} InputMethod */
export const INPUT_METHODS = Object.freeze(['keys', 'handwriting', 'device']);

/** Brush icon in the ui/icons.js style (24×24, round strokes). */
function penIcon(size = 16) {
  return svg('svg', {
    class: 'icon', viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, svg('path', { d: 'M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8 7.6 16.4l.6-3.4z' }),
  svg('path', { d: 'M7.6 16.4c-1.9.4-2.8 1.6-3.1 3.2-.2.9-.9 1.4-1.9 1.6 3.4.9 6.4.2 7.6-2.1' }));
}

/** A tiny key cap with a kana on it. */
function kanaKeyIcon() {
  return h('span', { class: 'im-kana-icon', 'aria-hidden': 'true', lang: 'ja' }, 'あ');
}

export const METHOD_LABELS = Object.freeze({
  keys: 'Kana keys',
  handwriting: 'Handwriting',
  device: 'Device keyboard',
});
const SHORT_LABELS = { keys: 'Keys', handwriting: 'Write', device: 'Device' };
const ICONS = { keys: kanaKeyIcon, handwriting: () => penIcon(16), device: () => icon('keyboard', { size: 16 }) };

/**
 * Create the switcher.
 * @param {{value: InputMethod, onChange: (method: InputMethod) => void}} opts
 * @returns {{el: HTMLElement, setValue: (method: InputMethod) => void}}
 */
export function createMethodSwitcher({ value, onChange }) {
  const control = segmented({
    label: 'Input method',
    size: 'sm',
    className: 'im-switch',
    value,
    options: INPUT_METHODS.map((m) => ({
      value: m,
      ariaLabel: METHOD_LABELS[m],
      label: h('span', { class: 'im-option' }, ICONS[m](),
        h('span', { class: 'im-long' }, METHOD_LABELS[m]),
        h('span', { class: 'im-short', 'aria-hidden': 'true' }, SHORT_LABELS[m])),
    })),
    onChange: (m) => onChange(m),
  });
  control.el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  const labelId = uid('im-label');
  const el = h('div', { class: 'im' },
    h('span', { class: 'im-label', id: labelId }, 'Answer with'),
    control.el);
  control.el.setAttribute('aria-labelledby', labelId);
  control.el.removeAttribute('aria-label');
  return { el, setValue: (m) => control.setValue(m) };
}

/**
 * Panel shown in device-keyboard mode: what to type, a romaji-typing switch and, while romaji
 * typing is on, the script the romaji turns into.
 * @param {{onToggleRomaji: () => void, onScript: (script: 'hiragana'|'katakana') => void}} opts
 * @returns {{el: HTMLElement, setRomaji: (on: boolean) => void, setScript: (script: string) => void}}
 */
export function createDevicePanel({ onToggleRomaji, onScript }) {
  const script = segmented({
    label: 'Romaji typing script',
    size: 'sm',
    className: 'im-device-script kb-script',
    value: 'hiragana',
    options: [
      { value: 'hiragana', label: h('span', { class: 'kana', lang: 'ja' }, 'あ'), ariaLabel: 'Hiragana' },
      { value: 'katakana', label: h('span', { class: 'kana', lang: 'ja' }, 'ア'), ariaLabel: 'Katakana' },
    ],
    onChange: (v) => onScript(v),
  });
  script.el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  script.el.dataset.tip = 'Romaji turns into this script (Alt+K)';
  const state = h('span', { class: 'im-device-state' });
  const toggle = h('button', {
    class: 'btn btn-secondary btn-sm im-device-toggle', type: 'button', role: 'switch',
    on: { click: () => onToggleRomaji(), mousedown: (e) => e.preventDefault() },
  }, icon('type', { size: 15 }), h('span', null, 'Romaji typing'), state);
  const text = h('p', { class: 'im-device-text' });
  const el = h('div', { class: 'im-device' },
    h('span', { class: 'im-device-icon', 'aria-hidden': 'true' }, icon('keyboard', { size: 22 })),
    h('div', { class: 'im-device-copy' }, h('p', { class: 'im-device-title' }, 'Typing with your device keyboard'), text),
    h('div', { class: 'im-device-actions' }, script.el, toggle));
  return {
    el,
    setScript(v) { script.setValue(v); el.dataset.script = v; },
    setRomaji(on) {
      script.el.hidden = !on;
      toggle.setAttribute('aria-checked', String(Boolean(on)));
      state.textContent = on ? 'On' : 'Off';
      text.textContent = on
        ? 'Type romaji and it turns into kana as you go (neko → ねこ).'
        : 'Use a Japanese keyboard (IME), or switch on romaji typing to convert as you type.';
    },
  };
}
