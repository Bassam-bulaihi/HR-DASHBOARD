import { Router } from 'express';
import { list, replaceAll } from '../store.js';
import { requireAuth } from '../auth.js';

const MAX_NOTIFICATIONS = 50;

const router = Router();

// Notifications go through store.js like every other collection. Reading them
// directly off disk here used to bypass the serverless writable-dir handling,
// so "mark all as read" silently did nothing on Vercel.
async function readNotifications() {
  try {
    return await list('notifications');
  } catch {
    // A missing or unreadable log should never break the bell icon.
    return [];
  }
}

async function writeNotifications(rows) {
  await replaceAll('notifications', rows.slice(0, MAX_NOTIFICATIONS));
}

/** GET /api/notifications — returns latest 20 */
router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const all = await readNotifications();
    const unreadCount = all.filter((n) => !n.read).length;
    res.json({ data: all.slice(0, 20), unreadCount });
  } catch (err) {
    next(err);
  }
});

/** POST /api/notifications/read — mark all as read */
router.post('/read', requireAuth, async (_req, res, next) => {
  try {
    const all = await readNotifications();
    all.forEach((n) => (n.read = true));
    await writeNotifications(all);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;

/* ---- Helper: push a notification from other routes ---- */

export async function pushNotification({ type, title, body, icon }) {
  try {
    const all = await readNotifications();
    all.unshift({
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: type || 'info', // info | success | warning | employee | attendance | payroll
      title,
      body: body || '',
      icon: icon || 'bell',
      read: false,
      createdAt: new Date().toISOString(),
    });
    await writeNotifications(all);
  } catch {
    // Notifications failing should never break the main operation
  }
}
