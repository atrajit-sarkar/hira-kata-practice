/**
 * Character-level answer diff rendered as kana tiles (SPEC §3.3 diff ops).
 * @module ui/answer-diff
 */
import { h } from './dom.js';

/**
 * Render a diff.
 * - `show: 'actual'` (the learner's answer): match → success tile, sub → danger tile,
 *   ins → danger tile struck through (extra), del → dashed empty slot (missing).
 * - `show: 'expected'` (the correct answer): match → neutral tile, sub/del → highlighted
 *   "fix" tile (the character the learner should have written); ins ops are skipped.
 * @param {Array<{op: 'match'|'sub'|'ins'|'del', expected: string|null, actual: string|null}>} diff
 * @param {{show?: 'actual'|'expected', size?: 'sm'|'md'|'lg', label?: string}} [opts]
 *   label prefixes the accessible summary (default "Your answer" / "Correct answer").
 * @returns {HTMLElement} <div class="answer-diff">
 */
export function renderAnswerDiff(diff, { show = 'actual', size = 'md', label } = {}) {
  const ops = Array.isArray(diff) ? diff : [];
  const tiles = [];
  const counts = { wrong: 0, extra: 0, missing: 0 };
  let text = '';

  for (const d of ops) {
    if (show === 'expected') {
      if (d.op === 'ins') continue;
      const fix = d.op !== 'match';
      text += d.expected;
      tiles.push(h('span', {
        class: ['answer-diff-tile', fix ? 'is-fix' : 'is-neutral'],
        'aria-hidden': 'true',
      }, d.expected));
      if (fix) counts.wrong += 1;
      continue;
    }
    switch (d.op) {
      case 'match':
        text += d.actual;
        tiles.push(h('span', { class: 'answer-diff-tile is-match', 'aria-hidden': 'true' }, d.actual));
        break;
      case 'sub':
        text += d.actual;
        counts.wrong += 1;
        tiles.push(h('span', { class: 'answer-diff-tile is-sub', 'aria-hidden': 'true', title: `Should be ${d.expected}` }, d.actual));
        break;
      case 'ins':
        text += d.actual;
        counts.extra += 1;
        tiles.push(h('span', { class: 'answer-diff-tile is-ins', 'aria-hidden': 'true', title: 'Extra character' }, d.actual));
        break;
      case 'del':
        counts.missing += 1;
        tiles.push(h('span', { class: 'answer-diff-tile is-del', 'aria-hidden': 'true', title: `Missing ${d.expected}` }));
        break;
      default:
        break;
    }
  }

  const prefix = label || (show === 'expected' ? 'Correct answer' : 'Your answer');
  let summary;
  if (show === 'expected') {
    summary = `${prefix}: ${text}.${counts.wrong ? ` ${counts.wrong} highlighted character${counts.wrong === 1 ? '' : 's'} to fix.` : ''}`;
  } else if (!text) {
    summary = `${prefix}: no answer.`;
  } else {
    const issues = [];
    if (counts.wrong) issues.push(`${counts.wrong} wrong`);
    if (counts.missing) issues.push(`${counts.missing} missing`);
    if (counts.extra) issues.push(`${counts.extra} extra`);
    summary = `${prefix}: ${text}.${issues.length ? ` ${issues.join(', ')} character${counts.wrong + counts.missing + counts.extra === 1 ? '' : 's'}.` : ' All characters correct.'}`;
  }

  return h('div', {
    class: ['answer-diff', `answer-diff-${size}`, `answer-diff-${show}`],
    dataset: { show },
  },
  h('span', { class: 'answer-diff-tiles', lang: 'ja', 'aria-hidden': 'true' }, tiles),
  h('span', { class: 'visually-hidden' }, summary));
}
