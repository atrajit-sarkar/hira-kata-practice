/**
 * Handwritten kana recogniser (SPEC §15.5). Pure ESM, no DOM: runs in the browser and in Node.
 *
 * Templates are KanjiVG stroke lists (public/data/kana-strokes.json). A drawing is compared with
 * every template by two complementary measures:
 *
 *  1. Stroke matching — every stroke is resampled to a fixed number of points with tangent
 *     directions. Strokes are aligned in writing order by dynamic programming that also allows a
 *     merged pair (two template strokes written in one go), a split stroke, and missing / extra
 *     strokes (penalised by their length); an order-free optimal assignment (Hungarian method)
 *     covers strokes written in an unusual order. Directions make reversed or mirrored motion
 *     costly, which separates シ/ツ and ソ/ン.
 *  2. Point cloud — an order-free $P-style greedy cloud match over points carrying position and
 *     direction, robust to any stroke segmentation.
 *
 * Both are computed after normalising the drawing (bounding-box centre, uniform scale by its
 * longer side, so thin glyphs such as ー keep their aspect). The combined distance gets a small
 * stroke-count penalty and an optional soft script prior, and is turned into calibrated
 * confidences with a softmax.
 *
 * Small kana (ぁ ゃ っ …) have the same shape as their full-size twins, so they are not
 * recognised directly: the pad's 小 key turns the result into the small form.
 *
 * @module handwriting/recognizer
 */

/** Points per resampled stroke (stroke matching). */
const STROKE_POINTS = 16;
/** Points per character in the point cloud. */
const CLOUD_POINTS = 36;
/** Minimum cloud points for any stroke, so dakuten and dots are always represented. */
const CLOUD_MIN_PER_STROKE = 3;
/** Weight of the direction difference (0…2) relative to position (unit = glyph size). */
const STROKE_DIR_WEIGHT = 0.18;
const CLOUD_DIR_WEIGHT = 0.3;
/** Cost of leaving a stroke unmatched: base + factor × relative length. */
const SKIP_BASE = 0.14;
const SKIP_LEN = 0.45;
const MERGE_PENALTY = 0.03;
/**
 * Pen-up gap penalties (per glyph unit of jump). A drawing whose strokes split one template
 * stroke resumes near where it stopped, so a split across a long jump is implausible; a drawing
 * that merges two template strokes draws the connection as ink, so that gap costs less.
 */
const SPLIT_GAP_PENALTY = 0.3;
const MERGE_GAP_PENALTY = 0.06;
const REVERSE_PENALTY = 0.2;
const ORDER_PENALTY = 0.012;
const COUNT_PENALTY = 0.012;
const CLOUD_WEIGHT = 0.5;
const STROKE_WEIGHT = 0.5;
/** Added to the distance of characters of the other script when a script hint is given. */
const SCRIPT_PRIOR = 0.035;
/** Softmax temperature for confidences (calibrated on synthetic samples). */
const TEMPERATURE = 0.01;
/** Only the best templates by stroke distance get the (costlier) point-cloud comparison. */
const SHORTLIST = 36;

const SMALL_KANA = 'ぁぃぅぇぉゃゅょっゎァィゥェォャュョッヮ';
const LONG_MARK = 'ー';

/** @param {string} ch @returns {'hiragana'|'katakana'|null} */
function scriptOfChar(ch) {
  if (ch === LONG_MARK) return null;
  const cp = ch.codePointAt(0);
  if (cp >= 0x3041 && cp <= 0x309f) return 'hiragana';
  if (cp >= 0x30a0 && cp <= 0x30ff) return 'katakana';
  return null;
}

/* ------------------------------------------------------------------ geometry helpers */

/** Remove non-finite points and consecutive duplicates; returns arrays of [x, y]. */
function cleanStroke(stroke) {
  const out = [];
  for (const p of stroke || []) {
    const x = Array.isArray(p) ? p[0] : p?.x;
    const y = Array.isArray(p) ? p[1] : p?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== x || prev[1] !== y) out.push([x, y]);
  }
  return out;
}

function polyLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

/** Resample a polyline to `n` points evenly spaced along its length. */
function resample(pts, n) {
  if (pts.length === 1) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]]);
  const total = polyLength(pts);
  if (total === 0) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]]);
  const step = total / (n - 1);
  const out = [[pts[0][0], pts[0][1]]];
  let acc = 0;
  let i = 1;
  let prev = pts[0];
  while (out.length < n - 1 && i < pts.length) {
    const cur = pts[i];
    const seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    if (seg > 0 && acc + seg >= step) {
      const t = (step - acc) / seg;
      const q = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
      out.push(q);
      prev = q;
      acc = 0;
    } else {
      acc += seg;
      prev = cur;
      i++;
    }
  }
  const last = pts[pts.length - 1];
  while (out.length < n) out.push([last[0], last[1]]);
  return out;
}

