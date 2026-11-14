/**
 * Handwriting recogniser tests (SPEC §15.5).
 *
 * Accuracy is measured on synthetic handwriting generated from the KanjiVG templates with a
 * seeded RNG: random affine transform (rotation ±10°, scale ±15 %, aspect ±8 %, shear ±0.15,
 * translation, arbitrary output size), per-stroke displacement, stroke length and curvature
 * noise, per-point jitter, irregular pointer sampling, small dakuten offsets, and in 20 % of
 * samples a shuffled stroke order or a pair of consecutive strokes merged into one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createRecognizer, _internals } from '../public/js/handwriting/recognizer.js';
import { KEYBOARD, toKatakana } from '../shared/kana.js';

const DATA = JSON.parse(readFileSync(new URL('../public/data/kana-strokes.json', import.meta.url), 'utf8'));
const recognizer = createRecognizer(DATA);
const SMALL = 'ぁぃぅぇぉゃゅょっゎァィゥェォャュョッヮ';
const SAMPLES_PER_CHAR = Number(process.env.HW_SAMPLES || 16);

/* ------------------------------------------------------------ seeded synthetic handwriting */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRandom(seed) {
  const next = mulberry32(seed);
  const uniform = (a, b) => a + (b - a) * next();
  const gauss = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return { next, uniform, gauss, int: (n) => Math.floor(next() * n) };
}

