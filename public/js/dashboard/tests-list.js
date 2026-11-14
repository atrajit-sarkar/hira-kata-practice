/**
 * The dashboard's Tests list: filter tabs (All / Active / Completed / Closed), one row per test
 * with config chips, status, progress, score and actions (Resume/Review, PDF, Rename, Delete).
 * Rename and delete update the list in place; delete is optimistic and rolls back on failure.
 * @module dashboard/tests-list
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { percent, relative, date, plural } from '../ui/format.js';
import { tabs } from '../ui/controls.js';
import { attachMenu } from '../ui/menu.js';
import { confirmDialog, promptDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { api } from '../api.js';
import { modeChip, modeOf } from '../results/practice-meta.js';

const PAGE_SIZE = 8;
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
];
const STATUS = {
  active: { label: 'In progress', chip: 'chip-brand' },
  completed: { label: 'Completed', chip: 'chip-success' },
  closed: { label: 'Ended early', chip: 'chip-neutral' },
};
const SCRIPT_CHIP = {
  hiragana: { label: 'Hiragana', chip: 'chip-hira' },
  katakana: { label: 'Katakana', chip: 'chip-kata' },
  mixed: { label: 'Mixed', chip: 'chip-neutral' },
};
const LEVELS = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced' };
const POS = { noun: 'Nouns', verb: 'Verbs', adjective: 'Adjectives', adverb: 'Adverbs', expression: 'Expressions' };
const SOURCE = { review: 'Review', 'test-mistakes': 'Retry' };

/**
 * PDF report link for a test, carrying the browser's time-zone offset so the report's dates,
 * times and file name are local (the server falls back to UTC without it).
 * @param {number} id test id
 * @returns {string}
 */
export function reportHref(id) {
  return `${api.tests.reportUrl(id)}?tz=${new Date().getTimezoneOffset()}`;
}

/**
 * Where a test opens: practice while active, results otherwise.
 * @param {{id: number, status: string}} test TestSummary
 * @returns {string} router path
 */
export function testPath(test) {
  return test.status === 'active' ? `/practice/${test.id}` : `/results/${test.id}`;
}

/**
 * Compact chips describing a test's configuration (script, mode, pool, source, level, word type,
 * JLPT, size). The coloured script chip and the practice-mode chip are always shown; other chips
 * are dropped when the title already says the same thing (default titles such as "Hiragana · Beginner · 20 words" spell out the config).
 * @param {object} test TestSummary
 * @returns {HTMLElement[]}
 */
export function configChips(test) {
  const title = String(test.title || '').toLowerCase();
  return allConfigChips(test).filter((el, i) => i < 2 || !title.includes(el.textContent.toLowerCase()));
}

function allConfigChips(test) {
  const c = test.config || {};
  const chip = (cls, text) => h('span', { class: ['chip', 'chip-xs', cls] }, text);
  const script = SCRIPT_CHIP[c.script] || SCRIPT_CHIP.mixed;
  return [
    chip(script.chip, script.label),
    modeChip(modeOf(c)),
    c.pool === 'common' && !SOURCE[c.source] ? chip('chip-neutral', 'Common') : null,
    SOURCE[c.source] ? chip('chip-neutral', SOURCE[c.source]) : null,
    LEVELS[c.level] && !SOURCE[c.source] ? chip('chip-neutral', LEVELS[c.level]) : null,
    POS[c.pos] && !SOURCE[c.source] ? chip('chip-neutral', POS[c.pos]) : null,
    c.jlpt && c.jlpt !== 'any' && !SOURCE[c.source] ? chip('chip-neutral', `JLPT N${c.jlpt}`) : null,
    chip('chip-neutral', plural(test.totalQuestions, 'word')),
  ].filter(Boolean);
}

/**
 * Status chip for a test.
 * @param {'active'|'completed'|'closed'} status
 * @returns {HTMLElement}
 */
export function statusChip(status) {
  const s = STATUS[status] || STATUS.closed;
  return h('span', { class: ['chip', 'chip-xs', 'chip-dot', s.chip] }, s.label);
}

