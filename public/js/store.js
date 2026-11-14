/**
 * Global client state: the signed-in user and their settings (SPEC §10.3).
 * @module store
 */
import { api } from './api.js';
import { debounce } from './ui/dom.js';

/** Default user settings (SPEC §7.1, §15.3). */
export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  kanaFont: 'textbook',
  sound: true,
  autoSpeak: false,
  showRomajiOnKeys: false,
  romajiInput: false,
  autoAdvance: false,
  keyboardVisible: true, // superseded by inputMethod (§15.3); still accepted
  inputMethod: 'keys', // 'keys' | 'handwriting' | 'device'
  keyLayout: 'shuffled', // 'shuffled' | 'gojuon'
  handwritingStrict: false,
  ttsRate: 0.9, // 0.5–1.2
  ttsVoice: '', // voice name; '' = automatic
  listenAutoplay: true,
  showKeyHeaders: false, // romaji column labels on the gojuon keyboard (SPEC 15.7)
});

const THEME_KEY = 'hk-theme';
const FONT_KEY = 'hk-kana-font';
const SAVE_DELAY = 400;

function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeLocal(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable: appearance still applies for this session */ }
}

/** Settings for a logged-out visitor: defaults + locally stored appearance. */
function localSettings() {
  const theme = readLocal(THEME_KEY);
  return {
    ...DEFAULT_SETTINGS,
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    kanaFont: readLocal(FONT_KEY) === 'gothic' ? 'gothic' : 'textbook',
  };
}

/**
 * Apply theme + kana font to <html>, mirror them to localStorage (read by theme-init.js) and keep
 * the browser UI colour in sync.
 * @param {{theme: string, kanaFont: string}} settings
 */
function applyAppearance({ theme, kanaFont }) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
    writeLocal(THEME_KEY, theme);
  } else {
    root.removeAttribute('data-theme');
    writeLocal(THEME_KEY, null);
  }
  if (kanaFont === 'gothic') {
    root.setAttribute('data-kana-font', 'gothic');
    writeLocal(FONT_KEY, 'gothic');
  } else {
    root.removeAttribute('data-kana-font');
    writeLocal(FONT_KEY, null);
  }
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = meta.dataset.scheme;
    if (theme === 'system') meta.setAttribute('media', `(prefers-color-scheme: ${scheme})`);
    else if (theme === scheme) meta.removeAttribute('media');
    else meta.setAttribute('media', 'not all');
  }
}

const listeners = new Set();
let pendingPatch = {};
/** Settings sent by the debounced save whose response has not arrived yet. */
let inFlightPatch = {};

function notify() {
  for (const fn of listeners) {
    try { fn(store); } catch (err) { console.error('[store] listener failed', err); }
  }
}

const persist = debounce(async () => {
  const patch = pendingPatch;
  pendingPatch = {};
  if (!store.user || !Object.keys(patch).length) return;
  inFlightPatch = patch;
  try {
    const { user } = await api.auth.updateMe({ settings: patch });
    inFlightPatch = {};
    if (store.user && user && user.id === store.user.id) {
      // Keep any edits made while the request was in flight.
      store.user = { ...user, settings: { ...user.settings, ...pendingPatch } };
      store.settings = { ...DEFAULT_SETTINGS, ...store.user.settings };
    }
  } catch (err) {
    inFlightPatch = {};
    if (err?.status !== 401) {
      window.dispatchEvent(new CustomEvent('hk:settings-error', { detail: { error: err } }));
    }
  }
}, SAVE_DELAY);

export const store = {
  /** @type {object|null} current User (SPEC §7.1) or null when logged out */
  user: null,
  /** @type {typeof DEFAULT_SETTINGS} effective settings (user settings or defaults) */
  settings: localSettings(),

  /** @returns {boolean} true when a guest account is signed in */
  get isGuest() {
    return Boolean(this.user?.isGuest);
  },

  /**
   * Replace the current user (null on logout) and apply their appearance settings.
   * @param {object|null} user
   * @param {{keepAppearance?: boolean}} [opts] keepAppearance: for a brand-new account (register,
   *   guest), keep the theme and kana font chosen on this device instead of the account defaults,
   *   and save them to the account.
   */
  setUser(user, { keepAppearance = false } = {}) {
    let carry = null;
    if (user && keepAppearance) {
      carry = {};
      for (const k of ['theme', 'kanaFont']) {
        if (this.settings[k] !== { ...DEFAULT_SETTINGS, ...user.settings }[k]) carry[k] = this.settings[k];
      }
      if (Object.keys(carry).length) user = { ...user, settings: { ...user.settings, ...carry } };
      else carry = null;
    }
    if (!user) {
      persist.cancel();
      pendingPatch = {};
      inFlightPatch = {};
    } else if (this.user && user.id === this.user.id) {
      // A response from another call (e.g. a display-name change) can predate settings edits that
      // are still debounced or in flight; keep those edits instead of reverting to stale values.
      const unsaved = { ...inFlightPatch, ...pendingPatch };
      if (Object.keys(unsaved).length) user = { ...user, settings: { ...user.settings, ...unsaved } };
    }
    this.user = user || null;
    this.settings = user ? { ...DEFAULT_SETTINGS, ...(user.settings || {}) } : localSettings();
    applyAppearance(this.settings);
    if (carry) {
      pendingPatch = { ...pendingPatch, ...carry };
      persist();
    }
    notify();
  },

  /**
   * Apply settings immediately and persist them (debounced 400 ms) when signed in.
   * Logged-out visitors keep theme/kana font in localStorage only.
   * @param {Partial<typeof DEFAULT_SETTINGS>} patch
   */
  updateSettings(patch) {
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) if (k in DEFAULT_SETTINGS) clean[k] = v;
    if (!Object.keys(clean).length) return;
    this.settings = { ...this.settings, ...clean };
    if (this.user) {
      this.user = { ...this.user, settings: { ...this.user.settings, ...clean } };
      pendingPatch = { ...pendingPatch, ...clean };
      persist();
    }
    if ('theme' in clean || 'kanaFont' in clean) applyAppearance(this.settings);
    notify();
  },

  /** Send any pending settings change right away (e.g. before logging out). */
  flushSettings() {
    persist.flush();
  },

  /**
   * Subscribe to user/settings changes.
   * @param {(s: typeof store) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

applyAppearance(store.settings);
