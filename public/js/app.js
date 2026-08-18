import { api, esc, icon, initials, toast, longDate } from './ui.js';
import { renderLogin } from './pages/login.js';
import { renderEmployees } from './pages/employees.js';
import { renderAttendance } from './pages/attendance.js';
import { renderPayroll } from './pages/payroll.js';

const root = document.getElementById('root');

/** Hexagon logo SVG with gradient purple→blue and an H in the center */
const LOGO_SVG = `<svg viewBox="0 0 44 44" width="40" height="40" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#534feb"/>
      <stop offset="100%" stop-color="#1c6ce5"/>
    </linearGradient>
  </defs>
  <polygon points="22,2 40,12 40,32 22,42 4,32 4,12" fill="url(#logoGrad)" rx="3"/>
  <text x="22" y="28" text-anchor="middle" font-size="18" font-weight="600" fill="white" font-family="var(--font), sans-serif">H</text>
</svg>`;

const ROUTES = {
  employees: { label: 'دليل الموظفين', render: renderEmployees },
  attendance: { label: 'الحضور', render: renderAttendance },
  payroll: { label: 'بيانات الرواتب', render: renderPayroll },
};

const OUT_OF_SCOPE = [
  ['user-plus', 'التوظيف'],
  ['trending-up', 'إدارة الأداء'],
  ['book-open', 'التدريب والتطوير'],
  ['calendar-days', 'الجدول الزمني'],
  ['file-text', 'التقارير والتحليلات'],
];

let currentUser = null;

/* ============================ Routing ============================ */

