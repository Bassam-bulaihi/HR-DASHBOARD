import { Router } from 'express';
import { list, findById, update, replaceAll, insert } from '../store.js';
import { requireAuth, requireRole, canWrite, ROLES } from '../auth.js';
import { pushNotification } from './notifications.routes.js';

const router = Router();

/**
 * Payroll is DERIVED from employee salary + attendance, per the PRD.
 * These rules are intentionally simple and transparent so the UI can show the
 * user exactly how a net figure was reached.
 */
export function computeForEmployee(employee, attendanceRows) {
  const mine = attendanceRows.filter((a) => a.employeeId === employee.id);
  const present = mine.filter((a) => a.status === 'حاضر').length;
  const late = mine.filter((a) => a.status === 'متأخر').length;
  const absent = mine.filter((a) => a.status === 'غائب').length;
  const onLeave = mine.filter((a) => a.status === 'في إجازة').length;
  const overtimeHours = mine.reduce((s, a) => s + (a.overtimeHours || 0), 0);

  const dailyRate = Math.round(employee.salary / 22);
  const hourlyRate = Math.round(dailyRate / 8);
  const hoursWorked = (present + late) * 8 + overtimeHours;

  const absenceDeduction = absent * dailyRate;      // unpaid absence
  const latePenalty = late * Math.round(hourlyRate * 0.5); // half hour per late day
  const deductions = absenceDeduction + latePenalty;
  const overtimePay = overtimeHours * Math.round(hourlyRate * 1.5);
  const netSalary = employee.salary - deductions + overtimePay;

  return {
    employeeId: employee.id,
    basicSalary: employee.salary,
    dailyRate,
    hourlyRate,
    daysPresent: present,
    daysLate: late,
    daysAbsent: absent,
    daysOnLeave: onLeave,
    hoursWorked,
    overtimeHours,
    overtimePay,
    absenceDeduction,
    latePenalty,
    deductions,
    netSalary,
  };
}

/** The payroll period the app is currently operating in, e.g. "2026-08". */
export function currentPeriod() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/**
 * Create the payroll row for a newly hired employee.
 *
 * Without this a new hire is invisible on the payroll page until someone
 * happens to press "إعادة الاحتساب" — the record looked like it had failed to
 * save. Called from the employee create route.
 */
export async function ensurePayrollRow(employee) {
  const period = currentPeriod();
  const id = `pay_${employee.id.slice(4)}_${period.replace('-', '')}`;
  const existing = await findById('payroll', id);
  if (existing) return existing;
  return insert('payroll', {
    id,
    period,
    ...computeForEmployee(employee, await list('attendance')),
    status: 'معلق',
  });
}

/** Joins payroll rows onto their employee for display. */
async function decorate(rows) {
  const employees = await list('employees');
  const byId = new Map(employees.map((e) => [e.id, e]));
  return rows
    .map((r) => {
      const emp = byId.get(r.employeeId);
      if (!emp) return null; // employee deleted — drop the orphan
      return {
        ...r,
        employeeName: emp.name,
        position: emp.position,
        department: emp.department,
        employmentType: emp.employmentType,
      };
    })
    .filter(Boolean);
}

