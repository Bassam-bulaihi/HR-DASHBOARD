import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { attachUser } from './auth.js';
import { healthCheck, DATA_DIR } from './store.js';
import authRoutes from './routes/auth.routes.js';
import employeeRoutes from './routes/employees.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import payrollRoutes from './routes/payroll.routes.js';
import notificationRoutes from './routes/notifications.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();

// Replit terminates TLS upstream; trusting the proxy makes secure cookies work.
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(attachUser);

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/notifications', notificationRoutes);

app.get('/api/health', async (_req, res) => {
  const storage = await healthCheck();
  const ok = Object.values(storage).every((s) => s.ok);
  res.status(ok ? 200 : 503).json({ ok, storage, dataDir: DATA_DIR });
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Unmatched /api/* should 404 as JSON, not fall through to the SPA shell.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'المسار غير موجود.' });
});

// Client-side routing: every other GET returns the shell.
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Central error handler — keeps stack traces off the wire in production.
app.use((err, _req, res, _next) => {
  const isStoreError = err?.name === 'StoreError';
  const status = isStoreError ? 503 : 500;
  console.error('[error]', err.message);
  res.status(status).json({
    error: isStoreError
      ? err.message
      : 'حدث خطأ غير متوقع في الخادم.',
    ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
  });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 so Replit can publish it

const server = app.listen(PORT, HOST, async () => {
  const storage = await healthCheck();
  const broken = Object.entries(storage).filter(([, s]) => !s.ok);

  console.log(`\n  HR Core يعمل على http://${HOST}:${PORT}`);
  console.log(`  مجلد البيانات: ${DATA_DIR}`);

  if (broken.length) {
    console.warn('\n  ⚠ ملفات بيانات غير صالحة:');
    broken.forEach(([name, s]) => console.warn(`    • ${name}: ${s.error}`));
    console.warn('  شغّل "npm run seed" لإصلاحها.\n');
  } else {
    const counts = Object.entries(storage)
      .map(([n, s]) => `${n}=${s.count}`)
      .join('  ');
    console.log(`  البيانات: ${counts}\n`);
  }
});

// Replit restarts containers frequently; exit cleanly so the port frees up.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

export default app;
