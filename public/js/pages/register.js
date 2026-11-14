/**
 * Register page (SPEC §12.2). Guests see the upgrade variant ("Save your progress").
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { authLayout, orDivider } from '../ui/auth-layout.js';
import { setLoading } from '../ui/form.js';
import { accountForm } from '../ui/account-form.js';
import { safeNext } from '../router.js';

export default {
  title: (ctx) => (ctx.user?.isGuest ? 'Save your progress' : 'Create account'),
  layout: 'public',
  auth: false,
  publicOnly: true,
  render(root, ctx) {
    const next = safeNext(ctx.query.next);
    const upgrading = Boolean(ctx.user?.isGuest);

    const { form, focus, alert } = accountForm({
      submitLabel: upgrading ? 'Save my progress' : 'Create free account',
      async onSubmit(body) {
        const { user } = upgrading ? await ctx.api.auth.upgrade(body) : await ctx.api.auth.register(body);
        ctx.store.setUser(user, { keepAppearance: !upgrading });
        ctx.navigate(next, { replace: true });
        toast(upgrading
          ? 'Your progress is saved. Welcome aboard!'
          : `Welcome to HiraKata, ${user.displayName}!`, { type: 'success' });
      },
    });

    let extra = null;
    if (!upgrading) {
      const guestBtn = h('button', { class: 'btn btn-secondary btn-lg btn-block', type: 'button' }, icon('user', { size: 18 }), 'Continue as guest');
      guestBtn.addEventListener('click', async () => {
        setLoading(guestBtn, true);
        try {
          const { user } = await ctx.api.auth.guest();
          ctx.store.setUser(user, { keepAppearance: true });
          ctx.navigate(next, { replace: true });
        } catch (err) {
          setLoading(guestBtn, false);
          alert.show(err.message);
        }
      });
      extra = [orDivider(), guestBtn];
    }

    root.appendChild(authLayout({
      className: upgrading ? 'is-upgrade' : null,
      eyebrow: upgrading ? 'Guest account' : 'Get started — it’s free',
      title: upgrading ? 'Save your progress' : 'Create your account',
      subtitle: upgrading
        ? 'Turn your guest session into a free account. Every test, score and learned word comes with you.'
        : 'Practise writing kana with real vocabulary and keep every result.',
      body: [
        upgrading ? h('div', { class: 'auth-upgrade-note' }, icon('shield', { size: 18 }),
          h('span', null, 'Guest progress is kept on this device’s session only. An account keeps it safe for good.')) : null,
        form,
        extra,
      ],
      footer: upgrading
        ? ['Changed your mind? ', h('a', { href: '#/dashboard' }, 'Back to dashboard')]
        : ['Already have an account? ', h('a', { href: next !== '/dashboard' ? `#/login?next=${encodeURIComponent(next)}` : '#/login' }, 'Log in')],
    }));
    focus();
  },
};
