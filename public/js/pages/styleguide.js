/**
 * Hidden public reference page (#/styleguide) showing every token and shared component.
 * Page engineers use it to see the exact classes and ui/* APIs in action.
 */
import { h } from '../ui/dom.js';
import { icon, iconNames } from '../ui/icons.js';
import { logoMark, wordmark } from '../ui/brand.js';
import { segmented, tabs, toggleRow } from '../ui/controls.js';
import { field, passwordField } from '../ui/form.js';
import { renderWordCard } from '../ui/word-card.js';
import { renderAnswerDiff } from '../ui/answer-diff.js';
import { openModal, confirmDialog, promptDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { attachMenu } from '../ui/menu.js';
import { burstFrom, celebrate } from '../ui/confetti.js';
import { play } from '../ui/sound.js';
import { percent, duration, number, relative } from '../ui/format.js';

const TOKEN_GROUPS = [
  ['Surfaces', ['--bg', '--surface-1', '--surface-2', '--surface-3', '--border', '--border-strong']],
  ['Text', ['--text-primary', '--text-secondary', '--text-muted']],
  ['Brand 藍 & accent 朱', ['--brand', '--brand-soft', '--brand-text', '--accent', '--accent-soft']],
  ['Brand ramp', ['--brand-50', '--brand-100', '--brand-200', '--brand-300', '--brand-400', '--brand-500', '--brand-600', '--brand-700', '--brand-800', '--brand-900']],
  ['Scripts', ['--hira', '--hira-soft', '--hira-text', '--kata', '--kata-soft', '--kata-text']],
  ['Status', ['--success', '--success-text', '--success-soft', '--danger', '--danger-text', '--danger-soft', '--warning', '--warning-soft', '--warning-text']],
  ['Charts', ['--chart-grid', '--chart-axis', '--chart-muted']],
  ['Sequential (blue)', ['--seq-100', '--seq-150', '--seq-200', '--seq-250', '--seq-300', '--seq-350', '--seq-400', '--seq-450', '--seq-500', '--seq-550', '--seq-600', '--seq-650', '--seq-700']],
];

/** Realistic WordInfo samples (SPEC §7.1). */
export const SAMPLE_WORDS = {
  coffee: {
    id: '1049180', kana: 'コーヒー', romaji: 'kōhī', script: 'katakana', kanji: ['珈琲'], usuallyKana: true,
    senses: [{ pos: ['Noun'], gloss: ['coffee'], info: [] }],
    meaning: 'coffee', posCategory: 'noun', origin: [{ lang: 'Dutch', text: 'koffie', wasei: false }],
    jlpt: 5, level: 2, features: ['long'], homophones: [],
  },
  cat: {
    id: '1467640', kana: 'ねこ', romaji: 'neko', script: 'hiragana', kanji: ['猫'], usuallyKana: false,
    senses: [
      { pos: ['Noun'], gloss: ['cat (esp. the domestic cat, Felis catus)', 'feline'], info: [] },
      { pos: ['Noun'], gloss: ['shamisen'], info: ['colloquial'] },
      { pos: ['Noun'], gloss: ['geisha'], info: [] },
    ],
    meaning: 'cat (esp. the domestic cat, Felis catus); feline', posCategory: 'noun', origin: [],
    jlpt: 5, level: 1, features: [], homophones: [{ id: '1467650', kanji: '寝子', meaning: 'sleeping child' }],
  },
  baito: {
    id: '1013480', kana: 'バイト', romaji: 'baito', script: 'katakana', kanji: [], usuallyKana: true,
    senses: [{ pos: ['Noun', 'Suru verb'], gloss: ['part-time job', 'side job'], info: ['abbreviation'] }],
    meaning: 'part-time job; side job', posCategory: 'noun', origin: [{ lang: 'German', text: 'Arbeit', wasei: true }],
    jlpt: 3, level: 1, features: ['dakuten'], homophones: [],
  },
};

const m = (e, a) => ({ op: 'match', expected: e, actual: a ?? e });
const DIFFS = [
  ['Correct', 'ねこ → ねこ', [m('ね'), m('こ')]],
  ['Substitution', 'ねこ → ねご', [m('ね'), { op: 'sub', expected: 'こ', actual: 'ご' }]],
  ['Missing character', 'コーヒー → コヒー', [m('コ'), { op: 'del', expected: 'ー', actual: null }, m('ヒ'), m('ー')]],
  ['Extra character', 'がっこう → がっこうう', [m('が'), m('っ'), m('こ'), m('う'), { op: 'ins', expected: null, actual: 'う' }]],
  ['Script error', 'コーヒー → こーひー', [{ op: 'sub', expected: 'コ', actual: 'こ' }, m('ー'), { op: 'sub', expected: 'ヒ', actual: 'ひ' }, m('ー')]],
];

function sg(id, title, description, ...content) {
  return h('section', { class: 'sg-section', id: `sg-${id}`, 'aria-labelledby': `sg-${id}-title` },
    h('header', { class: 'sg-section-head' },
      h('h2', { id: `sg-${id}-title` }, title),
      description ? h('p', null, description) : null),
    ...content);
}

const demoRow = (...children) => h('div', { class: 'sg-row' }, ...children);

function tokensSection() {
  const styles = getComputedStyle(document.documentElement);
  return sg('tokens', 'Colour tokens', 'Defined in css/tokens.css; light on :root, dark under prefers-color-scheme and [data-theme="dark"]. Values shown are live for the current theme.',
    ...TOKEN_GROUPS.map(([group, names]) => h('div', { class: 'sg-token-group' },
      h('h3', null, group),
      h('div', { class: 'sg-swatches' }, names.map((name) => h('div', { class: 'sg-swatch' },
        h('span', { class: 'sg-swatch-color', style: { background: `var(${name})` } }),
        h('span', { class: 'sg-swatch-name' }, name),
        h('span', { class: 'sg-swatch-value' }, styles.getPropertyValue(name).trim())))))));
}

function typeSection() {
  return sg('type', 'Typography', 'Inter for UI; Klee One (textbook) or Noto Sans JP (gothic) for kana via the .kana class / --font-kana.',
    h('div', { class: 'card card-body sg-type' },
      h('h1', null, 'Heading 1 — Write Japanese'),
      h('h2', null, 'Heading 2 — Everything you need'),
      h('h3', null, 'Heading 3 — Card titles'),
      h('h4', null, 'Heading 4 — Small headings'),
      h('p', null, 'Body text, 15px/1.55. ', h('span', { class: 'text-secondary' }, '.text-secondary '), h('span', { class: 'text-muted' }, '.text-muted '), h('span', { class: 'eyebrow' }, '.eyebrow')),
      h('p', { class: 'sg-kana-sample kana', lang: 'ja' }, 'あいうえお　アイウエオ　きょう　コーヒー'),
      h('p', { class: 'sg-kana-sample jp', lang: 'ja' }, '.jp — 猫 珈琲 学校 (Noto Sans JP)'),
      h('p', null, 'Keyboard: ', h('kbd', { class: 'kbd' }, 'Enter'), ' ', h('kbd', { class: 'kbd' }, 'Alt'), ' + ', h('kbd', { class: 'kbd' }, '1'))));
}

function brandSection() {
  return sg('brand', 'Brand', 'ui/brand.js: logoMark({ size, title }) and wordmark({ size, tagline }).',
    demoRow(logoMark({ size: 64 }), logoMark({ size: 40 }), logoMark({ size: 24 }), wordmark({ size: 32 }), wordmark({ size: 28, tagline: true })));
}

function iconsSection() {
  return sg('icons', 'Icons', 'ui/icons.js: icon(name, { size = 20, stroke = 2, className, title }). Hover a tile for its name.',
    h('div', { class: 'sg-icons' }, iconNames().map((name) => h('div', { class: 'sg-icon', title: name },
      icon(name, { size: 22 }), h('span', null, name)))));
}

function buttonsSection() {
  const variants = ['primary', 'secondary', 'ghost', 'danger', 'success'];
  return sg('buttons', 'Buttons', '.btn + .btn-primary | -secondary | -ghost | -danger | -success | -danger-soft, sizes .btn-sm / .btn-lg, .btn-icon, .btn-block, states :disabled and .is-loading.',
    h('div', { class: 'card card-body sg-stack' },
      demoRow(variants.map((v) => h('button', { class: `btn btn-${v}`, type: 'button' }, v[0].toUpperCase() + v.slice(1))),
        h('button', { class: 'btn btn-danger-soft', type: 'button' }, 'Danger soft')),
      demoRow(
        h('button', { class: 'btn btn-primary btn-lg', type: 'button' }, icon('plus', { size: 18 }), 'New test'),
        h('button', { class: 'btn btn-secondary', type: 'button' }, icon('download', { size: 18 }), 'Download PDF'),
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Small'),
        h('button', { class: 'btn btn-secondary btn-icon', type: 'button', 'aria-label': 'More', 'data-tip': 'Icon button with tooltip' }, icon('more')),
        h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': 'Close' }, icon('x', { size: 16 }))),
      demoRow(
        h('button', { class: 'btn btn-primary is-loading', type: 'button', disabled: true }, 'Saving'),
        h('button', { class: 'btn btn-secondary is-loading', type: 'button', disabled: true }, 'Loading'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'Disabled'),
        h('button', { class: 'btn btn-secondary', type: 'button', disabled: true }, 'Disabled'))));
}

function formsSection() {
  const err = field({ label: 'Email', type: 'email', value: 'not-an-email', icon: 'mail' });
  err.setError('Enter a valid email address.');
  const seg = segmented({
    label: 'Script', value: 'mixed',
    options: [{ value: 'hiragana', label: 'あ Hiragana' }, { value: 'katakana', label: 'ア Katakana' }, { value: 'mixed', label: 'Mixed' }],
  });
  const segSm = segmented({ label: 'View', value: 'grid', size: 'sm', options: [{ value: 'grid', label: 'Grid', icon: 'grid' }, { value: 'list', label: 'List', icon: 'list' }] });
  const t = tabs({
    label: 'Filter', value: 'all',
    items: [{ value: 'all', label: 'All', count: 12 }, { value: 'active', label: 'Active', count: 2 }, { value: 'completed', label: 'Completed', count: 9 }, { value: 'closed', label: 'Closed', count: 1 }],
  });
  return sg('forms', 'Forms & controls', 'ui/form.js field()/passwordField(); ui/controls.js segmented()/tabs()/toggleRow(); raw classes .field .label .input .help .error-text .input-group .checkbox .switch.',
    h('div', { class: 'sg-grid-2' },
      h('div', { class: 'card card-body' },
        field({ label: 'Display name', placeholder: 'What should we call you?', help: 'Shown on your dashboard and reports.', icon: 'user' }).el,
        passwordField({ label: 'Password', placeholder: 'At least 8 characters' }).el,
        err.el,
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'sg-select' }, 'Word type'),
          h('select', { class: 'input', id: 'sg-select' }, ['Any', 'Noun', 'Verb', 'Adjective'].map((o) => h('option', null, o)))),
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'sg-dis' }, 'Disabled'), h('input', { class: 'input', id: 'sg-dis', value: 'Read only', disabled: true }))),
      h('div', { class: 'card card-body sg-stack' },
        demoRow(seg.el),
        demoRow(segSm.el),
        t.el,
        h('label', { class: 'checkbox' }, h('input', { type: 'checkbox', checked: true }), 'Keep me logged in'),
        demoRow(h('input', { class: 'switch', type: 'checkbox', role: 'switch', checked: true, 'aria-label': 'On' }),
          h('input', { class: 'switch', type: 'checkbox', role: 'switch', 'aria-label': 'Off' }),
          h('input', { class: 'switch', type: 'checkbox', role: 'switch', disabled: true, 'aria-label': 'Disabled' })),
        toggleRow({ label: 'Sound effects', description: 'Soft chimes for answers.', icon: 'volume', checked: true }).el)));
}

