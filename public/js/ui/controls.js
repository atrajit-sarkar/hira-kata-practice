/**
 * Accessible interactive controls built on the .segmented, .tabs and .switch classes.
 * @module ui/controls
 */
import { h, uid } from './dom.js';
import { icon } from './icons.js';

function rovingKeys(e, items, current, select) {
  const enabled = items.filter((b) => !b.disabled);
  const i = enabled.indexOf(current);
  let next = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(i + 1) % enabled.length];
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = enabled[(i - 1 + enabled.length) % enabled.length];
  else if (e.key === 'Home') next = enabled[0];
  else if (e.key === 'End') next = enabled[enabled.length - 1];
  if (!next) return;
  e.preventDefault();
  next.focus();
  select(next.dataset.value);
}

/**
 * Segmented control (radio group semantics, arrow-key navigation).
 * @param {{options: Array<{value: string|number, label: string|Node, icon?: string, disabled?: boolean,
 *   ariaLabel?: string}>, value: string|number, onChange?: (value: string) => void, label: string,
 *   size?: 'sm'|'md', block?: boolean, className?: string}} opts
 *   Values are compared as strings; onChange receives the string value.
 * @returns {{el: HTMLDivElement, setValue: (v: string|number) => void, readonly value: string}}
 */
export function segmented({ options, value, onChange, label, size = 'md', block = false, className }) {
  let current = String(value);
  const el = h('div', {
    class: ['segmented', size === 'sm' && 'segmented-sm', block && 'segmented-block', className],
    role: 'radiogroup',
    'aria-label': label,
  });
  const buttons = options.map((o) => h('button', {
    class: 'segmented-item',
    type: 'button',
    role: 'radio',
    disabled: Boolean(o.disabled),
    dataset: { value: String(o.value) },
    'aria-label': o.ariaLabel,
  }, o.icon ? icon(o.icon, { size: 16 }) : null, o.label));

  const sync = () => {
    for (const b of buttons) {
      const on = b.dataset.value === current;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (!buttons.some((b) => b.dataset.value === current) && buttons[0]) buttons[0].tabIndex = 0;
  };
  const select = (v) => {
    if (v === current) return;
    current = v;
    sync();
    onChange?.(v);
  };
  for (const b of buttons) {
    b.addEventListener('click', () => select(b.dataset.value));
    b.addEventListener('keydown', (e) => rovingKeys(e, buttons, b, select));
    el.appendChild(b);
  }
  sync();
  return {
    el,
    setValue(v) { current = String(v); sync(); },
    get value() { return current; },
  };
}

/**
 * Tab list (role=tablist). Panels are the caller's responsibility; use `panelId(value)` for
 * aria-controls wiring if needed.
 * @param {{items: Array<{value: string, label: string, count?: number, icon?: string}>,
 *   value: string, onChange?: (value: string) => void, label: string, className?: string}} opts
 * @returns {{el: HTMLDivElement, setValue: (v: string) => void, setCount: (v: string, n: number|null) => void,
 *   tabId: (v: string) => string, readonly value: string}}
 */
export function tabs({ items, value, onChange, label, className }) {
  const base = uid('tabs');
  let current = String(value);
  const el = h('div', { class: ['tabs', className], role: 'tablist', 'aria-label': label });
  const counts = new Map();
  const buttons = items.map((it) => {
    const count = h('span', { class: 'tab-count', hidden: it.count == null }, it.count == null ? '' : String(it.count));
    counts.set(String(it.value), count);
    return h('button', {
      class: 'tab',
      type: 'button',
      role: 'tab',
      id: `${base}-${it.value}`,
      dataset: { value: String(it.value) },
    }, it.icon ? icon(it.icon, { size: 16 }) : null, it.label, count);
  });
  const sync = () => {
    for (const b of buttons) {
      const on = b.dataset.value === current;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const select = (v) => {
    if (v === current) return;
    current = v;
    sync();
    onChange?.(v);
  };
  for (const b of buttons) {
    b.addEventListener('click', () => select(b.dataset.value));
    b.addEventListener('keydown', (e) => rovingKeys(e, buttons, b, select));
    el.appendChild(b);
  }
  sync();
  return {
    el,
    setValue(v) { current = String(v); sync(); },
    setCount(v, n) {
      const c = counts.get(String(v));
      if (!c) return;
      c.hidden = n == null;
      c.textContent = n == null ? '' : String(n);
    },
    tabId: (v) => `${base}-${v}`,
    get value() { return current; },
  };
}

/**
 * A settings-style row: title + description on the left, a switch on the right.
 * @param {{label: string, description?: string, checked: boolean, onChange?: (checked: boolean) => void,
 *   icon?: string, disabled?: boolean}} opts
 * @returns {{el: HTMLLabelElement, input: HTMLInputElement}}
 */
export function toggleRow({ label, description, checked, onChange, icon: iconName, disabled = false }) {
  const descId = description ? uid('toggle-desc') : undefined;
  const input = h('input', {
    class: 'switch', type: 'checkbox', role: 'switch', checked: Boolean(checked), disabled,
    'aria-describedby': descId,
  });
  input.addEventListener('change', () => onChange?.(input.checked));
  const el = h('label', { class: ['toggle-row', disabled && 'is-disabled'] },
    iconName ? h('span', { class: 'toggle-row-icon' }, icon(iconName, { size: 18 })) : null,
    h('span', { class: 'toggle-row-text' },
      h('span', { class: 'toggle-row-label' }, label),
      description ? h('span', { class: 'toggle-row-desc', id: descId }, description) : null),
    input);
  return { el, input };
}
