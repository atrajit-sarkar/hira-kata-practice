/**
 * Practice page (`/practice/:id`, focus layout; SPEC §12.4). Shows a skeleton while the test
 * state loads, then hands over to the {@link PracticeController}. Inactive tests redirect to their
 * results; load failures show a retryable error panel.
 * @module pages/practice
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { ApiError } from '../api.js';
import { PracticeController } from '../practice/controller.js';

function skeleton() {
  return h('div', { class: 'pr pr-loading', 'aria-busy': 'true' },
    h('div', { class: 'pr-header' }, h('div', { class: 'pr-header-inner' },
      h('span', { class: 'skeleton', style: { width: '72px', height: '32px' } }),
      h('div', { class: 'pr-header-main' },
        h('span', { class: 'skeleton', style: { width: '40%', height: '18px' } }),
        h('span', { class: 'skeleton', style: { width: '100%', height: '6px' } })))),
    h('main', { class: 'pr-main' }, h('div', { class: 'pr-stage' },
      h('div', { class: 'pr-card' },
        h('span', { class: 'skeleton', style: { width: '30%', height: '14px' } }),
        h('span', { class: 'skeleton', style: { width: '60%', height: '56px', margin: '20px auto' } }),
        h('span', { class: 'skeleton', style: { width: '100%', height: '72px' } })),
      h('span', { class: 'visually-hidden', role: 'status' }, 'Loading your test…'))));
}

function errorPanel(err, retry) {
  const notFound = err instanceof ApiError && err.status === 404;
  const offline = err instanceof ApiError && err.status === 0;
  return h('div', { class: 'container container-narrow page pr-error' },
    h('div', { class: 'card' }, h('div', { class: 'empty-state' },
      h('div', { class: 'empty-state-icon' }, icon(notFound ? 'search' : 'alert-triangle', { size: 28 })),
      h('h1', null, notFound ? 'Test not found' : 'This test could not be loaded'),
      h('p', null, notFound
        ? 'It may have been deleted, or it belongs to another account.'
        : offline ? 'You seem to be offline. Check your connection and try again.' : (err?.message || 'Something went wrong.')),
      h('div', { class: 'empty-state-actions' },
        notFound ? null : h('button', { class: 'btn btn-primary', type: 'button', on: { click: retry } }, icon('refresh', { size: 18 }), 'Try again'),
        h('a', { class: ['btn', notFound ? 'btn-primary' : 'btn-secondary'], href: '#/dashboard' }, 'Back to dashboard')))));
}

export default {
  title: 'Practice',
  layout: 'focus',
  auth: true,
  async render(root, ctx) {
    let controller = null;
    let disposed = false;

    async function load() {
      controller?.destroy();
      root.replaceChildren(skeleton());
      controller = new PracticeController(root, ctx);
      try {
        await controller.start();
      } catch (err) {
        if (disposed || (err instanceof ApiError && err.status === 401)) return;
        controller.destroy();
        controller = null;
        root.replaceChildren(errorPanel(err, load));
      }
    }

    await load();
    return () => {
      disposed = true;
      controller?.destroy();
    };
  },
};
