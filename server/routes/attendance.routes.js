import { Router } from 'express';
import { list, findById, findOne, insert, update } from '../store.js';
import { requireAuth, requireRole, canWrite } from '../auth.js';
import { pushNotification } from './notifications.routes.js';

const router = Router();

const VALID_STATUSES = ['حاضر', 'غائب', 'متأخر', 'في إجازة'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Riyadh time (UTC+3) as YYYY-MM-DD — the business day the app runs on. */
function todayISO() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Joins attendance rows onto their employee record for display. */
async function decorate(rows) {
  const employees = await list('employees');
  const byId = new Map(employees.map((e) => [e.id, e]));
  return rows.map((r) => {
    const emp = byId.get(r.employeeId);
    return {
      ...r,
      employeeName: emp?.name || 'موظف محذوف',
      position: emp?.position || '—',
      department: r.department || emp?.department || '—',
      employmentType: emp?.employmentType || '—',
    };
  });
}

/**
 * GET /api/attendance
 * Filters: ?date= ?from= ?to= ?department= ?status= ?employeeId= ?q=
 * Paging:  ?page= ?pageSize=
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const {
      date = '',
      from = '',
      to = '',
      department = '',
      status = '',
      employeeId = '',
      q = '',
      page = '1',
      pageSize = '8',
    } = req.query;

    let rows = await list('attendance');

    if (date) rows = rows.filter((r) => r.date === date);
    if (from) rows = rows.filter((r) => r.date >= from);
    if (to) rows = rows.filter((r) => r.date <= to);
    if (department) rows = rows.filter((r) => r.department === department);
    if (status) rows = rows.filter((r) => r.status === status);
    if (employeeId) rows = rows.filter((r) => r.employeeId === employeeId);

    let decorated = await decorate(rows);

    const needle = String(q).trim().toLowerCase();
    if (needle) {
      decorated = decorated.filter((r) =>
        [r.employeeName, r.position, r.department]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      );
    }

    // Newest first, then by name so ordering is stable across reloads.
    decorated.sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.employeeName.localeCompare(b.employeeName, 'ar')
    );

    const total = decorated.length;
    const size = Math.max(1, Math.min(50, parseInt(pageSize, 10) || 8));
    const current = Math.max(1, parseInt(page, 10) || 1);
    const start = (current - 1) * size;

    // Summary is computed over the FILTERED set, not the page, so the stat cards
    // stay in step with whatever filter the user has applied.
    const summary = {
      total,
      present: decorated.filter((r) => r.status === 'حاضر').length,
      absent: decorated.filter((r) => r.status === 'غائب').length,
      late: decorated.filter((r) => r.status === 'متأخر').length,
      onLeave: decorated.filter((r) => r.status === 'في إجازة').length,
    };

    // Daily breakdown for the trend chart — groups filtered rows by date.
    const dailyMap = {};
    for (const r of decorated) {
      const d = (dailyMap[r.date] ||= { date: r.date, total: 0, present: 0, absent: 0, late: 0, onLeave: 0 });
      d.total += 1;
      if (r.status === 'حاضر') d.present += 1;
      else if (r.status === 'غائب') d.absent += 1;
      else if (r.status === 'متأخر') d.late += 1;
      else if (r.status === 'في إجازة') d.onLeave += 1;
    }
    const dailyStats = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      data: decorated.slice(start, start + size),
      summary,
      dailyStats,
      meta: {
        total,
        page: current,
        pageSize: size,
        pages: Math.max(1, Math.ceil(total / size)),
        dates: [...new Set((await list('attendance')).map((r) => r.date))].sort().reverse(),
        departments: [...new Set((await list('employees')).map((e) => e.department))],
        statuses: VALID_STATUSES,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/attendance — record a day for an employee (upserts on employee+date). */
router.post('/', requireAuth, requireRole(...canWrite), async (req, res, next) => {
  try {
    const { employeeId, date, status, checkIn, checkOut, overtimeHours } = req.body || {};

    if (!employeeId || !date || !status) {
      return res
        .status(400)
        .json({ error: 'الموظف والتاريخ والحالة حقول مطلوبة.' });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'حالة الحضور غير معروفة.' });
    }
    if (!ISO_DATE.test(String(date)) || Number.isNaN(Date.parse(date))) {
      return res.status(400).json({ error: 'صيغة التاريخ غير صالحة.' });
    }
    // Attendance records what already happened; a future day cannot be attended.
    // The date input caps itself too, but that cap is trivially bypassable.
    if (String(date) > todayISO()) {
      return res
        .status(400)
        .json({ error: 'لا يمكن تسجيل حضور بتاريخ مستقبلي.' });
    }

    const employee = await findById('employees', employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'الموظف غير موجود.' });
    }

    // One record per employee per day — recording twice updates rather than
    // duplicating, which would double-count in every summary.
    const existing = await findOne(
      'attendance',
      (r) => r.employeeId === employeeId && r.date === date
    );

    const payload = {
      status,
      checkIn: status === 'حاضر' || status === 'متأخر' ? checkIn || null : null,
      checkOut: status === 'حاضر' || status === 'متأخر' ? checkOut || null : null,
      overtimeHours: Number(overtimeHours) || 0,
      department: employee.department,
    };

    if (existing) {
      const updated = await update('attendance', existing.id, payload);
      await pushNotification({ type: 'attendance', title: 'تحديث حضور', body: `تم تحديث حضور ${employee.name} ليوم ${date}`, icon: 'clock' });
      return res.json({ data: updated, mode: 'updated' });
    }

    const created = await insert('attendance', {
      employeeId,
      date,
      ...payload,
    });
    await pushNotification({ type: 'attendance', title: 'تسجيل حضور', body: `تم تسجيل ${employee.name} — ${status}`, icon: 'clock' });
    res.status(201).json({ data: created, mode: 'created' });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/attendance/:id */
router.put('/:id', requireAuth, requireRole(...canWrite), async (req, res, next) => {
  try {
    if (req.body.status && !VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'حالة الحضور غير معروفة.' });
    }
    const patch = { ...req.body };
    if (patch.overtimeHours !== undefined) {
      patch.overtimeHours = Number(patch.overtimeHours) || 0;
    }
    const updated = await update('attendance', req.params.id, patch);
    if (!updated) return res.status(404).json({ error: 'السجل غير موجود.' });
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
