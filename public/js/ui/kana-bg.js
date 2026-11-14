/**
 * Subtle floating-kana backdrop for the landing and auth pages. Pure CSS animation (no JS loop);
 * static under prefers-reduced-motion. Place inside a `position: relative` container.
 * @module ui/kana-bg
 */
import { h } from './dom.js';

const HIRA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
const KATA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';

/** Deterministic PRNG so the layout is stable between renders (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create the floating-kana layer.
 * @param {{count?: number, seed?: number, className?: string}} [opts]
 * @returns {HTMLDivElement} aria-hidden decorative layer (class "kana-bg")
 */
export function kanaBackground({ count = 22, seed = 7, className } = {}) {
  const rand = rng(seed);
  const layer = h('div', { class: ['kana-bg', className], 'aria-hidden': 'true' });
  const hira = Array.from(HIRA);
  const kata = Array.from(KATA);
  for (let i = 0; i < count; i++) {
    const isKata = i % 2 === 1;
    const pool = isKata ? kata : hira;
    const ch = pool[Math.floor(rand() * pool.length)];
    // Spread glyphs on a jittered grid so they never clump.
    const col = i % 6;
    const row = Math.floor(i / 6);
    const rows = Math.ceil(count / 6);
    const x = ((col + 0.15 + rand() * 0.7) / 6) * 100;
    const y = ((row + 0.15 + rand() * 0.7) / rows) * 100;
    layer.appendChild(h('span', {
      class: ['kana-bg-glyph', isKata ? 'is-kata' : 'is-hira'],
      style: {
        left: `${x.toFixed(2)}%`,
        top: `${y.toFixed(2)}%`,
        '--size': `${Math.round(28 + rand() * 64)}px`,
        '--rot': `${Math.round(rand() * 30 - 15)}deg`,
        '--drift': `${Math.round(10 + rand() * 18)}px`,
        '--dur': `${(9 + rand() * 9).toFixed(1)}s`,
        '--delay': `${(-rand() * 12).toFixed(1)}s`,
        '--alpha': (0.05 + rand() * 0.09).toFixed(3),
      },
    }, ch));
  }
  return layer;
}
