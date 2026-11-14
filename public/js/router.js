/**
 * Hash router with lazy page modules, auth guards, transitions and focus management (SPEC §10.1).
 * @module router
 */
import { h, clear } from './ui/dom.js';
import { icon } from './ui/icons.js';

/** Route table: `:name` segments become ctx.params. Order matters (first match wins). */
const ROUTES = [
  { pattern: '/', page: 'landing' },
  { pattern: '/login', page: 'login' },
  { pattern: '/register', page: 'register' },
  { pattern: '/dashboard', page: 'dashboard' },
  { pattern: '/practice/:id', page: 'practice' },
  { pattern: '/results/:id', page: 'results' },
  { pattern: '/vocab', page: 'vocab' },
  { pattern: '/settings', page: 'settings' },
  { pattern: '/styleguide', page: 'styleguide' },
];
const NOT_FOUND = 'notfound';
const APP_NAME = 'HiraKata';

/**
 * Parse the current (or given) hash into path + query.
 * @param {string} [hash] defaults to location.hash
 * @returns {{path: string, query: Record<string,string>, full: string}}
 */
export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  let path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { path, query, full: queryPart ? `${path}?${queryPart}` : path };
}

/**
 * Validate a `?next=` value: only same-app absolute hash paths are allowed.
 * @param {string|undefined} next
 * @param {string} [fallback]
 * @returns {string}
 */
export function safeNext(next, fallback = '/dashboard') {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback;
  if (/^\/(login|register)(\?|$)/.test(next)) return fallback;
  return next;
}

function matchRoute(path) {
  for (const route of ROUTES) {
    const want = route.pattern.split('/');
    const have = path.split('/');
    if (want.length !== have.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < want.length; i++) {
      if (want[i].startsWith(':')) {
        try { params[want[i].slice(1)] = decodeURIComponent(have[i]); } catch { ok = false; break; }
        if (!params[want[i].slice(1)]) { ok = false; break; }
      } else if (want[i] !== have[i]) { ok = false; break; }
    }
    if (ok) return { page: route.page, params };
  }
  return { page: NOT_FOUND, params: {} };
}

const moduleCache = new Map();
function loadPage(name) {
  if (!moduleCache.has(name)) {
    const p = import(`./pages/${name}.js`).then((m) => m.default);
    p.catch(() => moduleCache.delete(name));
    moduleCache.set(name, p);
  }
  return moduleCache.get(name);
}

let opts = null;
let navToken = 0;
let cleanup = null;
let currentPage = null;

/**
 * Change the route.
 * @param {string} path e.g. "/practice/12" or "/login?next=%2Fvocab"
 * @param {{replace?: boolean, silent?: boolean}} [o] replace: replace the history entry;
 *   silent: update the URL (e.g. filter query params) without re-rendering the page.
 */
export function navigate(path, { replace = false, silent = false } = {}) {
  const hash = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (silent) {
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    if (replace) history.replaceState(history.state, '', url);
    else history.pushState(history.state, '', url);
    return;
  }
  if (hash === window.location.hash) {
    render();
    return;
  }
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}

/** Re-render the current route (e.g. after login state changes). */
export function refresh() {
  return render();
}

/** @returns {{name: string|null, page: object|null, path: string, query: object}} */
export function currentRoute() {
  const { path, query } = parseHash();
  return { name: currentPage?.name ?? null, page: currentPage?.page ?? null, path, query };
}

function resolveTitle(page, ctx) {
  const t = typeof page.title === 'function' ? page.title(ctx) : page.title;
  return t ? `${t} · ${APP_NAME}` : `${APP_NAME} — Write Japanese, one word at a time`;
}

function renderLoadError(view, err, retry) {
  console.error('[router] page failed', err);
  clear(view);
  view.appendChild(h('div', { class: 'container page-error' },
    h('div', { class: 'empty-state' },
      h('div', { class: 'empty-state-icon' }, icon('alert-triangle', { size: 28 })),
      h('h2', null, 'This page could not load'),
      h('p', { class: 'text-secondary' }, 'Something went wrong while opening this page. Check your connection and try again.'),
      h('div', { class: 'empty-state-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', on: { click: retry } }, icon('refresh', { size: 18 }), 'Try again'),
        h('a', { class: 'btn btn-secondary', href: '#/' }, 'Go home')))));
}

async function render() {
  const token = ++navToken;
  const { view, getUser, onLayout, extras } = opts;
  const { path, query, full } = parseHash();
  const { page: name, params } = matchRoute(path);
  let page;
  try {
    page = await loadPage(name);
  } catch (err) {
    if (token !== navToken) return;
    runCleanup();
    onLayout('public', null);
    renderLoadError(view, err, () => render());
    return;
  }
  if (token !== navToken) return;

  const user = getUser();
  if (page.auth && !user) {
    navigate(`/login?next=${encodeURIComponent(full)}`, { replace: true });
    return;
  }
  if (page.publicOnly && user && !user.isGuest) {
    navigate('/dashboard', { replace: true });
    return;
  }

  runCleanup();
  const ctx = { params, query, user, navigate, ...extras };
  currentPage = { name, page };
  onLayout(page.layout || 'app', name);
  document.title = resolveTitle(page, ctx);

  clear(view);
  view.classList.remove('view-enter');
  void view.offsetWidth; // restart the enter animation
  view.classList.add('view-enter');
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  try {
    const result = await page.render(view, ctx);
    if (token !== navToken) {
      if (typeof result === 'function') result();
      return;
    }
    cleanup = typeof result === 'function' ? result : null;
  } catch (err) {
    if (token !== navToken) return;
    renderLoadError(view, err, () => render());
  }
  if (token === navToken && !view.contains(document.activeElement)) {
    view.focus({ preventScroll: true });
  }
}

function runCleanup() {
  if (!cleanup) return;
  try { cleanup(); } catch (err) { console.error('[router] cleanup failed', err); }
  cleanup = null;
}

/**
 * Start routing.
 * @param {{view: HTMLElement, getUser: () => object|null,
 *   onLayout: (layout: 'public'|'app'|'focus', pageName: string|null) => void,
 *   extras: object}} options extras are merged into every page ctx (store, api)
 */
export function startRouter(options) {
  opts = options;
  window.addEventListener('hashchange', () => render());
  wireView(options.view);
  return render();
}

function wireView(el) {
  el.addEventListener('animationend', (e) => {
    if (e.target === el) el.classList.remove('view-enter');
  });
}
