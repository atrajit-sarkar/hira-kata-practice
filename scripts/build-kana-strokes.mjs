#!/usr/bin/env node
/**
 * Build public/data/kana-strokes.json (stroke templates for the handwriting recogniser,
 * docs/SPEC.md §15.5) from KanjiVG (© Ulrich Apel, CC BY-SA 3.0).
 *
 * Usage: node scripts/build-kana-strokes.mjs [--refresh]
 *   --refresh  ignore cached SVGs in .cache/kanjivg and download fresh copies
 *
 * For every key of KEYBOARD (shared/kana.js) in both scripts the matching KanjiVG SVG
 * (kanji/<5-digit hex>.svg) is downloaded once into .cache/kanjivg/. Downloads are untrusted data:
 * they are only parsed as text (each <path id="kvg:…-sN" d="…"> is read with a regex and its
 * path data is tokenised as numbers); nothing is executed or rendered. Each stroke is flattened
 * (cubic/quadratic Béziers sampled finely), simplified with Ramer–Douglas–Peucker and rounded to
 * whole units of the 109×109 KanjiVG space, in stroke order.
 *
 * When KanjiVG has no file for a character (historically ー), it is synthesised and listed in
 * meta.synthesized: ー is one horizontal stroke through the middle of the box.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedDownload, DownloadError } from './lib/download.mjs';
import { KEYBOARD, toKatakana } from '../shared/kana.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'kanjivg');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'kana-strokes.json');
const BASE_URL = 'https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/';
const CONCURRENCY = 8;
/** Max deviation (KanjiVG units) when simplifying a flattened stroke. */
const RDP_TOLERANCE = 0.6;
/** Synthesised strokes for characters KanjiVG does not cover. */
const SYNTHETIC = Object.freeze({ 'ー': [[[14, 54], [54, 54], [95, 54]]] });

const META = Object.freeze({
  source: 'KanjiVG',
  license: 'CC BY-SA 3.0',
  author: 'Ulrich Apel',
  url: 'https://kanjivg.tagaini.net/',
  space: 109,
});

/** Every distinct key of the on-screen keyboard, hiragana first, then katakana. */
export function keyboardChars() {
  const hira = [
    ...KEYBOARD.basic.flat(), ...KEYBOARD.voiced.flat(), ...KEYBOARD.voicedExtra, ...KEYBOARD.small,
  ].filter(Boolean);
  return [...new Set([...hira, ...hira.map((ch) => toKatakana(ch))])];
}

/** KanjiVG file name for a character: 5-digit lowercase hex code point. */
export const kanjivgName = (ch) => `${ch.codePointAt(0).toString(16).padStart(5, '0')}.svg`;

/** Tokenise SVG path data into commands and numbers. */
function tokenize(d) {
  const re = /([MmLlHhVvCcSsQqTtZzAa])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  const out = [];
  for (const m of d.matchAll(re)) out.push(m[1] ?? Number(m[2]));
  return out;
}

const cubicAt = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
};

/**
 * Flatten SVG path data into polylines (one per subpath). Supports M L H V C S Q T Z in
 * absolute and relative forms; arcs (never used by KanjiVG) are approximated by their chord.
 * @param {string} d
 * @returns {number[][][]}
 */
export function flattenPath(d, steps = 24) {
  const tokens = tokenize(d);
  const polys = [];
  let poly = null;
  let cur = [0, 0];
  let start = [0, 0];
  let lastCtrl = null; // reflected control point source for S/T
  let lastCmd = '';
  let i = 0;
  const num = () => {
    const v = tokens[i++];
    if (typeof v !== 'number') throw new Error(`Bad path data near token ${i}: ${d.slice(0, 60)}`);
    return v;
  };
  const pt = (rel) => { const x = num(); const y = num(); return rel ? [cur[0] + x, cur[1] + y] : [x, y]; };
  const lineTo = (p) => { poly.push(p); cur = p; };
  let cmd = '';
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') cmd = tokens[i++];
    else if (!cmd) throw new Error('Path data must start with a command');
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C !== 'M' && C !== 'Z' && !poly) { poly = [cur]; polys.push(poly); }
    switch (C) {
      case 'M': {
        cur = pt(rel); start = cur; poly = [cur]; polys.push(poly);
        cmd = rel ? 'l' : 'L'; // implicit lineto for following pairs
        lastCtrl = null;
        break;
      }
      case 'L': lineTo(pt(rel)); lastCtrl = null; break;
      case 'H': { const x = num(); lineTo([rel ? cur[0] + x : x, cur[1]]); lastCtrl = null; break; }
      case 'V': { const y = num(); lineTo([cur[0], rel ? cur[1] + y : y]); lastCtrl = null; break; }
      case 'C':
      case 'S': {
        const p0 = cur;
        let p1;
        if (C === 'C') p1 = pt(rel);
        else p1 = lastCtrl && /[CS]/i.test(lastCmd) ? [2 * p0[0] - lastCtrl[0], 2 * p0[1] - lastCtrl[1]] : p0;
        const p2 = pt(rel);
        const p3 = pt(rel);
        for (let s = 1; s <= steps; s++) poly.push(cubicAt(p0, p1, p2, p3, s / steps));
        cur = p3; lastCtrl = p2;
        break;
      }
      case 'Q':
      case 'T': {
        const p0 = cur;
        const p1 = C === 'Q' ? pt(rel)
          : (lastCtrl && /[QT]/i.test(lastCmd) ? [2 * p0[0] - lastCtrl[0], 2 * p0[1] - lastCtrl[1]] : p0);
        const p2 = pt(rel);
        for (let s = 1; s <= steps; s++) {
          const t = s / steps; const u = 1 - t;
          poly.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
        }
        cur = p2; lastCtrl = p1;
        break;
      }
      case 'A': {
        num(); num(); num(); num(); num();
        lineTo(pt(rel)); lastCtrl = null;
        break;
      }
      case 'Z': lineTo(start); lastCtrl = null; break;
      default: throw new Error(`Unsupported path command ${cmd}`);
    }
    lastCmd = cmd;
  }
  return polys.filter((p) => p.length > 0);
}

