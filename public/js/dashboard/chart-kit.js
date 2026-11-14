/**
 * Shared building blocks for the dashboard's hand-built SVG charts: the chart card (title,
 * table-view toggle, empty state), a single floating tooltip, theme tokens read from CSS custom
 * properties, and resize/theme observers that trigger a re-render.
 * @module dashboard/chart-kit
 */
import { h, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** CSS custom properties the charts read. Dashboard-only ramps live in css/dashboard.css. */
const TOKEN_NAMES = {
  surface: '--surface-1',
  surface3: '--surface-3',
  text: '--text-primary',
  textSecondary: '--text-secondary',
  textMuted: '--text-muted',
  grid: '--chart-grid',
  axis: '--chart-axis',
  muted: '--chart-muted',
  line: '--brand',
  hira: '--hira',
  kata: '--kata',
  hiraTrack: '--hira-soft',
  kataTrack: '--kata-soft',
  seq1: '--dash-seq-1',
  seq2: '--dash-seq-2',
  seq3: '--dash-seq-3',
  seq4: '--dash-seq-4',
  seq5: '--dash-seq-5',
  empty: '--dash-cell-empty',
};

/**
 * Read the current theme's chart colours from CSS custom properties.
 * @param {Element} [el] element whose computed style is read (defaults to <html>)
 * @returns {Record<keyof typeof TOKEN_NAMES, string> & {seq: string[]}}
 */
export function readTokens(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const [key, name] of Object.entries(TOKEN_NAMES)) out[key] = cs.getPropertyValue(name).trim();
  out.seq = [out.seq1, out.seq2, out.seq3, out.seq4, out.seq5];
  return out;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Pick the label ink (white or near-black, identical in both themes) for text set inside a fill.
 * @param {string} fillHex
 * @returns {'#ffffff'|'#0b0b0b'}
 */
export function inkOn(fillHex) {
  const rgb = hexToRgb(fillHex);
  if (!rgb) return '#0b0b0b';
  const L = luminance(rgb);
  const vsWhite = 1.05 / (L + 0.05);
  const vsBlack = (L + 0.05) / (luminance([11, 11, 11]) + 0.05);
  return vsWhite >= vsBlack ? '#ffffff' : '#0b0b0b';
}

/**
 * Watch the colour theme (html[data-theme] and the OS preference).
 * @param {() => void} fn called after the theme changes
 * @returns {() => void} stop watching
 */
export function onThemeChange(fn) {
  const mo = new MutationObserver(() => fn());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', fn);
  return () => { mo.disconnect(); mq.removeEventListener('change', fn); };
}

/**
 * Call `fn(width)` whenever the element's content width changes (rounded, de-duplicated).
 * @param {Element} el
 * @param {(width: number) => void} fn
 * @returns {() => void} disconnect
 */
export function onWidthChange(el, fn) {
  let last = -1;
  let raf = 0;
  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0].contentRect.width);
    if (w === last || w === 0) return;
    last = w;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => fn(w));
  });
  ro.observe(el);
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}

// ---------------------------------------------------------------------------------------------
// Tooltip: one shared element, filled with textContent only.

let tipEl = null;

function tooltipEl() {
  if (tipEl?.isConnected) return tipEl;
  tipEl = h('div', { class: 'dash-tooltip', role: 'presentation', 'aria-hidden': 'true' });
  document.body.appendChild(tipEl);
  return tipEl;
}

/**
 * @typedef {object} TipContent
 * @property {string} value       the strong, leading line (e.g. "82%")
 * @property {string} [title]     secondary line (series/category)
 * @property {string[]} [lines]   further muted lines
 * @property {string} [key]       colour of a short line-key drawn before the title
 */

/**
 * Show the tooltip anchored to a viewport point. 'above' (default) centres it above the point and
 * flips below near the top edge; 'side' puts it beside the point (right, or left near the right
 * edge), vertically centred, so it never covers a crosshair's data.
 * @param {TipContent} content
 * @param {{x: number, y: number}} at viewport coordinates
 * @param {{placement?: 'above'|'side'}} [opts]
 */
export function showTip(content, at, { placement = 'above' } = {}) {
  const el = tooltipEl();
  el.replaceChildren(
    h('div', { class: 'dash-tooltip-value' }, content.value),
    content.title ? h('div', { class: 'dash-tooltip-title' },
      content.key ? h('span', { class: 'dash-tooltip-key', style: { background: content.key } }) : null,
      content.title) : null,
    ...(content.lines || []).map((l) => h('div', { class: 'dash-tooltip-line' }, l)),
  );
  el.classList.add('is-visible');
  const r = el.getBoundingClientRect();
  const margin = 8;
  let left;
  let top;
  if (placement === 'side') {
    left = at.x + 14;
    if (left + r.width > window.innerWidth - margin) left = at.x - r.width - 14;
    top = at.y - r.height / 2;
  } else {
    left = at.x - r.width / 2;
    top = at.y - r.height - 12;
    if (top < margin) top = at.y + 16;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - r.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - r.height - margin));
  el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

