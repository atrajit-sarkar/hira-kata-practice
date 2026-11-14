/**
 * Display name + email + password form with a strength meter, shared by registration, the guest
 * upgrade on /register and the upgrade card in Settings.
 * @module ui/account-form
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { field, passwordField, formAlert, setLoading, validators, applyFieldErrors, passwordStrength } from './form.js';

/**
 * Account form shared by registration and guest upgrade.
 * @param {{submitLabel: string, onSubmit: (body: object) => Promise<void>}} opts
 * @returns {{form: HTMLFormElement, focus: () => void, alert: ReturnType<typeof formAlert>}}
 */
export function accountForm({ submitLabel, onSubmit }) {
  const name = field({ label: 'Display name', name: 'displayName', autocomplete: 'nickname', icon: 'user', maxLength: 40, required: true, placeholder: 'What should we call you?' });
  const email = field({ label: 'Email', name: 'email', type: 'email', autocomplete: 'email', icon: 'mail', required: true, placeholder: 'you@example.com' });
  const password = passwordField({ label: 'Password', name: 'password', autocomplete: 'new-password', maxLength: 128, required: true, placeholder: 'At least 8 characters' });
  const meterBar = h('span', { class: 'pw-meter-bar' });
  const meterLabel = h('span', { class: 'pw-meter-label' });
  const meter = h('div', { class: 'pw-meter', dataset: { score: 0 }, 'aria-live': 'polite' },
    h('span', { class: 'pw-meter-track', 'aria-hidden': 'true' }, meterBar), meterLabel);
  password.el.insertBefore(meter, password.el.querySelector('.error-text'));
  password.input.addEventListener('input', () => {
    const { score, label } = passwordStrength(password.input.value);
    meter.dataset.score = String(score);
    meterLabel.textContent = label ? `Strength: ${label}` : '';
  });

  const alert = formAlert();
  const submit = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, submitLabel, icon('arrow-right', { size: 18 }));
  const fields = { displayName: name, email, password };
  const form = h('form', { class: 'auth-form', noValidate: true },
    alert.el, name.el, email.el, password.el,
    h('p', { class: 'auth-fineprint' }, 'Your progress is stored securely on this server. You can export it as a PDF or delete your account at any time.'),
    submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.clear();
    const errs = {
      displayName: validators.displayName(name.input.value),
      email: validators.email(email.input.value),
      password: validators.password(password.input.value),
    };
    let first = null;
    for (const [k, msg] of Object.entries(errs)) {
      fields[k].setError(msg);
      if (msg && !first) first = fields[k];
    }
    if (first) { first.input.focus(); return; }
    setLoading(submit, true);
    try {
      await onSubmit({
        displayName: name.input.value.trim(),
        email: email.input.value.trim().toLowerCase(),
        password: password.input.value,
      });
    } catch (err) {
      setLoading(submit, false);
      if (!applyFieldErrors(fields, err.fields)) alert.show(err.message);
    }
  });
  return { form, alert, focus: () => name.input.focus() };
}
