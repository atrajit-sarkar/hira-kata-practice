/**
 * Handwriting pad (SPEC §15.5): a paper-like square with a faint four-square guide where the
 * learner writes one kana at a time with a mouse, finger or pen. About 650 ms after the last
 * stroke the drawing is recognised and the best candidate is committed via `onCommit`; the other
 * candidates appear as chips that replace the last committed character (hidden in strict mode).
 * Tools: Undo stroke, Clear, 小 (small kana) and ⌫.
 *
 * Keyboard-free by design: the pad never focuses an input, its canvas and buttons prevent the
 * focus change on press, so the device keyboard never opens because of it.
 *
 * @module handwriting/pad
 */
import { h, svg } from '../ui/dom.js';
import { applyModifier, kanaKeyLabel } from '/shared/kana.js';
import { loadRecognizer } from './recognizer.js';

/** Delay between the last pen-up and recognition. */
export const RECOGNIZE_DELAY_MS = 650;
/** Below this similarity the drawing is not committed ("couldn't read that"). */
const MIN_SCORE = 0.15;
const TOP_N = 5;
const FADE_MS = 420;
/** Ignore pointer moves closer than this to the previous point (CSS px). */
const MIN_STEP = 0.75;
/** Input smoothing: each new point moves this far from the previous one towards the pointer. */
const SMOOTHING = 0.6;