/** Hide the shared tooltip. */
export function hideTip() {
  tipEl?.classList.remove('is-visible');
}

/**
 * Viewport anchor point for an element (its top centre).
 * @param {Element} el
 * @returns {{x: number, y: number}}
 */
export function anchorOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top };
}

// ---------------------------------------------------------------------------------------------
// Chart card, legend and table view.

/**
 * Build an accessible data table (the table-view twin of a chart).
 * @param {{caption: string, columns: Array<{label: string, num?: boolean}>, rows: Array<Array<string|number|Node>>}} opts
 * @returns {HTMLTableElement}
 */
export function dataTable({ caption, columns, rows }) {
  return h('table', { class: 'table dash-table' },
    h('caption', { class: 'visually-hidden' }, caption),
    h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col', class: c.num && 'num' }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', null,
      r.map((cell, i) => h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : undefined, class: columns[i]?.num && 'num' }, cell))))));
}

/**
 * Legend row. Mirrors the mark: 'line' for lines, 'rect' for bars/areas/meters.
 * @param {Array<{label: string, color: string, kind?: 'line'|'rect'}>} items
 * @returns {HTMLUListElement}
 */
export function legend(items) {
  return h('ul', { class: 'dash-legend' }, items.map((it) => h('li', null,
    h('span', { class: ['dash-legend-key', `is-${it.kind || 'rect'}`], style: { background: it.color }, 'aria-hidden': 'true' }),
    it.label)));
}

/**
 * @typedef {object} ChartOutput
 * @property {Node} [plot]   the chart (when there is data)
 * @property {Node} [table]  the table view
 * @property {Node} [empty]  an empty-state node (replaces plot and toggle)
 */

/**
 * A chart card with title, optional subtitle and header extras, a Chart/Table toggle and an
 * empty state. `render(data, { width, tokens })` runs on update, resize and theme change.
 * @param {{title: string, subtitle?: string, extras?: Node, className?: string,
 *   render: (data: any, env: {width: number, tokens: ReturnType<typeof readTokens>}) => ChartOutput}} opts
 * @returns {{el: HTMLElement, update: (data: any) => void, redraw: () => void, destroy: () => void}}
 */
export function chartCard({ title, subtitle, extras, className, render }) {
  const titleId = uid('chart-title');
  let data;
  let hasData = false;
  let showTable = false;
  let width = 0;

  const plot = h('div', { class: 'dash-chart-plot' });
  const table = h('div', { class: 'dash-chart-table table-wrap', hidden: true });
  const toggle = h('button', {
    class: 'btn btn-ghost btn-sm dash-chart-toggle',
    type: 'button',
    'aria-pressed': 'false',
    on: { click: () => setTableView(!showTable) },
  });
  const body = h('div', { class: 'dash-chart-body' }, plot, table);
  const el = h('section', { class: ['card', 'dash-chart', className], 'aria-labelledby': titleId },
    h('header', { class: 'dash-chart-head' },
      h('div', { class: 'dash-chart-titles' },
        h('h3', { class: 'card-title', id: titleId }, title),
        subtitle ? h('p', { class: 'card-subtitle' }, subtitle) : null),
      h('div', { class: 'dash-chart-actions' }, extras || null, toggle)),
    body);

  function syncToggle() {
    toggle.replaceChildren(icon(showTable ? 'chart' : 'list', { size: 16 }), showTable ? 'Chart' : 'Table');
    toggle.setAttribute('aria-pressed', String(showTable));
    toggle.setAttribute('aria-label', showTable ? `Show ${title} as a chart` : `View ${title} as a table`);
    toggle.hidden = !hasData;
    plot.hidden = hasData && showTable;
    table.hidden = !(hasData && showTable);
  }

  function setTableView(on) {
    showTable = on;
    hideTip();
    syncToggle();
  }

  function draw() {
    // The ResizeObserver delivers the first width once the card is attached.
    if (data === undefined || !width) return;
    const out = render(data, { width, tokens: readTokens(el) });
    hasData = !out.empty;
    plot.replaceChildren(out.empty || out.plot || '');
    table.replaceChildren(out.table || '');
    syncToggle();
  }

  const stopResize = onWidthChange(body, (w) => { width = w; draw(); });
  const stopTheme = onThemeChange(() => draw());
  syncToggle();

  return {
    el,
    update(next) { data = next; draw(); },
    redraw: draw,
    destroy() { stopResize(); stopTheme(); hideTip(); },
  };
}

/**
 * A compact empty state for inside a chart card.
 * @param {{icon: string, title: string, text: string}} opts
 * @returns {HTMLElement}
 */
export function chartEmpty({ icon: iconName, title, text }) {
  return h('div', { class: 'dash-chart-empty' },
    h('span', { class: 'dash-chart-empty-icon' }, icon(iconName, { size: 22 })),
    h('p', { class: 'dash-chart-empty-title' }, title),
    h('p', { class: 'dash-chart-empty-text' }, text));
}

// @@END-OF-FILE
