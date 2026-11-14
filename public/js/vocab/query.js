/**
 * Vocabulary page state <-> hash query (`#/vocab?filter=review&script=katakana&sort=alpha&q=neko`).
 * Defaults are omitted from the URL so a plain `#/vocab` stays clean.
 * @module vocab/query
 */

/** Filter tabs, in display order (values match `GET /api/vocab?filter=`). */
export const FILTERS = Object.freeze([
  { value: 'all', label: 'All' },
  { value: 'learned', label: 'Learned' },
  { value: 'review', label: 'Needs review', shortLabel: 'Review' },
  { value: 'starred', label: 'Starred' },
]);

/** Script filter options. */
export const SCRIPTS = Object.freeze([
  { value: 'all', label: 'All' },
  { value: 'hiragana', label: 'Hiragana', jp: 'あ' },
  { value: 'katakana', label: 'Katakana', jp: 'ア' },
]);

/** Sort options (values match `GET /api/vocab?sort=`). */
export const SORTS = Object.freeze([
  { value: 'recent', label: 'Recently practised' },
  { value: 'mistakes', label: 'Most missed' },
  { value: 'alpha', label: 'Kana order (あ–ん)' },
]);

/** Maximum search length sent to the server. */
export const MAX_QUERY_LENGTH = 64;

const DEFAULTS = Object.freeze({ filter: 'all', script: 'all', sort: 'recent', q: '' });

const pick = (options, value, fallback) => (options.some((o) => o.value === value) ? value : fallback);

/**
 * Read a valid page state from the router query, falling back to defaults for unknown values.
 * @param {Record<string, string>} query ctx.query
 * @returns {{filter: string, script: string, sort: string, q: string}}
 */
export function readState(query = {}) {
  return {
    filter: pick(FILTERS, query.filter, DEFAULTS.filter),
    script: pick(SCRIPTS, query.script, DEFAULTS.script),
    sort: pick(SORTS, query.sort, DEFAULTS.sort),
    q: String(query.q ?? '').trim().slice(0, MAX_QUERY_LENGTH),
  };
}

/**
 * Build the route path for a state, omitting default values.
 * @param {{filter: string, script: string, sort: string, q: string}} state
 * @returns {string} e.g. "/vocab?filter=review&q=neko"
 */
export function statePath(state) {
  const params = new URLSearchParams();
  for (const key of ['filter', 'script', 'sort', 'q']) {
    const value = key === 'q' ? state.q.trim() : state[key];
    if (value && value !== DEFAULTS[key]) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/vocab?${qs}` : '/vocab';
}

/**
 * Whether search or the script filter narrows the current tab (used for the "no matches" state).
 * @param {{script: string, q: string}} state
 * @returns {boolean}
 */
export function isNarrowed(state) {
  return Boolean(state.q.trim()) || state.script !== DEFAULTS.script;
}
