/**
 * Design tokens and value formatters shared by the PDF report renderers.
 *
 * Colours mirror the light theme of public/css/tokens.css (SPEC §11) so a printed
 * report looks like the app. Units are PDF points (1/72 in).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');

/** Embedded font files (Noto Sans JP static instances, SIL OFL). */
export const FONT_FILES = Object.freeze({
  regular: path.join(FONT_DIR, 'NotoSansJP-Regular.ttf'),
  bold: path.join(FONT_DIR, 'NotoSansJP-Bold.ttf'),
});

/** Registered pdfkit font names. */
export const FONTS = Object.freeze({ regular: 'NotoJP', bold: 'NotoJP-Bold' });

export const COLORS = Object.freeze({
  ink: '#1b1a17',
  secondary: '#52514e',
  muted: '#6f6d68',
  faint: '#9a998f',
  paper: '#ffffff',
  surface2: '#fbfaf7',
  surface3: '#f0eee8',
  zebra: '#f8f7f3',
  border: '#e4e2db',
  borderStrong: '#d2d0c8',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  brand: '#4f46e5',
  brandDark: '#3730a3',
  brandDeep: '#312e81',
  brandSoft: '#eef0ff',
  brandLine: '#c7cdfe',
  accent: '#d13c2f',
  hira: '#2a78d6',
  hiraSoft: '#e3eefb',
  kata: '#eb6834',
  kataSoft: '#fdebe3',
  success: '#0ca30c',
  successText: '#006300',
  successSoft: '#e4f5e4',
  danger: '#d03b3b',
  dangerText: '#b42323',
  dangerSoft: '#fbe9e9',
  warning: '#fab219',
  warningSoft: '#fef3d6',
  warningText: '#7a5200',
  /** Listen mode and the romaji hint (SPEC §15.2). */
  listen: '#7c3aed',
  listenSoft: '#f1e9fe',
  listenText: '#5b21b6',
  /** Input-method accents (keys use the brand indigo). */
  pen: '#0d7f86',
  device: '#5b6472',
  seqLight: '#b7d3f6',
  seq: '#2a78d6',
});

export const PAGE = Object.freeze({
  size: 'A4',
  width: 595.28,
  height: 841.89,
  margin: 44,
  headerHeight: 96,
  /** Space reserved at the bottom of every page for the footer. */
  footerHeight: 40,
});

/** Grade letter → hanko kanji (SPEC §8). */
export const GRADE_KANJI = Object.freeze({ S: '秀', A: '優', B: '良', C: '可', D: '不可' });

/** Grade letter → short English descriptor. */
export const GRADE_LABEL = Object.freeze({
  S: 'Outstanding', A: 'Excellent', B: 'Good', C: 'Pass', D: 'Keep practising',
});

/** Attribution text from SPEC §14, used when the report data carries none. */
export const DEFAULT_ATTRIBUTION =
  'Dictionary data: JMdict © Electronic Dictionary Research and Development Group, used under CC BY-SA 4.0';
export const DEFAULT_JLPT_ATTRIBUTION =
  'JLPT levels: Jonathan Waller (tanos.co.uk), CC BY, via stephenmk/yomitan-jlpt-vocab';
/** SPEC §15.6: the handwriting recogniser's stroke data. */
export const DEFAULT_KANJIVG_ATTRIBUTION = 'Handwriting stroke data: KanjiVG © Ulrich Apel, CC BY-SA 3.0';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** True for a finite number. */
export function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Coerce to a finite number, falling back to `fallback`. */
export function num(value, fallback = 0) {
  return isNum(value) ? value : fallback;
}

/** The plain-object entries of `list` (anything else yields []). */
export function objects(list) {
  return Array.isArray(list) ? list.filter((item) => item !== null && typeof item === 'object') : [];
}

/** Clamp `value` into [min, max]. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 0.857 → "86%"; non-numbers → "–". */
export function percent(ratio) {
  return isNum(ratio) ? `${Math.round(clamp(ratio, 0, 1) * 100)}%` : '–';
}

/** 12345 → "12,345". */
export function formatNumber(value) {
  return Math.round(num(value)).toLocaleString('en-US');
}

/** Milliseconds → "1h 04m", "4m 12s", "38s". */
export function duration(ms) {
  const totalSeconds = Math.max(0, Math.round(num(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/**
 * Shift an ISO timestamp into the learner's local time. `tzOffset` follows
 * `Date#getTimezoneOffset()` (minutes, UTC − local), so local = utc − tzOffset.
 * Returns a Date whose UTC fields hold the local wall-clock time, or null.
 */
function toLocal(iso, tzOffset) {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return new Date(time - num(tzOffset) * 60_000);
}

/** ISO → "14 Nov 2026" in the learner's local time ("–" when missing). */
export function formatDate(iso, tzOffset) {
  const d = toLocal(iso, tzOffset);
  if (!d) return '–';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** ISO → "14 Nov 2026, 09:30" in the learner's local time. */
export function formatDateTime(iso, tzOffset) {
  const d = toLocal(iso, tzOffset);
  if (!d) return '–';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(iso, tzOffset)}, ${hh}:${mm}`;
}

/** "2026-11-14" (a local date key) → "14 Nov". */
export function formatDayKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  if (!match) return '';
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ''}`.trim();
}

/** Upper-case the first letter. */
export function capitalize(text) {
  const s = String(text ?? '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Collapse whitespace/control characters so user text renders on one line. */
export function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
}
