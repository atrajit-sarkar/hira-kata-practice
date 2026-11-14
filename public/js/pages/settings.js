/**
 * Settings page (SPEC §12.7): profile, guest upgrade, appearance, practice preferences,
 * password and danger zone. Preferences save automatically through the store.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, promptDialog } from '../ui/modal.js';
import { segmented, toggleRow } from '../ui/controls.js';
import { field, passwordField, formAlert, setLoading, validators, applyFieldErrors } from '../ui/form.js';
import { accountForm } from '../ui/account-form.js';
import { play } from '../ui/sound.js';
import { date } from '../ui/format.js';
import { DEFAULT_SETTINGS } from '../store.js';
import { listJapaneseVoices, speak, stop as stopSpeech, canSpeak } from '../ui/tts.js';
import { INPUTS, metaIcon } from '../results/practice-meta.js';

const PRACTICE_TOGGLES = [
  { key: 'sound', icon: 'volume', label: 'Sound effects', description: 'Soft chimes for correct and wrong answers, hints and streaks.' },
  { key: 'autoAdvance', icon: 'skip-forward', label: 'Auto-advance', description: 'Move to the next word 1.5 s after a correct answer.' },
];

const KEY_TOGGLES = [
  { key: 'showRomajiOnKeys', icon: 'type', label: 'Romaji on keys', description: 'Label each kana key with its romaji. Easier, but you learn less.' },
  {
    // §15.7(a): only present once the setting exists in the client defaults.
    key: 'showKeyHeaders', icon: 'grid', label: 'Romaji column labels',
    description: 'Show k, s, t … above the columns of the gojūon layout.',
    disabledHint: 'Turn off Shuffle keys (choose Gojūon order) to use column labels.',
    when: (s) => s.keyLayout === 'gojuon',
  },
];

const RATE_MIN = 0.5;
const RATE_MAX = 1.2;
const RATE_STEP = 0.05;
const VOICE_SAMPLES = ['こんにちは。ひらカタへようこそ。', 'コーヒーをください。', 'ありがとうございます。'];

/**
 * A settings section: heading + description column and a content card.
 * @returns {HTMLElement}
 */
function section({ id, title, description, content, tone }) {
  return h('section', { class: ['settings-section', tone && `is-${tone}`], id, 'aria-labelledby': `${id}-title` },
    h('div', { class: 'settings-section-head' },
      h('h2', { id: `${id}-title`, tabIndex: -1 }, title),
      description ? h('p', null, description) : null),
    h('div', { class: 'card settings-card' }, content));
}

function profileSection(ctx) {
  const user = ctx.user;
  const name = field({ label: 'Display name', name: 'displayName', value: user.displayName, maxLength: 40, autocomplete: 'nickname', icon: 'user' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit', disabled: true }, 'Save');
  name.input.addEventListener('input', () => {
    save.disabled = name.input.value.trim() === ctx.store.user.displayName;
  });
  const form = h('form', { class: 'settings-form', noValidate: true },
    h('div', { class: 'settings-inline' }, name.el, save));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = validators.displayName(name.input.value);
    name.setError(err);
    if (err) { name.input.focus(); return; }
    setLoading(save, true);
    try {
      const { user: updated } = await ctx.api.auth.updateMe({ displayName: name.input.value.trim() });
      ctx.store.setUser(updated);
      toast('Display name updated.', { type: 'success' });
    } catch (ex) {
      if (!applyFieldErrors({ displayName: name }, ex.fields)) toast(ex.message, { type: 'error' });
    } finally {
      setLoading(save, false);
      save.disabled = name.input.value.trim() === ctx.store.user.displayName;
    }
  });

  const facts = h('dl', { class: 'settings-facts' },
    h('div', null, h('dt', null, 'Email'), h('dd', null, user.email || h('span', { class: 'text-muted' }, 'Not set'))),
    h('div', null, h('dt', null, 'Account type'), h('dd', null, user.isGuest
      ? h('span', { class: 'chip chip-warning chip-dot' }, 'Guest')
      : h('span', { class: 'chip chip-success chip-dot' }, 'Full account'))),
    user.createdAt ? h('div', null, h('dt', null, 'Member since'), h('dd', null, date(user.createdAt))) : null);

  return section({
    id: 'profile',
    title: 'Profile',
    description: 'How you appear in HiraKata and on your PDF reports.',
    content: h('div', { class: 'card-body' }, form, facts),
  });
}

