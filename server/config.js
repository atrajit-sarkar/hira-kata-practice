/**
 * Runtime configuration from environment variables (SPEC §13).
 * @module server/config
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the project root (the folder that holds `server/`). */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} RateLimitConfig
 * @property {number} windowMs
 * @property {number} max
 */

/**
 * @typedef {object} Config
 * @property {number} port
 * @property {string} host
 * @property {string} dbPath        local SQLite file: absolute path, or ':memory:' (used when dbUrl is null)
 * @property {string|null} dbUrl     remote libSQL database (TURSO_DATABASE_URL, e.g. libsql://app-org.turso.io)
 * @property {string|null} dbAuthToken  token for dbUrl (TURSO_AUTH_TOKEN)
 * @property {string} wordsPath     absolute path of the word bank (.json.gz or .json)
 * @property {string} wordsFallbackPath  the other spelling of wordsPath (x.json.gz <-> x.json), tried when
 *           wordsPath does not exist
 * @property {string} nodeEnv
 * @property {boolean} isProduction
 * @property {boolean} cookieSecure
 * @property {boolean|number|string} trustProxy  value for Express `trust proxy`
 * @property {string} publicDir
 * @property {string} sharedDir
 * @property {RateLimitConfig} authRateLimit     requests per IP to login/register/guest/upgrade
 * @property {RateLimitConfig} loginFailureLimit failed password checks per IP + account
 */

/**
 * Parse a boolean-ish environment value.
 * @param {string|undefined} value
 * @returns {boolean|undefined} undefined when unset or unrecognised
 */
function parseBool(value) {
  if (value === undefined || value === '') return undefined;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return undefined;
}

/**
 * Parse TRUST_PROXY: a hop count, a boolean, or an Express trust string (e.g. "loopback").
 * Digits are a hop count, checked before booleans so "1" trusts exactly one proxy (e.g. Render's)
 * rather than every proxy, which would let clients spoof X-Forwarded-For; "0" trusts none.
 * @param {string|undefined} value
 * @returns {boolean|number|string}
 */
export function parseTrustProxy(value) {
  const v = value?.trim() ?? '';
  if (v === '') return false;
  if (/^\d+$/.test(v)) return Number(v) === 0 ? false : Number(v);
  return parseBool(v) ?? v;
}

/**
 * Resolve a path relative to the project root unless it is absolute or ':memory:'.
 * @param {string} p
 * @returns {string}
 */
function resolvePath(p) {
  if (p === ':memory:') return p;
  return path.isAbsolute(p) ? p : path.resolve(ROOT_DIR, p);
}

/**
 * The other accepted spelling of a word-bank path: `words.json.gz` <-> `words.json`.
 * @param {string} p
 * @returns {string}
 */
export function alternateWordsPath(p) {
  return /\.gz$/i.test(p) ? p.slice(0, -3) : `${p}.gz`;
}

/**
 * Build the configuration object.
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {Config}
 * @throws {Error} when PORT is not a valid port number
 */
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const port = env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT "${env.PORT}": expected an integer between 0 and 65535.`);
  }
  const wordsPath = resolvePath(env.WORDS_PATH || path.join('data', 'words.json.gz'));
  const dbUrl = env.TURSO_DATABASE_URL?.trim() || null;
  return {
    port,
    host: env.HOST || '127.0.0.1',
    dbPath: resolvePath(env.DB_PATH || path.join('data', 'hirakata.db')),
    dbUrl,
    dbAuthToken: dbUrl ? env.TURSO_AUTH_TOKEN?.trim() || null : null,
    wordsPath,
    wordsFallbackPath: alternateWordsPath(wordsPath),
    nodeEnv,
    isProduction,
    cookieSecure: parseBool(env.COOKIE_SECURE) ?? isProduction,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    publicDir: path.join(ROOT_DIR, 'public'),
    sharedDir: path.join(ROOT_DIR, 'shared'),
    authRateLimit: { windowMs: 10 * 60 * 1000, max: 30 },
    loginFailureLimit: { windowMs: 15 * 60 * 1000, max: 8 },
  };
}