/** Dense polyline (spacing ≈ 1.5 units) of a template stroke. */
function densify(stroke) {
  const out = [stroke[0]];
  for (let i = 1; i < stroke.length; i++) {
    const [ax, ay] = stroke[i - 1];
    const [bx, by] = stroke[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
    for (let s = 1; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
  }
  return out;
}

const pathLen = (pts) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** Stroke-level noise: trim/extend ends, bow (curvature) and wobble, small displacement. */
function distortStroke(stroke, rnd, offset) {
  let pts = densify(stroke);
  const len = pathLen(pts);
  if (len > 6 && pts.length > 4) {
    // Length noise: trim or extend each end by up to ±10 %.
    const ext = (a, b, frac) => {
      const dx = a[0] - b[0]; const dy = a[1] - b[1]; const d = Math.hypot(dx, dy) || 1;
      return [a[0] + (dx / d) * frac * len, a[1] + (dy / d) * frac * len];
    };
    const fs = rnd.uniform(-0.1, 0.1);
    const fe = rnd.uniform(-0.1, 0.1);
    if (fs < 0) pts = pts.slice(Math.floor(-fs * pts.length)); else pts.unshift(ext(pts[0], pts[1], fs));
    if (fe < 0) pts = pts.slice(0, Math.max(2, pts.length - Math.floor(-fe * pts.length)));
    else pts.push(ext(pts[pts.length - 1], pts[pts.length - 2], fe));
  }
  // Curvature noise: perpendicular bow + one wobble, scaled with the stroke length.
  const a1 = rnd.gauss() * 0.035 * len;
  const a2 = rnd.gauss() * 0.015 * len;
  const n = pts.length;
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[n - 1];
  const chord = Math.hypot(ex - sx, ey - sy) || 1;
  const nx = -(ey - sy) / chord;
  const ny = (ex - sx) / chord;
  return pts.map(([x, y], i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const d = a1 * Math.sin(Math.PI * t) + a2 * Math.sin(2 * Math.PI * t);
    return [x + nx * d + offset[0], y + ny * d + offset[1]];
  });
}

/** Number of trailing dakuten (2) / handakuten (1) strokes of a character. */
function markStrokes(ch) {
  const nfd = ch.normalize('NFD');
  if (nfd.includes('゙')) return 2;
  if (nfd.includes('゚')) return 1;
  return 0;
}

/**
 * One synthetic handwritten sample of `ch`.
 * @returns {{ strokes: Array<Array<{x:number,y:number}>>, variant: 'plain'|'shuffled'|'merged' }}
 */
function synthesize(ch, rnd) {
  const template = DATA.chars[ch];
  const marks = markStrokes(ch);
  const markShift = [rnd.gauss() * 3, rnd.gauss() * 3];
  let strokes = template.map((s, i) => {
    const isMark = i >= template.length - marks;
    const off = isMark ? [markShift[0] + rnd.gauss(), markShift[1] + rnd.gauss()] : [rnd.gauss() * 1.8, rnd.gauss() * 1.8];
    return distortStroke(s, rnd, off);
  });
  let variant = 'plain';
  if (strokes.length > 1 && rnd.next() < 0.2) {
    if (rnd.next() < 0.5) {
      variant = 'shuffled';
      const order = strokes.map((_, i) => i);
      do {
        for (let i = order.length - 1; i > 0; i--) { const j = rnd.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
      } while (order.every((v, i) => v === i));
      strokes = order.map((i) => strokes[i]);
    } else {
      variant = 'merged';
      const k = rnd.int(strokes.length - 1);
      strokes = [...strokes.slice(0, k), [...strokes[k], ...strokes[k + 1]], ...strokes.slice(k + 2)];
    }
  }
  // Global affine transform around the centre of the 109 box.
  const rot = (rnd.uniform(-10, 10) * Math.PI) / 180;
  const scale = rnd.uniform(0.85, 1.15);
  const aspect = rnd.uniform(0.92, 1.08);
  const shear = rnd.uniform(-0.15, 0.15);
  const out = rnd.uniform(1.2, 4); // output pixels per KanjiVG unit
  const tx = rnd.uniform(-200, 200);
  const ty = rnd.uniform(-200, 200);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const jitter = 0.55;
  const result = strokes.map((s) => {
    const pts = [];
    // Irregular pointer sampling: keep a random subset (always the ends).
    s.forEach(([x, y], i) => {
      if (i !== 0 && i !== s.length - 1 && rnd.next() < 0.45) return;
      let u = (x - 54.5) * scale * aspect;
      let v = (y - 54.5) * scale / aspect;
      u += shear * v;
      const X = (u * cos - v * sin + rnd.gauss() * jitter) * out + tx;
      const Y = (u * sin + v * cos + rnd.gauss() * jitter) * out + ty;
      pts.push({ x: X, y: Y });
    });
    return pts;
  });
  return { strokes: result, variant };
}

/* ------------------------------------------------------------ evaluation */

const hiraChars = [
  ...KEYBOARD.basic.flat(), ...KEYBOARD.voiced.flat(), ...KEYBOARD.voicedExtra, ...KEYBOARD.small,
].filter((ch) => ch && !SMALL.includes(ch));
const SETS = {
  hiragana: hiraChars.filter((ch) => ch !== 'ー'),
  katakana: hiraChars.filter((ch) => ch !== 'ー').map((ch) => toKatakana(ch)),
};

/** Recognise SAMPLES_PER_CHAR samples of every char; seeded so results are reproducible. */
function evaluate(chars, script, seed) {
  const rnd = makeRandom(seed);
  const stats = { n: 0, top1: 0, top3: 0, ms: 0, confusions: new Map(), variants: {} };
  for (const ch of chars) {
    for (let k = 0; k < SAMPLES_PER_CHAR; k++) {
      const { strokes, variant } = synthesize(ch, rnd);
      const t0 = performance.now();
      const res = recognizer.recognize(strokes, { script, topN: 5 });
      stats.ms += performance.now() - t0;
      const v = (stats.variants[variant] ||= { n: 0, ok: 0 });
      stats.n += 1; v.n += 1;
      if (res[0]?.char === ch) { stats.top1 += 1; v.ok += 1; } else {
        const key = `${ch}→${res[0]?.char ?? '∅'}`;
        stats.confusions.set(key, (stats.confusions.get(key) || 0) + 1);
      }
      if (res.slice(0, 3).some((r) => r.char === ch)) stats.top3 += 1;
    }
  }
  return stats;
}

const pct = (a, b) => `${((100 * a) / b).toFixed(1)} %`;
function report(label, s) {
  const top = [...s.confusions].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, c]) => `${k}×${c}`).join('  ');
  const variants = Object.entries(s.variants).map(([k, v]) => `${k} ${pct(v.ok, v.n)}`).join(', ');
  console.log(`# ${label}: n=${s.n} top-1 ${pct(s.top1, s.n)} top-3 ${pct(s.top3, s.n)} `
    + `(${variants}); ${(s.ms / s.n).toFixed(2)} ms/recognition`);
  console.log(`#   confusions: ${top || 'none'}`);
}

const results = {};
for (const [i, script] of ['hiragana', 'katakana'].entries()) {
  test(`synthetic ${script}: top-1 ≥ 92 %, top-3 ≥ 98 %`, () => {
    const s = evaluate(SETS[script], script, 1000 + i);
    results[script] = s;
    report(script, s);
    assert.ok(s.top1 / s.n >= 0.92, `top-1 ${pct(s.top1, s.n)}`);
    assert.ok(s.top3 / s.n >= 0.98, `top-3 ${pct(s.top3, s.n)}`);
  });
}

