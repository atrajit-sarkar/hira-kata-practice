/**
 * App entry: restores the session, mounts the shell and starts the router (SPEC §10).
 * @module main
 */
import { api } from './api.js';
import { store } from './store.js';
import { startRouter, navigate, currentRoute, parseHash } from './router.js';
import { mountShell, setLayout } from './ui/shell.js';
import { toast, clearToasts } from './ui/toast.js';
import { stopConfetti } from './ui/confetti.js';
import { closeAllModals } from './ui/modal.js';

async function restoreSession() {
  try {
    const { user } = await api.auth.me();
    store.setUser(user);
  } catch (err) {
    store.setUser(null);
    if (err?.status !== 401) {
      console.warn('[main] session check failed', err);
      if (err?.code === 'NETWORK_ERROR') toast(err.message, { type: 'error' });
    }
  }
}

function handleUnauthorized() {
  const wasSignedIn = Boolean(store.user);
  store.setUser(null);
  const { page } = currentRoute();
  if (page?.auth) {
    const { full } = parseHash();
    navigate(`/login?next=${encodeURIComponent(full)}`, { replace: true });
    if (wasSignedIn) toast('Your session has expired. Please log in again.', { type: 'info' });
  }
}

async function boot() {
  const view = document.getElementById('view');
  mountShell({
    topbar: document.getElementById('topbar'),
    footer: document.getElementById('footer'),
  });
  // The skip link must not change the hash (that would be read as a route).
  document.querySelector('.skip-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    view.focus();
  });
  window.addEventListener('hk:unauthorized', handleUnauthorized);
  window.addEventListener('hk:settings-error', () => {
    toast('Your settings could not be saved. They will apply on this device until you retry.', { type: 'error' });
  });
  await restoreSession();
  // Toasts belong to the account that triggered them: clear them when the signed-in user changes
  // (login, logout, expiry, guest upgrade), before the new page shows its own welcome message.
  const identity = (u) => (u ? `${u.id}:${u.isGuest ? 'guest' : 'full'}` : '');
  let current = identity(store.user);
  store.subscribe((s) => {
    const next = identity(s.user);
    if (next !== current) clearToasts();
    current = next;
  });
  document.documentElement.classList.add('app-ready');
  await startRouter({
    view,
    getUser: () => store.user,
    onLayout: (layout, name) => {
      // Effects and dialogs opened on the previous page must not outlive it.
      stopConfetti();
      closeAllModals();
      setLayout(layout, name);
    },
    extras: { store, api },
  });
}

boot();
