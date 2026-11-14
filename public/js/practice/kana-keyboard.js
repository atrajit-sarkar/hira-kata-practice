/**
 * On-screen kana keyboard (SPEC §12.4, §15.4, §15.7a): script toggle, Basic / Voiced / Small
 * sections (side by side on wide screens, tabs on narrow ones), modifier keys ゛ ゜ 小, backspace
 * (hold to repeat) and Clear. Keys never take focus from the answer input when clicked, and each
 * section is one tab stop with arrow-key navigation for keyboard users.
 *
 * Layouts: `'shuffled'` (default) packs each section's keys in a random order that changes for
 * every question and whenever the script toggles, so the learner has to recognise each character;
 * `'gojuon'` keeps the textbook table. Romaji column labels are opt-in and only exist in gojūon
 * order; no layout shows them by default.
 * @module practice/kana-keyboard
 */
import { h, svg } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { segmented, tabs } from '../ui/controls.js';
import { keyboardLayout, kanaKeyLabel, scriptOf } from '/shared/kana.js';

/** Layout switches from tabs to side-by-side sections at this width (keep in sync with CSS). */
const WIDE_QUERY = '(min-width: 960px)';
const PRESS_MS = 220;
const REPEAT_DELAY = 420;
const REPEAT_EVERY = 70;
/** Longest deal-in animation of a reshuffled section: .42 s plus the largest stagger (CSS). */
const DEAL_MS = 650;

/** Small section arranged as rows of KEYBOARD.small indexes: ゃゅょ / ぁぃぅ / ぇぉゎ / っー. */
const SMALL_ROWS = [[0, 1, 2], [4, 5, 6], [7, 8, 9], [3, 10]];

const SECTIONS = [
  { value: 'basic', label: 'Basic' },
  { value: 'voiced', label: 'Voiced ゛゜' },
  { value: 'small', label: 'Small & ー' },
];

const MODIFIERS = [
  { mod: 'dakuten', label: 'Add or remove dakuten (voiced mark) on the previous character', tip: 'Dakuten ゛ (か→が)' },
  { mod: 'handakuten', label: 'Add or remove handakuten on the previous character', tip: 'Handakuten ゜ (は→ぱ)' },
  { mod: 'small', label: 'Make the previous character small or full size', tip: 'Small kana (や→ゃ)' },
];

/**
 * Modifier key face. ゛ and ゜ are drawn as SVG marks because the stand-alone glyphs sit in a
 * corner of their em box, at a different spot in every font.
 * @param {string} mod
 */
function modifierFace(mod) {
  if (mod === 'small') return h('span', { class: 'kana', lang: 'ja' }, '小');
  const marks = mod === 'dakuten'
    ? [svg('path', { d: 'M8.5 6.5l2.2 5.5' }), svg('path', { d: 'M14 5.5l2.2 5.5' })]
    : [svg('circle', { cx: 12, cy: 10, r: 4.2 })];
  return svg('svg', {
    class: 'kb-mod-mark', viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round',
  }, ...marks);
}

/**
 * Build the gojūon grids (rows of chars, '' = empty cell) for a script.
 * @param {'hiragana'|'katakana'} script
 */
function gridsFor(script) {
  const L = keyboardLayout(script);
  const voiced = L.voiced.map((row, i) => [...row, i === 2 ? L.voicedExtra[0] : '']);
  const small = SMALL_ROWS.map((row) => row.map((i) => L.small[i]));
  return {
    basic: { columns: L.basicColumns, rows: L.basic },
    voiced: { columns: [...L.voicedColumns, 'v'], rows: voiced },
    small: { columns: null, rows: small },
  };
}

/** Fisher–Yates shuffle (returns a new array). */
function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Every key of each section in a fresh random order. A permutation identical to the previous one
 * is drawn again, so a reshuffle always visibly changes the board.
 * @param {'hiragana'|'katakana'} script
 * @param {Map<string, string>} [previous] section → previous order joined
 * @returns {Record<string, string[]>}
 */
function shuffledSections(script, previous) {
  const grids = gridsFor(script);
  const out = {};
  for (const [name, { rows }] of Object.entries(grids)) {
    const keys = rows.flat().filter(Boolean);
    let order = shuffled(keys);
    for (let tries = 0; tries < 4 && previous?.get(name) === order.join(''); tries++) order = shuffled(keys);
    out[name] = order;
  }
  return out;
}

