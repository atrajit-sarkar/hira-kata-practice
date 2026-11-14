/**
 * Weakest kana: ranked horizontal bars of per-character accuracy (lowest first), coloured by
 * script with a legend, value at the bar tip, hover/focus tooltips and a table view.
 * @module dashboard/weak-kana
 */
import { kanaKeyLabel } from '/shared/kana.js';
import { h } from '../ui/dom.js';
import { percent, number } from '../ui/format.js';
import { chartCard, chartEmpty, dataTable, legend, showTip, hideTip, anchorOf } from './chart-kit.js';

const SCRIPT = {
  hiragana: { label: 'Hiragana', token: 'hira' },
  katakana: { label: 'Katakana', token: 'kata' },
};

function barRow(c, t) {
  const script = SCRIPT[c.script] || SCRIPT.hiragana;
  const attempts = c.correct + c.wrong;
  const tip = { value: percent(c.accuracy), title: `${c.char}  ${kanaKeyLabel(c.char)} · ${script.label}`, key: t[script.token], lines: [`${number(c.correct)} of ${number(attempts)} correct`] };
  const row = h('li', {
    class: 'dash-bar-row',
    tabIndex: 0,
    'aria-label': `${c.char} ${kanaKeyLabel(c.char)}, ${script.label}: ${percent(c.accuracy)}, ${c.correct} of ${attempts} correct`,
    on: {
      pointerenter: () => showTip(tip, anchorOf(bar)),
      pointerleave: () => { if (document.activeElement !== row) hideTip(); },
      focus: () => showTip(tip, anchorOf(bar)),
      blur: hideTip,
    },
  },
  h('span', { class: 'dash-bar-label', 'aria-hidden': 'true' },
    h('span', { class: 'dash-bar-kana kana', lang: 'ja' }, c.char),
    h('span', { class: 'dash-bar-romaji' }, kanaKeyLabel(c.char))),
  h('span', { class: 'dash-bar-track', 'aria-hidden': 'true' }));
  const bar = h('span', { class: 'dash-bar', style: { width: `max(4px, ${c.accuracy * 100}%)`, background: t[script.token] } },
    h('span', { class: 'dash-bar-value' }, percent(c.accuracy), h('small', null, ` ${c.correct}/${attempts}`)));
  row.lastChild.append(bar);
  return row;
}

/**
 * Create the weakest-kana card. Call `update(stats.weakChars)`.
 * @returns {ReturnType<typeof chartCard>}
 */
export function weakKana() {
  return chartCard({
    title: 'Weakest kana',
    subtitle: 'Lowest accuracy, characters tried at least twice',
    className: 'dash-weak',
    render(weak, { tokens }) {
      if (!weak?.length) {
        return { empty: chartEmpty({ icon: 'sparkles', title: 'No weak spots yet', text: 'Characters you miss more than once will be ranked here so you can focus on them.' }) };
      }
      const scripts = Object.keys(SCRIPT).filter((s) => weak.some((c) => c.script === s));
      const plot = h('div', { class: 'dash-bars-wrap' },
        scripts.length > 1 ? legend(scripts.map((s) => ({ label: SCRIPT[s].label, color: tokens[SCRIPT[s].token] }))) : null,
        h('ol', { class: 'dash-bars', 'aria-label': 'Weakest kana, lowest accuracy first' }, weak.map((c) => barRow(c, tokens))));
      const table = dataTable({
        caption: 'Weakest kana',
        columns: [{ label: 'Kana' }, { label: 'Script' }, { label: 'Correct', num: true }, { label: 'Accuracy', num: true }],
        rows: weak.map((c) => [
          h('span', null, h('span', { class: 'kana', lang: 'ja' }, c.char), h('span', { class: 'dash-table-romaji' }, kanaKeyLabel(c.char))),
          SCRIPT[c.script]?.label || c.script,
          `${number(c.correct)} of ${number(c.correct + c.wrong)}`,
          percent(c.accuracy)]),
      });
      return { plot, table };
    },
  });
}
