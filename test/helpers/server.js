/**
 * Test helpers: boot the app on an ephemeral port with an in-memory database and the fixture
 * word bank, plus a tiny cookie-jar HTTP client.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { openDatabase } from '../../server/db.js';
import { loadWordBank } from '../../server/services/wordbank.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_WORDS_PATH = path.join(HERE, '..', 'fixtures', 'words.fixture.json');

/** Minimal fetch client that keeps cookies and sends the CSRF header by default. */
export class Client {
  /** @param {string} baseUrl */
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    /** @type {Map<string, string>} */
    this.cookies = new Map();
  }

  /** Raw Cookie header value, or undefined when the jar is empty. */
  cookieHeader() {
    if (!this.cookies.size) return undefined;
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /**
   * Store cookies from a response (Max-Age=0 deletes).
   * @param {Response} res
   */
  absorb(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value || attrs.some((a) => /^max-age=0$/i.test(a))) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /**
   * Send a request.
   * @param {string} method
   * @param {string} urlPath
   * @param {unknown} [body] JSON body
   * @param {{ headers?: Record<string,string>, csrf?: boolean, rawBody?: string }} [opts]
   * @returns {Promise<{ status: number, headers: Headers, body: any, text: string, buffer: Buffer|null }>}
   */
  async request(method, urlPath, body, { headers = {}, csrf = true, rawBody } = {}) {
    const h = { Accept: 'application/json', ...headers };
    if (csrf) h['X-Requested-With'] = 'HiraKata';
    const cookie = this.cookieHeader();
    if (cookie) h.Cookie = cookie;
    const init = { method, headers: h, redirect: 'manual' };
    if (rawBody !== undefined) {
      h['Content-Type'] ??= 'application/json';
      init.body = rawBody;
    } else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(this.baseUrl + urlPath, init);
    this.absorb(res);
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('application/pdf')) {
      return { status: res.status, headers: res.headers, body: null, text: '', buffer: Buffer.from(await res.arrayBuffer()) };
    }
    const text = await res.text();
    let parsed = null;
    if (type.includes('application/json') && text) parsed = JSON.parse(text);
    return { status: res.status, headers: res.headers, body: parsed, text, buffer: null };
  }

  get(p, opts) { return this.request('GET', p, undefined, opts); }
  post(p, body = {}, opts) { return this.request('POST', p, body, opts); }
  patch(p, body = {}, opts) { return this.request('PATCH', p, body, opts); }
  del(p, body, opts) { return this.request('DELETE', p, body, opts); }
}

/**
 * Start the app on 127.0.0.1:0 with ':memory:' storage and the fixture bank.
 * @param {{ config?: Partial<import('../../server/config.js').Config> }} [options] config overrides
 * @returns {Promise<{ baseUrl: string, db: import('node:sqlite').DatabaseSync,
 *   bank: import('../../server/services/wordbank.js').WordBank, client: () => Client,
 *   errors: Error[], close: () => Promise<void> }>}
 */
export async function startTestServer({ config: overrides = {} } = {}) {
  const config = {
    ...loadConfig({ NODE_ENV: 'test' }),
    dbPath: ':memory:',
    wordsPath: FIXTURE_WORDS_PATH,
    authRateLimit: { windowMs: 60_000, max: 10_000 },
    loginFailureLimit: { windowMs: 60_000, max: 10_000 },
    ...overrides,
  };
  const bank = await loadWordBank(config.wordsPath);
  const db = openDatabase(config.dbPath);
  /** Unexpected (5xx) errors captured instead of printed. */
  const errors = [];
  const app = createApp({ config, db, wordbank: bank, log: (err) => errors.push(err) });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    db,
    bank,
    errors,
    client: () => new Client(baseUrl),
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        db.close();
        resolve();
      });
    }),
  };
}

let userSeq = 0;

/**
 * Register a fresh full account and return its client and user.
 * @param {{ client: () => Client }} ctx
 * @param {{ email?: string, password?: string, displayName?: string }} [fields]
 * @returns {Promise<{ client: Client, user: any, email: string, password: string }>}
 */
export async function registerUser(ctx, fields = {}) {
  userSeq += 1;
  const email = fields.email ?? `learner${userSeq}-${Date.now()}@example.com`;
  const password = fields.password ?? 'correct horse battery';
  const client = ctx.client();
  const res = await client.post('/api/auth/register', { displayName: fields.displayName ?? `Learner ${userSeq}`, email, password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`);
  return { client, user: res.body.user, email, password };
}
