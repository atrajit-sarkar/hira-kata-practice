/**
 * Accessible dropdown menus (WAI-ARIA menu button pattern).
 * @module ui/menu
 */
import { h } from './dom.js';
import { icon } from './icons.js';

let openInstance = null;

/**
 * @typedef {object} MenuItem
 * @property {string} [label]
 * @property {string} [icon]      icon name from ui/icons.js
 * @property {() => void} [onClick]
 * @property {string} [href]      renders a link item
 * @property {string|boolean} [download] download attribute for link items
 * @property {boolean} [danger]
 * @property {boolean} [divider]  renders a separator (other props ignored)
 * @property {boolean} [checked]  renders a check mark (menuitemcheckbox semantics: an on/off toggle)
 * @property {boolean} [radio]    with `checked`: one choice of a group (menuitemradio semantics)
 * @property {boolean} [disabled]
 * @property {string} [heading]   non-interactive heading row; `description` adds a second line
 * @property {string} [description]
 */

/**
 * Attach a dropdown menu to a button.
 * @param {HTMLButtonElement} button trigger
 * @param {MenuItem[] | (() => MenuItem[])} items a function is re-evaluated on every open
 * @param {{align?: 'start'|'end', label?: string}} [opts] align the menu edge with the button
 * @returns {{open: (focusLast?: boolean) => void, close: (restoreFocus?: boolean) => void, destroy: () => void}}
 */
export function attachMenu(button, items, { align = 'end', label } = {}) {
  let menuEl = null;
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  const focusables = () => Array.from(menuEl?.querySelectorAll('.menu-item:not([aria-disabled="true"])') || []);

  function build() {
    const list = typeof items === 'function' ? items() : items;
    const hasChecks = list.some((it) => 'checked' in it);
    menuEl = h('div', { class: 'menu', role: 'menu', 'aria-label': label || button.getAttribute('aria-label') || undefined, tabindex: '-1' });
    for (const it of list) {
      if (it.divider) { menuEl.appendChild(h('div', { class: 'menu-divider', role: 'separator' })); continue; }
      if (it.heading) {
        menuEl.appendChild(h('div', { class: 'menu-heading', role: 'presentation' },
          h('div', { class: 'menu-heading-title' }, it.heading),
          it.description ? h('div', { class: 'menu-heading-sub' }, it.description) : null));
        continue;
      }
      const tag = it.href ? 'a' : 'button';
      // Only checkable items carry a checked state; plain actions stay menuitems even in a
      // menu that also has toggles (the check column is still reserved for alignment).
      const checkable = 'checked' in it;
      const el = h(tag, {
        class: ['menu-item', it.danger && 'is-danger'],
        role: checkable ? (it.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem',
        tabindex: '-1',
        'aria-checked': checkable ? String(Boolean(it.checked)) : undefined,
        'aria-disabled': it.disabled ? 'true' : undefined,
      },
      it.icon ? icon(it.icon, { size: 16, className: 'menu-item-icon' }) : null,
      h('span', { class: 'menu-item-label' }, it.label),
      hasChecks ? h('span', { class: 'menu-item-check' }, it.checked ? icon('check', { size: 16 }) : null) : null);
      if (tag === 'button') el.type = 'button';
      if (it.href) {
        el.href = it.href;
        if (it.download) el.setAttribute('download', it.download === true ? '' : it.download);
      }
      el.addEventListener('click', (e) => {
        if (it.disabled) { e.preventDefault(); return; }
        close(true);
        it.onClick?.(e);
      });
      menuEl.appendChild(el);
    }
    menuEl.addEventListener('keydown', onMenuKey);
    return menuEl;
  }

  function position() {
    const r = button.getBoundingClientRect();
    const m = menuEl.getBoundingClientRect();
    const gap = 6;
    const vw = document.documentElement.clientWidth;
    let left = align === 'end' ? r.right - m.width : r.left;
    left = Math.max(8, Math.min(left, vw - m.width - 8));
    let top = r.bottom + gap;
    if (top + m.height > window.innerHeight - 8 && r.top - gap - m.height > 8) {
      top = r.top - gap - m.height;
      menuEl.classList.add('is-above');
    }
    menuEl.style.left = `${Math.round(left)}px`;
    menuEl.style.top = `${Math.round(top)}px`;
  }

  function open(focusLast = false) {
    if (openInstance && openInstance !== api) openInstance.close(false);
    if (menuEl) return;
    document.body.appendChild(build());
    position();
    button.setAttribute('aria-expanded', 'true');
    button.classList.add('is-active');
    openInstance = api;
    const list = focusables();
    (focusLast ? list[list.length - 1] : list[0])?.focus();
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
  }

  function close(restoreFocus = true) {
    if (!menuEl) return;
    const el = menuEl;
    menuEl = null;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 140);
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('is-active');
    if (openInstance === api) openInstance = null;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);
    if (restoreFocus) button.focus();
  }

  function onOutside(e) {
    if (menuEl?.contains(e.target) || button.contains(e.target)) return;
    close(false);
  }

  function onViewportChange(e) {
    if (e.type === 'scroll' && menuEl?.contains(e.target)) return;
    close(false);
  }

  function onMenuKey(e) {
    const list = focusables();
    const idx = list.indexOf(document.activeElement);
    const move = (i) => { e.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
    switch (e.key) {
      case 'ArrowDown': move(idx + 1); break;
      case 'ArrowUp': move(idx - 1); break;
      case 'Home': move(0); break;
      case 'End': move(list.length - 1); break;
      case 'Escape': e.preventDefault(); close(true); break;
      case 'Tab': close(false); break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const ch = e.key.toLowerCase();
          const start = idx + 1;
          for (let k = 0; k < list.length; k++) {
            const item = list[(start + k) % list.length];
            if (item.textContent.trim().toLowerCase().startsWith(ch)) { item.focus(); break; }
          }
        }
    }
  }

  const onClick = () => (menuEl ? close(false) : open());
  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open(e.key === 'ArrowUp');
    }
  };
  button.addEventListener('click', onClick);
  button.addEventListener('keydown', onKey);

  const api = {
    open,
    close,
    destroy() {
      close(false);
      button.removeEventListener('click', onClick);
      button.removeEventListener('keydown', onKey);
    },
  };
  return api;
}
