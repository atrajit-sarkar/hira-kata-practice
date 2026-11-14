/**
 * Vocabulary page (`/vocab`, SPEC §12.6): every word the learner has practised or starred, with
 * filter tabs (counts), debounced search, script filter and sort synced to the hash query,
 * "Load more" pagination, optimistic starring and a "Practise words that need review" CTA.
 * @module pages/vocab
 */
import { debounce, h, prefersReducedMotion, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { number, plural } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { setLoading } from '../ui/form.js';
import { tabs } from '../ui/controls.js';
import { FILTERS, isNarrowed, readState, statePath } from '../vocab/query.js';
import { vocabToolbar } from '../vocab/toolbar.js';
import { wordDetail, wordTile } from '../vocab/word-tile.js';
import { emptyView, errorView, skeletonTiles } from '../vocab/states.js';

const PAGE_SIZE = 24;
/** Review tests are capped so a long backlog stays a manageable session. */
const REVIEW_TEST_MAX = 20;

/**
 * Summary under the page title.
 * @param {{all: number, learned: number, review: number}} counts
 * @returns {string}
 */
function summaryText(counts) {
  if (!counts.all) return 'Words you practise collect here with their meanings and your progress.';
  return `${plural(counts.all, 'word')} in your list · ${number(counts.learned)} learned · ${number(counts.review)} to review`;
}

/**
 * "Practise words that need review" button: creates a `review` test and opens it.
 * @param {object} ctx page context
 * @returns {{el: HTMLButtonElement, update: (reviewCount: number) => void}}
 */
function reviewCta(ctx) {
  const label = h('span', null, 'Practise words that need review');
  const badge = h('span', { class: 'vocab-cta-count' });
  const el = h('button', { class: 'btn btn-primary vocab-cta', type: 'button', disabled: true },
    icon('refresh', { size: 18 }), label, badge);
  let available = 0;
  el.addEventListener('click', async () => {
    setLoading(el, true);
    try {
      const body = { source: 'review', script: 'mixed' };
      if (available > REVIEW_TEST_MAX) body.count = REVIEW_TEST_MAX;
      const { test } = await ctx.api.tests.create(body);
      ctx.navigate(`/practice/${test.id}`);
    } catch (err) {
      setLoading(el, false);
      toast(err.message, { type: 'error' });
    }
  });
  return {
    el,
    update(n) {
      available = n;
      el.disabled = n === 0;
      badge.hidden = n === 0;
      badge.textContent = number(n);
      el.title = n ? `Start a test with ${plural(Math.min(n, REVIEW_TEST_MAX), 'word')} you missed or skipped` : 'No words need review right now';
    },
  };
}

export default {
  title: 'Vocabulary',
  layout: 'app',
  auth: true,
  async render(root, ctx) {
    const state = readState(ctx.query);
    let page = 1;
    let total = 0;
    let counts = null;
    let token = 0;
    let disposed = false;
    const pendingStars = new Set();
    const detailId = uid('vocab-detail');
    /** @type {{tile: object, panel: HTMLElement}|null} the one expanded tile and its panel */
    let open = null;

    const summary = h('p', null, 'Loading your words…');
    const cta = reviewCta(ctx);
    const filterTabs = tabs({
      label: 'Vocabulary lists',
      value: state.filter,
      // Narrow screens swap in the short label via CSS so all four tabs fit.
      items: FILTERS.map((f) => ({
        value: f.value,
        label: f.shortLabel
          ? h('span', null, h('span', { class: 'vocab-tab-long' }, f.label), h('span', { class: 'vocab-tab-short' }, f.shortLabel))
          : f.label,
      })),
      onChange: (filter) => update({ filter }),
    });
    const toolbar = vocabToolbar(state, (patch) => update(patch));
    const controls = h('section', { class: 'card vocab-controls', 'aria-label': 'Filter words' }, filterTabs.el, toolbar.el);
    const status = h('p', { class: 'vocab-status', role: 'status', 'aria-live': 'polite' });
    const grid = h('ul', { class: 'vocab-grid', role: 'list', 'aria-label': 'Words' });
    const moreBtn = h('button', { class: 'btn btn-secondary vocab-more-btn', type: 'button', on: { click: () => load({ append: true }) } },
      icon('chevron-down', { size: 18 }), 'Load more');
    const more = h('div', { class: 'vocab-more', hidden: true }, moreBtn);
    const slot = h('div', { class: 'vocab-slot' });

    root.appendChild(h('div', { class: 'container page vocab-page' },
      h('header', { class: 'page-header' },
        h('div', null, h('h1', null, 'Vocabulary'), summary),
        h('div', { class: 'page-header-actions' }, cta.el)),
      controls, status, grid, more, slot));

    function applyCounts(next) {
      counts = next;
      for (const f of FILTERS) filterTabs.setCount(f.value, counts[f.value]);
      summary.textContent = summaryText(counts);
      cta.update(counts.review);
      controls.hidden = counts.all === 0;
      cta.el.hidden = counts.all === 0;
    }

    function clearFilters() {
      update({ q: '', script: 'all' });
      toolbar.setValues(state);
    }

    function onStar(item, starred, tile) {
      const { id } = item.word;
      if (pendingStars.has(id)) return;
      pendingStars.add(id);
      tile.setStarred(starred);
      tile.el.classList.toggle('is-unstarred', state.filter === 'starred' && !starred);
      applyCounts({ ...counts, starred: Math.max(0, counts.starred + (starred ? 1 : -1)) });
      ctx.api.vocab.star(id, starred)
        .catch((err) => {
          if (disposed) return;
          tile.setStarred(!starred);
          tile.el.classList.toggle('is-unstarred', state.filter === 'starred' && starred);
          applyCounts({ ...counts, starred: Math.max(0, counts.starred + (starred ? -1 : 1)) });
          toast(err.message || 'Could not update the star. Please try again.', { type: 'error' });
        })
        .finally(() => pendingStars.delete(id));
    }

    /** Put the detail panel right after the last tile on the expanded tile's grid row. */
    function placeDetail() {
      if (!open) return;
      const { tile, panel } = open;
      const tiles = [...grid.children].filter((el) => el !== panel);
      const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
      const index = tiles.indexOf(tile.el);
      const rowEnd = tiles[Math.min(tiles.length, (Math.floor(index / columns) + 1) * columns) - 1];
      // Moving the node restarts its entrance animation, so only move when the row end changed.
      if (rowEnd && panel.previousElementSibling !== rowEnd) rowEnd.after(panel);
    }

    function closeDetail({ focus = false } = {}) {
      if (!open) return;
      open.panel.remove();
      open.tile.setOpen(false);
      if (focus) open.tile.main.focus();
      open = null;
    }

    // Escape closes the detail from inside it or from the expanded tile that opened it
    // (focus stays on the tile after a click or Enter).
    grid.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !open || !(open.panel.contains(e.target) || open.tile.el.contains(e.target))) return;
      e.stopPropagation();
      closeDetail({ focus: true });
    });

    function toggleDetail(tile) {
      const same = open?.tile === tile;
      closeDetail();
      if (same) return;
      const panel = wordDetail(tile.item, { id: detailId, onClose: () => closeDetail({ focus: true }) });
      open = { tile, panel };
      tile.setOpen(true);
      placeDetail();
      panel.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    const onResize = debounce(placeDetail, 120);
    window.addEventListener('resize', onResize);

    function renderStatus(shown) {
      if (!total) { status.textContent = ''; return; }
      const of = shown < total ? `Showing ${number(shown)} of ${number(total)} words` : `${plural(total, 'word')}`;
      status.textContent = state.q ? `${of} matching “${state.q}”` : of;
    }

    async function load({ append = false } = {}) {
      const mine = ++token;
      const nextPage = append ? page + 1 : 1;
      if (append) setLoading(moreBtn, true);
      else {
        closeDetail();
        slot.replaceChildren();
        more.hidden = true;
        grid.hidden = false;
        grid.setAttribute('aria-busy', 'true');
        grid.replaceChildren(...skeletonTiles(counts ? Math.min(8, Math.max(4, counts.all)) : 8));
      }
      let data;
      try {
        data = await ctx.api.vocab.list({ ...state, page: nextPage, pageSize: PAGE_SIZE });
      } catch (err) {
        if (disposed || mine !== token) return;
        if (append) {
          setLoading(moreBtn, false);
          toast(err.message, { type: 'error' });
          return;
        }
        grid.replaceChildren();
        grid.hidden = true;
        grid.removeAttribute('aria-busy');
        status.textContent = '';
        slot.replaceChildren(errorView(err.message, () => load()));
        return;
      }
      if (disposed || mine !== token) return;

      page = data.page;
      total = data.total;
      applyCounts(data.counts);
      const tiles = data.items.map((item) => wordTile(item, { detailId, onStar, onToggle: toggleDetail }).el);
      if (append) {
        setLoading(moreBtn, false);
        grid.append(...tiles);
        placeDetail();
      } else {
        grid.removeAttribute('aria-busy');
        grid.replaceChildren(...tiles);
      }
      const shown = grid.querySelectorAll('.vocab-tile:not(.is-skeleton)').length;
      more.hidden = shown >= total;
      grid.hidden = total === 0;
      renderStatus(shown);
      if (total === 0) {
        let kind = 'no-match';
        if (data.counts.all === 0) kind = 'first';
        else if (data.counts[state.filter] === 0 || !isNarrowed(state)) kind = 'tab';
        slot.replaceChildren(emptyView({ kind, filter: state.filter, onClear: clearFilters }));
      }
    }

    function update(patch) {
      const changed = Object.entries(patch).some(([k, v]) => state[k] !== v);
      if (!changed) return;
      Object.assign(state, patch);
      ctx.navigate(statePath(state), { replace: true, silent: true });
      load();
    }

    await load();
    return () => {
      disposed = true;
      toolbar.cancel();
      onResize.cancel();
      window.removeEventListener('resize', onResize);
    };
  },
};