const currentRoute = () => {
  const hash = location.hash.replace(/^#\/?/, '');
  return ROUTES[hash] ? hash : 'employees';
};

function navigate(route) {
  location.hash = `/${route}`;
}

/* ============================ Relative time ============================ */

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `قبل ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  return `قبل ${days} يوم`;
}

const NOTIF_ICONS = {
  employee: 'user-round',
  attendance: 'clock',
  payroll: 'wallet',
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
};

/* ============================ Shell ============================ */

function renderShell() {
  const route = currentRoute();
  const today = longDate(new Date().toISOString().slice(0, 10));

  root.innerHTML = `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <span class="brand__mark">${LOGO_SVG}</span>
          <span class="brand__name">HR Core</span>
        </div>

        <nav class="nav">
          <button class="nav__item nav__item--disabled" disabled title="خارج نطاق هذا الإصدار">
            ${icon('layout-dashboard', 20)} لوحة التحكم
          </button>

          <div class="nav__group-label">إدارة الموظفين</div>
          ${Object.entries(ROUTES)
            .map(
              ([key, r]) => `
            <button class="nav__item ${key === route ? 'nav__item--active' : ''}"
                    data-route="${key}">
              ${icon(
                { employees: 'users-round', attendance: 'clock', payroll: 'wallet' }[key],
                20
              )}
              ${esc(r.label)}
            </button>`
            )
            .join('')}

          <div class="nav__group-label">وحدات أخرى</div>
          ${OUT_OF_SCOPE.map(
            ([ic, label]) => `
            <button class="nav__item nav__item--disabled" disabled title="خارج نطاق هذا الإصدار">
              ${icon(ic, 20)} ${esc(label)}
            </button>`
          ).join('')}

          <div class="nav__spacer"></div>

          <button class="nav__item nav__item--disabled" disabled>
            ${icon('circle-help', 20)} المساعدة
          </button>
          <button class="nav__item" id="logoutBtn">
            ${icon('log-out', 20)} تسجيل الخروج
          </button>
        </nav>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="icon-btn sidebar-toggle" id="menuBtn" aria-label="القائمة">
            ${icon('menu', 22)}
          </button>

          <div class="topbar__greeting">
            مرحبًا بعودتك، <strong>${esc(currentUser.name)}</strong>
          </div>

          <div class="topbar__right">
            <div class="notif-wrap" id="notifWrap">
              <button class="icon-btn" id="notifBtn" aria-label="الإشعارات" aria-expanded="false">
                ${icon('bell', 22)}
                <span class="icon-btn__dot" id="notifDot" style="display:none"></span>
              </button>
              <div class="notif-dropdown" id="notifDropdown" style="display:none">
                <div class="notif-dropdown__head">
                  <span class="notif-dropdown__title">الإشعارات</span>
                  <button class="btn btn--sm btn--ghost" id="markReadBtn">تعليم الكل كمقروء</button>
                </div>
                <div class="notif-dropdown__list" id="notifList">
                  <div style="text-align:center;padding:24px;color:var(--text-40)">لا توجد إشعارات</div>
                </div>
              </div>
            </div>

            <div class="notif-wrap" id="settingsWrap">
              <button class="icon-btn" id="settingsBtn" aria-label="الإعدادات">
                ${icon('settings', 22)}
              </button>
              <div class="notif-dropdown" id="settingsDropdown" style="display:none;width:220px">
                <div class="notif-dropdown__head">
                  <span class="notif-dropdown__title">الإعدادات</span>
                </div>
                <div style="padding:8px">
                  <button class="nav__item" id="toggleThemeBtn" style="width:100%;border-radius:8px">
                    ${icon('sun', 18)} الوضع الفاتح
                  </button>
                  <button class="nav__item" id="settingsLogoutBtn" style="width:100%;border-radius:8px;color:var(--danger)">
                    ${icon('log-out', 18)} تسجيل الخروج
                  </button>
                </div>
              </div>
            </div>

            <div class="user-chip">
              <span class="avatar">${esc(initials(currentUser.name))}</span>
              <span>
                <span class="user-chip__name" style="display:block">${esc(currentUser.name)}</span>
                <span class="user-chip__role">${esc(currentUser.roleLabel)}</span>
              </span>
            </div>
          </div>
        </header>

        <div id="pageHost"></div>
      </div>
    </div>`;

  const sidebar = root.querySelector('#sidebar');

  root.querySelectorAll('[data-route]').forEach((btn) =>
    btn.addEventListener('click', () => {
      navigate(btn.dataset.route);
      sidebar.classList.remove('sidebar--open');
      document.querySelector('.scrim')?.remove();
    })
  );

  root.querySelector('#menuBtn').addEventListener('click', () => {
    sidebar.classList.add('sidebar--open');
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', () => {
      sidebar.classList.remove('sidebar--open');
      scrim.remove();
    });
    document.body.appendChild(scrim);
  });

  root.querySelector('#logoutBtn').addEventListener('click', async () => {
    try { await api.logout(); } catch { /* ok */ }
    currentUser = null;
    toast('تم تسجيل الخروج');
    showLogin();
  });

  /* ---------- Notifications ---------- */
  const notifBtn = root.querySelector('#notifBtn');
  const notifDropdown = root.querySelector('#notifDropdown');
  const notifDot = root.querySelector('#notifDot');
  const notifList = root.querySelector('#notifList');
  const markReadBtn = root.querySelector('#markReadBtn');

  let notifOpen = false;

  async function loadNotifications() {
    try {
      const { data, unreadCount } = await api.notifications();
      notifDot.style.display = unreadCount > 0 ? '' : 'none';

      if (!data.length) {
        notifList.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-40)">لا توجد إشعارات بعد</div>';
        return;
      }

      notifList.innerHTML = data.map(n => `
        <div class="notif-item ${n.read ? '' : 'notif-item--unread'}">
          <div class="notif-item__icon" style="color:var(--${n.type === 'employee' ? 'primary' : n.type === 'attendance' ? 'secondary' : n.type === 'payroll' ? 'success' : 'text-60'})">
            ${icon(NOTIF_ICONS[n.type] || 'bell', 18)}
          </div>
          <div class="notif-item__body">
            <div class="notif-item__title">${esc(n.title)}</div>
            <div class="notif-item__text">${esc(n.body)}</div>
            <div class="notif-item__time">${relativeTime(n.createdAt)}</div>
          </div>
        </div>
      `).join('');
    } catch { /* silent */ }
  }

  function closeAllDropdowns() {
    notifOpen = false;
    settingsOpen = false;
    notifDropdown.style.display = 'none';
    settingsDropdown.style.display = 'none';
  }

  notifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = notifOpen;
    closeAllDropdowns();
    if (!wasOpen) {
      notifOpen = true;
      notifDropdown.style.display = 'flex';
      loadNotifications();
    }
  });

  markReadBtn.addEventListener('click', async () => {
    try {
      await api.markNotificationsRead();
      notifDot.style.display = 'none';
      notifList.querySelectorAll('.notif-item--unread').forEach(el =>
        el.classList.remove('notif-item--unread')
      );
      toast('تم تعليم الكل كمقروء');
    } catch { /* silent */ }
  });

  /* ---------- Settings dropdown ---------- */
  const settingsBtn = root.querySelector('#settingsBtn');
  const settingsDropdown = root.querySelector('#settingsDropdown');
  let settingsOpen = false;

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = settingsOpen;
    closeAllDropdowns();
    if (!wasOpen) {
      settingsOpen = true;
      settingsDropdown.style.display = 'flex';
    }
  });

  root.querySelector('#settingsLogoutBtn').addEventListener('click', async () => {
    try { await api.logout(); } catch { /* ok */ }
    currentUser = null;
    toast('تم تسجيل الخروج');
    showLogin();
  });

  root.querySelector('#toggleThemeBtn').addEventListener('click', () => {
    toast('الوضع الداكن قيد التطوير');
    closeAllDropdowns();
  });

  // Close any dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!root.querySelector('#notifWrap')?.contains(e.target) &&
        !root.querySelector('#settingsWrap')?.contains(e.target)) {
      closeAllDropdowns();
    }
  });

  // Check for unread count silently (don't open dropdown)
  api.notifications().then(({ unreadCount }) => {
    notifDot.style.display = unreadCount > 0 ? '' : 'none';
  }).catch(() => {});

  ROUTES[route].render(root.querySelector('#pageHost'), { user: currentUser, today });
}

/* ============================ Boot ============================ */

function showLogin() {
  renderLogin(root, (user) => {
    currentUser = user;
    if (!location.hash) location.hash = '/employees';
    renderShell();
  });
}

window.addEventListener('hashchange', () => {
  if (currentUser) renderShell();
});

window.addEventListener('auth:expired', () => {
  if (!currentUser) return;
  currentUser = null;
  toast('انتهت الجلسة. سجّل الدخول مجددًا.', 'error');
  showLogin();
});

async function boot() {
  if (!window.lucide) {
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (window.lucide) { clearInterval(check); resolve(); }
      }, 30);
      setTimeout(() => { clearInterval(check); resolve(); }, 3000);
    });
  }

  try {
    const { user } = await api.me();
    currentUser = user;
    if (!location.hash) location.hash = '/employees';
    renderShell();
  } catch {
    showLogin();
  }
}

boot();
