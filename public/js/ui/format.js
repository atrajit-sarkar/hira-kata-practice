/**
 * Locale-aware formatting helpers (English UI).
 * @module ui/format
 */

const LOCALE = 'en-US';
const numberFmt = new Intl.NumberFormat(LOCALE);
const compactFmt = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
const relativeFmt = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/**
 * Format a 0..1 ratio as a percentage.
 * @param {number|null|undefined} ratio
 * @param {{digits?: number, fallback?: string}} [opts]
 * @returns {string} e.g. percent(0.857) → "86%"
 */
export function percent(ratio, { digits = 0, fallback = '—' } = {}) {
  if (ratio == null || !Number.isFinite(ratio)) return fallback;
  return `${(ratio * 100).toFixed(digits)}%`;
}

/**
 * @param {number} n
 * @returns {string} e.g. 12345 → "12,345"
 */
export function number(n) {
  return Number.isFinite(n) ? numberFmt.format(n) : '—';
}

/**
 * @param {number} n
 * @returns {string} e.g. 12345 → "12.3K"
 */
export function compact(n) {
  return Number.isFinite(n) ? compactFmt.format(n) : '—';
}

/**
 * Human duration.
 * @param {number} ms
 * @returns {string} "45s", "4m 12s", "2h 5m"
 */
export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Format an ISO date.
 * @param {string|Date} iso
 * @param {{time?: boolean, style?: 'short'|'medium'|'long'}} [opts]
 * @returns {string} e.g. "Nov 14, 2026" or "Nov 14, 2026, 3:04 PM"
 */
export function date(iso, { time = false, style = 'medium' } = {}) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = { dateStyle: style };
  if (time) opts.timeStyle = 'short';
  return new Intl.DateTimeFormat(LOCALE, opts).format(d);
}

const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * Relative time from now.
 * @param {string|Date} iso
 * @returns {string} e.g. "2 hours ago", "yesterday", "just now"
 */
export function relative(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffSec = (d.getTime() - Date.now()) / 1000;
  if (Math.abs(diffSec) < 45) return 'just now';
  for (const [unit, sec] of UNITS) {
    if (Math.abs(diffSec) >= sec || unit === 'minute') {
      return relativeFmt.format(Math.round(diffSec / sec), unit);
    }
  }
  return 'just now';
}

/**
 * Local calendar date key.
 * @param {Date} [d]
 * @returns {string} "YYYY-MM-DD" in the browser's local time zone
 */
export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pluralize a count with a noun.
 * @param {number} n
 * @param {string} singular
 * @param {string} [plural]
 * @returns {string} e.g. plural(3, 'word') → "3 words"
 */
export function plural(n, singular, plural = `${singular}s`) {
  return `${number(n)} ${n === 1 ? singular : plural}`;
}
