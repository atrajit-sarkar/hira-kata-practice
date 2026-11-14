/**
 * Split layout for the login/register pages: brand panel (floating kana + quote) and form card.
 * @module ui/auth-layout
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { wordmark } from './brand.js';
import { kanaBackground } from './kana-bg.js';

const POINTS = [
  { icon: 'wand', text: 'Guided live spelling, one character at a time' },
  { icon: 'book', text: 'Real dictionary words with meanings' },
  { icon: 'chart', text: 'Progress you can see — and download' },
];

/**
 * @param {{eyebrow?: string, title: string, subtitle?: string|Node, body: Node|Node[],
 *   footer?: Node|Node[], className?: string}} opts
 * @returns {HTMLElement}
 */
export function authLayout({ eyebrow, title, subtitle, body, footer, className }) {
  return h('div', { class: ['auth', className] },
    h('aside', { class: 'auth-brand', 'aria-hidden': 'true' },
      kanaBackground({ count: 24, seed: 3, className: 'auth-kana-bg' }),
      h('div', { class: 'auth-brand-inner' },
        h('a', { class: 'auth-brand-logo', href: '#/', tabindex: '-1' }, wordmark({ size: 34, tagline: true })),
        h('figure', { class: 'auth-quote' },
          h('blockquote', null,
            h('p', { class: 'auth-quote-jp', lang: 'ja' }, '継続は力なり'),
            h('p', { class: 'auth-quote-en' }, '“Persistence is power.”')),
          h('figcaption', null, 'Japanese proverb · けいぞく は ちから なり')),
        h('ul', { class: 'auth-points', role: 'list' },
          POINTS.map((p) => h('li', null, h('span', { class: 'auth-point-icon' }, icon(p.icon, { size: 16 })), p.text))))),
    h('section', { class: 'auth-main' },
      h('div', { class: 'auth-card' },
        h('header', { class: 'auth-header' },
          eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null,
          h('h1', null, title),
          subtitle ? h('p', { class: 'auth-subtitle' }, subtitle) : null),
        body,
        footer ? h('div', { class: 'auth-footer' }, footer) : null)));
}

/**
 * "or" divider used between the form and alternative actions.
 * @param {string} [text]
 * @returns {HTMLDivElement}
 */
export function orDivider(text = 'or') {
  return h('div', { class: 'auth-divider', role: 'separator' }, h('span', null, text));
}