function chipsSection() {
  return sg('chips', 'Chips, badges & progress', '.chip (+ -hira -kata -success -danger -warning -brand -neutral, -xs/-lg, -dot), .grade-badge[data-grade], .progress > .progress-bar, .spinner, .kbd.',
    h('div', { class: 'card card-body sg-stack' },
      demoRow(
        h('span', { class: 'chip chip-hira' }, h('span', { class: 'chip-jp' }, 'ひらがな'), 'Hiragana'),
        h('span', { class: 'chip chip-kata' }, h('span', { class: 'chip-jp' }, 'カタカナ'), 'Katakana'),
        h('span', { class: 'chip chip-success chip-dot' }, 'Completed'),
        h('span', { class: 'chip chip-danger' }, icon('x', { size: 12 }), 'Wrong'),
        h('span', { class: 'chip chip-warning chip-dot' }, 'Guest'),
        h('span', { class: 'chip chip-brand' }, 'JLPT N5'),
        h('span', { class: 'chip chip-neutral' }, 'Noun'),
        h('span', { class: 'chip chip-brand chip-dot' }, 'Active'),
        h('span', { class: 'chip' }, 'Default'),
        h('span', { class: 'chip chip-neutral chip-xs' }, 'xs')),
      demoRow(['S', 'A', 'B', 'C', 'D'].map((g) => h('span', { class: 'grade-badge', dataset: { grade: g } }, g)),
        h('span', { class: 'grade-badge grade-badge-lg', dataset: { grade: 'S' } }, 'S'),
        h('span', { class: 'spinner' }), h('span', { class: 'spinner spinner-lg' })),
      h('div', { class: 'sg-progress' },
        h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: '35%' } })),
        h('div', { class: 'progress progress-success' }, h('div', { class: 'progress-bar', style: { width: '80%' } })),
        h('div', { class: 'progress progress-sm progress-hira' }, h('div', { class: 'progress-bar', style: { width: '60%' } })),
        h('div', { class: 'progress progress-sm progress-kata' }, h('div', { class: 'progress-bar', style: { width: '45%' } })),
        h('div', { class: 'progress progress-indeterminate' }, h('div', { class: 'progress-bar' })))));
}

