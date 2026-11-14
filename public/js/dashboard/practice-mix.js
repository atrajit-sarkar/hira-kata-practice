/**
 * How the learner practises (SPEC 15.6): accuracy by practice mode (romaji → write vs listen →
 * write) and by input method (kana keys / handwriting / device keyboard), as single-hue meters.
 * Each row is one category named by its label and icon, so the fills share the brand hue (colour
 * carries no identity here); the detail line adds the category's share of answers.
 * @module dashboard/practice-mix
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { percent, number } from '../ui/format.js';
import { chartCard, chartEmpty, dataTable, showTip, hideTip, anchorOf } from './chart-kit.js';
import { MODES, INPUTS, metaIcon } from '../results/practice-meta.js';

const EMPTY = Object.freeze({ answered: 0, correct: 0, accuracy: 0 });

function correctText(s) {
  return s.answered ? `${number(s.correct)} of ${number(s.answered)} correct` : 'Not practised yet';
}

function shareText(s, total) {
  return s.answered && total ? `${percent(s.answered / total)} of answers` : '';
}

/** One meter row: icon + label, accuracy value, a brand fill on a soft brand track, detail line. */
function meterRow(def, s, total, t) {
  const share = shareText(s, total);
  const text = share ? `${correctText(s)} · ${share}` : correctText(s);
  const tip = { value: s.answered ? percent(s.accuracy) : '—', title: def.label, key: t.line, lines: [text] };
  const row = h('div', {
    class: ['dash-meter', 'dash-mix-meter', !s.answered && 'is-unused'],
    tabIndex: 0,
    role: 'meter',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round((s.accuracy || 0) * 100),
    'aria-valuetext': s.answered ? `${percent(s.accuracy)}, ${text}` : text,
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
      h('span', { class: 'dash-mix-icon', 'aria-hidden': 'true' }, metaIcon(def.icon, { size: 16 })),
      def.label),
    h('span', { class: 'dash-meter-value' }, s.answered ? percent(s.accuracy) : '—')),
  h('div', { class: 'dash-meter-track dash-mix-track' },
    h('div', { class: 'dash-meter-fill', style: { width: `${(s.accuracy || 0) * 100}%`, background: t.line } })),
  h('p', { class: 'dash-meter-detail' }, correctText(s), share ? h('span', { class: 'dash-mix-share' }, share) : null));
  return row;
}

/**
 * Render meters + table for a breakdown object, or the empty state when nothing was answered.
 * @param {Record<string, {answered: number, correct: number, accuracy: number}>|undefined} data
 * @param {object[]} defs MODES / INPUTS values in display order
 */
function breakdown(data, defs, { tokens, caption, column, empty, layout, after }) {
  const rows = defs.map((d) => ({ def: d, s: data?.[d.key] || EMPTY }));
  const total = rows.reduce((n, r) => n + r.s.answered, 0);
  if (!total) return { empty: chartEmpty(empty) };
  const plot = h('div', { class: ['dash-meters', 'dash-mix', `is-${layout}`] },
    rows.map((r) => meterRow(r.def, r.s, total, tokens)),
    after ? after(rows) : null);
  const table = dataTable({
    caption,
    columns: [{ label: column }, { label: 'Correct', num: true }, { label: 'Share', num: true }, { label: 'Accuracy', num: true }],
    rows: rows.map((r) => [
      r.def.label,
      `${number(r.s.correct)} of ${number(r.s.answered)}`,
      percent(r.s.answered / total),
      r.s.answered ? percent(r.s.accuracy) : '—',
    ]),
  });
  return { plot, table };
}

/**
 * Accuracy by practice mode. Call `update(stats.byMode)`.
 * @param {{onTryListen?: () => void}} [opts] offers a listening test when none was answered yet
 * @returns {ReturnType<typeof chartCard>}
 */
export function modeBreakdown({ onTryListen } = {}) {
  return chartCard({
    title: 'Romaji vs listening',
    subtitle: 'Accuracy by mode, all time',
    className: 'dash-modes',
    render(byMode, { tokens }) {
      return breakdown(byMode, Object.values(MODES), {
        tokens,
        layout: 'stack',
        caption: 'Accuracy by practice mode',
        column: 'Mode',
        empty: { icon: 'target', title: 'No answers yet', text: 'Finish a few words to compare reading romaji with listening.' },
        after: (rows) => (onTryListen && !rows.find((r) => r.def.key === 'listen').s.answered
          ? h('button', { class: 'btn btn-secondary btn-sm dash-mix-cta', type: 'button', on: { click: onTryListen } },
            metaIcon('headphones', { size: 16 }), 'Try a listening test')
          : null),
      });
    },
  });
}

/**
 * Accuracy by input method. Call `update(stats.byInput)`.
 * @returns {ReturnType<typeof chartCard>}
 */
export function inputBreakdown() {
  return chartCard({
    title: 'Input methods',
    subtitle: 'Accuracy by how you wrote each answer',
    className: 'dash-inputs',
    render(byInput, { tokens, width }) {
      return breakdown(byInput, Object.values(INPUTS), {
        tokens,
        layout: width >= 560 ? 'row' : 'stack',
        caption: 'Accuracy by input method',
        column: 'Input method',
        empty: {
          icon: 'keyboard',
          title: 'No answers recorded yet',
          text: 'Answers you write with kana keys, handwriting or your own keyboard will be compared here.',
        },
        after: () => h('p', { class: 'dash-mix-foot' }, icon('info', { size: 14 }),
          'Skipped words and answers from before input methods were tracked are not counted.'),
      });
    },
  });
}
