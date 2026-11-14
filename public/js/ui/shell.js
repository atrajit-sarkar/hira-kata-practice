/**
 * App shell: sticky topbar (brand, nav, theme menu, user menu, guest pill) and footer.
 * Re-renders on store changes and route changes.
 * @module ui/shell
 */
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { wordmark } from './brand.js';
import { attachMenu } from './menu.js';
import { toast } from './toast.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { navigate, parseHash } from '../router.js';

const NAV = [
  { href: '#/dashboard', label: 'Dashboard', icon: 'chart', match: /^\/(dashboard|practice|results)/ },
  { href: '#/vocab', label: 'Vocabulary', icon: 'book', match: /^\/vocab/ },
];

const THEMES = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

const ATTRIBUTION = 'Dictionary data: JMdict © Electronic Dictionary Research and Development Group, '
  + 'used under CC BY-SA 4.0 · JLPT levels: Jonathan Waller (tanos.co.uk), CC BY, via stephenmk/yomitan-jlpt-vocab · '
  + 'Handwriting stroke data: KanjiVG © Ulrich Apel, CC BY-SA 3.0.';

let els = null;
let layout = 'public';
let menus = [];

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return letters.toUpperCase();
}

/** Log out, clear state and return to the landing page. */
export async function logout() {
  store.flushSettings();
  try {
    await api.auth.logout();
  } catch (err) {
    if (err?.status !== 401) { toast(err.message || 'Could not log out.', { type: 'error' }); return; }
  }
  store.setUser(null);
  navigate('/', { replace: true });
  toast('You have been logged out.', { type: 'info' });
}

function themeButton() {
  const current = THEMES.find((t) => t.value === store.settings.theme) || THEMES[0];
  const btn = h('button', {
    class: 'btn btn-ghost btn-icon topbar-icon-btn',
    type: 'button',
    'aria-label': `Theme: ${current.label}`,
    'data-tip': 'Theme',
    'data-focus-key': 'theme',
  }, icon(current.icon, { size: 18 }));
  menus.push(attachMenu(btn, () => THEMES.map((t) => ({
    label: t.label,
    icon: t.icon,
    checked: store.settings.theme === t.value,
    radio: true,
    onClick: () => store.updateSettings({ theme: t.value }),
  })), { label: 'Theme' }));
  return btn;
}

function userButton(user) {
  const btn = h('button', {
    class: 'user-button', type: 'button', 'aria-label': `Account menu for ${user.displayName}`, 'data-focus-key': 'user',
  },
    h('span', { class: ['avatar', user.isGuest && 'is-guest'] }, user.isGuest ? icon('user', { size: 16 }) : initials(user.displayName)),
    h('span', { class: 'user-button-name' }, user.displayName),
    icon('chevron-down', { size: 16, className: 'user-button-caret' }));
  menus.push(attachMenu(btn, () => [
    { heading: user.displayName, description: user.isGuest ? 'Guest account' : user.email },
    { divider: true },
    { label: 'Dashboard', icon: 'chart', onClick: () => navigate('/dashboard') },
    { label: 'Vocabulary', icon: 'book', onClick: () => navigate('/vocab') },
    { label: 'Settings', icon: 'settings', onClick: () => navigate('/settings') },
    ...(user.isGuest ? [{ label: 'Save your progress', icon: 'shield', onClick: () => navigate('/register') }] : []),
    { divider: true },
    { label: 'Log out', icon: 'log-out', danger: true, onClick: logout },
  ], { label: 'Account' }));
  return btn;
}

function renderTopbar() {
  for (const m of menus) m.destroy();
  menus = [];
  const { topbar } = els;
  const focusKey = topbar.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  clear(topbar);
  const user = store.user;
  const { path } = parseHash();
  const showNav = Boolean(user) && layout === 'app';

  const nav = showNav ? h('nav', { class: 'topbar-nav', 'aria-label': 'Main' },
    NAV.map((item) => {
      const active = item.match.test(path);
      return h('a', {
        class: ['topbar-link', active && 'is-active'],
        href: item.href,
        'aria-current': active ? 'page' : undefined,
        'aria-label': item.label,
      }, icon(item.icon, { size: 16 }), h('span', null, item.label));
    })) : null;

  const actions = h('div', { class: 'topbar-actions' }, themeButton());
  if (user) {
    if (user.isGuest) {
      actions.appendChild(h('a', { class: 'guest-pill', href: '#/register', 'data-tip': 'Create an account to keep your progress' },
        h('span', { class: 'guest-pill-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'guest-pill-label' }, 'Guest'),
        h('span', { class: 'guest-pill-cta' }, 'Save progress')));
    }
    actions.appendChild(userButton(user));
  } else {
    if (path !== '/login') actions.appendChild(h('a', { class: 'btn btn-ghost btn-sm', href: '#/login' }, 'Log in'));
    if (path !== '/register') actions.appendChild(h('a', { class: 'btn btn-primary btn-sm', href: '#/register' }, 'Get started'));
  }

  topbar.appendChild(h('div', { class: 'topbar-inner container' },
    h('a', { class: 'topbar-brand', href: user ? '#/dashboard' : '#/', 'aria-label': 'HiraKata home' }, wordmark({ size: 30 })),
    nav,
    actions));
  if (focusKey) topbar.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
}

function renderFooter() {
  const { footer } = els;
  clear(footer);
  footer.appendChild(h('div', { class: 'footer-inner container' },
    h('div', { class: 'footer-brand' },
      wordmark({ size: 22, tagline: true }),
      h('p', { class: 'footer-tagline' }, 'Learn to write hiragana and katakana through real vocabulary.')),
    h('div', { class: 'footer-meta' },
      h('p', { class: 'footer-attribution' }, ATTRIBUTION),
      h('p', { class: 'footer-fonts' }, 'Fonts: Inter, Klee One, Noto Sans JP (SIL OFL). © ', String(new Date().getFullYear()), ' HiraKata.'))));
}

/**
 * Mount the shell into the given elements and keep it in sync with the store.
 * @param {{topbar: HTMLElement, footer: HTMLElement}} targets
 */
export function mountShell({ topbar, footer }) {
  els = { topbar, footer };
  topbar.classList.add('topbar');
  footer.classList.add('site-footer');
  renderTopbar();
  renderFooter();
  store.subscribe(() => renderTopbar());
  const onScroll = () => topbar.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/**
 * Switch shell layout ('public' | 'app' | 'focus'); called by the router on every navigation.
 * @param {'public'|'app'|'focus'} next
 * @param {string|null} pageName
 */
export function setLayout(next, pageName) {
  layout = next;
  document.body.dataset.layout = next;
  document.body.dataset.page = pageName || '';
  els.topbar.hidden = next === 'focus';
  els.footer.hidden = next === 'focus';
  renderTopbar();
}
