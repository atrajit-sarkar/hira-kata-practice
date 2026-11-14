/**
 * The New test dialog (SPEC 12.3, 15.6) in two steps:
 *   1. Basics: practice mode (romaji → write / listen → write), script, word pool (all dictionary
 *      words / common words, with live counts) and test size.
 *   2. Filters: difficulty, word type, JLPT, source and an optional title.
 * Start is available from either step; a live "N words match" line sits in the footer. Listen mode
 * is disabled, with instructions, when the browser has no Japanese voice. Creating a test
 * navigates to practice.
 * @module dashboard/new-test-dialog
 */
import { h, uid, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { number, plural } from '../ui/format.js';
import { openModal } from '../ui/modal.js';
import { formAlert } from '../ui/form.js';
import { tabs } from '../ui/controls.js';
import { hasJapaneseVoice } from '../ui/tts.js';
import { api } from '../api.js';
import { navigate as routerNavigate } from '../router.js';
import { MODES, metaIcon } from '../results/practice-meta.js';

const STORAGE_KEY = 'hk-new-test';
const PRESET_COUNTS = [10, 20, 30, 50];
const MIN_COUNT = 5;
const MAX_COUNT = 100;
const DEFAULTS = Object.freeze({
  mode: 'romaji', script: 'mixed', pool: 'all', level: 'all', count: 20, pos: 'any', jlpt: 'any', source: 'random',
});

const MODE_OPTIONS = Object.values(MODES).map((m) => ({ value: m.key, label: m.label, text: m.text, icon: m.icon }));
const SCRIPTS = [
  { value: 'hiragana', glyph: 'あ', label: 'Hiragana', text: 'Native and Sino-Japanese words' },
  { value: 'katakana', glyph: 'ア', label: 'Katakana', text: 'Loanwords and foreign names' },
  { value: 'mixed', glyph: 'あア', label: 'Mixed', text: 'Half and half, you pick the script' },
];
const POOLS = [
  { value: 'all', label: 'All dictionary words', text: 'Every JMdict word. Everyday ones come up more often.' },
  { value: 'common', label: 'Common words', text: 'Only everyday words marked common.' },
];
const LEVELS = [
  { value: 'all', label: 'All levels', text: 'Every word, any length or difficulty.' },
  { value: '1', label: 'Beginner', text: 'Up to 4 kana, no small kana or long vowels.' },
  { value: '2', label: 'Intermediate', text: 'Longer words with っ, ゃゅょ or ー.' },
  { value: '3', label: 'Advanced', text: 'Long words and extended katakana like ファ or ヴィ.' },
];
const POS = [
  { value: 'any', label: 'Any' }, { value: 'noun', label: 'Nouns' }, { value: 'verb', label: 'Verbs' },
  { value: 'adjective', label: 'Adjectives' }, { value: 'adverb', label: 'Adverbs' }, { value: 'expression', label: 'Expressions' },
];
const JLPT = [{ value: 'any', label: 'Any' }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `N${n}` }))];

let metaPromise = null;

/** Word-bank metadata, fetched once per page load (a failed fetch is retried next time). */
function loadMeta() {
  metaPromise ||= api.words.meta().catch((err) => { metaPromise = null; throw err; });
  return metaPromise;
}

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function save(config) {
  try {
    const { mode, script, pool, level, count, pos, jlpt } = config;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, script, pool, level, count, pos, jlpt }));
  } catch { /* storage unavailable: remembering the last choice is only a convenience */ }
}

/** Keep only values the dialog offers, falling back to the defaults. */
function sanitize(cfg) {
  const pick = (list, v, d) => (list.some((o) => o.value === String(v)) ? String(v) : d);
  const count = Number(cfg.count);
  return {
    mode: pick(MODE_OPTIONS, cfg.mode, DEFAULTS.mode),
    script: pick(SCRIPTS, cfg.script, DEFAULTS.script),
    pool: pick(POOLS, cfg.pool, DEFAULTS.pool),
    level: pick(LEVELS, cfg.level, DEFAULTS.level),
    pos: pick(POS, cfg.pos, DEFAULTS.pos),
    jlpt: pick(JLPT, cfg.jlpt, DEFAULTS.jlpt),
    count: Number.isInteger(count) && count >= MIN_COUNT && count <= MAX_COUNT ? count : DEFAULTS.count,
    source: cfg.source === 'review' ? 'review' : 'random',
  };
}