/** Unit tangent at each point (central differences); [0, 0] where the stroke has no extent. */
function tangents(pts) {
  const n = pts.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    out[i] = len > 1e-9 ? [dx / len, dy / len] : [0, 0];
  }
  return out;
}

/**
 * Normalise strokes: centre the bounding box on the origin and scale uniformly so the longer
 * side is 1 (aspect preserved; a degenerate drawing keeps scale 1 relative to a min extent).
 * @param {number[][][]} strokes
 * @returns {number[][][]}
 */
function normalize(strokes) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const s of strokes) {
    for (const [x, y] of s) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const size = Math.max(maxX - minX, maxY - minY, 1e-6);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return strokes.map((s) => s.map(([x, y]) => [(x - cx) / size, (y - cy) / size]));
}

/** Euclidean length of (dx, dy); faster than Math.hypot in hot loops. */
const dist = (dx, dy) => Math.sqrt(dx * dx + dy * dy);

/* ------------------------------------------------------------------ features */

/** Resampled points and unit tangents of a polyline, as flat arrays. */
function sampled(pts) {
  const r = resample(pts, STROKE_POINTS);
  const t = tangents(r);
  const p = new Float64Array(STROKE_POINTS * 2);
  const u = new Float64Array(STROKE_POINTS * 2);
  for (let k = 0; k < STROKE_POINTS; k++) {
    p[2 * k] = r[k][0]; p[2 * k + 1] = r[k][1];
    u[2 * k] = t[k][0]; u[2 * k + 1] = t[k][1];
  }
  return { p, u };
}

/**
 * Stroke feature: STROKE_POINTS resampled points and unit tangents (flat arrays), the stroke's
 * length in glyph units and a direction reliability (0 for dots, 1 for real strokes).
 */
function strokeFeature(pts) {
  const len = polyLength(pts);
  return { ...sampled(pts), len, dirConf: Math.min(1, len / 0.06) };
}

