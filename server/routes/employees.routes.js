import { Router } from 'express';
import { list, findById, findOne, insert, update, remove, removeWhere } from '../store.js';
import { requireAuth, requireRole, canWrite, canDelete } from '../auth.js';
import { pushNotification } from './notifications.routes.js';
import { ensurePayrollRow } from './payroll.routes.js';

const router = Router();

const VALID_PERMISSIONS = ['admin', 'hr-standard', 'view-only'];
const VALID_TYPES = ['دوام كامل', 'دوام جزئي'];

/** Validates a create/update payload. Returns an array of Arabic error strings. */
function validate(body, { partial = false } = {}) {
  const errors = [];
  const has = (k) => body[k] !== undefined && body[k] !== null && body[k] !== '';

  if (!partial || has('name')) {
    if (!has('name') || String(body.name).trim().length < 3) {
      errors.push('الاسم مطلوب ويجب ألا يقل عن ٣ أحرف.');
    }
  }
  if (!partial || has('position')) {
    if (!has('position')) errors.push('المسمى الوظيفي مطلوب.');
  }
  if (!partial || has('department')) {
    if (!has('department')) errors.push('القسم مطلوب.');
  }
  if (!partial || has('email')) {
    if (!has('email') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email))) {
      errors.push('البريد الإلكتروني غير صالح.');
    }
  }
  if (!partial || has('salary')) {
    const n = Number(body.salary);
    if (!Number.isFinite(n) || n <= 0) {
      errors.push('الراتب يجب أن يكون رقمًا موجبًا.');
    }
  }
  if (has('permission') && !VALID_PERMISSIONS.includes(body.permission)) {
    errors.push('صلاحية غير معروفة.');
  }
  if (has('employmentType') && !VALID_TYPES.includes(body.employmentType)) {
    errors.push('نوع التوظيف غير معروف.');
  }
  return errors;
}

/** GET /api/employees — supports ?q=, ?department=, ?page=, ?pageSize= */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { q = '', department = '', page = '1', pageSize = '8' } = req.query;
    const needle = String(q).trim().toLowerCase();

    let rows = await list('employees');
    if (department) rows = rows.filter((e) => e.department === department);
    if (needle) {
      rows = rows.filter((e) =>
        [e.name, e.position, e.department, e.email]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      );
    }

    const total = rows.length;
    const size = Math.max(1, Math.min(50, parseInt(pageSize, 10) || 8));
    const current = Math.max(1, parseInt(page, 10) || 1);
    const start = (current - 1) * size;

    res.json({
      data: rows.slice(start, start + size),
      meta: {
        total,
        page: current,
        pageSize: size,
        pages: Math.max(1, Math.ceil(total / size)),
        departments: [...new Set((await list('employees')).map((e) => e.department))],
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/employees/:id */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await findById('employees', req.params.id);
    if (!row) return res.status(404).json({ error: 'الموظف غير موجود.' });
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
});

/** POST /api/employees */
router.post('/', requireAuth, requireRole(...canWrite), async (req, res, next) => {
  try {
    const errors = validate(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') , errors });

    const duplicate = await findOne(
      'employees',
      (e) => e.email.toLowerCase() === String(req.body.email).toLowerCase()
    );
    if (duplicate) {
      return res
        .status(409)
        .json({ error: 'هذا البريد الإلكتروني مستخدم بالفعل.' });
    }

    const created = await insert('employees', {
      name: String(req.body.name).trim(),
      position: String(req.body.position).trim(),
      department: String(req.body.department).trim(),
      salary: Number(req.body.salary),
      email: String(req.body.email).trim().toLowerCase(),
      employmentType: req.body.employmentType || 'دوام كامل',
      permission: req.body.permission || 'view-only',
      phone: req.body.phone || '',
      hireDate: req.body.hireDate || new Date().toISOString().slice(0, 10),
      active: true,
    });

    // Give the new hire a payroll row straight away, otherwise they are absent
    // from the payroll page until someone manually recalculates.
    await ensurePayrollRow(created);

    await pushNotification({ type: 'employee', title: 'موظف جديد', body: `تمت إضافة ${created.name} إلى قسم ${created.department}`, icon: 'user-plus' });
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/employees/:id */
router.put('/:id', requireAuth, requireRole(...canWrite), async (req, res, next) => {
  try {
    const errors = validate(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });

    if (req.body.email) {
      const clash = await findOne(
        'employees',
        (e) =>
          e.email.toLowerCase() === String(req.body.email).toLowerCase() &&
          e.id !== req.params.id
      );
      if (clash) {
        return res
          .status(409)
          .json({ error: 'هذا البريد الإلكتروني مستخدم بالفعل.' });
      }
    }

    const patch = { ...req.body };
    if (patch.salary !== undefined) patch.salary = Number(patch.salary);
    if (patch.email) patch.email = String(patch.email).trim().toLowerCase();

    const updated = await update('employees', req.params.id, patch);
    if (!updated) return res.status(404).json({ error: 'الموظف غير موجود.' });
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/employees/:id — admin only; cascades to attendance and payroll. */
router.delete('/:id', requireAuth, requireRole(...canDelete), async (req, res, next) => {
  try {
    const removed = await remove('employees', req.params.id);
    if (!removed) return res.status(404).json({ error: 'الموظف غير موجود.' });

    // Orphaned attendance/payroll rows would corrupt every downstream total,
    // so clear them in the same request.
    const attendanceRemoved = await removeWhere(
      'attendance',
      (a) => a.employeeId === req.params.id
    );
    const payrollRemoved = await removeWhere(
      'payroll',
      (p) => p.employeeId === req.params.id
    );

    await pushNotification({ type: 'employee', title: 'حذف موظف', body: `تم حذف ${removed.name} وجميع سجلاته`, icon: 'user-minus' });
    res.json({
      data: removed,
      cascaded: { attendance: attendanceRemoved, payroll: payrollRemoved },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
