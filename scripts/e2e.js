/**
 * e2e.js — Drives the real SPA in jsdom against a live server.
 * Verifies login, routing, table rendering, and RBAC-dependent UI.
 *
 *   node scripts/e2e.js            (expects server on :3000)
 */

import { JSDOM, VirtualConsole } from 'jsdom';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:3000';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail && !pass ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 6000, interval = 60 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* keep polling */
    }
    await sleep(interval);
  }
  return null;
}

async function boot() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.error('    [jsdom]', e.message));
  vc.on('error', (m) => console.error('    [console.error]', m));

  let html = await (await fetch(BASE)).text();

  // jsdom cannot execute <script type="module">, and it has no network access to
  // the vendored files over http here. So: bundle the app to a classic script and
  // inline both it and lucide directly into the document.
  const bundlePath = '/tmp/app.bundle.js';
  execFileSync(
    'npx',
    ['esbuild', 'public/js/app.js', '--bundle', '--format=iife',
     `--outfile=${bundlePath}`, '--log-level=warning'],
    { cwd: ROOT, stdio: 'pipe' }
  );

  const [bundle, lucideJs] = await Promise.all([
    fs.readFile(bundlePath, 'utf8'),
    fs.readFile(path.join(ROOT, 'public/vendor/lucide.min.js'), 'utf8'),
  ]);

  html = html
    .replace(/<link rel="stylesheet"[^>]*>/g, '')
    .replace(/<link rel="preload"[^>]*>/g, '')
    .replace(/<script src="\/vendor\/lucide\.min\.js"><\/script>/, '')
    .replace(/<script type="module"[^>]*><\/script>/, '');

  const dom = new JSDOM(html, {
    url: BASE,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });

  const { window } = dom;

  // jsdom has no fetch; proxy to node's, preserving cookies across the session.
  const jar = [];
  window.fetch = async (url, opts = {}) => {
    const target = url.startsWith('http') ? url : BASE + url;
    const headers = { ...(opts.headers || {}) };
    if (jar.length) headers.cookie = jar.join('; ');
    const res = await fetch(target, { ...opts, headers, redirect: 'manual' });
    const setCookie = res.headers.getSetCookie?.() || [];
    for (const c of setCookie) {
      const pair = c.split(';')[0];
      const name = pair.split('=')[0];
      const i = jar.findIndex((x) => x.startsWith(`${name}=`));
      if (i >= 0) jar[i] = pair;
      else jar.push(pair);
    }
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      json: async () => JSON.parse(body),
      text: async () => body,
    };
  };
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  window.scrollTo = () => {};

  // Icons first, then the app — app.js polls for window.lucide on boot.
  const run = (code) => {
    const s = window.document.createElement('script');
    s.textContent = code;
    window.document.body.appendChild(s);
  };
  run(lucideJs);
  run(bundle);

  return { dom, window };
}