/** GET /api/payroll — rows + analytics. Filters: ?q= ?department= ?status= */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { q = '', department = '', status = '', page = '1', pageSize = '8' } = req.query;

    let decorated = await decorate(await list('payroll'));

    if (department) decorated = decorated.filter((r) => r.department === department);
    if (status) decorated = decorated.filter((r) => r.status === status);

    const needle = String(q).trim().toLowerCase();
    if (needle) {
      decorated = decorated.filter((r) =>
        [r.employeeName, r.position, r.department].join(' ').toLowerCase().includes(needle)
      );
    }

    decorated.sort((a, b) => b.netSalary - a.netSalary);

    // Analytics reflect the filtered set so the cards agree with the table.
    const totalPayroll = decorated.reduce((s, r) => s + r.netSalary, 0);
    const paid = decorated.filter((r) => r.status === 'مدفوع');
    const pending = decorated.filter((r) => r.status === 'معلق');

    const byDepartment = {};
    for (const row of decorated) {
      const d = (byDepartment[row.department] ||= {
        department: row.department,
        employees: 0,
        total: 0,
        deductions: 0,
        overtime: 0,
      });
      d.employees += 1;
      d.total += row.netSalary;
      d.deductions += row.deductions || 0;
      d.overtime += row.overtimePay || 0;
    }

    const total = decorated.length;
    const size = Math.max(1, Math.min(50, parseInt(pageSize, 10) || 8));
    const current = Math.max(1, parseInt(page, 10) || 1);
    const start = (current - 1) * size;

    res.json({
      data: decorated.slice(start, start + size),
      analytics: {
        totalPayroll,
        employeeCount: total,
        paidTotal: paid.reduce((s, r) => s + r.netSalary, 0),
        paidCount: paid.length,
        pendingTotal: pending.reduce((s, r) => s + r.netSalary, 0),
        pendingCount: pending.length,
        totalDeductions: decorated.reduce((s, r) => s + (r.deductions || 0), 0),
        totalOvertime: decorated.reduce((s, r) => s + (r.overtimePay || 0), 0),
        averageNet: total ? Math.round(totalPayroll / total) : 0,
        byDepartment: Object.values(byDepartment).sort((a, b) => b.total - a.total),
      },
      meta: {
        total,
        page: current,
        pageSize: size,
        pages: Math.max(1, Math.ceil(total / size)),
        departments: [...new Set((await list('employees')).map((e) => e.department))],
        statuses: ['مدفوع', 'معلق'],
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/payroll/:id — includes the derivation breakdown. */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await findById('payroll', req.params.id);
    if (!row) return res.status(404).json({ error: 'سجل الراتب غير موجود.' });
    const employee = await findById('employees', row.employeeId);
    if (!employee) return res.status(404).json({ error: 'الموظف غير موجود.' });
    const breakdown = computeForEmployee(employee, await list('attendance'));
    res.json({ data: { ...row, employeeName: employee.name }, breakdown });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payroll/recalculate
 * Rebuilds every payroll row from current employee + attendance data.
 * Preserves the paid/pending status of existing rows.
 */
router.post(
  '/recalculate',
  requireAuth,
  requireRole(...canWrite),
  async (req, res, next) => {
    try {
      const employees = await list('employees');
      const attendance = await list('attendance');
      const existing = await list('payroll');
      const statusByEmployee = new Map(existing.map((p) => [p.employeeId, p.status]));
      // Default to the month being worked in rather than a hardcoded 2024-01,
      // which produced payroll ids that no longer matched the seeded rows.
      const period = req.body?.period || currentPeriod();

      const rebuilt = employees.map((emp) => ({
        id: `pay_${emp.id.slice(4)}_${period.replace('-', '')}`,
        period,
        ...computeForEmployee(emp, attendance),
        status: statusByEmployee.get(emp.id) || 'معلق',
        createdAt: new Date().toISOString(),
      }));

      await replaceAll('payroll', rebuilt);
      await pushNotification({ type: 'payroll', title: 'إعادة احتساب', body: `تمت إعادة احتساب ${rebuilt.length} سجل راتب`, icon: 'calculator' });
      res.json({ data: rebuilt, count: rebuilt.length });
    } catch (err) {
      next(err);
    }
  }
);

/** PUT /api/payroll/:id/status — mark a single row paid/pending. */
router.put(
  '/:id/status',
  requireAuth,
  requireRole(...canWrite),
  async (req, res, next) => {
    try {
      const { status } = req.body || {};
      if (!['مدفوع', 'معلق'].includes(status)) {
        return res.status(400).json({ error: 'حالة الصرف غير معروفة.' });
      }
      const updated = await update('payroll', req.params.id, { status });
      if (!updated) return res.status(404).json({ error: 'سجل الراتب غير موجود.' });
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/** POST /api/payroll/pay-all — admin only; settles every pending row. */
router.post(
  '/pay-all',
  requireAuth,
  requireRole(ROLES.ADMIN),
  async (_req, res, next) => {
    try {
      const rows = await list('payroll');
      const pending = rows.filter((r) => r.status === 'معلق');
      for (const row of pending) {
        await update('payroll', row.id, {
          status: 'مدفوع',
          paidAt: new Date().toISOString(),
        });
      }
      await pushNotification({ type: 'payroll', title: 'صرف رواتب', body: `تم صرف ${pending.length} راتب معلق`, icon: 'wallet' });
      res.json({ settled: pending.length });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