/** Small inline icons in the same style as ui/icons.js. */
function toolIcon(paths) {
  return svg('svg', {
    class: 'hw-tool-icon', viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, ...paths.map((d) => svg('path', { d })));
}
const ICONS = {
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  clear: ['m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21', 'M22 21H7', 'm5 11 9 9'],
  backspace: ['M10 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10l-7-7z', 'm17.5 9.5-5 5', 'm12.5 9.5 5 5'],
};

/** The four-square guide (inline SVG so the dashes stay crisp at any size). */
function guide() {
  return svg('svg', { class: 'hw-guide', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    svg('line', { x1: 50, y1: 0, x2: 50, y2: 100 }),
    svg('line', { x1: 0, y1: 50, x2: 100, y2: 50 }));
}

/** Prevent the default press behaviour so taps never move focus (and never open a keyboard). */
const keepFocus = (e) => e.preventDefault();

/**
 * Create a handwriting pad.
 * @param {object} options
 * @param {(char: string) => void} options.onCommit called with each recognised character
 * @param {() => void} options.onBackspace called to delete the last answer character
 * @param {() => ('hiragana'|'katakana'|null)} [options.getScript] script hint, asked at recognition time
 * @param {boolean} [options.strict=false] strict mode: no correction chips
 * @param {(candidates: Array<{char:string,score:number,confidence:number}>) => void} [options.onRecognize]
 *   optional observer, called after each recognition (empty array when unreadable)
 * @param {string} [options.dataUrl] stroke data URL (default '/data/kana-strokes.json')
 * @returns {{ el: HTMLElement, clear(): void, destroy(): void, setStrict(strict: boolean): void,
 *   setScriptHint(script: 'hiragana'|'katakana'|null): void, recognizeNow(): void }}
 */
export function createHandwritingPad({
  onCommit, onBackspace, getScript, strict = false, onRecognize, dataUrl,
} = {}) {
  /** Strokes in paper-relative units (0…1 across the square). */
  let strokes = [];
  let active = null; // { id, stroke }
  let timer = 0;
  let raf = 0;
  let scriptHint; // undefined = ask getScript()
  let smallArmed = false;
  /** The last commit, while it can still be corrected: { chars, index, small }. */
  let last = null;
  let recognizer = null;
  let loadError = null;
  let destroyed = false;
  let size = 0;
  let dpr = 1;

  const ink = h('canvas', { class: 'hw-ink', role: 'img', 'aria-label': 'Writing area: draw one kana with your mouse, finger or pen. It is read automatically.' });
  const fade = h('canvas', { class: 'hw-fade', 'aria-hidden': 'true' });
  const ghost = h('div', { class: 'hw-ghost kana', lang: 'ja', 'aria-hidden': 'true' });
  const hint = h('div', { class: 'hw-hint', 'aria-hidden': 'true' }, 'Write one kana');
  const progress = h('div', { class: 'hw-progress', 'aria-hidden': 'true' }, h('span'));
  const notice = h('div', { class: 'hw-notice', role: 'status' });
  const paper = h('div', { class: 'hw-paper' }, guide(), fade, ink, ghost, hint, progress, notice);
  const live = h('div', { class: 'visually-hidden', 'aria-live': 'polite' });
  const candList = h('div', { class: 'hw-cands', role: 'group', 'aria-label': 'Other readings of your last character' });
  const candRow = h('div', { class: 'hw-cand-row' }, h('span', { class: 'hw-cand-label' }, 'Not right? Pick what you wrote'), candList);
  const tip = h('p', { class: 'hw-tip' });
  const setTip = () => {
    tip.textContent = strict
      ? 'Strict mode: each character is entered exactly as it is read. Write one kana at a time.'
      : 'Write one kana at a time. It is read as soon as you pause.';
  };
  setTip();

  const tool = (cls, label, face, onClick, title = label) => h('button', {
    type: 'button', class: `hw-tool ${cls}`, 'aria-label': label, title,
    on: { mousedown: keepFocus, click: onClick },
  }, face);
  const undoBtn = tool('hw-undo', 'Undo last stroke', [toolIcon(ICONS.undo), h('span', { class: 'hw-tool-text' }, 'Undo')], undoStroke);
  const clearBtn = tool('hw-clear', 'Clear the writing area', [toolIcon(ICONS.clear), h('span', { class: 'hw-tool-text' }, 'Clear')], () => clearInk(true));
  const smallBtn = tool('hw-small', 'Small kana: make the character small or full size', h('span', { class: 'kana', lang: 'ja' }, '小'), toggleSmall, 'Small kana (や → ゃ)');
  const backBtn = tool('hw-back', 'Delete the last character of your answer', toolIcon(ICONS.backspace), backspace, 'Delete last character');
  smallBtn.setAttribute('aria-pressed', 'false');

  const el = h('div', {
    class: ['hw', { 'is-strict': strict }], role: 'group', 'aria-label': 'Handwriting pad', dataset: { state: 'loading' },
  },
  h('div', { class: 'hw-body' },
    paper,
    h('div', { class: 'hw-side' }, tip, candRow, h('div', { class: 'hw-tools' },
      h('div', { class: 'hw-tools-group' }, undoBtn, clearBtn), h('div', { class: 'hw-tools-group' }, smallBtn, backBtn)))),
  live);

  /* ---------------------------------------------------------------- rendering */

  function inkColor() {
    return getComputedStyle(el).getPropertyValue('--hw-ink').trim() || '#1b1a17';
  }

  function resize() {
    const next = ink.clientWidth; // the canvas, inside the paper's border
    const nextDpr = Math.min(3, window.devicePixelRatio || 1);
    if (!next || (next === size && nextDpr === dpr)) return;
    size = next; dpr = nextDpr;
    for (const c of [ink, fade]) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
    }
    render();
  }

  /** Draw strokes as smooth quadratic curves through the midpoints of the sampled points. */
  function drawStrokes(ctx, list) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = inkColor();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = Math.max(3.5, size * 0.028);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of list) {
      const pts = s.map(([x, y]) => [x * size, y * size]);
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const [x, y] = pts[i];
        const [nx, ny] = pts[i + 1];
        ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
      }
      const end = pts[pts.length - 1];
      ctx.lineTo(end[0], end[1]);
      ctx.stroke();
    }
  }

  function render() {
    raf = 0;
    if (!size || destroyed) return;
    drawStrokes(ink.getContext('2d'), strokes);
    el.classList.toggle('has-ink', strokes.length > 0);
    undoBtn.disabled = strokes.length === 0;
    clearBtn.disabled = strokes.length === 0;
  }

  const scheduleRender = () => { if (!raf) raf = requestAnimationFrame(render); };

  /* ---------------------------------------------------------------- pointer input */

  function pointFrom(e) {
    const rect = ink.getBoundingClientRect();
    const w = rect.width || 1;
    return [(e.clientX - rect.left) / w, (e.clientY - rect.top) / w];
  }

  function onPointerDown(e) {
    if (active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); // no focus change, no text selection, no emulated mouse events
    try { ink.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
    cancelTimer();
    if (last) settleLast();
    showNotice('');
    const stroke = [pointFrom(e)];
    strokes.push(stroke);
    active = { id: e.pointerId, stroke };
    el.classList.add('is-drawing');
    scheduleRender();
  }

  function onPointerMove(e) {
    if (!active || e.pointerId !== active.id) return;
    e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const raw = pointFrom(ev);
      const prev = active.stroke[active.stroke.length - 1];
      const p = [prev[0] + (raw[0] - prev[0]) * SMOOTHING, prev[1] + (raw[1] - prev[1]) * SMOOTHING];
      if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) * size >= MIN_STEP) active.stroke.push(p);
    }
    scheduleRender();
  }

  function onPointerUp(e) {
    if (!active || e.pointerId !== active.id) return;
    if (e.type === 'pointerup') {
      const p = pointFrom(e);
      const prev = active.stroke[active.stroke.length - 1];
      if (p[0] !== prev[0] || p[1] !== prev[1]) active.stroke.push(p);
    }
    active = null;
    el.classList.remove('is-drawing');
    scheduleRender();
    startTimer();
  }

  ink.addEventListener('pointerdown', onPointerDown);
  ink.addEventListener('pointermove', onPointerMove);
  ink.addEventListener('pointerup', onPointerUp);
  ink.addEventListener('pointercancel', onPointerUp);
  ink.addEventListener('contextmenu', keepFocus);
  ghost.addEventListener('animationend', () => ghost.classList.remove('is-showing'));
  fade.addEventListener('animationend', () => fade.classList.remove('is-fading'));
  paper.addEventListener('animationend', (e) => { if (e.target === paper) paper.classList.remove('is-rejected'); });
  paper.addEventListener('mousedown', keepFocus);

  /* ---------------------------------------------------------------- recognition */

  function startTimer() {
    cancelTimer();
    if (!strokes.length) return;
    el.dataset.pending = 'true';
    // Restart the countdown bar animation.
    progress.classList.remove('is-running');
    void progress.offsetWidth;
    progress.classList.add('is-running');
    timer = setTimeout(recognizeNow, RECOGNIZE_DELAY_MS);
  }

  function cancelTimer() {
    clearTimeout(timer);
    timer = 0;
    delete el.dataset.pending;
    progress.classList.remove('is-running');
  }

  const currentScript = () => (scriptHint !== undefined && scriptHint !== null ? scriptHint : (getScript?.() ?? null));

  function recognizeNow() {
    cancelTimer();
    if (destroyed || active || !strokes.length) return;
    if (!recognizer) {
      if (loadError) showNotice('Handwriting engine unavailable. Check your connection and try again.', 'error');
      else { el.dataset.pending = 'true'; ready.then(() => recognizeNow()); }
      return;
    }
    const script = currentScript();
    const cands = recognizer.recognize(strokes, { script, topN: TOP_N });
    onRecognize?.(cands.filter((c) => c.score >= MIN_SCORE));
    if (!cands.length || cands[0].score < MIN_SCORE) {
      showNotice('Couldn’t read that. Try again.', 'error');
      paper.classList.remove('is-rejected');
      void paper.offsetWidth;
      paper.classList.add('is-rejected');
      return;
    }
    const small = smallArmed;
    setSmallArmed(false);
    last = { chars: cands.map((c) => c.char), index: 0, small };
    const ch = shown(last.chars[0], small);
    flash(ch);
    clearInk(false, true);
    onCommit?.(ch);
    announce(ch);
    renderCandidates();
  }

  /** The candidate as it is entered: its small form when 小 is active (if it has one). */
  const shown = (ch, small) => (small ? applyModifier(ch, 'small') ?? ch : ch);

  function announce(ch) {
    const label = kanaKeyLabel(ch);
    live.textContent = `Wrote ${ch}${label ? ` (${label})` : ''}.`;
  }

  /** Big glyph of the recognised character, fading out over the paper. */
  function flash(ch) {
    ghost.textContent = ch;
    ghost.classList.remove('is-showing');
    void ghost.offsetWidth;
    ghost.classList.add('is-showing');
  }

  /**
   * Clear the ink. `animate` cross-fades the old ink out (after a recognition); `user` marks a
   * Clear button press, which also forgets the last commit's chips.
   */
  function clearInk(user = false, animate = false) {
    cancelTimer();
    if (animate && size) {
      const ctx = fade.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, fade.width, fade.height);
      ctx.drawImage(ink, 0, 0);
      fade.classList.remove('is-fading');
      void fade.offsetWidth;
      fade.classList.add('is-fading');
    }
    strokes = [];
    active = null;
    el.classList.remove('is-drawing');
    if (user) { showNotice(''); setSmallArmed(false); }
    render();
  }

  function undoStroke() {
    if (!strokes.length) return;
    strokes.pop();
    showNotice('');
    render();
    if (strokes.length) startTimer(); else cancelTimer();
  }

  /** Chips may only correct the very last commit; forget them once something else happens. */
  function settleLast() {
    last = null;
    renderCandidates();
  }

  function renderCandidates() {
    candList.replaceChildren();
    const show = !strict && last && last.chars.length > 1;
    el.classList.toggle('has-cands', Boolean(show));
    if (!show) return;
    last.chars.forEach((c, i) => {
      const ch = shown(c, last.small);
      const label = kanaKeyLabel(ch);
      candList.append(h('button', {
        type: 'button',
        class: 'hw-cand kana',
        lang: 'ja',
        'aria-pressed': String(i === last.index),
        'aria-label': i === last.index ? `${ch}${label ? ` (${label})` : ''}, entered` : `Use ${ch}${label ? ` (${label})` : ''} instead`,
        style: { '--i': i },
        on: { mousedown: keepFocus, click: () => pickCandidate(i) },
      }, ch));
    });
  }

  function pickCandidate(i) {
    if (!last || i === last.index) return;
    last.index = i;
    const ch = shown(last.chars[i], last.small);
    onBackspace?.();
    onCommit?.(ch);
    announce(ch);
    renderCandidates();
  }

  /* ---------------------------------------------------------------- tools */

  function setSmallArmed(on) {
    smallArmed = on;
    smallBtn.setAttribute('aria-pressed', String(on));
    smallBtn.classList.toggle('is-on', on);
  }

  function reject(btn) {
    btn.classList.remove('is-rejected');
    void btn.offsetWidth;
    btn.classList.add('is-rejected');
  }

  /**
   * 小: with ink on the paper it marks the coming character as small; right after a commit it
   * toggles that character between its small and full-size forms; otherwise it arms the next one.
   */
  function toggleSmall() {
    if (!strokes.length && last) {
      const current = shown(last.chars[last.index], last.small);
      const next = shown(last.chars[last.index], !last.small);
      if (next === current) { reject(smallBtn); live.textContent = `${current} has no small form.`; return; }
      last.small = !last.small;
      onBackspace?.();
      onCommit?.(next);
      announce(next);
      renderCandidates();
      return;
    }
    setSmallArmed(!smallArmed);
    live.textContent = smallArmed ? 'The next character will be small.' : 'Small kana off.';
  }

  function backspace() {
    onBackspace?.();
    settleLast();
  }

  let noticeAction = null;
  function showNotice(text, tone = 'info', action = null) {
    notice.replaceChildren();
    if (text) notice.append(h('span', null, text));
    if (action) notice.append(h('button', { type: 'button', class: 'hw-notice-btn', on: { mousedown: keepFocus, click: action.run } }, action.label));
    noticeAction = action;
    notice.dataset.tone = tone;
    notice.classList.toggle('is-visible', Boolean(text));
  }

  /* ---------------------------------------------------------------- engine loading */

  let ready;
  function load() {
    loadError = null;
    el.dataset.state = 'loading';
    ready = loadRecognizer(dataUrl).then((r) => {
      recognizer = r;
      if (destroyed) return;
      el.dataset.state = 'ready';
      if (noticeAction) showNotice('');
    }, (err) => {
      loadError = err;
      if (destroyed) return;
      el.dataset.state = 'error';
      showNotice('The handwriting engine could not load.', 'error', {
        label: 'Retry', run: () => { showNotice(''); load().then(() => { if (strokes.length) recognizeNow(); }); },
      });
    });
    return ready;
  }
  load();

  /* ---------------------------------------------------------------- lifecycle */

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(paper); else window.addEventListener('resize', resize);
  // Re-ink when the theme changes (ink colour comes from CSS).
  const themeObserver = new MutationObserver(() => render());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  darkQuery?.addEventListener?.('change', render);
  requestAnimationFrame(resize);

  return {
    el,
    /** Clear the ink, the chips and the 小 state (e.g. for a new question). */
    clear() {
      clearInk(true);
      settleLast();
      ghost.classList.remove('is-showing');
      fade.classList.remove('is-fading');
    },
    /** Stop timers and observers and remove the pad from the page. */
    destroy() {
      destroyed = true;
      cancelTimer();
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      if (!ro) window.removeEventListener('resize', resize);
      themeObserver.disconnect();
      darkQuery?.removeEventListener?.('change', render);
      el.remove();
    },
    /** Strict mode hides the correction chips. */
    setStrict(value) {
      strict = Boolean(value);
      el.classList.toggle('is-strict', strict);
      setTip();
      renderCandidates();
    },
    /** Fix the script hint; null falls back to getScript(). */
    setScriptHint(script) {
      scriptHint = script === 'hiragana' || script === 'katakana' ? script : undefined;
      if (scriptHint) el.dataset.script = scriptHint; else delete el.dataset.script;
    },
    /** Recognise the current ink immediately (skips the 650 ms wait). */
    recognizeNow,
  };
}