function cardsSection() {
  const tile = (iconName, label, value, delta, dir) => h('div', { class: 'stat-tile' },
    h('span', { class: 'stat-label' }, icon(iconName, { size: 16 }), label),
    h('span', { class: 'stat-value' }, value),
    delta ? h('span', { class: ['stat-delta', dir && `is-${dir}`] }, delta) : null);
  return sg('cards', 'Cards & stat tiles', '.card .card-header .card-title .card-subtitle .card-body .card-footer, .card-interactive; .stat-tile .stat-label .stat-value .stat-delta(.is-up/.is-down).',
    h('div', { class: 'sg-stats' },
      tile('target', 'Words practised', number(1284), '+42 this week', 'up'),
      tile('check-circle', 'Accuracy', percent(0.864), '+3% vs previous 7 days', 'up'),
      tile('flame', 'Day streak', h('span', null, '12', h('small', null, 'best 21')), 'Practised today'),
      tile('clock', 'Time practised', duration(15_480_000), '−12% vs previous 7 days', 'down')),
    h('div', { class: 'sg-grid-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-header' },
          h('div', null, h('h3', { class: 'card-title' }, 'Accuracy over recent tests'), h('p', { class: 'card-subtitle' }, 'Last 20 tests')),
          h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('list', { size: 16 }), 'Table')),
        h('div', { class: 'card-body' }, h('div', { class: 'skeleton', style: { height: '120px' } }))),
      h('div', { class: 'card card-interactive' },
        h('div', { class: 'card-header' }, h('div', null, h('h3', { class: 'card-title' }, 'Mixed · All levels · 20 words'), h('p', { class: 'card-subtitle' }, `Updated ${relative(Date.now() - 7_200_000)}`))),
        h('div', { class: 'card-body sg-stack' },
          h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: '35%' } })),
          demoRow(h('span', { class: 'chip chip-brand chip-dot' }, 'Active'), h('span', { class: 'text-muted text-sm' }, '7 / 20 answered'))),
        h('div', { class: 'card-footer' }, h('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Review'), h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Resume')))));
}

