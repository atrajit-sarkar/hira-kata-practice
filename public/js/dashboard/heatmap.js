/**
 * Activity calendar: 26 weeks x 7 days of answered words, sequential blue ramp, scale legend,
 * per-cell hover and arrow-key focus tooltips, weekly table view.
 * @module dashboard/heatmap
 */
import { h, svg } from '../ui/dom.js';
import { number, percent, plural } from '../ui/format.js';
import { chartCard, chartEmpty, dataTable, showTip, hideTip } from './chart-kit.js';

const WEEKS = 26;
const LEFT = 30;
const TOP = 18;
const GAP = 3;
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const fmtMonth = new Intl.DateTimeFormat('en-US', { month: 'short' });
const fmtDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const fmtWeek = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Parse "YYYY-MM-DD" as a local calendar date (noon avoids DST edge cases). */
function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

function keyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Lay the daily series out as week columns ending with the current week.
 * @param {Array<{date: string, answered: number, correct: number}>} daily oldest → today
 * @returns {{cells: Array<{date: Date, key: string, col: number, row: number, answered: number, correct: number}>, max: number}}
 */
export function layoutCalendar(daily) {
  const byKey = new Map(daily.map((d) => [d.date, d]));
  const today = parseKey(daily[daily.length - 1].date);
  const start = addDays(today, -today.getDay() - (WEEKS - 1) * 7);
  const cells = [];
  let max = 0;
  for (let i = 0; ; i++) {
    const day = addDays(start, i);
    if (day > today) break;
    const key = keyOf(day);
    const rec = byKey.get(key);
    const answered = rec?.answered || 0;
    max = Math.max(max, answered);
    cells.push({ date: day, key, col: Math.floor(i / 7), row: day.getDay(), answered, correct: rec?.correct || 0 });
  }
  return { cells, max };
}

/** Bin 0 = no activity, 1..5 = quintiles of the busiest day. */
function binOf(answered, max) {
  if (!answered || !max) return 0;
  return Math.min(5, Math.max(1, Math.ceil((answered / max) * 5)));
}

function tipFor(c) {
  return {
    value: plural(c.answered, 'word'),
    title: fmtDay.format(c.date),
    lines: c.answered ? [`${number(c.correct)} correct · ${percent(c.correct / c.answered)}`] : ['No practice'],
  };
}

function renderPlot({ cells, max }, width, t) {
  const pitch = Math.max(10, Math.min(22, Math.floor((width - LEFT) / WEEKS)));
  const size = pitch - GAP;
  const w = LEFT + pitch * WEEKS;
  const height = TOP + pitch * 7;
  const fills = [t.empty, ...t.seq];
  const root = svg('svg', { class: 'dash-svg dash-heatmap-svg', width: w, height, viewBox: `0 0 ${w} ${height}`, 'aria-hidden': 'true' });

  DAY_LABELS.forEach((label, row) => {
    if (label) root.appendChild(svg('text', { x: 0, y: TOP + row * pitch + size / 2, class: 'dash-axis-text', 'dominant-baseline': 'middle', fill: t.textMuted }, label));
  });
  let lastMonthCol = -4;
  let lastMonth = -1;
  for (const c of cells) {
    if (c.row !== 0 && c !== cells[0]) continue;
    const m = c.date.getMonth();
    if (m !== lastMonth && c.col - lastMonthCol >= 3) {
      root.appendChild(svg('text', { x: LEFT + c.col * pitch, y: 10, class: 'dash-axis-text', fill: t.textMuted }, fmtMonth.format(c.date)));
      lastMonthCol = c.col;
    }
    lastMonth = m;
  }

  const rects = cells.map((c) => {
    const r = svg('rect', {
      x: LEFT + c.col * pitch, y: TOP + c.row * pitch, width: size, height: size, rx: Math.min(4, size / 4),
      fill: fills[binOf(c.answered, max)], class: 'dash-heat-cell',
    });
    root.appendChild(r);
    return r;
  });
  const ring = svg('rect', { width: size + 2, height: size + 2, rx: Math.min(5, size / 4 + 1), fill: 'none', stroke: t.text, 'stroke-width': 1.5, visibility: 'hidden', 'pointer-events': 'none' });
  root.appendChild(ring);
  return { root, rects, ring, size };
}

