/**
 * Passwords (scrypt), sessions, cookies, auth middleware and user serialization (SPEC §6, §7.1).
 * @module server/auth
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { stmt } from './db.js';
import { ApiError } from './http.js';

const scrypt = promisify(crypto.scrypt);

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64 });
const MAX_SCRYPT_N = 1 << 20;

/** Session cookie name. */
export const SESSION_COOKIE = 'hk_sid';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Server-side session lifetimes by kind. */
export const SESSION_TTL = Object.freeze({ remember: 30 * DAY_MS, browser: DAY_MS, guest: 365 * DAY_MS });
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Hash a password as `scrypt$N$r$p$<saltB64>$<hashB64>`.
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

/**
 * Verify a password against a stored hash in constant time. Malformed hashes never match.
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isSafeInteger) || N < 2 || N > MAX_SCRYPT_N || r < 1 || p < 1) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!expected.length) return false;
  const actual = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
  return crypto.timingSafeEqual(actual, expected);
}

/** @type {Promise<string>|null} */
let dummyHash = null;

/**
 * Run a full scrypt verification against a throwaway hash so unknown emails take as long as known ones.
 * @param {string} password
 * @returns {Promise<false>}
 */
export async function verifyAgainstDummy(password) {
  dummyHash ??= hashPassword(crypto.randomBytes(18).toString('base64'));
  await verifyPassword(password, await dummyHash);
  return false;
}

/**
 * sha256 hex of a raw session token (what the DB stores).
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a session row and return its raw token.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @param {{ ttlMs: number, userAgent?: string, now?: Date }} options
 * @returns {string} raw token for the cookie
 */
export function createSession(db, userId, { ttlMs, userAgent, now = new Date() }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const nowIso = now.toISOString();
  stmt(db, `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent)
            VALUES (?, ?, ?, ?, ?, ?)`)
    .run(hashToken(token), userId, nowIso, new Date(now.getTime() + ttlMs).toISOString(), nowIso,
      userAgent ? userAgent.slice(0, 255) : null);
  return token;
}

/**
 * Parse a Cookie header into a name → value map (first occurrence wins).
 * @param {string|undefined} header
 * @returns {Record<string,string>}
 */
export function parseCookies(header) {
  /** @type {Record<string,string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || Object.hasOwn(out, name)) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Set the session cookie.
 * @param {import('express').Response} res
 * @param {string} token
 * @param {{ secure: boolean, maxAgeMs: number|null }} options null maxAge = browser-session cookie
 */
export function setSessionCookie(res, token, { secure, maxAgeMs }) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs !== null) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/**
 * Expire the session cookie in the browser.
 * @param {import('express').Response} res
 * @param {{ secure: boolean }} options
 */
export function clearSessionCookie(res, { secure }) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/**
 * Start a session for `userId`, replacing the request's current one, and set the cookie.
 * @param {{ db: import('node:sqlite').DatabaseSync, config: import('./config.js').Config }} deps
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {number} userId
 * @param {'remember'|'browser'|'guest'} kind
 */
export function startSession({ db, config }, req, res, userId, kind) {
  if (req.sessionId) stmt(db, 'DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  const ttlMs = SESSION_TTL[kind];
  const token = createSession(db, userId, { ttlMs, userAgent: req.get('User-Agent') });
  setSessionCookie(res, token, { secure: config.cookieSecure, maxAgeMs: kind === 'browser' ? null : ttlMs });
}

/**
 * Middleware resolving the `hk_sid` cookie to `req.user` (DB row) and `req.sessionId`.
 * @param {{ db: import('node:sqlite').DatabaseSync }} deps
 * @returns {import('express').RequestHandler}
 */
export function sessionMiddleware({ db }) {
  return (req, _res, next) => {
    req.user = null;
    req.sessionId = null;
    const token = parseCookies(req.get('Cookie'))[SESSION_COOKIE];
    if (!token || token.length > 128) return next();
    const now = new Date();
    const sessionId = hashToken(token);
    const row = stmt(db, `
      SELECT s.last_seen_at AS session_last_seen, u.*
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`).get(sessionId, now.toISOString());
    if (!row) return next();
    if (now.getTime() - Date.parse(row.session_last_seen) >= LAST_SEEN_THROTTLE_MS) {
      stmt(db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now.toISOString(), sessionId);
    }
    delete row.session_last_seen;
    req.user = row;
    req.sessionId = sessionId;
    return next();
  };
}

/**
 * Reject requests without a valid session.
 * @type {import('express').RequestHandler}
 */
export function requireAuth(req, _res, next) {
  next(req.user ? undefined : new ApiError('UNAUTHORIZED', 'Please log in to continue.'));
}

/** Default user settings (SPEC §7.1, §15.3). */
export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  kanaFont: 'textbook',
  sound: true,
  autoSpeak: false,
  showRomajiOnKeys: false,
  romajiInput: false,
  autoAdvance: false,
  keyboardVisible: true, // superseded by inputMethod (§15.3) but still accepted
  inputMethod: 'keys',
  keyLayout: 'shuffled',
  handwritingStrict: false,
  ttsRate: 0.9,
  ttsVoice: '',
  listenAutoplay: true,
  showKeyHeaders: false, // romaji column labels on the gojuon keyboard (SPEC 15.7)
});

