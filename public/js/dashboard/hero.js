/**
 * Dashboard header pieces: the greeting hero, the guest banner and the first-time welcome panel.
 * @module dashboard/hero
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { plural } from '../ui/format.js';

const fmtToday = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/**
 * One encouraging line under the greeting, chosen from today's activity and the streak.
 * @param {object|null} stats StatsOverview (null until it has loaded, or when it failed to load)
 * @returns {string}
 */
export function heroLine(stats) {
  if (!stats) return 'Here’s how your kana writing is coming along.';
  const { totals, streak } = stats;
  if (!totals.answered) return 'Write real Japanese words in hiragana and katakana, one at a time.';
  if (streak.todayAnswered) return `You’ve written ${plural(streak.todayAnswered, 'word')} today. Nice work.`;
  if (streak.current) return `Practise today to keep your ${streak.current}-day streak going.`;
  return 'Ready for a few words? A short test is a great way back in.';
}

/**
 * The greeting hero. Call `update(stats)` once statistics arrive.
 * @param {{name: string, reportUrl: string, onNewTest: () => void}} opts
 * @returns {{el: HTMLElement, update: (stats: object) => void}}
 */
export function renderHero({ name, reportUrl, onNewTest }) {
  const greeting = h('span', { class: 'jp', lang: 'ja' }, 'おかえり');
  const sub = h('p', { class: 'dash-hero-sub' }, heroLine(null));
  const streakCount = h('strong', null, '0');
  const streak = h('span', { class: 'dash-streak', hidden: true },
    icon('flame', { size: 18 }), h('span', null, streakCount, '-day streak'));
  const report = h('a', {
    class: 'btn btn-secondary', href: reportUrl, download: '', hidden: true,
  }, icon('download', { size: 18 }), 'Overall report', h('span', { class: 'dash-hero-pdf' }, ' (PDF)'));
  const el = h('header', { class: 'dash-hero' },
    h('div', { class: 'dash-hero-text' },
      h('p', { class: 'dash-date' }, fmtToday.format(new Date())),
      h('h1', null, greeting, `, ${name}`),
      sub),
    h('div', { class: 'dash-hero-actions' },
      streak,
      report,
      h('button', { class: 'btn btn-primary', type: 'button', on: { click: onNewTest } }, icon('plus', { size: 18 }), 'New test')));

  return {
    el,
    update(stats) {
      const firstTime = !stats.totals.answered && !stats.totals.tests;
      greeting.textContent = firstTime ? 'ようこそ' : 'おかえり';
      sub.textContent = heroLine(stats);
      const days = stats.streak.current;
      streak.hidden = firstTime;
      streak.classList.toggle('is-active', days > 0);
      streakCount.textContent = String(days);
      streak.title = `Best: ${plural(stats.streak.best, 'day')}`;
      report.hidden = firstTime;
    },
  };
}

/**
 * Banner shown to guest users, pointing them to the upgrade form.
 * @param {{onSave: () => void}} opts
 * @returns {HTMLElement}
 */
export function renderGuestBanner({ onSave }) {
  return h('aside', { class: 'dash-guest', 'aria-label': 'Guest account' },
    h('span', { class: 'dash-guest-icon' }, icon('shield', { size: 20 })),
    h('p', { class: 'dash-guest-text' },
      h('strong', null, 'You’re practising as a guest'),
      h('span', null, 'Create a free account to keep your progress and sign in from any device.')),
    h('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: onSave } }, 'Save your progress', icon('arrow-right', { size: 16 })));
}

const PRESETS = [
  { glyph: 'あ', script: 'hiragana', title: 'Hiragana basics', text: 'Short, everyday words', config: { script: 'hiragana', level: '1', count: 10, pos: 'any', jlpt: 'any', source: 'random' } },
  { glyph: 'ア', script: 'katakana', title: 'Katakana starter', text: 'Simple loanwords', config: { script: 'katakana', level: '1', count: 10, pos: 'any', jlpt: 'any', source: 'random' } },
  { glyph: 'あア', script: 'mixed', title: 'Mixed practice', text: 'Both scripts, any level', config: { script: 'mixed', level: 'all', count: 20, pos: 'any', jlpt: 'any', source: 'random' } },
];

/** Decorative writing-grid tiles for the welcome panel. */
function illustration() {
  const tile = (ch, cls) => h('span', { class: ['dash-welcome-tile', cls] }, h('span', { class: 'kana', lang: 'ja' }, ch));
  return h('div', { class: 'dash-welcome-art', 'aria-hidden': 'true' },
    tile('か', 'is-hira t1'), tile('タ', 'is-kata t2'), tile('な', 'is-hira t3'), tile('ー', 'is-kata t4'));
}

/**
 * First-time empty state: illustration, a primary CTA and three quick-start presets that open
 * the New test dialog preselected.
 * @param {{onStart: (initial?: object) => void}} opts
 * @returns {HTMLElement}
 */
export function renderWelcome({ onStart }) {
  return h('section', { class: 'card dash-welcome', 'aria-labelledby': 'dash-welcome-title' },
    h('div', { class: 'dash-welcome-intro' },
      illustration(),
      h('div', { class: 'dash-welcome-copy' },
        h('h2', { id: 'dash-welcome-title' }, 'Start your first test'),
        h('p', null, 'You’ll see a word in romaji and write it in kana. Hints are there when you need them, and every answer teaches you the word’s meaning.'),
        h('button', { class: 'btn btn-primary btn-lg', type: 'button', on: { click: () => onStart() } },
          icon('play', { size: 18 }), 'Start your first test'))),
    h('div', { class: 'dash-welcome-presets' },
      h('p', { class: 'dash-welcome-presets-title' }, 'Or pick a quick start'),
      h('ul', { class: 'dash-presets' }, PRESETS.map((p) => h('li', null,
        h('button', { class: ['dash-preset', `is-${p.script}`], type: 'button', on: { click: () => onStart(p.config) } },
          h('span', { class: 'dash-preset-glyph kana', lang: 'ja', 'aria-hidden': 'true' }, p.glyph),
          h('span', { class: 'dash-preset-text' },
            h('span', { class: 'dash-preset-title' }, p.title),
            h('span', { class: 'dash-preset-desc' }, `${p.text} · ${p.config.count} words`)),
          icon('arrow-right', { size: 18, className: 'dash-preset-arrow' })))))));
}
