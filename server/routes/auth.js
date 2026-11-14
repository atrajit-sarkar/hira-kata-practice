/**
 * Account routes: register, login, guest, upgrade, logout, profile, password, deletion and
 * progress reset (SPEC §7.2 "Auth"). Mounted at `/api`.
 * Every action writes in one atomic batch (one database round trip).
 * @module server/routes/auth
 */
import { Router } from 'express';
import {
  clearSessionCookie, hashPassword, newSession, requireAuth, serializeUser, setSessionCookie,
  userOfSession, validateSettingsPatch, verifyAgainstDummy, verifyPassword,
} from '../auth.js';
import { userDataDeletes } from '../db.js';
import { ApiError, Validator, bodyOf, validationError } from '../http.js';

const emailTaken = async (db, email) => Boolean(await db.get('SELECT 1 FROM users WHERE email = ?', [email]));
const EMAIL_TAKEN = 'An account with this email already exists.';
const emailConflict = () => new ApiError('CONFLICT', EMAIL_TAKEN, { fields: { email: EMAIL_TAKEN } });

/**
 * Read display name, email and new password for register/upgrade.
 * @param {Record<string, unknown>} body
 * @returns {{ displayName: string, email: string, password: string }}
 */
function readAccountFields(body) {
  const v = new Validator(body);
  const displayName = v.string('displayName', { min: 1, max: 40, noControl: true, label: 'Display name' });
  const email = v.email('email');
  const password = v.newPassword('password');
  v.assert();
  return { displayName, email, password };
}

/** @param {unknown} err @returns {boolean} whether err is a UNIQUE constraint violation */
function isUniqueViolation(err) {
  const e = /** @type {any} */ (err);
  return e?.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(String(e?.message));
}

/**
 * Build the auth router.
 * @param {{ db: import('../db.js').Database, config: import('../config.js').Config,
 *           limiters: { auth: import('../security.js').RateLimiter,
 *                       loginFailures: import('../security.js').RateLimiter } }} deps
 * @returns {import('express').Router}
 */
