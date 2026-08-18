import {
  api, esc, icon, money, badge, initials, toast, openModal, confirmDialog,
  skeletonRows, emptyState, pager, debounce, downloadCsv, PERMISSION_LABELS,
} from '../ui.js';
import { donutChart } from '../charts.js';

const state = {
  q: '',
  department: '',
  page: 1,
  pageSize: 8,
  departments: [],
  rows: [],
  meta: null,
  loading: true,
};

const TYPES = ['دوام كامل', 'دوام جزئي'];
const DEPARTMENTS = [
  'الموارد البشرية', 'الهندسة', 'التسويق', 'المالية', 'المبيعات', 'التصميم',
];

export function renderEmployees(root, ctx) {
  const canWrite = ['admin', 'hr-standard'].includes(ctx.user.role);
  const canDelete = ctx.user.role === 'admin';

  root.innerHTML = `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="page__title">دليل الموظفين</h1>
          <nav class="crumbs">
            <span>لوحة التحكم</span><span class="crumbs__dot"></span>
            <span class="crumbs__current">الموظفون</span>
          </nav>
        </div>
        <div class="page__meta">
          <span>${ctx.today}</span>
        </div>
      </header>

      <div class="cards" id="empCards"></div>

      <div id="empCharts"></div>

      <div class="toolbar">
        <div class="field field--search">
          ${icon('search', 18)}
          <input id="q" type="search" placeholder="ابحث بالاسم أو المسمى أو القسم…"
                 value="${esc(state.q)}" aria-label="بحث" />
        </div>

        <div class="field field--select">
          ${icon('filter', 18)}
          <select id="dept" aria-label="تصفية بالقسم">
            <option value="">كل الأقسام</option>
            ${DEPARTMENTS.map(
              (d) => `<option value="${esc(d)}" ${state.department === d ? 'selected' : ''}>${esc(d)}</option>`
            ).join('')}
          </select>
        </div>

        <div class="toolbar__spacer"></div>

        <button class="btn" id="exportBtn">تصدير CSV ${icon('upload-cloud', 18)}</button>
        ${canWrite ? `<button class="btn btn--primary" id="addBtn">${icon('plus', 18)} موظف جديد</button>` : ''}
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>الموظف</th>
              <th>المسمى الوظيفي</th>
              <th>القسم</th>
              <th>نوع التوظيف</th>
              <th>الراتب الأساسي</th>
              <th>الصلاحية</th>
              <th style="text-align:end">إجراءات</th>
            </tr>
          </thead>
          <tbody id="empBody">${skeletonRows(7)}</tbody>
        </table>
      </div>

      <div id="empPager"></div>
    </div>`;

  const body = root.querySelector('#empBody');
  const pagerEl = root.querySelector('#empPager');
  const cardsEl = root.querySelector('#empCards');

  async function load() {
    state.loading = true;
    try {
      const res = await api.employees({
        q: state.q,
        department: state.department,
        page: state.page,
        pageSize: state.pageSize,
      });
      state.rows = res.data;
      state.meta = res.meta;
      state.departments = res.meta.departments;
      draw();
    } catch (err) {
      body.innerHTML = `<tr><td colspan="7">${emptyState({
        title: 'تعذّر تحميل البيانات',
        message: err.message,
        iconName: 'triangle-alert',
      })}</td></tr>`;
    } finally {
      state.loading = false;
    }
  }

  function drawCards() {
    const total = state.meta?.total ?? 0;
    const payrollSum = state.rows.reduce((s, r) => s + r.salary, 0);
    const deptCount = state.departments.length;
    const fullTime = state.rows.filter((r) => r.employmentType === 'دوام كامل').length;

    const card = (iconName, label, value, note) => `
      <article class="card">
        <div class="card__top">
          <div class="card__icon">${icon(iconName, 20)}</div>
          <div class="card__delta">${note || ''}</div>
        </div>
        <div>
          <div class="card__label">${esc(label)}</div>
          <div class="card__value">${value}</div>
        </div>
      </article>`;

    cardsEl.innerHTML = [
      card('users-round', 'إجمالي الموظفين', `<span class="ltr">${total}</span>`),
      card('building-2', 'عدد الأقسام', `<span class="ltr">${deptCount}</span>`),
      card('briefcase', 'دوام كامل (بالصفحة)', `<span class="ltr">${fullTime}</span>`),
      card('wallet', 'رواتب الصفحة', money(payrollSum)),
    ].join('');
  }

  function drawCharts() {
    const chartsEl = root.querySelector('#empCharts');
    if (!state.rows.length) { chartsEl.innerHTML = ''; return; }

    // Count employees by department across the full page result
    const deptCounts = {};
    state.rows.forEach(r => {
      deptCounts[r.department] = (deptCounts[r.department] || 0) + 1;
    });
    const colors = ['#534feb', '#1c6ce5', '#069855', '#d39c1d', '#d62525', '#8b5cf6'];
    const segments = Object.entries(deptCounts).map(([dept, count], i) => ({
      label: dept,
      value: count,
      color: colors[i % colors.length],
    }));

    // Employment type split
    const fullTime = state.rows.filter(r => r.employmentType === 'دوام كامل').length;
    const partTime = state.rows.filter(r => r.employmentType === 'دوام جزئي').length;

    chartsEl.innerHTML = `
      <div class="chart-section">
        <div class="chart-panel">
          <h3 class="chart-panel__title">توزيع الموظفين حسب القسم</h3>
          ${donutChart(segments, {
            centerValue: state.meta?.total ?? state.rows.length,
            centerLabel: 'إجمالي',
            size: 200,
          })}
        </div>
        <div class="chart-panel">
          <h3 class="chart-panel__title">نوع التوظيف</h3>
          ${donutChart([
            { label: 'دوام كامل', value: fullTime, color: '#534feb' },
            { label: 'دوام جزئي', value: partTime, color: '#1c6ce5' },
          ], {
            centerValue: state.rows.length,
            centerLabel: 'بالصفحة',
            size: 200,
          })}
        </div>
      </div>`;
  }

  function draw() {
    drawCards();
    drawCharts();

    if (!state.rows.length) {
      body.innerHTML = `<tr><td colspan="7">${emptyState({
        title: 'لا توجد نتائج',
        message: state.q || state.department
          ? 'جرّب تعديل البحث أو التصفية.'
          : 'ابدأ بإضافة أول موظف.',
        iconName: 'users-round',
      })}</td></tr>`;
      pagerEl.innerHTML = '';
      return;
    }

    body.innerHTML = state.rows
      .map(
        (r) => `
      <tr data-id="${esc(r.id)}">
        <td>
          <div class="cell-person">
            <span class="avatar avatar--sm">${esc(initials(r.name))}</span>
            <span class="cell-person__name">${esc(r.name)}</span>
          </div>
        </td>
        <td>${esc(r.position)}</td>
        <td>${esc(r.department)}</td>
        <td>${badge(r.employmentType)}</td>
        <td>${money(r.salary)}</td>
        <td>${badge(r.permission, PERMISSION_LABELS[r.permission] || r.permission)}</td>
        <td>
          <div class="cell-actions">
            ${canWrite ? `<button class="btn btn--sm btn--icon" data-edit="${esc(r.id)}" aria-label="تعديل ${esc(r.name)}">${icon('pencil', 16)}</button>` : ''}
            ${canDelete ? `<button class="btn btn--sm btn--icon" data-del="${esc(r.id)}" aria-label="حذف ${esc(r.name)}">${icon('trash-2', 16)}</button>` : ''}
            ${!canWrite && !canDelete ? '<span style="color:var(--text-40);font-size:14px">للاطلاع فقط</span>' : ''}
          </div>
        </td>
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

  /* ---------------- Form modal (shared by create + edit) ---------------- */

  function openForm(employee) {
    const isEdit = Boolean(employee);
    openModal({
      title: isEdit ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد',
      render: () => `
        <form id="empForm">
          <div class="modal__body">
            <div class="form-row">
              <label class="label" for="f-name">الاسم الكامل</label>
              <input class="input" id="f-name" name="name" required
                     value="${esc(employee?.name || '')}" placeholder="مثال: نورة الشمري" />
            </div>

            <div class="form-row form-row--split">
              <div class="form-row">
                <label class="label" for="f-position">المسمى الوظيفي</label>
                <input class="input" id="f-position" name="position" required
                       value="${esc(employee?.position || '')}" placeholder="مثال: محلل مالي" />
              </div>
              <div class="form-row">
                <label class="label" for="f-department">القسم</label>
                <select class="input" id="f-department" name="department" required>
                  ${DEPARTMENTS.map(
                    (d) => `<option ${employee?.department === d ? 'selected' : ''}>${esc(d)}</option>`
                  ).join('')}
                </select>
              </div>
            </div>

            <div class="form-row">
              <label class="label" for="f-email">البريد الإلكتروني</label>
              <input class="input" id="f-email" name="email" type="email" dir="ltr" required
                     value="${esc(employee?.email || '')}" placeholder="name@hr360.sa" />
            </div>

            <div class="form-row form-row--split">
              <div class="form-row">
                <label class="label" for="f-salary">الراتب الأساسي (ر.س)</label>
                <input class="input" id="f-salary" name="salary" type="number" dir="ltr"
                       min="1" step="100" required value="${esc(employee?.salary || '')}" />
              </div>
              <div class="form-row">
                <label class="label" for="f-type">نوع التوظيف</label>
                <select class="input" id="f-type" name="employmentType">
                  ${TYPES.map(
                    (t) => `<option ${employee?.employmentType === t ? 'selected' : ''}>${esc(t)}</option>`
                  ).join('')}
                </select>
              </div>
            </div>

            <div class="form-row">
              <label class="label" for="f-permission">الصلاحية</label>
              <select class="input" id="f-permission" name="permission">
                ${Object.entries(PERMISSION_LABELS)
                  .map(
                    ([v, l]) =>
                      `<option value="${v}" ${employee?.permission === v ? 'selected' : ''}>${esc(l)}</option>`
                  )
                  .join('')}
              </select>
            </div>

            <div class="form-error" id="formError" hidden></div>
          </div>

          <div class="modal__foot">
            <button type="button" class="btn" data-close>إلغاء</button>
            <button type="submit" class="btn btn--primary" id="saveBtn">
              ${isEdit ? 'حفظ التعديلات' : 'إضافة الموظف'}
            </button>
          </div>
        </form>`,
      onMount: ({ root: modalRoot, close }) => {
        const form = modalRoot.querySelector('#empForm');
        const errorBox = modalRoot.querySelector('#formError');
        const saveBtn = modalRoot.querySelector('#saveBtn');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorBox.hidden = true;

          const payload = Object.fromEntries(new FormData(form));
          payload.salary = Number(payload.salary);

          saveBtn.disabled = true;
          saveBtn.textContent = 'جارٍ الحفظ…';

          try {
            if (isEdit) {
              await api.updateEmployee(employee.id, payload);
              toast('تم حفظ التعديلات', 'success');
            } else {
              await api.createEmployee(payload);
              toast('تمت إضافة الموظف', 'success');
              state.page = 1;
            }
            close();
            load();
          } catch (err) {
            errorBox.textContent = err.message;
            errorBox.hidden = false;
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? 'حفظ التعديلات' : 'إضافة الموظف';
          }
        });
      },
    });
  }

  /* ---------------- Events ---------------- */

  const onSearch = debounce((v) => {
    state.q = v;
    state.page = 1;
    load();
  });

  root.querySelector('#q').addEventListener('input', (e) => onSearch(e.target.value));

  root.querySelector('#dept').addEventListener('change', (e) => {
    state.department = e.target.value;
    state.page = 1;
    load();
  });

  root.querySelector('#addBtn')?.addEventListener('click', () => openForm(null));

  root.querySelector('#exportBtn').addEventListener('click', async () => {
    // Export the whole filtered set, not just the visible page.
    const all = await api.employees({
      q: state.q, department: state.department, pageSize: 50, page: 1,
    });
    downloadCsv(
      'employees.csv',
      ['الاسم', 'المسمى', 'القسم', 'نوع التوظيف', 'الراتب', 'البريد', 'الصلاحية'],
      all.data.map((r) => [
        r.name, r.position, r.department, r.employmentType,
        r.salary, r.email, PERMISSION_LABELS[r.permission] || r.permission,
      ])
    );
    toast('تم تصدير الملف', 'success');
  });

  body.addEventListener('click', async (e) => {
    const editId = e.target.closest('[data-edit]')?.dataset.edit;
    const delId = e.target.closest('[data-del]')?.dataset.del;

    if (editId) {
      openForm(state.rows.find((r) => r.id === editId));
      return;
    }

    if (delId) {
      const emp = state.rows.find((r) => r.id === delId);
      const ok = await confirmDialog({
        title: 'حذف الموظف',
        message: `سيُحذف ${emp.name} نهائيًا، مع كل سجلات الحضور والرواتب المرتبطة به. لا يمكن التراجع عن هذا الإجراء.`,
        confirmLabel: 'حذف نهائي',
      });
      if (!ok) return;

      try {
        const res = await api.deleteEmployee(delId);
        const { attendance, payroll } = res.cascaded;
        toast(
          `تم حذف ${emp.name} (${attendance} سجل حضور، ${payroll} سجل راتب)`,
          'success'
        );
        // Stepping back a page avoids landing on an empty final page.
        if (state.rows.length === 1 && state.page > 1) state.page -= 1;
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
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