function upgradeSection(ctx) {
  const { form } = accountForm({
    submitLabel: 'Create account & keep progress',
    async onSubmit(body) {
      const { user } = await ctx.api.auth.upgrade(body);
      ctx.store.setUser(user);
      toast('Your progress is saved to your new account.', { type: 'success' });
      ctx.navigate('/settings', { replace: true });
    },
  });
  return section({
    id: 'save-progress',
    title: 'Save your progress',
    description: 'You are using a guest account. Create a free account to keep your tests, stats and vocabulary.',
    tone: 'highlight',
    content: h('div', { class: 'card-body settings-upgrade' },
      h('div', { class: 'settings-callout' }, icon('shield', { size: 20 }),
        h('p', null, 'Same data, same streak — nothing is lost when you upgrade.')),
      form),
  });
}

function fontPreview(font, text) {
  return h('span', { class: 'font-option' },
    h('span', { class: `font-option-sample font-${font}`, lang: 'ja', 'aria-hidden': 'true' }, 'あア'),
    text);
}

function appearanceSection(ctx) {
  const theme = segmented({
    label: 'Theme',
    value: ctx.store.settings.theme,
    options: [
      { value: 'system', label: 'System', icon: 'monitor' },
      { value: 'light', label: 'Light', icon: 'sun' },
      { value: 'dark', label: 'Dark', icon: 'moon' },
    ],
    onChange: (v) => ctx.store.updateSettings({ theme: v }),
  });
  const font = segmented({
    label: 'Kana font',
    value: ctx.store.settings.kanaFont,
    className: 'segmented-fonts',
    options: [
      { value: 'textbook', label: fontPreview('textbook', 'Textbook'), ariaLabel: 'Textbook (Klee One)' },
      { value: 'gothic', label: fontPreview('gothic', 'Gothic'), ariaLabel: 'Gothic (Noto Sans JP)' },
    ],
    onChange: (v) => ctx.store.updateSettings({ kanaFont: v }),
  });
  const unsubscribe = ctx.store.subscribe((s) => {
    theme.setValue(s.settings.theme);
    font.setValue(s.settings.kanaFont);
  });
  const el = section({
    id: 'appearance',
    title: 'Appearance',
    description: 'Choose a colour theme and how kana are drawn.',
    content: h('div', { class: 'card-body settings-rows' },
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-text' }, h('h3', null, 'Theme'), h('p', null, 'System follows your device setting.')),
        theme.el),
      h('div', { class: 'settings-row' },
        h('div', { class: 'settings-row-text' },
          h('h3', null, 'Kana font'),
          h('p', null, 'Textbook shows real handwritten stroke shapes — best for learning to write.')),
        font.el),
      h('div', { class: 'settings-font-preview kana', lang: 'ja', 'aria-hidden': 'true' }, 'さくら・コーヒー・きって・ジュース')),
  });
  return { el, cleanup: unsubscribe };
}

/** A settings row: title + description on the left, a control on the right. */
function controlRow(title, text, control, { className } = {}) {
  return h('div', { class: ['settings-row', className] },
    h('div', { class: 'settings-row-text' }, h('h3', null, title), text ? h('p', null, text) : null),
    control);
}

/** Toggle rows bound to boolean settings; `when(settings)` false disables a row with its hint. */
function boundToggles(ctx, defs) {
  return defs.filter((t) => t.key in DEFAULT_SETTINGS).map((t) => {
    const row = toggleRow({
      label: t.label,
      description: t.description,
      icon: t.icon,
      checked: ctx.store.settings[t.key],
      onChange: (checked) => {
        ctx.store.updateSettings({ [t.key]: checked });
        if (t.key === 'sound' && checked) play('correct');
      },
    });
    const desc = row.el.querySelector('.toggle-row-desc');
    const sync = (s) => {
      row.input.checked = Boolean(s[t.key]);
      if (!t.when) return;
      const on = t.when(s);
      row.input.disabled = !on;
      row.el.classList.toggle('is-disabled', !on);
      if (desc) desc.textContent = on ? t.description : t.disabledHint;
    };
    sync(ctx.store.settings);
    return { el: row.el, sync };
  });
}

