/* ui.js — API client, formatters, and shared UI primitives. */

/* ============================ API ============================ */

async function request(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  // 401 anywhere means the session lapsed — bounce to login rather than
  // rendering a half-broken page.
  if (res.status === 401 && !url.includes('/auth/')) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error('انتهت الجلسة. يرجى تسجيل الدخول مجددًا.');
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* empty body is fine for some responses */
  }

  if (!res.ok) {
    throw new Error(body?.error || `فشل الطلب (${res.status})`);
  }
  return body;
}

const qs = (params) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== '' && v != null)
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (email, password) =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),

  employees: (params = {}) => request(`/api/employees${qs(params)}`),
  createEmployee: (data) =>
    request('/api/employees', { method: 'POST', body: JSON.stringify(data) }),
  updateEmployee: (id, data) =>
    request(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmployee: (id) => request(`/api/employees/${id}`, { method: 'DELETE' }),

  attendance: (params = {}) => request(`/api/attendance${qs(params)}`),
  recordAttendance: (data) =>
    request('/api/attendance', { method: 'POST', body: JSON.stringify(data) }),

  payroll: (params = {}) => request(`/api/payroll${qs(params)}`),
  recalculatePayroll: () =>
    request('/api/payroll/recalculate', { method: 'POST', body: '{}' }),
  setPayrollStatus: (id, status) =>
    request(`/api/payroll/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),
  payAll: () => request('/api/payroll/pay-all', { method: 'POST', body: '{}' }),

  notifications: () => request('/api/notifications'),
  markNotificationsRead: () =>
    request('/api/notifications/read', { method: 'POST', body: '{}' }),
};

/* ========================= Formatting ========================= */

/** Escapes user-supplied text before it goes into innerHTML. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const nf = new Intl.NumberFormat('en-US');

/** Currency. Wrapped in .ltr so the figure doesn't reverse inside Arabic text. */
export function money(amount) {
  return `<span class="ltr num">${nf.format(Math.round(amount || 0))}</span> ر.س`;
}

export const number = (n) => `<span class="ltr num">${nf.format(n || 0)}</span>`;

/** Renders a date as DD/MM, isolated LTR. */
export function shortDate(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `<span class="ltr">${d}/${m}</span>`;
}

export function longDate(iso) {
  if (!iso) return '—';
  const months = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
  ];
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${months[Number(m) - 1]}، ${y}`;
}

export const time = (t) => (t ? `<span class="ltr">${esc(t)}</span>` : '—');

export const initials = (name) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');

/* =========================== Badges =========================== */

const STATUS_TONE = {
  حاضر: 'success',
  غائب: 'danger',
  متأخر: 'warning',
  'في إجازة': 'info',
  مدفوع: 'success',
  معلق: 'warning',
  'دوام كامل': 'primary',
  'دوام جزئي': 'info',
  admin: 'primary',
  'hr-standard': 'info',
  'view-only': 'muted',
};

export const PERMISSION_LABELS = {
  admin: 'مدير النظام',
  'hr-standard': 'موارد بشرية',
  'view-only': 'اطلاع فقط',
};

export function badge(value, label) {
  const tone = STATUS_TONE[value] || 'muted';
  return `<span class="badge badge--${tone}">${esc(label ?? value)}</span>`;
}

/* ============================ Icons ============================ */

/** Renders a Lucide glyph as an inline SVG string. */
export function icon(name, size = 20) {
  const node = window.lucide?.icons?.[toPascal(name)];
  if (!node) return '';
  return window.lucide.createElement(node).outerHTML.replace(
    '<svg',
    `<svg width="${size}" height="${size}"`
  );
}

function toPascal(kebab) {
  return kebab
    .split('-')
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');
}

/* ============================ Toast ============================ */

export function toast(message, tone = '') {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast${tone ? ` toast--${tone}` : ''}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

/* ============================ Modal ============================ */

/**
 * Opens a modal. `render` returns the inner HTML; `onMount` wires it up and
 * receives ({ close, root }). Escape and backdrop clicks both dismiss.
 */
export function openModal({ title, render, onMount, width }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"
         ${width ? `style="width:min(${width},100%)"` : ''}>
      <div class="modal__head">
        <h2 class="modal__title">${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="إغلاق">${icon('x', 20)}</button>
      </div>
      ${render()}
    </div>`;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);

  // Focus the first field so keyboard users land somewhere useful.
  backdrop.querySelector('input, select, textarea, button:not([data-close])')?.focus();

  onMount?.({ close, root: backdrop });
  return { close };
}

export function confirmDialog({ title, message, confirmLabel = 'تأكيد', tone = 'danger' }) {
  return new Promise((resolve) => {
    const { close } = openModal({
      title,
      width: '440px',
      render: () => `
        <div class="modal__body"><p style="margin:0;line-height:1.7">${esc(message)}</p></div>
        <div class="modal__foot">
          <button class="btn" data-close>إلغاء</button>
          <button class="btn btn--${tone}" data-confirm>${esc(confirmLabel)}</button>
        </div>`,
      onMount: ({ root, close: c }) => {
        root.querySelector('[data-confirm]').addEventListener('click', () => {
          resolve(true);
          c();
        });
        root.addEventListener('click', (e) => {
          if (e.target === root || e.target.closest('[data-close]')) resolve(false);
        });
      },
    });
    void close;
  });
}

/* ========================= Table helpers ========================= */

export function skeletonRows(cols, rows = 5) {
  return Array.from({ length: rows })
    .map(
      () =>
        `<tr>${Array.from({ length: cols })
          .map(() => '<td><div class="skeleton skeleton-row"></div></td>')
          .join('')}</tr>`
    )
    .join('');
}

export function emptyState({ title, message, actionLabel, actionId, iconName = 'inbox' }) {
  return `
    <div class="empty">
      ${icon(iconName, 44)}
      <h3>${esc(title)}</h3>
      <p>${esc(message)}</p>
      ${actionLabel ? `<button class="btn btn--primary" id="${actionId}">${esc(actionLabel)}</button>` : ''}
    </div>`;
}

/** Builds a compact page list: 1 … 4 5 6 … 20 */
export function pager({ page, pages, total, pageSize, noun = 'سجل' }) {
  if (total === 0) return '';
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const window_ = new Set([1, pages, page, page - 1, page + 1]);
  const visible = [...window_].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);

  let buttons = '';
  let prev = 0;
  for (const p of visible) {
    if (p - prev > 1) buttons += `<span class="pager__btn" aria-hidden="true">…</span>`;
    buttons += `<button class="pager__btn ${p === page ? 'pager__btn--active' : ''}"
        data-page="${p}" ${p === page ? 'aria-current="page"' : ''}>
        <span class="ltr">${p}</span></button>`;
    prev = p;
  }

  return `
    <div class="pager">
      <div class="pager__info">
        عرض <b><span class="ltr">${from}–${to}</span></b> من <b><span class="ltr">${total}</span></b> ${esc(noun)}
      </div>
      <div class="pager__pages">
        <button class="pager__btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}
          aria-label="السابق">${icon('chevron-right', 18)}</button>
        ${buttons}
        <button class="pager__btn" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}
          aria-label="التالي">${icon('chevron-left', 18)}</button>
      </div>
    </div>`;
}

/** Debounce for search inputs so we don't fire a request per keystroke. */
export function debounce(fn, ms = 280) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Client-side CSV export with a UTF-8 BOM so Excel reads Arabic correctly. */
export function downloadCsv(filename, headers, rows) {
  const escapeCell = (c) => `"${String(c ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
