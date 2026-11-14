/**
 * Database access through `@libsql/client`: a remote Turso database (`libsql://…`) in production,
 * a local SQLite file (or `:memory:`) everywhere else. Opening, migrations, the async query
 * wrapper and housekeeping (SPEC §5).
 *
 * Remote libSQL is reached over stateless HTTP requests, so this module never relies on
 * per-connection state: no PRAGMA is needed for correctness, foreign keys are not enforced
 * (child rows are deleted explicitly, see {@link userDataDeletes}) and atomic actions are single
 * `batch` calls — one round trip each, run server-side as one transaction. There are no
 * interactive transactions: they would hold Turso's write lock across network round trips.
 * Read-check-write actions instead put their checks in the WHERE clauses of the batch
 * ("guarded" statements), which stay correct even with several server instances.
 * @module server/db
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

/**
 * Ordered migrations; migration i brings the schema to version i + 1 (stored in `schema_meta`).
 * Never edit a released migration — append a new one. Each is split into statements on `;`
 * at the end of a line, so keep semicolons out of string literals.
 */
export const MIGRATIONS = Object.freeze([
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    is_guest INTEGER NOT NULL DEFAULT 0,
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, user_agent TEXT
  );
  CREATE TABLE tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    config TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    total_questions INTEGER NOT NULL,
    current_index INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0, wrong_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    hint1_count INTEGER NOT NULL DEFAULT 0, hint2_count INTEGER NOT NULL DEFAULT 0,
    current_streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0,
    time_spent_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT
  );
  CREATE TABLE test_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    word_id TEXT NOT NULL,
    kana TEXT NOT NULL, romaji TEXT NOT NULL, script TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    user_answer TEXT,
    error_type TEXT,
    hint1_used INTEGER NOT NULL DEFAULT 0,
    hint2_used INTEGER NOT NULL DEFAULT 0,
    hint2_from INTEGER, hint2_revealed INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    time_ms INTEGER NOT NULL DEFAULT 0,
    answered_at TEXT,
    UNIQUE (test_id, position)
  );
  CREATE TABLE vocab_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    word_id TEXT NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0, wrong INTEGER NOT NULL DEFAULT 0,
    last_result TEXT,
    last_seen_at TEXT, starred INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, word_id)
  );
  CREATE TABLE char_stats (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    char TEXT NOT NULL, script TEXT NOT NULL,
    correct INTEGER NOT NULL DEFAULT 0, wrong INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, char)
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX idx_tests_user_updated ON tests(user_id, updated_at);
  CREATE INDEX idx_questions_test_position ON test_questions(test_id, position);
  CREATE INDEX idx_questions_answered_at ON test_questions(answered_at);
  `,
  // v2 (SPEC §15.2/15.3): romaji hint for listen mode and the input method of each answer.
  // input_method stays NULL for skipped questions and for answers recorded before v2 (unknown).
  `
  ALTER TABLE test_questions ADD COLUMN hint3_used INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE test_questions ADD COLUMN input_method TEXT;
  ALTER TABLE tests ADD COLUMN hint3_count INTEGER NOT NULL DEFAULT 0;
  `,
]);

/** Latest schema version. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * A statement: plain SQL, `[sql, args]` or `{ sql, args }`. Arguments are positional; SQL uses
 * `?` or numbered `?N` placeholders (numbered ones may repeat), never named ones.
 * @typedef {string | [string, unknown[]?] | { sql: string, args?: unknown[] }} Stmt
 */

/**
 * Result of a write statement.
 * @typedef {object} RunResult
 * @property {number} changes rows inserted, updated or deleted
 * @property {number|null} lastInsertRowid
 */

/**
 * Result of one statement of a write batch.
 * @typedef {RunResult & { rows: Record<string, any>[] }} BatchResult
 */

/**
 * Split a migration script into statements (`;` at the end of a line ends a statement).
 * @param {string} script
 * @returns {string[]}
 */
export function splitStatements(script) {
  return script.split(/;[ \t]*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
}

/** @type {Map<string, number|null>} */
const placeholderCounts = new Map();

/**
 * Number of positional arguments a statement takes (the largest `?N`, where a bare `?` is
 * "previous largest + 1", exactly as SQLite numbers them), or null when it uses named parameters.
 * String literals, quoted identifiers and comments are skipped.
 * @param {string} sql
 * @returns {number|null}
 */
export function countPlaceholders(sql) {
  let max = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = sql.indexOf(ch, i + 1);
      i = end < 0 ? sql.length : end;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 1;
    } else if (ch === '?') {
      let j = i + 1;
      while (j < sql.length && sql[j] >= '0' && sql[j] <= '9') j += 1;
      max = j > i + 1 ? Math.max(max, Number(sql.slice(i + 1, j))) : max + 1;
      i = j - 1;
    } else if ((ch === ':' || ch === '@' || ch === '$') && /[A-Za-z_]/.test(sql[i + 1] ?? '')) {
      return null;
    }
  }
  return max;
}

/**
 * Normalize a statement and check its argument count. The local driver silently binds NULL for
 * missing arguments while a remote server may reject the statement, so a mismatch is a bug that
 * must fail the same way everywhere.
 * @param {Stmt} stmt
 * @returns {{ sql: string, args: unknown[] }}
 * @throws {Error} when the number of arguments does not match the placeholders
 */
function normalize(stmt) {
  const { sql, args = [] } = typeof stmt === 'string' ? { sql: stmt }
    : Array.isArray(stmt) ? { sql: stmt[0], args: stmt[1] } : stmt;
  let expected = placeholderCounts.get(sql);
  if (expected === undefined) {
    expected = countPlaceholders(sql);
    placeholderCounts.set(sql, expected);
  }
  if (expected !== null && expected !== args.length) {
    throw new Error(`SQL expects ${expected} argument(s), got ${args.length}: ${sql.replace(/\s+/g, ' ').trim()}`);
  }
  return { sql, args };
}

/**
 * Plain row objects (first column of a given name wins) from a libSQL result set.
 * @param {import('@libsql/client').ResultSet} rs
 * @returns {Record<string, any>[]}
 */
function plainRows(rs) {
  return rs.rows.map((row) => {
    /** @type {Record<string, any>} */
    const out = {};
    rs.columns.forEach((column, i) => {
      if (!Object.hasOwn(out, column)) out[column] = row[i];
    });
    return out;
  });
}

/**
 * @param {import('@libsql/client').ResultSet} rs
 * @returns {BatchResult}
 */
function toResult(rs) {
  return {
    rows: plainRows(rs),
    changes: rs.rowsAffected,
    lastInsertRowid: rs.lastInsertRowid === undefined ? null : Number(rs.lastInsertRowid),
  };
}

/** Attempts for a write that fails with SQLITE_BUSY (it was rolled back, so a retry is safe). */
const BUSY_ATTEMPTS = 4;
const BUSY_BACKOFF_MS = 50;

/** @param {unknown} err @returns {boolean} */
function isBusy(err) {
  const e = /** @type {any} */ (err);
  return e?.code === 'SQLITE_BUSY' || e?.extendedCode?.startsWith?.('SQLITE_BUSY') === true
    || /database is locked/i.test(String(e?.message));
}

/**
 * Async wrapper around a libSQL client. Reads run concurrently; writes (`run`, `batch`) are
 * queued so one server process never has two writes in flight, which avoids SQLITE_BUSY on
 * Turso's single write lock (a write that still hits it is retried — it was rolled back).
 */
export class Database {
  /** @type {Promise<unknown>} */
  #writeTail = Promise.resolve();

  /**
   * @param {import('@libsql/client').Client} client
   * @param {{ remote: boolean, location: string }} info `location`: file path or redacted URL
   */
  constructor(client, { remote, location }) {
    this.client = client;
    this.remote = remote;
    this.location = location;
  }

  /**
   * First row of a query, or undefined.
   * @param {string} sql
   * @param {unknown[]} [args]
   * @returns {Promise<Record<string, any>|undefined>}
   */
  async get(sql, args = []) {
    return (await this.all(sql, args))[0];
  }

  /**
   * All rows of a query.
   * @param {string} sql
   * @param {unknown[]} [args]
   * @returns {Promise<Record<string, any>[]>}
   */
  async all(sql, args = []) {
    return plainRows(await this.client.execute(normalize([sql, args])));
  }

  /**
   * Several reads in one round trip, from one consistent snapshot.
   * @param {Stmt[]} statements
   * @returns {Promise<Record<string, any>[][]>} rows per statement
   */
  async read(statements) {
    if (!statements.length) return [];
    const results = await this.client.batch(statements.map(normalize), 'read');
    return results.map(plainRows);
  }

  /**
   * One write statement (autocommit).
   * @param {string} sql
   * @param {unknown[]} [args]
   * @returns {Promise<RunResult>}
   */
  async run(sql, args = []) {
    const stmt = normalize([sql, args]);
    const { changes, lastInsertRowid } = toResult(await this.#write(() => this.client.execute(stmt)));
    return { changes, lastInsertRowid };
  }

  /**
   * Statements run atomically in one write transaction and one round trip: if any statement
   * fails, none of them take effect. SELECTs in the batch see the batch's earlier writes.
   * @param {Stmt[]} statements
   * @returns {Promise<BatchResult[]>} one result per statement
   */
  async batch(statements) {
    const stmts = statements.map(normalize);
    if (!stmts.length) return [];
    const results = await this.#write(() => this.client.batch(stmts, 'write'));
    return results.map(toResult);
  }

  /** Close the client. */
  close() {
    this.client.close();
  }

  /**
   * Queue a write behind the previous one, retrying SQLITE_BUSY with a short backoff.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  #write(fn) {
    const attempt = async () => {
      for (let i = 1; ; i += 1) {
        try {
          return await fn();
        } catch (err) {
          if (i >= BUSY_ATTEMPTS || !isBusy(err)) throw err;
          await new Promise((resolve) => setTimeout(resolve, BUSY_BACKOFF_MS * i));
        }
      }
    };
    const result = this.#writeTail.then(attempt, attempt);
    this.#writeTail = result.catch(() => {});
    return result;
  }
}

/**
 * `file:` URL for a local path (libSQL parses it as a URI: `%`, `?` and `#` are escaped and
 * Windows backslashes become slashes).
 * @param {string} filePath
 * @returns {string}
 */
