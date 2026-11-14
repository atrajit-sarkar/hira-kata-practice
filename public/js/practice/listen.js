/**
 * Listen → write player (SPEC §15.2): a large Play button with a sound-wave visual while the word
 * is spoken, a Slow replay, the shortcut hint, a "Tap to listen" state for when the browser has not
 * seen a user gesture yet (speech would be blocked), and an explanation when no Japanese voice is
 * installed (pointing to the romaji hint). Speech itself is driven by the controller.
 * @module practice/listen
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { ROMAJI_HINT_COST } from './hints.js';

/** Rate of the Slow replay. */
export const SLOW_RATE = 0.6;
const BARS = 11;

/**
 * @typedef {object} ListenPlayer
 * @property {HTMLElement} el
 * @property {(on: boolean, opts?: {slow?: boolean}) => void} setSpeaking
 * @property {(on: boolean) => void} setNeedsTap   show the "Tap to listen" state
 * @property {(state: 'ok'|'none'|'unsupported', opts?: {romajiAvailable?: boolean}) => void} setVoice
 * @property {(locked: boolean) => void} setLocked
 */

/**
 * Create the player.
 * @param {{onPlay: (opts: {slow: boolean}) => void, onRomaji: () => void}} opts
 * @returns {ListenPlayer}
 */
export function createListenPlayer({ onPlay, onRomaji }) {
  // Pressing the controls must never move focus out of the answer field (desktop typing).
  const keepFocus = (e) => e.preventDefault();

  const wave = h('span', { class: 'lp-wave', 'aria-hidden': 'true' },
    Array.from({ length: BARS }, (_, i) => h('span', { class: 'lp-bar', style: { '--i': i, '--h': `${[38, 62, 84, 54, 100, 72, 92, 58, 80, 46, 30][i]}%` } })));

  const playBtn = h('button', {
    class: 'lp-play', type: 'button', 'aria-keyshortcuts': 'Alt+P',
    'aria-label': 'Play the word again (Alt+P)', 'data-tip': 'Play again (Alt+P)',
    on: { click: () => onPlay({ slow: false }), mousedown: keepFocus },
  }, h('span', { class: 'lp-ring', 'aria-hidden': 'true' }), h('span', { class: 'lp-ring lp-ring-2', 'aria-hidden': 'true' }),
  icon('volume', { size: 34, className: 'lp-play-icon' }));

  const slowBtn = h('button', {
    class: 'btn btn-secondary btn-sm lp-slow', type: 'button',
    'aria-label': `Play slowly (${SLOW_RATE}× speed)`, 'data-tip': 'Slow replay',
    on: { click: () => onPlay({ slow: true }), mousedown: keepFocus },
  }, h('span', { class: 'lp-slow-glyph', 'aria-hidden': 'true' }, `${SLOW_RATE}×`), 'Slow');

  const caption = h('p', { class: 'lp-caption' });
  const shortcut = h('span', { class: 'lp-shortcut' },
    h('kbd', { class: 'kbd' }, 'Alt'), '+', h('kbd', { class: 'kbd' }, 'P'), h('span', { class: 'lp-shortcut-or' }, ' replays'));

  const noticeBody = h('div', { class: 'lp-notice-body' });
  const notice = h('div', { class: 'lp-notice', hidden: true, role: 'note' },
    icon('alert-triangle', { size: 18, className: 'lp-notice-icon' }), noticeBody);

  const el = h('div', { class: 'lp', dataset: { state: 'idle' } },
    h('div', { class: 'lp-stage' }, playBtn, h('div', { class: 'lp-side' }, wave, caption)),
    h('div', { class: 'lp-controls' }, slowBtn, shortcut),
    notice);

  let speaking = false;
  let needsTap = false;
  let voice = 'ok';

  function sync() {
    const state = voice !== 'ok' ? 'novoice' : speaking ? 'speaking' : needsTap ? 'tap' : 'idle';
    el.dataset.state = state;
    caption.textContent = {
      speaking: 'Listening…',
      tap: 'Tap to listen',
      idle: 'Play again',
      novoice: 'Audio unavailable',
    }[state];
    playBtn.disabled = voice !== 'ok';
    slowBtn.disabled = voice !== 'ok';
    playBtn.setAttribute('aria-label', state === 'tap' ? 'Tap to listen to the word (Alt+P)' : 'Play the word again (Alt+P)');
  }

  function renderNotice(romajiAvailable) {
    if (voice === 'ok') { notice.hidden = true; return; }
    const title = voice === 'unsupported' ? 'This browser cannot speak' : 'No Japanese voice found';
    const how = voice === 'unsupported'
      ? 'Speech isn’t available here. Try the latest Chrome, Edge or Safari.'
      : 'Chrome and Edge include online Japanese voices (stay connected). On Windows you can also add the Japanese speech pack: Settings → Time & language → Speech → Add voices → Japanese, then reload this page.';
    noticeBody.replaceChildren(
      h('p', { class: 'lp-notice-title' }, title),
      h('p', null, how),
      romajiAvailable
        ? h('p', { class: 'lp-notice-action' }, 'Meanwhile, you can still answer this word from its romaji. ',
          h('button', {
            class: 'btn btn-secondary btn-sm', type: 'button', on: { click: () => onRomaji(), mousedown: keepFocus },
          }, icon('type', { size: 15 }), 'Show romaji', h('span', { class: 'hint-cost' }, `−${ROMAJI_HINT_COST}`)))
        : null);
    notice.hidden = false;
  }

  sync();
  return {
    el,
    setSpeaking(on, { slow = false } = {}) {
      speaking = Boolean(on);
      el.classList.toggle('is-slow', speaking && slow);
      sync();
    },
    setNeedsTap(on) { needsTap = Boolean(on); sync(); },
    setVoice(state, { romajiAvailable = true } = {}) {
      voice = state === 'none' || state === 'unsupported' ? state : 'ok';
      sync();
      renderNotice(romajiAvailable);
    },
    setLocked(locked) {
      el.classList.toggle('is-locked', Boolean(locked));
    },
  };
}