async function main() {
  console.log('\nتشغيل اختبارات الواجهة (jsdom)\n');
  const { window } = await boot();
  const doc = window.document;

  /* ---------- Login screen ---------- */
  const loginForm = await waitFor(() => doc.querySelector('#loginForm'));
  check('يظهر نموذج تسجيل الدخول', Boolean(loginForm));
  check('اتجاه الصفحة RTL', doc.documentElement.getAttribute('dir') === 'rtl');
  check('لغة الصفحة عربية', doc.documentElement.getAttribute('lang') === 'ar');
  check(
    'أزرار الحسابات التجريبية موجودة',
    doc.querySelectorAll('.demo-account').length === 3
  );

  const iconsLoaded = await waitFor(() => doc.querySelector('.login__brand-mark svg'));
  check('أيقونات Lucide تُحمّل', Boolean(iconsLoaded));

  /* ---------- Log in as admin ---------- */
  doc.querySelector('#email').value = 'admin@hr360.sa';
  doc.querySelector('#password').value = 'Admin@123';
  loginForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  const shell = await waitFor(() => doc.querySelector('.app'));
  check('الدخول ينقل إلى لوحة التحكم', Boolean(shell));

  /* ---------- Employees page ---------- */
  const empRows = await waitFor(() => {
    const rows = doc.querySelectorAll('#empBody tr[data-id]');
    return rows.length ? rows : null;
  });
  check('جدول الموظفين يعرض صفوفًا', Boolean(empRows), 'no rows');
  check(
    'عدد الصفوف = حجم الصفحة (٨)',
    empRows && empRows.length === 8,
    `got ${empRows?.length}`
  );

  const hasArabicName = empRows && /[\u0600-\u06FF]/.test(empRows[0].textContent);
  check('أسماء الموظفين بالعربية', Boolean(hasArabicName));

  check(
    'المدير يرى أزرار الحذف',
    doc.querySelectorAll('#empBody [data-del]').length > 0
  );
  check('المدير يرى زر الإضافة', Boolean(doc.querySelector('#addBtn')));
  check(
    'بطاقات الإحصاء ظاهرة',
    doc.querySelectorAll('#empCards .card').length === 4
  );
  check('ترقيم الصفحات ظاهر', Boolean(doc.querySelector('#empPager .pager')));
  check(
    'الأرقام معزولة LTR',
    doc.querySelectorAll('#empBody .ltr').length > 0
  );

  /* ---------- Modal ---------- */
  doc.querySelector('#addBtn').click();
  const modal = await waitFor(() => doc.querySelector('.modal'));
  check('نافذة إضافة موظف تفتح', Boolean(modal));
  check('حقول النموذج مكتملة', Boolean(doc.querySelector('#empForm #f-salary')));
  doc.querySelector('.modal-backdrop [data-close]').click();
  await sleep(120);
  check('النافذة تُغلق', !doc.querySelector('.modal'));

  /* ---------- Attendance ---------- */
  window.location.hash = '/attendance';
  await sleep(200);
  const attRows = await waitFor(() => {
    const r = doc.querySelectorAll('#attBody tr');
    return r.length && !doc.querySelector('#attBody .skeleton') ? r : null;
  });
  check('صفحة الحضور تعرض سجلات', Boolean(attRows));
  check(
    'بطاقات الحضور الخمس ظاهرة',
    doc.querySelectorAll('#attCards .card').length === 5,
    `got ${doc.querySelectorAll('#attCards .card').length}`
  );
  const badges = [...doc.querySelectorAll('#attBody .badge')].map((b) => b.textContent.trim());
  check(
    'شارات الحالة تُعرض',
    badges.length > 0 && badges.some((b) => ['حاضر', 'غائب', 'متأخر', 'في إجازة'].includes(b)),
    badges.slice(0, 4).join(',')
  );
  check('زر تسجيل الحضور ظاهر للمدير', Boolean(doc.querySelector('#recordBtn')));

  /* ---------- Payroll ---------- */
  window.location.hash = '/payroll';
  await sleep(200);
  const payRows = await waitFor(() => {
    const r = doc.querySelectorAll('#payBody tr');
    return r.length && !doc.querySelector('#payBody .skeleton') ? r : null;
  });
  check('صفحة الرواتب تعرض سجلات', Boolean(payRows));
  check(
    'بطاقة الإجمالي تعرض مبلغًا',
    /\d/.test(doc.querySelector('#payCards .card__value')?.textContent || ''),
    doc.querySelector('#payCards .card__value')?.textContent
  );
  check(
    'تحليل الأقسام يُرسم',
    doc.querySelectorAll('#deptAnalytics .dept-bar').length > 0,
    `${doc.querySelectorAll('#deptAnalytics .dept-bar').length} bars`
  );
  check('زر صرف الرواتب ظاهر للمدير', Boolean(doc.querySelector('#payAllBtn')));
  check(
    'عملة الريال تظهر',
    (doc.querySelector('#payBody')?.textContent || '').includes('ر.س')
  );

  /* ---------- Logout ---------- */
  doc.querySelector('#logoutBtn').click();
  const backToLogin = await waitFor(() => doc.querySelector('#loginForm'));
  check('تسجيل الخروج يعيد لصفحة الدخول', Boolean(backToLogin));

  /* ---------- View-only RBAC ---------- */
  doc.querySelector('#email').value = 'viewer@hr360.sa';
  doc.querySelector('#password').value = 'View@1234';
  doc
    .querySelector('#loginForm')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => doc.querySelector('.app'));
  await waitFor(() => doc.querySelectorAll('#empBody tr[data-id]').length > 0);

  check('حساب الاطلاع: لا يوجد زر إضافة', !doc.querySelector('#addBtn'));
  check('حساب الاطلاع: لا توجد أزرار حذف', doc.querySelectorAll('#empBody [data-del]').length === 0);
  check('حساب الاطلاع: لا توجد أزرار تعديل', doc.querySelectorAll('#empBody [data-edit]').length === 0);

  /* ---------- Summary ---------- */
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} اختبار ناجح`);
  if (failed.length) {
    console.log('\nفشل:');
    failed.forEach((f) => console.log(`  • ${f.name} ${f.detail}`));
    process.exit(1);
  }
  console.log('كل الاختبارات ناجحة.\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nتعطل الاختبار:', e);
  process.exit(1);
});