const INPUT_HELP = {
  keys: 'Tap kana on the on-screen keyboard. Your device keyboard stays closed.',
  handwriting: 'Write each kana by hand on the practice pad. Your device keyboard stays closed.',
  device: 'Type with your own keyboard or Japanese IME. On phones and tablets, this is the only method that opens the device keyboard.',
};

function practiceSection(ctx) {
  const s0 = ctx.store.settings;
  const inputHelp = h('p', null, INPUT_HELP[s0.inputMethod] || INPUT_HELP.keys);
  const method = segmented({
    label: 'Default input method',
    value: s0.inputMethod,
    className: 'settings-methods',
    options: Object.values(INPUTS).map((m) => ({
      value: m.key, ariaLabel: m.label,
      label: h('span', { class: 'settings-seg-label' }, metaIcon(m.icon, { size: 16 }), m.label),
    })),
    onChange: (v) => ctx.store.updateSettings({ inputMethod: v }),
  });
  const layout = segmented({
    label: 'Kana keyboard layout',
    value: s0.keyLayout,
    options: [
      { value: 'shuffled', label: 'Shuffled', icon: 'refresh' },
      { value: 'gojuon', label: 'Gojūon order', icon: 'grid' },
    ],
    onChange: (v) => ctx.store.updateSettings({ keyLayout: v }),
  });
  const keyToggles = boundToggles(ctx, KEY_TOGGLES);
  const handToggles = boundToggles(ctx, [{
    key: 'handwritingStrict', icon: 'target', label: 'Strict handwriting',
    description: 'Commit only the character the pad recognises, with no suggestions to pick from. Closer to a real test.',
  }]);
  const typingToggles = boundToggles(ctx, [{
    key: 'romajiInput', icon: 'wand', label: 'Romaji typing',
    description: 'With the device keyboard, type romaji and have it converted to kana as you go (e.g. “neko” → ねこ). Type “nn” for ん.',
  }]);
  const general = boundToggles(ctx, PRACTICE_TOGGLES);
  const all = [...keyToggles, ...handToggles, ...typingToggles, ...general];

  const unsubscribe = ctx.store.subscribe((store) => {
    const s = store.settings;
    method.setValue(s.inputMethod);
    layout.setValue(s.keyLayout);
    inputHelp.textContent = INPUT_HELP[s.inputMethod] || INPUT_HELP.keys;
    for (const t of all) t.sync(s);
  });

  const group = (title, nodes) => h('div', { class: 'settings-group' },
    h('h3', { class: 'settings-group-title' }, title),
    h('div', { class: 'settings-toggles' }, nodes));

  const el = section({
    id: 'practice',
    title: 'Practice',
    description: 'How you write answers. You can also switch method on the practice screen. Changes save automatically.',
    content: h('div', { class: 'card-body settings-rows settings-practice' },
      h('div', { class: 'settings-row settings-row-stack' },
        h('div', { class: 'settings-row-text' }, h('h3', null, 'Default input method'), inputHelp),
        method.el),
      controlRow('Kana keyboard layout',
        'Shuffled mixes the keys for every word, so you have to recognise each character. Gojūon keeps the familiar table order.',
        layout.el),
      group('Kana keys', keyToggles.map((t) => t.el)),
      group('Handwriting & typing', [...handToggles, ...typingToggles].map((t) => t.el)),
      group('Feedback', general.map((t) => t.el))),
  });
  return { el, cleanup: unsubscribe };
}