/** Point cloud of CLOUD_POINTS points [x, y, ux, uy], spread over strokes by length. */
function cloudFeature(strokes, lengths) {
  const n = strokes.length;
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const counts = lengths.map(() => CLOUD_MIN_PER_STROKE);
  let left = CLOUD_POINTS - CLOUD_MIN_PER_STROKE * n;
  if (left < 0) {
    // Very many strokes: one point each, the rest by length.
    counts.fill(1);
    left = CLOUD_POINTS - n;
  }
  if (left > 0) {
    const want = lengths.map((l) => (l / total) * left);
    const floors = want.map(Math.floor);
    floors.forEach((f, i) => { counts[i] += f; });
    let rest = left - floors.reduce((a, b) => a + b, 0);
    const order = want.map((w, i) => [w - Math.floor(w), i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; rest > 0; k = (k + 1) % n, rest--) counts[order[k][1]] += 1;
  }
  const size = counts.reduce((a, b) => a + b, 0);
  const cloud = new Float64Array(size * 4);
  let o = 0;
  strokes.forEach((s, i) => {
    const r = counts[i] === 1 ? [s[0]] : resample(s, counts[i]);
    const t = r.length > 1 ? tangents(r) : [[0, 0]];
    const conf = Math.min(1, lengths[i] / 0.06);
    for (let k = 0; k < r.length; k++) {
      cloud[o++] = r[k][0]; cloud[o++] = r[k][1];
      cloud[o++] = t[k][0] * conf; cloud[o++] = t[k][1] * conf;
    }
  });
  return cloud;
}

/**
 * All features of a glyph (template or drawing).
 * @param {number[][][]} rawStrokes strokes of [x, y] in any space
 */
function prepare(rawStrokes) {
  const strokes = normalize(rawStrokes);
  const feats = strokes.map(strokeFeature);
  const lengths = feats.map((f) => f.len);
  // Each stroke joined with the next one (as if written without lifting the pen).
  const joined = strokes.slice(0, -1).map((s, i) => strokeFeature([...s, ...strokes[i + 1]]));
  const gaps = strokes.slice(0, -1).map((s, i) => {
    const a = s[s.length - 1];
    const b = strokes[i + 1][0];
    return dist(a[0] - b[0], a[1] - b[1]);
  });
  return { n: strokes.length, feats, joined, gaps, cloud: cloudFeature(strokes, lengths), totalLen: lengths.reduce((a, b) => a + b, 0) };
}

/* ------------------------------------------------------------------ stroke matching */

/** Mean point distance (position + weighted tangent) between two sampled strokes, in order. */
function forwardDist(a, b, w) {
  const K = STROKE_POINTS;
  let fp = 0; let fu = 0;
  for (let i = 0; i < 2 * K; i += 2) {
    fp += dist(a.p[i] - b.p[i], a.p[i + 1] - b.p[i + 1]);
    fu += dist(a.u[i] - b.u[i], a.u[i + 1] - b.u[i + 1]);
  }
  return (fp + w * fu) / K;
}

/** Distance between two stroke features: forward, or reversed with a penalty. */
function strokeDist(a, b) {
  const w = STROKE_DIR_WEIGHT * Math.min(a.dirConf, b.dirConf);
  const K = STROKE_POINTS;
  const fwd = forwardDist(a, b, w);
  if (fwd <= REVERSE_PENALTY) return fwd;
  let rp = 0; let ru = 0;
  for (let i = 0; i < 2 * K; i += 2) {
    const r = 2 * K - 2 - i;
    rp += dist(a.p[i] - b.p[r], a.p[i + 1] - b.p[r + 1]);
    ru += dist(a.u[i] + b.u[r], a.u[i + 1] + b.u[r + 1]);
  }
  return Math.min(fwd, (rp + w * ru) / K + REVERSE_PENALTY);
}

const skipCost = (f) => SKIP_BASE + SKIP_LEN * Math.min(f.len, 1.5);

/** Ordered DP alignment allowing 1:1, 2:1 (split), 1:2 (merge) and skips. */
function alignStrokes(g, t, d1) {
  const n = g.n;
  const m = t.n;
  const C = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  C[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue;
      let best = Infinity;
      if (i > 0 && j > 0) best = Math.min(best, C[i - 1][j - 1] + d1[i - 1][j - 1]);
      if (i > 0 && j > 1) best = Math.min(best, C[i - 1][j - 2] + strokeDist(g.feats[i - 1], t.joined[j - 2])
        + MERGE_PENALTY + MERGE_GAP_PENALTY * t.gaps[j - 2]);
      if (i > 1 && j > 0) best = Math.min(best, C[i - 2][j - 1] + strokeDist(g.joined[i - 2], t.feats[j - 1])
        + MERGE_PENALTY + SPLIT_GAP_PENALTY * g.gaps[i - 2]);
      if (i > 0) best = Math.min(best, C[i - 1][j] + skipCost(g.feats[i - 1]));
      if (j > 0) best = Math.min(best, C[i][j - 1] + skipCost(t.feats[j - 1]));
      C[i][j] = best;
    }
  }
  return C[n][m];
}

/** Hungarian method (minimum-cost assignment) on a square matrix; returns row → column. */
function hungarian(cost) {
  const n = cost.length;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const rowToCol = new Int32Array(n);
  for (let j = 1; j <= n; j++) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

const BIG = 1e6;

/** Order-free 1:1 assignment with skips, plus a small penalty per out-of-order pair. */
function assignStrokes(g, t, d1) {
  const n = g.n;
  const m = t.n;
  const S = n + m;
  const cost = Array.from({ length: S }, () => new Float64Array(S).fill(BIG));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) cost[i][j] = d1[i][j];
    cost[i][m + i] = skipCost(g.feats[i]);
  }
  for (let j = 0; j < m; j++) {
    cost[n + j][j] = skipCost(t.feats[j]);
    for (let k = 0; k < n; k++) cost[n + j][m + k] = 0;
  }
  const match = hungarian(cost);
  let total = 0;
  const pairs = [];
  for (let r = 0; r < S; r++) {
    total += cost[r][match[r]];
    if (r < n && match[r] < m) pairs.push(match[r]);
  }
  let inversions = 0;
  for (let a = 0; a < pairs.length; a++) for (let b = a + 1; b < pairs.length; b++) if (pairs[a] > pairs[b]) inversions++;
  return total + ORDER_PENALTY * inversions;
}

/** Stroke-level distance between a drawing and a template (per stroke). */
function strokeDistance(g, t) {
  const d1 = g.feats.map((a) => t.feats.map((b) => strokeDist(a, b)));
  const ordered = alignStrokes(g, t, d1);
  const free = assignStrokes(g, t, d1);
  return Math.min(ordered, free) / g.n;
}

/* ------------------------------------------------------------------ point cloud ($P-style) */

