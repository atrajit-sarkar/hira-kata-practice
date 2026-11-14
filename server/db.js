/**
 * SQLite access via node:sqlite: opening, migrations, transactions and housekeeping (SPEC §5).
 * @module server/db
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Ordered migrations; migration i brings the schema to `PRAGMA user_version = i + 1`.
 * Never edit a released migration — append a new one.
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

/** @type {WeakMap<DatabaseSync, Map<string, import('node:sqlite').StatementSync>>} */
const statementCache = new WeakMap();

/**
 * Open (creating if needed) and migrate the database.
 * @param {string} dbPath file path or ':memory:'
 * @returns {DatabaseSync}
 */
export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

/**
 * Apply pending migrations, each in its own transaction.
 * @param {DatabaseSync} db
 * @throws {Error} when the database was created by a newer version of the app
 */
export function migrate(db) {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (current > SCHEMA_VERSION) {
    throw new Error(`Database schema version ${current} is newer than this app supports (${SCHEMA_VERSION}).`);
  }
  for (let v = current; v < SCHEMA_VERSION; v += 1) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/**
 * Get a cached prepared statement.
 * @param {DatabaseSync} db
 * @param {string} sql
 * @returns {import('node:sqlite').StatementSync}
 */
export function stmt(db, sql) {
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map();
    statementCache.set(db, cache);
  }
  let statement = cache.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    cache.set(sql, statement);
  }
  return statement;
}

/**
 * Run `fn` inside `BEGIN IMMEDIATE … COMMIT`, rolling back if it throws.
 * Nested calls join the outer transaction.
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn synchronous callback
 * @returns {T}
 */
export function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

/** Guests without a live session are removed after this much inactivity. */
const GUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Delete expired sessions and abandoned guest accounts (SPEC §5).
 * @param {DatabaseSync} db
 * @param {Date} [now=new Date()]
 * @returns {{ sessions: number, guests: number }} rows deleted
 */
export function housekeeping(db, now = new Date()) {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - GUEST_RETENTION_MS).toISOString();
  return tx(db, () => {
    const sessions = stmt(db, 'DELETE FROM sessions WHERE expires_at <= ?').run(nowIso).changes;
    const guests = stmt(db, `
      DELETE FROM users
      WHERE is_guest = 1 AND updated_at < ?
        AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id AND s.expires_at > ?)
    `).run(cutoff, nowIso).changes;
    return { sessions: Number(sessions), guests: Number(guests) };
  });
}