test('synthetic samples without a script hint (identical twins へ/ヘ, べ/ベ, ぺ/ペ count as equal)', () => {
  const twins = (a, b) => a === b || ['へヘ', 'べベ', 'ぺペ'].some((p) => p.includes(a) && p.includes(b));
  const rnd = makeRandom(77);
  let n = 0; let ok = 0;
  for (const ch of [...SETS.hiragana, ...SETS.katakana]) {
    for (let k = 0; k < 6; k++) {
      const res = recognizer.recognize(synthesize(ch, rnd).strokes);
      n += 1; if (twins(res[0]?.char, ch)) ok += 1;
    }
  }
  console.log(`# no script hint: top-1 ${pct(ok, n)} (n=${n})`);
  assert.ok(ok / n >= 0.85, `no-hint top-1 ${pct(ok, n)}`);
});

const CONFUSABLE = ['シツ', 'ソン', 'クケタ', 'ぬめ', 'われね', 'はほ', 'るろ', 'さちき', 'いり', 'レン', 'ラヲ', 'ばぱぼ', 'ユコ'];

// Thresholds: the length noise can cut the distinguishing tail off れ/ね/ぬ (≈10 % of a long
// stroke), which makes some samples genuinely ambiguous, so members need ≥ 75 % (≤ 20 % swapped
// inside the group) and each group ≥ 85 % on average.
test('confusable groups separate (group mean ≥ 85 % top-1; each member ≥ 75 %, ≤ 20 % swapped within the group)', () => {
  const rnd = makeRandom(31337);
  const lines = [];
  const failures = [];
  for (const group of CONFUSABLE) {
    const members = Array.from(group);
    let groupOk = 0;
    for (const ch of members) {
      const script = _internals.scriptOfChar(ch);
      let ok = 0; let swapped = 0; const n = 40;
      for (let k = 0; k < n; k++) {
        const top = recognizer.recognize(synthesize(ch, rnd).strokes, { script, topN: 1 })[0]?.char;
        if (top === ch) ok += 1; else if (members.includes(top)) swapped += 1;
      }
      lines.push(`${ch} ${Math.round((100 * ok) / n)}%${swapped ? ` (swapped ${swapped})` : ''}`);
      groupOk += ok / n;
      if (ok / n < 0.75 || swapped / n > 0.2) failures.push(`${ch}: ${ok}/${n} correct, ${swapped} swapped within ${group}`);
    }
    if (groupOk / members.length < 0.85) failures.push(`${group}: mean top-1 ${pct(groupOk, members.length)}`);
  }
  console.log(`# confusable: ${lines.join(' · ')}`);
  assert.deepEqual(failures, []);
});

/* ------------------------------------------------------------ data and API */

test('kana-strokes.json covers every keyboard key in both scripts, with attribution', () => {
  assert.equal(DATA.meta.source, 'KanjiVG');
  assert.match(DATA.meta.license, /CC BY-SA 3\.0/);
  assert.match(DATA.meta.url, /^https:\/\//);
  const all = [...hiraChars, ...SMALL].filter((c) => !/[ァ-ヿ]/.test(c));
  for (const ch of new Set([...all, ...all.map((c) => toKatakana(c))])) {
    const strokes = DATA.chars[ch];
    assert.ok(Array.isArray(strokes) && strokes.length > 0, `missing ${ch}`);
    for (const s of strokes) {
      assert.ok(s.length >= 2, `${ch}: stroke with < 2 points`);
      for (const [x, y] of s) assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= -5 && x <= 114 && y >= -5 && y <= 114, `${ch}: bad point`);
    }
  }
  assert.equal(DATA.chars['ば'].length, 5, 'は (3) + dakuten (2)');
  assert.equal(DATA.chars['ぱ'].length, 4);
});

/** A template as a clean drawing in pixel space ({x, y} points). */
const drawn = (ch, { scale = 3, dx = 40, dy = 25 } = {}) =>
  DATA.chars[ch].map((s) => s.map(([x, y]) => ({ x: x * scale + dx, y: y * scale + dy })));

