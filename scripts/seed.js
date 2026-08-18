/**
 * seed.js — Generates the flat-file dataset and restores it to a known state.
 *
 *   npm run seed    # only writes files that are missing
 *   npm run reset   # overwrites everything, discarding runtime changes
 *
 * Attendance and payroll are DERIVED from the employee list here, so the four
 * files always agree with each other. Editing the roster below and re-running
 * regenerates consistent attendance and payroll rows automatically.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FORCE = process.argv.includes('--force');

/* ------------------------------------------------------------------ *
 * Reference data
 * ------------------------------------------------------------------ */

const DEPARTMENTS = [
  'الموارد البشرية',
  'الهندسة',
  'التسويق',
  'المالية',
  'المبيعات',
  'التصميم',
];

const EMPLOYMENT_TYPES = ['دوام كامل', 'دوام جزئي'];

const ROSTER = [
  ['عائشة الدوسري',   'مدير موارد بشرية',  'الموارد البشرية', 18000, 'دوام كامل', 'admin'],
  ['محمد العتيبي',    'مهندس برمجيات',     'الهندسة',        22000, 'دوام كامل', 'hr-standard'],
  ['سليمان القحطاني', 'أخصائي تسويق',      'التسويق',        14000, 'دوام كامل', 'view-only'],
  ['نورة الشمري',     'محلل مالي',         'المالية',        16500, 'دوام كامل', 'hr-standard'],
  ['خالد الغامدي',    'مدير مشاريع',       'الهندسة',        24000, 'دوام كامل', 'hr-standard'],
  ['فاطمة الزهراني',  'مصمم واجهات',       'التصميم',        15000, 'دوام جزئي', 'view-only'],
  ['عبدالله الحربي',  'مدير مبيعات',       'المبيعات',       20000, 'دوام كامل', 'hr-standard'],
  ['ريم السبيعي',     'أخصائي توظيف',      'الموارد البشرية', 13500, 'دوام كامل', 'view-only'],
  ['ياسر المطيري',    'مهندس شبكات',       'الهندسة',        19000, 'دوام كامل', 'hr-standard'],
  ['هند العنزي',      'محاسب',             'المالية',        14500, 'دوام جزئي', 'view-only'],
  ['طارق الدوسري',    'مندوب مبيعات',      'المبيعات',       11000, 'دوام كامل', 'view-only'],
  ['لمى الرشيد',      'مصمم جرافيك',       'التصميم',        12500, 'دوام كامل', 'view-only'],
];

const STATUSES = ['حاضر', 'غائب', 'متأخر', 'في إجازة'];

/**
 * The last `count` working days (the Saudi week runs Sunday–Thursday), ending
 * today, oldest first.
 *
 * The dataset used to be pinned to January 2024 to match the Figma mock. That
 * made every seeded day sit years in the past, so the dashboard opened on stale
 * history and the attendance form defaulted to a date nobody wanted. Anchoring
 * on the run date keeps the demo current, and every generated day is by
 * construction today or earlier.
 */
