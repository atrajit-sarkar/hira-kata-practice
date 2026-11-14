/**
 * Database layer (server/db.js on @libsql/client): schema_meta migrations, explicit child deletes
 * (no FK cascades), race guards on concurrent answers, round-trip budgets, /api/health and config.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createClient } from '@libsql/client';
import { createApp } from '../server/app.js';
import { loadConfig, parseTrustProxy } from '../server/config.js';
import {
  Database, MIGRATIONS, SCHEMA_VERSION, countPlaceholders, fileUrl, housekeeping, migrate, openDatabase,
  schemaVersion,
} from '../server/db.js';
import { answerQuestion, skipQuestion, useHint } from '../server/services/answers.js';
import { closeTest } from '../server/services/tests.js';
import { loadWordBank } from '../server/services/wordbank.js';
import { Client, FIXTURE_WORDS_PATH, registerUser, removeDbDir, startTestServer } from './helpers/server.js';

/** A raw single-connection in-memory libSQL database wrapped like openDatabase does, unmigrated. */
const rawMemoryDb = () => new Database(createClient({ url: ':memory:', concurrency: 1 }), { remote: false, location: ':memory:' });

/** Run a legacy (pre-schema_meta) script on a raw database: schema migrations plus user_version. */
async function legacySchema(db, versions, userVersion) {
  await db.client.executeMultiple(`${MIGRATIONS.slice(0, versions).join(';\n')};\nPRAGMA user_version = ${userVersion};`);
}

describe('schema_meta migrations', () => {
  it('creates a fresh database at the latest version without touching user_version', async () => {
    const db = await openDatabase(':memory:');
    try {
      assert.deepEqual(await db.all('SELECT id, version FROM schema_meta'), [{ id: 1, version: SCHEMA_VERSION }]);
      assert.equal((await db.get('PRAGMA user_version')).user_version, 0);
      await migrate(db);
      assert.equal(await schemaVersion(db), SCHEMA_VERSION, 'idempotent');
    } finally {
      db.close();
    }
  });

  it('seeds schema_meta from PRAGMA user_version of an existing v2 file and keeps its data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hirakata v2 #db-'));
    const file = path.join(dir, 'hirakata.db');
    try {
      const legacy = createClient({ url: fileUrl(file) });
      await legacy.executeMultiple(`${MIGRATIONS[0]};\n${MIGRATIONS[1]};\nPRAGMA journal_mode = WAL; PRAGMA user_version = 2;`);
      await legacy.batch([
        `INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
         VALUES (1, 'kept@x.io', 'Kept', 'h', '2026-01-01', '2026-01-01')`,
        `INSERT INTO tests (id, user_id, title, config, total_questions, hint3_count, created_at, updated_at)
         VALUES (7, 1, 'Old test', '{}', 1, 2, '2026-01-01', '2026-01-01')`,
      ], 'write');
      legacy.close();

      const db = await openDatabase(file);
      try {
        assert.equal(await schemaVersion(db), 2);
        assert.deepEqual(await db.all('SELECT id, email FROM users'), [{ id: 1, email: 'kept@x.io' }]);
        assert.equal((await db.get('SELECT hint3_count FROM tests WHERE id = 7')).hint3_count, 2);
        assert.equal((await db.get('PRAGMA user_version')).user_version, 2, 'user_version is left alone');
      } finally {
        db.close();
      }
      const reopened = await openDatabase(file);
      try {
        assert.equal(await schemaVersion(reopened), 2, 'schema_meta is authoritative on the next start');
        assert.equal((await reopened.get('SELECT COUNT(*) AS n FROM users')).n, 1);
      } finally {
        reopened.close();
      }
    } finally {
      await removeDbDir(dir);
    }
  });

  it('upgrades a legacy v1 database (user_version 1) to the latest schema', async () => {
    const db = rawMemoryDb();
    try {
      await legacySchema(db, 1, 1);
      await migrate(db);
      assert.equal(await schemaVersion(db), SCHEMA_VERSION);
      const columns = (await db.all("SELECT name FROM pragma_table_info('test_questions')")).map((c) => c.name);
      assert.ok(columns.includes('hint3_used') && columns.includes('input_method'));
    } finally {
      db.close();
    }
  });

  it('infers the version from the tables when user_version is 0 (e.g. an imported database)', async () => {
    for (const [versions, expectedSeed] of [[1, 1], [2, 2]]) {
      const db = rawMemoryDb();
      try {
        await legacySchema(db, versions, 0);
        await migrate(db); // would fail with "table users already exists" if it re-ran migration 1
        assert.equal(await schemaVersion(db), SCHEMA_VERSION, `v${expectedSeed} schema`);
      } finally {
        db.close();
      }
    }
  });

  it('refuses a database whose schema is newer than the app', async () => {
    const db = rawMemoryDb();
    try {
      await migrate(db);
      await db.run('UPDATE schema_meta SET version = ?', [SCHEMA_VERSION + 1]);
      await assert.rejects(migrate(db), /newer than this app supports/);
    } finally {
      db.close();
    }
  });

  it('rolls back a failing migration batch completely', async () => {
    const db = rawMemoryDb();
    try {
      await legacySchema(db, 1, 1);
      await db.run('ALTER TABLE tests ADD COLUMN hint3_count INTEGER'); // makes migration 2 fail midway
      await assert.rejects(migrate(db), /duplicate column/);
      assert.equal(await schemaVersion(db), 1, 'version not bumped');
      const columns = (await db.all("SELECT name FROM pragma_table_info('test_questions')")).map((c) => c.name);
      assert.ok(!columns.includes('hint3_used'), 'earlier statements of the batch were rolled back');
    } finally {
      db.close();
    }
  });
});

