/**
 * Answer feedback (SPEC §12.4, §15.2): the verdict inside the question card (self-drawing check or cross,
 * encouraging phrase, floating points, answer diff rows, explanation) and the meaning card that
 * slides up below it. All motion uses the Web Animations API and is skipped under reduced motion.
 * @module practice/feedback
 */
import { h, svg, prefersReducedMotion } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderAnswerDiff } from '../ui/answer-diff.js';
import { renderWordCard } from '../ui/word-card.js';
import { burstFrom, stopConfetti } from '../ui/confetti.js';
import { play } from '../ui/sound.js';

/** Answers faster than this (ms) with no hints count as "perfect". */
const QUICK_MS = 8000;
const STREAK_MILESTONE = 5;
const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';
const EASE_SPRING = 'cubic-bezier(.34,1.56,.64,1)';

const SCRIPT_NAME = { hiragana: 'hiragana', katakana: 'katakana' };

/**
 * Pick the headline for a result.
 * @param {object} result QuestionResult
 * @returns {{jp: string, en: string, tone: 'correct'|'wrong'|'neutral'}}
 */
export function verdictText(result) {
  if (result.status === 'correct' && result.errorType === 'variant') return { jp: 'いいね!', en: 'Same sound!', tone: 'correct' };
  if (result.status === 'correct') {
    const clean = !result.hint1Used && !result.hint2Used && !result.romajiHintUsed;
    if (clean && result.timeMs > 0 && result.timeMs <= QUICK_MS) return { jp: '完璧!', en: 'Perfect!', tone: 'correct' };
    if (clean) return { jp: 'すごい!', en: 'Great!', tone: 'correct' };
    return { jp: 'いいね!', en: 'Nice!', tone: 'correct' };
  }
  if (result.status === 'skipped') return { jp: 'スキップ', en: 'Skipped', tone: 'neutral' };
  if (result.errorType === 'empty') return { jp: 'まだまだ', en: 'No answer given', tone: 'neutral' };
  if (result.errorType === 'script') return { jp: 'おしい!', en: 'So close!', tone: 'wrong' };
  return { jp: 'ざんねん', en: 'Not quite', tone: 'wrong' };
}

/**
 * One-line explanation under the verdict.
 * @param {object} result QuestionResult
 * @returns {string}
 */
export function explanation(result) {
  if (result.status === 'correct') {
    if (result.errorType === 'variant') {
      return `You wrote it as it sounds; the standard spelling is ${result.expected}. Non-standard spellings cost 30 points.`;
    }
    if (result.hint2Used) return 'Spelled with the guide. Try it unaided next time for full points.';
    const used = [result.hint1Used && 'the script hint', result.romajiHintUsed && 'the romaji hint'].filter(Boolean);
    if (used.length) return `Correct, with ${used.join(' and ')}.`;
    return 'Spelled perfectly, without hints.';
  }
  if (result.status === 'skipped') return 'No problem. This word is saved to your review list.';
  if (result.errorType === 'empty') return 'Nothing was written. This word is saved to your review list.';
  if (result.errorType === 'script') {
    return `Right sounds, wrong script — this word is written in ${SCRIPT_NAME[result.script] || result.script}.`;
  }
  return 'Check the highlighted characters.';
}

/** SVG mark (circle + check or cross) whose strokes draw themselves. */
function drawnMark(kind) {
  const paths = kind === 'correct' ? ['M15 25.5l7 7 13-14'] : kind === 'wrong' ? ['M17 17l16 16', 'M33 17L17 33'] : ['M16 25h18'];
  return svg('svg', { class: 'fb-mark', viewBox: '0 0 50 50', width: 56, height: 56, 'aria-hidden': 'true' },
    svg('circle', { class: 'fb-mark-ring', cx: 25, cy: 25, r: 22, pathLength: 1 }),
    ...paths.map((d) => svg('path', { class: 'fb-mark-stroke', d, pathLength: 1 })));
}

function animateMark(mark) {
  const [ring, ...strokes] = mark.children;
  ring.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 420, easing: EASE_OUT, fill: 'both' });
  strokes.forEach((p, i) => p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
    duration: 300, delay: 300 + i * 140, easing: EASE_OUT, fill: 'both',
  }));
  mark.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, easing: EASE_SPRING });
}

/** Stagger the kana tiles of a diff row in. */
function animateTiles(row, delay) {
  row.querySelectorAll('.answer-diff-tile').forEach((tile, i) => tile.animate([
    { transform: 'translateY(10px) scale(.85)', opacity: 0 },
    { transform: 'translateY(0) scale(1)', opacity: 1 },
  ], { duration: 320, delay: delay + i * 55, easing: EASE_SPRING, fill: 'backwards' }));
}

/** Flip a row in around the X axis. */
function flipIn(node, delay) {
  node.animate([
    { transform: 'perspective(600px) rotateX(-80deg)', opacity: 0 },
    { transform: 'perspective(600px) rotateX(0)', opacity: 1 },
  ], { duration: 460, delay, easing: EASE_OUT, fill: 'backwards' });
}

/** Points that float up from the verdict. */
function floatPoints(host, points) {
  const node = h('span', { class: 'fb-float', 'aria-hidden': 'true' }, `+${points}`);
  host.appendChild(node);
  const anim = node.animate([
    { transform: 'translate(-50%, 6px) scale(.7)', opacity: 0 },
    { transform: 'translate(-50%, -14px) scale(1.15)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%, -54px) scale(1)', opacity: 0 },
  ], { duration: 1300, easing: EASE_OUT, fill: 'forwards' });
  anim.onfinish = () => node.remove();
}

