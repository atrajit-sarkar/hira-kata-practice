/**
 * Vocabulary toolbar: debounced search, script filter and sort.
 * @module vocab/toolbar
 */
import { debounce, h, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { segmented } from '../ui/controls.js';
import { MAX_QUERY_LENGTH, SCRIPTS, SORTS } from './query.js';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Build the toolbar.
 * @param {{script: string, sort: string, q: string}} state initial values
 * @param {(patch: {q?: string, script?: string, sort?: string}) => void} onChange
 * @returns {{el: HTMLElement, setValues: (s: {q: string, script: string, sort: string}) => void,
 *   cancel: () => void}} cancel drops a pending debounced search (call on page cleanup)
 */
export function vocabToolbar(state, onChange) {
  const searchId = uid('vocab-search');
  const sortId = uid('vocab-sort');

  const input = h('input', {
    class: 'input',
    id: searchId,
    type: 'search',
    value: state.q,
    placeholder: 'Search words or meanings',
    autocomplete: 'off',
    spellcheck: false,
    maxLength: MAX_QUERY_LENGTH,
    attrs: { enterkeyhint: 'search', autocapitalize: 'off' },
  });
  const clearBtn = h('button', {
    class: 'btn btn-ghost btn-icon btn-sm input-action',
    type: 'button',
    'aria-label': 'Clear search',
    hidden: !state.q,
  }, icon('x', { size: 16 }));

  const emitSearch = debounce(() => onChange({ q: input.value.trim() }), SEARCH_DEBOUNCE_MS);
  const clearSearch = () => {
    emitSearch.cancel();
    input.value = '';
    clearBtn.hidden = true;
    onChange({ q: '' });
  };
  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    emitSearch();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      clearSearch();
    } else if (e.key === 'Enter') {
      emitSearch.flush();
    }
  });
  clearBtn.addEventListener('click', () => {
    clearSearch();
    input.focus();
  });

  const script = segmented({
    label: 'Script',
    size: 'sm',
    value: state.script,
    options: SCRIPTS.map((s) => ({
      value: s.value,
      label: s.jp ? h('span', { class: 'vocab-script-opt' }, h('span', { class: 'jp', lang: 'ja', 'aria-hidden': 'true' }, s.jp), s.label) : s.label,
      ariaLabel: s.label,
    })),
    onChange: (v) => onChange({ script: v }),
  });

  const sort = h('select', { class: 'input vocab-sort-select', id: sortId },
    SORTS.map((s) => h('option', { value: s.value, selected: s.value === state.sort }, s.label)));
  sort.addEventListener('change', () => onChange({ sort: sort.value }));

  const el = h('div', { class: 'vocab-toolbar', role: 'search' },
    h('label', { class: 'visually-hidden', for: searchId }, 'Search your vocabulary by kana, romaji, kanji or meaning'),
    h('div', { class: 'input-group vocab-search' }, icon('search', { size: 18, className: 'input-icon' }), input, clearBtn),
    h('div', { class: 'vocab-toolbar-filters' },
      script.el,
      h('div', { class: 'vocab-sort' },
        h('label', { class: 'vocab-sort-label', for: sortId }, icon('filter', { size: 16 }), h('span', null, 'Sort')),
        sort)));

  return {
    el,
    setValues(s) {
      if (document.activeElement !== input) input.value = s.q;
      clearBtn.hidden = !input.value;
      script.setValue(s.script);
      sort.value = s.sort;
    },
    cancel: () => emitSearch.cancel(),
  };
}
