/**
 * Stacked toast notifications (bottom-right on desktop, bottom-center on mobile).
 * @module ui/toast
 */
import { h } from './dom.js';
import { icon } from './icons.js';

const ICON_BY_TYPE = { info: 'info', success: 'check-circle', error: 'x-circle' };
const MAX_VISIBLE = 3;
/** Live toasts → their handles, for de-duplication and clearToasts(). */
const live = new Map();

function root() {
  let el = document.getElementById('toast-root');
  if (!el) {
    el = h('div', { id: 'toast-root', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.classList.add('toast-root');
  return el;
}

/**
 * Show a toast.
 * @param {string} message
 * @param {{type?: 'info'|'success'|'error', timeout?: number,
 *   action?: {label: string, onClick: () => void}}} [opts] timeout 0 keeps it until dismissed.
 *   Errors stay 1.5× longer. The timer pauses while hovered or focused. Showing a message that
 *   is already on screen (same text and type, no action) restarts that toast instead of stacking
 *   a copy; at most MAX_VISIBLE toasts are shown (the oldest is dismissed).
 * @returns {{close: () => void}}
 */
export function toast(message, { type = 'info', timeout = 3500, action } = {}) {
  const container = root();
  const key = action ? null : `${type}|${message}`;
  if (key) {
    for (const handle of live.values()) {
      if (handle.key === key) { handle.restart(); return { close: handle.close }; }
    }
  }
  let remaining = type === 'error' && timeout ? timeout * 1.5 : timeout;
  let timer = null;
  let startedAt = 0;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    live.delete(el);
    el.classList.add('is-leaving');
    const done = () => el.remove();
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 400);
  };

  const el = h('div', {
    class: `toast toast-${type}`,
    role: type === 'error' ? 'alert' : 'status',
  },
  h('span', { class: 'toast-icon' }, icon(ICON_BY_TYPE[type] || 'info', { size: 18 })),
  h('div', { class: 'toast-message' }, message),
  action ? h('button', {
    class: 'toast-action',
    type: 'button',
    on: { click: () => { close(); action.onClick?.(); } },
  }, action.label) : null,
  h('button', {
    class: 'toast-close',
    type: 'button',
    'aria-label': 'Dismiss notification',
    on: { click: close },
  }, icon('x', { size: 16 })),
  remaining ? h('span', { class: 'toast-timer', style: { '--toast-duration': `${remaining}ms` } }) : null);

  const start = () => {
    if (!remaining || closed) return;
    startedAt = Date.now();
    timer = setTimeout(close, remaining);
    el.classList.remove('is-paused');
  };
  const pause = () => {
    if (!remaining || closed || !timer) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(600, remaining - (Date.now() - startedAt));
    el.classList.add('is-paused');
  };
  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', start);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) start(); });

  /** Show the same message again: restart the countdown and nudge the toast. */
  const restart = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = null;
    remaining = type === 'error' && timeout ? timeout * 1.5 : timeout;
    const bar = el.querySelector('.toast-timer');
    if (bar) bar.replaceWith(bar.cloneNode(true));
    el.classList.remove('is-bumped');
    void el.offsetWidth;
    el.classList.add('is-bumped');
    if (!el.matches(':hover, :focus-within')) start();
  };

  const handle = { key, close, restart };
  live.set(el, handle);
  container.appendChild(el);
  if (live.size > MAX_VISIBLE) live.values().next().value.close();
  start();
  return { close };
}

/** Dismiss every visible toast (e.g. when the signed-in user changes). */
export function clearToasts() {
  for (const handle of [...live.values()]) handle.close();
}
