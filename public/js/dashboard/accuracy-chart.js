/**
 * Accuracy over recent tests: a single-series line with an area wash, a snapping crosshair
 * tooltip (pointer and arrow keys) and a table view.
 * @module dashboard/accuracy-chart
 */
import { h, svg } from '../ui/dom.js';
import { percent, date } from '../ui/format.js';
import { chartCard, chartEmpty, dataTable, showTip, hideTip } from './chart-kit.js';

const HEIGHT = 228;
const M = { top: 18, right: 44, bottom: 30, left: 40 };
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** @param {object} p accuracyTrend entry */
function tipFor(p) {
  return {
    value: percent(p.accuracy),
    title: p.title,
    lines: [date(p.date), `${p.answered} answered · score ${percent(p.scorePercent)}`],
  };
}

/** Indexes that get an x-axis date label, spaced at least `minGap` px apart. */
function labelIndexes(n, step, minGap = 72) {
  if (n === 1) return [0];
  const every = Math.max(1, Math.ceil(minGap / step));
  const out = [];
  for (let i = 0; i < n; i += every) out.push(i);
  const last = n - 1;
  if (out[out.length - 1] !== last) {
    if ((last - out[out.length - 1]) * step < minGap) out.pop();
    out.push(last);
  }
  return out;
}

function renderPlot(points, width, t) {
  const iw = Math.max(40, width - M.left - M.right);
  const ih = HEIGHT - M.top - M.bottom;
  const n = points.length;
  const step = n > 1 ? iw / (n - 1) : 0;
  const x = (i) => M.left + (n > 1 ? i * step : iw / 2);
  const y = (v) => M.top + (1 - v) * ih;

  const root = svg('svg', {
    class: 'dash-svg', width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, 'aria-hidden': 'true',
  });

  for (const v of Y_TICKS) {
    root.appendChild(svg('line', {
      x1: M.left, x2: M.left + iw, y1: y(v), y2: y(v), stroke: v === 0 ? t.axis : t.grid, 'stroke-width': 1,
      'shape-rendering': 'crispEdges',
    }));
    root.appendChild(svg('text', { x: M.left - 8, y: y(v), class: 'dash-axis-text', 'text-anchor': 'end', 'dominant-baseline': 'middle', fill: t.textMuted }, percent(v)));
  }
  for (const i of labelIndexes(n, step || iw)) {
    const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    root.appendChild(svg('text', { x: x(i), y: HEIGHT - 8, class: 'dash-axis-text', 'text-anchor': anchor, fill: t.textMuted },
      SHORT_DATE.format(new Date(points[i].date))));
  }

  const coords = points.map((p, i) => [x(i), y(p.accuracy)]);
  const linePath = coords.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  if (n > 1) {
    const area = `${linePath}L${coords[n - 1][0].toFixed(1)},${y(0)}L${coords[0][0].toFixed(1)},${y(0)}Z`;
    root.appendChild(svg('path', { d: area, fill: t.line, 'fill-opacity': 0.1 }));
    root.appendChild(svg('path', { d: linePath, fill: 'none', stroke: t.line, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }

  const [ex, ey] = coords[n - 1];
  root.appendChild(svg('circle', { cx: ex, cy: ey, r: 4.5, fill: t.line, stroke: t.surface, 'stroke-width': 2 }));
  root.appendChild(svg('text', { x: ex + 9, y: ey, class: 'dash-direct-label', 'dominant-baseline': 'middle', fill: t.text }, percent(points[n - 1].accuracy)));

  const cross = svg('line', { y1: M.top, y2: M.top + ih, stroke: t.muted, 'stroke-width': 1, class: 'dash-crosshair', visibility: 'hidden', 'shape-rendering': 'crispEdges' });
  const dot = svg('circle', { r: 5, fill: t.line, stroke: t.surface, 'stroke-width': 2, visibility: 'hidden' });
  root.append(cross, dot);

  return { root, coords, x, step, iw, cross, dot };
}

function attachInteraction(wrap, points, chart) {
  const { coords, cross, dot } = chart;
  let active = -1;
  const status = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });

  const select = (i, viaKeyboard) => {
    active = Math.max(0, Math.min(points.length - 1, i));
    const [px, py] = coords[active];
    cross.setAttribute('x1', px);
    cross.setAttribute('x2', px);
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', px);
    dot.setAttribute('cy', py);
    dot.setAttribute('visibility', 'visible');
    const r = chart.root.getBoundingClientRect();
    const tip = tipFor(points[active]);
    showTip(tip, { x: r.left + px, y: r.top + M.top + (HEIGHT - M.top - M.bottom) / 2 }, { placement: 'side' });
    if (viaKeyboard) status.textContent = `${tip.title}: ${tip.value}. ${tip.lines.join('. ')}`;
  };
  const clearSel = () => {
    active = -1;
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    hideTip();
  };
  const nearest = (clientX) => {
    const r = chart.root.getBoundingClientRect();
    const px = clientX - r.left;
    if (points.length === 1) return 0;
    return Math.round((px - M.left) / chart.step);
  };

  wrap.addEventListener('pointermove', (e) => select(nearest(e.clientX), false));
  wrap.addEventListener('pointerleave', () => { if (document.activeElement !== wrap) clearSel(); });
  wrap.addEventListener('focus', () => select(active < 0 ? points.length - 1 : active, true));
  wrap.addEventListener('blur', clearSel);
  wrap.addEventListener('keydown', (e) => {
    const map = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: points.length - 1 };
    if (!(e.key in map)) {
      if (e.key === 'Escape') clearSel();
      return;
    }
    e.preventDefault();
    select(map[e.key], true);
  });
  wrap.appendChild(status);
}

/**
 * Create the accuracy chart card. Call `update(stats.accuracyTrend)`.
 * @returns {ReturnType<typeof chartCard>}
 */
export function accuracyChart() {
  return chartCard({
    title: 'Accuracy by test',
    subtitle: 'Your last 20 tests, oldest to newest',
    className: 'dash-accuracy',
    render(points, { width, tokens }) {
      if (!points?.length) {
        return { empty: chartEmpty({ icon: 'chart', title: 'No answers yet', text: 'Finish a few questions and your accuracy trend will appear here.' }) };
      }
      const chart = renderPlot(points, width, tokens);
      const last = points[points.length - 1];
      const wrap = h('div', {
        class: 'dash-plot-focus',
        tabIndex: 0,
        role: 'group',
        'aria-roledescription': 'chart',
        'aria-label': `Accuracy over your last ${points.length} tests. Latest: ${percent(last.accuracy)}. Use the arrow keys to inspect each test.`,
      }, chart.root);
      attachInteraction(wrap, points, chart);
      const table = dataTable({
        caption: 'Accuracy by test',
        columns: [{ label: 'Test' }, { label: 'Date' }, { label: 'Answered', num: true }, { label: 'Accuracy', num: true }, { label: 'Score', num: true }],
        rows: points.slice().reverse().map((p) => [p.title, date(p.date), String(p.answered), percent(p.accuracy), percent(p.scorePercent)]),
      });
      return { plot: wrap, table };
    },
  });
}