function lastWorkingDays(count) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const days = [];
  const cursor = new Date();
  while (days.length < count) {
    const dow = cursor.getDay(); // 5 = Friday, 6 = Saturday — the weekend here
    if (dow !== 5 && dow !== 6) {
      days.push(
        `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`
      );
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return days.reverse();
}

const DATES = lastWorkingDays(10);

/** Payroll period covering the seeded range, e.g. "2026-08". */
const PERIOD = DATES[DATES.length - 1].slice(0, 7);

/* ------------------------------------------------------------------ *
 * Deterministic pseudo-randomness
 * ------------------------------------------------------------------ */

// A seeded LCG keeps re-runs identical, so `npm run reset` genuinely restores
// the same dataset rather than a fresh random one.
let seedState = 20240113;
const rand = () => {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pad = (n) => String(n).padStart(2, '0');

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

async function buildUsers() {
  const accounts = [
    ['بسام البليهي',  'admin@hr360.sa',  'Admin@123',  'admin'],
    ['سارة الأحمدي',  'hr@hr360.sa',     'Hr@12345',   'hr-standard'],
    ['فهد المالكي',   'viewer@hr360.sa', 'View@1234',  'view-only'],
  ];
  const users = [];
  for (const [name, email, password, role] of accounts) {
    users.push({
      id: `usr_${email.split('@')[0]}`,
      name,
      email,
      role,
      active: true,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: '2024-01-01T08:00:00.000Z',
    });
  }
  return users;
}

function buildEmployees() {
  return ROSTER.map(([name, position, department, salary, type, permission], i) => {
    const slug = `emp_${pad(i + 1)}`;
    return {
      id: slug,
      name,
      position,
      department,
      salary,
      email: `employee${pad(i + 1)}@hr360.sa`,
      employmentType: type,
      permission,
      phone: `05${Math.floor(10000000 + rand() * 89999999)}`,
      hireDate: `202${1 + (i % 3)}-0${1 + (i % 9)}-${pad(1 + (i % 27))}`,
      active: true,
      createdAt: '2024-01-01T08:00:00.000Z',
    };
  });
}

function buildAttendance(employees) {
  const rows = [];
  for (const date of DATES) {
    for (const emp of employees) {
      const roll = rand();
      // Weighted so the dataset looks like a real month: mostly present, a few
      // late, fewer absent, occasional leave. Every status is represented.
      let status;
      if (roll < 0.72) status = 'حاضر';
      else if (roll < 0.85) status = 'متأخر';
      else if (roll < 0.94) status = 'غائب';
      else status = 'في إجازة';

      let checkIn = null;
      let checkOut = null;
      let overtimeHours = 0;

      if (status === 'حاضر') {
        checkIn = '09:00';
        const extra = rand() < 0.25 ? Math.ceil(rand() * 2) : 0;
        overtimeHours = extra;
        checkOut = `${pad(17 + extra)}:00`;
      } else if (status === 'متأخر') {
        const mins = pick([15, 25, 40, 55]);
        checkIn = `10:${pad(mins % 60)}`;
        checkOut = '17:00';
      }

      rows.push({
        id: `att_${emp.id.slice(4)}_${date.replace(/-/g, '')}`,
        employeeId: emp.id,
        date,
        status,
        checkIn,
        checkOut,
        overtimeHours,
        department: emp.department,
        createdAt: `${date}T08:00:00.000Z`,
      });
    }
  }
  return rows;
}

function buildPayroll(employees, attendance) {
  const period = PERIOD;
  return employees.map((emp) => {
    const mine = attendance.filter((a) => a.employeeId === emp.id);
    const present = mine.filter((a) => a.status === 'حاضر').length;
    const late = mine.filter((a) => a.status === 'متأخر').length;
    const absent = mine.filter((a) => a.status === 'غائب').length;
    const overtimeHours = mine.reduce((s, a) => s + (a.overtimeHours || 0), 0);

    // Simple, legible rules — deliberately transparent so the payroll page can
    // explain every number back to the user.
    const dailyRate = Math.round(emp.salary / 22);
    const hourlyRate = Math.round(dailyRate / 8);
    const hoursWorked = (present + late) * 8 + overtimeHours;
    const absenceDeduction = absent * dailyRate;
    const latePenalty = late * Math.round(hourlyRate * 0.5);
    const deductions = absenceDeduction + latePenalty;
    const overtimePay = overtimeHours * Math.round(hourlyRate * 1.5);
    const netSalary = emp.salary - deductions + overtimePay;

    return {
      id: `pay_${emp.id.slice(4)}_${period.replace('-', '')}`,
      employeeId: emp.id,
      period,
      basicSalary: emp.salary,
      hoursWorked,
      overtimeHours,
      overtimePay,
      absenceDeduction,
      latePenalty,
      deductions,
      netSalary,
      status: rand() < 0.75 ? 'مدفوع' : 'معلق',
      createdAt: `${DATES[DATES.length - 1]}T08:00:00.000Z`,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

async function writeIfAllowed(name, rows) {
  const target = path.join(DATA_DIR, `${name}.json`);
  if (!FORCE) {
    try {
      await fs.access(target);
      console.log(`  • ${name}.json موجود — تم تخطيه (استخدم npm run reset للاستبدال)`);
      return false;
    } catch {
      /* missing — fall through and write it */
    }
  }
  await fs.writeFile(target, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`  ✓ ${name}.json — ${rows.length} سجل`);
  return true;
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  console.log(FORCE ? '\nإعادة تعيين البيانات…\n' : '\nتهيئة البيانات…\n');

  const users = await buildUsers();
  const employees = buildEmployees();
  const attendance = buildAttendance(employees);
  const payroll = buildPayroll(employees, attendance);

  await writeIfAllowed('users', users);
  await writeIfAllowed('employees', employees);
  await writeIfAllowed('attendance', attendance);
  await writeIfAllowed('payroll', payroll);
  // The activity log starts empty, but the file has to exist for the bell icon
  // to read anything on a fresh checkout.
  await writeIfAllowed('notifications', []);

  console.log('\nحسابات الدخول التجريبية:');
  console.log('  admin@hr360.sa  / Admin@123  (مدير النظام)');
  console.log('  hr@hr360.sa     / Hr@12345   (موارد بشرية)');
  console.log('  viewer@hr360.sa / View@1234  (اطلاع فقط)\n');
}

main().catch((err) => {
  console.error('فشلت التهيئة:', err);
  process.exit(1);
});