/** "Name (ja-JP)" with the vendor prefix trimmed, e.g. "Microsoft Nanami Online (Natural)". */
function voiceLabel(v) {
  const name = String(v.name || 'Japanese voice').replace(/\s*-\s*Japanese \(Japan\)\s*$/i, '');
  return `${name}${v.localService ? '' : ' · online'}`;
}

function listeningSection(ctx) {
  const s0 = ctx.store.settings;
  const select = h('select', { class: 'input settings-voice', id: 'settings-voice', disabled: true },
    h('option', { value: '' }, 'Looking for Japanese voices…'));
  const voiceNote = h('div', { class: 'settings-voice-note', hidden: true });
  const rateOut = h('output', { class: 'settings-rate-value', for: 'settings-rate' });
  const rate = h('input', {
    class: 'settings-rate', id: 'settings-rate', type: 'range',
    min: RATE_MIN, max: RATE_MAX, step: RATE_STEP, value: String(s0.ttsRate ?? 0.9),
    'aria-describedby': 'settings-rate-help',
  });
  const testBtn = h('button', { class: 'btn btn-secondary', type: 'button' }, icon('play', { size: 16 }), 'Test voice');
  let sample = 0;
  let disposed = false;

  const showRate = (v) => {
    const n = Number(v);
    rateOut.textContent = `${n.toFixed(2)}×`;
    rate.style.setProperty('--fill', `${((n - RATE_MIN) / (RATE_MAX - RATE_MIN)) * 100}%`);
    rate.setAttribute('aria-valuetext', `${n.toFixed(2)} times normal speed`);
  };
  showRate(rate.value);
  rate.addEventListener('input', () => {
    showRate(rate.value);
    ctx.store.updateSettings({ ttsRate: Math.round(Number(rate.value) * 100) / 100 });
  });
  select.addEventListener('change', () => ctx.store.updateSettings({ ttsVoice: select.value }));
  testBtn.addEventListener('click', () => {
    // Spoken synchronously inside the tap so mobile Safari allows the audio.
    const s = ctx.store.settings;
    speak(VOICE_SAMPLES[sample++ % VOICE_SAMPLES.length], { rate: s.ttsRate, voiceName: s.ttsVoice });
  });

  listJapaneseVoices().then((voices) => {
    if (disposed) return;
    const saved = ctx.store.settings.ttsVoice || '';
    const options = [h('option', { value: '' }, voices.length ? `Automatic · ${voiceLabel(voices[0])}` : 'Automatic')];
    for (const v of voices) options.push(h('option', { value: v.name }, voiceLabel(v)));
    if (saved && !voices.some((v) => v.name === saved)) options.push(h('option', { value: saved }, `${saved} (not on this device)`));
    select.replaceChildren(...options);
    select.value = saved;
    select.disabled = !voices.length && !saved;
    if (!voices.length) {
      voiceNote.hidden = false;
      voiceNote.replaceChildren(icon('info', { size: 18 }),
        h('div', null,
          h('strong', null, canSpeak() ? 'No Japanese voice found on this device' : 'This browser can’t speak'),
          h('p', null, canSpeak()
            ? 'Listen mode needs a Japanese voice. Chrome and Edge include online voices. On Windows, add one in Settings › Time & language › Speech › Add voices (Japanese); on macOS in System Settings › Accessibility › Spoken Content; on Android, install Japanese for Speech Services by Google.'
            : 'Listen mode needs speech synthesis. Try a current version of Chrome, Edge or Safari.')));
      testBtn.disabled = !canSpeak();
    }
  });

  const toggles = boundToggles(ctx, [
    { key: 'listenAutoplay', icon: 'volume', label: 'Play words automatically', description: 'In listen mode, speak each new word as soon as it appears. Replay it any time.' },
    { key: 'autoSpeak', icon: 'play', label: 'Read words aloud after checking', description: 'In romaji mode, speak each word in Japanese once it is checked.' },
  ]);
  const unsubscribe = ctx.store.subscribe((store) => {
    const s = store.settings;
    if (document.activeElement !== rate) { rate.value = String(s.ttsRate); showRate(rate.value); }
    if (!select.disabled && select.value !== (s.ttsVoice || '')) select.value = s.ttsVoice || '';
    for (const t of toggles) t.sync(s);
  });

  const el = section({
    id: 'listening',
    title: 'Listening',
    description: 'The Japanese voice used in listen mode and when words are read aloud.',
    content: h('div', { class: 'card-body settings-rows' },
      h('div', { class: 'settings-row settings-row-stack' },
        h('div', { class: 'settings-row-text' },
          h('h3', null, h('label', { for: 'settings-voice' }, 'Japanese voice')),
          h('p', null, 'Natural and online voices sound the most lifelike. Automatic picks the best one available.')),
        h('div', { class: 'settings-voice-row' }, select, testBtn),
        voiceNote),
      h('div', { class: 'settings-row settings-row-stack' },
        h('div', { class: 'settings-row-text' },
          h('h3', null, h('label', { for: 'settings-rate' }, 'Speech rate')),
          h('p', { id: 'settings-rate-help' }, 'Slow it down while your ear gets used to Japanese sounds.')),
        h('div', { class: 'settings-rate-row' },
          h('span', { class: 'settings-rate-end', 'aria-hidden': 'true' }, 'Slower'),
          rate,
          h('span', { class: 'settings-rate-end', 'aria-hidden': 'true' }, 'Faster'),
          rateOut)),
      h('div', { class: 'settings-toggles' }, toggles.map((t) => t.el))),
  });
  return { el, cleanup: () => { disposed = true; unsubscribe(); stopSpeech(); } };
}

