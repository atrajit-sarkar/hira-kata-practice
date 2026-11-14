/**
 * Brand mark and wordmark.
 * @module ui/brand
 */
import { h, svg, uid } from './dom.js';

/**
 * The HiraKata logo mark: a rounded square split diagonally, あ on hiragana blue (top-left) and
 * ア on katakana orange (bottom-right). Colours are fixed brand colours (not theme tokens) so the
 * mark is identical everywhere, including the favicon.
 * @param {{size?: number, title?: string}} [opts] title makes it meaningful for screen readers
 * @returns {SVGSVGElement}
 */
export function logoMark({ size = 32, title } = {}) {
  const clipId = uid('hk-logo-clip');
  const glyph = (text, x, y) => svg('text', {
    x, y,
    'text-anchor': 'middle',
    'font-family': '"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif',
    'font-weight': 700,
    'font-size': 25,
    fill: '#ffffff',
  }, text);
  const root = svg('svg', {
    class: 'logo-mark',
    width: size,
    height: size,
    viewBox: '0 0 64 64',
    focusable: 'false',
  },
  svg('defs', null,
    svg('clipPath', { id: clipId }, svg('rect', { width: 64, height: 64, rx: 16 }))),
  svg('g', { 'clip-path': `url(#${clipId})` },
    svg('rect', { width: 64, height: 64, fill: '#eb6834' }),
    svg('path', { d: 'M0 0H64L0 64Z', fill: '#2a78d6' }),
    svg('path', { d: 'M64 0L0 64', stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1.5 }),
    glyph('あ', 21, 31),
    glyph('ア', 43, 53)));
  if (title) {
    root.setAttribute('role', 'img');
    root.insertBefore(svg('title', null, title), root.firstChild);
  } else {
    root.setAttribute('aria-hidden', 'true');
  }
  return root;
}

/**
 * Logo mark plus the "HiraKata" name.
 * @param {{size?: number, tagline?: boolean}} [opts] tagline adds the Japanese name ひらカタ
 * @returns {HTMLSpanElement}
 */
export function wordmark({ size = 28, tagline = false } = {}) {
  return h('span', { class: 'wordmark' },
    logoMark({ size }),
    h('span', { class: 'wordmark-text' },
      'Hira', h('span', { class: 'wordmark-kata' }, 'Kata')),
    tagline ? h('span', { class: 'wordmark-jp', lang: 'ja' }, 'ひらカタ') : null);
}
