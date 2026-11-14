/**
 * Animated modal dialogs on top of native <dialog> (focus trap, Esc, backdrop click).
 * @module ui/modal
 */
import { h, uid } from './dom.js';
import { icon } from './icons.js';

/** Close functions of the modals currently open (see closeAllModals). */
const openModals = new Set();

/**
 * @typedef {object} ModalAction
 * @property {string} label
 * @property {'primary'|'secondary'|'ghost'|'danger'|'success'} [variant] default 'secondary'
 * @property {(m: {close: Function, el: HTMLDialogElement, button: HTMLButtonElement}) => any} [onClick]
 *   Return `false` (or a Promise resolving to false) to keep the modal open. While a returned
 *   Promise is pending the button shows a spinner; if it rejects the modal stays open.
 * @property {boolean} [autofocus]
 */

/**
 * Open a modal dialog.
 * @param {{title: string, description?: string, body?: Node|string|Array<Node|string>,
 *   actions?: ModalAction[], size?: 'sm'|'md'|'lg', dismissible?: boolean,
 *   onClose?: (reason: string) => void, className?: string}} opts
 *   dismissible (default true): Esc, backdrop click and the × button close the modal.
 *   onClose receives 'action' | 'dismiss' | 'close'.
 * @returns {{el: HTMLDialogElement, close: (reason?: string) => void}}
 */
export function openModal({
  title, description, body, actions = [], size = 'md', dismissible = true, onClose, className,
}) {
  const host = document.getElementById('modal-root') || document.body;
  const returnFocus = document.activeElement;
  const titleId = uid('modal-title');
  const descId = description ? uid('modal-desc') : undefined;
  let closed = false;

  const footer = actions.length ? h('div', { class: 'modal-footer' }) : null;
  const dialog = h('dialog', {
    class: ['modal', `modal-${size}`, className],
    'aria-labelledby': titleId,
    'aria-describedby': descId,
  },
  h('div', { class: 'modal-panel' },
    h('div', { class: 'modal-header' },
      h('div', { class: 'modal-heading' },
        h('h2', { class: 'modal-title', id: titleId }, title),
        description ? h('p', { class: 'modal-description', id: descId }, description) : null),
      dismissible ? h('button', {
        class: 'btn btn-ghost btn-icon btn-sm modal-close',
        type: 'button',
        'aria-label': 'Close dialog',
        on: { click: () => close('dismiss') },
      }, icon('x', { size: 18 })) : null),
    body != null ? h('div', { class: 'modal-body' }, body) : null,
    footer));

  const close = (reason = 'close', { restoreFocus = true } = {}) => {
    if (closed) return;
    closed = true;
    openModals.delete(close);
    dialog.classList.add('is-closing');
    const finish = () => {
      if (!dialog.isConnected) return;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (restoreFocus && returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
        returnFocus.focus({ preventScroll: true });
      }
      onClose?.(reason);
    };
    dialog.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 320);
  };

  for (const action of actions) {
    const btn = h('button', {
      class: `btn btn-${action.variant || 'secondary'}`,
      type: 'button',
    }, action.label);
    if (action.autofocus) btn.autofocus = true;
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-loading')) return;
      let result;
      try {
        result = action.onClick?.({ close, el: dialog, button: btn });
        if (result && typeof result.then === 'function') {
          btn.classList.add('is-loading');
          btn.disabled = true;
          result = await result;
        }
      } catch (err) {
        console.error('[modal] action failed', err);
        result = false;
      } finally {
        btn.classList.remove('is-loading');
        btn.disabled = false;
      }
      if (result !== false) close('action');
    });
    footer.appendChild(btn);
  }

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (dismissible) close('dismiss');
  });
  // A click whose target is the <dialog> itself landed on the backdrop area.
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if (dismissible && downOnBackdrop && e.target === dialog) close('dismiss');
    downOnBackdrop = false;
  });

  host.appendChild(dialog);
  dialog.showModal();
  openModals.add(close);
  const auto = dialog.querySelector('[autofocus]')
    || dialog.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
  (auto || footer?.lastElementChild || dialog).focus?.();
  return { el: dialog, close };
}

/**
 * Dismiss every open modal without restoring focus (called on route changes, so a dialog opened
 * on one page can never act on the next). Pending confirm/prompt dialogs resolve as cancelled.
 */
export function closeAllModals() {
  for (const close of [...openModals]) close('dismiss', { restoreFocus: false });
}

/**
 * Ask the user to confirm an action.
 * @param {{title: string, message?: string|Node, confirmLabel?: string, cancelLabel?: string,
 *   danger?: boolean}} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openModal({
      title,
      size: 'sm',
      className: danger ? 'modal-danger' : undefined,
      body: message ? h('div', { class: 'modal-message' },
        danger ? h('span', { class: 'modal-message-icon' }, icon('alert-triangle', { size: 20 })) : null,
        h('div', null, message)) : null,
      actions: [
        { label: cancelLabel, variant: 'secondary', autofocus: danger },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', autofocus: !danger, onClick: () => { answer = true; } },
      ],
      onClose: () => resolve(answer),
    });
  });
}

/**
 * Ask the user for a single value.
 * @param {{title: string, message?: string, label?: string, type?: string, placeholder?: string,
 *   confirmLabel?: string, cancelLabel?: string, value?: string, danger?: boolean,
 *   required?: boolean, autocomplete?: string,
 *   validate?: (value: string) => (string|null|Promise<string|null>)}} opts
 *   validate (extension): return an error message to keep the dialog open, or null to accept.
 *   It may be async (e.g. verify a password against the API); the button shows a spinner meanwhile.
 * @returns {Promise<string|null>} the value, or null when cancelled
 */
export function promptDialog({
  title, message, label = 'Value', type = 'text', placeholder = '', confirmLabel = 'OK',
  cancelLabel = 'Cancel', value = '', danger = false, required = true, autocomplete, validate,
}) {
  return new Promise((resolve) => {
    const inputId = uid('prompt');
    const errorId = uid('prompt-err');
    const input = h('input', {
      class: 'input', id: inputId, type, placeholder, value,
      autocomplete: autocomplete || (type === 'password' ? 'current-password' : 'off'),
      'aria-describedby': errorId,
    });
    const errorEl = h('p', { class: 'error-text', id: errorId, role: 'alert' });
    const field = h('div', { class: 'field' },
      h('label', { class: 'label', for: inputId }, label), input, errorEl);
    let answer = null;
    const setError = (msg) => {
      errorEl.textContent = msg || '';
      field.classList.toggle('has-error', Boolean(msg));
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };
    const submit = async () => {
      const v = input.value;
      if (required && !v.trim()) { setError(`${label} is required.`); input.focus(); return false; }
      const err = validate ? await validate(v) : null;
      if (err) { setError(err); input.select(); input.focus(); return false; }
      answer = v;
      return true;
    };
    const modal = openModal({
      title,
      size: 'sm',
      className: danger ? 'modal-danger' : undefined,
      body: [message ? h('p', { class: 'modal-message-text' }, message) : null, field],
      actions: [
        { label: cancelLabel, variant: 'secondary' },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: submit },
      ],
      onClose: () => resolve(answer),
    });
    input.addEventListener('input', () => setError(''));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        modal.el.querySelector('.modal-footer .btn:last-child')?.click();
      }
    });
    input.focus();
  });
}
