import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeKana, soundKey, toHiragana, toKatakana } from '../shared/kana.js';
import { alternateWordsPath, loadConfig } from '../server/config.js';
import { selectRandomWords } from '../server/services/selection.js';
import { buildTestReportData } from '../server/services/reportData.js';
import { testSummary } from '../server/services/serializers.js';
import { WordBankError, loadWordBank, loadWordBankWithFallback } from '../server/services/wordbank.js';
import { addDays, computeStreaks, localDate } from '../server/services/stats.js';
import { createClient } from '@libsql/client';
import { MIGRATIONS, SCHEMA_VERSION, fileUrl, housekeeping, migrate, openDatabase, schemaVersion } from '../server/db.js';
import { FIXTURE_WORDS_PATH, registerUser, removeDbDir, startTestServer } from './helpers/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PDF_AVAILABLE = fs.existsSync(path.join(ROOT, 'server', 'report', 'pdf.js'));

/** @type {Awaited<ReturnType<typeof startTestServer>>} */
let ctx;
before(async () => {
  ctx = await startTestServer();
});
after(async () => {
  assert.deepEqual(ctx.errors.map(String), [], 'no unexpected server errors');
  await ctx.close();
});

const expectError = (res, status, code) => {
  assert.equal(res.status, status, `expected ${status} ${code}, got ${res.status}: ${res.text}`);
  assert.equal(res.body?.error?.code, code);
  assert.equal(typeof res.body.error.message, 'string');
};

/** Expected kana of a question, read straight from the DB. */
const kanaOf = async (qid) => (await ctx.db.get('SELECT kana FROM test_questions WHERE id = ?', [qid])).kana;
/** Romaji snapshot of a question, read straight from the DB. */
const kanaOfRomaji = async (qid) => (await ctx.db.get('SELECT romaji FROM test_questions WHERE id = ?', [qid])).romaji;

/** Create a test and return the response body (asserting 201). */
async function newTest(client, body = {}) {
  const res = await client.post('/api/tests', body);
  assert.equal(res.status, 201, res.text);
  return res.body;
}

/** Answer the current question; `answerFor(kana)` returns the raw answer. */
async function answerCurrent(client, testId, current, answerFor = (k) => k, extra = {}) {
  const res = await client.post(`/api/tests/${testId}/questions/${current.id}/answer`,
    { answer: answerFor(await kanaOf(current.id)), timeMs: 1000, ...extra });
  assert.equal(res.status, 200, res.text);
  return res.body;
}

/** Replace the last character to produce a spelling mistake. */
const misspell = (kana) => {
  const chars = [...kana];
  chars[chars.length - 1] = chars.at(-1) === 'あ' ? 'い' : 'あ';
  return chars.join('');
};

describe('auth', () => {
  it('registers, sets a 30-day session cookie and returns the user', async () => {
    const client = ctx.client();
    const res = await client.post('/api/auth/register',
      { displayName: '  Atrajit ', email: ' Ada@Example.COM ', password: 'longenough1' });
    assert.equal(res.status, 201, res.text);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('hk_sid='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=2592000/);
    assert.doesNotMatch(cookie, /Secure/);
    const { user } = res.body;
    assert.equal(user.email, 'ada@example.com');
    assert.equal(user.displayName, 'Atrajit');
    assert.equal(user.isGuest, false);
    assert.ok(Date.parse(user.createdAt));
    assert.deepEqual(user.settings, {
      theme: 'system', kanaFont: 'textbook', sound: true, autoSpeak: false, showRomajiOnKeys: false,
      romajiInput: false, autoAdvance: false, keyboardVisible: true,
      inputMethod: 'keys', keyLayout: 'shuffled', handwritingStrict: false, ttsRate: 0.9, ttsVoice: '', listenAutoplay: true, showKeyHeaders: false,
    });
    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.user, user);
    const row = (await ctx.db.get('SELECT password_hash FROM users WHERE id = ?', [user.id]));
    assert.match(row.password_hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('rejects a duplicate email (case-insensitive) with 409', async () => {
    const { email } = await registerUser(ctx);
    const res = await ctx.client().post('/api/auth/register',
      { displayName: 'Twin', email: email.toUpperCase(), password: 'longenough1' });
    expectError(res, 409, 'CONFLICT');
    assert.ok(res.body.error.fields.email);
  });

  it('validates register input with per-field messages', async () => {
    const res = await ctx.client().post('/api/auth/register', {});
    expectError(res, 400, 'VALIDATION_ERROR');
    assert.deepEqual(Object.keys(res.body.error.fields).sort(), ['displayName', 'email', 'password']);
    const bad = await ctx.client().post('/api/auth/register',
      { displayName: 'a\u0007b', email: 'not-an-email', password: 'short' });
    assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['displayName', 'email', 'password']);
    const long = await ctx.client().post('/api/auth/register',
      { displayName: 'x'.repeat(41), email: `${'a'.repeat(250)}@b.co`, password: 'p'.repeat(129) });
    assert.deepEqual(Object.keys(long.body.error.fields).sort(), ['displayName', 'email', 'password']);
    const blank = await ctx.client().post('/api/auth/register', { displayName: '   ', email: 'a@b.co', password: 'longenough1' });
    assert.ok(blank.body.error.fields.displayName);
  });

  it('logs in, honours remember, and rejects wrong credentials with the same 401', async () => {
    const { email, password } = await registerUser(ctx);
    const wrong = await ctx.client().post('/api/auth/login', { email, password: 'wrong password' });
    expectError(wrong, 401, 'UNAUTHORIZED');
    assert.equal(wrong.body.error.message, 'Email or password is incorrect.');
    const unknown = await ctx.client().post('/api/auth/login', { email: 'nobody@example.com', password });
    assert.equal(unknown.body.error.message, 'Email or password is incorrect.');
    expectError(await ctx.client().post('/api/auth/login', {}), 400, 'VALIDATION_ERROR');

    const browser = ctx.client();
    const res = await browser.post('/api/auth/login', { email: email.toUpperCase(), password, remember: false });
    assert.equal(res.status, 200, res.text);
    assert.doesNotMatch(res.headers.getSetCookie()[0], /Max-Age/);
    const remembered = await ctx.client().post('/api/auth/login', { email, password, remember: true });
    assert.match(remembered.headers.getSetCookie()[0], /Max-Age=2592000/);

    const sessions = (await ctx.db.all('SELECT created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at', [res.body.user.id])).map((s) => Date.parse(s.expires_at) - Date.parse(s.created_at));
    assert.ok(sessions.includes(24 * 3600 * 1000));
    assert.ok(sessions.includes(30 * 24 * 3600 * 1000));
    const last = (await ctx.db.get('SELECT last_login_at FROM users WHERE id = ?', [res.body.user.id]));
    assert.ok(last.last_login_at);
  });

  it('logs out: 204, cookie cleared, session deleted', async () => {
    const { client } = await registerUser(ctx);
    const token = client.cookies.get('hk_sid');
    const res = await client.post('/api/auth/logout');
    assert.equal(res.status, 204);
    assert.match(res.headers.getSetCookie()[0], /hk_sid=;.*Max-Age=0/);
    expectError(await client.get('/api/auth/me'), 401, 'UNAUTHORIZED');
    const replay = ctx.client();
    replay.cookies.set('hk_sid', token);
    expectError(await replay.get('/api/auth/me'), 401, 'UNAUTHORIZED');
    assert.equal((await ctx.client().post('/api/auth/logout')).status, 204, 'logout without a session is fine');
  });

  it('requires the CSRF header and a same-origin Origin on state-changing requests', async () => {
    const { client } = await registerUser(ctx);
    expectError(await client.post('/api/auth/logout', {}, { csrf: false }), 403, 'FORBIDDEN');
    expectError(await client.post('/api/tests', {}, { csrf: false, headers: { 'X-Requested-With': 'XMLHttpRequest' } }), 403, 'FORBIDDEN');
    expectError(await client.post('/api/tests', {}, { headers: { Origin: 'https://evil.example' } }), 403, 'FORBIDDEN');
    expectError(await client.post('/api/tests', {}, { headers: { Origin: 'null' } }), 403, 'FORBIDDEN');
    const same = await client.post('/api/tests', { count: 5 }, { headers: { Origin: ctx.baseUrl } });
    assert.equal(same.status, 201, same.text);
    assert.equal((await client.get('/api/auth/me', { csrf: false })).status, 200, 'GET needs no header');
  });

  it('creates guests and upgrades them in place, keeping their data', async () => {
    const guest = ctx.client();
    const res = await guest.post('/api/auth/guest');
    assert.equal(res.status, 201);
    assert.equal(res.body.user.isGuest, true);
    assert.equal(res.body.user.displayName, 'Guest');
    assert.equal(res.body.user.email, null);
    assert.match(res.headers.getSetCookie()[0], /Max-Age=31536000/);
    const { test, current } = await newTest(guest, { count: 5 });
    await answerCurrent(guest, test.id, current);

    const email = `upgraded-${Date.now()}@example.com`;
    const up = await guest.post('/api/auth/upgrade', { displayName: 'Hana', email, password: 'longenough1' });
    assert.equal(up.status, 200, up.text);
    assert.equal(up.body.user.id, res.body.user.id);
    assert.equal(up.body.user.isGuest, false);
    assert.equal(up.body.user.displayName, 'Hana');
    const list = await guest.get('/api/tests');
    assert.equal(list.body.tests.length, 1);
    assert.equal(list.body.tests[0].answeredCount, 1);

    const again = await guest.post('/api/auth/upgrade', { displayName: 'Hana', email: 'x@example.com', password: 'longenough1' });
    expectError(again, 409, 'CONFLICT');
    const relog = await ctx.client().post('/api/auth/login', { email, password: 'longenough1' });
    assert.equal(relog.body.user.id, res.body.user.id);

    const other = ctx.client();
    await other.post('/api/auth/guest');
    const taken = await other.post('/api/auth/upgrade', { displayName: 'Copy', email, password: 'longenough1' });
    expectError(taken, 409, 'CONFLICT');
    assert.ok(taken.body.error.fields.email);
    expectError(await ctx.client().post('/api/auth/upgrade', {}), 401, 'UNAUTHORIZED');
  });
});
describe('account management', () => {
  it('PATCH /api/auth/me merges settings and validates them', async () => {
    const { client } = await registerUser(ctx);
    const res = await client.patch('/api/auth/me', { displayName: ' Kenji ', settings: { theme: 'dark', sound: false } });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.user.displayName, 'Kenji');
    assert.equal(res.body.user.settings.theme, 'dark');
    assert.equal(res.body.user.settings.sound, false);
    const second = await client.patch('/api/auth/me', { settings: { kanaFont: 'gothic' } });
    assert.equal(second.body.user.settings.theme, 'dark', 'earlier settings kept');
    assert.equal(second.body.user.settings.kanaFont, 'gothic');

    const bad = await client.patch('/api/auth/me',
      { displayName: '', settings: { theme: 'neon', sound: 'yes', colour: 'red' } });
    expectError(bad, 400, 'VALIDATION_ERROR');
    assert.deepEqual(Object.keys(bad.body.error.fields).sort(),
      ['displayName', 'settings.colour', 'settings.sound', 'settings.theme']);
    expectError(await client.patch('/api/auth/me', { settings: [] }), 400, 'VALIDATION_ERROR');
    const unchanged = await client.get('/api/auth/me');
    assert.equal(unchanged.body.user.settings.theme, 'dark', 'failed PATCH changes nothing');
    assert.equal(unchanged.body.user.displayName, 'Kenji');
  });

  it('changing the password revokes other sessions only', async () => {
    const { client, email, password } = await registerUser(ctx);
    const other = ctx.client();
    await other.post('/api/auth/login', { email, password, remember: true });
    const wrong = await client.post('/api/auth/password', { currentPassword: 'nope nope', newPassword: 'brand new pass' });
    expectError(wrong, 400, 'VALIDATION_ERROR');
    assert.ok(wrong.body.error.fields.currentPassword);
    expectError(await client.post('/api/auth/password', { currentPassword: password, newPassword: 'short' }),
      400, 'VALIDATION_ERROR');
    const ok = await client.post('/api/auth/password', { currentPassword: password, newPassword: 'brand new pass' });
    assert.equal(ok.status, 204, ok.text);
    assert.equal((await client.get('/api/auth/me')).status, 200);
    expectError(await other.get('/api/auth/me'), 401, 'UNAUTHORIZED');
    expectError(await ctx.client().post('/api/auth/login', { email, password }), 401, 'UNAUTHORIZED');
    assert.equal((await ctx.client().post('/api/auth/login', { email, password: 'brand new pass' })).status, 200);

    const guest = ctx.client();
    await guest.post('/api/auth/guest');
    expectError(await guest.post('/api/auth/password', { currentPassword: 'x', newPassword: 'brand new pass' }),
      409, 'CONFLICT');
  });

  it('DELETE /api/auth/me requires the password and removes everything', async () => {
    const { client, user, email, password } = await registerUser(ctx);
    const { test, current } = await newTest(client, { count: 5 });
    await answerCurrent(client, test.id, current);
    expectError(await client.del('/api/auth/me', {}), 400, 'VALIDATION_ERROR');
    expectError(await client.del('/api/auth/me', { password: 'wrong password' }), 400, 'VALIDATION_ERROR');
    const res = await client.del('/api/auth/me', { password });
    assert.equal(res.status, 204);
    assert.match(res.headers.getSetCookie()[0], /Max-Age=0/);
    expectError(await client.get('/api/auth/me'), 401, 'UNAUTHORIZED');
    expectError(await ctx.client().post('/api/auth/login', { email, password }), 401, 'UNAUTHORIZED');
    for (const table of ['users', 'sessions', 'tests', 'vocab_progress', 'char_stats']) {
      const column = table === 'users' ? 'id' : 'user_id';
      assert.equal((await ctx.db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, [user.id])).n, 0, table);
    }
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM test_questions WHERE test_id = ?', [test.id])).n, 0);

    const guest = ctx.client();
    await guest.post('/api/auth/guest');
    assert.equal((await guest.del('/api/auth/me')).status, 204, 'guests need no password (no body)');
  });

  it('DELETE /api/progress wipes tests, vocab and kana stats but keeps the account', async () => {
    const { client, user, password } = await registerUser(ctx);
    const { test, current } = await newTest(client, { count: 5 });
    await answerCurrent(client, test.id, current);
    expectError(await client.del('/api/progress', { password: 'wrong password' }), 400, 'VALIDATION_ERROR');
    assert.equal((await client.del('/api/progress', { password })).status, 204);
    for (const table of ['tests', 'vocab_progress', 'char_stats']) {
      assert.equal((await ctx.db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [user.id])).n, 0, table);
    }
    assert.equal((await client.get('/api/auth/me')).status, 200);
    const stats = await client.get('/api/stats/overview');
    assert.equal(stats.body.totals.answered, 0);
    assert.equal(stats.body.totals.tests, 0);
  });
});