function cloudPass(a, b, start, n) {
  const matched = new Uint8Array(n);
  let sum = 0;
  let wsum = 0;
  let i = start;
  for (let step = 0; step < n; step++) {
    const ax = a[4 * i]; const ay = a[4 * i + 1]; const au = a[4 * i + 2]; const av = a[4 * i + 3];
    let min = Infinity;
    let idx = -1;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const o = 4 * j;
      const dx = ax - b[o]; const dy = ay - b[o + 1];
      const dp2 = dx * dx + dy * dy;
      if (dp2 >= min * min) continue;
      const du = au - b[o + 2]; const dv = av - b[o + 3];
      const d = Math.sqrt(dp2) + CLOUD_DIR_WEIGHT * Math.sqrt(du * du + dv * dv);
      if (d < min) { min = d; idx = j; }
    }
    matched[idx] = 1;
    const w = 1 - step / n;
    sum += w * min;
    wsum += w;
    i = (i + 1) % n;
  }
  return sum / wsum;
}

/** Greedy $P cloud distance (both directions, several start points). */
function cloudDistance(a, b) {
  const n = Math.min(a.length, b.length) / 4;
  const step = Math.max(1, Math.floor(Math.sqrt(n)));
  let best = Infinity;
  for (let s = 0; s < n; s += step) {
    best = Math.min(best, cloudPass(a, b, s, n), cloudPass(b, a, s, n));
  }
  return best;
}

/* ------------------------------------------------------------------ public API */

/**
 * @typedef {{ char: string, score: number, confidence: number }} Candidate
 *   score: similarity in (0, 1] (1 = identical to the template); confidence: softmax probability
 *   over all candidates (sums to ≈1 across the full list).
 */

/**
 * Create a recogniser from kana-strokes.json data.
 * @param {{ chars: Record<string, number[][][]> }} data
 * @param {{ includeSmall?: boolean }} [options] includeSmall: also return small kana (normally
 *   they are left to the 小 key because their shapes equal the full-size kana)
 * @returns {{ recognize(strokes: Array<Array<{x:number,y:number}|number[]>>, opts?: { script?: 'hiragana'|'katakana'|null, topN?: number }): Candidate[], chars: string[] }}
 */
export function createRecognizer(data, { includeSmall = false } = {}) {
  const entries = Object.entries(data?.chars || {});
  if (!entries.length) throw new Error('createRecognizer: no stroke templates');
  const templates = [];
  for (const [char, strokes] of entries) {
    if (!includeSmall && SMALL_KANA.includes(char)) continue;
    const clean = strokes.map(cleanStroke).filter((s) => s.length);
    if (!clean.length) continue;
    templates.push({ char, script: scriptOfChar(char), ...prepare(clean) });
  }

  function recognize(strokes, { script = null, topN = 5 } = {}) {
    const clean = (Array.isArray(strokes) ? strokes : []).map(cleanStroke).filter((s) => s.length);
    if (!clean.length) return [];
    const g = prepare(clean);
    const scored = templates.map((t) => {
      const prior = (script && t.script && t.script !== script ? SCRIPT_PRIOR : 0)
        + COUNT_PENALTY * Math.abs(g.n - t.n);
      return { t, ds: strokeDistance(g, t), prior };
    });
    scored.sort((a, b) => (a.ds + a.prior) - (b.ds + b.prior));
    const short = scored.slice(0, SHORTLIST).map((s) => {
      const dc = cloudDistance(g.cloud, s.t.cloud);
      return { char: s.t.char, d: CLOUD_WEIGHT * dc + STROKE_WEIGHT * s.ds + s.prior };
    });
    short.sort((a, b) => a.d - b.d);
    const best = short[0].d;
    let z = 0;
    for (const s of short) { s.e = Math.exp(-(s.d - best) / TEMPERATURE); z += s.e; }
    return short.slice(0, Math.max(1, topN)).map((s) => ({
      char: s.char,
      score: Math.round(Math.exp(-s.d * 6) * 1e4) / 1e4,
      confidence: Math.round((s.e / z) * 1e4) / 1e4,
    }));
  }

  return { recognize, chars: templates.map((t) => t.char) };
}

const loading = new Map();

/**
 * Fetch the stroke data and build a recogniser. Cached per URL for the page's lifetime; a failed
 * load is forgotten so the next call retries.
 * @param {string} [url]
 * @returns {Promise<ReturnType<typeof createRecognizer>>}
 */
export function loadRecognizer(url = '/data/kana-strokes.json') {
  if (!loading.has(url)) {
    const promise = fetch(url, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load handwriting data (HTTP ${res.status})`);
        return res.json();
      })
      .then((data) => createRecognizer(data))
      .catch((err) => { loading.delete(url); throw err; });
    loading.set(url, promise);
  }
  return loading.get(url);
}

/** Internals exposed for tests and tooling. */
export const _internals = Object.freeze({ normalize, resample, prepare, strokeDistance, cloudDistance, scriptOfChar });