/**
 * @typedef {object} KanaKeyboard
 * @property {HTMLElement} el
 * @property {() => 'hiragana'|'katakana'} getScript
 * @property {(script: 'hiragana'|'katakana') => void} setScript
 * @property {() => void} toggleScript
 * @property {(name: 'basic'|'voiced'|'small') => void} showSection  select a section tab (narrow layout)
 * @property {(on: boolean) => void} setLabels
 * @property {(layout: 'shuffled'|'gojuon', opts?: {headers?: boolean}) => void} setLayout
 * @property {() => void} shuffle   new random order (shuffled layout only; call for every question)
 * @property {(ch: string) => void} guideTo     pulse the key (or the tab / script toggle) for ch
 * @property {() => void} guideToBackspace
 * @property {() => void} clearGuide
 * @property {(mod: string) => void} rejectModifier  shake a modifier key that did not apply
 * @property {() => void} destroy
 */

/**
 * Create the keyboard.
 * @param {{script?: 'hiragana'|'katakana', showLabels?: boolean, layout?: 'shuffled'|'gojuon',
 *   headers?: boolean, onKey: (ch: string) => void, onModifier: (mod: string) => void,
 *   onBackspace: () => void, onClear: () => void, onScriptChange?: (script: string) => void}} opts
 *   headers = romaji column labels (gojūon layout only)
 * @returns {KanaKeyboard}
 */
