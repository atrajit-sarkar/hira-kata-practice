/**
 * HTTP error type, JSON error middleware and request validation helpers (SPEC §7).
 * @module server/http
 */

/** Default status for each API error code. */
const STATUS_BY_CODE = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TEST_NOT_ACTIVE: 409,
  QUESTION_NOT_CURRENT: 409,
  PAYLOAD_TOO_LARGE: 413,
  NOT_ENOUGH_WORDS: 422,
  NO_REVIEW_WORDS: 422,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
});

/** An error that is sent to the client as `{ error: { code, message, fields? } }`. */
export class ApiError extends Error {
  /**
   * @param {keyof typeof STATUS_BY_CODE} code
   * @param {string} message human readable
   * @param {{ fields?: Record<string,string>, status?: number, headers?: Record<string,string> }} [extra]
   */
  constructor(code, message, { fields, status, headers } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status ?? STATUS_BY_CODE[code] ?? 500;
    this.fields = fields;
    this.headers = headers;
  }
}

/**
 * @param {Record<string,string>} fields
 * @param {string} [message]
 * @returns {ApiError}
 */
export function validationError(fields, message = 'Please check the highlighted fields.') {
  return new ApiError('VALIDATION_ERROR', message, { fields });
}

/**
 * @param {string} [message]
 * @returns {ApiError}
 */
export function notFound(message = 'Not found.') {
  return new ApiError('NOT_FOUND', message);
}

/** Express handler for unknown `/api` routes. */
export function apiNotFound(req, _res, next) {
  next(new ApiError('NOT_FOUND', `No API endpoint ${req.method} ${req.originalUrl.split('?')[0]}.`));
}

/**
 * Build the final error middleware.
 * @param {{ isProduction: boolean, log?: (err: Error) => void }} options
 * @returns {import('express').ErrorRequestHandler}
 */
export function errorHandler({ isProduction, log = (err) => console.error(err) }) {
  // Express identifies error middleware by arity, so all four parameters must stay.
  return (err, req, res, next) => {
    const apiError = toApiError(err);
    if (apiError.status >= 500) log(err);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const body = { code: apiError.code, message: apiError.message };
    if (apiError.fields && Object.keys(apiError.fields).length) body.fields = apiError.fields;
    if (!isProduction && apiError.status >= 500 && err?.stack) body.stack = err.stack;
    if (apiError.headers) res.set(apiError.headers);
    res.status(apiError.status).set('Cache-Control', 'no-store').json({ error: body });
  };
}

/**
 * Map any thrown value (including body-parser errors) to an ApiError.
 * @param {unknown} err
 * @returns {ApiError}
 */
function toApiError(err) {
  if (err instanceof ApiError) return err;
  const type = /** @type {any} */ (err)?.type;
  if (type === 'entity.parse.failed') return new ApiError('VALIDATION_ERROR', 'The request body is not valid JSON.');
  if (type === 'entity.too.large') return new ApiError('PAYLOAD_TOO_LARGE', 'The request body is too large.');
  if (type === 'encoding.unsupported' || type === 'charset.unsupported') {
    return new ApiError('VALIDATION_ERROR', 'Unsupported request encoding.');
  }
  // Other client errors raised by Express internals (e.g. aborted requests, static file errors).
  const status = /** @type {any} */ (err)?.status ?? /** @type {any} */ (err)?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    if (status === 404) return new ApiError('NOT_FOUND', 'Not found.');
    if (status === 403) return new ApiError('FORBIDDEN', 'That action is not allowed.');
    return new ApiError('VALIDATION_ERROR', 'The request could not be processed.', { status });
  }
  return new ApiError('SERVER_ERROR', 'Something went wrong on our side. Please try again.');
}

/**
 * Collects per-field validation messages and throws them together.
 * Each reader returns the parsed value (or undefined when invalid).
 */
export class Validator {
  /** @param {unknown} source request body or query object */
  constructor(source) {
    this.source = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    /** @type {Record<string,string>} */
    this.errors = {};
  }

  /** @param {string} key @returns {boolean} */
  has(key) {
    return Object.hasOwn(this.source, key) && this.source[key] !== undefined && this.source[key] !== null;
  }

  /** Record an error for `key` (first message wins). */
  fail(key, message) {
    if (!this.errors[key]) this.errors[key] = message;
    return undefined;
  }