/**
 * A fieldset of native radio inputs (arrow keys move the selection, as in any radio group).
 * @param {{name: string, legend: string, hint?: string, options: Array<{value: string, label: string,
 *   text?: string, glyph?: string, icon?: string, disabled?: boolean}>, value: string,
 *   variant: 'card'|'row'|'pill'|'mode', onChange: (value: string) => void}} opts
 * @returns {{el: HTMLFieldSetElement, set: (v: string) => void, setDisabled: (on: boolean) => void,
 *   option: (v: string) => {label: HTMLLabelElement, input: HTMLInputElement, desc: HTMLElement|null,
 *   aside: HTMLElement}}}
 */
function radioGroup({ name, legend, hint, options, value, variant, onChange }) {
  const parts = new Map();
  const group = h('fieldset', { class: ['dash-nt-group', `is-${variant}`] },
    h('legend', { class: 'dash-nt-legend' }, legend, hint ? h('span', { class: 'dash-nt-hint' }, hint) : null),
    h('div', { class: 'dash-nt-options' }, options.map((o) => {
      const input = h('input', {
        class: 'dash-nt-input', type: 'radio', name, value: o.value,
        checked: o.value === value, disabled: Boolean(o.disabled),
        on: { change: () => onChange(o.value) },
      });
      const desc = o.text ? h('span', { class: 'dash-nt-option-desc' }, o.text) : null;
      const aside = h('span', { class: 'dash-nt-aside', hidden: true });
      const label = h('label', { class: ['dash-nt-option', o.disabled && 'is-disabled'], dataset: { value: o.value } },
        input,
        o.glyph ? h('span', { class: 'dash-nt-glyph kana', lang: 'ja', 'aria-hidden': 'true' }, o.glyph) : null,
        o.icon ? h('span', { class: 'dash-nt-icon', 'aria-hidden': 'true' }, metaIcon(o.icon, { size: 22 })) : null,
        h('span', { class: 'dash-nt-option-text' },
          h('span', { class: 'dash-nt-option-label' }, o.label),
          desc),
        aside,
        variant === 'pill' ? null : h('span', { class: 'dash-nt-check', 'aria-hidden': 'true' }, icon('check', { size: 14, stroke: 3 })));
      parts.set(o.value, { label, input, desc, aside });
      return label;
    })));
  return {
    el: group,
    set(v) { for (const p of parts.values()) p.input.checked = p.input.value === v; },
    setDisabled(on) { group.disabled = on; },
    option: (v) => parts.get(v),
  };
}

/** The POST /api/tests body for a dialog config. */
function requestBody(config, title) {
  const body = config.source === 'review'
    ? { script: config.script, count: config.count, source: 'review', mode: config.mode }
    : {
      script: config.script,
      level: config.level === 'all' ? 'all' : Number(config.level),
      pos: config.pos,
      jlpt: config.jlpt === 'any' ? 'any' : Number(config.jlpt),
      count: config.count,
      source: 'random',
      mode: config.mode,
      pool: config.pool,
    };
  if (title) body.title = title;
  return body;
}

/** How many step-2 filters differ from their defaults (shown on the Filters tab). */
function activeFilters(config, title) {
  if (config.source === 'review') return 1 + (title ? 1 : 0);
  return [config.level !== 'all', config.pos !== 'any', config.jlpt !== 'any', Boolean(title)].filter(Boolean).length;
}

/** The "how to get a Japanese voice" note shown when listen mode is unavailable. */
function voiceNote() {
  return h('div', { class: 'dash-nt-note', role: 'note' },
    icon('info', { size: 18 }),
    h('div', null,
      h('strong', null, 'Listen mode needs a Japanese voice'),
      h('p', null, 'This browser has no Japanese text-to-speech voice. Chrome and Edge include online voices. '
        + 'On Windows, add one in Settings › Time & language › Speech › Add voices (Japanese); on macOS in '
        + 'System Settings › Accessibility › Spoken Content; on Android, install Japanese for Speech Services by Google. '
        + 'Then reload this page.')));
}