export function createKanaKeyboard({
  script: initialScript = 'hiragana', showLabels = false, layout: initialLayout = 'shuffled', headers: initialHeaders = false,
  onKey, onModifier, onBackspace, onClear, onScriptChange,
}) {
  let script = initialScript;
  let layout = initialLayout === 'gojuon' ? 'gojuon' : 'shuffled';
  let headers = Boolean(initialHeaders);
  let section = 'basic';
  let guided = null;
  const wideMql = window.matchMedia(WIDE_QUERY);
  /**
   * section → { grid, keys, matrix }: keys in DOM order; matrix = gojūon rows of key buttons
   * (null = empty cell), or null for the packed (shuffled) grid.
   * @type {Map<string, {grid: HTMLElement, keys: HTMLButtonElement[], matrix: (HTMLButtonElement|null)[][]|null}>}
   */
  const cells = new Map();
  /** section → last shuffled order, so a reshuffle never repeats it. */
  const lastOrder = new Map();
  const sectionEls = new Map();
  const timers = new Set();

  const root = h('div', {
    class: ['kb', showLabels && 'show-labels'],
    role: 'group',
    'aria-label': 'On-screen kana keyboard',
    dataset: { section, script, layout },
  });
  // Clicking any control keeps focus (and the caret) in the answer input, and never opens the
  // device keyboard on touch screens.
  root.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });

  const scriptToggle = segmented({
    label: 'Keyboard script',
    size: 'sm',
    className: 'kb-script',
    value: script,
    options: [
      { value: 'hiragana', label: h('span', { class: 'kb-script-label' }, h('span', { class: 'kana', lang: 'ja' }, 'あ'), h('span', { class: 'kb-script-name' }, ' ひらがな')), ariaLabel: 'Hiragana' },
      { value: 'katakana', label: h('span', { class: 'kb-script-label' }, h('span', { class: 'kana', lang: 'ja' }, 'ア'), h('span', { class: 'kb-script-name' }, ' カタカナ')), ariaLabel: 'Katakana' },
    ],
    onChange: (v) => applyScript(v, true),
  });
  scriptToggle.el.setAttribute('data-tip', 'Switch script (Alt+K)');

  const sectionTabs = tabs({
    label: 'Keyboard section',
    className: 'kb-tabs',
    value: section,
    items: SECTIONS,
    onChange: (v) => showSection(v),
  });

  function showSection(v) {
    section = v;
    root.dataset.section = v;
    sectionTabs.setValue(v);
    refreshGuide();
  }

  const sectionsEl = h('div', { class: 'kb-sections' });
  for (const { value, label } of SECTIONS) {
    const el = h('div', {
      class: 'kb-section',
      dataset: { section: value },
      role: 'group',
      'aria-label': label,
    }, h('div', { class: 'kb-section-title', 'aria-hidden': 'true' }, label));
    sectionEls.set(value, el);
    sectionsEl.appendChild(el);
  }

  function makeKey(sectionName, ch) {
    const label = kanaKeyLabel(ch);
    return h('button', {
      class: 'kb-key',
      type: 'button',
      tabIndex: -1,
      dataset: { section: sectionName, kana: ch },
      'aria-label': label ? `${ch} ${label}` : ch,
    }, h('span', { class: 'kb-key-kana kana', lang: 'ja' }, ch), h('span', { class: 'kb-key-romaji', 'aria-hidden': 'true' }, label));
  }

  /** Gojūon table: rows with empty cells, optional romaji column labels. */
  function tableGrid(name, { columns, rows }) {
    const width = Math.max(...rows.map((r) => r.length));
    const grid = h('div', { class: 'kb-grid', dataset: { section: name }, style: { '--kb-cols': width } });
    if (columns && headers) {
      for (const c of columns) grid.appendChild(h('span', { class: 'kb-col-head', 'aria-hidden': 'true' }, c || '·'));
    }
    const keys = [];
    const matrix = rows.map((row) => Array.from({ length: width }, (_, i) => {
      const ch = row[i] || '';
      if (!ch) {
        grid.appendChild(h('span', { class: 'kb-gap', 'aria-hidden': 'true' }));
        return null;
      }
      const btn = makeKey(name, ch);
      grid.appendChild(btn);
      keys.push(btn);
      return btn;
    }));
    return { grid, keys, matrix };
  }

  /** Shuffled: every key packed in order, no gaps; CSS sets the column count per breakpoint. */
  function packedGrid(name, order, animate) {
    const grid = h('div', { class: ['kb-grid', 'is-packed', animate && 'is-shuffling'], dataset: { section: name } });
    const keys = order.map((ch, i) => {
      const btn = makeKey(name, ch);
      if (animate) btn.style.setProperty('--kb-d', `${(i % 7) * 14 + Math.floor(Math.random() * 40)}ms`);
      grid.appendChild(btn);
      return btn;
    });
    // Deal the keys in once. Without this, showing a hidden section tab (narrow layout) would
    // replay the animation and fade its keys in again on every tab switch.
    if (animate) setTimeout(() => grid.classList.remove('is-shuffling'), DEAL_MS);
    return { grid, keys, matrix: null };
  }

  /** (Re)build every section for the current script and layout. */
  function render({ animate = false } = {}) {
    const focused = root.contains(document.activeElement) && document.activeElement.classList.contains('kb-key')
      ? document.activeElement.dataset.section : null;
    const grids = gridsFor(script);
    const orders = layout === 'shuffled' ? shuffledSections(script, lastOrder) : null;
    for (const { value: name } of SECTIONS) {
      const built = orders ? packedGrid(name, orders[name], animate) : tableGrid(name, grids[name]);
      if (orders) lastOrder.set(name, orders[name].join(''));
      built.keys[0].tabIndex = 0;
      const old = cells.get(name);
      if (old) old.grid.replaceWith(built.grid); else sectionEls.get(name).appendChild(built.grid);
      cells.set(name, built);
      if (focused === name) built.keys[0].focus({ preventScroll: true });
    }
    root.dataset.layout = layout;
    root.classList.toggle('has-headers', layout === 'gojuon' && headers);
    refreshGuide();
  }

  function press(el) {
    el.classList.remove('is-pressed');
    void el.offsetWidth; // restart the animation on rapid repeats
    el.classList.add('is-pressed');
    const t = setTimeout(() => { el.classList.remove('is-pressed'); timers.delete(t); }, PRESS_MS);
    timers.add(t);
  }

  /** Columns of a packed grid as laid out right now (depends on the breakpoint). */
  function packedColumns(grid) {
    const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, tracks);
  }

  /** Arrow-key target inside a packed grid. */
  function packedTarget(keys, btn, key, grid) {
    const cols = packedColumns(grid);
    const i = keys.indexOf(btn);
    const rowStart = i - (i % cols);
    const rowEnd = Math.min(keys.length - 1, rowStart + cols - 1);
    const next = {
      ArrowLeft: i % cols ? i - 1 : -1,
      ArrowRight: i < rowEnd ? i + 1 : -1,
      ArrowUp: i - cols,
      ArrowDown: i + cols < keys.length ? i + cols : -1,
      Home: rowStart,
      End: rowEnd,
    }[key];
    return next >= 0 ? keys[next] : null;
  }

  /** Arrow-key target inside a gojūon table (skips empty cells). */
  function tableTarget(matrix, btn, key) {
    let r = matrix.findIndex((row) => row.includes(btn));
    let c = matrix[r].indexOf(btn);
    if (key === 'Home' || key === 'End') {
      const row = matrix[r].filter(Boolean);
      return key === 'Home' ? row[0] : row[row.length - 1];
    }
    const [dr, dc] = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[key];
    for (r += dr, c += dc; r >= 0 && r < matrix.length && c >= 0 && c < matrix[r].length; r += dr, c += dc) {
      if (matrix[r][c]) return matrix[r][c];
    }
    return null;
  }

  /** Arrow-key navigation inside a section grid (roving tabindex). */
  function onGridKeydown(e) {
    const btn = e.target.closest('.kb-key');
    if (!btn || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const { grid, keys, matrix } = cells.get(btn.dataset.section);
    const target = matrix ? tableTarget(matrix, btn, e.key) : packedTarget(keys, btn, e.key, grid);
    if (!target) return;
    for (const k of keys) k.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
  }

  sectionsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.kb-key');
    if (!btn) return;
    press(btn);
    onKey(btn.dataset.kana);
  });
  sectionsEl.addEventListener('keydown', onGridKeydown);

  const modifierButtons = new Map(MODIFIERS.map(({ mod, label, tip }) => {
    const btn = h('button', {
      class: 'kb-tool kb-mod', type: 'button', 'aria-label': label, 'data-tip': tip, dataset: { mod },
      on: { click: () => { press(btn); onModifier(mod); } },
    }, modifierFace(mod));
    return [mod, btn];
  }));

  const backspace = h('button', {
    class: 'kb-tool kb-backspace', type: 'button', 'aria-label': 'Delete previous character', 'data-tip': 'Delete (hold to repeat)',
  }, icon('delete-left', { size: 20 }));
  let repeatTimer = 0;
  const stopRepeat = () => { clearTimeout(repeatTimer); clearInterval(repeatTimer); repeatTimer = 0; };
  backspace.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    press(backspace);
    onBackspace();
    stopRepeat();
    repeatTimer = setTimeout(() => { repeatTimer = setInterval(onBackspace, REPEAT_EVERY); }, REPEAT_DELAY);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) backspace.addEventListener(type, stopRepeat);
  // Pointer presses are handled on pointerdown; keyboard activation arrives as a click with detail 0.
  backspace.addEventListener('click', (e) => { if (e.detail === 0) { press(backspace); onBackspace(); } });

  const clearBtn = h('button', {
    class: 'kb-tool kb-clear', type: 'button', 'aria-label': 'Clear answer',
    on: { click: () => { press(clearBtn); onClear(); } },
  }, 'Clear');

  root.append(
    h('div', { class: 'kb-top' }, scriptToggle.el, sectionTabs.el),
    sectionsEl,
    h('div', { class: 'kb-tools' },
      h('div', { class: 'kb-tools-group', role: 'group', 'aria-label': 'Modifiers' }, [...modifierButtons.values()]),
      h('div', { class: 'kb-tools-group' }, backspace, clearBtn)),
  );
  render();

  function applyScript(next, fromUser) {
    if (next !== 'hiragana' && next !== 'katakana') return;
    const changed = next !== script;
    script = next;
    root.dataset.script = next;
    scriptToggle.setValue(next);
    if (changed) render({ animate: layout === 'shuffled' });
    refreshGuide();
    if (changed && fromUser) onScriptChange?.(next);
  }

  /** Locate the key for ch in the current layout. */
  function findKey(ch) {
    for (const [name, { keys }] of cells) {
      const btn = keys.find((k) => k.dataset.kana === ch);
      if (btn) return { name, btn };
    }
    return null;
  }

  function clearGuideMarks() {
    for (const el of root.querySelectorAll('.is-guide')) el.classList.remove('is-guide');
  }

  function refreshGuide() {
    clearGuideMarks();
    if (!guided) return;
    if (guided === '\b') { backspace.classList.add('is-guide'); return; }
    const chScript = guided === 'ー' ? script : scriptOf(guided);
    if (chScript && chScript !== script) {
      scriptToggle.el.querySelector(`[data-value="${chScript}"]`)?.classList.add('is-guide');
      return;
    }
    const found = findKey(guided);
    if (!found) return;
    if (!wideMql.matches && found.name !== section) {
      sectionTabs.el.querySelector(`[data-value="${found.name}"]`)?.classList.add('is-guide');
      return;
    }
    found.btn.classList.add('is-guide');
  }
  const onWideChange = () => refreshGuide();
  wideMql.addEventListener('change', onWideChange);

  return {
    el: root,
    getScript: () => script,
    setScript: (s) => applyScript(s, false),
    toggleScript: () => applyScript(script === 'hiragana' ? 'katakana' : 'hiragana', true),
    showSection,
    setLabels(on) { root.classList.toggle('show-labels', Boolean(on)); },
    setLayout(next, { headers: withHeaders = headers } = {}) {
      const nextLayout = next === 'gojuon' ? 'gojuon' : 'shuffled';
      if (nextLayout === layout && Boolean(withHeaders) === headers) return;
      layout = nextLayout;
      headers = Boolean(withHeaders);
      render({ animate: layout === 'shuffled' });
    },
    shuffle({ animate = true } = {}) {
      if (layout === 'shuffled') render({ animate });
    },
    guideTo(ch) { guided = ch || null; refreshGuide(); },
    guideToBackspace() { guided = '\b'; refreshGuide(); },
    clearGuide() { guided = null; clearGuideMarks(); },
    rejectModifier(mod) {
      const btn = modifierButtons.get(mod);
      if (!btn) return;
      btn.classList.remove('is-rejected');
      void btn.offsetWidth;
      btn.classList.add('is-rejected');
    },
    destroy() {
      stopRepeat();
      for (const t of timers) clearTimeout(t);
      wideMql.removeEventListener('change', onWideChange);
    },
  };
}
