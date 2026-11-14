/**
 * Labels, icons and chips for the v2 practice modes (romaji → write / listen → write) and input
 * methods (kana keys / handwriting / device keyboard), shared by the dashboard and results pages
 * (SPEC 15.2, 15.3, 15.6).
 * @module results/practice-meta
 */
import { h, svg } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const rect = (x, y, width, height, rx = 2) => ({ tag: 'rect', x, y, width, height, rx });

/** Glyphs the shared icon set does not have, drawn in the same 24×24 round-stroke style. */
const GLYPHS = {
  headphones: ['M3 14v-2a9 9 0 0 1 18 0v2', rect(3, 14, 5, 7, 2), rect(16, 14, 5, 7, 2)],
  pen: ['M12 20h9', 'M16.38 3.62a2.12 2.12 0 0 1 3 3L7.37 18.64a2 2 0 0 1-.86.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.86z'],
  'kana-keys': [rect(3, 3, 8, 8, 2), rect(13, 3, 8, 8, 2), rect(3, 13, 8, 8, 2), rect(13, 13, 8, 8, 2)],
};

/**
 * An icon from the shared set, or one of the local glyphs above.
 * @param {string} name
 * @param {{size?: number, title?: string}} [opts]
 * @returns {SVGSVGElement}
 */
export function metaIcon(name, { size = 16, title } = {}) {
  const shapes = GLYPHS[name];
  if (!shapes) return icon(name, { size, title });
  const root = svg('svg', {
    class: `icon icon-${name}`, width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', focusable: 'false',
  });
  if (title) {
    root.setAttribute('role', 'img');
    root.appendChild(svg('title', null, title));
  } else root.setAttribute('aria-hidden', 'true');
  for (const s of shapes) {
    if (typeof s === 'string') root.appendChild(svg('path', { d: s }));
    else { const { tag, ...attrs } = s; root.appendChild(svg(tag, attrs)); }
  }
  return root;
}

/** Practice modes, in display order. */
export const MODES = Object.freeze({
  romaji: { key: 'romaji', label: 'Romaji → write', short: 'Romaji', icon: 'type', text: 'Read the romaji, write the word in kana.' },
  listen: { key: 'listen', label: 'Listen → write', short: 'Listen', icon: 'headphones', text: 'Hear the word spoken, then write what you heard.' },
});

/** Input methods, in display order. */
export const INPUTS = Object.freeze({
  keys: { key: 'keys', label: 'Kana keys', icon: 'kana-keys', text: 'The on-screen kana keyboard.' },
  handwriting: { key: 'handwriting', label: 'Handwriting', icon: 'pen', text: 'Write each kana by hand on the pad.' },
  device: { key: 'device', label: 'Device keyboard', icon: 'keyboard', text: 'Your own keyboard or Japanese IME.' },
});

/**
 * Mode of a TestSummary / QuestionPublic config (old tests are romaji).
 * @param {object} [config]
 * @returns {'romaji'|'listen'}
 */
export function modeOf(config) {
  return config?.mode === 'listen' ? 'listen' : 'romaji';
}

/**
 * A compact chip naming a practice mode, with its icon.
 * @param {'romaji'|'listen'} mode
 * @param {{size?: 'xs'|'md', full?: boolean}} [opts] full: "Listen → write" instead of "Listen"
 * @returns {HTMLSpanElement}
 */
export function modeChip(mode, { size = 'xs', full = false } = {}) {
  const m = MODES[mode] || MODES.romaji;
  return h('span', { class: ['chip', size === 'xs' && 'chip-xs', 'mode-chip', `is-${m.key}`] },
    metaIcon(m.icon, { size: size === 'xs' ? 12 : 14 }), full ? m.label : m.short);
}

/**
 * A small icon badge for the input method used on an answer, with a tooltip.
 * @param {'keys'|'handwriting'|'device'|null} method
 * @returns {HTMLSpanElement|null} null when the method is unknown (skips, answers saved before v2)
 */
export function inputBadge(method) {
  const m = INPUTS[method];
  if (!m) return null;
  return h('span', { class: ['input-badge', `is-${m.key}`], 'data-tip': `Answered with ${m.label.toLowerCase()}` },
    metaIcon(m.icon, { size: 14 }), h('span', { class: 'visually-hidden' }, `Answered with ${m.label.toLowerCase()}.`));
}
