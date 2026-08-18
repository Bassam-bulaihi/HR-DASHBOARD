import { Router } from 'express';
import {
  authenticate,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  ROLE_LABELS,
} from '../auth.js';

const router = Router();

/** POST /api/auth/login */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبان.' });
    }

    const user = await authenticate(email, password);
    if (!user) {
      // Deliberately vague: don't confirm whether the email exists.
      return res
        .status(401)
        .json({ error: 'بيانات الدخول غير صحيحة.' });
    }

    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleLabel: ROLE_LABELS[user.role],
      },
      token,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/logout */
router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

/** GET /api/auth/me — used by the client on boot to restore a session. */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.sub,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      roleLabel: ROLE_LABELS[req.user.role],
    },
  });
});

export default router;