/** Ramer–Douglas–Peucker simplification. */
export function simplify(points, tol = RDP_TOLERANCE) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a]; const [bx, by] = points[b];
    const dx = bx - ax; const dy = by - ay; const len = Math.hypot(dx, dy) || 1e-9;
    let best = -1; let bestD = tol;
    for (let k = a + 1; k < b; k++) {
      const [px, py] = points[k];
      const dist = len < 1e-6 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (dist > bestD) { bestD = dist; best = k; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return points.filter((_, k) => keep[k]);
}

/** Round to integers and drop consecutive duplicates (keeping at least two points). */
function roundStroke(points) {
  const out = [];
  for (const [x, y] of points) {
    const p = [Math.round(x), Math.round(y)];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  if (out.length === 1) out.push(out[0].slice());
  return out;
}

/**
 * Extract the strokes of a KanjiVG SVG (text) in stroke order.
 * @param {string} svgText
 * @returns {number[][][]} strokes of [x, y] points
 */
export function strokesFromSvg(svgText) {
  const found = [];
  const re = /<path\b[^>]*?\bid="kvg:[0-9a-f]+-s(\d+)"[^>]*?\bd="([^"]+)"/gi;
  for (const m of svgText.matchAll(re)) found.push({ n: Number(m[1]), d: m[2] });
  // Attribute order is not guaranteed: also accept d="…" before id="…".
  const re2 = /<path\b[^>]*?\bd="([^"]+)"[^>]*?\bid="kvg:[0-9a-f]+-s(\d+)"/gi;
  for (const m of svgText.matchAll(re2)) if (!found.some((f) => f.n === Number(m[2]))) found.push({ n: Number(m[2]), d: m[1] });
  found.sort((a, b) => a.n - b.n);
  return found.map(({ d }) => roundStroke(simplify(flattenPath(d).flat())));
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const k = next++;
      results[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const chars = keyboardChars();
  await mkdir(CACHE_DIR, { recursive: true });
  let downloaded = 0;
  const synthesized = [];
  const entries = await mapLimit(chars, CONCURRENCY, async (ch) => {
    const name = kanjivgName(ch);
    try {
      const { data, fromCache } = await cachedDownload(BASE_URL + name, path.join(CACHE_DIR, name), { refresh });
      if (!fromCache) downloaded += 1;
      const strokes = strokesFromSvg(data.toString('utf8'));
      if (!strokes.length) throw new Error(`${name} has no strokes`);
      return [ch, strokes];
    } catch (err) {
      if (SYNTHETIC[ch] && (err instanceof DownloadError || /no strokes/.test(err.message))) {
        synthesized.push(ch);
        return [ch, SYNTHETIC[ch]];
      }
      throw new Error(`${ch} (${name}): ${err.message}`, { cause: err });
    }
  });
  const out = { meta: { ...META, synthesized, chars: entries.length }, chars: Object.fromEntries(entries) };
  // Compact layout: one character per line.
  const lines = entries.map(([ch, strokes]) => `${JSON.stringify(ch)}:${JSON.stringify(strokes)}`);
  const json = `{"meta":${JSON.stringify(out.meta)},\n"chars":{\n${lines.join(',\n')}\n}}\n`;
  JSON.parse(json); // sanity check
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  const tmp = `${OUT_FILE}.tmp`;
  await writeFile(tmp, json);
  await rename(tmp, OUT_FILE);
  const strokeCount = entries.reduce((n, [, s]) => n + s.length, 0);
  console.log(`kana-strokes: ${entries.length} characters, ${strokeCount} strokes, ${(json.length / 1024).toFixed(1)} KiB`
    + ` (${downloaded} downloaded, ${entries.length - downloaded} cached${synthesized.length ? `, synthesised: ${synthesized.join(' ')}` : ''})`);
  console.log(`wrote ${path.relative(ROOT, OUT_FILE)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`build-kana-strokes failed: ${err.message}`);
    process.exitCode = 1;
  });
}