/** Confetti size scales with answer quality. */
function confettiFor(points) {
  if (points >= 100) return { count: 110, spread: 100, velocity: 12 };
  if (points >= 80) return { count: 70, spread: 80, velocity: 11 };
  return { count: 36, spread: 60, velocity: 9 };
}

/**
 * Create the feedback views.
 * @param {{card: HTMLElement}} opts card = the question card element (shaken on wrong answers)
 * @returns {{verdictEl: HTMLElement, meaningEl: HTMLElement, show: (result: object, opts?: {
 *   firstSeen?: boolean, streak?: number, effects?: boolean}) => string, hide: () => void}}
 *   show() renders the result and returns the text announced to screen readers.
 */
export function createFeedback({ card }) {
  const verdictEl = h('div', { class: 'fb', hidden: true });
  const meaningEl = h('section', { class: 'pr-meaning', hidden: true, 'aria-label': 'Word meaning' });
  const pending = new Set();

  function later(fn, ms) {
    const t = setTimeout(() => { pending.delete(t); fn(); }, ms);
    pending.add(t);
  }

  function renderVerdict(result, { streak }) {
    const text = verdictText(result);
    const mark = drawnMark(text.tone);
    const head = h('div', { class: 'fb-head' },
      h('div', { class: 'fb-mark-wrap' }, mark),
      h('div', { class: 'fb-title-wrap' },
        h('p', { class: 'fb-title' }, h('span', { class: 'fb-title-jp', lang: 'ja' }, text.jp), ' ', text.en),
        h('p', { class: 'fb-explain' }, explanation(result))),
      h('div', { class: 'fb-side' },
        h('span', { class: ['fb-points', result.points > 0 && 'is-positive'] },
          result.points > 0 ? `+${result.points}` : '0', h('small', null, ' pts')),
        result.status === 'correct' && streak >= 2
          ? h('span', { class: 'fb-streak' }, icon('flame', { size: 14 }), `${streak} in a row`) : null));

    const rows = h('div', { class: 'fb-rows' });
    const answered = result.status !== 'skipped' && result.errorType !== 'empty';
    if (answered) {
      rows.appendChild(h('div', { class: 'fb-row' }, h('span', { class: 'fb-row-label' }, 'Your answer'),
        renderAnswerDiff(result.diff, { show: 'actual', size: 'lg' })));
    }
    const variant = result.status === 'correct' && result.errorType === 'variant';
    if (result.status !== 'correct' || variant) {
      rows.appendChild(h('div', { class: 'fb-row fb-row-expected' },
        h('span', { class: 'fb-row-label' }, variant ? 'Standard spelling' : 'Correct answer'),
        renderAnswerDiff(result.diff, { show: 'expected', size: 'lg', label: variant ? 'Standard spelling' : undefined })));
    }
    verdictEl.dataset.tone = text.tone;
    verdictEl.classList.toggle('is-variant', variant);
    verdictEl.replaceChildren(head, rows);
    return { text, mark, head, rows };
  }

  function renderMeaning(word, firstSeen) {
    const wordCard = renderWordCard(word, { size: 'lg', className: 'pr-word-card' });
    meaningEl.replaceChildren(
      h('div', { class: 'pr-meaning-card' },
        firstSeen ? h('span', { class: 'pr-ribbon' }, icon('sparkles', { size: 14 }), 'New word') : null,
        wordCard));
  }

  function playEffects(result, parts, streak) {
    animateMark(parts.mark);
    parts.head.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: EASE_OUT });
    const rows = [...parts.rows.children];
    rows.forEach((row, i) => {
      flipIn(row, 160 + i * 170);
      animateTiles(row, 260 + i * 170);
    });
    meaningEl.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }],
      { duration: 480, delay: 280, easing: EASE_OUT, fill: 'backwards' });

    if (result.status === 'correct') {
      floatPoints(parts.head.querySelector('.fb-side'), result.points);
      later(() => burstFrom(parts.mark, confettiFor(result.points)), 260);
    } else if (result.status === 'wrong') {
      // Shake the card's content, not the card itself: a transformed ancestor would break the
      // fixed-position action bar used on phones.
      for (const part of card.querySelectorAll(':scope > :not(.pr-actions)')) part.animate([
        { transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' },
        { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' },
      ], { duration: 460, easing: 'ease-out' });
    }
    if (result.status === 'correct' && streak > 0 && streak % STREAK_MILESTONE === 0) later(() => play('streak'), 420);
  }

  return {
    verdictEl,
    meaningEl,
    show(result, { firstSeen = false, streak = 0, effects = true } = {}) {
      const parts = renderVerdict(result, { streak });
      renderMeaning(result.word, firstSeen);
      verdictEl.hidden = false;
      meaningEl.hidden = false;
      if (effects) {
        play(result.status === 'correct' ? 'correct' : result.status === 'wrong' ? 'wrong' : 'tap');
        if (!prefersReducedMotion()) playEffects(result, parts, streak);
      }
      const points = result.points > 0 ? ` Plus ${result.points} points.` : '';
      return `${parts.text.en}${points} ${explanation(result)} The answer is ${result.expected}`
        + `${result.word?.meaning ? `, meaning ${result.word.meaning}` : ''}.`;
    },
    hide() {
      for (const t of pending) clearTimeout(t);
      pending.clear();
      stopConfetti(); // the last burst must not rain over the next question or its feedback
      verdictEl.hidden = true;
      meaningEl.hidden = true;
      verdictEl.replaceChildren();
      meaningEl.replaceChildren();
    },
  };
}