export function authRoutes(deps) {
  const { db, config, limiters } = deps;
  const router = Router();
  const authLimit = limiters.auth.perIp();
  const cookieOpts = { secure: config.cookieSecure };

  /**
   * Run a batch that starts `session` and ends by selecting its user, set the cookie and
   * return the users row.
   * @param {import('express').Response} res
   * @param {ReturnType<typeof newSession>} session
   * @param {import('../db.js').Stmt[]} statements written before the session statements
   */
  async function writeWithSession(res, session, statements) {
    let results;
    try {
      results = await db.batch([...statements, ...session.statements, userOfSession(session.id)]);
    } catch (err) {
      if (isUniqueViolation(err)) throw emailConflict();
      throw err;
    }
    setSessionCookie(res, session.token, { secure: config.cookieSecure, maxAgeMs: session.maxAgeMs });
    return results.at(-1).rows[0];
  }

  /**
   * Require the account password for destructive actions (guests have none).
   * Wrong passwords are a 400 on the field, so the client session is not treated as expired.
   */
  async function confirmPassword(req, password, field) {
    if (req.user.is_guest === 1) return;
    const key = `confirm|${req.user.id}|${req.ip}`;
    if (limiters.loginFailures.isLimited(key)) throw limiters.loginFailures.error(key);
    if (typeof password !== 'string' || !password) {
      throw validationError({ [field]: 'Enter your password to confirm.' });
    }
    if (!(await verifyPassword(password, req.user.password_hash))) {
      limiters.loginFailures.hit(key);
      throw validationError({ [field]: 'Password is incorrect.' }, 'Password is incorrect.');
    }
    limiters.loginFailures.reset(key);
  }

  router.post('/auth/register', authLimit, async (req, res) => {
    const { displayName, email, password } = readAccountFields(bodyOf(req));
    if (await emailTaken(db, email)) throw emailConflict();
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const user = await writeWithSession(res, newSession(req, 'remember', null), [
      [`INSERT INTO users (email, display_name, password_hash, is_guest, settings, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, 0, '{}', ?, ?, ?)`, [email, displayName, passwordHash, now, now, now]],
    ]);
    res.status(201).json({ user: serializeUser(user) });
  });

  router.post('/auth/login', authLimit, async (req, res) => {
    const body = bodyOf(req);
    const v = new Validator(body);
    const email = v.string('email', { min: 1, max: 254, label: 'Email' })?.toLowerCase();
    const password = v.string('password', { min: 1, max: 1024, trim: false, label: 'Password' });
    v.assert();
    const key = `login|${req.ip}|${email}`;
    if (limiters.loginFailures.isLimited(key)) throw limiters.loginFailures.error(key);
    const user = await db.get('SELECT * FROM users WHERE email = ? AND is_guest = 0', [email]);
    const ok = user ? await verifyPassword(password, user.password_hash) : await verifyAgainstDummy(password);
    if (!ok) {
      limiters.loginFailures.hit(key);
      throw new ApiError('UNAUTHORIZED', 'Email or password is incorrect.');
    }
    limiters.loginFailures.reset(key);
    const session = newSession(req, body.remember === true ? 'remember' : 'browser', user.id);
    const row = await writeWithSession(res, session, [
      ['UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.id]],
    ]);
    res.json({ user: serializeUser(row) });
  });

  router.post('/auth/guest', authLimit, async (req, res) => {
    const now = new Date().toISOString();
    const user = await writeWithSession(res, newSession(req, 'guest', null), [
      [`INSERT INTO users (email, display_name, password_hash, is_guest, settings, created_at, updated_at, last_login_at)
        VALUES (NULL, 'Guest', NULL, 1, '{}', ?, ?, ?)`, [now, now, now]],
    ]);
    res.status(201).json({ user: serializeUser(user) });
  });

  router.post('/auth/upgrade', authLimit, requireAuth, async (req, res) => {
    if (req.user.is_guest !== 1) throw new ApiError('CONFLICT', 'This account is already registered.');
    const { displayName, email, password } = readAccountFields(bodyOf(req));
    if (await emailTaken(db, email)) throw emailConflict();
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const user = await writeWithSession(res, newSession(req, 'remember', req.user.id), [
      [`UPDATE users SET email = ?, display_name = ?, password_hash = ?, is_guest = 0, updated_at = ?, last_login_at = ?
        WHERE id = ? AND is_guest = 1`, [email, displayName, passwordHash, now, now, req.user.id]],
    ]);
    res.json({ user: serializeUser(user) });
  });

  router.post('/auth/logout', async (req, res) => {
    if (req.sessionId) await db.run('DELETE FROM sessions WHERE id = ?', [req.sessionId]);
    clearSessionCookie(res, cookieOpts);
    res.status(204).end();
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: serializeUser(req.user) });
  });

  router.patch('/auth/me', requireAuth, async (req, res) => {
    const body = bodyOf(req);
    const v = new Validator(body);
    const displayName = v.string('displayName', { min: 1, max: 40, optional: true, noControl: true, label: 'Display name' });
    let patch = null;
    if (body.settings !== undefined) {
      const { value, errors } = validateSettingsPatch(body.settings);
      Object.entries(errors).forEach(([k, msg]) => v.fail(k, msg));
      patch = JSON.stringify(value);
    }
    v.assert();
    // The patch is merged into the stored JSON by the database, so concurrent saves of different
    // settings cannot overwrite each other (stored values are re-validated by readSettings).
    const [, { rows: [user] }] = await db.batch([
      [`UPDATE users SET display_name = COALESCE(?1, display_name),
          settings = CASE WHEN ?2 IS NULL THEN settings
            ELSE json_patch(CASE WHEN json_valid(settings) AND json_type(settings) = 'object' THEN settings ELSE '{}' END, ?2) END,
          updated_at = ?3
        WHERE id = ?4`, [displayName ?? null, patch, new Date().toISOString(), req.user.id]],
      ['SELECT * FROM users WHERE id = ?', [req.user.id]],
    ]);
    res.json({ user: serializeUser(user) });
  });

  router.post('/auth/password', requireAuth, async (req, res) => {
    if (req.user.is_guest === 1) {
      throw new ApiError('CONFLICT', "Guest accounts don't have a password. Save your progress first.");
    }
    const body = bodyOf(req);
    const v = new Validator(body);
    v.string('currentPassword', { min: 1, max: 1024, trim: false, label: 'Current password' });
    const newPassword = v.newPassword('newPassword');
    v.assert();
    await confirmPassword(req, body.currentPassword, 'currentPassword');
    const passwordHash = await hashPassword(newPassword);
    await db.batch([
      ['UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, new Date().toISOString(), req.user.id]],
      ['DELETE FROM sessions WHERE user_id = ? AND id != ?', [req.user.id, req.sessionId]],
    ]);
    res.status(204).end();
  });

  router.delete('/auth/me', requireAuth, async (req, res) => {
    await confirmPassword(req, bodyOf(req).password, 'password');
    await db.batch(userDataDeletes('?', [req.user.id]));
    clearSessionCookie(res, cookieOpts);
    res.status(204).end();
  });

  router.delete('/progress', requireAuth, async (req, res) => {
    await confirmPassword(req, bodyOf(req).password, 'password');
    await db.batch([
      ...userDataDeletes('?', [req.user.id], { keepAccount: true }),
      ['UPDATE users SET updated_at = ? WHERE id = ?', [new Date().toISOString(), req.user.id]],
    ]);
    res.status(204).end();
  });

  return router;
}