function wordCardsSection() {
  return sg('word-card', 'Word card', "ui/word-card.js: renderWordCard(word, { size: 'lg'|'md'|'sm', showListen = true }); also scriptChip(script) and originText(origin).",
    h('div', { class: 'sg-word-lg' }, renderWordCard(SAMPLE_WORDS.coffee, { size: 'lg' })),
    h('div', { class: 'sg-grid-2' },
      renderWordCard(SAMPLE_WORDS.cat, { size: 'md' }),
      renderWordCard(SAMPLE_WORDS.baito, { size: 'md' })),
    h('div', { class: 'sg-grid-3' },
      renderWordCard(SAMPLE_WORDS.cat, { size: 'sm' }),
      renderWordCard(SAMPLE_WORDS.coffee, { size: 'sm' }),
      renderWordCard(SAMPLE_WORDS.baito, { size: 'sm', showListen: false })));
}

function diffSection() {
  return sg('answer-diff', 'Answer diff', "ui/answer-diff.js: renderAnswerDiff(diff, { show: 'actual'|'expected', size: 'sm'|'md'|'lg', label }). Diff ops come from QuestionResult.diff.",
    h('div', { class: 'card sg-diffs' },
      h('div', { class: 'table-wrap sg-diff-table' },
        h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Case'), h('th', null, "show: 'actual'"), h('th', null, "show: 'expected'"), h('th', null, 'size: sm'))),
          h('tbody', null, DIFFS.map(([name, note, diff]) => h('tr', null,
            h('td', null, h('div', { class: 'sg-diff-name' }, name), h('div', { class: 'text-muted text-xs jp' }, note)),
            h('td', null, renderAnswerDiff(diff, { show: 'actual' })),
            h('td', null, renderAnswerDiff(diff, { show: 'expected' })),
            h('td', null, renderAnswerDiff(diff, { show: 'actual', size: 'sm' })))))))),
    demoRow(h('span', { class: 'text-muted text-sm' }, 'size: lg'), renderAnswerDiff(DIFFS[1][2], { show: 'actual', size: 'lg' }), renderAnswerDiff(DIFFS[1][2], { show: 'expected', size: 'lg' })));
}