function passwordSection(ctx) {
  const current = passwordField({ label: 'Current password', name: 'currentPassword', autocomplete: 'current-password' });
  const next = passwordField({ label: 'New password', name: 'newPassword', autocomplete: 'new-password', maxLength: 128, help: '8–128 characters. Other devices will be signed out.' });
  const confirm = passwordField({ label: 'Confirm new password', name: 'confirmPassword', autocomplete: 'new-password', maxLength: 128 });
  const alert = formAlert();
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Update password');
  const form = h('form', { class: 'settings-form settings-password', noValidate: true },
    alert.el, current.el, next.el, confirm.el, h('div', { class: 'settings-actions' }, submit));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.clear();
    const errs = [
      [current, current.input.value ? '' : 'Enter your current password.'],
      [next, validators.password(next.input.value)],
      [confirm, confirm.input.value === next.input.value ? '' : 'Passwords do not match.'],
    ];
    for (const [f, msg] of errs) f.setError(msg);
    const firstBad = errs.find(([, msg]) => msg);
    if (firstBad) { firstBad[0].input.focus(); return; }
    setLoading(submit, true);
    try {
      await ctx.api.auth.changePassword({ currentPassword: current.input.value, newPassword: next.input.value });
      form.reset();
      toast('Password updated. Other sessions were signed out.', { type: 'success' });
    } catch (ex) {
      if (!applyFieldErrors({ currentPassword: current, newPassword: next }, ex.fields)) alert.show(ex.message);
    } finally {
      setLoading(submit, false);
    }
  });
  return section({
    id: 'password',
    title: 'Password',
    description: 'Use a long, unique password you do not use anywhere else.',
    content: h('div', { class: 'card-body' }, form),
  });
}

/**
 * Run a destructive account action: confirm, then (for full accounts) ask for the password and
 * call the API inside the prompt so a wrong password keeps the dialog open.
 * @returns {Promise<boolean>} true when the action completed
 */
async function destructiveFlow(ctx, { confirm, passwordTitle, actionLabel, run }) {
  const ok = await confirmDialog({ ...confirm, danger: true });
  if (!ok) return false;
  if (ctx.store.user?.isGuest) {
    try {
      await run({});
      return true;
    } catch (err) {
      toast(err.message, { type: 'error' });
      return false;
    }
  }
  const value = await promptDialog({
    title: passwordTitle,
    message: 'For your security, enter your password to continue.',
    label: 'Password',
    type: 'password',
    confirmLabel: actionLabel,
    danger: true,
    validate: async (password) => {
      try {
        await run({ password });
        return null;
      } catch (err) {
        return err.fields?.password || err.message;
      }
    },
  });
  return value !== null;
}