function attachInteraction(wrap, cells, chart) {
  let active = -1;
  const status = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const select = (i, announce) => {
    active = Math.max(0, Math.min(cells.length - 1, i));
    const rect = chart.rects[active];
    chart.ring.setAttribute('x', Number(rect.getAttribute('x')) - 1);
    chart.ring.setAttribute('y', Number(rect.getAttribute('y')) - 1);
    chart.ring.setAttribute('visibility', 'visible');
    const r = rect.getBoundingClientRect();
    const tip = tipFor(cells[active]);
    showTip(tip, { x: r.left + r.width / 2, y: r.top });
    if (announce) status.textContent = `${tip.title}: ${tip.value}. ${tip.lines.join('. ')}`;
  };
  const clearSel = () => { chart.ring.setAttribute('visibility', 'hidden'); hideTip(); };
  chart.rects.forEach((rect, i) => rect.addEventListener('pointerenter', () => select(i, false)));
  wrap.addEventListener('pointerleave', () => { if (document.activeElement !== wrap) clearSel(); });
  wrap.addEventListener('focus', () => select(active < 0 ? cells.length - 1 : active, true));
  wrap.addEventListener('blur', clearSel);
  wrap.addEventListener('keydown', (e) => {
    const map = { ArrowUp: active - 1, ArrowDown: active + 1, ArrowLeft: active - 7, ArrowRight: active + 7, Home: 0, End: cells.length - 1 };
    if (e.key === 'Escape') { clearSel(); return; }
    if (!(e.key in map)) return;
    e.preventDefault();
    select(map[e.key], true);
  });
  wrap.appendChild(status);
}

function weeklyTable(cells) {
  const weeks = [];
  for (const c of cells) {
    const w = (weeks[c.col] ||= { start: c.date, answered: 0, correct: 0, days: 0 });
    w.answered += c.answered;
    w.correct += c.correct;
    if (c.answered) w.days += 1;
  }
  return dataTable({
    caption: 'Words answered per week',
    columns: [{ label: 'Week of' }, { label: 'Words', num: true }, { label: 'Correct', num: true }, { label: 'Active days', num: true }],
    rows: weeks.slice().reverse().map((w) => [fmtWeek.format(w.start), number(w.answered), number(w.correct), String(w.days)]),
  });
}

/** Longest run of consecutive active days inside the calendar window. */
function longestRun(cells) {
  let best = 0;
  let run = 0;
  for (const c of cells) {
    run = c.answered ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Headline figures shown beside the calendar (they repeat nothing the table hides). */
function summary({ cells, max }) {
  const active = cells.filter((c) => c.answered);
  const total = active.reduce((s, c) => s + c.answered, 0);
  const busiest = active.find((c) => c.answered === max);
  const run = longestRun(cells);
  const item = (label, value, unit) => h('div', null, h('dt', null, label), h('dd', null, value, unit ? h('small', null, unit) : null));
  return h('dl', { class: 'dash-heat-summary' },
    item('Words answered', number(total)),
    item('Active days', number(active.length), `of ${number(cells.length)}`),
    item('Longest run', number(run), run === 1 ? 'day' : 'days'),
    item('Busiest day', number(max), busiest ? fmtShort.format(busiest.date) : ''));
}

/**
 * Create the activity calendar card. Call `update(stats.daily)`.
 * @returns {ReturnType<typeof chartCard>}
 */
export function activityHeatmap() {
  return chartCard({
    title: 'Activity',
    subtitle: 'Words answered per day, last 26 weeks',
    className: 'dash-heatmap',
    render(daily, { width, tokens }) {
      if (!daily?.length || !daily.some((d) => d.answered > 0)) {
        return { empty: chartEmpty({ icon: 'calendar', title: 'No activity yet', text: 'Every day you practise fills in a square here.' }) };
      }
      const layout = layoutCalendar(daily);
      const chart = renderPlot(layout, width, tokens);
      const total = layout.cells.reduce((s, c) => s + c.answered, 0);
      const activeDays = layout.cells.filter((c) => c.answered).length;
      const wrap = h('div', {
        class: 'dash-plot-focus dash-heatmap-plot',
        tabIndex: 0,
        role: 'group',
        'aria-roledescription': 'calendar heatmap',
        'aria-label': `${plural(total, 'word')} over ${plural(activeDays, 'active day')} in the last 26 weeks. Use the arrow keys to inspect days.`,
      }, chart.root);
      attachInteraction(wrap, layout.cells, chart);
      const scale = h('div', { class: 'dash-scale', 'aria-hidden': 'true' },
        h('span', null, 'Less'),
        [tokens.empty, ...tokens.seq].map((c) => h('span', { class: 'dash-scale-cell', style: { background: c } })),
        h('span', null, 'More'),
        h('span', { class: 'dash-scale-max' }, `busiest day ${plural(layout.max, 'word')}`));
      return {
        plot: h('div', { class: 'dash-heatmap-layout' }, h('div', { class: 'dash-heatmap-main' }, wrap, scale), summary(layout)),
        table: weeklyTable(layout.cells),
      };
    },
  });
}
