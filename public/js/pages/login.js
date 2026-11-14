/**
 * Log in page (SPEC §12.2). Honours ?next= after a successful login.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { authLayout, orDivider } from '../ui/auth-layout.js';
import { field, passwordField, formAlert, setLoading, validators, applyFieldErrors } from '../ui/form.js';
import { safeNext } from '../router.js';

export default {
  title: 'Log in',
  layout: 'public',
  auth: false,
  publicOnly: true,
  render(root, ctx) {
    const next = safeNext(ctx.query.next);
    const email = field({ label: 'Email', name: 'email', type: 'email', autocomplete: 'email', icon: 'mail', required: true, placeholder: 'you@example.com' });
    const password = passwordField({ label: 'Password', name: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
    const remember = h('input', { type: 'checkbox', name: 'remember', checked: true });
    const alert = formAlert();
    const submit = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Log in', icon('arrow-right', { size: 18 }));
    const guestBtn = h('button', { class: 'btn btn-secondary btn-lg btn-block', type: 'button' }, icon('user', { size: 18 }), 'Continue as guest');

    const form = h('form', { class: 'auth-form', noValidate: true },
      alert.el,
      email.el,
      password.el,
      h('div', { class: 'auth-row' },
        h('label', { class: 'checkbox' }, remember, 'Keep me logged in for 30 days')),
      submit);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alert.clear();
      const errs = { email: validators.email(email.input.value), password: password.input.value ? '' : 'Enter your password.' };
      email.setError(errs.email);
      password.setError(errs.password);
      if (errs.email || errs.password) {
        (errs.email ? email : password).input.focus();
        return;
      }
      setLoading(submit, true);
      try {
        const { user } = await ctx.api.auth.login({
          email: email.input.value.trim().toLowerCase(),
          password: password.input.value,
          remember: remember.checked,
        });
        ctx.store.setUser(user);
        ctx.navigate(next, { replace: true });
        toast(`Welcome back, ${user.displayName}!`, { type: 'success' });
      } catch (err) {
        setLoading(submit, false);
        if (!applyFieldErrors({ email, password }, err.fields)) {
          alert.show(err.message);
          password.input.select();
          password.input.focus();
        }
      }
    });

    guestBtn.addEventListener('click', async () => {
      setLoading(guestBtn, true);
      try {
        const { user } = await ctx.api.auth.guest();
        ctx.store.setUser(user, { keepAppearance: true });
        ctx.navigate(next, { replace: true });
        toast('You are practising as a guest. Save your progress any time from Settings.', { type: 'info', timeout: 5000 });
      } catch (err) {
        setLoading(guestBtn, false);
        alert.show(err.message);
      }
    });

    const isGuest = Boolean(ctx.user?.isGuest);
    root.appendChild(authLayout({
      eyebrow: 'Welcome back',
      title: 'Log in to HiraKata',
      subtitle: isGuest
        ? 'Logging in switches from your guest session to your account.'
        : 'Pick up right where you left off.',
      body: [form, isGuest ? null : orDivider(), isGuest ? null : guestBtn],
      footer: [
        'New to HiraKata? ',
        h('a', { href: next !== '/dashboard' ? `#/register?next=${encodeURIComponent(next)}` : '#/register' }, 'Create a free account'),
      ],
    }));
    email.input.focus();
  },
};