describe('statement checks', () => {
  it('counts placeholders like SQLite, ignoring strings and comments', () => {
    assert.equal(countPlaceholders('SELECT 1'), 0);
    assert.equal(countPlaceholders('SELECT ?, ?'), 2);
    assert.equal(countPlaceholders("SELECT ?1, ?3, ?1, '?', \"?\" -- ?\n/* ? */"), 3);
    assert.equal(countPlaceholders('SELECT ?2, ?'), 3);
    assert.equal(countPlaceholders("SELECT 'it''s ?', ?"), 1);
    assert.equal(countPlaceholders('SELECT :name'), null);
  });

  it('rejects a wrong number of arguments instead of binding NULL', async () => {
    const db = await openDatabase(':memory:');
    try {
      await assert.rejects(db.get('SELECT ? AS a, ? AS b', [1]), /expects 2 argument\(s\), got 1/);
      await assert.rejects(db.batch([['SELECT ?1', [1, 2]]]), /expects 1 argument\(s\), got 2/);
      assert.deepEqual(await db.get('SELECT ?1 AS a, ?1 + ?2 AS b', [1, 2]), { a: 1, b: 3 });
    } finally {
      db.close();
    }
  });

  it('builds file: URLs that survive spaces, # and % in paths', () => {
    assert.match(fileUrl(path.join(os.tmpdir(), 'a #1 100%.db')), /^file:[^#]*%231 100%25\.db$/);
    if (path.sep === '\\') assert.ok(!fileUrl('C:\\x\\y.db').includes('\\'));
  });
});

describe('data deletion without foreign-key cascades', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    assert.deepEqual(ctx.errors.map(String), []);
    await ctx.close();
  });

  /** Rows whose parent row is gone, per child table (all must be 0). */
  const orphans = async () => {
    const [[row]] = await ctx.db.read([`SELECT
      (SELECT COUNT(*) FROM test_questions WHERE test_id NOT IN (SELECT id FROM tests)) AS test_questions,
      (SELECT COUNT(*) FROM tests WHERE user_id NOT IN (SELECT id FROM users)) AS tests,
      (SELECT COUNT(*) FROM sessions WHERE user_id NOT IN (SELECT id FROM users)) AS sessions,
      (SELECT COUNT(*) FROM vocab_progress WHERE user_id NOT IN (SELECT id FROM users)) AS vocab_progress,
      (SELECT COUNT(*) FROM char_stats WHERE user_id NOT IN (SELECT id FROM users)) AS char_stats`]);
    return row;
  };
  const noOrphans = { test_questions: 0, tests: 0, sessions: 0, vocab_progress: 0, char_stats: 0 };

  /** A client with two tests, the first with one answered question. */
  async function playedUser(client) {
    const first = (await client.post('/api/tests', { count: 5 })).body;
    const { kana } = await ctx.db.get('SELECT kana FROM test_questions WHERE id = ?', [first.current.id]);
    const res = await client.post(`/api/tests/${first.test.id}/questions/${first.current.id}/answer`, { answer: kana });
    assert.equal(res.status, 200, res.text);
    const second = (await client.post('/api/tests', { count: 5 })).body;
    return { first: first.test.id, second: second.test.id };
  }
  const count = async (sql, args) => (await ctx.db.get(sql, args)).n;

  it('runs with foreign keys off, as on a remote connection', async () => {
    assert.equal((await ctx.db.get('PRAGMA foreign_keys')).foreign_keys, 0);
  });

  it('DELETE /api/tests/:id deletes its questions explicitly', async () => {
    const { client } = await registerUser(ctx);
    const { first, second } = await playedUser(client);
    assert.equal((await client.del(`/api/tests/${first}`)).status, 204);
    assert.equal(await count('SELECT COUNT(*) AS n FROM test_questions WHERE test_id = ?', [first]), 0);
    assert.equal(await count('SELECT COUNT(*) AS n FROM test_questions WHERE test_id = ?', [second]), 5, 'other tests keep theirs');
    assert.equal((await client.del(`/api/tests/${first}`)).status, 404);
    assert.deepEqual(await orphans(), noOrphans);
  });

  it('another user cannot delete (or empty) a test that is not theirs', async () => {
    const owner = await registerUser(ctx);
    const { second } = await playedUser(owner.client);
    const intruder = await registerUser(ctx);
    assert.equal((await intruder.client.del(`/api/tests/${second}`)).status, 404);
    assert.equal(await count('SELECT COUNT(*) AS n FROM test_questions WHERE test_id = ?', [second]), 5);
  });

  it('DELETE /api/progress leaves no question rows behind', async () => {
    const { client, user, password } = await registerUser(ctx);
    const { first, second } = await playedUser(client);
    assert.equal((await client.del('/api/progress', { password })).status, 204);
    assert.equal(await count('SELECT COUNT(*) AS n FROM test_questions WHERE test_id IN (?, ?)', [first, second]), 0);
    assert.equal(await count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [user.id]), 1, 'still logged in');
    assert.deepEqual(await orphans(), noOrphans);
  });

  it('DELETE /api/auth/me removes every row of the account', async () => {
    const { client, user, password } = await registerUser(ctx);
    await registerUser(ctx, { email: `other-${Date.now()}@x.io` }); // must survive
    const { first, second } = await playedUser(client);
    const usersBefore = await count('SELECT COUNT(*) AS n FROM users', []);
    assert.equal((await client.del('/api/auth/me', { password })).status, 204);
    assert.equal(await count('SELECT COUNT(*) AS n FROM test_questions WHERE test_id IN (?, ?)', [first, second]), 0);
    assert.equal(await count('SELECT COUNT(*) AS n FROM users', []), usersBefore - 1);
    assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?', [user.id]), 0);
    assert.deepEqual(await orphans(), noOrphans);
  });

  it('housekeeping removes a stale guest with all their data', async () => {
    const guest = ctx.client();
    const { user } = (await guest.post('/api/auth/guest')).body;
    const { first } = await playedUser(guest);
    const longAgo = '2020-01-01T00:00:00.000Z';
    await ctx.db.batch([
      ['UPDATE users SET updated_at = ? WHERE id = ?', [longAgo, user.id]],
      ['UPDATE sessions SET expires_at = ? WHERE user_id = ?', [longAgo, user.id]],
    ]);
    const result = await housekeeping(ctx.db);
    assert.ok(result.guests >= 1 && result.sessions >= 1);
    assert.equal(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?', [user.id]), 0);
    assert.equal(await count('SELECT COUNT(*) AS n FROM test_questions WHERE test_id = ?', [first]), 0);
    assert.deepEqual(await orphans(), noOrphans);
  });
});