/**
 * Open the New test dialog.
 * @param {{reviewCount?: number, initial?: object, onCreated?: (res: {test: object, current: object}) => void,
 *   signal?: AbortSignal}} [opts]
 *   reviewCount: words the learner can review (stats totals.wordsToReview); fetched when omitted.
 *   initial: TestConfig fields to preselect (otherwise the last used config, then defaults).
 *   onCreated: called after creation; by default the app navigates to /practice/:id.
 *   signal: aborting it dismisses the dialog (e.g. when the opening page unmounts).
 * @returns {Promise<{test: object, current: object}|null>} the created test, or null when cancelled
 */
export async function openNewTestDialog({ reviewCount, initial = {}, onCreated, signal } = {}) {
  const [meta, review] = await Promise.all([
    loadMeta().catch(() => null),
    reviewCount ?? api.stats.overview().then((s) => s.totals.wordsToReview).catch(() => 0),
  ]);
  const config = sanitize({ ...DEFAULTS, ...readSaved(), ...initial });
  if (config.source === 'review' && !review) config.source = 'random';
  if (!meta?.jlptAvailable) config.jlpt = 'any';
  if (signal?.aborted) return null;

  let modal = null;
  let created = null;
  /** Words matching the random filters per pool: null while counting, undefined when it failed. */
  let matches = { all: null, common: null };
  let countSeq = 0;
  let countError = '';
  let step = 'basics';

  const summary = h('p', { class: 'dash-nt-summary', 'aria-live': 'polite' });
  const alert = formAlert();
  const titleId = uid('nt-title');
  const titleInput = h('input', {
    class: 'input', id: titleId, type: 'text', maxLength: 80, autocomplete: 'off',
    placeholder: 'Leave blank to name it automatically',
    on: { input: () => syncSteps() },
  });

  const modeGroup = radioGroup({
    name: uid('nt-mode'), legend: 'Mode', options: MODE_OPTIONS, value: config.mode, variant: 'mode',
    onChange: (v) => { config.mode = v; alert.clear(); },
  });
  const note = voiceNote();
  note.hidden = true;
  const scriptGroup = radioGroup({
    name: uid('nt-script'), legend: 'Script', options: SCRIPTS, value: config.script, variant: 'card',
    onChange: (v) => { config.script = v; refreshCount(); },
  });
  const poolGroup = radioGroup({
    name: uid('nt-pool'), legend: 'Word pool', options: POOLS, value: config.pool, variant: 'row',
    onChange: (v) => { config.pool = v; alert.clear(); sync(); },
  });
  const customInput = h('input', {
    class: 'input dash-nt-custom', type: 'number', min: MIN_COUNT, max: MAX_COUNT, step: 1, inputMode: 'numeric',
    value: String(config.count), hidden: PRESET_COUNTS.includes(config.count), 'aria-label': `Custom number of words, ${MIN_COUNT} to ${MAX_COUNT}`,
    on: { input: () => readCustom() },
  });
  const countGroup = radioGroup({
    name: uid('nt-count'), legend: 'Words', hint: `${MIN_COUNT}–${MAX_COUNT}`, variant: 'pill',
    options: [...PRESET_COUNTS.map((n) => ({ value: String(n), label: String(n) })), { value: 'custom', label: 'Custom' }],
    value: PRESET_COUNTS.includes(config.count) ? String(config.count) : 'custom',
    onChange: (v) => {
      customInput.hidden = v !== 'custom';
      if (v === 'custom') { customInput.focus(); readCustom(); return; }
      config.count = Number(v);
      countError = '';
      sync();
    },
  });
  countGroup.el.querySelector('.dash-nt-options').appendChild(customInput);
  const levelGroup = radioGroup({
    name: uid('nt-level'), legend: 'Difficulty', options: LEVELS, value: config.level, variant: 'row',
    onChange: (v) => { config.level = v; refreshCount(); },
  });
  const posGroup = radioGroup({
    name: uid('nt-pos'), legend: 'Word type', options: POS, value: config.pos, variant: 'pill',
    onChange: (v) => { config.pos = v; refreshCount(); },
  });
  const jlptGroup = radioGroup({
    name: uid('nt-jlpt'), legend: 'JLPT level', options: JLPT, value: config.jlpt, variant: 'pill',
    onChange: (v) => { config.jlpt = v; refreshCount(); },
  });
  jlptGroup.el.hidden = !meta?.jlptAvailable;
  const sourceGroup = radioGroup({
    name: uid('nt-source'), legend: 'Source', variant: 'row', value: config.source,
    options: [
      { value: 'random', label: 'New words', text: 'Random dictionary words that match your filters.' },
      {
        value: 'review', label: 'Review my mistakes', disabled: !review,
        text: review ? `${plural(review, 'word')} you missed or skipped. Pool and difficulty filters don’t apply.` : 'Words you miss or skip will appear here.',
      },
    ],
    onChange: (v) => { config.source = v; refreshCount(); },
  });

  function readCustom() {
    const n = Number(customInput.value);
    const ok = customInput.value !== '' && Number.isInteger(n) && n >= MIN_COUNT && n <= MAX_COUNT;
    countError = ok ? '' : `Choose between ${MIN_COUNT} and ${MAX_COUNT} words.`;
    if (ok) config.count = n;
    sync();
  }

  // ---- Steps: Basics / Filters (tabs over two stacked panels of equal height) ----
  const stepTabs = tabs({
    label: 'New test steps',
    value: step,
    className: 'dash-nt-steps',
    items: [{ value: 'basics', label: '1 · Basics' }, { value: 'filters', label: '2 · Filters', count: null }],
    onChange: (v) => showStep(v),
  });
  const filtersSummary = h('span', { class: 'dash-nt-more-text' });
  const moreBtn = h('button', {
    class: 'dash-nt-more', type: 'button',
    on: { click: () => { showStep('filters'); stepTabs.el.querySelector('[aria-selected="true"]')?.focus(); } },
  },
  h('span', { class: 'dash-nt-more-icon' }, icon('filter', { size: 18 })),
  h('span', { class: 'dash-nt-more-copy' },
    h('span', { class: 'dash-nt-more-title' }, 'Fine-tune: difficulty, word type, JLPT and source'),
    filtersSummary),
  icon('chevron-right', { size: 18 }));

  const panel = (value, ...children) => h('div', {
    class: 'dash-nt-panel', role: 'tabpanel', id: `${stepTabs.tabId(value)}-panel`,
    'aria-labelledby': stepTabs.tabId(value), dataset: { step: value },
  }, children);
  const basics = panel('basics',
    modeGroup.el, note, scriptGroup.el,
    h('div', { class: 'dash-nt-cols' }, poolGroup.el, countGroup.el),
    moreBtn);
  const filters = panel('filters',
    h('div', { class: 'dash-nt-cols' },
      levelGroup.el,
      h('div', { class: 'dash-nt-stack' }, posGroup.el, jlptGroup.el)),
    sourceGroup.el,
    h('div', { class: 'field dash-nt-title' },
      h('label', { class: 'label', for: titleId }, 'Title ', h('span', { class: 'dash-nt-optional' }, 'optional')),
      titleInput));

  function showStep(v) {
    step = v;
    stepTabs.setValue(v);
    for (const p of [basics, filters]) {
      const on = p.dataset.step === v;
      p.classList.toggle('is-active', on);
      p.inert = !on;
      p.setAttribute('aria-hidden', String(!on));
    }
  }

  /** Filters tab badge and the summary on the Basics "fine-tune" button. */
  function syncSteps() {
    const n = activeFilters(config, titleInput.value.trim());
    stepTabs.setCount('filters', n || null);
    const bits = [];
    if (config.source === 'review') bits.push('Reviewing your mistakes');
    else {
      bits.push(LEVELS.find((l) => l.value === config.level).label);
      if (config.pos !== 'any') bits.push(POS.find((p) => p.value === config.pos).label);
      if (config.jlpt !== 'any') bits.push(`JLPT N${config.jlpt}`);
    }
    filtersSummary.textContent = bits.join(' · ');
  }

  const startButton = () => modal.el.querySelector('.modal-footer .btn-primary');

  /** Live per-pool counts on the pool options ("21,671 words"; "…" while counting). */
  function syncPoolCounts(isReview) {
    for (const p of POOLS) {
      const { aside } = poolGroup.option(p.value);
      const n = matches[p.value];
      aside.hidden = isReview || n === undefined;
      aside.classList.toggle('is-pending', n === null);
      aside.textContent = n === null ? '…' : n === undefined ? '' : number(n);
      aside.title = n == null ? '' : `${plural(n, 'word')} match your filters`;
    }
  }

  /** Reflect the current state in the summary line, field states and the Start button. */
  function sync() {
    const isReview = config.source === 'review';
    for (const g of [levelGroup, posGroup, jlptGroup, poolGroup]) g.setDisabled(isReview);
    customInput.classList.toggle('is-invalid', Boolean(countError));
    customInput.setAttribute('aria-invalid', String(Boolean(countError)));
    syncPoolCounts(isReview);
    syncSteps();
    const available = isReview ? review : matches[config.pool];
    let text;
    if (countError) text = countError;
    else if (available === null) text = 'Counting matching words…';
    else if (available === undefined) text = 'Couldn’t count matching words right now.';
    else if (!available) text = isReview ? 'There are no words to review yet.' : 'No words match these filters. Try a broader selection.';
    else {
      const size = Math.min(config.count, available);
      text = isReview
        ? `${plural(available, 'word')} to review · your test will have ${plural(size, 'word')}`
        : `${number(available)} ${available === 1 ? 'word matches' : 'words match'}${size < config.count ? ` · your test will have ${plural(size, 'word')}` : ''}`;
    }
    summary.textContent = text;
    summary.classList.toggle('is-error', Boolean(countError) || available === 0);
    summary.classList.toggle('is-pending', available === null && !countError);
    const btn = modal && startButton();
    if (btn && !btn.classList.contains('is-loading')) btn.disabled = Boolean(countError) || available === 0;
  }

  const fetchCount = debounce(async () => {
    const seq = ++countSeq;
    const { script, level, pos, jlpt } = requestBody({ ...config, source: 'random' });
    const results = await Promise.all(POOLS.map((p) => api.words.count({ script, level, pos, jlpt, pool: p.value })
      .then((r) => r.count).catch(() => undefined)));
    if (seq !== countSeq) return;
    matches = Object.fromEntries(POOLS.map((p, i) => [p.value, results[i]]));
    sync();
  }, 250);

  function refreshCount() {
    alert.clear();
    if (config.source === 'random') { matches = { all: null, common: null }; fetchCount(); }
    sync();
  }

  async function start() {
    if (countError) { showStep('basics'); customInput.focus(); return false; }
    alert.clear();
    try {
      created = await api.tests.create(requestBody(config, titleInput.value.trim()));
      save(config);
      return true;
    } catch (err) {
      if (err.fields?.title) showStep('filters');
      alert.show(err.fields?.count || err.fields?.title || err.fields?.mode || err.fields?.pool || err.message);
      return false;
    }
  }

  // Listen mode needs a Japanese voice. The check can take up to ~1.5 s while the browser loads its
  // voices, so the dialog opens straight away and the option is disabled once we know.
  const listen = modeGroup.option('listen');
  const listenText = listen.desc.textContent;
  listen.label.classList.add('is-checking');
  hasJapaneseVoice().then((ok) => {
    listen.label.classList.remove('is-checking');
    if (ok || !modal?.el.isConnected) return;
    listen.input.disabled = true;
    listen.label.classList.add('is-disabled');
    listen.desc.textContent = 'Needs a Japanese voice, which this browser doesn’t have yet.';
    note.hidden = false;
    if (config.mode === 'listen') {
      config.mode = 'romaji';
      modeGroup.set('romaji');
    }
  }).catch(() => { listen.label.classList.remove('is-checking'); listen.desc.textContent = listenText; });

  modeGroup.el.querySelector('input:checked')?.setAttribute('autofocus', '');
  const form = h('form', {
    class: 'dash-nt',
    noValidate: true,
    on: { submit: (e) => { e.preventDefault(); startButton()?.click(); } },
  },
  stepTabs.el,
  h('div', { class: 'dash-nt-panels' }, basics, filters),
  alert.el,
  h('button', { type: 'submit', hidden: true, tabIndex: -1 }));
  showStep('basics');

  return new Promise((resolve) => {
    modal = openModal({
      title: 'New test',
      description: 'Choose how to practise. You can end a test at any time.',
      size: 'lg',
      className: 'dash-nt-dialog',
      body: form,
      actions: [
        { label: 'Cancel', variant: 'secondary' },
        { label: 'Start test', variant: 'primary', onClick: start },
      ],
      onClose: () => {
        resolve(created);
        if (!created) return;
        if (onCreated) onCreated(created);
        else routerNavigate(`/practice/${created.test.id}`);
      },
    });
    signal?.addEventListener('abort', () => modal.close('dismiss'), { once: true });
    const footer = modal.el.querySelector('.modal-footer');
    footer.prepend(summary);
    startButton()?.prepend(icon('play', { size: 16 }));
    refreshCount();
  });
}