function dangerSection(ctx) {
  const resetBtn = h('button', { class: 'btn btn-danger-soft', type: 'button' }, icon('refresh', { size: 16 }), 'Reset progress');
  const deleteBtn = h('button', { class: 'btn btn-danger', type: 'button' }, icon('trash', { size: 16 }), 'Delete account');

  resetBtn.addEventListener('click', async () => {
    const done = await destructiveFlow(ctx, {
      confirm: {
        title: 'Reset all progress?',
        message: 'This permanently deletes every test, score, kana statistic and vocabulary record. Your account and settings stay. This cannot be undone.',
        confirmLabel: 'Continue',
      },
      passwordTitle: 'Confirm progress reset',
      actionLabel: 'Reset progress',
      run: (body) => ctx.api.auth.resetProgress(body),
    });
    if (done) toast('Your progress has been reset. Enjoy the fresh start!', { type: 'success' });
  });

  deleteBtn.addEventListener('click', async () => {
    const done = await destructiveFlow(ctx, {
      confirm: {
        title: 'Delete your account?',
        message: 'Your account and all of its data — tests, statistics and vocabulary — will be permanently deleted. This cannot be undone.',
        confirmLabel: 'Continue',
      },
      passwordTitle: 'Confirm account deletion',
      actionLabel: 'Delete account',
      run: (body) => ctx.api.auth.deleteAccount(body),
    });
    if (!done) return;
    ctx.store.setUser(null);
    ctx.navigate('/', { replace: true });
    toast('Your account has been deleted. さようなら — goodbye!', { type: 'info' });
  });

  const item = (title, text, btn) => h('div', { class: 'settings-row danger-row' },
    h('div', { class: 'settings-row-text' }, h('h3', null, title), h('p', null, text)), btn);
  return section({
    id: 'danger',
    title: 'Danger zone',
    description: 'Irreversible actions. Download your PDF reports first if you want a record.',
    tone: 'danger',
    content: h('div', { class: 'card-body settings-rows' },
      item('Reset progress', 'Start fresh: delete all tests and statistics but keep your account.', resetBtn),
      item('Delete account', 'Permanently delete your account and everything in it.', deleteBtn)),
  });
}

const NAV = [
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'save-progress', label: 'Save progress', icon: 'shield', guestOnly: true },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'practice', label: 'Practice', icon: 'keyboard' },
  { id: 'listening', label: 'Listening', icon: 'volume' },
  { id: 'password', label: 'Password', icon: 'lock', fullOnly: true },
  { id: 'danger', label: 'Danger zone', icon: 'alert-triangle' },
];

export default {
  title: 'Settings',
  layout: 'app',
  auth: true,
  render(root, ctx) {
    const guest = Boolean(ctx.user.isGuest);
    const appearance = appearanceSection(ctx);
    const practice = practiceSection(ctx);
    const listening = listeningSection(ctx);
    const sections = [
      profileSection(ctx),
      guest ? upgradeSection(ctx) : null,
      appearance.el,
      practice.el,
      listening.el,
      guest ? null : passwordSection(ctx),
      dangerSection(ctx),
    ];
    const nav = h('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' },
      NAV.filter((n) => (!n.guestOnly || guest) && (!n.fullOnly || !guest)).map((n) => h('button', {
        class: 'settings-nav-item',
        type: 'button',
        on: {
          click: () => {
            const target = root.querySelector(`#${n.id}`);
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            target?.querySelector('h2')?.focus?.();
          },
        },
      }, icon(n.icon, { size: 16 }), n.label)));

    root.appendChild(h('div', { class: 'container page settings' },
      h('header', { class: 'page-header' },
        h('div', null,
          h('h1', null, 'Settings'),
          h('p', null, 'Manage your account, appearance and practice preferences.'))),
      h('div', { class: 'settings-layout' },
        nav,
        h('div', { class: 'settings-sections' }, sections))));
    return () => { appearance.cleanup(); practice.cleanup(); listening.cleanup(); };
  },
};