function overlaysSection() {
  const btn = (label, onClick, cls = 'btn-secondary') => h('button', { class: `btn ${cls}`, type: 'button', on: { click: onClick } }, label);
  const menuBtn = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Open menu', icon('chevron-down', { size: 16 }));
  attachMenu(menuBtn, [
    { heading: 'Test actions', description: 'Mixed · 20 words' },
    { label: 'Rename', icon: 'edit', onClick: () => toast('Rename clicked') },
    { label: 'Download PDF', icon: 'download', onClick: () => toast('Download clicked') },
    { divider: true },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => toast('Delete clicked', { type: 'error' }) },
  ]);
  const confettiBtn = btn('Confetti burst', () => burstFrom(confettiBtn), 'btn-success');
  return sg('overlays', 'Modals, toasts, menus & effects', 'ui/modal.js openModal/confirmDialog/promptDialog; ui/toast.js toast(); ui/menu.js attachMenu(); ui/confetti.js burst/burstFrom/celebrate; ui/sound.js play().',
    h('div', { class: 'card card-body sg-stack' },
      demoRow(
        btn('Open modal', () => openModal({
          title: 'Start a new test',
          description: 'Modals use <dialog>, trap focus, close on Esc/backdrop and restore focus.',
          body: h('p', null, 'Any DOM can go here. Actions can return a Promise to show a spinner, or false to stay open.'),
          actions: [{ label: 'Cancel' }, { label: 'Start test', variant: 'primary', onClick: () => new Promise((r) => setTimeout(r, 900)) }],
        })),
        btn('Confirm (danger)', async () => {
          const ok = await confirmDialog({ title: 'Delete this test?', message: 'This permanently removes the test and its answers.', confirmLabel: 'Delete', danger: true });
          toast(ok ? 'Confirmed' : 'Cancelled', { type: ok ? 'success' : 'info' });
        }),
        btn('Prompt', async () => {
          const v = await promptDialog({ title: 'Rename test', label: 'Title', value: 'Mixed · All levels · 20 words', confirmLabel: 'Save' });
          if (v !== null) toast(`Renamed to “${v}”`, { type: 'success' });
        }),
        menuBtn),
      demoRow(
        btn('Info toast', () => toast('Your settings were saved.')),
        btn('Success toast', () => toast('Test completed — great work!', { type: 'success' })),
        btn('Error toast', () => toast('Could not reach the server.', { type: 'error', action: { label: 'Retry', onClick: () => toast('Retrying…') } }))),
      demoRow(
        confettiBtn,
        btn('Celebrate', () => celebrate()),
        ...['correct', 'wrong', 'tap', 'hint', 'streak', 'complete'].map((s) => btn(`♪ ${s}`, () => play(s), 'btn-ghost btn-sm')))));
}

