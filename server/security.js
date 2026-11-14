/**
 * Security middleware: response headers/CSP, CSRF guard and an in-memory rate limiter (SPEC §6).
 * @module server/security
 */
import { ApiError } from './http.js';

/** Content-Security-Policy sent on every response. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
});

/**
 * Set the standard security headers on every response.
 * @type {import('express').RequestHandler}
 */
export function securityHeaders(_req, res, next) {
  res.set(SECURITY_HEADERS);
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Header value every state-changing API request must carry. */
export const CSRF_HEADER_VALUE = 'HiraKata';

/**
 * Reject state-changing requests without `X-Requested-With: HiraKata` or with a foreign Origin.
 * Mount under `/api`.
 * @type {import('express').RequestHandler}
 */
export function csrfGuard(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get('X-Requested-With') !== CSRF_HEADER_VALUE) {
    return next(new ApiError('FORBIDDEN', 'Missing or invalid request header. Please reload the page.'));
  }
  const origin = req.get('Origin');
  if (origin !== undefined && origin !== `${req.protocol}://${req.get('Host')}`) {
    return next(new ApiError('FORBIDDEN', 'Cross-origin requests are not allowed.'));
  }
  return next();
}

/**
 * Fixed-window in-memory counter keyed by an arbitrary string.
 */
export class RateLimiter {
  /**
   * @param {{ windowMs: number, max: number, now?: () => number }} options
   */
  constructor({ windowMs, max, now = Date.now }) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    /** @type {Map<string, { count: number, resetAt: number }>} */
    this.buckets = new Map();
    this.lastSweep = now();
  }

  /** @param {string} key @returns {{ count: number, resetAt: number }} live bucket */
  bucket(key) {
    const t = this.now();
    this.sweep(t);
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + this.windowMs };
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Drop expired buckets at most once per window so the map cannot grow unbounded. */
  sweep(t) {
    if (t - this.lastSweep < this.windowMs) return;
    this.lastSweep = t;
    for (const [key, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(key);
  }

  /** Seconds until the bucket for `key` resets (≥ 1). */
  retryAfter(key) {
    const b = this.buckets.get(key);
    return b ? Math.max(1, Math.ceil((b.resetAt - this.now()) / 1000)) : 1;
  }

  /** @param {string} key @returns {boolean} true when the key is over its limit */
  isLimited(key) {
    const b = this.buckets.get(key);
    return Boolean(b && b.resetAt > this.now() && b.count >= this.max);
  }

  /**
   * Count one event.
   * @param {string} key
   * @returns {boolean} true when the event is within the limit
   */
  hit(key) {
    const b = this.bucket(key);
    b.count += 1;
    return b.count <= this.max;
  }

  /** Forget `key` (e.g. after a successful login). */
  reset(key) {
    this.buckets.delete(key);
  }

  /**
   * The 429 error for `key`.
   * @param {string} key
   * @returns {ApiError}
   */
  error(key) {
    const seconds = this.retryAfter(key);
    const minutes = Math.ceil(seconds / 60);
    return new ApiError(
      'RATE_LIMITED',
      `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      { headers: { 'Retry-After': String(seconds) } },
    );
  }

  /**
   * Middleware counting every request per client IP.
   * @returns {import('express').RequestHandler}
   */
  perIp() {
    return (req, _res, next) => {
      const key = req.ip || 'unknown';
      next(this.hit(key) ? undefined : this.error(key));
    };
  }
}