/**
 * Create the tests list section.
 * @param {{navigate: (path: string) => void, onNewTest: () => void, onMutate?: () => void}} opts
 *   onMutate runs after a rename or delete succeeds (e.g. to refresh dashboard statistics).
 * @returns {{el: HTMLElement, setTests: (tests: object[]) => void, destroy: () => void}}
 */
export function testsList({ navigate, onNewTest, onMutate }) {
  let tests = [];
  let filter = 'all';
  let limit = PAGE_SIZE;
  const menus = new Set();

  const filterTabs = tabs({
    label: 'Filter tests',
    value: filter,
    items: FILTERS,
    className: 'dash-tests-tabs',
    onChange: (v) => { filter = v; limit = PAGE_SIZE; draw(); },
  });
  const body = h('div', { class: 'dash-tests-body', role: 'tabpanel' });
  const el = h('section', { class: 'dash-tests', 'aria-labelledby': 'dash-tests-title' },
    h('div', { class: 'dash-section-head' },
      h('div', null,
        h('h2', { id: 'dash-tests-title' }, 'Your tests'),
        h('p', null, 'Resume active tests, review finished ones or download a PDF report.')),
      filterTabs.el),
    body);

  const visible = () => (filter === 'all' ? tests : tests.filter((t) => t.status === filter));

  function destroyMenus() {
    for (const m of menus) m.destroy();
    menus.clear();
  }

  function emptyFor(kind) {
    const copy = {
      all: ['No tests yet', 'Start a test and it will be listed here.'],
      active: ['No tests in progress', 'Every test you start stays here until you finish or end it.'],
      completed: ['No completed tests', 'Finish every word in a test to see it here.'],
      closed: ['No tests ended early', 'Tests you end before the last word appear here.'],
    }[kind];
    return h('div', { class: 'empty-state dash-tests-empty' },
      h('div', { class: 'empty-state-icon' }, icon('list', { size: 24 })),
      h('h3', null, copy[0]),
      h('p', null, copy[1]),
      kind === 'all' || kind === 'active'
        ? h('div', { class: 'empty-state-actions' },
          h('button', { class: 'btn btn-primary', type: 'button', on: { click: onNewTest } }, icon('plus', { size: 18 }), 'New test'))
        : null);
  }

  function row(test) {
    const answered = test.answeredCount;
    const progress = test.totalQuestions ? answered / test.totalQuestions : 0;
    const open = () => navigate(testPath(test));
    const primary = test.status === 'active'
      ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: open } }, icon('play', { size: 16 }), 'Resume')
      : h('button', { class: 'btn btn-secondary btn-sm', type: 'button', on: { click: open } }, 'Review');
    const more = h('button', {
      class: 'btn btn-ghost btn-sm btn-icon', type: 'button', 'aria-label': `More actions for ${test.title}`,
    }, icon('more', { size: 18 }));
    menus.add(attachMenu(more, [
      { label: 'Rename', icon: 'edit', onClick: () => rename(test) },
      { label: 'Download PDF', icon: 'download', href: reportHref(test.id), download: '' },
      { divider: true },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(test) },
    ], { label: `Actions for ${test.title}` }));

    return h('li', { class: ['dash-test', `is-${test.status}`], dataset: { id: test.id } },
      h('div', { class: 'dash-test-main' },
        h('div', { class: 'dash-test-title-row' },
          h('a', { class: 'dash-test-title', href: `#${testPath(test)}` }, test.title),
          statusChip(test.status)),
        h('div', { class: 'dash-test-chips' }, configChips(test))),
      h('div', { class: 'dash-test-progress' },
        h('div', {
          class: ['progress', 'progress-sm', test.status === 'completed' && 'progress-success'],
          role: 'progressbar',
          'aria-label': 'Answered',
          'aria-valuemin': 0,
          'aria-valuemax': test.totalQuestions,
          'aria-valuenow': answered,
        }, h('div', { class: 'progress-bar', style: { width: `${progress * 100}%` } })),
        h('span', { class: 'dash-test-count' }, `${answered} / ${test.totalQuestions}`)),
      h('div', { class: 'dash-test-score' },
        test.grade
          ? h('span', { class: 'grade-badge', dataset: { grade: test.grade }, 'aria-label': `Grade ${test.grade}` }, test.grade)
          : h('span', { class: 'grade-badge dash-grade-none', 'aria-label': 'No grade yet' }, '–'),
        h('div', { class: 'dash-test-figures' },
          h('span', { class: 'dash-test-figure' }, answered ? percent(test.scorePercent) : '—', h('small', null, ' score')),
          h('span', { class: 'dash-test-figure is-sub' }, answered ? percent(test.accuracy) : '—', h('small', null, ' accuracy')))),
      h('time', { class: 'dash-test-date', dateTime: test.updatedAt, title: date(test.updatedAt, { time: true }) }, relative(test.updatedAt)),
      h('div', { class: 'dash-test-actions' },
        primary,
        h('a', {
          class: 'btn btn-ghost btn-sm btn-icon dash-test-pdf',
          href: reportHref(test.id),
          download: '',
          'aria-label': `Download PDF report for ${test.title}`,
          'data-tip': 'Download PDF',
        }, icon('download', { size: 18 })),
        more));
  }

  function draw() {
    destroyMenus();
    const list = visible();
    filterTabs.setValue(filter);
    for (const f of FILTERS) filterTabs.setCount(f.value, f.value === 'all' ? tests.length : tests.filter((t) => t.status === f.value).length);
    body.setAttribute('aria-labelledby', filterTabs.tabId(filter));
    if (!list.length) {
      body.replaceChildren(h('div', { class: 'card' }, emptyFor(filter)));
      return;
    }
    const shown = list.slice(0, limit);
    const moreCount = list.length - shown.length;
    const listEl = h('ul', { class: 'card dash-test-list' }, shown.map(row));
    // replaceChildren() would turn a null argument into a literal "null" text node.
    if (moreCount <= 0) {
      body.replaceChildren(listEl);
      return;
    }
    body.replaceChildren(listEl, h('div', { class: 'dash-tests-more' }, h('button', {
      class: 'btn btn-secondary', type: 'button',
      on: { click: () => { limit += PAGE_SIZE * 2; draw(); } },
    }, `Show ${Math.min(moreCount, PAGE_SIZE * 2)} more`, h('span', { class: 'text-muted' }, ` of ${moreCount}`))));
  }

  async function rename(test) {
    let updated = null;
    const title = await promptDialog({
      title: 'Rename test',
      label: 'Title',
      value: test.title,
      confirmLabel: 'Save',
      validate: async (raw) => {
        const v = raw.trim();
        if (!v) return 'Enter a title.';
        if (v.length > 80) return 'Keep the title to 80 characters or fewer.';
        if (v === test.title) return null;
        try {
          updated = (await api.tests.rename(test.id, v)).test;
          return null;
        } catch (err) {
          return err.fields?.title || err.message;
        }
      },
    });
    if (title === null || !updated) return;
    tests = tests.map((t) => (t.id === updated.id ? updated : t));
    draw();
    toast('Test renamed.', { type: 'success' });
    onMutate?.();
  }

  async function remove(test) {
    const ok = await confirmDialog({
      title: 'Delete this test?',
      message: `“${test.title}” and its answers will be removed from your history. This can’t be undone.`,
      confirmLabel: 'Delete test',
      danger: true,
    });
    if (!ok) return;
    const before = tests;
    tests = tests.filter((t) => t.id !== test.id);
    draw();
    try {
      await api.tests.remove(test.id);
      toast('Test deleted.', { type: 'success' });
      onMutate?.();
    } catch (err) {
      if (err.status === 404) { onMutate?.(); return; }
      tests = before;
      draw();
      toast(err.message || 'Could not delete the test.', { type: 'error' });
    }
  }

  return {
    el,
    setTests(next) { tests = next.slice(); draw(); },
    destroy: destroyMenus,
  };
}
