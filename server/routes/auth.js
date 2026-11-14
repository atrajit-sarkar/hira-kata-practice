/**
 * Account routes: register, login, guest, upgrade, logout, profile, password, deletion and
 * progress reset (SPEC §7.2 "Auth"). Mounted at `/api`.
 * @module server/routes/auth
 */
import { Router } from 'express';
import {
  clearSessionCookie, hashPassword, readSettings, requireAuth, serializeUser, startSession,
  validateSettingsPatch, verifyAgainstDummy, verifyPassword,
} from '../auth.js';
import { stmt, tx } from '../db.js';
import { ApiError, Validator, bodyOf, validationError } from '../http.js';

const getUser = (db, id) => stmt(db, 'SELECT * FROM users WHERE id = ?').get(id);
const emailTaken = (db, email) => Boolean(stmt(db, 'SELECT 1 FROM users WHERE email = ?').get(email));
const EMAIL_TAKEN = 'An account with this email already exists.';

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
  return /UNIQUE constraint failed/i.test(String(/** @type {any} */ (err)?.message));
}

/**
 * Build the auth router.
 * @param {{ db: import('node:sqlite').DatabaseSync, config: import('../config.js').Config,
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
    if (emailTaken(db, email)) throw new ApiError('CONFLICT', EMAIL_TAKEN, { fields: { email: EMAIL_TAKEN } });
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    let userId;
    try {
      userId = Number(stmt(db, `INSERT INTO users (email, display_name, password_hash, is_guest, settings,
                                  created_at, updated_at, last_login_at) VALUES (?, ?, ?, 0, '{}', ?, ?, ?)`)
        .run(email, displayName, passwordHash, now, now, now).lastInsertRowid);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError('CONFLICT', EMAIL_TAKEN, { fields: { email: EMAIL_TAKEN } });
      throw err;
    }
    startSession(deps, req, res, userId, 'remember');
    res.status(201).json({ user: serializeUser(getUser(db, userId)) });
  });

  router.post('/auth/login', authLimit, async (req, res) => {
    const body = bodyOf(req);
    const v = new Validator(body);
    const email = v.string('email', { min: 1, max: 254, label: 'Email' })?.toLowerCase();
    const password = v.string('password', { min: 1, max: 1024, trim: false, label: 'Password' });
    v.assert();
    const key = `login|${req.ip}|${email}`;
    if (limiters.loginFailures.isLimited(key)) throw limiters.loginFailures.error(key);
    const user = stmt(db, 'SELECT * FROM users WHERE email = ? AND is_guest = 0').get(email);
    const ok = user ? await verifyPassword(password, user.password_hash) : await verifyAgainstDummy(password);
    if (!ok) {
      limiters.loginFailures.hit(key);
      throw new ApiError('UNAUTHORIZED', 'Email or password is incorrect.');
    }
    limiters.loginFailures.reset(key);
    const now = new Date().toISOString();
    stmt(db, 'UPDATE users SET last_login_at = ? WHERE id = ?').run(now, user.id);
    startSession(deps, req, res, user.id, body.remember === true ? 'remember' : 'browser');
    res.json({ user: serializeUser(getUser(db, user.id)) });
  });

  router.post('/auth/guest', authLimit, (req, res) => {
    const now = new Date().toISOString();
    const userId = Number(stmt(db, `INSERT INTO users (email, display_name, password_hash, is_guest, settings,
                                      created_at, updated_at, last_login_at) VALUES (NULL, 'Guest', NULL, 1, '{}', ?, ?, ?)`)
      .run(now, now, now).lastInsertRowid);
    startSession(deps, req, res, userId, 'guest');
    res.status(201).json({ user: serializeUser(getUser(db, userId)) });
  });

  router.post('/auth/upgrade', authLimit, requireAuth, async (req, res) => {
    if (req.user.is_guest !== 1) throw new ApiError('CONFLICT', 'This account is already registered.');
    const { displayName, email, password } = readAccountFields(bodyOf(req));
    if (emailTaken(db, email)) throw new ApiError('CONFLICT', EMAIL_TAKEN, { fields: { email: EMAIL_TAKEN } });
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    try {
      stmt(db, `UPDATE users SET email = ?, display_name = ?, password_hash = ?, is_guest = 0,
                  updated_at = ?, last_login_at = ? WHERE id = ? AND is_guest = 1`)
        .run(email, displayName, passwordHash, now, now, req.user.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError('CONFLICT', EMAIL_TAKEN, { fields: { email: EMAIL_TAKEN } });
      throw err;
    }
    startSession(deps, req, res, req.user.id, 'remember');
    res.json({ user: serializeUser(getUser(db, req.user.id)) });
  });

  router.post('/auth/logout', (req, res) => {
    if (req.sessionId) stmt(db, 'DELETE FROM sessions WHERE id = ?').run(req.sessionId);
    clearSessionCookie(res, cookieOpts);
    res.status(204).end();
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: serializeUser(req.user) });
  });

  router.patch('/auth/me', requireAuth, (req, res) => {
    const body = bodyOf(req);
    const v = new Validator(body);
    const displayName = v.string('displayName', { min: 1, max: 40, optional: true, noControl: true, label: 'Display name' });
    let settings;
    if (body.settings !== undefined) {
      const { value, errors } = validateSettingsPatch(body.settings);
      Object.entries(errors).forEach(([k, msg]) => v.fail(k, msg));
      settings = { ...readSettings(req.user.settings), ...value };
    }
    v.assert();
    stmt(db, 'UPDATE users SET display_name = ?, settings = ?, updated_at = ? WHERE id = ?').run(
      displayName ?? req.user.display_name,
      settings ? JSON.stringify(settings) : req.user.settings,
      new Date().toISOString(),
      req.user.id,
    );
    res.json({ user: serializeUser(getUser(db, req.user.id)) });
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
    tx(db, () => {
      stmt(db, 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(passwordHash, new Date().toISOString(), req.user.id);
      stmt(db, 'DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.sessionId);
    });
    res.status(204).end();
  });

  router.delete('/auth/me', requireAuth, async (req, res) => {
    await confirmPassword(req, bodyOf(req).password, 'password');
    stmt(db, 'DELETE FROM users WHERE id = ?').run(req.user.id);
    clearSessionCookie(res, cookieOpts);
    res.status(204).end();
  });

  router.delete('/progress', requireAuth, async (req, res) => {
    await confirmPassword(req, bodyOf(req).password, 'password');
    tx(db, () => {
      for (const table of ['tests', 'vocab_progress', 'char_stats']) {
        stmt(db, `DELETE FROM ${table} WHERE user_id = ?`).run(req.user.id);
      }
      stmt(db, 'UPDATE users SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), req.user.id);
    });
    res.status(204).end();
  });

  return router;
}