function miscSection() {
  return sg('misc', 'Table, empty state, tooltip, skeleton', '.table (in .table-wrap), .empty-state (+ -icon, -actions), [data-tip], .skeleton, .avatar.',
    h('div', { class: 'sg-grid-2' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Kana'), h('th', null, 'Script'), h('th', { class: 'num' }, 'Accuracy'))),
        h('tbody', null,
          h('tr', null, h('td', { class: 'kana' }, 'ツ'), h('td', null, 'Katakana'), h('td', { class: 'num' }, percent(0.286))),
          h('tr', null, h('td', { class: 'kana' }, 'ぬ'), h('td', null, 'Hiragana'), h('td', { class: 'num' }, percent(0.5))),
          h('tr', null, h('td', { class: 'kana' }, 'シ'), h('td', null, 'Katakana'), h('td', { class: 'num' }, percent(0.667)))))),
      h('div', { class: 'card' }, h('div', { class: 'empty-state' },
        h('div', { class: 'empty-state-icon' }, icon('sparkles', { size: 26 })),
        h('h3', null, 'Start your first test'),
        h('p', null, 'Pick a script and a difficulty — we will choose the words.'),
        h('div', { class: 'empty-state-actions' }, h('button', { class: 'btn btn-primary', type: 'button' }, icon('plus', { size: 18 }), 'New test'))))),
    demoRow(
      h('button', { class: 'btn btn-secondary', type: 'button', 'data-tip': 'Tooltip above (default)' }, 'Hover me'),
      h('button', { class: 'btn btn-secondary', type: 'button', 'data-tip': 'Tooltip below', 'data-tip-pos': 'bottom' }, 'Tooltip below'),
      h('span', { class: 'avatar' }, 'AS'), h('span', { class: 'avatar is-guest' }, icon('user', { size: 16 })),
      h('div', { class: 'skeleton', style: { width: '160px', height: '14px' } })));
}

const SECTIONS = [
  ['tokens', 'Tokens', tokensSection], ['type', 'Typography', typeSection], ['brand', 'Brand', brandSection],
  ['icons', 'Icons', iconsSection], ['buttons', 'Buttons', buttonsSection], ['forms', 'Forms', formsSection],
  ['chips', 'Chips & badges', chipsSection], ['cards', 'Cards & stats', cardsSection],
  ['word-card', 'Word card', wordCardsSection], ['answer-diff', 'Answer diff', diffSection],
  ['overlays', 'Overlays', overlaysSection], ['misc', 'Misc', miscSection],
];

export default {
  title: 'Styleguide',
  layout: 'app',
  auth: false,
  render(root, ctx) {
    const content = h('div', { class: 'sg-content' }, SECTIONS.map(([, , fn]) => fn()));
    const nav = h('nav', { class: 'sg-nav', 'aria-label': 'Styleguide sections' },
      SECTIONS.map(([id, label]) => h('button', {
        class: 'sg-nav-item', type: 'button',
        on: { click: () => content.querySelector(`#sg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      }, label)));
    const theme = segmented({
      label: 'Theme', size: 'sm', value: ctx.store.settings.theme,
      options: [{ value: 'system', label: 'System', icon: 'monitor' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }],
      onChange: (v) => ctx.store.updateSettings({ theme: v }),
    });
    const refreshValues = () => {
      const styles = getComputedStyle(document.documentElement);
      for (const el of content.querySelectorAll('.sg-swatch')) {
        el.querySelector('.sg-swatch-value').textContent = styles.getPropertyValue(el.querySelector('.sg-swatch-name').textContent).trim();
      }
    };
    const unsubscribe = ctx.store.subscribe((s) => { theme.setValue(s.settings.theme); refreshValues(); });
    root.appendChild(h('div', { class: 'container page styleguide' },
      h('header', { class: 'page-header' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'Design system'),
          h('h1', null, 'HiraKata styleguide'),
          h('p', null, 'Every token and shared component, live. Build pages from these — see notes in each section for the exact API.')),
        theme.el),
      h('div', { class: 'sg-layout' }, nav, content)));
    return unsubscribe;
  },
};