export function fileUrl(filePath) {
  const p = path.sep === '\\' ? filePath.replaceAll('\\', '/') : filePath;
  return `file:${p.replace(/[%?#]/g, encodeURIComponent)}`;
}

/**
 * A remote URL without credentials or query string, for logs.
 * @param {string} url
 * @returns {string}
 */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url.replace(/[?#].*$/, '');
  }
}

/**
 * Open (creating if needed) and migrate the database.
 * - `{ url }` with a `libsql:`/`https:`/`wss:` URL: remote libSQL (Turso), with `authToken`.
 * - otherwise a local SQLite file at `path` (or `url` when it is a `file:` URL), or `':memory:'`.
 * Local connections get `journal_mode=WAL` and `busy_timeout`, and `foreign_keys=OFF` so local
 * runs behave like a remote server where enforcement cannot be relied on.
 * @param {string | { url?: string|null, authToken?: string|null, path?: string }} target a local
 *        path (or ':memory:') or connection options
 * @returns {Promise<Database>}
 */
export async function openDatabase(target) {
  const opts = typeof target === 'string' ? { path: target } : target;
  const localPath = opts.path ?? ':memory:';
  const url = opts.url || (localPath === ':memory:' ? ':memory:' : fileUrl(localPath));
  const remote = !/^(file:|:memory:)/i.test(url);
  let db;
  if (remote) {
    db = new Database(createClient({ url, authToken: opts.authToken || undefined }),
      { remote: true, location: redactUrl(url) });
  } else {
    if (!opts.url && localPath !== ':memory:') fs.mkdirSync(path.dirname(localPath), { recursive: true });
    // One connection: every call is a short synchronous operation, and per-connection PRAGMAs
    // (and ':memory:' contents) must not be lost to a second pooled connection.
    db = new Database(createClient({ url, concurrency: 1 }), { remote: false, location: opts.url ? url : localPath });
  }
  try {
    if (!remote) {
      if (url !== ':memory:') await db.client.execute('PRAGMA journal_mode = WAL');
      await db.client.execute('PRAGMA busy_timeout = 5000');
      await db.client.execute('PRAGMA foreign_keys = OFF');
    }
    await migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/** Single-row table holding the schema version (replaces `PRAGMA user_version`, see below). */
const SCHEMA_META_DDL = `CREATE TABLE IF NOT EXISTS schema_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
)`;

/**
 * Version of a database created before `schema_meta` existed (schema ≤ v2): its
 * `PRAGMA user_version`, or — when that is unreadable or 0, e.g. after an import into a remote
 * database — what its tables show.
 * @param {Database} db
 * @param {Map<string, string>} tables name → CREATE statement
 * @returns {Promise<number>}
 */
async function legacyVersion(db, tables) {
  try {
    const version = Number((await db.get('PRAGMA user_version'))?.user_version);
    if (Number.isInteger(version) && version > 0) return version;
  } catch {
    // PRAGMA not available: fall through to the schema
  }
  return /\bhint3_used\b/.test(tables.get('test_questions') ?? '') ? 2 : 1;
}

/**
 * Current schema version, creating and seeding `schema_meta` when it is missing: 0 for an empty
 * database, the legacy version for a database made by an older HiraKata.
 * @param {Database} db
 * @returns {Promise<number>}
 */
export async function schemaVersion(db) {
  const tables = new Map((await db.all(`SELECT name, sql FROM sqlite_master
    WHERE type = 'table' AND name IN ('schema_meta', 'users', 'test_questions')`)).map((r) => [r.name, r.sql]));
  if (tables.has('schema_meta')) {
    const row = await db.get('SELECT version FROM schema_meta WHERE id = 1');
    if (row) return Number(row.version);
  }
  const seed = tables.has('users') ? await legacyVersion(db, tables) : 0;
  const results = await db.batch([
    SCHEMA_META_DDL,
    ['INSERT OR IGNORE INTO schema_meta (id, version) VALUES (1, ?)', [seed]],
    'SELECT version FROM schema_meta WHERE id = 1',
  ]);
  return Number(results[2].rows[0].version);
}

/**
 * Apply pending migrations, each with its version bump in one atomic batch. Running a migration
 * twice fails on its DDL (and rolls back), so racing instances cannot apply one twice.
 * @param {Database} db
 * @throws {Error} when the database was created by a newer version of the app
 */
export async function migrate(db) {
  const current = await schemaVersion(db);
  if (current > SCHEMA_VERSION) {
    throw new Error(`Database schema version ${current} is newer than this app supports (${SCHEMA_VERSION}).`);
  }
  for (let v = current; v < SCHEMA_VERSION; v += 1) {
    await db.batch([...splitStatements(MIGRATIONS[v]), ['UPDATE schema_meta SET version = ? WHERE id = 1', [v + 1]]]);
  }
}

/**
 * Statements deleting the data of the users whose ids `match` selects, children first (never rely
 * on ON DELETE CASCADE: remote connections do not enforce foreign keys).
 * @param {string} match SQL yielding user ids: `?` or a `SELECT id …` subquery
 * @param {unknown[]} args arguments of `match` (repeated for every statement)
 * @param {{ keepAccount?: boolean }} [options] keepAccount: keep the users row and its sessions
 * @returns {Stmt[]}
 */
export function userDataDeletes(match, args, { keepAccount = false } = {}) {
  const stmts = /** @type {Stmt[]} */ ([
    [`DELETE FROM test_questions WHERE test_id IN (SELECT id FROM tests WHERE user_id IN (${match}))`, args],
    [`DELETE FROM tests WHERE user_id IN (${match})`, args],
    [`DELETE FROM vocab_progress WHERE user_id IN (${match})`, args],
    [`DELETE FROM char_stats WHERE user_id IN (${match})`, args],
  ]);
  if (!keepAccount) {
    stmts.push([`DELETE FROM sessions WHERE user_id IN (${match})`, args], [`DELETE FROM users WHERE id IN (${match})`, args]);
  }
  return stmts;
}

/** Guests without a live session are removed after this much inactivity. */
const GUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Delete expired sessions and abandoned guest accounts with all their data (SPEC §5), in one batch.
 * @param {Database} db
 * @param {Date} [now=new Date()]
 * @returns {Promise<{ sessions: number, guests: number }>} rows deleted
 */
export async function housekeeping(db, now = new Date()) {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - GUEST_RETENTION_MS).toISOString();
  const staleGuests = `SELECT id FROM users WHERE is_guest = 1 AND updated_at < ?1
    AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id AND s.expires_at > ?2)`;
  const results = await db.batch([
    ['DELETE FROM sessions WHERE expires_at <= ?', [nowIso]],
    ...userDataDeletes(staleGuests, [cutoff, nowIso]),
  ]);
  return { sessions: results[0].changes, guests: results.at(-1).changes };
}
