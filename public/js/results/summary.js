/**
 * Results summary blocks: the KPI row of stat tiles and the hiragana vs katakana meters.
 * @module results/summary
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { duration, number, percent } from '../ui/format.js';

function tile(iconName, label, value, detail, extra) {
  return h('div', { class: 'stat-tile results-tile' },
    h('span', { class: 'stat-label' }, icon(iconName, { size: 16 }), label),
    h('span', { class: 'stat-value' }, value),
    detail ? h('span', { class: 'stat-delta' }, detail) : null,
    extra || null);
}

/**
 * Thin segmented bar (correct / wrong / skipped) with no text: the tile text carries the figures.
 * @param {{correct: number, wrong: number, skipped: number}} counts
 * @returns {HTMLElement|null}
 */
function outcomeBar({ correct, wrong, skipped }) {
  const total = correct + wrong + skipped;
  if (!total) return null;
  const parts = [['correct', correct], ['wrong', wrong], ['skipped', skipped]].filter(([, n]) => n > 0);
  return h('div', {
    class: 'results-outcome-bar',
    role: 'img',
    'aria-label': `${correct} correct, ${wrong} wrong, ${skipped} skipped`,
  }, parts.map(([kind, n]) => h('span', { class: `is-${kind}`, style: { flexGrow: String(n) } })));
}

/**
 * KPI row for a test.
 * @param {object} test TestSummary
 * @returns {HTMLElement}
 */
export function statTiles(test) {
  const answered = test.correctCount + test.wrongCount + test.skippedCount;
  const avgMs = answered ? test.timeSpentMs / answered : null;
  const romajiHints = test.romajiHintCount || 0;
  const hints = test.hint1Count + test.hint2Count + romajiHints;
  // Name only the kinds actually used, so the line stays short enough for one row.
  const hintParts = [[test.hint1Count, 'script'], [test.hint2Count, 'guided'], [romajiHints, 'romaji']]
    .filter(([n]) => n > 0).map(([n, kind]) => `${number(n)} ${kind}`);
  return h('section', { class: 'results-tiles', 'aria-label': 'Test statistics' },
    tile('target', 'Accuracy',
      answered ? percent(test.accuracy) : '—',
      answered ? `${number(test.correctCount)} of ${number(answered)} answered` : 'Nothing answered yet'),
    tile('check-circle', 'Correct',
      h('span', null, number(test.correctCount), h('small', null, `/ ${number(test.totalQuestions)}`)),
      `${number(test.wrongCount)} wrong · ${number(test.skippedCount)} skipped`,
      outcomeBar({ correct: test.correctCount, wrong: test.wrongCount, skipped: test.skippedCount })),
    tile('lightbulb', 'Hints used', number(hints),
      // "Solved" only when something was actually solved (not on an empty or all-wrong test).
      hints ? hintParts.join(' · ') : test.correctCount ? 'Solved without help' : 'No hints used'),
    tile('clock', 'Time', duration(test.timeSpentMs),
      avgMs != null ? `${duration(avgMs)} per word on average` : 'No time recorded'),
    tile('flame', 'Best streak',
      h('span', null, number(test.bestStreak), h('small', null, test.bestStreak === 1 ? 'word' : 'words')),
      'Correct answers in a row'));
}

const SCRIPTS = [
  { key: 'hiragana', jp: 'ひらがな', label: 'Hiragana' },
  { key: 'katakana', jp: 'カタカナ', label: 'Katakana' },
];

/**
 * Hiragana vs katakana accuracy meters. Each row is directly labelled with its figures,
 * so the values never depend on colour or hover.
 * @param {Record<'hiragana'|'katakana', {answered: number, correct: number}>} byScript
 * @returns {HTMLElement}
 */
export function scriptMeters(byScript) {
  const rows = SCRIPTS.map(({ key, jp, label }) => {
    const { answered, correct } = byScript[key];
    const ratio = answered ? correct / answered : 0;
    return h('div', { class: ['script-meter', `is-${key}`, !answered && 'is-empty'] },
      h('div', { class: 'script-meter-head' },
        h('span', { class: 'script-meter-name' },
          h('span', { class: 'script-meter-swatch', 'aria-hidden': 'true' }),
          h('span', { class: 'jp', lang: 'ja' }, jp), label),
        h('span', { class: 'script-meter-value' },
          answered ? percent(ratio) : 'No words',
          answered ? h('small', null, `${number(correct)} / ${number(answered)} correct`) : null)),
      h('div', {
        class: 'script-meter-track',
        role: 'meter',
        'aria-label': `${label} accuracy`,
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(Math.round(ratio * 100)),
        'aria-valuetext': answered ? `${percent(ratio)}, ${correct} of ${answered} correct` : `No ${label.toLowerCase()} words answered`,
      }, h('span', { class: 'script-meter-fill', style: { '--meter': String(ratio) } })));
  });
  return h('section', { class: 'card results-scripts', 'aria-labelledby': 'results-scripts-title' },
    h('div', { class: 'card-header' },
      h('div', null,
        h('h2', { class: 'card-title', id: 'results-scripts-title' }, 'Hiragana vs katakana'),
        h('p', { class: 'card-subtitle' }, 'Accuracy by script on the words you answered'))),
    h('div', { class: 'card-body results-scripts-body' }, rows));
}

/**
 * Card listing the words missed or skipped in this test; each opens its review row.
 * @param {Array<object>} questions items of GET /api/tests/:id
 * @param {{onSelect: (position: number) => void, answered: number}} opts
 * @returns {HTMLElement}
 */
export function missedWords(questions, { onSelect, answered }) {
  const missed = questions
    .filter((q) => q.status === 'wrong' || q.status === 'skipped')
    .sort((a, b) => a.position - b.position);

  let body;
  if (!answered) {
    body = h('p', { class: 'results-missed-empty' }, icon('info', { size: 18 }), 'Answer a few words to see what to practise next.');
  } else if (!missed.length) {
    body = h('p', { class: 'results-missed-empty is-perfect' }, icon('sparkles', { size: 18 }), 'No mistakes. Every answered word was right.');
  } else {
    body = h('ul', { class: 'results-missed-list', role: 'list' }, missed.map((q) => h('li', null,
      h('button', {
        class: ['results-missed-word', `is-${q.script}`],
        type: 'button',
        'aria-label': `${q.expected} (${q.romaji}), ${q.status === 'skipped' ? 'skipped' : 'wrong'}. Show in review`,
        on: { click: () => onSelect(q.position) },
      },
      h('span', { class: 'kana', lang: 'ja' }, q.expected),
      h('span', { class: 'results-missed-romaji' }, q.romaji)))));
  }

  return h('section', { class: 'card results-missed', 'aria-labelledby': 'results-missed-title' },
    h('div', { class: 'card-header' },
      h('div', null,
        h('h2', { class: 'card-title', id: 'results-missed-title' }, 'Words to practise'),
        h('p', { class: 'card-subtitle' },
          missed.length ? `${number(missed.length)} missed or skipped. Select one to review it.` : 'Missed and skipped words appear here'))),
    h('div', { class: 'card-body' }, body));
}