describe('rate limiting', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let limited;
  before(async () => {
    limited = await startTestServer({
      config: { authRateLimit: { windowMs: 60_000, max: 4 }, loginFailureLimit: { windowMs: 60_000, max: 2 } },
    });
  });
  after(() => limited.close());

  it('limits failed logins per IP + email, even with the right password afterwards', async () => {
    const { email, password } = await registerUser(limited);
    const c = limited.client();
    expectError(await c.post('/api/auth/login', { email, password: 'bad password 1' }), 401, 'UNAUTHORIZED');
    expectError(await c.post('/api/auth/login', { email, password: 'bad password 2' }), 401, 'UNAUTHORIZED');
    const blocked = await c.post('/api/auth/login', { email, password });
    expectError(blocked, 429, 'RATE_LIMITED');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });

  it('limits auth endpoints per IP', async () => {
    const c = limited.client();
    // 1 register (previous test) + 3 logins already used 4 of 4; any further auth call is limited.
    const res = await c.post('/api/auth/guest');
    expectError(res, 429, 'RATE_LIMITED');
    assert.ok(Number(res.headers.get('retry-after')) > 0);
    assert.equal((await c.get('/api/words/meta')).status, 200, 'other endpoints unaffected');
  });
});

describe('http plumbing', () => {
  const SECURITY_HEADERS = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cross-origin-opener-policy': 'same-origin',
  };

  it('sends security headers on API and static responses', async () => {
    const c = ctx.client();
    for (const p of ['/api/words/meta', '/api/nope', '/', '/shared/kana.js']) {
      const res = await c.get(p);
      for (const [h, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(h), v, `${p} ${h}`);
      const csp = res.headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'; script-src 'self';/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.equal(res.headers.get('x-powered-by'), null);
    }
  });

  it('returns JSON 404 for unknown API routes and 400 for malformed JSON', async () => {
    const c = ctx.client();
    expectError(await c.get('/api/nope'), 404, 'NOT_FOUND');
    expectError(await c.post('/api/tests/1/whatever'), 401, 'UNAUTHORIZED');
    expectError(await c.request('POST', '/api/auth/login', undefined, { rawBody: '{"email":' }), 400, 'VALIDATION_ERROR');
    expectError(await c.request('POST', '/api/auth/login', undefined, { rawBody: JSON.stringify({ email: 'x'.repeat(70_000) }) }),
      413, 'PAYLOAD_TOO_LARGE');
    expectError(await c.request('POST', '/api/auth/login', undefined, { rawBody: '"a string"' }), 400, 'VALIDATION_ERROR');
  });

  it('serves the SPA and the shared kana engine', async () => {
    const c = ctx.client();
    const index = await c.get('/', { headers: { Accept: 'text/html' } });
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.equal(index.headers.get('cache-control'), 'no-cache');
    const kana = await c.get('/shared/kana.js');
    assert.equal(kana.status, 200);
    assert.match(kana.headers.get('content-type'), /javascript/);
    const page = await c.get('/dashboard', { headers: { Accept: 'text/html' } });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/#/dashboard');
    assert.equal((await c.get('/missing.png', { headers: { Accept: 'image/png' } })).status, 404);
    assert.equal((await c.get('/api/words/meta')).headers.get('cache-control'), 'no-store');
  });
});
describe('creating tests', () => {
  /** @type {import('./helpers/server.js').Client} */
  let client;
  before(async () => {
    ({ client } = await registerUser(ctx));
  });

  const questionsOf = async (testId) => (await ctx.db.all('SELECT q.*, t.user_id FROM test_questions q JOIN tests t ON t.id = q.test_id WHERE test_id = ? ORDER BY position', [testId]));
  const distinctKana = (bank, filter) => new Set(bank.filter(filter).map((w) => w.kana)).size;

  it('defaults to a mixed 20-word test split evenly between scripts', async () => {
    const { test, current } = await newTest(client);
    assert.equal(test.title, 'Mixed · All levels · 20 words');
    assert.deepEqual(test.config, {
      script: 'mixed', level: 'all', pos: 'any', jlpt: 'any', pool: 'all', mode: 'romaji', count: 20, source: 'random', sourceTestId: null,
    });
    assert.equal(test.romajiHintCount, 0);
    assert.equal(test.status, 'active');
    assert.equal(test.totalQuestions, 20);
    assert.equal(test.maxScore, 2000);
    assert.equal(test.grade, null);
    assert.deepEqual(Object.keys(current).sort(), ['answer', 'hint1Used', 'hint2Used', 'id', 'mode', 'position', 'romaji',
      'romajiHintUsed', 'script', 'speak', 'status']);
    assert.equal(current.mode, 'romaji');
    assert.equal(current.speak, null);
    assert.equal(current.romajiHintUsed, false);
    assert.equal(current.romaji, await kanaOfRomaji(current.id));
    assert.equal(current.position, 0);
    assert.equal(current.answer, null);
    assert.equal(current.script, null);
    const qs = await questionsOf(test.id);
    assert.equal(qs.filter((q) => q.script === 'hiragana').length, 10);
    assert.equal(qs.filter((q) => q.script === 'katakana').length, 10);
    assert.equal(new Set(qs.map((q) => q.kana)).size, 20);
    for (const q of qs) {
      const w = ctx.bank.get(q.word_id);
      assert.equal(q.kana, w.kana);
      assert.equal(q.romaji, w.romaji);
    }
  });

  it('applies script / level / pos / jlpt filters and builds descriptive titles', async () => {
    const cases = [
      [{ script: 'katakana', level: 1, count: 10 }, 'Katakana · Beginner · 5 words', { script: 'katakana', level: 1 }],
      [{ script: 'hiragana', jlpt: 5, count: 20 }, 'Hiragana · JLPT N5 · 20 words', { script: 'hiragana', jlpt: 5 }],
      [{ script: 'mixed', pos: 'verb', count: 5 }, 'Mixed · All levels · Verbs · 2 words', { pos: 'verb' }],
      [{ script: 'hiragana', level: '2', jlpt: '4', count: '5' }, 'Hiragana · Intermediate · JLPT N4 · 2 words',
        { script: 'hiragana', level: 2, jlpt: 4 }],
      [{ script: 'mixed', level: 3, count: 10 }, 'Mixed · Advanced · 5 words', { level: 3 }],
    ];
    for (const [body, title, filter] of cases) {
      const { test } = await newTest(client, body);
      assert.equal(test.title, title);
      const qs = await questionsOf(test.id);
      assert.equal(qs.length, test.totalQuestions);
      assert.equal(test.config.count, qs.length);
      for (const q of qs) assert.ok(ctx.bank.matches(ctx.bank.get(q.word_id), filter), `${q.kana} matches ${title}`);
    }
  });

  it('reduces the count to the pool and fills a mixed shortfall from the other script', async () => {
    const hiragana = distinctKana(ctx.bank, { script: 'hiragana' });
    const katakana = distinctKana(ctx.bank, { script: 'katakana' });
    const { test } = await newTest(client, { script: 'mixed', count: 40 });
    const qs = await questionsOf(test.id);
    assert.equal(qs.length, 40);
    assert.equal(qs.filter((q) => q.script === 'katakana').length, katakana, 'all katakana used');
    assert.equal(qs.filter((q) => q.script === 'hiragana').length, 40 - katakana);

    const all = await newTest(client, { script: 'hiragana', count: 100 });
    assert.equal(all.test.totalQuestions, hiragana, 'homophones collapse to one question');
    const kana = (await questionsOf(all.test.id)).map((q) => q.kana);
    assert.equal(new Set(kana).size, kana.length, 'no duplicate kana');
    assert.equal(kana.filter((k) => k === 'かみ').length, 1);
  });

  it('respects a custom title and validates the config', async () => {
    const { test } = await newTest(client, { title: '  Evening drill ', count: 5 });
    assert.equal(test.title, 'Evening drill');
    const bad = await client.post('/api/tests', { script: 'romaji', level: 4, pos: 'particle', jlpt: 6, count: 4, source: 'x', title: 't'.repeat(81) });
    expectError(bad, 400, 'VALIDATION_ERROR');
    assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['count', 'jlpt', 'level', 'pos', 'script', 'source', 'title']);
    expectError(await client.post('/api/tests', { count: 101 }), 400, 'VALIDATION_ERROR');
    expectError(await client.post('/api/tests', { count: 7.5 }), 400, 'VALIDATION_ERROR');
    expectError(await client.post('/api/tests', { source: 'test-mistakes' }), 400, 'VALIDATION_ERROR');
  });

  it('returns 422 NOT_ENOUGH_WORDS when no word matches', async () => {
    const res = await client.post('/api/tests', { script: 'katakana', pos: 'expression' });
    expectError(res, 422, 'NOT_ENOUGH_WORDS');
    expectError(await client.post('/api/tests', { script: 'hiragana', jlpt: 1 }), 422, 'NOT_ENOUGH_WORDS');
  });

  it('weights unseen words more heavily than seen ones', async () => {
    const fresh = await registerUser(ctx);
    const pool = ctx.bank.filter({ script: 'katakana' });
    const seen = pool.slice(0, 9).map((w) => w.id);
    await ctx.db.batch(seen.map((id) => [`INSERT INTO vocab_progress (user_id, word_id, seen, correct, last_result, last_seen_at)
      VALUES (?, ?, 1, 1, 'correct', ?)`, [fresh.user.id, id, new Date().toISOString()]]));
    let seenPicks = 0;
    let total = 0;
    for (let i = 0; i < 30; i += 1) {
      const { test } = await newTest(fresh.client, { script: 'katakana', count: 5 });
      const qs = await questionsOf(test.id);
      total += qs.length;
      seenPicks += qs.filter((q) => seen.includes(q.word_id)).length;
    }
    // Half the pool is "seen". Uniform sampling gives a 0.50 share; the weights give ≈ 0.33
    // (σ ≈ 0.04 over 150 picks), so 0.45 is a > 3σ bound that still clearly beats uniform.
    assert.ok(seenPicks / total < 0.45, `seen share ${seenPicks}/${total}`);
  });

  it('selection weights match Efraimidis–Spirakis expectations (seeded)', () => {
    let seed = 42;
    const rng = () => { // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pool = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, kana: id, romaji: id, script: 'hiragana', jlpt: i === 0 ? 5 : null }));
    const firstPick = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 8000; i += 1) {
      firstPick[selectRandomWords({ pool, count: 1, script: 'hiragana', jlptAny: true, seenIds: new Set(['b']), rng })[0].id] += 1;
    }
    // Weights: a = 3 × 2 (unseen, JLPT) = 6, b = 1 (seen), c = d = 3 → P(a) = 6/13, P(b) = 1/13.
    assert.ok(Math.abs(firstPick.a / 8000 - 6 / 13) < 0.02, JSON.stringify(firstPick));
    assert.ok(Math.abs(firstPick.b / 8000 - 1 / 13) < 0.02, JSON.stringify(firstPick));
    const all = selectRandomWords({ pool, count: 10, script: 'hiragana', jlptAny: false, seenIds: new Set(), rng });
    assert.deepEqual(all.map((w) => w.id).sort(), ['a', 'b', 'c', 'd']);
  });

  it('lists tests newest first with a status filter', async () => {
    const { client: c } = await registerUser(ctx);
    const a = (await newTest(c, { count: 5 })).test;
    const b = (await newTest(c, { count: 5 })).test;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await c.post(`/api/tests/${a.id}/close`);
    const all = await c.get('/api/tests');
    assert.deepEqual(all.body.tests.map((t) => t.id), [a.id, b.id], 'closing touched a → newest');
    assert.deepEqual((await c.get('/api/tests?status=active')).body.tests.map((t) => t.id), [b.id]);
    assert.deepEqual((await c.get('/api/tests?status=closed')).body.tests.map((t) => t.id), [a.id]);
    assert.deepEqual((await c.get('/api/tests?status=completed')).body.tests, []);
    expectError(await c.get('/api/tests?status=paused'), 400, 'VALIDATION_ERROR');
    expectError(await ctx.client().get('/api/tests'), 401, 'UNAUTHORIZED');
  });
});
describe('playing a test', () => {
  /** @type {import('./helpers/server.js').Client} */
  let client;
  before(async () => {
    ({ client } = await registerUser(ctx));
  });
  const url = (t, q, action) => `/api/tests/${t}/questions/${q}/${action}`;

  it('resumes through /state and hides the answer until hint 2', async () => {
    const { test, current } = await newTest(client, { count: 5 });
    const state = await client.get(`/api/tests/${test.id}/state`);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body.current, current);
    assert.equal(state.body.lastResult, null);
    assert.equal(state.body.questions.length, 5);
    assert.deepEqual(Object.keys(state.body.questions[0]).sort(), ['id', 'position', 'status']);
    const detail = await client.get(`/api/tests/${test.id}`);
    assert.deepEqual(Object.keys(detail.body.questions[0]).sort(), ['id', 'position', 'romaji', 'status']);
    assert.ok(!JSON.stringify(detail.body.questions).includes(await kanaOf(current.id)));

    const answered = await answerCurrent(client, test.id, current);
    const resumed = await client.get(`/api/tests/${test.id}/state`);
    assert.deepEqual(resumed.body.current, answered.next);
    assert.equal(resumed.body.lastResult.id, current.id);
    assert.equal(resumed.body.questions[0].status, 'correct');
    const full = await client.get(`/api/tests/${test.id}`);
    assert.equal(full.body.questions[0].expected, await kanaOf(current.id));
    assert.equal(full.body.questions[0].word.id, (await ctx.db.get('SELECT word_id FROM test_questions WHERE id = ?', [current.id])).word_id);
  });

  it('hints are idempotent and counted once', async () => {
    const { test, current } = await newTest(client, { count: 5 });
    const kana = await kanaOf(current.id);
    const h1 = await client.post(url(test.id, current.id, 'hint'), { type: 'script' });
    assert.equal(h1.status, 200, h1.text);
    assert.equal(h1.body.question.hint1Used, true);
    assert.equal(h1.body.question.script, (await ctx.db.get('SELECT script FROM test_questions WHERE id = ?', [current.id])).script);
    assert.equal(h1.body.question.answer, null);
    assert.deepEqual((await client.post(url(test.id, current.id, 'hint'), { type: 'script' })).body, h1.body);
    const h2 = await client.post(url(test.id, current.id, 'hint'), { type: 'spelling' });
    assert.equal(h2.body.question.hint2Used, true);
    assert.equal(h2.body.question.answer, kana);
    await client.post(url(test.id, current.id, 'hint'), { type: 'spelling' });
    const summary = (await client.get(`/api/tests/${test.id}/state`)).body;
    assert.equal(summary.test.hint1Count, 1);
    assert.equal(summary.test.hint2Count, 1);
    assert.deepEqual(summary.current, h2.body.question, 'hints restored on resume');
    expectError(await client.post(url(test.id, current.id, 'hint'), { type: 'kanji' }), 400, 'VALIDATION_ERROR');
    expectError(await client.post(url(test.id, current.id, 'hint'), {}), 400, 'VALIDATION_ERROR');
  });

  it('scores correct, wrong, script and empty answers with diffs and word info', async () => {
    const { test, current } = await newTest(client, { script: 'hiragana', count: 5 });
    // Full-width spaces and padding are normalised away.
    const r1 = await answerCurrent(client, test.id, current, (k) => `\u3000${k} `);
    assert.equal(r1.result.status, 'correct');
    assert.equal(r1.result.errorType, null);
    assert.equal(r1.result.points, 100);
    assert.equal(r1.result.userAnswer, r1.result.expected);
    assert.ok(r1.result.diff.every((d) => d.op === 'match'));
    assert.equal(r1.result.timeMs, 1000);
    assert.ok(r1.result.word.meaning.length > 0);
    assert.ok(Array.isArray(r1.result.word.homophones));
    assert.equal(r1.firstSeen, true);
    assert.equal(r1.completed, false);
    assert.equal(r1.test.currentStreak, 1);
    assert.equal(r1.next.position, 1);

    const r2 = await answerCurrent(client, test.id, r1.next, misspell);
    assert.equal(r2.result.status, 'wrong');
    assert.equal(r2.result.errorType, 'spelling');
    assert.equal(r2.result.points, 0);
    assert.equal(r2.result.diff.at(-1).op, 'sub');
    assert.equal(r2.test.currentStreak, 0);
    assert.equal(r2.test.bestStreak, 1);

    const r3 = await answerCurrent(client, test.id, r2.next, (k) => toKatakana(k));
    assert.equal(r3.result.status, 'wrong');
    assert.equal(r3.result.errorType, 'script');

    const r4 = await answerCurrent(client, test.id, r3.next, () => '  ');
    assert.equal(r4.result.errorType, 'empty');
    assert.equal(r4.result.userAnswer, '');
    assert.ok(r4.result.diff.every((d) => d.op === 'del'));

    assert.equal(r4.test.score, 100);
    assert.equal(r4.test.correctCount, 1);
    assert.equal(r4.test.wrongCount, 3);
    assert.equal(r4.test.answeredCount, 4);
    assert.equal(r4.test.accuracy, 0.25);
    assert.equal(r4.test.scorePercent, 0.25);
    assert.equal(r4.test.grade, 'D');
    assert.equal(r4.test.timeSpentMs, 4000);
    expectError(await client.post(url(test.id, r4.next.id, 'answer'), { answer: 'あ'.repeat(65) }), 400, 'VALIDATION_ERROR');
    expectError(await client.post(url(test.id, r4.next.id, 'answer'), { answer: 42 }), 400, 'VALIDATION_ERROR');
  });

  it('applies hint penalties with hint2From / hint2Revealed rules', async () => {
    const { test, current } = await newTest(client, { script: 'katakana', count: 5 });
    const pts = (len, hint1, revealed) => Math.max(10, 100 - (hint1 ? 20 : 0) - Math.max(10, Math.round(60 * revealed / len)));

    // Both hints, explicit counts.
    let q = current;
    let len = [...await kanaOf(q.id)].length;
    await client.post(url(test.id, q.id, 'hint'), { type: 'script' });
    await client.post(url(test.id, q.id, 'hint'), { type: 'spelling' });
    let r = await answerCurrent(client, test.id, q, (k) => k, { hint2From: 1, hint2Revealed: 2 });
    assert.equal(r.result.points, pts(len, true, 2));
    assert.equal(r.result.hint2Revealed, 2);
    assert.equal((await ctx.db.get('SELECT hint2_from FROM test_questions WHERE id = ?', [q.id])).hint2_from, 1);

    // Hint 2 without hint2Revealed → len − hint2From.
    q = r.next;
    len = [...await kanaOf(q.id)].length;
    await client.post(url(test.id, q.id, 'hint'), { type: 'spelling' });
    r = await answerCurrent(client, test.id, q, (k) => k, { hint2From: 2 });
    assert.equal(r.result.hint2Revealed, len - 2);
    assert.equal(r.result.points, pts(len, false, len - 2));

    // Hint 2 with neither field → everything revealed; values above len are clamped.
    q = r.next;
    len = [...await kanaOf(q.id)].length;
    await client.post(url(test.id, q.id, 'hint'), { type: 'spelling' });
    r = await answerCurrent(client, test.id, q, (k) => k, { hint2Revealed: 99 });
    assert.equal(r.result.hint2Revealed, len);
    assert.equal(r.result.points, 40);

    // hint2 fields are ignored when hint 2 was not used.
    q = r.next;
    r = await answerCurrent(client, test.id, q, (k) => k, { hint2From: 0, hint2Revealed: 3 });
    assert.equal(r.result.points, 100);
    assert.equal(r.result.hint2Revealed, 0);
    assert.equal((await ctx.db.get('SELECT hint2_from FROM test_questions WHERE id = ?', [q.id])).hint2_from, null);

    // Wrong answers score 0 regardless of hints.
    q = r.next;
    await client.post(url(test.id, q.id, 'hint'), { type: 'script' });
    r = await answerCurrent(client, test.id, q, misspell);
    assert.equal(r.result.points, 0);
    assert.equal(r.test.hint1Count, 2);
    assert.equal(r.test.hint2Count, 3);
    expectError(await client.post(url(test.id, q.id, 'answer'), { answer: 'x', hint2From: 'a' }), 400, 'VALIDATION_ERROR');
  });
});
describe('test lifecycle', () => {
  /** @type {import('./helpers/server.js').Client} */
  let client;
  before(async () => {
    ({ client } = await registerUser(ctx));
  });
  const url = (t, q, action) => `/api/tests/${t}/questions/${q}/${action}`;

  it('skips, rejects non-current questions, and completes on the last answer', async () => {
    const { test, current } = await newTest(client, { script: 'hiragana', count: 5 });
    const ids = (await client.get(`/api/tests/${test.id}/state`)).body.questions.map((q) => q.id);
    expectError(await client.post(url(test.id, ids[1], 'answer'), { answer: 'ねこ' }), 409, 'QUESTION_NOT_CURRENT');
    expectError(await client.post(url(test.id, ids[1], 'hint'), { type: 'script' }), 409, 'QUESTION_NOT_CURRENT');
    expectError(await client.post(url(test.id, 999999, 'answer'), { answer: 'ねこ' }), 404, 'NOT_FOUND');

    const skip = await client.post(url(test.id, current.id, 'skip'), { timeMs: 99_999_999 });
    assert.equal(skip.status, 200, skip.text);
    assert.equal(skip.body.result.status, 'skipped');
    assert.equal(skip.body.result.errorType, 'skipped');
    assert.equal(skip.body.result.userAnswer, null);
    assert.equal(skip.body.result.points, 0);
    assert.equal(skip.body.result.timeMs, 3_600_000, 'timeMs clamped');
    assert.equal(skip.body.test.skippedCount, 1);
    expectError(await client.post(url(test.id, current.id, 'skip'), {}), 409, 'QUESTION_NOT_CURRENT');
    expectError(await client.post(url(test.id, current.id, 'answer'), { answer: 'ねこ' }), 409, 'QUESTION_NOT_CURRENT');

    let next = skip.body.next;
    let last;
    while (next) {
      last = await answerCurrent(client, test.id, next);
      next = last.next;
    }
    assert.equal(last.completed, true);
    assert.equal(last.next, null);
    assert.equal(last.test.status, 'completed');
    assert.ok(last.test.finishedAt);
    assert.equal(last.test.currentIndex, 5);
    assert.equal(last.test.score, 400);
    assert.equal(last.test.bestStreak, 4);
    assert.equal(last.test.grade, 'B');
    expectError(await client.post(url(test.id, ids[4], 'answer'), { answer: 'x' }), 409, 'TEST_NOT_ACTIVE');
    const state = await client.get(`/api/tests/${test.id}/state`);
    assert.equal(state.body.current, null);
    assert.equal(state.body.lastResult.position, 4);
    const closed = await client.post(`/api/tests/${test.id}/close`);
    assert.equal(closed.body.test.status, 'completed', 'closing a completed test changes nothing');
  });

  it('closes active tests idempotently', async () => {
    const { test, current } = await newTest(client, { count: 5 });
    await answerCurrent(client, test.id, current);
    const first = await client.post(`/api/tests/${test.id}/close`);
    assert.equal(first.status, 200);
    assert.equal(first.body.test.status, 'closed');
    assert.ok(first.body.test.finishedAt);
    const second = await client.post(`/api/tests/${test.id}/close`);
    assert.deepEqual(second.body.test, first.body.test);
    const state = await client.get(`/api/tests/${test.id}/state`);
    expectError(await client.post(url(test.id, state.body.questions[1].id, 'answer'), { answer: 'x' }), 409, 'TEST_NOT_ACTIVE');
    expectError(await client.post(url(test.id, state.body.questions[1].id, 'hint'), { type: 'script' }), 409, 'TEST_NOT_ACTIVE');
    expectError(await client.post(url(test.id, state.body.questions[1].id, 'skip'), {}), 409, 'TEST_NOT_ACTIVE');
    assert.equal(state.body.current, null);
    assert.equal(state.body.test.answeredCount, 1);
  });

  it('renames and deletes tests', async () => {
    const { test } = await newTest(client, { count: 5 });
    const renamed = await client.patch(`/api/tests/${test.id}`, { title: '  Kana sprint  ' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.test.title, 'Kana sprint');
    // Renaming is not practice activity: it must not move an old test to the top of the list.
    const old = '2020-01-02T03:04:05.000Z';
    await ctx.db.run('UPDATE tests SET updated_at = ? WHERE id = ?', [old, test.id]);
    const again = await client.patch(`/api/tests/${test.id}`, { title: 'Autumn warm-up' });
    assert.equal(again.body.test.title, 'Autumn warm-up');
    assert.equal(again.body.test.updatedAt, old, 'rename keeps updatedAt');
    expectError(await client.patch(`/api/tests/${test.id}`, { title: '   ' }), 400, 'VALIDATION_ERROR');
    expectError(await client.patch(`/api/tests/${test.id}`, { title: 'x'.repeat(81) }), 400, 'VALIDATION_ERROR');
    expectError(await client.patch(`/api/tests/${test.id}`, {}), 400, 'VALIDATION_ERROR');
    assert.equal((await client.del(`/api/tests/${test.id}`)).status, 204);
    expectError(await client.get(`/api/tests/${test.id}`), 404, 'NOT_FOUND');
    expectError(await client.del(`/api/tests/${test.id}`), 404, 'NOT_FOUND');
    assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM test_questions WHERE test_id = ?', [test.id])).n, 0);
    expectError(await client.get('/api/tests/abc'), 404, 'NOT_FOUND');
    expectError(await client.get('/api/tests/0'), 404, 'NOT_FOUND');
  });

  it("returns 404 for another user's test everywhere", async () => {
    const { test, current } = await newTest(client, { count: 5 });
    const { client: intruder } = await registerUser(ctx);
    const base = `/api/tests/${test.id}`;
    const attempts = [
      ['GET', base], ['GET', `${base}/state`], ['POST', `${base}/close`], ['PATCH', base, { title: 'Mine' }],
      ['DELETE', base], ['POST', url(test.id, current.id, 'hint'), { type: 'script' }],
      ['POST', url(test.id, current.id, 'answer'), { answer: 'x' }], ['POST', url(test.id, current.id, 'skip'), {}],
      ['GET', `${base}/report.pdf`],
      ['POST', '/api/tests', { source: 'test-mistakes', sourceTestId: test.id }],
    ];
    for (const [method, p, body] of attempts) {
      expectError(await intruder.request(method, p, body), 404, 'NOT_FOUND');
    }
    const own = await client.get(`${base}/state`);
    assert.equal(own.body.test.status, 'active');
    assert.equal(own.body.current.id, current.id, 'nothing changed');
    assert.equal(own.body.current.hint1Used, false);
  });

  it('builds review and test-mistakes tests from missed words', async () => {
    const { client: c } = await registerUser(ctx);
    expectError(await c.post('/api/tests', { source: 'review' }), 422, 'NO_REVIEW_WORDS');
    const { test, current } = await newTest(c, { script: 'hiragana', count: 5 });
    const outcomes = [misspell, (k) => k, null, misspell, (k) => k]; // wrong, correct, skip, wrong, correct
    let q = current;
    const missed = [];
    for (const how of outcomes) {
      const kana = await kanaOf(q.id);
      const body = how
        ? (await c.post(url(test.id, q.id, 'answer'), { answer: how(kana), timeMs: 500 })).body
        : (await c.post(url(test.id, q.id, 'skip'), { timeMs: 500 })).body;
      if (body.result.status !== 'correct') missed.push(kana);
      q = body.next;
    }
    const retry = await newTest(c, { source: 'test-mistakes', sourceTestId: test.id });
    assert.equal(retry.test.title, `Retry · ${test.title}`);
    assert.equal(retry.test.totalQuestions, 3);
    assert.equal(retry.test.config.sourceTestId, test.id);
    const retryKana = (await ctx.db.all('SELECT kana FROM test_questions WHERE test_id = ? ORDER BY position', [retry.test.id])).map((r) => r.kana);
    assert.deepEqual(retryKana, missed, 'mistakes in original order');

    const review = await newTest(c, { source: 'review', count: 5 });
    assert.equal(review.test.title, 'Review · 3 words');
    assert.equal(review.test.config.count, 3);
    const reviewKana = (await ctx.db.all('SELECT kana FROM test_questions WHERE test_id = ?', [review.test.id])).map((r) => r.kana);
    assert.deepEqual(reviewKana.sort(), [...missed].sort());
    expectError(await c.post('/api/tests', { source: 'review', script: 'katakana' }), 422, 'NO_REVIEW_WORDS');

    const clean = await newTest(c, { script: 'katakana', count: 5 });
    let cq = clean.current;
    while (cq) cq = (await answerCurrent(c, clean.test.id, cq)).next;
    expectError(await c.post('/api/tests', { source: 'test-mistakes', sourceTestId: clean.test.id }), 422, 'NO_REVIEW_WORDS');
  });
});
describe('statistics', () => {
  const TZ = -540; // UTC+9: local 01:00 is 16:00 UTC on the previous day.
  /** @type {import('./helpers/server.js').Client} */
  let client;
  let testId;
  const played = [];
  before(async () => {
    ({ client } = await registerUser(ctx));
    const { test, current } = await newTest(client, { script: 'hiragana', count: 5 });
    testId = test.id;
    // q0 clean correct, q1 correct with script hint, q2 wrong spelling, q3 skipped, q4 clean correct.
    let q = current;
    for (let i = 0; i < 5; i += 1) {
      const kana = await kanaOf(q.id);
      let body;
      if (i === 1) await client.post(`/api/tests/${testId}/questions/${q.id}/hint`, { type: 'script' });
      if (i === 3) body = (await client.post(`/api/tests/${testId}/questions/${q.id}/skip`, { timeMs: 100 })).body;
      else body = await answerCurrent(client, testId, q, i === 2 ? misspell : (k) => k);
      played.push({ id: q.id, kana });
      q = body.next;
    }
    // Move answers to local dates: today, today, −1, −2, −4 (gap at −3), at 01:00 local time.
    const today = localDate(new Date(), TZ);
    const daysAgo = [0, 0, 1, 2, 4];
    await ctx.db.batch(played.map((p, i) => {
      const localMidnight = Date.parse(`${addDays(today, -daysAgo[i])}T01:00:00Z`);
      return ['UPDATE test_questions SET answered_at = ? WHERE id = ?', [new Date(localMidnight + TZ * 60_000).toISOString(), p.id]];
    }));
  });

  it('computes totals, breakdowns, streaks and daily buckets in local time', async () => {
    const res = await client.get(`/api/stats/overview?tz=${TZ}&days=7`);
    assert.equal(res.status, 200, res.text);
    const s = res.body;
    const today = localDate(new Date(), TZ);
    assert.deepEqual(s.totals, {
      tests: 1, activeTests: 0, completedTests: 1, closedTests: 0,
      answered: 5, correct: 3, wrong: 1, skipped: 1, accuracy: 0.6, cleanCorrect: 2, cleanAccuracy: 0.4,
      score: 280, timeSpentMs: 4100, hint1Used: 1, hint2Used: 0, romajiHintUsed: 0, wordsSeen: 5, wordsLearned: 3, wordsToReview: 2,
    });
    assert.deepEqual(s.byScript, {
      hiragana: { answered: 5, correct: 3, accuracy: 0.6 }, katakana: { answered: 0, correct: 0, accuracy: 0 },
    });
    const expectedLevels = { 1: [0, 0], 2: [0, 0], 3: [0, 0] };
    played.forEach((p, i) => {
      const lvl = expectedLevels[analyzeKana(p.kana).level];
      lvl[0] += 1;
      if ([0, 1, 4].includes(i)) lvl[1] += 1;
    });
    for (const [lvl, [answered, correct]] of Object.entries(expectedLevels)) {
      assert.equal(s.byLevel[lvl].answered, answered);
      assert.equal(s.byLevel[lvl].correct, correct);
    }
    assert.deepEqual(s.streak, { current: 3, best: 3, todayAnswered: 2, lastActiveDate: today });
    assert.equal(s.daily.length, 7);
    assert.equal(s.daily.at(-1).date, today);
    assert.equal(s.daily[0].date, addDays(today, -6));
    assert.deepEqual(s.daily.at(-1), { date: today, answered: 2, correct: 2, score: 180 });
    assert.deepEqual(s.daily.map((d) => d.answered), [0, 0, 1, 0, 1, 1, 2]);
    assert.deepEqual(s.last7, { answered: 5, accuracy: 0.6 });
    assert.deepEqual(s.prev7, { answered: 0, accuracy: 0 });
    assert.equal(s.recentTests.length, 1);
    assert.equal(s.recentTests[0].id, testId);
    assert.deepEqual(s.accuracyTrend.map((t) => [t.testId, t.accuracy, t.scorePercent, t.answered]), [[testId, 0.6, 0.56, 5]]);
    const totalChars = s.charStats.reduce((n, c) => n + c.correct + c.wrong, 0);
    const expectedChars = [0, 1, 2, 4].reduce((n, i) => n + [...played[i].kana].length, 0);
    assert.equal(totalChars, expectedChars, 'skips add no kana stats');
    assert.ok(s.charStats.every((c) => c.script === 'hiragana'));
    assert.ok(s.weakChars.length <= 10);
  });

  it('shifts buckets with the tz offset and validates parameters', async () => {
    const utc = (await client.get('/api/stats/overview?tz=0&days=371')).body;
    assert.equal(utc.daily.length, 371);
    const answeredDates = utc.daily.filter((d) => d.answered).map((d) => d.date);
    const expected = [...new Set((await ctx.db.all('SELECT answered_at FROM test_questions WHERE test_id = ?', [testId])).map((r) => r.answered_at.slice(0, 10)))].sort();
    assert.deepEqual(answeredDates, expected.filter((d) => d <= localDate(new Date(), 0)));
    assert.equal((await client.get('/api/stats/overview')).body.daily.length, 182, 'default days');
    assert.equal((await client.get('/api/stats/overview?days=2')).body.daily.length, 7, 'clamped');
    expectError(await client.get('/api/stats/overview?tz=abc'), 400, 'VALIDATION_ERROR');
    expectError(await ctx.client().get('/api/stats/overview'), 401, 'UNAUTHORIZED');
  });

  it('streak helpers count back from yesterday when today is empty', () => {
    const d = (n) => addDays('2026-11-14', -n);
    assert.deepEqual(computeStreaks(new Set([d(1), d(2), d(5), d(6), d(7), d(8)]), d(0)), { current: 2, best: 4 });
    assert.deepEqual(computeStreaks(new Set([d(2), d(3)]), d(0)), { current: 0, best: 2 });
    assert.deepEqual(computeStreaks(new Set(), d(0)), { current: 0, best: 0 });
    assert.equal(localDate('2026-11-13T16:00:00.000Z', -540), '2026-11-14');
    assert.equal(localDate('2026-11-14T03:00:00.000Z', 300), '2026-11-13');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  it('records kana stats only before hint2From and never for script/empty errors', async () => {
    const { client: c, user } = await registerUser(ctx);
    const { test, current } = await newTest(c, { script: 'hiragana', level: 2, count: 5 });
    const charTotal = async () => (await ctx.db.get('SELECT COALESCE(SUM(correct + wrong), 0) AS n FROM char_stats WHERE user_id = ?', [user.id])).n;
    await c.post(`/api/tests/${test.id}/questions/${current.id}/hint`, { type: 'spelling' });
    let r = await answerCurrent(c, test.id, current, (k) => k, { hint2From: 1, hint2Revealed: 2 });
    assert.equal(await charTotal(), 1, 'only index 0 counted');
    r = await answerCurrent(c, test.id, r.next, (k) => toKatakana(k));
    assert.equal(await charTotal(), 1, 'script errors add nothing');
    r = await answerCurrent(c, test.id, r.next, () => '');
    assert.equal(await charTotal(), 1, 'empty answers add nothing');
    const kana = await kanaOf(r.next.id);
    await answerCurrent(c, test.id, r.next, misspell);
    assert.equal(await charTotal(), 1 + [...kana].length);
    const wrongChar = (await ctx.db.all('SELECT char, wrong FROM char_stats WHERE user_id = ? AND wrong > 0', [user.id]));
    assert.deepEqual(wrongChar.map((w) => w.char), [[...kana].at(-1)]);
  });
});

describe('vocabulary', () => {
  /** @type {import('./helpers/server.js').Client} */
  let client;
  const results = {};
  before(async () => {
    ({ client } = await registerUser(ctx));
    const { test, current } = await newTest(client, { script: 'katakana', count: 6 });
    let q = current;
    let i = 0;
    while (q) {
      const kana = await kanaOf(q.id);
      const body = await answerCurrent(client, test.id, q, i % 3 === 2 ? misspell : (k) => k);
      results[kana] = body.result.status;
      q = body.next;
      i += 1;
    }
  });

  it('lists progress with counts, filters and paging', async () => {
    const res = await client.get('/api/vocab');
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.counts, { all: 6, learned: 4, review: 2, starred: 0 });
    assert.equal(res.body.total, 6);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.pageSize, 24);
    const item = res.body.items[0];
    assert.deepEqual(Object.keys(item.progress).sort(), ['correct', 'lastResult', 'lastSeenAt', 'seen', 'starred', 'wrong']);
    assert.ok(item.word.meaning);
    assert.equal((await client.get('/api/vocab?filter=learned')).body.total, 4);
    const review = (await client.get('/api/vocab?filter=review')).body;
    assert.deepEqual(review.items.map((x) => x.word.kana).sort(),
      Object.keys(results).filter((k) => results[k] === 'wrong').sort());
    assert.equal((await client.get('/api/vocab?script=hiragana')).body.total, 0);
    const page2 = (await client.get('/api/vocab?pageSize=4&page=2')).body;
    assert.equal(page2.items.length, 2);
    assert.equal(page2.total, 6);
    expectError(await client.get('/api/vocab?filter=everything'), 400, 'VALIDATION_ERROR');
    expectError(await client.get('/api/vocab?sort=random'), 400, 'VALIDATION_ERROR');
  });

  it('sorts alphabetically, by mistakes and by recency', async () => {
    const alpha = (await client.get('/api/vocab?sort=alpha')).body.items.map((x) => x.word.kana);
    assert.deepEqual(alpha, [...alpha].sort((a, b) => (a < b ? -1 : 1)));
    const mistakes = (await client.get('/api/vocab?sort=mistakes')).body.items;
    assert.equal(mistakes[0].progress.wrong, 1);
    assert.equal(mistakes[1].progress.wrong, 1);
    assert.equal(mistakes[2].progress.wrong, 0);
    const recent = (await client.get('/api/vocab?sort=recent')).body.items.map((x) => x.progress.lastSeenAt);
    assert.deepEqual(recent, [...recent].sort().reverse());
  });

  it('searches kana (either script), romaji, kanji and meaning', async () => {
    const { items } = (await client.get('/api/vocab')).body;
    const word = items[0].word;
    const hits = async (q) => (await client.get(`/api/vocab?q=${encodeURIComponent(q)}`)).body.items.map((x) => x.word.id);
    assert.ok((await hits(word.kana)).includes(word.id));
    assert.ok((await hits(word.romaji.toUpperCase())).includes(word.id));
    assert.ok((await hits(word.meaning.split(';')[0].toUpperCase())).includes(word.id));
    assert.ok((await hits(toHiragana(word.kana))).includes(word.id), 'hiragana query finds katakana word');
    assert.deepEqual(await hits('zzzz'), []);
    const coffee = ctx.bank.get('1049180');
    const { user } = (await client.get('/api/auth/me')).body;
    await ctx.db.run(`INSERT OR IGNORE INTO vocab_progress (user_id, word_id, seen, correct, last_result, last_seen_at)
                VALUES (?, ?, 1, 1, 'correct', ?)`, [user.id, coffee.id, new Date().toISOString()]);
    assert.ok((await hits('珈琲')).includes(coffee.id), 'kanji search');
    assert.ok((await hits('kohi')).includes(coffee.id), 'macron-insensitive romaji search');
  });

  it('stars and unstars words', async () => {
    const { items } = (await client.get('/api/vocab')).body;
    const id = items[0].word.id;
    const star = await client.post(`/api/vocab/${id}/star`, { starred: true });
    assert.deepEqual(star.body, { starred: true });
    const starred = (await client.get('/api/vocab?filter=starred')).body;
    assert.deepEqual(starred.items.map((x) => x.word.id), [id]);
    assert.equal(starred.items[0].progress.starred, true);
    await client.post(`/api/vocab/${id}/star`, { starred: false });
    assert.equal((await client.get('/api/vocab')).body.counts.starred, 0);

    const before = (await client.get('/api/vocab')).body.counts.all;
    const unseen = ctx.bank.words.find((w) => w.script === 'hiragana').id;
    await client.post(`/api/vocab/${unseen}/star`, { starred: true });
    assert.equal((await client.get('/api/vocab')).body.counts.all, before + 1, 'starred unseen word listed');
    await client.post(`/api/vocab/${unseen}/star`, { starred: false });
    assert.equal((await client.get('/api/vocab')).body.counts.all, before, 'row removed again');
    expectError(await client.post('/api/vocab/nope/star', { starred: true }), 404, 'NOT_FOUND');
    expectError(await client.post(`/api/vocab/${id}/star`, { starred: 'yes' }), 400, 'VALIDATION_ERROR');
  });
});
describe('word bank endpoints', () => {
  it('GET /api/words/meta summarises the bank', async () => {
    const res = await ctx.client().get('/api/words/meta');
    assert.equal(res.status, 200);
    const m = res.body;
    assert.equal(m.total, ctx.bank.words.length);
    assert.equal(m.byScript.hiragana + m.byScript.katakana, m.total);
    assert.equal(m.byLevel[1] + m.byLevel[2] + m.byLevel[3], m.total);
    assert.equal(Object.values(m.byPos).reduce((a, b) => a + b, 0), m.total);
    assert.equal(m.jlptAvailable, true);
    assert.deepEqual(Object.keys(m.byJlpt).sort(), ['1', '2', '3', '4', '5']);
    assert.equal(m.source.license, 'CC BY-SA 4.0');
    assert.ok(m.source.attribution);
    assert.equal(m.jlptSource.license, 'CC BY');
  });

  it('GET /api/words/count applies the TestConfig filters', async () => {
    const c = ctx.client();
    const cases = [
      ['', {}], ['?script=katakana', { script: 'katakana' }], ['?script=hiragana&level=1', { script: 'hiragana', level: 1 }],
      ['?pos=verb', { pos: 'verb' }], ['?jlpt=5&script=mixed&level=all&pos=any', { jlpt: 5 }],
      ['?script=katakana&pos=expression', { script: 'katakana', pos: 'expression' }],
    ];
    for (const [query, filter] of cases) {
      const res = await c.get(`/api/words/count${query}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.count, ctx.bank.filter(filter).length, query);
    }
    expectError(await c.get('/api/words/count?level=9'), 400, 'VALIDATION_ERROR');
  });

  it('GET /api/words/sample returns distinct WordInfo objects (n ≤ 20)', async () => {
    const c = ctx.client();
    const res = await c.get('/api/words/sample?n=3');
    assert.equal(res.body.words.length, 3);
    for (const w of res.body.words) {
      assert.deepEqual(Object.keys(w).sort(), ['common', 'features', 'homophones', 'id', 'jlpt', 'kana', 'kanji', 'level', 'meaning',
        'origin', 'posCategory', 'romaji', 'script', 'senses', 'usuallyKana']);
    }
    assert.equal((await c.get('/api/words/sample')).body.words.length, 8);
    const many = (await c.get('/api/words/sample?n=50')).body.words;
    assert.equal(many.length, 20);
    assert.equal(new Set(many.map((w) => w.kana)).size, 20);
  });

  it('WordInfo carries meaning and homophones', () => {
    const paper = ctx.bank.wordInfo('1294330');
    assert.equal(paper.meaning, 'paper');
    assert.deepEqual(paper.homophones, [{ id: '1360210', kanji: '神', meaning: 'god; deity; divinity; spirit' }]);
    const coffee = ctx.bank.wordInfo('1049180');
    assert.equal(coffee.romaji, 'kōhī');
    assert.deepEqual(coffee.origin, [{ lang: 'Dutch', text: 'koffie', wasei: false }]);
    assert.equal(ctx.bank.wordInfo('missing'), null);
  });
});

describe('PDF reports', { skip: PDF_AVAILABLE ? false : 'server/report/pdf.js is not present yet' }, () => {
  it('renders the per-test and overall reports as downloads', async () => {
    const { client } = await registerUser(ctx);
    const { test, current } = await newTest(client, { count: 5 });
    const r = await answerCurrent(client, test.id, current);
    await client.post(`/api/tests/${test.id}/questions/${r.next.id}/skip`, { timeMs: 10 });
    const res = await client.get(`/api/tests/${test.id}/report.pdf?tz=-540`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('content-disposition'),
      `attachment; filename="hirakata-test-${test.id}-${localDate(new Date(), -540)}.pdf"`);
    assert.equal(res.buffer.subarray(0, 5).toString('latin1'), '%PDF-');

    const overall = await client.get('/api/reports/overall.pdf?tz=0');
    assert.equal(overall.status, 200, overall.text);
    assert.equal(overall.headers.get('content-disposition'),
      `attachment; filename="hirakata-progress-${localDate(new Date(), 0)}.pdf"`);
    assert.equal(overall.buffer.subarray(0, 5).toString('latin1'), '%PDF-');

    const empty = await registerUser(ctx);
    const blank = await empty.client.get('/api/reports/overall.pdf');
    assert.equal(blank.status, 200, 'a brand-new account still gets a report');
    expectError(await ctx.client().get('/api/reports/overall.pdf'), 401, 'UNAUTHORIZED');
  });
});
describe('database housekeeping', () => {
  it('migrates idempotently, rolls back failed batches and removes stale data', async () => {
    const db = await openDatabase(':memory:');
    try {
      assert.equal(await schemaVersion(db), SCHEMA_VERSION);
      await migrate(db);
      assert.deepEqual(await db.all('SELECT id, version FROM schema_meta'), [{ id: 1, version: SCHEMA_VERSION }]);
      assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 0, 'local runs enforce no FKs, like remote');
      const now = new Date('2026-11-14T12:00:00.000Z');
      const iso = (days) => new Date(now.getTime() + days * 86_400_000).toISOString();
      const addUser = async (guest, updated) => (await db.run(`INSERT INTO users (email, display_name, is_guest, created_at, updated_at)
        VALUES (?, 'U', ?, ?, ?)`, [guest ? null : `u${updated}@x.io`, guest ? 1 : 0, iso(updated), iso(updated)])).lastInsertRowid;
      const addSession = (userId, id, expiresIn) => db.run(`INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)`, [id, userId, iso(-40), iso(expiresIn), iso(-40)]);
      const staleGuest = await addUser(true, -31);
      const liveGuest = await addUser(true, -40);
      const recentGuest = await addUser(true, -5);
      const oldMember = await addUser(false, -400);
      await addSession(staleGuest, 's1', -1);
      await addSession(liveGuest, 's2', 10);
      await addSession(oldMember, 's3', -2);

      await assert.rejects(db.batch([
        ["UPDATE users SET display_name = 'changed' WHERE id = ?", [oldMember]],
        'SELECT * FROM no_such_table',
      ]), /no_such_table/);
      assert.equal((await db.get('SELECT display_name FROM users WHERE id = ?', [oldMember])).display_name, 'U');

      assert.deepEqual(await housekeeping(db, now), { sessions: 2, guests: 1 });
      const ids = (await db.all('SELECT id FROM users ORDER BY id')).map((r) => r.id);
      assert.deepEqual(ids, [liveGuest, recentGuest, oldMember]);
      assert.deepEqual((await db.all('SELECT id FROM sessions')).map((r) => r.id), ['s2']);
    } finally {
      db.close();
    }
  });
});

// ───────────────────────────── v2 (SPEC §15) ─────────────────────────────

/** Seeded PRNG (mulberry32). */
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('v2 word pool (§15.1)', () => {
  /** @type {import('./helpers/server.js').Client} */
  let client;
  before(async () => {
    ({ client } = await registerUser(ctx));
  });

  it('meta reports byPool and count/filter accept pool', async () => {
    const meta = (await ctx.client().get('/api/words/meta')).body;
    const common = ctx.bank.words.filter((w) => w.common).length;
    assert.ok(common > 0 && common < ctx.bank.words.length, 'fixture mixes common and non-common words');
    assert.deepEqual(meta.byPool, { all: ctx.bank.words.length, common });
    const c = ctx.client();
    for (const [query, filter] of [['?pool=common', { pool: 'common' }], ['?pool=all', {}],
      ['?pool=common&script=katakana&level=3', { pool: 'common', script: 'katakana', level: 3 }]]) {
      const res = await c.get(`/api/words/count${query}`);
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.count, ctx.bank.filter(filter).length, query);
    }
    assert.equal((await c.get('/api/words/count?pool=common')).body.count, common);
    expectError(await c.get('/api/words/count?pool=rare'), 400, 'VALIDATION_ERROR');
    assert.ok(ctx.bank.filter({ pool: 'common' }).every((w) => w.common));
  });

  it('creates common-pool tests from common words only, with a "Common" title', async () => {
    const { test } = await newTest(client, { script: 'katakana', pool: 'common', count: 50 });
    assert.equal(test.config.pool, 'common');
    const commonKatakana = new Set(ctx.bank.filter({ script: 'katakana', pool: 'common' }).map((w) => w.kana)).size;
    assert.equal(test.totalQuestions, commonKatakana);
    assert.equal(test.title, `Katakana · Common · All levels · ${commonKatakana} words`);
    const rows = (await ctx.db.all('SELECT word_id FROM test_questions WHERE test_id = ?', [test.id]));
    assert.ok(rows.every((r) => ctx.bank.get(r.word_id).common), 'only common words');
    const bad = await client.post('/api/tests', { pool: 'rare', mode: 'speak' });
    expectError(bad, 400, 'VALIDATION_ERROR');
    assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['mode', 'pool']);
  });

  it('weights common words ×4 in pool "all" only (seeded)', () => {
    const rng = seeded(7);
    const pool = ['a', 'b', 'c', 'd'].map((id) => ({ id, kana: id, romaji: id, script: 'hiragana', jlpt: null, common: id === 'a' }));
    const firstPick = (commonBoost) => {
      const n = { a: 0, b: 0, c: 0, d: 0 };
      for (let i = 0; i < 8000; i += 1) {
        n[selectRandomWords({ pool, count: 1, script: 'hiragana', jlptAny: true, commonBoost, seenIds: new Set(), rng })[0].id] += 1;
      }
      return n;
    };
    const boosted = firstPick(true); // a = 3 × 4 = 12, others 3 → P(a) = 12/21
    assert.ok(Math.abs(boosted.a / 8000 - 12 / 21) < 0.02, JSON.stringify(boosted));
    const plain = firstPick(false);
    assert.ok(Math.abs(plain.a / 8000 - 1 / 4) < 0.02, JSON.stringify(plain));
  });

  it('top-k selection keeps distinct kana even when it must read past the ranked prefix', () => {
    // 400 words but only 7 distinct kana: the cursor exhausts the pre-ranked prefix and falls back to a full sort.
    const pool = Array.from({ length: 400 }, (_, i) => ({
      id: String(i), kana: `k${i < 394 ? 0 : i}`, romaji: 'x', script: i % 2 ? 'katakana' : 'hiragana', jlpt: null, common: false,
    }));
    for (const script of ['hiragana', 'mixed']) {
      const filtered = pool.filter((w) => script === 'mixed' || w.script === script);
      const picked = selectRandomWords({ pool: filtered, count: 10, script, jlptAny: true, seenIds: new Set(), rng: seeded(3) });
      const expected = new Set(filtered.map((w) => w.kana)).size;
      assert.equal(picked.length, expected, script);
      assert.equal(new Set(picked.map((w) => w.kana)).size, picked.length);
    }
    // Large pool: picks still follow the weights (unseen ×3 vs seen ×1 → seen share 1/4).
    const big = Array.from({ length: 20000 }, (_, i) => ({ id: String(i), kana: `k${i}`, romaji: 'x', script: 'hiragana', jlpt: null }));
    const seenIds = new Set(big.filter((_, i) => i % 2).map((w) => w.id));
    let seenPicks = 0;
    const rng = seeded(11);
    for (let i = 0; i < 40; i += 1) {
      seenPicks += selectRandomWords({ pool: big, count: 50, script: 'hiragana', jlptAny: false, seenIds, rng })
        .filter((w) => seenIds.has(w.id)).length;
    }
    assert.ok(Math.abs(seenPicks / 2000 - 0.25) < 0.04, `seen share ${seenPicks}/2000`);
  });
});

describe('v2 word bank loading (§15.1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hirakata-words-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const raw = fs.readFileSync(FIXTURE_WORDS_PATH);

  it('loads gzip (detected by magic bytes) and plain JSON alike', async () => {
    const gz = path.join(dir, 'words.json.gz');
    fs.writeFileSync(gz, zlib.gzipSync(raw));
    const fromGz = await loadWordBank(gz);
    const fromJson = await loadWordBank(FIXTURE_WORDS_PATH);
    assert.equal(fromGz.words.length, fromJson.words.length);
    assert.deepEqual(fromGz.counts, fromJson.counts);
    const oddName = path.join(dir, 'bank.bin');
    fs.writeFileSync(oddName, zlib.gzipSync(raw));
    assert.equal((await loadWordBank(oddName)).words.length, fromJson.words.length);
  });

  it('falls back to the other spelling and reports clear errors', async () => {
    const plain = path.join(dir, 'legacy', 'words.json');
    fs.mkdirSync(path.dirname(plain), { recursive: true });
    fs.writeFileSync(plain, raw);
    const missingGz = `${plain}.gz`;
    assert.equal(alternateWordsPath(missingGz), plain);
    assert.equal(alternateWordsPath(plain), missingGz);
    const loaded = await loadWordBankWithFallback(missingGz, alternateWordsPath(missingGz));
    assert.equal(loaded.path, plain);
    await assert.rejects(loadWordBankWithFallback(path.join(dir, 'none.json.gz'), path.join(dir, 'none.json')),
      (err) => err instanceof WordBankError && err.code === 'MISSING' && err.message.includes('none.json.gz'));
    const broken = path.join(dir, 'broken.json.gz');
    fs.writeFileSync(broken, Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('not gzip')]));
    await assert.rejects(loadWordBank(broken), (err) => err instanceof WordBankError && err.code === 'INVALID' && /gzip/.test(err.message));
    const badCommon = path.join(dir, 'bad-common.json');
    const data = JSON.parse(raw.toString('utf8'));
    data.words[0].common = 'yes';
    fs.writeFileSync(badCommon, JSON.stringify(data));
    await assert.rejects(loadWordBank(badCommon), /common must be a boolean/);
    delete data.words[0].common;
    fs.writeFileSync(badCommon, JSON.stringify(data));
    assert.equal((await loadWordBank(badCommon)).get(data.words[0].id).common, true, 'v1 words default to common');
  });

  it('defaults WORDS_PATH to data/words.json.gz', () => {
    const config = loadConfig({});
    assert.equal(path.basename(config.wordsPath), 'words.json.gz');
    assert.equal(path.basename(config.wordsFallbackPath), 'words.json');
    assert.equal(path.basename(loadConfig({ WORDS_PATH: 'x/words.json' }).wordsFallbackPath), 'words.json.gz');
  });
});

describe('v2 listen mode (§15.2)', () => {
  /** @type {import('./helpers/server.js').Client} */
  let client;
  /** @type {any} */
  let user;
  before(async () => {
    ({ client, user } = await registerUser(ctx));
  });
  const url = (t, q, action) => `/api/tests/${t}/questions/${q}/${action}`;
  const romajiOf = async (qid) => (await ctx.db.get('SELECT romaji FROM test_questions WHERE id = ?', [qid])).romaji;

  it('hides romaji, sends speak, and reveals romaji only through the romaji hint', async () => {
    const { test, current } = await newTest(client, { mode: 'listen', count: 5 });
    assert.equal(test.title, 'Listen · Mixed · All levels · 5 words');
    assert.equal(test.config.mode, 'listen');
    assert.equal(current.mode, 'listen');
    assert.equal(current.romaji, null);
    assert.equal(current.speak, await kanaOf(current.id));
    assert.equal(current.romajiHintUsed, false);
    assert.deepEqual((await client.get(`/api/tests/${test.id}/state`)).body.current, current);
    const detail = (await client.get(`/api/tests/${test.id}`)).body;
    assert.ok(detail.questions.every((q) => q.romaji === null), 'pending listen questions hide romaji');

    const h = await client.post(url(test.id, current.id, 'hint'), { type: 'romaji' });
    assert.equal(h.status, 200, h.text);
    assert.equal(h.body.question.romajiHintUsed, true);
    assert.equal(h.body.question.romaji, await romajiOf(current.id));
    assert.deepEqual((await client.post(url(test.id, current.id, 'hint'), { type: 'romaji' })).body, h.body, 'idempotent');
    const state = (await client.get(`/api/tests/${test.id}/state`)).body;
    assert.equal(state.test.romajiHintCount, 1);
    assert.deepEqual(state.current, h.body.question, 'romaji hint restored on resume');
    const shown = (await client.get(`/api/tests/${test.id}`)).body.questions;
    assert.equal(shown[0].romaji, await romajiOf(current.id));
    assert.equal(shown[1].romaji, null);

    await client.post(url(test.id, current.id, 'hint'), { type: 'script' });
    const r = await answerCurrent(client, test.id, current);
    assert.equal(r.result.points, 50, '100 − 20 (script) − 30 (romaji)');
    assert.equal(r.result.romajiHintUsed, true);
    assert.equal(r.result.romaji, await romajiOf(current.id));
    assert.equal(r.result.inputMethod, 'keys');
    assert.equal(r.next.romaji, null);
    assert.equal(r.next.speak, await kanaOf(r.next.id));
    const r2 = await answerCurrent(client, test.id, r.next);
    assert.equal(r2.result.points, 100);
    assert.equal(r2.result.romaji, await romajiOf(r.next.id), 'results always carry romaji');
    assert.equal(r2.result.romajiHintUsed, false);
  });

  it('rejects the romaji hint in romaji mode', async () => {
    const { test, current } = await newTest(client, { count: 5 });
    const res = await client.post(url(test.id, current.id, 'hint'), { type: 'romaji' });
    expectError(res, 400, 'VALIDATION_ERROR');
    assert.ok(res.body.error.fields.type);
    assert.equal((await ctx.db.get('SELECT hint3_used FROM test_questions WHERE id = ?', [current.id])).hint3_used, 0);
    assert.equal((await client.get(`/api/tests/${test.id}/state`)).body.test.romajiHintCount, 0);
  });

  it('accepts same-sound spellings as variants in listen mode only (−30, no kana stats)', async () => {
    const charTotal = async () => (await ctx.db.get('SELECT COALESCE(SUM(correct + wrong), 0) AS n FROM char_stats WHERE user_id = ?', [user.id])).n;
    const variantOf = (kana) => toKatakana(soundKey(kana));
    const hasVariant = (kana) => variantOf(kana) !== kana && soundKey(variantOf(kana)) === soundKey(kana);
    assert.ok(hasVariant('コーヒー') && variantOf('コーヒー') === 'コオヒイ');
    let variants = 0;
    for (const mode of ['listen', 'romaji']) {
      const { test, current } = await newTest(client, { mode, script: 'katakana', level: 2, count: 20 });
      let q = current;
      let streak = 0;
      while (q) {
        const kana = await kanaOf(q.id);
        if (!hasVariant(kana)) {
          q = (await answerCurrent(client, test.id, q)).next;
          streak = mode === 'listen' ? streak + 1 : 0;
          continue;
        }
        const before = await charTotal();
        const r = await answerCurrent(client, test.id, q, variantOf, { inputMethod: 'handwriting' });
        if (mode === 'listen') {
          variants += 1;
          streak += 1;
          assert.equal(r.result.status, 'correct', kana);
          assert.equal(r.result.errorType, 'variant');
          assert.equal(r.result.points, 70);
          assert.equal(r.result.expected, kana, 'the standard spelling is shown');
          assert.equal(r.result.userAnswer, variantOf(kana));
          assert.equal(r.test.currentStreak, streak, 'variants keep the streak');
          assert.equal(await charTotal(), before, 'variants add no kana stats');
          const vp = (await ctx.db.get('SELECT correct, last_result FROM vocab_progress WHERE user_id = ? AND word_id = ?', [user.id, r.result.word.id]));
          assert.equal(vp.last_result, 'correct');
        } else {
          assert.equal(r.result.status, 'wrong', kana);
          assert.equal(r.result.errorType, 'spelling');
          assert.ok(await charTotal() > before);
        }
        q = r.next;
      }
    }
    assert.ok(variants >= 3, `fixture katakana level 2 offers long-vowel words (${variants})`);
  });

  it('records and validates the input method', async () => {
    const { test, current } = await newTest(client, { count: 5 });
    expectError(await client.post(url(test.id, current.id, 'answer'), { answer: 'x', inputMethod: 'pen' }), 400, 'VALIDATION_ERROR');
    const bad = await client.post(url(test.id, current.id, 'answer'), { answer: 'x', inputMethod: 3 });
    assert.ok(bad.body.error.fields.inputMethod);
    let r = await answerCurrent(client, test.id, current, (k) => k, { inputMethod: 'handwriting' });
    assert.equal(r.result.inputMethod, 'handwriting');
    r = await answerCurrent(client, test.id, r.next, (k) => k, { inputMethod: 'device' });
    assert.equal(r.result.inputMethod, 'device');
    r = await answerCurrent(client, test.id, r.next);
    assert.equal(r.result.inputMethod, 'keys', 'default');
    const skip = await client.post(url(test.id, r.next.id, 'skip'), { timeMs: 5 });
    assert.equal(skip.body.result.inputMethod, null, 'skips have no input method');
    const stored = (await ctx.db.all('SELECT input_method FROM test_questions WHERE test_id = ? ORDER BY position', [test.id]));
    assert.deepEqual(stored.map((s) => s.input_method), ['handwriting', 'device', 'keys', null, null]);
    const full = (await client.get(`/api/tests/${test.id}`)).body.questions;
    assert.deepEqual(full.slice(0, 3).map((q) => q.inputMethod), ['handwriting', 'device', 'keys']);
  });

  it('prefixes review and retry titles in listen mode', async () => {
    const { client: c } = await registerUser(ctx);
    const { test, current } = await newTest(c, { mode: 'listen', script: 'hiragana', count: 5 });
    await answerCurrent(c, test.id, current, misspell);
    const review = await newTest(c, { source: 'review', mode: 'listen' });
    assert.equal(review.test.title, 'Listen · Review · 1 word');
    assert.equal(review.current.romaji, null);
    const retry = await newTest(c, { source: 'test-mistakes', sourceTestId: test.id, mode: 'listen' });
    assert.equal(retry.test.title, 'Listen · Retry · Hiragana · All levels · 5 words');
    const romajiRetry = await newTest(c, { source: 'test-mistakes', sourceTestId: test.id });
    assert.equal(romajiRetry.test.title, 'Retry · Listen · Hiragana · All levels · 5 words');
    assert.equal(romajiRetry.current.speak, null);
  });
});

describe('v2 statistics, reports and settings (§15.2, §15.3)', () => {
  /** @type {import('./helpers/server.js').Client} */
  let client;
  /** @type {any} */
  let user;
  let listenTestId;
  before(async () => {
    ({ client, user } = await registerUser(ctx));
    const url = (t, q, action) => `/api/tests/${t}/questions/${q}/${action}`;
    // Romaji test: keys ✓, handwriting ✗, device ✓, skip, handwriting ✓.
    const romaji = await newTest(client, { script: 'hiragana', count: 5 });
    let r = await answerCurrent(client, romaji.test.id, romaji.current, (k) => k, { inputMethod: 'keys' });
    r = await answerCurrent(client, romaji.test.id, r.next, misspell, { inputMethod: 'handwriting' });
    r = await answerCurrent(client, romaji.test.id, r.next, (k) => k, { inputMethod: 'device' });
    r = (await client.post(url(romaji.test.id, r.next.id, 'skip'), { timeMs: 10 })).body;
    await answerCurrent(client, romaji.test.id, r.next, (k) => k, { inputMethod: 'handwriting' });
    // Listen test: keys ✓ with the romaji hint, handwriting ✓, device ✗, then closed.
    const listen = await newTest(client, { mode: 'listen', script: 'katakana', count: 5 });
    listenTestId = listen.test.id;
    await client.post(url(listenTestId, listen.current.id, 'hint'), { type: 'romaji' });
    r = await answerCurrent(client, listenTestId, listen.current, (k) => k, { inputMethod: 'keys' });
    r = await answerCurrent(client, listenTestId, r.next, (k) => k, { inputMethod: 'handwriting' });
    await answerCurrent(client, listenTestId, r.next, misspell, { inputMethod: 'device' });
    await client.post(`/api/tests/${listenTestId}/close`);
  });

  it('breaks the overview down by mode and input method', async () => {
    const s = (await client.get('/api/stats/overview')).body;
    assert.deepEqual(s.byMode, {
      romaji: { answered: 5, correct: 3, accuracy: 0.6 },
      listen: { answered: 3, correct: 2, accuracy: 0.667 },
    });
    assert.deepEqual(s.byInput, {
      keys: { answered: 2, correct: 2, accuracy: 1 },
      handwriting: { answered: 3, correct: 2, accuracy: 0.667 },
      device: { answered: 2, correct: 1, accuracy: 0.5 },
    });
    assert.equal(s.totals.answered, 8);
    assert.equal(s.totals.romajiHintUsed, 1);
    assert.equal(s.totals.cleanCorrect, 4, 'the romaji-hinted answer is not clean');
    assert.equal(s.totals.cleanAccuracy, 0.5);
    const empty = (await (await registerUser(ctx)).client.get('/api/stats/overview')).body;
    assert.deepEqual(empty.byMode.listen, { answered: 0, correct: 0, accuracy: 0 });
    assert.deepEqual(empty.byInput.device, { answered: 0, correct: 0, accuracy: 0 });
  });

  it('gives the PDF builders the mode and input-method data', async () => {
    const row = (await ctx.db.get('SELECT * FROM users WHERE id = ?', [user.id]));
    const data = await buildTestReportData({ db: ctx.db, bank: ctx.bank }, row, listenTestId);
    assert.equal(data.mode, 'listen');
    assert.equal(data.modeLabel, 'Listen → write');
    assert.equal(data.test.config.mode, 'listen');
    assert.equal(data.test.romajiHintCount, 1);
    assert.deepEqual(data.byInput, {
      keys: { answered: 1, correct: 1, accuracy: 1 },
      handwriting: { answered: 1, correct: 1, accuracy: 1 },
      device: { answered: 1, correct: 0, accuracy: 0 },
    });
    assert.deepEqual(data.inputLabels, { keys: 'Kana keys', handwriting: 'Handwriting', device: 'Device keyboard' });
    assert.deepEqual(data.questions.slice(0, 3).map((q) => q.inputMethod), ['keys', 'handwriting', 'device']);
    assert.equal(data.questions[0].romajiHintUsed, true);
    assert.equal(data.questions[3].romaji, null, 'pending listen questions stay hidden');
  });

  it('validates and stores the v2 settings', async () => {
    const good = {
      inputMethod: 'handwriting', keyLayout: 'gojuon', handwritingStrict: true, ttsRate: 1.2,
      ttsVoice: 'Microsoft Nanami Online (Natural) - Japanese (Japan)', listenAutoplay: false, keyboardVisible: false,
    };
    const res = await client.patch('/api/auth/me', { settings: good });
    assert.equal(res.status, 200, res.text);
    for (const [k, v] of Object.entries(good)) assert.equal(res.body.user.settings[k], v, k);
    assert.equal((await client.patch('/api/auth/me', { settings: { ttsRate: 0.5, ttsVoice: '', inputMethod: 'device' } }))
      .body.user.settings.ttsRate, 0.5);
    const bad = await client.patch('/api/auth/me', { settings: {
      inputMethod: 'pen', keyLayout: 'random', handwritingStrict: 'yes', ttsRate: 1.25, ttsVoice: 5, listenAutoplay: null,
    } });
    expectError(bad, 400, 'VALIDATION_ERROR');
    assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['settings.handwritingStrict', 'settings.inputMethod',
      'settings.keyLayout', 'settings.listenAutoplay', 'settings.ttsRate', 'settings.ttsVoice']);
    for (const settings of [{ ttsRate: '0.9' }, { ttsRate: 0.49 }, { ttsRate: Number.NaN }, { ttsVoice: 'a\u0007b' },
      { ttsVoice: 'v'.repeat(201) }, { inputMethod: 'Keys' }]) {
      expectError(await client.patch('/api/auth/me', { settings }), 400, 'VALIDATION_ERROR');
    }
    const me = (await client.get('/api/auth/me')).body.user.settings;
    assert.deepEqual([me.inputMethod, me.keyLayout, me.ttsRate, me.ttsVoice], ['device', 'gojuon', 0.5, '']);
  });
});

describe('v2 database migration', () => {
  it('upgrades a v1 database in place', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hirakata-migrate-'));
    const file = path.join(dir, 'v1.db');
    try {
      // A database as HiraKata v1 left it: schema v1, versioned only by PRAGMA user_version.
      const v1 = createClient({ url: fileUrl(file) });
      await v1.executeMultiple(`${MIGRATIONS[0]}; PRAGMA user_version = 1;`);
      const iso = '2026-11-01T10:00:00.000Z';
      await v1.batch([
        { sql: `INSERT INTO users (id, email, display_name, password_hash, settings, created_at, updated_at)
                VALUES (1, 'old@x.io', 'Old', 'h', '{"theme":"dark","keyboardVisible":false}', ?, ?)`, args: [iso, iso] },
        { sql: `INSERT INTO tests (id, user_id, title, config, total_questions, current_index, score, correct_count,
                created_at, updated_at) VALUES (1, 1, 'Mixed · All levels · 2 words', ?, 2, 1, 100, 1, ?, ?)`,
        args: [JSON.stringify({ script: 'mixed', level: 'all', pos: 'any', jlpt: 'any', count: 2, source: 'random', sourceTestId: null }), iso, iso] },
        { sql: `INSERT INTO test_questions (test_id, position, word_id, kana, romaji, script, status, user_answer, points, answered_at)
                VALUES (1, 0, '1467640', 'ねこ', 'neko', 'hiragana', 'correct', 'ねこ', 100, ?)`, args: [iso] },
        `INSERT INTO test_questions (test_id, position, word_id, kana, romaji, script)
         VALUES (1, 1, '1594600', 'いぬ', 'inu', 'hiragana')`,
      ], 'write');
      v1.close();

      const db = await openDatabase(file);
      try {
        assert.equal((await db.get('SELECT version FROM schema_meta WHERE id = 1')).version, SCHEMA_VERSION);
        assert.equal(SCHEMA_VERSION, 2);
        const qs = await db.all('SELECT hint3_used, input_method, status FROM test_questions ORDER BY position');
        assert.deepEqual(qs.map((q) => [q.hint3_used, q.input_method, q.status]), [[0, null, 'correct'], [0, null, 'pending']]);
        const summary = testSummary(await db.get('SELECT * FROM tests WHERE id = 1'));
        assert.equal(summary.config.mode, 'romaji');
        assert.equal(summary.config.pool, 'all');
        assert.equal(summary.romajiHintCount, 0);
        assert.equal(summary.score, 100);
        await migrate(db);
        assert.equal(await schemaVersion(db), SCHEMA_VERSION, 'idempotent');
        assert.equal((await db.get('SELECT settings FROM users WHERE id = 1')).settings, '{"theme":"dark","keyboardVisible":false}');
      } finally {
        db.close();
      }
    } finally {
      await removeDbDir(dir);
    }
  });
});