const SETTING_ENUMS = Object.freeze({
  theme: ['system', 'light', 'dark'],
  kanaFont: ['textbook', 'gothic'],
  inputMethod: ['keys', 'handwriting', 'device'],
  keyLayout: ['shuffled', 'gojuon'],
});
/** Speech rate bounds (SPEC §15.3). */
export const TTS_RATE_RANGE = Object.freeze({ min: 0.5, max: 1.2 });
/** Longest accepted speech voice name. */
export const TTS_VOICE_MAX = 200;

/**
 * Validate one non-enum, non-boolean setting value.
 * @param {string} key
 * @param {unknown} v
 * @returns {string|null} error message, or null when valid
 */
function otherSettingProblem(key, v) {
  if (key === 'ttsRate') {
    return typeof v === 'number' && Number.isFinite(v) && v >= TTS_RATE_RANGE.min && v <= TTS_RATE_RANGE.max
      ? null : `Must be a number between ${TTS_RATE_RANGE.min} and ${TTS_RATE_RANGE.max}.`;
  }
  if (key === 'ttsVoice') {
    return typeof v === 'string' && [...v].length <= TTS_VOICE_MAX && !/[\u0000-\u001f\u007f]/.test(v)
      ? null : `Must be a voice name of at most ${TTS_VOICE_MAX} characters.`;
  }
  return typeof v === 'boolean' ? null : 'Must be true or false.';
}

/**
 * Validate a partial settings object.
 * @param {unknown} patch
 * @returns {{ value: Record<string, unknown>, errors: Record<string,string> }}
 */
export function validateSettingsPatch(patch) {
  /** @type {Record<string,string>} */
  const errors = {};
  /** @type {Record<string, unknown>} */
  const value = {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { value, errors: { settings: 'Settings must be an object.' } };
  }
  for (const [key, v] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) {
      errors[`settings.${key}`] = 'Unknown setting.';
    } else if (SETTING_ENUMS[key]) {
      if (SETTING_ENUMS[key].includes(v)) value[key] = v;
      else errors[`settings.${key}`] = `Must be one of: ${SETTING_ENUMS[key].join(', ')}.`;
    } else {
      const problem = otherSettingProblem(key, v);
      if (problem) errors[`settings.${key}`] = problem;
      else value[key] = v;
    }
  }
  return { value, errors };
}

/**
 * Stored settings merged over the defaults; invalid stored values fall back to defaults.
 * @param {string} json
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function readSettings(json) {
  let stored = {};
  try {
    stored = JSON.parse(json || '{}');
  } catch {
    stored = {};
  }
  return { ...DEFAULT_SETTINGS, ...validateSettingsPatch(stored).value };
}

/**
 * Public User shape.
 * @param {Record<string, any>} row users row
 * @returns {object}
 */
export function serializeUser(row) {
  return {
    id: row.id,
    email: row.email ?? null,
    displayName: row.display_name,
    isGuest: row.is_guest === 1,
    createdAt: row.created_at,
    settings: readSettings(row.settings),
  };
}
