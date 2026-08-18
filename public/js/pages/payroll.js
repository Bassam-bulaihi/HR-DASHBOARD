import {
  api, esc, icon, money, badge, initials, toast, confirmDialog,
  skeletonRows, emptyState, pager, debounce, downloadCsv,
} from '../ui.js';
import { barChart, donutChart } from '../charts.js';

const state = {
  q: '',
  department: '',
  status: '',
  page: 1,
  pageSize: 8,
  rows: [],
  meta: null,
  analytics: null,
};

export function renderPayroll(root, ctx) {
  const canWrite = ['admin', 'hr-standard'].includes(ctx.user.role);
  const isAdmin = ctx.user.role === 'admin';

  root.innerHTML = `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="page__title">الرواتب</h1>
          <nav class="crumbs">
            <span>لوحة التحكم</span><span class="crumbs__dot"></span>
            <span>الرواتب</span><span class="crumbs__dot"></span>
            <span class="crumbs__current">بيانات الرواتب</span>
          </nav>
        </div>
        <div class="page__meta"><span>${ctx.today}</span></div>
      </header>

      <div class="cards" id="payCards"></div>

      <section class="analytics" id="deptAnalytics"></section>

      <div class="toolbar">
        <div class="field field--search">
          ${icon('search', 18)}
          <input id="q" type="search" placeholder="ابحث بالاسم أو المسمى…" aria-label="بحث" />
        </div>

        <div class="field field--select">
          ${icon('filter', 18)}
          <select id="status" aria-label="تصفية بحالة الصرف">
            <option value="">كل الحالات</option>
            <option value="مدفوع">مدفوع</option>
            <option value="معلق">معلق</option>
          </select>
        </div>

        <div class="field field--select">
          <select id="dept" aria-label="تصفية بالقسم">
            <option value="">كل الأقسام</option>
          </select>
        </div>

        <div class="toolbar__spacer"></div>

        <button class="btn" id="exportBtn">تصدير CSV ${icon('upload-cloud', 18)}</button>
        ${canWrite ? `<button class="btn" id="recalcBtn">${icon('refresh-cw', 18)} إعادة الاحتساب</button>` : ''}
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>الموظف</th>
              <th>المسمى الوظيفي</th>
              <th>الساعات</th>
              <th>الراتب الأساسي</th>
              <th>الاستقطاعات</th>
              <th>الإضافي</th>
              <th>صافي الراتب</th>
              <th>الحالة</th>
              ${canWrite ? '<th style="text-align:end">إجراء</th>' : ''}
            </tr>
          </thead>
          <tbody id="payBody">${skeletonRows(canWrite ? 9 : 8)}</tbody>
        </table>
      </div>

      <div id="payPager"></div>
    </div>`;

  const body = root.querySelector('#payBody');
  const pagerEl = root.querySelector('#payPager');
  const cardsEl = root.querySelector('#payCards');
  const analyticsEl = root.querySelector('#deptAnalytics');
  const deptSel = root.querySelector('#dept');
  const colspan = canWrite ? 9 : 8;

  let filtersReady = false;

  async function load() {
    try {
      const res = await api.payroll({
        q: state.q,
        department: state.department,
        status: state.status,
        page: state.page,
        pageSize: state.pageSize,
      });
      state.rows = res.data;
      state.meta = res.meta;
      state.analytics = res.analytics;

      if (!filtersReady) {
        deptSel.innerHTML =
          '<option value="">كل الأقسام</option>' +
          res.meta.departments.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
        filtersReady = true;
      }
      draw();
    } catch (err) {
      body.innerHTML = `<tr><td colspan="${colspan}">${emptyState({
        title: 'تعذّر تحميل الرواتب',
        message: err.message,
        iconName: 'triangle-alert',
      })}</td></tr>`;
    }
  }

  function drawCards() {
    const a = state.analytics || {};

    cardsEl.innerHTML = `
      <article class="card card--wide">
        <div class="card__top">
          <div class="card__icon">${icon('wallet', 20)}</div>
          <div class="card__delta">
            عدد الموظفين: <b class="delta-up"><span class="ltr">${a.employeeCount ?? 0}</span></b>
          </div>
        </div>
        <div class="card__row">
          <div class="card__figures">
            <div class="card__label">إجمالي الرواتب</div>
            <div class="card__value">${money(a.totalPayroll)}</div>
          </div>
          ${
            isAdmin && a.pendingCount
              ? `<button class="btn btn--primary" id="payAllBtn">صرف الرواتب المعلقة</button>`
              : ''
          }
        </div>
      </article>

      <article class="card">
        <div class="card__top">
          <div class="card__icon" style="color:var(--warning)">${icon('hourglass', 20)}</div>
          <div class="card__delta">
            عدد الموظفين: <b style="color:var(--warning)"><span class="ltr">${a.pendingCount ?? 0}</span></b>
          </div>
        </div>
        <div>
          <div class="card__label">رواتب معلقة</div>
          <div class="card__value">${money(a.pendingTotal)}</div>
        </div>
      </article>

      <article class="card">
        <div class="card__top">
          <div class="card__icon" style="color:var(--success)">${icon('circle-check-big', 20)}</div>
          <div class="card__delta">
            عدد الموظفين: <b class="delta-up"><span class="ltr">${a.paidCount ?? 0}</span></b>
          </div>
        </div>
        <div>
          <div class="card__label">رواتب مدفوعة</div>
          <div class="card__value">${money(a.paidTotal)}</div>
        </div>
      </article>`;

    cardsEl.querySelector('#payAllBtn')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'صرف الرواتب المعلقة',
        message: `سيتم تحديث ${state.analytics.pendingCount} سجل راتب إلى "مدفوع". تأكد من مراجعة المبالغ قبل المتابعة.`,
        confirmLabel: 'صرف الآن',
        tone: 'primary',
      });
      if (!ok) return;
      try {
        const res = await api.payAll();
        toast(`تم صرف ${res.settled} راتب`, 'success');
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function drawAnalytics() {
    const a = state.analytics || {};
    const depts = a.byDepartment || [];
    if (!depts.length) {
      analyticsEl.innerHTML = '';
      return;
    }

    const colors = ['#534feb', '#1c6ce5', '#069855', '#d39c1d', '#d62525', '#8b5cf6'];

    analyticsEl.innerHTML = `
      <div class="chart-section">
        <div class="chart-panel">
          <h3 class="chart-panel__title">مقارنة الأقسام</h3>
          ${barChart(
            depts.map((d, i) => ({
              label: d.department,
              value: d.total,
              color: colors[i % colors.length],
            })),
            { unit: 'ر.س', height: 220 }
          )}
        </div>

        <div class="chart-panel">
          <h3 class="chart-panel__title">تكوين الرواتب</h3>
          ${donutChart(
            [
              { label: 'الرواتب الأساسية', value: a.totalPayroll - (a.totalOvertime || 0) + (a.totalDeductions || 0), color: '#534feb' },
              { label: 'الإضافي', value: a.totalOvertime || 0, color: '#069855' },
              { label: 'الاستقطاعات', value: a.totalDeductions || 0, color: '#d62525' },
            ],
            { centerValue: depts.length, centerLabel: 'قسم' }
          )}
        </div>
      </div>`;
  }

  function draw() {
    drawCards();
    drawAnalytics();

    if (!state.rows.length) {
      body.innerHTML = `<tr><td colspan="${colspan}">${emptyState({
        title: 'لا توجد سجلات رواتب',
        message: 'جرّب تعديل التصفية، أو أعد احتساب الرواتب من بيانات الحضور.',
        iconName: 'wallet',
      })}</td></tr>`;
      pagerEl.innerHTML = '';
      return;
    }

    body.innerHTML = state.rows
      .map(
        (r) => `
      <tr>
        <td>
          <div class="cell-person">
            <span class="avatar avatar--sm">${esc(initials(r.employeeName))}</span>
            <span class="cell-person__name">${esc(r.employeeName)}</span>
          </div>
        </td>
        <td>${esc(r.position)}</td>
        <td><span class="ltr num">${r.hoursWorked ?? 0}</span></td>
        <td>${money(r.basicSalary)}</td>
        <td>${
          r.deductions
            ? `<span class="delta-down">−${money(r.deductions)}</span>`
            : '<span style="color:var(--text-40)">—</span>'
        }</td>
        <td>${
          r.overtimePay
            ? `<span class="delta-up">+${money(r.overtimePay)}</span>`
            : '<span style="color:var(--text-40)">—</span>'
        }</td>
        <td><b style="font-weight:400">${money(r.netSalary)}</b></td>
        <td>${badge(r.status)}</td>
        ${
          canWrite
            ? `<td><div class="cell-actions">
                 <button class="btn btn--sm" data-toggle="${esc(r.id)}"
                         data-status="${esc(r.status)}">
                   ${r.status === 'معلق' ? 'تعليم كمدفوع' : 'إرجاع لمعلق'}
                 </button>
               </div></td>`
            : ''
        }
      </tr>`
      )
      .join('');

    pagerEl.innerHTML = pager({
      page: state.meta.page,
      pages: state.meta.pages,
      total: state.meta.total,
      pageSize: state.meta.pageSize,
      noun: 'موظف',
    });
  }

  /* ---------------- Events ---------------- */

  const onSearch = debounce((v) => {
    state.q = v;
    state.page = 1;
    load();
  });

  root.querySelector('#q').addEventListener('input', (e) => onSearch(e.target.value));

  for (const [id, key] of [['status', 'status'], ['dept', 'department']]) {
    root.querySelector(`#${id}`).addEventListener('change', (e) => {
      state[key] = e.target.value;
      state.page = 1;
      load();
    });
  }

  root.querySelector('#recalcBtn')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'إعادة احتساب الرواتب',
      message:
        'سيُعاد بناء كل سجلات الرواتب من بيانات الموظفين والحضور الحالية. تُحفظ حالة الصرف (مدفوع/معلق) كما هي.',
      confirmLabel: 'إعادة الاحتساب',
      tone: 'primary',
    });
    if (!ok) return;
    try {
      const res = await api.recalculatePayroll();
      toast(`تمت إعادة احتساب ${res.count} سجل`, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.querySelector('#exportBtn').addEventListener('click', async () => {
    const all = await api.payroll({
      q: state.q, department: state.department, status: state.status,
      pageSize: 50, page: 1,
    });
    downloadCsv(
      'payroll.csv',
      ['الموظف', 'المسمى', 'القسم', 'الساعات', 'الأساسي', 'الاستقطاعات', 'الإضافي', 'الصافي', 'الحالة'],
      all.data.map((r) => [
        r.employeeName, r.position, r.department, r.hoursWorked,
        r.basicSalary, r.deductions, r.overtimePay, r.netSalary, r.status,
      ])
    );
    toast('تم تصدير الملف', 'success');
  });

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-toggle]');
    if (!btn) return;
    const next = btn.dataset.status === 'معلق' ? 'مدفوع' : 'معلق';
    try {
      await api.setPayrollStatus(btn.dataset.toggle, next);
      toast(`تم التحديث إلى: ${next}`, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  pagerEl.addEventListener('click', (e) => {
    const p = e.target.closest('[data-page]')?.dataset.page;
    if (!p) return;
    state.page = Number(p);
    load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  load();
}
