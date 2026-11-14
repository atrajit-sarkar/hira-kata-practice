/**
 * Hiragana vs katakana accuracy as two meters (fill on a lighter track of the same hue).
 * @module dashboard/script-meters
 */
import { h } from '../ui/dom.js';
import { percent, number } from '../ui/format.js';
import { chartCard, chartEmpty, dataTable, showTip, hideTip, anchorOf } from './chart-kit.js';

const SCRIPTS = [
  { key: 'hiragana', label: 'Hiragana', glyph: 'あ', color: 'hira', track: 'hiraTrack' },
  { key: 'katakana', label: 'Katakana', glyph: 'ア', color: 'kata', track: 'kataTrack' },
];

function detail(s) {
  return s.answered ? `${number(s.correct)} of ${number(s.answered)} correct` : 'Not practised yet';
}

function meterRow(def, s, t) {
  const tip = { value: s.answered ? percent(s.accuracy) : '—', title: def.label, key: t[def.color], lines: [detail(s)] };
  const row = h('div', {
    class: 'dash-meter',
    tabIndex: 0,
    role: 'meter',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round((s.accuracy || 0) * 100),
    'aria-valuetext': s.answered ? `${percent(s.accuracy)}, ${detail(s)}` : detail(s),
    'aria-label': `${def.label} accuracy`,
    on: {
      pointerenter: () => showTip(tip, anchorOf(row)),
      pointerleave: () => { if (document.activeElement !== row) hideTip(); },
      focus: () => showTip(tip, anchorOf(row)),
      blur: hideTip,
    },
  },
  h('div', { class: 'dash-meter-head' },
    h('span', { class: 'dash-meter-name' },
      h('span', { class: 'dash-legend-key is-rect', style: { background: t[def.color] }, 'aria-hidden': 'true' }),
      h('span', { class: 'dash-meter-glyph kana', lang: 'ja', 'aria-hidden': 'true' }, def.glyph),
      def.label),
    h('span', { class: 'dash-meter-value' }, s.answered ? percent(s.accuracy) : '—')),
  h('div', { class: 'dash-meter-track', style: { background: t[def.track] } },
    h('div', { class: 'dash-meter-fill', style: { width: `${(s.accuracy || 0) * 100}%`, background: t[def.color] } })),
  h('p', { class: 'dash-meter-detail' }, detail(s)));
  return row;
}

/**
 * Create the script comparison card. Call `update(stats.byScript)`.
 * @returns {ReturnType<typeof chartCard>}
 */
export function scriptMeters() {
  return chartCard({
    title: 'Hiragana vs katakana',
    subtitle: 'Accuracy by script, all time',
    className: 'dash-scripts',
    render(byScript, { tokens }) {
      const rows = SCRIPTS.map((d) => ({ def: d, s: byScript?.[d.key] || { answered: 0, correct: 0, accuracy: 0 } }));
      if (!rows.some((r) => r.s.answered)) {
        return { empty: chartEmpty({ icon: 'target', title: 'Nothing to compare yet', text: 'Answer words in both scripts to see where you are stronger.' }) };
      }
      const plot = h('div', { class: 'dash-meters' }, rows.map((r) => meterRow(r.def, r.s, tokens)));
      const table = dataTable({
        caption: 'Accuracy by script',
        // "N of M" (as in the meters and the weakest-kana table) keeps Accuracy in view in the narrow card.
        columns: [{ label: 'Script' }, { label: 'Correct', num: true }, { label: 'Accuracy', num: true }],
        rows: rows.map((r) => [r.def.label, `${number(r.s.correct)} of ${number(r.s.answered)}`, r.s.answered ? percent(r.s.accuracy) : '—']),
      });
      return { plot, table };
    },
  });
}
