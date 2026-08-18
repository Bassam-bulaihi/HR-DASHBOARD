/**
 * auth.js — JWT issuing/verification and role-based route guards.
 *
 * Roles (per the PRD): admin | hr-standard | view-only
 *   admin        — full access, including delete and payroll mutation
 *   hr-standard  — create/read/update employees + attendance; no delete
 *   view-only     — read everything, write nothing
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { findOne } from './store.js';

const TOKEN_COOKIE = 'hr360_token';
const TOKEN_TTL = '8h';

export const ROLES = {
  ADMIN: 'admin',
  HR: 'hr-standard',
  VIEW: 'view-only',
};

/** Arabic labels for roles, surfaced in the UI. */
export const ROLE_LABELS = {
  [ROLES.ADMIN]: 'مدير النظام',
  [ROLES.HR]: 'موارد بشرية',
  [ROLES.VIEW]: 'اطلاع فقط',
};

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s === 'change-me') {
    // Loud in production, tolerable in local dev — a prototype that refuses to
    // boot because an env var is missing is worse than one that warns.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET must be set to a strong random value in production.'
      );
    }
    return 'dev-only-insecure-secret';
  }
  return s;
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    secret(),
    { expiresIn: TOKEN_TTL }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, secret());
  } catch {
    return null;
  }
}

/** Look up a user by email and verify the supplied password against the stored hash. */
export async function authenticate(email, password) {
  const user = await findOne(
    'users',
    (u) => u.email.toLowerCase() === String(email || '').toLowerCase()
  );
  // Always run a bcrypt comparison even when the user is absent, so response
  // timing doesn't reveal which emails exist.
  const hash = user?.passwordHash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(String(password || ''), hash);
  if (!user || !ok || user.active === false) return null;
  return user;
}

export function setAuthCookie(res, token) {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(TOKEN_COOKIE);
}

/** Populates req.user when a valid token is present. Never rejects. */
export function attachUser(req, _res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.[TOKEN_COOKIE] || bearer;
  req.user = token ? verifyToken(token) : null;
  next();
}

/** Rejects the request unless a valid session is present. */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res
      .status(401)
      .json({ error: 'يلزم تسجيل الدخول للوصول إلى هذه الصفحة.' });
  }
  next();
}

/** Rejects the request unless the session holds one of `allowed`. */
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'يلزم تسجيل الدخول.' });
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: 'صلاحياتك الحالية لا تسمح بتنفيذ هذا الإجراء.',
        required: allowed,
        actual: req.user.role,
      });
    }
    next();
  };
}

/** Any role that is permitted to mutate data. */
export const canWrite = [ROLES.ADMIN, ROLES.HR];
/** Destructive operations are admin-only. */
export const canDelete = [ROLES.ADMIN];

export { TOKEN_COOKIE };
