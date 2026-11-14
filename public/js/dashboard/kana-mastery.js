/**
 * Kana mastery grid: the gojūon table from the shared keyboard layout, each cell shaded on the
 * sequential ramp by the learner's per-character accuracy (unseen cells neutral). Tabs switch
 * between hiragana and katakana; arrow keys move a single roving focus through the cells.
 * @module dashboard/kana-mastery
 */
import { keyboardLayout, kanaKeyLabel } from '/shared/kana.js';
import { h } from '../ui/dom.js';
import { percent, number } from '../ui/format.js';
import { tabs } from '../ui/controls.js';
import { chartCard, chartEmpty, dataTable, showTip, hideTip, anchorOf, inkOn } from './chart-kit.js';

/** Accuracy bins (lower bounds) for ramp steps 1..5. */
const BINS = [0, 0.5, 0.7, 0.85, 0.95];
const BIN_LABELS = ['Under 50%', '50–69%', '70–84%', '85–94%', '95%+'];
const VOWELS = ['a', 'i', 'u', 'e', 'o'];

function binOf(acc) {
  // Bin the whole percent the label shows, so "70%" (e.g. 0.697) never gets the 50–69% shade.
  const shown = Math.round(acc * 100) / 100;
  let b = 0;
  for (let i = 0; i < BINS.length; i++) if (shown >= BINS[i]) b = i;
  return b;
}

/** Split a flat list into rows of `size` cells, padding the last row with blanks. */
function chunk(list, size) {
  const rows = [];
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size));
  const last = rows[rows.length - 1];
  while (last && last.length < size) last.push('');
  return rows;
}

/**
 * Sections of the selected script's layout, as 2D arrays of characters ('' = empty cell).
 * @param {'hiragana'|'katakana'} script
 */
function sectionsFor(script) {
  const k = keyboardLayout(script);
  return [
    { id: 'basic', title: 'Basic', columns: k.basicColumns, rows: k.basic, rowLabels: VOWELS },
    { id: 'voiced', title: 'Voiced', columns: k.voicedColumns, rows: k.voiced, rowLabels: VOWELS },
    { id: 'small', title: 'Small & long', columns: null, rows: chunk([...k.voicedExtra, ...k.small], 6), rowLabels: null },
  ];
}

function statFor(map, ch) {
  const s = map.get(ch);
  if (!s) return null;
  const attempts = s.correct + s.wrong;
  return attempts ? { ...s, attempts, accuracy: s.correct / attempts } : null;
}

function tipFor(ch, st) {
  const romaji = kanaKeyLabel(ch);
  return st
    ? { value: percent(st.accuracy), title: `${ch}  ${romaji}`, lines: [`${number(st.correct)} of ${number(st.attempts)} correct`] }
    : { value: 'Not practised yet', title: `${ch}  ${romaji}` };
}

function cellEl(ch, st, t) {
  if (!ch) return h('span', { class: 'dash-kana-cell is-blank', 'aria-hidden': 'true' });
  const fill = st ? t.seq[binOf(st.accuracy)] : null;
  const label = st ? `${ch} ${kanaKeyLabel(ch)}: ${percent(st.accuracy)}, ${st.correct} of ${st.attempts} correct` : `${ch} ${kanaKeyLabel(ch)}: not practised yet`;
  const el = h('span', {
    class: ['dash-kana-cell', st ? 'is-seen' : 'is-unseen'],
    role: 'img',
    tabIndex: -1,
    'aria-label': label,
    style: fill ? { background: fill, color: inkOn(fill) } : undefined,
  },
  h('span', { class: 'dash-kana-char kana', lang: 'ja', 'aria-hidden': 'true' }, ch),
  h('span', { class: 'dash-kana-romaji', 'aria-hidden': 'true' }, kanaKeyLabel(ch)));
  const tip = tipFor(ch, st);
  el.addEventListener('pointerenter', () => showTip(tip, anchorOf(el)));
  el.addEventListener('pointerleave', () => { if (document.activeElement !== el) hideTip(); });
  el.addEventListener('focus', () => showTip(tip, anchorOf(el)));
  el.addEventListener('blur', hideTip);
  return el;
}

/** Roving focus: arrows move within a section's 2D grid (skipping blanks); Tab leaves the grid. */
function attachRoving(gridEl, matrix) {
  const all = matrix.flatMap((sec) => sec.flat().filter(Boolean));
  if (!all.length) return;
  all[0].tabIndex = 0;
  const posOf = (el) => {
    for (let s = 0; s < matrix.length; s++) {
      for (let r = 0; r < matrix[s].length; r++) {
        const c = matrix[s][r].indexOf(el);
        if (c >= 0) return { s, r, c };
      }
    }
    return null;
  };
  const vertical = ({ s, r, c }, dir) => {
    const rows = matrix[s];
    for (let rr = r + dir; rr >= 0 && rr < rows.length; rr += dir) if (rows[rr][c]) return rows[rr][c];
    return null;
  };
  gridEl.addEventListener('keydown', (e) => {
    const cur = e.target.closest('.dash-kana-cell');
    if (!cur) return;
    const i = all.indexOf(cur);
    const p = posOf(cur);
    let next = null;
    if (e.key === 'ArrowRight') next = all[i + 1];
    else if (e.key === 'ArrowLeft') next = all[i - 1];
    else if (e.key === 'ArrowDown') next = vertical(p, 1);
    else if (e.key === 'ArrowUp') next = vertical(p, -1);
    else if (e.key === 'Home') next = all[0];
    else if (e.key === 'End') next = all[all.length - 1];
    else return;
    e.preventDefault();
    if (!next) return;
    cur.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  });
}

