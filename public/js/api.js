/**
 * REST client for the HiraKata API (SPEC §7, §10.2).
 * @module api
 */

/** Error thrown for any non-2xx response or network failure. */
export class ApiError extends Error {
  /**
   * @param {{status: number, code: string, message: string, fields?: Record<string,string>}} info
   */
  constructor({ status, code, message, fields }) {
    super(message);
    this.name = 'ApiError';
    /** HTTP status (0 for network errors). */
    this.status = status;
    /** Machine code, e.g. VALIDATION_ERROR, UNAUTHORIZED, NETWORK_ERROR. */
    this.code = code;
    /** Per-field validation messages. */
    this.fields = fields || {};
  }
}

/** Paths whose 401 is an expected answer, not an expired session. */
const SILENT_401 = new Set(['/api/auth/me', '/api/auth/login']);

/**
 * Perform a JSON request against the API.
 * @param {string} method HTTP method
 * @param {string} path absolute path starting with /api
 * @param {object} [body] JSON body (omitted for GET/HEAD)
 * @returns {Promise<any>} parsed JSON, or null for 204
 * @throws {ApiError}
 */
export async function request(method, path, body) {
  const headers = { Accept: 'application/json', 'X-Requested-With': 'HiraKata' };
  const init = { method, headers, credentials: 'same-origin' };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }
  if (res.status === 204) return null;
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const err = data?.error || {};
    const apiError = new ApiError({
      status: res.status,
      code: err.code || (res.status === 401 ? 'UNAUTHORIZED' : 'SERVER_ERROR'),
      message: err.message || defaultMessage(res.status),
      fields: err.fields,
    });
    if (res.status === 401 && !SILENT_401.has(path.split('?')[0])) {
      window.dispatchEvent(new CustomEvent('hk:unauthorized', { detail: { path } }));
    }
    throw apiError;
  }
  return data;
}

function defaultMessage(status) {
  if (status === 401) return 'Please log in to continue.';
  if (status === 403) return 'That action is not allowed.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  return 'Something went wrong. Please try again.';
}

/**
 * Build a query string, skipping null/undefined/'' values.
 * @param {Record<string, any>} [params]
 * @returns {string} "" or "?a=1&b=2"
 */
export function toQuery(params = {}) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

const enc = encodeURIComponent;
const tz = () => new Date().getTimezoneOffset();

export const api = {
  auth: {
    /** @returns {Promise<{user: object}>} */
    me: () => request('GET', '/api/auth/me'),
    /** @param {{displayName: string, email: string, password: string}} body */
    register: (body) => request('POST', '/api/auth/register', body),
    /** @param {{email: string, password: string, remember: boolean}} body */
    login: (body) => request('POST', '/api/auth/login', body),
    guest: () => request('POST', '/api/auth/guest', {}),
    /** @param {{displayName: string, email: string, password: string}} body */
    upgrade: (body) => request('POST', '/api/auth/upgrade', body),
    logout: () => request('POST', '/api/auth/logout', {}),
    /** @param {{displayName?: string, settings?: object}} patch */
    updateMe: (patch) => request('PATCH', '/api/auth/me', patch),
    /** @param {{currentPassword: string, newPassword: string}} body */
    changePassword: (body) => request('POST', '/api/auth/password', body),
    /** @param {{password?: string}} [body] */
    deleteAccount: (body = {}) => request('DELETE', '/api/auth/me', body),
    /** @param {{password?: string}} [body] */
    resetProgress: (body = {}) => request('DELETE', '/api/progress', body),
  },
  tests: {
    /** @param {'all'|'active'|'completed'|'closed'} [status] */
    list: (status = 'all') => request('GET', `/api/tests${toQuery({ status })}`),
    /** @param {object} config TestConfig (+ optional title) */
    create: (config) => request('POST', '/api/tests', config),
    get: (id) => request('GET', `/api/tests/${enc(id)}`),
    state: (id) => request('GET', `/api/tests/${enc(id)}/state`),
    /** @param {'script'|'spelling'} type */
    hint: (id, qid, type) => request('POST', `/api/tests/${enc(id)}/questions/${enc(qid)}/hint`, { type }),
    /** @param {{answer: string, timeMs: number, hint2From?: number, hint2Revealed?: number}} payload */
    answer: (id, qid, payload) => request('POST', `/api/tests/${enc(id)}/questions/${enc(qid)}/answer`, payload),
    /** @param {{timeMs: number}} payload */
    skip: (id, qid, payload) => request('POST', `/api/tests/${enc(id)}/questions/${enc(qid)}/skip`, payload),
    close: (id) => request('POST', `/api/tests/${enc(id)}/close`, {}),
    rename: (id, title) => request('PATCH', `/api/tests/${enc(id)}`, { title }),
    remove: (id) => request('DELETE', `/api/tests/${enc(id)}`),
    /** @returns {string} URL of the per-test PDF (use as an <a href download>) */
    reportUrl: (id) => `/api/tests/${enc(id)}/report.pdf`,
  },
  stats: {
    /** @param {{tz?: number, days?: number}} [opts] tz defaults to the browser offset */
    overview: ({ tz: offset = tz(), days } = {}) => request('GET', `/api/stats/overview${toQuery({ tz: offset, days })}`),
  },
  vocab: {
    /** @param {{filter?, script?, q?, sort?, page?, pageSize?}} [params] */
    list: (params = {}) => request('GET', `/api/vocab${toQuery(params)}`),
    star: (wordId, starred) => request('POST', `/api/vocab/${enc(wordId)}/star`, { starred }),
  },
  words: {
    meta: () => request('GET', '/api/words/meta'),
    /** @param {{script?, level?, pos?, jlpt?}} [params] */
    count: (params = {}) => request('GET', `/api/words/count${toQuery(params)}`),
    sample: (n = 8) => request('GET', `/api/words/sample${toQuery({ n })}`),
  },
  reports: {
    /** @returns {string} URL of the overall PDF report */
    overallUrl: ({ tz: offset = tz() } = {}) => `/api/reports/overall.pdf${toQuery({ tz: offset })}`,
  },
};
