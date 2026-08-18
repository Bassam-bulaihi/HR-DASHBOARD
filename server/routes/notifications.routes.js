import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIF_FILE = path.join(__dirname, '..', '..', 'data', 'notifications.json');
const MAX_NOTIFICATIONS = 50;

const router = Router();

async function readNotifications() {
  try {
    const raw = await fs.readFile(NOTIF_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeNotifications(list) {
  await fs.writeFile(NOTIF_FILE, JSON.stringify(list.slice(0, MAX_NOTIFICATIONS), null, 2), 'utf8');
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
