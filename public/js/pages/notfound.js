/**
 * 404 page (SPEC §12.8).
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export default {
  title: 'Page not found',
  layout: 'public',
  auth: false,
  render(root, ctx) {
    const home = ctx.user ? '#/dashboard' : '#/';
    root.appendChild(h('section', { class: 'notfound container' },
      h('div', { class: 'notfound-mark', 'aria-hidden': 'true', lang: 'ja' },
        h('span', { class: 'notfound-bracket' }, '「'),
        h('span', { class: 'notfound-q' }, '？'),
        h('span', { class: 'notfound-bracket' }, '」')),
      h('p', { class: 'eyebrow' }, 'Error 404'),
      h('h1', null, 'This page is not in our dictionary'),
      h('p', { class: 'notfound-text' },
        'The link may be broken or the page may have moved. ',
        h('span', { class: 'jp', lang: 'ja' }, 'ページが見つかりません。')),
      h('div', { class: 'notfound-actions' },
        h('a', { class: 'btn btn-primary btn-lg', href: home }, icon('home', { size: 18 }), ctx.user ? 'Go to dashboard' : 'Go home'),
        h('button', { class: 'btn btn-secondary btn-lg', type: 'button', on: { click: () => history.back() } },
          icon('arrow-left', { size: 18 }), 'Go back'))));
  },
};