describe('race guards', () => {
  /** @type {Awaited<ReturnType<typeof startTestServer>>} */
  let ctx;
  before(async () => {
    ctx = await startTestServer();
  });
  after(async () => {
    assert.deepEqual(ctx.errors.map(String), []);
    await ctx.close();
  });

  /**
   * A view of ctx.db whose write batches wait until `reads` read batches have completed, so
   * concurrent actions all read before any of them writes (the worst interleaving).
   * `onReads` runs once that many reads are done, before the writes are released.
   */
  function gatedDb(reads, onReads = async () => {}) {
    const db = ctx.db;
    let done = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    return {
      get: (...a) => db.get(...a),
      all: (...a) => db.all(...a),
      run: (...a) => db.run(...a),
      async read(stmts) {
        const rows = await db.read(stmts);
        done += 1;
        if (done === reads) onReads().then(release, release);
        return rows;
      },
      async batch(stmts) {
        await gate;
        return db.batch(stmts);
      },
    };
  }

  async function freshTest(count = 5) {
    const { client, user } = await registerUser(ctx);
    const { test, current } = (await client.post('/api/tests', { script: 'hiragana', count })).body;
    const { kana } = await ctx.db.get('SELECT kana FROM test_questions WHERE id = ?', [current.id]);
    return { client, user, test, current, kana };
  }
  const testRow = (id) => ctx.db.get('SELECT * FROM tests WHERE id = ?', [id]);
  const codeOf = (settled) => settled.filter((s) => s.status === 'rejected').map((s) => s.reason.code);
  const input = (answer) => ({ answer, timeMs: 1000, hint2From: null, hint2Revealed: null, inputMethod: 'keys' });

  it('applies exactly one of two concurrent answers to the same question', async () => {
    const { user, test, current, kana } = await freshTest();
    const db = gatedDb(2);
    const settled = await Promise.allSettled([
      answerQuestion(db, user.id, test.id, current.id, input(kana)),
      answerQuestion(db, user.id, test.id, current.id, input(kana)),
    ]);
    assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
    assert.deepEqual(codeOf(settled), ['QUESTION_NOT_CURRENT']);
    const row = await testRow(test.id);
    assert.deepEqual([row.current_index, row.correct_count, row.score, row.time_spent_ms, row.current_streak],
      [1, 1, 100, 1000, 1]);
    const vp = await ctx.db.get('SELECT seen, correct FROM vocab_progress WHERE user_id = ?', [user.id]);
    assert.deepEqual(vp, { seen: 1, correct: 1 });
    const chars = await ctx.db.get('SELECT SUM(correct) AS n FROM char_stats WHERE user_id = ?', [user.id]);
    assert.equal(chars.n, [...kana].length, 'kana stats counted once');
  });

  it('applies exactly one of an answer and a skip racing on the same question', async () => {
    const { user, test, current, kana } = await freshTest();
    const db = gatedDb(2);
    const settled = await Promise.allSettled([
      skipQuestion(db, user.id, test.id, current.id, { timeMs: 10 }),
      answerQuestion(db, user.id, test.id, current.id, input(kana)),
    ]);
    assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
    const row = await testRow(test.id);
    assert.equal(row.current_index, 1);
    assert.equal(row.correct_count + row.skipped_count, 1);
    const q = await ctx.db.get('SELECT status, word_id FROM test_questions WHERE id = ?', [current.id]);
    assert.equal(q.status, row.correct_count ? 'correct' : 'skipped', 'the stored answer is the one that was counted');
    const vp = await ctx.db.get('SELECT seen, last_result FROM vocab_progress WHERE user_id = ? AND word_id = ?', [user.id, q.word_id]);
    assert.deepEqual(vp, { seen: 1, last_result: q.status });
  });

  it('finishes a test only once when the last answer is submitted twice', async () => {
    const { client, user, test, current } = await freshTest();
    let q = current;
    for (let i = 0; i < 4; i += 1) q = (await client.post(`/api/tests/${test.id}/questions/${q.id}/skip`, { timeMs: 1 })).body.next;
    const { kana } = await ctx.db.get('SELECT kana FROM test_questions WHERE id = ?', [q.id]);
    const db = gatedDb(2);
    const settled = await Promise.allSettled([
      answerQuestion(db, user.id, test.id, q.id, input(kana)),
      answerQuestion(db, user.id, test.id, q.id, input(kana)),
    ]);
    const won = settled.find((s) => s.status === 'fulfilled');
    assert.equal(won.value.completed, true);
    assert.equal(won.value.next, null);
    assert.deepEqual(codeOf(settled), ['TEST_NOT_ACTIVE']);
    const row = await testRow(test.id);
    assert.deepEqual([row.status, row.current_index, row.correct_count, row.skipped_count, row.score], ['completed', 5, 1, 4, 100]);
    assert.ok(row.finished_at);
    const vp = await ctx.db.get('SELECT seen FROM vocab_progress WHERE user_id = ? AND word_id = (SELECT word_id FROM test_questions WHERE id = ?)',
      [user.id, q.id]);
    assert.equal(vp.seen, 1, 'the last word is recorded once');
    const chars = await ctx.db.get('SELECT SUM(correct) AS n FROM char_stats WHERE user_id = ?', [user.id]);
    assert.equal(chars.n, [...kana].length);
  });

  it('writes nothing when the test is closed between an answer\'s read and write', async () => {
    const { user, test, current, kana } = await freshTest();
    const db = gatedDb(1, () => closeTest(ctx.db, user.id, test.id));
    await assert.rejects(answerQuestion(db, user.id, test.id, current.id, input(kana)), { code: 'TEST_NOT_ACTIVE' });
    const row = await testRow(test.id);
    assert.deepEqual([row.status, row.current_index, row.correct_count, row.score], ['closed', 0, 0, 0]);
    assert.equal((await ctx.db.get('SELECT status FROM test_questions WHERE id = ?', [current.id])).status, 'pending');
    assert.equal(await ctx.db.get('SELECT 1 FROM vocab_progress WHERE user_id = ?', [user.id]), undefined);
  });

  it('rescores an answer when a hint lands between its read and write', async () => {
    const { user, test, current, kana } = await freshTest();
    const db = gatedDb(1, () => useHint(ctx.db, user.id, test.id, current.id, 'script'));
    const result = await answerQuestion(db, user.id, test.id, current.id, input(kana));
    assert.equal(result.question.hint1_used, 1);
    assert.equal(result.question.points, 80, 'the script hint costs 20 points');
    const row = await testRow(test.id);
    assert.deepEqual([row.score, row.hint1_count, row.current_index], [80, 1, 1]);
  });

  it('counts a hint once when it is requested twice at the same time', async () => {
    const { user, test, current } = await freshTest();
    const db = gatedDb(2);
    const [a, b] = await Promise.all([
      useHint(db, user.id, test.id, current.id, 'spelling'),
      useHint(db, user.id, test.id, current.id, 'spelling'),
    ]);
    assert.equal(a.question.hint2_used, 1);
    assert.equal(b.question.hint2_used, 1);
    assert.equal((await testRow(test.id)).hint2_count, 1);
  });

  it('answers a double-submitted HTTP answer once (200 + 409)', async () => {
    const { client, test, current, kana } = await freshTest();
    const url = `/api/tests/${test.id}/questions/${current.id}/answer`;
    const responses = await Promise.all([client.post(url, { answer: kana }), client.post(url, { answer: kana })]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(responses.find((r) => r.status === 409).body.error.code, 'QUESTION_NOT_CURRENT');
    const state = (await client.get(`/api/tests/${test.id}/state`)).body;
    assert.deepEqual([state.test.answeredCount, state.test.correctCount, state.current.position], [1, 1, 1]);
  });

  it('merges concurrent settings saves instead of losing one', async () => {
    const { client } = await registerUser(ctx);
    const results = await Promise.all([
      client.patch('/api/auth/me', { settings: { sound: false } }),
      client.patch('/api/auth/me', { settings: { theme: 'dark' } }),
      client.patch('/api/auth/me', { settings: { ttsRate: 0.7 } }),
    ]);
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
    const { settings } = (await client.get('/api/auth/me')).body.user;
    assert.deepEqual([settings.sound, settings.theme, settings.ttsRate], [false, 'dark', 0.7]);
  });
});

describe('round trips per request', () => {
  /** Database calls (each one network round trip on a remote database) made by the app. */
  let calls = [];
  let server;
  let db;
  let base;
  before(async () => {
    db = await openDatabase(':memory:');
    const counted = new Proxy(db, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== 'function') return value;
        return (...args) => {
          if (['get', 'all', 'read', 'run', 'batch'].includes(String(prop))) calls.push(String(prop));
          return value.apply(target, args);
        };
      },
    });
    const config = {
      ...loadConfig({ NODE_ENV: 'test' }), dbPath: ':memory:', wordsPath: FIXTURE_WORDS_PATH,
      authRateLimit: { windowMs: 60_000, max: 10_000 }, loginFailureLimit: { windowMs: 60_000, max: 10_000 },
    };
    const app = createApp({ config, db: counted, wordbank: await loadWordBank(FIXTURE_WORDS_PATH) });
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  /** Database calls made while running `fn`. */
  const tripsOf = async (fn) => {
    calls = [];
    const res = await fn();
    assert.ok(res.status < 300, `${res.status} ${res.text}`);
    return [...calls];
  };

  it('keeps the main requests within a few sequential round trips', async () => {
    const client = new Client(base);
    assert.deepEqual(await tripsOf(() => client.post('/api/auth/register',
      { displayName: 'Trips', email: `trips-${Date.now()}@x.io`, password: 'long enough 1' })), ['get', 'batch']);
    assert.deepEqual(await tripsOf(() => client.get('/api/auth/me')), ['get'], 'session lookup: one query');
    assert.deepEqual(await tripsOf(() => client.get('/api/words/sample?n=3')), [], 'public routes skip the session');
    let created;
    assert.deepEqual(await tripsOf(async () => {
      created = await client.post('/api/tests', { script: 'hiragana', count: 5 });
      return created;
    }), ['get', 'all', 'batch']);
    const { test, current } = created.body;
    const { kana } = await db.get('SELECT kana FROM test_questions WHERE id = ?', [current.id]);
    assert.deepEqual(await tripsOf(() => client.post(`/api/tests/${test.id}/questions/${current.id}/answer`, { answer: kana })),
      ['get', 'read', 'batch'], 'answer: session + read + one write batch');
    assert.deepEqual(await tripsOf(() => client.get(`/api/tests/${test.id}/state`)), ['get', 'read']);
    assert.deepEqual(await tripsOf(() => client.get('/api/stats/overview')), ['get', 'read'], 'dashboard: one read batch');
    assert.deepEqual(await tripsOf(() => client.get('/api/vocab')), ['get', 'all']);
    if (fs.existsSync(new URL('../server/report/pdf.js', import.meta.url))) {
      assert.deepEqual(await tripsOf(() => client.get(`/api/tests/${test.id}/report.pdf`)), ['get', 'read']);
      assert.deepEqual(await tripsOf(() => client.get('/api/reports/overall.pdf')), ['get', 'read']);
    }
  });

  it('refreshes last_seen_at at most every 5 minutes, as the only extra session query', async () => {
    const client = new Client(base);
    await client.post('/api/auth/guest');
    const old = new Date(Date.now() - 6 * 60_000).toISOString();
    await db.run('UPDATE sessions SET last_seen_at = ?', [old]);
    assert.deepEqual(await tripsOf(() => client.get('/api/auth/me')), ['get', 'run']);
    assert.deepEqual(await tripsOf(() => client.get('/api/auth/me')), ['get']);
  });
});