test('recognize: exact templates, any scale/translation, arrays or {x,y}', () => {
  for (const ch of ['あ', 'ぬ', 'ア', 'ヲ', 'ゔ', 'ぽ', 'ヴ', 'ー']) {
    const script = _internals.scriptOfChar(ch);
    const a = recognizer.recognize(drawn(ch), { script });
    const b = recognizer.recognize(drawn(ch, { scale: 0.2, dx: -900, dy: 3 }), { script });
    const c = recognizer.recognize(DATA.chars[ch], { script });
    assert.equal(a[0].char, ch);
    assert.deepEqual(b.map((r) => r.char), a.map((r) => r.char));
    assert.equal(c[0].char, ch);
    assert.ok(a[0].score > 0.9 && a[0].score <= 1, `score ${a[0].score}`);
  }
});

test('recognize: result shape, ordering, topN and confidences', () => {
  const res = recognizer.recognize(drawn('ね'), { topN: 4 });
  assert.equal(res.length, 4);
  for (const r of res) {
    assert.deepEqual(Object.keys(r).sort(), ['char', 'confidence', 'score']);
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  }
  for (let i = 1; i < res.length; i++) assert.ok(res[i - 1].score >= res[i].score);
  assert.ok(res.reduce((n, r) => n + r.confidence, 0) <= 1.0001);
  assert.ok(res[0].confidence > 0.5);
  assert.equal(recognizer.recognize(drawn('ね'), { topN: 1 }).length, 1);
  assert.equal(recognizer.recognize(drawn('ね')).length, 5, 'default topN is 5');
});

test('recognize: empty, degenerate and junk input never throws', () => {
  assert.deepEqual(recognizer.recognize([]), []);
  assert.deepEqual(recognizer.recognize(null), []);
  assert.deepEqual(recognizer.recognize([[], []]), []);
  assert.deepEqual(recognizer.recognize([[{ x: NaN, y: 1 }]]), []);
  const dot = recognizer.recognize([[{ x: 5, y: 5 }]]);
  assert.ok(dot.length > 0);
  const scribble = Array.from({ length: 12 }, (_, i) => [{ x: i * 7, y: 0 }, { x: i * 7 + 3, y: 40 }]);
  assert.ok(recognizer.recognize(scribble).length > 0);
});

test('small kana are left to the 小 key; ー is recognised as one horizontal stroke', () => {
  for (const ch of ['ぁ', 'ゃ', 'っ', 'ョ', 'ヮ']) assert.equal(recognizer.chars.includes(ch), false, ch);
  assert.equal(recognizer.recognize(drawn('ゃ'), { script: 'hiragana' })[0].char, 'や');
  const bar = [[{ x: 10, y: 50 }, { x: 60, y: 52 }, { x: 120, y: 49 }]];
  assert.equal(recognizer.recognize(bar, { script: 'katakana' })[0].char, 'ー');
  assert.equal(createRecognizer(DATA, { includeSmall: true }).chars.includes('ゃ'), true);
});

test('script hint is a soft prior: it decides identical shapes but not clear ones', () => {
  assert.equal(recognizer.recognize(drawn('へ'), { script: 'hiragana' })[0].char, 'へ');
  assert.equal(recognizer.recognize(drawn('へ'), { script: 'katakana' })[0].char, 'ヘ');
  assert.equal(recognizer.recognize(drawn('あ'), { script: 'katakana' })[0].char, 'あ');
  assert.equal(recognizer.recognize(drawn('ア'), { script: 'hiragana' })[0].char, 'ア');
});

test('stroke direction matters: reversed long stroke turns ソ into ン', () => {
  const so = DATA.chars['ソ'];
  const reversed = [so[0], so[1].slice().reverse()];
  assert.equal(recognizer.recognize(so, { script: 'katakana' })[0].char, 'ソ');
  assert.equal(recognizer.recognize(reversed, { script: 'katakana' })[0].char, 'ン');
});

test('recognition is fast enough for live use (< 10 ms on average)', () => {
  const rnd = makeRandom(5);
  const samples = ['あ', 'ぼ', 'ネ', 'ヴ', 'き', 'ふ', 'を', 'ボ'].flatMap((ch) => [0, 1, 2].map(() => synthesize(ch, rnd).strokes));
  recognizer.recognize(samples[0]); // warm-up
  const t0 = performance.now();
  for (const s of samples) recognizer.recognize(s, { script: 'hiragana' });
  const avg = (performance.now() - t0) / samples.length;
  console.log(`# speed: ${avg.toFixed(2)} ms/recognition`);
  assert.ok(avg < 10, `${avg.toFixed(2)} ms`);
});
