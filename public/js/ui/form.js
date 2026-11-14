/**
 * Form building blocks: labelled fields with inline errors, password show/hide, form alerts,
 * client-side validators matching the server rules (SPEC §6).
 * @module ui/form
 */
import { h, uid } from './dom.js';
import { icon } from './icons.js';

/**
 * @typedef {object} Field
 * @property {HTMLDivElement} el        the .field wrapper
 * @property {HTMLInputElement} input
 * @property {(msg?: string) => void} setError  empty/undefined clears the error
 */

/**
 * Labelled input with help text and an inline error slot.
 * @param {{label: string, name?: string, type?: string, value?: string, placeholder?: string,
 *   autocomplete?: string, help?: string, required?: boolean, maxLength?: number,
 *   inputmode?: string, labelAction?: Node, icon?: string, readOnly?: boolean}} opts
 *   labelAction: node shown at the right of the label row (e.g. "Forgot password?" link).
 * @returns {Field}
 */
export function field({
  label, name, type = 'text', value = '', placeholder, autocomplete, help, required = false,
  maxLength, inputmode, labelAction, icon: iconName, readOnly = false,
}) {
  const id = uid(`f-${name || 'field'}`);
  const helpId = help ? `${id}-help` : null;
  const errId = `${id}-err`;
  const input = h('input', {
    class: 'input', id, name, type, value, placeholder, autocomplete, required, readOnly,
    'aria-describedby': [helpId, errId].filter(Boolean).join(' '),
  });
  if (maxLength) input.maxLength = maxLength;
  if (inputmode) input.setAttribute('inputmode', inputmode);
  const errorEl = h('p', { class: 'error-text', id: errId, 'aria-live': 'polite' });
  const control = iconName
    ? h('div', { class: 'input-group' }, icon(iconName, { size: 18, className: 'input-icon' }), input)
    : input;
  const el = h('div', { class: 'field' },
    labelAction
      ? h('div', { class: 'label-row' }, h('label', { class: 'label', for: id }, label), labelAction)
      : h('label', { class: 'label', for: id }, label),
    control,
    help ? h('p', { class: 'help', id: helpId }, help) : null,
    errorEl);
  const setError = (msg) => {
    errorEl.textContent = msg || '';
    el.classList.toggle('has-error', Boolean(msg));
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  input.addEventListener('input', () => { if (el.classList.contains('has-error')) setError(''); });
  return { el, input, setError };
}

/**
 * Password field with a show/hide toggle.
 * @param {Parameters<typeof field>[0]} opts type is forced to password
 * @returns {Field}
 */
export function passwordField(opts) {
  const f = field({ icon: 'lock', ...opts, type: 'password' });
  const toggle = h('button', {
    class: 'btn btn-ghost btn-icon btn-sm input-action',
    type: 'button',
    'aria-label': 'Show password',
    'aria-pressed': 'false',
  }, icon('eye', { size: 18 }));
  toggle.addEventListener('click', () => {
    const show = f.input.type === 'password';
    f.input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.setAttribute('aria-pressed', String(show));
    toggle.replaceChildren(icon(show ? 'eye-off' : 'eye', { size: 18 }));
    f.input.focus();
  });
  f.input.closest('.input-group').appendChild(toggle);
  return f;
}

/**
 * Inline alert banner for form-level errors or notices.
 * @param {{type?: 'error'|'info'|'success'}} [opts]
 * @returns {{el: HTMLDivElement, show: (msg: string, type?: string) => void, clear: () => void}}
 */
export function formAlert({ type = 'error' } = {}) {
  const text = h('span');
  const ic = h('span', { class: 'form-alert-icon' });
  const el = h('div', { class: 'form-alert', role: 'alert', hidden: true }, ic, text);
  return {
    el,
    show(msg, t = type) {
      el.className = `form-alert form-alert-${t}`;
      ic.replaceChildren(icon(t === 'error' ? 'alert-triangle' : t === 'success' ? 'check-circle' : 'info', { size: 18 }));
      text.textContent = msg;
      el.hidden = false;
    },
    clear() { el.hidden = true; text.textContent = ''; },
  };
}

/**
 * Put a button into (or out of) the loading state.
 * @param {HTMLButtonElement} btn
 * @param {boolean} loading
 */
export function setLoading(btn, loading) {
  btn.classList.toggle('is-loading', loading);
  btn.disabled = loading;
  btn.setAttribute('aria-busy', String(loading));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Client-side validators mirroring the server; each returns an error message or ''. */
export const validators = {
  email(v) {
    const s = v.trim();
    if (!s) return 'Enter your email address.';
    if (s.length > 254 || !EMAIL_RE.test(s)) return 'Enter a valid email address.';
    return '';
  },
  password(v) {
    if (!v) return 'Enter a password.';
    if (v.length < 8) return 'Use at least 8 characters.';
    if (v.length > 128) return 'Use at most 128 characters.';
    return '';
  },
  displayName(v) {
    const s = v.trim();
    if (!s) return 'Enter a display name.';
    if (s.length > 40) return 'Use at most 40 characters.';
    if (CONTROL_RE.test(s)) return 'Remove unsupported characters.';
    return '';
  },
};

/**
 * Apply ApiError.fields to a map of fields. Focuses the first field with an error.
 * @param {Record<string, Field>} fields keyed by API field name
 * @param {Record<string, string>} [apiFields]
 * @returns {boolean} true when at least one field error was shown
 */
export function applyFieldErrors(fields, apiFields = {}) {
  let first = null;
  for (const [name, msg] of Object.entries(apiFields || {})) {
    const f = fields[name];
    if (!f) continue;
    f.setError(msg);
    first ||= f;
  }
  first?.input.focus();
  return Boolean(first);
}

/**
 * Password strength estimate for the meter on the register page.
 * @param {string} pw
 * @returns {{score: 0|1|2|3|4, label: string}}
 */
export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '' };
  if (pw.length < 8) return { score: 1, label: 'Too short' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return { score, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score] };
}