function renderGrid(script, map, t) {
  const matrix = [];
  const blocks = sectionsFor(script).map((sec) => {
    const cells = sec.rows.map((row) => row.map((ch) => cellEl(ch, statFor(map, ch), t)));
    matrix.push(cells.map((row) => row.map((el) => (el.classList.contains('is-blank') ? null : el))));
    const cols = sec.rows[0].length;
    return h('div', { class: ['dash-kana-section', `is-${sec.id}`], role: 'group', 'aria-label': sec.title },
      h('p', { class: 'dash-kana-section-title', 'aria-hidden': 'true' }, sec.title),
      h('div', { class: ['dash-kana-table', sec.rowLabels && 'has-axis'], style: { '--cols': cols } },
        sec.columns ? h('div', { class: 'dash-kana-row is-head', 'aria-hidden': 'true' },
          h('span', { class: 'dash-kana-axis' }),
          sec.columns.map((c) => h('span', { class: 'dash-kana-axis' }, c))) : null,
        cells.map((row, r) => h('div', { class: 'dash-kana-row' },
          sec.rowLabels ? h('span', { class: 'dash-kana-axis', 'aria-hidden': 'true' }, sec.rowLabels[r]) : null,
          row))));
  });
  const grid = h('div', {
    class: 'dash-kana-grid',
    role: 'group',
    'aria-label': `${script === 'hiragana' ? 'Hiragana' : 'Katakana'} mastery. Use the arrow keys to move between characters.`,
  }, blocks);
  attachRoving(grid, matrix);
  return grid;
}

function scaleLegend(t) {
  return h('ul', { class: 'dash-kana-scale' },
    h('li', null, h('span', { class: 'dash-scale-cell is-unseen', style: { background: t.empty }, 'aria-hidden': 'true' }), 'Unseen'),
    t.seq.map((c, i) => h('li', null, h('span', { class: 'dash-scale-cell', style: { background: c }, 'aria-hidden': 'true' }), BIN_LABELS[i])));
}

/**
 * Create the kana mastery card. Call `update(stats.charStats)`.
 * @returns {ReturnType<typeof chartCard>}
 */
export function kanaMastery() {
  let script = 'hiragana';
  const switcher = tabs({
    label: 'Script',
    value: script,
    items: [{ value: 'hiragana', label: 'Hiragana' }, { value: 'katakana', label: 'Katakana' }],
    onChange: (v) => { script = v; card.redraw(); },
    className: 'dash-kana-tabs',
  });
  const card = chartCard({
    title: 'Kana mastery',
    subtitle: 'Accuracy per character in words you wrote',
    className: 'dash-mastery',
    extras: switcher.el,
    render(charStats, { tokens }) {
      if (!charStats?.length) {
        return { empty: chartEmpty({ icon: 'grid', title: 'Your kana map is blank', text: 'Each character you write correctly or incorrectly is tracked here.' }) };
      }
      // Only this script's stats: ー is shared by both layouts but always counted as katakana
      // (SPEC §3), so an unfiltered map would show katakana results on the hiragana grid.
      const map = new Map(charStats.filter((c) => c.script === script).map((c) => [c.char, c]));
      const plot = h('div', { class: 'dash-kana-wrap', role: 'tabpanel', 'aria-labelledby': switcher.tabId(script) },
        renderGrid(script, map, tokens), scaleLegend(tokens));
      const order = sectionsFor(script).flatMap((s) => s.rows.flat()).filter(Boolean);
      const rows = order.map((ch) => [ch, statFor(map, ch)]).filter(([, st]) => st);
      const table = dataTable({
        caption: `${script} character accuracy`,
        columns: [{ label: 'Kana' }, { label: 'Romaji' }, { label: 'Correct', num: true }, { label: 'Wrong', num: true }, { label: 'Accuracy', num: true }],
        rows: rows.map(([ch, st]) => [h('span', { class: 'kana', lang: 'ja' }, ch), kanaKeyLabel(ch), number(st.correct), number(st.wrong), percent(st.accuracy)]),
      });
      return { plot, table: rows.length ? table : h('p', { class: 'text-secondary dash-table-note' }, `No ${script} characters practised yet.`) };
    },
  });
  return card;
}
