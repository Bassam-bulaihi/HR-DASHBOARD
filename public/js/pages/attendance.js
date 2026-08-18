import {
  api, esc, icon, badge, initials, toast, openModal, shortDate, time,
  skeletonRows, emptyState, pager, debounce, downloadCsv,
} from '../ui.js';
import { donutChart, dailyTrendChart } from '../charts.js';

const state = {
  q: '',
  date: '',
  department: '',
  status: '',
  page: 1,
  pageSize: 8,
  rows: [],
  meta: null,
  summary: null,
  dailyStats: [],
};

const STATUSES = ['حاضر', 'غائب', 'متأخر', 'في إجازة'];

export function renderAttendance(root, ctx) {
  const canWrite = ['admin', 'hr-standard'].includes(ctx.user.role);

  root.innerHTML = `
    <div class="page">
      <header class="page__head">
        <div>
          <h1 class="page__title">حضور الموظفين</h1>
          <nav class="crumbs">
            <span>لوحة التحكم</span><span class="crumbs__dot"></span>
            <span>الموظفون</span><span class="crumbs__dot"></span>
            <span class="crumbs__current">الحضور</span>
          </nav>
        </div>
        <div class="page__meta"><span>${ctx.today}</span></div>
      </header>

      <div class="cards" id="attCards"></div>

      <div id="attCharts"></div>

      <div class="toolbar">
        <div class="field field--search">
          ${icon('search', 18)}
          <input id="q" type="search" placeholder="ابحث بالاسم أو المسمى…" aria-label="بحث" />
        </div>

        <div class="field field--select">
          ${icon('filter', 18)}
          <select id="status" aria-label="تصفية بالحالة">
            <option value="">كل الحالات</option>
            ${STATUSES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
          </select>
        </div>

        <div class="field field--select">
          <select id="dept" aria-label="تصفية بالقسم">
            <option value="">كل الأقسام</option>
          </select>
        </div>

        <div class="field field--select">
          ${icon('calendar', 18)}
          <select id="date" aria-label="تصفية بالتاريخ">
            <option value="">كل التواريخ</option>
          </select>
        </div>

        <div class="toolbar__spacer"></div>

        <button class="btn" id="exportBtn">تصدير CSV ${icon('upload-cloud', 18)}</button>
        ${canWrite ? `<button class="btn btn--primary" id="recordBtn">${icon('clock', 18)} تسجيل حضور</button>` : ''}
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>الموظف</th>
              <th>المسمى الوظيفي</th>
              <th>القسم</th>
              <th>الحالة</th>
              <th>الحضور</th>
              <th>الانصراف</th>
              <th>ساعات إضافية</th>
            </tr>
          </thead>
          <tbody id="attBody">${skeletonRows(8)}</tbody>
        </table>
      </div>

      <div id="attPager"></div>
    </div>`;

  const body = root.querySelector('#attBody');
  const pagerEl = root.querySelector('#attPager');
  const cardsEl = root.querySelector('#attCards');
  const deptSel = root.querySelector('#dept');
  const dateSel = root.querySelector('#date');

  let filtersReady = false;

  async function load() {
    try {
      const res = await api.attendance({
        q: state.q,
        date: state.date,
        department: state.department,
        status: state.status,
        page: state.page,
        pageSize: state.pageSize,
      });
      state.rows = res.data;
      state.meta = res.meta;
      state.summary = res.summary;
      state.dailyStats = res.dailyStats || [];

      // Populate the filter dropdowns once, from the server's full option list.
      if (!filtersReady) {
        deptSel.innerHTML =
          '<option value="">كل الأقسام</option>' +
          res.meta.departments.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
        dateSel.innerHTML =
          '<option value="">كل التواريخ</option>' +
          res.meta.dates
            .map((d) => `<option value="${esc(d)}"><span>${esc(d)}</span></option>`)
            .join('');
        filtersReady = true;
      }
      draw();
    } catch (err) {
      body.innerHTML = `<tr><td colspan="8">${emptyState({
        title: 'تعذّر تحميل السجلات',
        message: err.message,
        iconName: 'triangle-alert',
      })}</td></tr>`;
    }
  }

  function drawCards() {
    const s = state.summary || {};
    const card = (iconName, label, value, tone) => `
      <article class="card">
        <div class="card__top">
          <div class="card__icon" ${tone ? `style="color:${tone}"` : ''}>${icon(iconName, 20)}</div>
        </div>
        <div>
          <div class="card__label">${esc(label)}</div>
          <div class="card__value"><span class="ltr">${value ?? 0}</span></div>
        </div>
      </article>`;

    cardsEl.innerHTML = [
      card('list-checks', 'إجمالي السجلات', s.total),
      card('circle-check', 'حاضر', s.present, 'var(--success)'),
      card('circle-x', 'غائب', s.absent, 'var(--danger)'),
      card('alarm-clock', 'متأخر', s.late, 'var(--warning)'),
      card('palmtree', 'في إجازة', s.onLeave, 'var(--secondary)'),
    ].join('');
  }

  function drawCharts() {
    const chartsEl = root.querySelector('#attCharts');
    const s = state.summary || {};

    if (!s.total) {
      chartsEl.innerHTML = '';
      return;
    }

    // Donut shows the LATEST day only (or filtered day if one is selected)
    const daily = state.dailyStats || [];
    const today = daily.length ? daily[daily.length - 1] : null;
    const todayLabel = today ? today.date : '';

    chartsEl.innerHTML = `
      <div class="chart-section">
        <div class="chart-panel">
          <h3 class="chart-panel__title">حالات اليوم ${todayLabel ? `<span class="ltr" style="font-weight:300;font-size:14px;color:var(--text-60)">(${todayLabel})</span>` : ''}</h3>
          ${today
            ? donutChart(
                [
                  { label: 'حاضر', value: today.present || 0, color: '#069855' },
                  { label: 'متأخر', value: today.late || 0, color: '#d39c1d' },
                  { label: 'غائب', value: today.absent || 0, color: '#d62525' },
                  { label: 'في إجازة', value: today.onLeave || 0, color: '#1c6ce5' },
                ],
                { centerValue: today.total, centerLabel: 'موظف' }
              )
            : '<div style="text-align:center;color:var(--text-40);padding:32px">لا توجد بيانات لليوم</div>'
          }
        </div>

        <div class="chart-panel">
          <h3 class="chart-panel__title">الحضور اليومي</h3>
          ${daily.length
            ? dailyTrendChart(daily)
            : '<div style="text-align:center;color:var(--text-40);padding:32px">اختر فترة لعرض الاتجاه اليومي</div>'
          }
          <div style="display:flex;gap:16px;justify-content:center;margin-top:12px;font-size:12px;color:var(--text-60)">
            <span>● <span style="color:var(--success)">حاضر</span></span>
            <span>● <span style="color:var(--warning)">متأخر</span></span>
            <span>● <span style="color:var(--danger)">غائب</span></span>
            <span>● <span style="color:var(--secondary)">إجازة</span></span>
          </div>
        </div>
      </div>`;
  }

  function draw() {
    drawCards();
    drawCharts();

    if (!state.rows.length) {
      body.innerHTML = `<tr><td colspan="8">${emptyState({
        title: 'لا توجد سجلات',
        message: 'لا توجد سجلات حضور مطابقة للتصفية الحالية.',
        iconName: 'calendar-x',
      })}</td></tr>`;
      pagerEl.innerHTML = '';
      return;
    }

    body.innerHTML = state.rows
      .map(
        (r) => `
      <tr>
        <td>${shortDate(r.date)}</td>
        <td>
          <div class="cell-person">
            <span class="avatar avatar--sm">${esc(initials(r.employeeName))}</span>
            <span class="cell-person__name">${esc(r.employeeName)}</span>
          </div>
        </td>
        <td>${esc(r.position)}</td>
        <td>${esc(r.department)}</td>
        <td>${badge(r.status)}</td>
        <td>${time(r.checkIn)}</td>
        <td>${time(r.checkOut)}</td>
        <td>${
          r.overtimeHours
            ? `<span class="delta-up">+<span class="ltr">${r.overtimeHours}</span> س</span>`
            : '<span style="color:var(--text-40)">—</span>'
        }</td>
      </tr>`
      )
      .join('');

    pagerEl.innerHTML = pager({
      page: state.meta.page,
      pages: state.meta.pages,
      total: state.meta.total,
      pageSize: state.meta.pageSize,
      noun: 'سجل',
    });
  }

  /* ---------------- Record modal ---------------- */

  async function openRecordModal() {
    const { data: employees } = await api.employees({ pageSize: 50 });

    openModal({
      title: 'تسجيل حضور',
      render: () => `
        <form id="attForm">
          <div class="modal__body">
            <div class="form-row">
              <label class="label" for="a-emp">الموظف</label>
              <select class="input" id="a-emp" name="employeeId" required>
                ${employees
                  .map((e) => `<option value="${esc(e.id)}">${esc(e.name)} — ${esc(e.department)}</option>`)
                  .join('')}
              </select>
            </div>

            <div class="form-row form-row--split">
              <div class="form-row">
                <label class="label" for="a-date">التاريخ</label>
                <input class="input" id="a-date" name="date" type="date" dir="ltr"
                       required value="2024-01-13" />
              </div>
              <div class="form-row">
                <label class="label" for="a-status">الحالة</label>
                <select class="input" id="a-status" name="status" required>
                  ${STATUSES.map((s) => `<option>${esc(s)}</option>`).join('')}
                </select>
              </div>
            </div>

            <div id="timeFields">
              <div class="form-row form-row--split">
                <div class="form-row">
                  <label class="label" for="a-in">وقت الحضور</label>
                  <input class="input" id="a-in" name="checkIn" type="time" dir="ltr" value="09:00" />
                </div>
                <div class="form-row">
                  <label class="label" for="a-out">وقت الانصراف</label>
                  <input class="input" id="a-out" name="checkOut" type="time" dir="ltr" value="17:00" />
                </div>
              </div>

              <div class="form-row" style="margin-block-start:18px">
                <label class="label" for="a-ot">ساعات إضافية</label>
                <input class="input" id="a-ot" name="overtimeHours" type="number"
                       dir="ltr" min="0" max="12" step="1" value="0" />
              </div>
            </div>

            <p style="font-size:13px;color:var(--text-60);margin:0;line-height:1.7">
              تسجيل نفس الموظف في نفس التاريخ يُحدّث السجل الحالي بدل إنشاء سجل مكرر.
            </p>

            <div class="form-error" id="attError" hidden></div>
          </div>

          <div class="modal__foot">
            <button type="button" class="btn" data-close>إلغاء</button>
            <button type="submit" class="btn btn--primary" id="attSave">حفظ السجل</button>
          </div>
        </form>`,
      onMount: ({ root: m, close }) => {
        const form = m.querySelector('#attForm');
        const statusSel = m.querySelector('#a-status');
        const timeFields = m.querySelector('#timeFields');
        const errorBox = m.querySelector('#attError');
        const saveBtn = m.querySelector('#attSave');

        // Check-in/out are meaningless for absence and leave — hide them.
        const syncTimeFields = () => {
          const needsTimes = ['حاضر', 'متأخر'].includes(statusSel.value);
          timeFields.style.display = needsTimes ? '' : 'none';
        };
        statusSel.addEventListener('change', syncTimeFields);
        syncTimeFields();

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorBox.hidden = true;
          const payload = Object.fromEntries(new FormData(form));
          saveBtn.disabled = true;
          saveBtn.textContent = 'جارٍ الحفظ…';

          try {
            const res = await api.recordAttendance(payload);
            toast(res.mode === 'updated' ? 'تم تحديث السجل' : 'تم تسجيل الحضور', 'success');
            close();
            filtersReady = false; // a new date may have appeared
            load();
          } catch (err) {
            errorBox.textContent = err.message;
            errorBox.hidden = false;
            saveBtn.disabled = false;
            saveBtn.textContent = 'حفظ السجل';
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

  for (const [id, key] of [['status', 'status'], ['dept', 'department'], ['date', 'date']]) {
    root.querySelector(`#${id}`).addEventListener('change', (e) => {
      state[key] = e.target.value;
      state.page = 1;
      load();
    });
  }

  root.querySelector('#recordBtn')?.addEventListener('click', openRecordModal);

  root.querySelector('#exportBtn').addEventListener('click', async () => {
    const all = await api.attendance({
      q: state.q, date: state.date, department: state.department,
      status: state.status, pageSize: 50, page: 1,
    });
    downloadCsv(
      'attendance.csv',
      ['التاريخ', 'الموظف', 'المسمى', 'القسم', 'الحالة', 'الحضور', 'الانصراف', 'ساعات إضافية'],
      all.data.map((r) => [
        r.date, r.employeeName, r.position, r.department,
        r.status, r.checkIn || '', r.checkOut || '', r.overtimeHours || 0,
      ])
    );
    toast('تم تصدير الملف', 'success');
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