describe('GET /api/health', () => {
  it('answers { ok: true } without touching the database', async () => {
    const broken = new Proxy({}, { get() { throw new Error('database used'); } });
    const errors = [];
    const config = { ...loadConfig({ NODE_ENV: 'test' }), wordsPath: FIXTURE_WORDS_PATH };
    const app = createApp({ config, db: broken, wordbank: await loadWordBank(FIXTURE_WORDS_PATH), log: (e) => errors.push(e) });
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const client = new Client(`http://127.0.0.1:${server.address().port}`);
      client.cookies.set('hk_sid', 'some-session-token');
      const res = await client.get('/api/health', { csrf: false });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true });
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal((await client.request('HEAD', '/api/health', undefined, { csrf: false })).status, 200);
      assert.deepEqual(errors, []);
      assert.equal((await client.get('/api/auth/me')).status, 500, 'control: other API routes do use the database');
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('database and proxy configuration', () => {
  it('selects Turso only when TURSO_DATABASE_URL is set', () => {
    const local = loadConfig({ TURSO_AUTH_TOKEN: 'ignored' });
    assert.equal(local.dbUrl, null);
    assert.equal(local.dbAuthToken, null);
    assert.equal(path.basename(local.dbPath), 'hirakata.db');
    const remote = loadConfig({ TURSO_DATABASE_URL: ' libsql://app-org.turso.io ', TURSO_AUTH_TOKEN: 'tok' });
    assert.equal(remote.dbUrl, 'libsql://app-org.turso.io');
    assert.equal(remote.dbAuthToken, 'tok');
  });

  it('opens a file: TURSO_DATABASE_URL as a local database', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hirakata-url-'));
    try {
      const db = await openDatabase({ url: fileUrl(path.join(dir, 'x.db')) });
      assert.equal(db.remote, false);
      assert.equal(await schemaVersion(db), SCHEMA_VERSION);
      db.close();
    } finally {
      await removeDbDir(dir);
    }
  });

  it('parses TRUST_PROXY digits as a hop count before booleans', () => {
    assert.equal(parseTrustProxy('1'), 1, '"1" trusts exactly one proxy (e.g. Render), not every hop');
    assert.equal(parseTrustProxy('2'), 2);
    assert.equal(parseTrustProxy(' 1 '), 1);
    assert.equal(parseTrustProxy('0'), false);
    for (const v of ['true', 'yes', 'on']) assert.equal(parseTrustProxy(v), true, v);
    for (const v of ['false', 'no', 'off', '', undefined]) assert.equal(parseTrustProxy(v), false, String(v));
    assert.equal(parseTrustProxy('loopback'), 'loopback');
    assert.equal(loadConfig({ TRUST_PROXY: '1' }).trustProxy, 1);
  });
});