  /**
   * Read a trimmed string.
   * @param {string} key
   * @param {{ min?: number, max?: number, optional?: boolean, trim?: boolean, label?: string,
   *           noControl?: boolean }} [opts] lengths are counted in code points
   * @returns {string|undefined}
   */
  string(key, { min = 0, max = Infinity, optional = false, trim = true, label = 'This field', noControl = false } = {}) {
    if (!this.has(key)) return optional ? undefined : this.fail(key, `${label} is required.`);
    const raw = this.source[key];
    if (typeof raw !== 'string') return this.fail(key, `${label} must be text.`);
    const value = trim ? raw.trim() : raw;
    const length = [...value].length;
    if (length === 0 && min > 0) return this.fail(key, `${label} is required.`);
    if (length < min) return this.fail(key, `${label} must be at least ${min} characters.`);
    if (length > max) return this.fail(key, `${label} must be at most ${max} characters.`);
    if (noControl && /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
      return this.fail(key, `${label} contains invalid characters.`);
    }
    return value;
  }

  /**
   * Read an email address (trimmed, lowercased, ≤ 254 chars).
   * @param {string} key
   * @returns {string|undefined}
   */
  email(key) {
    const value = this.string(key, { max: 254, label: 'Email', min: 1 });
    if (value === undefined) return undefined;
    const lower = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return this.fail(key, 'Enter a valid email address.');
    return lower;
  }

  /**
   * Read a new password (8–128 chars, not trimmed).
   * @param {string} key
   * @returns {string|undefined}
   */
  newPassword(key) {
    return this.string(key, { min: 8, max: 128, trim: false, label: 'Password' });
  }

  /**
   * Read an integer; numeric strings are accepted (query parameters).
   * @param {string} key
   * @param {{ min?: number, max?: number, optional?: boolean, clamp?: boolean, label?: string }} [opts]
   * @returns {number|undefined}
   */
  int(key, { min = -Infinity, max = Infinity, optional = false, clamp = false, label = 'This value' } = {}) {
    if (!this.has(key) || this.source[key] === '') {
      return optional ? undefined : this.fail(key, `${label} is required.`);
    }
    const value = toInt(this.source[key]);
    if (value === undefined) return this.fail(key, `${label} must be a whole number.`);
    if (clamp) return Math.min(max, Math.max(min, value));
    if (value < min || value > max) return this.fail(key, `${label} must be between ${min} and ${max}.`);
    return value;
  }

  /**
   * Read one of a fixed set of values. Numbers in `allowed` also match numeric strings.
   * @template T
   * @param {string} key
   * @param {readonly T[]} allowed
   * @param {{ optional?: boolean, label?: string }} [opts]
   * @returns {T|undefined}
   */
  oneOf(key, allowed, { optional = false, label = 'This value' } = {}) {
    if (!this.has(key) || this.source[key] === '') {
      return optional ? undefined : this.fail(key, `${label} is required.`);
    }
    const raw = this.source[key];
    const match = allowed.find((a) => a === raw || (typeof a === 'number' && toInt(raw) === a));
    if (match === undefined) return this.fail(key, `${label} must be one of: ${allowed.join(', ')}.`);
    return match;
  }

  /**
   * Read a boolean (strict JSON boolean).
   * @param {string} key
   * @param {{ optional?: boolean, label?: string }} [opts]
   * @returns {boolean|undefined}
   */
  bool(key, { optional = false, label = 'This value' } = {}) {
    if (!this.has(key)) return optional ? undefined : this.fail(key, `${label} is required.`);
    const raw = this.source[key];
    if (typeof raw !== 'boolean') return this.fail(key, `${label} must be true or false.`);
    return raw;
  }

  /** Throw a VALIDATION_ERROR when any field failed. */
  assert(message) {
    if (Object.keys(this.errors).length) throw validationError(this.errors, message);
  }
}

/**
 * Parse an integer from a number or a decimal string.
 * @param {unknown} raw
 * @returns {number|undefined}
 */
function toInt(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) ? raw : undefined;
  if (typeof raw === 'string' && /^-?\d{1,15}$/.test(raw.trim())) return Number(raw.trim());
  return undefined;
}

/**
 * Parse a positive integer route id; anything else is a 404 (the resource cannot exist).
 * @param {string} raw
 * @param {string} [what]
 * @returns {number}
 */
export function parseId(raw, what = 'Resource') {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,14}$/.test(raw)) throw notFound(`${what} not found.`);
  return Number(raw);
}

/**
 * The request body as a plain object (`{}` when absent).
 * @param {import('express').Request} req
 * @returns {Record<string, unknown>}
 */
export function bodyOf(req) {
  const body = req.body;
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError('VALIDATION_ERROR', 'The request body must be a JSON object.');
  }
  return body;
}
