/**
 * Hanko-style grade seal: a vermilion ink stamp with the Japanese grade mark (秀/優/良/可/不可)
 * and the letter grade, pressed in with a short stamp animation.
 * @module results/seal
 */
import { h, svg, uid } from '../ui/dom.js';
import { gradeInfo } from './grade.js';

/**
 * Ink filter: a low-frequency warp roughens the edges, and high-frequency grain knocks tiny
 * speckles out of the ink so the stamp reads as pressed onto paper rather than drawn.
 * @param {string} id
 * @returns {SVGFilterElement}
 */
function inkFilter(id) {
  return svg('filter', { id, x: '-10%', y: '-10%', width: '120%', height: '120%', 'color-interpolation-filters': 'sRGB' },
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.035', numOctaves: '2', seed: '4', result: 'warp' }),
    svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'warp', scale: '3.2', xChannelSelector: 'R', yChannelSelector: 'G', result: 'rough' }),
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: '2', seed: '11', result: 'grain' }),
    svg('feColorMatrix', {
      in: 'grain',
      type: 'matrix',
      values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.6 0 0 0 2.25',
      result: 'speckle',
    }),
    svg('feComposite', { in: 'rough', in2: 'speckle', operator: 'in' }));
}

/**
 * Render the grade seal.
 * @param {string|null} grade 'S'|'A'|'B'|'C'|'D', or null when nothing was answered
 * @param {{animate?: boolean, size?: number}} [opts] animate plays the stamp-in motion; size (px)
 *   overrides the CSS default (148 px, 116 px on phones)
 * @returns {HTMLElement} <figure class="grade-seal">
 */
export function gradeSeal(grade, { animate = true, size } = {}) {
  const info = gradeInfo(grade);
  const filterId = uid('seal-ink');
  const twoChars = info && Array.from(info.kanji).length > 1;

  const art = info
    ? svg('g', { filter: `url(#${filterId})`, class: 'grade-seal-ink' },
      svg('circle', { cx: 60, cy: 60, r: 54, fill: 'none', 'stroke-width': 5.5 }),
      svg('circle', { cx: 60, cy: 60, r: 46.5, fill: 'none', 'stroke-width': 1.6 }),
      svg('text', {
        x: 60, y: twoChars ? 66 : 67, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        class: 'grade-seal-kanji', 'font-size': twoChars ? 33 : 52,
        'letter-spacing': twoChars ? '-1' : '0',
      }, info.kanji),
      svg('text', {
        x: 60, y: 27, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        class: 'grade-seal-letter', 'font-size': 15,
      }, grade))
    : svg('g', { class: 'grade-seal-empty' },
      svg('circle', { cx: 60, cy: 60, r: 54, fill: 'none', 'stroke-width': 2, 'stroke-dasharray': '4 6' }),
      svg('text', { x: 60, y: 62, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 34 }, '—'));

  const label = info
    ? `Grade ${grade}: ${info.kanji} (${info.reading}), ${info.label}`
    : 'No grade yet: nothing was answered';

  return h('figure', {
    class: ['grade-seal', info ? `is-grade-${grade}` : 'is-empty', animate && info && 'is-stamping'],
    style: size ? { '--seal-size': `${size}px` } : undefined,
    role: 'img',
    'aria-label': label,
  },
  svg('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true', focusable: 'false' },
    svg('defs', null, inkFilter(filterId)),
    svg('g', { class: 'grade-seal-tilt' }, art)));
}
