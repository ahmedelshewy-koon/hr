import { ensureAuthSchema, hashPassword, requirePortalSession } from "../../portal-auth";
import { createDatabase, type PostgresDatabase } from "../../../db/postgres";

type Json = Record<string, unknown>;
type Row = Record<string, unknown>;
type AppUser = { id: number; email: string; role_id: number; role_name: string; employee_id: number | null; employee_name:string|null; employee_name_ar:string|null; department_id:number|null; department_name:string|null; department_name_ar:string|null; must_change_password:number };

const SUPER_ADMIN_MODULES = ["dashboard","employee_portal","employee_requests","request_approvals","employees","employee_salaries","job_titles","departments","leave_management","attendance","attendance_adjustments","organization_chart","users","permissions","system_settings","reports"];
const ACTIONS = ["view","create","edit","delete","approve","export","manage_settings"];
const SYSTEM_ROLES = ["Super Admin","HR Manager","Department Manager","Employee"] as const;
const ROLE_DEFAULTS:Record<string,Record<string,readonly string[]>> = {
  "HR Manager": {
    dashboard:["view"], employee_portal:["view"], employee_requests:["view","create"], request_approvals:["view","approve"],
    employees:["view","create","edit","export"], employee_salaries:["view","edit"], job_titles:["view","create","edit"], departments:["view","create","edit"],
    leave_management:["view","create","edit","delete","approve","export"], attendance:["view","create","edit","export"], attendance_adjustments:["view","edit","approve"],
    organization_chart:["view","edit"], users:["view","edit"], reports:["view","export"], payroll:["view","create_run","edit_draft","approve","lock","reopen","view_own_payslip"],
  },
  "Department Manager": {
    dashboard:["view"], employee_portal:["view"], employee_requests:["view","create"], request_approvals:["view","approve"],
    employees:["view"], leave_management:["view"], attendance:["view","create"], organization_chart:["view"], payroll:["view_own_payslip"],
  },
  Employee: { dashboard:["view"], employee_portal:["view"], employee_requests:["view","create"], attendance:["create"], payroll:["view_own_payslip"] },
};
const PAYROLL_ACTIONS = ["view","create_run","edit_draft","approve","lock","reopen","view_own_payslip"] as const;
const PAYROLL_ROLE_DEFAULTS: Record<string, readonly string[]> = {
  "Super Admin": PAYROLL_ACTIONS,
  "HR Manager": PAYROLL_ACTIONS,
  "Department Manager": ["view_own_payslip"],
  "Employee": ["view_own_payslip"],
};
const OFFICIAL_HOLIDAYS_2026 = [
  ["2026-01-07","Coptic Christmas","عيد الميلاد المجيد","Egypt","وقت ثابت مصر","annual"],
  ["2026-01-08","Company holiday for 7 January","كل الشركة 7 يناير","Egypt","وقت ثابت مصر","once"],
  ["2026-01-29","25 January Revolution","ثورة 25 يناير","Egypt","وقت ثابت مصر","annual"],
  ["2026-02-19","First day of Ramadan","أول يوم رمضان","Egypt","وقت ثابت مصر|مواعيد رمضان مصر","once"],
  ["2026-02-22","Saudi Founding Day","يوم التأسيس","Saudi Arabia","وقت ثابت للمملكة","annual"],
  ["2026-03-20","Eid al-Fitr","عيد الفطر","Both","وقت ثابت مصر|وقت ثابت للمملكة|حضور من 8 - 4","once"],
  ["2026-03-21","Eid al-Fitr — Day 2","عيد الفطر - اليوم الثاني","Both","وقت ثابت مصر|وقت ثابت للمملكة|حضور من 8 - 4","once"],
  ["2026-03-22","Eid al-Fitr — Day 3","عيد الفطر - اليوم الثالث","Both","وقت ثابت مصر|وقت ثابت للمملكة|حضور من 8 - 4","once"],
  ["2026-03-23","Eid al-Fitr holiday","اجازة عيد الفطر المبارك","Egypt","وقت ثابت مصر|مواعيد رمضان مصر","once"],
  ["2026-04-09","Maundy Thursday","خميس العهد","Egypt","وقت ثابت مصر|وقت من الساعة 9 صباحا الى 5 مساء","once"],
  ["2026-04-12","Easter Sunday","حد القيامة","Egypt","وقت ثابت مصر","once"],
  ["2026-04-13","Sham El-Nessim","شم النسيم","Egypt","وقت ثابت مصر","once"],
  ["2026-04-25","Sinai Liberation Day","عيد تحرير سيناء","Egypt","وقت ثابت مصر","annual"],
  ["2026-05-01","Labour Day","عيد العمال","Egypt","وقت ثابت مصر","annual"],
  ["2026-05-07","Labour Day replacement holiday","اجازة عيد العمال","Egypt","وقت من الساعة 9 صباحا الى 5 مساء|حضور من 8 - 4|وقت ثابت مصر","once"],
  ["2026-05-26","Eid al-Adha holiday","إجازة عيد الاضحى المبارك","Both","وقت ثابت مصر|وقت ثابت للمملكة|حضور من 8 - 4","once"],
  ["2026-05-27","Eid al-Adha","عيد الأضحى","Both","وقت ثابت مصر|وقت ثابت للمملكة|حضور من 8 - 4","once"],
  ["2026-05-28","Eid al-Adha — Day 2","عيد الأضحى - اليوم الثاني","Both","وقت ثابت مصر|وقت ثابت للمملكة|حضور من 8 - 4","once"],
  ["2026-05-29","Eid al-Adha — Day 3","عيد الأضحى - اليوم الثالث","Both","وقت ثابت مصر|وقت ثابت للمملكة|حضور من 8 - 4","once"],
  ["2026-05-30","Eid al-Adha — Day 4","عيد الأضحى - اليوم الرابع","Both","وقت ثابت مصر|وقت ثابت للمملكة|حضور من 8 - 4","once"],
  ["2026-05-31","Eid al-Adha Day 5","Eid al-Adha Day 5","Both","وقت ثابت مصر|وقت ثابت للمملكة|حضور من 8 - 4","once"],
  ["2026-06-18","Islamic New Year","رأس السنة الهجرية","Egypt","وقت ثابت مصر|حضور من 8 - 4","once"],
  ["2026-07-02","30 June replacement holiday","اجازة بديلة عن يوم 30 يونيو 2026","Egypt","وقت ثابت مصر|حضور من 8 - 4","once"],
  ["2026-07-23","23 July Revolution","ثورة 23 يوليو","Egypt","وقت ثابت مصر|حضور من 8 - 4","annual"],
  ["2026-08-26","Prophet’s Birthday","المولد النبوي الشريف","Egypt","وقت ثابت مصر","once"],
  ["2026-09-23","Saudi National Day","اليوم الوطني السعودي","Saudi Arabia","وقت ثابت للمملكة","annual"],
  ["2026-10-06","Armed Forces Day","عيد القوات المسلحة","Egypt","وقت ثابت مصر","annual"],
] as const;

/** Bump whenever the seeded reference data below changes, to force a re-seed. */
const SEED_VERSION = "2026-08-20-four-role-auth-2";

async function ensureSeed(d1: PostgresDatabase) {
  const now = new Date().toISOString();
  await ensureAuthSchema(d1);
  await d1.prepare("CREATE TABLE IF NOT EXISTS system_settings (id SERIAL PRIMARY KEY, setting_key TEXT NOT NULL UNIQUE, value_json TEXT NOT NULL DEFAULT '{}', updated_by_user_id INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  // Seeding is ~200 sequential statements; skip it once the reference data is in place
  // so it does not run again on every single API request.
  const seedMarker = await d1.prepare("SELECT value_json FROM system_settings WHERE setting_key='seed_version'").first<{ value_json: string }>();
  if (seedMarker?.value_json === SEED_VERSION) return;
  await d1.prepare("ALTER TABLE holidays ADD COLUMN IF NOT EXISTS attendance_types TEXT NOT NULL DEFAULT ''").run();
  await d1.prepare("ALTER TABLE holidays ADD COLUMN IF NOT EXISTS recurrence_type TEXT NOT NULL DEFAULT 'once'").run();
  const roleNames = [...SYSTEM_ROLES];
  for (const name of roleNames) await d1.prepare("INSERT OR IGNORE INTO roles (name, description, is_system, created_at, updated_at) VALUES (?, ?, 1, ?, ?)").bind(name, `${name} system role`, now, now).run();
  await d1.prepare("UPDATE users SET role_id=(SELECT id FROM roles WHERE name='HR Manager') WHERE role_id IN (SELECT id FROM roles WHERE name IN ('Admin','HR'))").run();
  await d1.prepare("UPDATE users SET role_id=(SELECT id FROM roles WHERE name='Department Manager') WHERE role_id IN (SELECT id FROM roles WHERE name='Direct Manager')").run();
  await d1.prepare("UPDATE users SET role_id=(SELECT id FROM roles WHERE name='Department Manager') WHERE role_id=(SELECT id FROM roles WHERE name='Employee') AND employee_id IN (SELECT manager_employee_id FROM departments WHERE manager_employee_id IS NOT NULL AND status!='deleted')").run();
  await d1.prepare("DELETE FROM permissions WHERE role_id IN (SELECT id FROM roles WHERE name IN ('Admin','HR','Direct Manager'))").run();
  await d1.prepare("DELETE FROM roles WHERE name IN ('Admin','HR','Direct Manager')").run();
  const superRole = await d1.prepare("SELECT id FROM roles WHERE name = 'Super Admin'").first<{ id: number }>();
  if (superRole) for (const moduleName of SUPER_ADMIN_MODULES) for (const action of ACTIONS) await d1.prepare("INSERT OR IGNORE INTO permissions (role_id, module, action, allowed) VALUES (?, ?, ?, 1)").bind(superRole.id, moduleName, action).run();
  for (const [roleName,moduleDefaults] of Object.entries(ROLE_DEFAULTS)) {
    const role=await d1.prepare("SELECT id FROM roles WHERE name=?").bind(roleName).first<{id:number}>();
    if(!role)continue;
    for(const [moduleName,allowedActions] of Object.entries(moduleDefaults)) for(const action of ACTIONS) await d1.prepare("INSERT INTO permissions (role_id,module,action,allowed) VALUES (?,?,?,?) ON CONFLICT(role_id,module,action) DO NOTHING").bind(role.id,moduleName,action,allowedActions.includes(action)?1:0).run();
  }
  for (const [roleName, allowedActions] of Object.entries(PAYROLL_ROLE_DEFAULTS)) {
    const payrollRole = await d1.prepare("SELECT id FROM roles WHERE name=?").bind(roleName).first<{ id: number }>();
    if (!payrollRole) continue;
    for (const action of PAYROLL_ACTIONS) await d1.prepare("INSERT OR IGNORE INTO permissions (role_id, module, action, allowed) VALUES (?,?,?,?)").bind(payrollRole.id,"payroll",action,allowedActions.includes(action)?1:0).run();
  }

  for (const holiday of OFFICIAL_HOLIDAYS_2026) await d1.prepare("INSERT INTO holidays (holiday_date,name_en,name_ar,country,attendance_types,recurrence_type,days,status,created_at,updated_at) SELECT ?,?,?,?,?,?,1,'active',?,? WHERE NOT EXISTS (SELECT 1 FROM holidays WHERE holiday_date=? AND name_ar=?)").bind(...holiday,now,now,holiday[0],holiday[2]).run();

  await d1.prepare("INSERT INTO system_settings (setting_key,value_json,created_at,updated_at) VALUES ('seed_version',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP").bind(SEED_VERSION).run();
}

async function currentUser(d1: PostgresDatabase, userId:number): Promise<AppUser> {
  const user = await d1.prepare("SELECT u.id,u.email,u.role_id,u.employee_id,u.must_change_password,r.name AS role_name,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.department_id,d.name_en AS department_name,d.name_ar AS department_name_ar FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE u.id=? AND u.status='active'").bind(userId).first<AppUser>();
  if(!user)throw new Response("Account disabled",{status:403});
  return user;
}

async function can(d1: PostgresDatabase, user: AppUser, module: string, action: string) {
  if (user.role_name === "Super Admin") return true;
  const permission = await d1.prepare("SELECT allowed FROM permissions WHERE role_id=? AND module=? AND action=?").bind(user.role_id,module,action).first<{allowed:number}>();
  return Boolean(permission?.allowed);
}

async function authorize(d1: PostgresDatabase, user: AppUser, module: string, action: string) {
  if (!(await can(d1,user,module,action))) throw new Response("Permission denied", { status: 403 });
}

async function canAccessEmployee(d1:PostgresDatabase,user:AppUser,employeeId:number){
  if(user.role_name==="Super Admin"||user.role_name==="HR Manager")return true;
  if(user.role_name==="Employee")return Number(user.employee_id)===employeeId;
  if(user.role_name!=="Department Manager"||!user.employee_id)return false;
  const row=await d1.prepare("WITH RECURSIVE managed AS (SELECT id FROM departments WHERE manager_employee_id=? AND status!='deleted' UNION ALL SELECT d.id FROM departments d JOIN managed m ON d.parent_id=m.id WHERE d.status!='deleted') SELECT e.id FROM employees e WHERE e.id=? AND e.department_id IN (SELECT id FROM managed)").bind(user.employee_id,employeeId).first<{id:number}>();
  return Boolean(row);
}

async function audit(d1: PostgresDatabase, request: Request, user: AppUser, action: string, module: string, recordType?: string, recordId?: string, previous?: unknown, next?: unknown) {
  await d1.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(user.id, action, module, recordType ?? null, recordId ?? null, previous ? JSON.stringify(previous) : null, next ? JSON.stringify(next) : null, request.headers.get("cf-connecting-ip")).run();
}

function clean(value: unknown, max = 500) { return typeof value === "string" ? value.trim().slice(0,max) : ""; }
function required(value: unknown, name: string) { const v=clean(value); if(!v) throw new Response(`${name} is required`,{status:400}); return v; }
function round2(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

async function calculatePayrollRun(d1: PostgresDatabase, run: { id: number; month: number; year: number; country: string }) {
  const monthStart = `${run.year}-${String(run.month).padStart(2,"0")}-01`;
  const lastDay = new Date(run.year, run.month, 0).getDate();
  const monthEnd = `${run.year}-${String(run.month).padStart(2,"0")}-${String(lastDay).padStart(2,"0")}`;

  const settingRow = await d1.prepare("SELECT value_json FROM system_settings WHERE setting_key='payroll'").first<{value_json:string}>();
  let payrollSettings: { overtimeMultiplier?: number; taxBaseIncludesAllowances?: boolean } = {};
  try { payrollSettings = JSON.parse(settingRow?.value_json || "{}"); } catch { payrollSettings = {}; }
  const overtimeMultiplier = Number(payrollSettings.overtimeMultiplier) || 1.5;
  const taxBaseIncludesAllowances = payrollSettings.taxBaseIncludesAllowances !== false;

  const employees = (await d1.prepare("SELECT id,required_daily_minutes FROM employees WHERE country=? AND employment_status!='deleted'").bind(run.country).all()).results as { id: number; required_daily_minutes: number | null }[];

  const insuranceRate = await d1.prepare("SELECT employee_rate FROM insurance_rates WHERE country=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1").bind(run.country, monthEnd).first<{ employee_rate: number }>();
  const employeeInsuranceRate = Number(insuranceRate?.employee_rate) || 0;

  const latestBracketDate = await d1.prepare("SELECT effective_from FROM tax_brackets WHERE country=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1").bind(run.country, monthEnd).first<{ effective_from: string }>();
  const brackets = latestBracketDate
    ? (await d1.prepare("SELECT min_amount,max_amount,rate FROM tax_brackets WHERE country=? AND effective_from=? ORDER BY min_amount ASC").bind(run.country, latestBracketDate.effective_from).all()).results as { min_amount: number; max_amount: number | null; rate: number }[]
    : [];

  const computeTax = (taxableIncome: number) => {
    if (!brackets.length || taxableIncome <= 0) return 0;
    let tax = 0;
    for (const bracket of brackets) {
      const min = Number(bracket.min_amount), max = bracket.max_amount === null ? Infinity : Number(bracket.max_amount);
      if (taxableIncome <= min) continue;
      const bandAmount = Math.max(0, Math.min(taxableIncome, max) - min);
      tax += bandAmount * (Number(bracket.rate) / 100);
    }
    return tax;
  };

  const items: { employeeId: number; basicSalary: number; totalAllowances: number; overtimeAmount: number; absenceDeduction: number; unpaidLeaveDeduction: number; loanDeduction: number; insuranceDeduction: number; taxDeduction: number; netSalary: number }[] = [];
  const skipped: { employeeId: number; reason: string }[] = [];

  for (const employee of employees) {
    const structure = await d1.prepare("SELECT * FROM salary_structures WHERE employee_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC LIMIT 1").bind(employee.id, monthEnd, monthStart).first<Row>();
    if (!structure) { skipped.push({ employeeId: employee.id, reason: "No active salary structure for this period" }); continue; }
    const basicSalary = Number(structure.basic_salary) || 0;
    const allowanceRows = (await d1.prepare("SELECT amount,percentage FROM salary_allowances WHERE salary_structure_id=?").bind(structure.id).all()).results as { amount: number | null; percentage: number | null }[];
    const totalAllowances = round2(allowanceRows.reduce((sum, row) => sum + (row.amount != null ? Number(row.amount) : (Number(row.percentage) || 0) / 100 * basicSalary), 0));

    const attendanceRows = (await d1.prepare("SELECT overtime_minutes,status FROM daily_attendance WHERE employee_id=? AND work_date>=? AND work_date<=?").bind(employee.id, monthStart, monthEnd).all()).results as { overtime_minutes: number | null; status: string }[];
    const overtimeMinutesTotal = attendanceRows.reduce((sum, row) => sum + (Number(row.overtime_minutes) || 0), 0);
    const absenceDays = attendanceRows.filter(row => row.status === "absent").length;
    const dailyRate = basicSalary / 30;
    const requiredDailyHours = (Number(employee.required_daily_minutes) || 480) / 60;
    const hourlyRate = requiredDailyHours > 0 ? dailyRate / requiredDailyHours : 0;
    const overtimeAmount = round2((overtimeMinutesTotal / 60) * hourlyRate * overtimeMultiplier);
    const absenceDeduction = round2(absenceDays * dailyRate);

    const unpaidRequests = (await d1.prepare("SELECT from_date,to_date FROM requests WHERE employee_id=? AND status='hr_approved' AND type ILIKE '%unpaid%' AND from_date IS NOT NULL AND to_date IS NOT NULL AND from_date<=? AND to_date>=?").bind(employee.id, monthEnd, monthStart).all()).results as { from_date: string; to_date: string }[];
    let unpaidDays = 0;
    for (const item of unpaidRequests) {
      const from = item.from_date < monthStart ? monthStart : item.from_date;
      const to = item.to_date > monthEnd ? monthEnd : item.to_date;
      unpaidDays += Math.max(0, (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000 + 1);
    }
    const unpaidLeaveDeduction = round2(unpaidDays * dailyRate);

    const loans = (await d1.prepare("SELECT remaining_amount,monthly_installment FROM loans_advances WHERE employee_id=? AND status='active'").bind(employee.id).all()).results as { remaining_amount: number; monthly_installment: number }[];
    const loanDeduction = round2(loans.reduce((sum, loan) => sum + Math.min(Number(loan.monthly_installment) || 0, Number(loan.remaining_amount) || 0), 0));

    const insuranceDeduction = round2(basicSalary * (employeeInsuranceRate / 100));
    const taxableIncome = Math.max(0, taxBaseIncludesAllowances ? (basicSalary + totalAllowances - insuranceDeduction) : (basicSalary - insuranceDeduction));
    const taxDeduction = round2(computeTax(taxableIncome));

    const netSalary = round2(basicSalary + totalAllowances + overtimeAmount - absenceDeduction - unpaidLeaveDeduction - loanDeduction - insuranceDeduction - taxDeduction);

    items.push({ employeeId: employee.id, basicSalary, totalAllowances, overtimeAmount, absenceDeduction, unpaidLeaveDeduction, loanDeduction, insuranceDeduction, taxDeduction, netSalary });
  }

  await d1.batch([
    d1.prepare("DELETE FROM payroll_items WHERE payroll_run_id=?").bind(run.id),
    ...items.map(item => d1.prepare("INSERT INTO payroll_items (payroll_run_id,employee_id,basic_salary,total_allowances,overtime_amount,absence_deduction,unpaid_leave_deduction,loan_deduction,insurance_deduction,tax_deduction,net_salary) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(run.id,item.employeeId,item.basicSalary,item.totalAllowances,item.overtimeAmount,item.absenceDeduction,item.unpaidLeaveDeduction,item.loanDeduction,item.insuranceDeduction,item.taxDeduction,item.netSalary)),
  ]);

  return { itemCount: items.length, skipped };
}

export async function GET(request: Request) {
  const d1 = createDatabase();
  try {
    await ensureSeed(d1);
    const portalSession = await requirePortalSession(request,d1);
    const user = await currentUser(d1,portalSession.userId);
    await authorize(d1,user,"dashboard","view");
    const canPayroll = await can(d1,user,"payroll","view");
    const canViewUsers=await can(d1,user,"users","view"),canViewPermissions=await can(d1,user,"permissions","view"),canViewSettings=await can(d1,user,"system_settings","view");
    const fullCompany=user.role_name==="Super Admin"||user.role_name==="HR Manager";
    let departmentIds:number[]=[];
    if(user.role_name==="Department Manager"&&user.employee_id){
      departmentIds=(await d1.prepare("WITH RECURSIVE managed AS (SELECT id FROM departments WHERE manager_employee_id=? AND status!='deleted' UNION ALL SELECT d.id FROM departments d JOIN managed m ON d.parent_id=m.id WHERE d.status!='deleted') SELECT DISTINCT id FROM managed").bind(user.employee_id).all<{id:number}>()).results.map(row=>Number(row.id));
      if(user.department_id&&!departmentIds.includes(Number(user.department_id)))departmentIds.push(Number(user.department_id));
    }
    const departmentList=departmentIds.length?departmentIds.map(Number).join(","):"-1";
    const employeeScope=fullCompany?"TRUE":user.role_name==="Department Manager"?`e.department_id IN (${departmentList})`:`e.id=${Number(user.employee_id)||-1}`;
    const departmentScope=fullCompany?"TRUE":user.role_name==="Department Manager"?`d.id IN (${departmentList})`:`d.id=${Number(user.department_id)||-1}`;
    const safeEmployeeColumns="e.id,e.employee_code,e.name_en,e.name_ar,e.work_email,e.work_phone,e.department_id,e.job_title_id,e.manager_id,e.organizational_level,e.start_date,e.end_date,e.employment_status,e.country,e.work_location,e.employment_type,e.schedule_type,e.work_days,e.check_in_time,e.check_out_time,e.grace_minutes,e.required_daily_minutes,e.avatar_url,e.created_at,e.updated_at";
    const employeeColumns=fullCompany||user.role_name==="Employee"?"e.*":safeEmployeeColumns;
    const employeeIdParam = user.employee_id ?? 0;
    const [employeeRows,departmentRows,jobRows,requestRows,attendanceRows,holidayRows,leaveTypeRows,roleRows,userRows,auditRows,settingRows] = await Promise.all([
      d1.prepare(`SELECT ${employeeColumns},d.name_en AS department_name,d.name_ar AS department_name_ar,j.name_en AS job_title_name,j.name_ar AS job_title_name_ar,m.name_en AS manager_name,m.name_ar AS manager_name_ar FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id LEFT JOIN employees m ON m.id=e.manager_id WHERE e.employment_status!='deleted' AND ${employeeScope} ORDER BY e.department_id,e.organizational_level,e.name_en LIMIT 250`).all(),
      d1.prepare(`SELECT d.*,dm.name_en AS manager_name,dm.name_ar AS manager_name_ar,dm.employee_code AS manager_code,COUNT(e.id) AS employee_count FROM departments d LEFT JOIN employees dm ON dm.id=d.manager_employee_id LEFT JOIN employees e ON e.department_id=d.id AND e.employment_status!='deleted' WHERE ${departmentScope} GROUP BY d.id,dm.name_en,dm.name_ar,dm.employee_code ORDER BY d.name_en`).all(),
      d1.prepare(`SELECT j.*,d.name_en AS department_name,d.name_ar AS department_name_ar,COUNT(e.id) AS employee_count FROM job_titles j LEFT JOIN departments d ON d.id=j.department_id LEFT JOIN employees e ON e.job_title_id=j.id WHERE ${fullCompany?"TRUE":`j.department_id IN (${departmentList})`} GROUP BY j.id,d.name_en,d.name_ar ORDER BY j.name_en`).all(),
      d1.prepare(`SELECT q.*,e.name_en AS employee_name,e.name_ar AS employee_name_ar,d.name_en AS department_name,d.name_ar AS department_name_ar FROM requests q JOIN employees e ON e.id=q.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE ${employeeScope} ORDER BY q.id DESC LIMIT 250`).all(),
      d1.prepare(`SELECT a.*,e.name_en AS employee_name,e.name_ar AS employee_name_ar,d.name_en AS department_name,d.name_ar AS department_name_ar FROM daily_attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE ${employeeScope} ORDER BY a.work_date DESC,a.id DESC LIMIT 250`).all(),
      d1.prepare("SELECT * FROM holidays WHERE status!='deleted' ORDER BY holiday_date").all(),
      d1.prepare("SELECT * FROM leave_types WHERE status!='archived' ORDER BY id").all(),
      canViewPermissions?d1.prepare("SELECT r.*,COUNT(u.id) AS user_count FROM roles r LEFT JOIN users u ON u.role_id=r.id WHERE r.name IN ('Super Admin','HR Manager','Department Manager','Employee') GROUP BY r.id ORDER BY r.id").all():Promise.resolve({results:[]}),
      canViewUsers?d1.prepare("SELECT u.id,u.email,u.employee_id,u.status,u.must_change_password,u.last_login_at,u.role_id,r.name AS role_name,e.name_en AS employee_name,e.name_ar AS employee_name_ar,d.name_en AS department_name,d.name_ar AS department_name_ar FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id ORDER BY u.id").all():Promise.resolve({results:[]}),
      user.role_name==="Super Admin"?d1.prepare("SELECT a.*,u.email AS user_email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 50").all():Promise.resolve({results:[]}),
      canViewSettings?d1.prepare("SELECT setting_key,value_json,updated_at FROM system_settings ORDER BY setting_key").all():Promise.resolve({results:[]}),
    ]);
    const permissions = await d1.prepare(`SELECT role_id,module,action,allowed FROM permissions WHERE ${canViewPermissions?"TRUE":"role_id=?"} ORDER BY role_id,module,action`).bind(...(canViewPermissions?[]:[user.role_id])).all();
    const emptyResults = Promise.resolve({ results: [] as Record<string, unknown>[] });
    const [salaryStructureRows,salaryAllowanceRows,payrollRunRows,payrollItemRows,payrollAllowanceLineRows,loanRows,taxBracketRows,insuranceRateRows] = await Promise.all([
      canPayroll
        ? d1.prepare("SELECT s.*,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.employee_code FROM salary_structures s JOIN employees e ON e.id=s.employee_id ORDER BY s.employee_id,s.effective_from DESC LIMIT 1000").all()
        : d1.prepare("SELECT s.*,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.employee_code FROM salary_structures s JOIN employees e ON e.id=s.employee_id WHERE s.employee_id=? ORDER BY s.effective_from DESC LIMIT 200").bind(employeeIdParam).all(),
      canPayroll
        ? d1.prepare("SELECT sa.* FROM salary_allowances sa ORDER BY sa.salary_structure_id LIMIT 4000").all()
        : d1.prepare("SELECT sa.* FROM salary_allowances sa JOIN salary_structures s ON s.id=sa.salary_structure_id WHERE s.employee_id=? ORDER BY sa.salary_structure_id LIMIT 500").bind(employeeIdParam).all(),
      canPayroll
        ? d1.prepare("SELECT * FROM payroll_runs ORDER BY year DESC,month DESC,country LIMIT 200").all()
        : d1.prepare("SELECT * FROM payroll_runs WHERE status IN ('approved','locked') ORDER BY year DESC,month DESC LIMIT 100").all(),
      canPayroll
        ? d1.prepare("SELECT pi.*,pr.month,pr.year,pr.country,pr.status AS run_status,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.employee_code,e.work_email FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payroll_run_id JOIN employees e ON e.id=pi.employee_id ORDER BY pr.year DESC,pr.month DESC,e.name_en LIMIT 1000").all()
        : d1.prepare("SELECT pi.*,pr.month,pr.year,pr.country,pr.status AS run_status,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.employee_code,e.work_email FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payroll_run_id JOIN employees e ON e.id=pi.employee_id WHERE pi.employee_id=? AND pr.status IN ('approved','locked') ORDER BY pr.year DESC,pr.month DESC LIMIT 200").bind(employeeIdParam).all(),
      canPayroll
        ? d1.prepare("SELECT pi.id AS payroll_item_id,sa.type,sa.amount,sa.percentage,ss.basic_salary AS structure_basic_salary,ROUND((COALESCE(sa.amount,(COALESCE(sa.percentage,0)/100.0)*ss.basic_salary))::numeric,2) AS resolved_amount FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payroll_run_id JOIN salary_structures ss ON ss.employee_id=pi.employee_id AND ss.effective_from::date<=(make_date(pr.year,pr.month,1)+INTERVAL '1 month'-INTERVAL '1 day')::date AND (ss.effective_to IS NULL OR ss.effective_to::date>=make_date(pr.year,pr.month,1)) JOIN salary_allowances sa ON sa.salary_structure_id=ss.id ORDER BY pi.id LIMIT 6000").all()
        : d1.prepare("SELECT pi.id AS payroll_item_id,sa.type,sa.amount,sa.percentage,ss.basic_salary AS structure_basic_salary,ROUND((COALESCE(sa.amount,(COALESCE(sa.percentage,0)/100.0)*ss.basic_salary))::numeric,2) AS resolved_amount FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payroll_run_id JOIN salary_structures ss ON ss.employee_id=pi.employee_id AND ss.effective_from::date<=(make_date(pr.year,pr.month,1)+INTERVAL '1 month'-INTERVAL '1 day')::date AND (ss.effective_to IS NULL OR ss.effective_to::date>=make_date(pr.year,pr.month,1)) JOIN salary_allowances sa ON sa.salary_structure_id=ss.id WHERE pi.employee_id=? AND pr.status IN ('approved','locked') ORDER BY pi.id LIMIT 1000").bind(employeeIdParam).all(),
      canPayroll
        ? d1.prepare("SELECT l.*,e.name_en AS employee_name,e.name_ar AS employee_name_ar,e.employee_code FROM loans_advances l JOIN employees e ON e.id=l.employee_id ORDER BY l.status,l.issued_at DESC LIMIT 500").all()
        : emptyResults,
      canPayroll
        ? d1.prepare("SELECT * FROM tax_brackets ORDER BY country,effective_from DESC,min_amount ASC LIMIT 500").all()
        : emptyResults,
      canPayroll
        ? d1.prepare("SELECT * FROM insurance_rates ORDER BY country,effective_from DESC LIMIT 200").all()
        : emptyResults,
    ]);
    const pageModules:Record<string,string>={dashboard:"dashboard",portal:"employee_portal",approvals:"request_approvals",employees:"employees",leave:"leave_management",attendance:"attendance",org:"organization_chart",users:"users",payroll:"payroll",settings:"system_settings"};
    const allowedPages=(await Promise.all(Object.entries(pageModules).map(async([page,module])=>await can(d1,user,module,"view")?page:null))).filter(Boolean);
    return Response.json({ currentUser:user, allowedPages, canManagePayroll:canPayroll, employees:employeeRows.results, departments:departmentRows.results, jobTitles:jobRows.results, requests:requestRows.results, attendance:attendanceRows.results, holidays:holidayRows.results, leaveTypes:leaveTypeRows.results, roles:roleRows.results, users:userRows.results, permissions:permissions.results, audit:auditRows.results, settings:settingRows.results, salaryStructures:salaryStructureRows.results, salaryAllowances:salaryAllowanceRows.results, payrollRuns:payrollRunRows.results, payrollItems:payrollItemRows.results, payrollAllowanceLines:payrollAllowanceLineRows.results, loansAdvances:loanRows.results, taxBrackets:taxBracketRows.results, insuranceRates:insuranceRateRows.results });
  } catch(error) { return apiError(error); }
  finally { await d1.close(); }
}

export async function POST(request: Request) {
  const d1 = createDatabase();
  try {
    await ensureSeed(d1);
    const portalSession = await requirePortalSession(request,d1);
    const user=await currentUser(d1,portalSession.userId);
    const payload=await request.json() as Json;
    const action=required(payload.action,"action");
    if(action==="save_user"){
      await authorize(d1,user,"users","edit");
      const targetUserId=Number(payload.userId);if(!targetUserId)throw new Response("User is required",{status:400});
      const roleName=required(payload.roleName,"Role");if(!SYSTEM_ROLES.includes(roleName as typeof SYSTEM_ROLES[number]))throw new Response("Invalid system role",{status:400});
      const status=clean(payload.status)==="disabled"?"disabled":"active";
      const before=await d1.prepare("SELECT u.id,u.email,u.role_id,u.status,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?").bind(targetUserId).first<Record<string,unknown>>();
      if(!before)throw new Response("User not found",{status:404});
      if(user.role_name==="HR Manager"&&(!["Department Manager","Employee"].includes(roleName)||["Super Admin","HR Manager"].includes(String(before.role_name))))throw new Response("HR can manage employee and department-manager accounts only",{status:403});
      if(before.role_name==="Super Admin"&&(roleName!=="Super Admin"||status!=="active")){
        const admins=await d1.prepare("SELECT COUNT(*)::int AS count FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Super Admin' AND u.status='active'").first<{count:number}>();
        if(Number(admins?.count)<=1)throw new Response("The last active system administrator cannot be changed",{status:400});
      }
      const role=await d1.prepare("SELECT id FROM roles WHERE name=?").bind(roleName).first<{id:number}>();
      const temporaryPassword=clean(payload.temporaryPassword,200);let passwordHash:string|null=null;
      if(temporaryPassword){if(temporaryPassword.length<10||!/[A-Za-z]/.test(temporaryPassword)||!/[0-9]/.test(temporaryPassword))throw new Response("Temporary password must be at least 10 characters and contain a letter and number",{status:400});passwordHash=await hashPassword(temporaryPassword);}
      await d1.prepare("UPDATE users SET role_id=?,status=?,password_hash=COALESCE(?,password_hash),must_change_password=CASE WHEN ? IS NULL THEN must_change_password ELSE 1 END,session_version=session_version+1,failed_login_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(role!.id,status,passwordHash,passwordHash,targetUserId).run();
      await audit(d1,request,user,"update","users","user",String(targetUserId),before,{roleName,status,passwordReset:Boolean(passwordHash)});
      return Response.json({ok:true});
    }
    if(action==="create_employee") {
      await authorize(d1,user,"employees","create");
      const nameEn=required(payload.nameEn,"English name"), nameAr=required(payload.nameAr,"Arabic name"), email=required(payload.workEmail,"Work email").toLowerCase();
      const managerId=Number(payload.managerId)||null;
      const max=await d1.prepare("SELECT COALESCE(MAX(id),0)+1 AS next FROM employees").first<{next:number}>();
      const code=`EMP-${String(max?.next??1).padStart(5,"0")}`;
      const result=await d1.prepare("INSERT INTO employees (employee_code,name_en,name_ar,work_email,fingerprint_code,personal_phone,work_phone,nationality,gender,birth_date,identification_number,address,department_id,job_title_id,manager_id,start_date,end_date,employment_status,salary,salary_currency,country,work_location,employment_type,schedule_type,work_days,check_in_time,check_out_time,grace_minutes,required_daily_minutes,bank_name,bank_account_number,bank_iban,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id")
        .bind(code,nameEn,nameAr,email,clean(payload.fingerprintCode)||null,clean(payload.personalPhone)||null,clean(payload.workPhone)||null,clean(payload.nationality)||null,clean(payload.gender)||null,clean(payload.birthDate)||null,clean(payload.identificationNumber)||null,clean(payload.address,1000)||null,Number(payload.departmentId)||null,Number(payload.jobTitleId)||null,managerId,required(payload.startDate,"Start date"),clean(payload.endDate)||null,clean(payload.employmentStatus)||"active",Number(payload.salary)||null,clean(payload.salaryCurrency)||"SAR",required(payload.country,"Country"),clean(payload.workLocation)||null,clean(payload.employmentType)||"full_time",clean(payload.scheduleType)||"fixed",clean(payload.workDays)||"0,1,2,3,4",clean(payload.checkInTime)||"09:00",clean(payload.checkOutTime)||"17:00",Number(payload.graceMinutes)||15,Number(payload.requiredDailyMinutes)||480,clean(payload.bankName)||null,clean(payload.bankAccountNumber)||null,clean(payload.bankIban)||null).first<{id:number}>();
      if(managerId) await d1.prepare("UPDATE employees e SET organizational_level=COALESCE((SELECT organizational_level+1 FROM employees WHERE id=?),1) WHERE e.id=?").bind(managerId,result!.id).run();
      const employeeRole=await d1.prepare("SELECT id FROM roles WHERE name='Employee'").first<{id:number}>();
      if(employeeRole) await d1.prepare("INSERT INTO users (email,employee_id,role_id,status,must_change_password,created_at,updated_at) VALUES (?,?,?,'active',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").bind(email,result!.id,employeeRole.id).run();
      await audit(d1,request,user,"create","employees","employee",String(result!.id),null,{code,nameEn,email});
      return Response.json({ok:true,id:result!.id,employeeCode:code},{status:201});
    }
    if(action==="update_employee") {
      await authorize(d1,user,"employees","edit");
      const employeeId=Number(payload.employeeId);
      if(!employeeId) throw new Response("Employee is required",{status:400});
      const before=await d1.prepare("SELECT * FROM employees WHERE id=? AND employment_status!='deleted'").bind(employeeId).first<Record<string,unknown>>();
      if(!before) throw new Response("Employee not found",{status:404});
      const nameEn=required(payload.nameEn,"English name"),nameAr=required(payload.nameAr,"Arabic name"),email=required(payload.workEmail,"Work email").toLowerCase();
      const managerId=Number(payload.managerId)||null;
      if(managerId===employeeId) throw new Response("An employee cannot manage themselves",{status:400});
      await d1.prepare("UPDATE employees SET name_en=?,name_ar=?,work_email=?,fingerprint_code=?,personal_phone=?,work_phone=?,nationality=?,gender=?,birth_date=?,identification_number=?,address=?,department_id=?,job_title_id=?,manager_id=?,start_date=?,end_date=?,employment_status=?,salary=?,salary_currency=?,country=?,work_location=?,employment_type=?,schedule_type=?,work_days=?,check_in_time=?,check_out_time=?,grace_minutes=?,required_daily_minutes=?,bank_name=?,bank_account_number=?,bank_iban=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(nameEn,nameAr,email,clean(payload.fingerprintCode)||null,clean(payload.personalPhone)||null,clean(payload.workPhone)||null,clean(payload.nationality)||null,clean(payload.gender)||null,clean(payload.birthDate)||null,clean(payload.identificationNumber)||null,clean(payload.address,1000)||null,Number(payload.departmentId)||null,Number(payload.jobTitleId)||null,managerId,required(payload.startDate,"Start date"),clean(payload.endDate)||null,clean(payload.employmentStatus)||"active",Number(payload.salary)||null,clean(payload.salaryCurrency)||"SAR",required(payload.country,"Country"),clean(payload.workLocation)||null,clean(payload.employmentType)||"full_time",clean(payload.scheduleType)||"fixed",clean(payload.workDays)||"0,1,2,3,4",clean(payload.checkInTime)||"09:00",clean(payload.checkOutTime)||"17:00",Number(payload.graceMinutes)||15,Number(payload.requiredDailyMinutes)||480,clean(payload.bankName)||null,clean(payload.bankAccountNumber)||null,clean(payload.bankIban)||null,employeeId).run();
      await d1.prepare("UPDATE employees SET organizational_level=CASE WHEN ? IS NULL THEN 1 ELSE COALESCE((SELECT organizational_level+1 FROM employees WHERE id=?),1) END WHERE id=?").bind(managerId,managerId,employeeId).run();
      await d1.prepare("UPDATE users SET email=?,updated_at=CURRENT_TIMESTAMP WHERE employee_id=?").bind(email,employeeId).run();
      await audit(d1,request,user,"update","employees","employee",String(employeeId),before,payload);
      return Response.json({ok:true,id:employeeId});
    }
    if(action==="save_job_title") {
      const jobTitleId=Number(payload.jobTitleId)||null;
      await authorize(d1,user,"job_titles",jobTitleId?"edit":"create");
      const nameEn=required(payload.nameEn,"English name"),nameAr=required(payload.nameAr,"Arabic name");
      const departmentId=Number(payload.departmentId)||null;
      const status=clean(payload.status)==="archived"?"archived":"active";
      if(departmentId){const department=await d1.prepare("SELECT id FROM departments WHERE id=? AND status!='deleted'").bind(departmentId).first<{id:number}>();if(!department)throw new Response("Department not found",{status:404});}
      const duplicate=await d1.prepare("SELECT id FROM job_titles WHERE (lower(name_en)=lower(?) OR name_ar=?) AND status!='deleted' ORDER BY id LIMIT 1").bind(nameEn,nameAr).first<{id:number}>();
      if(duplicate&&Number(duplicate.id)!==jobTitleId)throw new Response("A job title with the same name already exists",{status:409});
      if(jobTitleId){
        const before=await d1.prepare("SELECT * FROM job_titles WHERE id=? AND status!='deleted'").bind(jobTitleId).first<Record<string,unknown>>();
        if(!before)throw new Response("Job title not found",{status:404});
        await d1.prepare("UPDATE job_titles SET name_en=?,name_ar=?,department_id=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(nameEn,nameAr,departmentId,status,jobTitleId).run();
        await audit(d1,request,user,"update","job_titles","job_title",String(jobTitleId),before,{nameEn,nameAr,departmentId,status});
        return Response.json({ok:true,id:jobTitleId});
      }
      const result=await d1.prepare("INSERT INTO job_titles (name_en,name_ar,department_id,status,created_at,updated_at) VALUES (?,?,?,? ,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(nameEn,nameAr,departmentId,status).first<{id:number}>();
      await audit(d1,request,user,"create","job_titles","job_title",String(result!.id),null,{nameEn,nameAr,departmentId,status});
      return Response.json({ok:true,id:result!.id},{status:201});
    }
    if(action==="save_department") {
      const departmentId=Number(payload.departmentId)||null;
      await authorize(d1,user,"departments",departmentId?"edit":"create");
      const nameEn=required(payload.nameEn,"English name"),nameAr=required(payload.nameAr,"Arabic name");
      const parentId=Number(payload.parentId)||null;
      const status=clean(payload.status)==="archived"?"archived":"active";
      if(departmentId&&parentId===departmentId)throw new Response("A department cannot be its own parent",{status:400});
      if(parentId){
        const parent=await d1.prepare("SELECT id FROM departments WHERE id=? AND status!='deleted'").bind(parentId).first<{id:number}>();if(!parent)throw new Response("Parent department not found",{status:404});
        if(departmentId){let current:number|null=parentId;const visited=new Set<number>();while(current){if(current===departmentId)throw new Response("The department hierarchy cannot contain a cycle",{status:400});if(visited.has(current))break;visited.add(current);const row:{parent_id:number|null}|null=await d1.prepare("SELECT parent_id FROM departments WHERE id=?").bind(current).first<{parent_id:number|null}>();current=Number(row?.parent_id)||null;}}
      }
      const duplicate=await d1.prepare("SELECT id FROM departments WHERE (lower(name_en)=lower(?) OR name_ar=?) AND status!='deleted' ORDER BY id LIMIT 1").bind(nameEn,nameAr).first<{id:number}>();
      if(duplicate&&Number(duplicate.id)!==departmentId)throw new Response("A department with the same name already exists",{status:409});
      if(departmentId){
        const before=await d1.prepare("SELECT * FROM departments WHERE id=? AND status!='deleted'").bind(departmentId).first<Record<string,unknown>>();
        if(!before)throw new Response("Department not found",{status:404});
        await d1.prepare("UPDATE departments SET name_en=?,name_ar=?,parent_id=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(nameEn,nameAr,parentId,status,departmentId).run();
        await audit(d1,request,user,"update","departments","department",String(departmentId),before,{nameEn,nameAr,parentId,status});
        return Response.json({ok:true,id:departmentId});
      }
      const result=await d1.prepare("INSERT INTO departments (name_en,name_ar,parent_id,status,created_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(nameEn,nameAr,parentId,status).first<{id:number}>();
      await audit(d1,request,user,"create","departments","department",String(result!.id),null,{nameEn,nameAr,parentId,status});
      return Response.json({ok:true,id:result!.id},{status:201});
    }
    if(action==="save_system_settings") {
      await authorize(d1,user,"system_settings","manage_settings");
      const settingKey=required(payload.settingKey,"Setting key");
      const values=payload.values && typeof payload.values==="object" ? payload.values : {};
      const before=await d1.prepare("SELECT value_json FROM system_settings WHERE setting_key=?").bind(settingKey).first<Record<string,unknown>>();
      const valueJson=JSON.stringify(values);
      await d1.prepare("INSERT INTO system_settings (setting_key,value_json,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_by_user_id=excluded.updated_by_user_id,updated_at=CURRENT_TIMESTAMP").bind(settingKey,valueJson,user.id).run();
      await audit(d1,request,user,"update","system_settings","setting",settingKey,before,values);
      return Response.json({ok:true,settingKey,values});
    }
    if(action==="save_leave_type") {
      const leaveTypeId=Number(payload.leaveTypeId)||null;
      await authorize(d1,user,"leave_management",leaveTypeId?"edit":"create");
      const code=required(payload.code,"Code").toUpperCase();
      const nameEn=required(payload.nameEn,"English name"),nameAr=required(payload.nameAr,"Arabic name");
      const defaultDays=Number(payload.defaultDays);
      if(!Number.isInteger(defaultDays)||defaultDays<0||defaultDays>9999) throw new Response("Default days must be a whole number between 0 and 9999",{status:400});
      const paid=payload.paid?1:0, approval=payload.requiresApproval?1:0, status=payload.active===false?"inactive":"active";
      const duplicate=await d1.prepare("SELECT id FROM leave_types WHERE upper(code)=upper(?) AND status!='archived' ORDER BY id LIMIT 1").bind(code).first<{id:number}>();
      if(duplicate&&Number(duplicate.id)!==leaveTypeId) throw new Response("A leave type with the same code already exists",{status:409});
      if(leaveTypeId){
        const before=await d1.prepare("SELECT * FROM leave_types WHERE id=? AND status!='archived'").bind(leaveTypeId).first<Record<string,unknown>>();
        if(!before) throw new Response("Leave type not found",{status:404});
        await d1.prepare("UPDATE leave_types SET code=?,name_en=?,name_ar=?,default_days=?,paid=?,manager_approval=?,hr_approval=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(code,nameEn,nameAr,defaultDays,paid,approval,approval,status,leaveTypeId).run();
        await audit(d1,request,user,"update","leave_management","leave_type",String(leaveTypeId),before,{code,nameEn,nameAr,defaultDays,paid,requiresApproval:Boolean(approval),status});
        return Response.json({ok:true,id:leaveTypeId});
      }
      const result=await d1.prepare("INSERT INTO leave_types (code,name_en,name_ar,default_days,paid,attachment_required,manager_approval,hr_approval,status,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(code,nameEn,nameAr,defaultDays,paid,approval,approval,status).first<{id:number}>();
      await audit(d1,request,user,"create","leave_management","leave_type",String(result!.id),null,{code,nameEn,nameAr,defaultDays,paid,requiresApproval:Boolean(approval),status});
      return Response.json({ok:true,id:result!.id},{status:201});
    }
    if(action==="delete_leave_type") {
      await authorize(d1,user,"leave_management","delete");
      const leaveTypeId=Number(payload.leaveTypeId);
      if(!leaveTypeId) throw new Response("Leave type is required",{status:400});
      const before=await d1.prepare("SELECT * FROM leave_types WHERE id=? AND status!='archived'").bind(leaveTypeId).first<Record<string,unknown>>();
      if(!before) throw new Response("Leave type not found",{status:404});
      await d1.prepare("UPDATE leave_types SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(leaveTypeId).run();
      await audit(d1,request,user,"archive","leave_management","leave_type",String(leaveTypeId),before,{status:"archived"});
      return Response.json({ok:true});
    }
    if(action==="save_department_hierarchy") {
      await authorize(d1,user,"departments","edit");
      const departmentId=Number(payload.departmentId), managerEmployeeId=Number(payload.managerEmployeeId);
      if(!departmentId||!managerEmployeeId) throw new Response("Department and manager are required",{status:400});
      const members=(await d1.prepare("SELECT id,manager_id FROM employees WHERE department_id=? AND employment_status!='deleted'").bind(departmentId).all()).results as {id:number;manager_id:number|null}[];
      if(!members.some(member=>Number(member.id)===managerEmployeeId)) throw new Response("The department manager must belong to this department",{status:400});
      const supplied=Array.isArray(payload.assignments)?payload.assignments as Json[]:[];
      const memberIds=new Set(members.map(member=>Number(member.id)));
      const parents=new Map<number,number|null>();
      for(const member of members) {
        const assignment=supplied.find(item=>Number(item.employeeId)===Number(member.id));
        const requested=Number(assignment?.managerId)||null;
        const parent=Number(member.id)===managerEmployeeId?null:(requested||managerEmployeeId);
        if(parent!==null&&!memberIds.has(parent)) throw new Response("Every direct manager must belong to the same department",{status:400});
        if(parent===Number(member.id)) throw new Response("An employee cannot manage themselves",{status:400});
        parents.set(Number(member.id),parent);
      }
      const levels=new Map<number,number>();
      const resolveLevel=(employeeId:number,path=new Set<number>()):number=>{
        if(levels.has(employeeId)) return levels.get(employeeId)!;
        if(path.has(employeeId)) throw new Response("The reporting structure contains a cycle",{status:400});
        path.add(employeeId);
        const parent=parents.get(employeeId)??null;
        const level=parent===null?0:resolveLevel(parent,path)+1;
        if(level>20) throw new Response("The reporting structure is too deep",{status:400});
        path.delete(employeeId); levels.set(employeeId,level); return level;
      };
      for(const member of members) resolveLevel(Number(member.id));
      const before=await d1.prepare("SELECT manager_employee_id FROM departments WHERE id=?").bind(departmentId).first<Record<string,unknown>>();
      await d1.batch([
        d1.prepare("UPDATE departments SET manager_employee_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(managerEmployeeId,departmentId),
        ...members.map(member=>d1.prepare("UPDATE employees SET manager_id=?,organizational_level=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(parents.get(Number(member.id)),levels.get(Number(member.id)),member.id)),
      ]);
      const managerRole=await d1.prepare("SELECT id FROM roles WHERE name='Department Manager'").first<{id:number}>();
      if(managerRole)await d1.prepare("UPDATE users SET role_id=?,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE employee_id=? AND role_id=(SELECT id FROM roles WHERE name='Employee')").bind(managerRole.id,managerEmployeeId).run();
      await audit(d1,request,user,"update","departments","department",String(departmentId),before,{managerEmployeeId,levels:Object.fromEntries(levels)});
      return Response.json({ok:true,levels:Object.fromEntries(levels)});
    }
    if(action==="save_organization_levels") {
      await authorize(d1,user,"departments","edit");
      const assignments=Array.isArray(payload.assignments)?payload.assignments as Json[]:[];
      if(!assignments.length) throw new Response("At least one employee level is required",{status:400});
      const rows=(await d1.prepare("SELECT e.id,d.manager_employee_id FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.employment_status!='deleted'").all()).results as {id:number;manager_employee_id:number|null}[];
      const employeeById=new Map(rows.map(row=>[Number(row.id),row]));
      const updates:{employeeId:number;level:number}[]=[];
      for(const assignment of assignments) {
        const employeeId=Number(assignment.employeeId), level=Number(assignment.level);
        const employee=employeeById.get(employeeId);
        if(!employee) throw new Response("Employee not found",{status:404});
        if(!Number.isInteger(level)||level<0||level>20) throw new Response("Level must be a whole number between 0 and 20",{status:400});
        const isDepartmentManager=employeeId===Number(employee.manager_employee_id);
        if(isDepartmentManager&&level!==0) throw new Response("Department managers must remain at level 0",{status:400});
        if(!isDepartmentManager&&level===0) throw new Response("Only a department manager can use level 0",{status:400});
        updates.push({employeeId,level});
      }
      await d1.batch(updates.map(update=>d1.prepare("UPDATE employees SET organizational_level=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(update.level,update.employeeId)));
      await audit(d1,request,user,"update","organization_chart","employee_levels",undefined,null,{count:updates.length,updates});
      return Response.json({ok:true,count:updates.length});
    }
    if(action==="create_request") {
      await authorize(d1,user,"employee_requests","create");
      const requestedEmployeeId=Number(payload.employeeId)||null;
      const employeeId=(user.role_name==="Super Admin"||user.role_name==="HR Manager")?(requestedEmployeeId||user.employee_id):user.employee_id;
      if(!employeeId) throw new Response("Employee profile required",{status:400});
      if(!(await canAccessEmployee(d1,user,employeeId)))throw new Response("Employee is outside your access scope",{status:403});
      const next=await d1.prepare("SELECT COALESCE(MAX(id),0)+1 AS next FROM requests").first<{next:number}>();
      const code=`REQ-${1000+(next?.next??1)}`;
      const result=await d1.prepare("INSERT INTO requests (request_code,employee_id,type,from_date,to_date,request_date,request_time,amount,currency,reason,notes,details_json,status,current_stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending_manager','manager',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id")
        .bind(code,employeeId,required(payload.type,"Request type"),clean(payload.fromDate)||null,clean(payload.toDate)||null,clean(payload.requestDate)||null,clean(payload.requestTime)||null,Number(payload.amount)||null,clean(payload.currency)||null,required(payload.reason,"Reason"),clean(payload.notes,2000)||null,JSON.stringify(payload.details??{})).first<{id:number}>();
      await audit(d1,request,user,"submit","employee_requests","request",String(result!.id),null,{code});
      return Response.json({ok:true,id:result!.id,requestCode:code},{status:201});
    }
    if(action==="request_action") {
      await authorize(d1,user,"request_approvals","approve");
      const requestId=Number(payload.requestId); const decision=required(payload.decision,"Decision");
      const before=await d1.prepare("SELECT * FROM requests WHERE id=?").bind(requestId).first<Record<string,unknown>>();
      if(!before) throw new Response("Request not found",{status:404});
      if(Number(before.employee_id)===Number(user.employee_id))throw new Response("You cannot approve your own request",{status:403});
      if(before.current_stage==="manager"&&(user.role_name!=="Department Manager"||!(await canAccessEmployee(d1,user,Number(before.employee_id)))))throw new Response("Only the employee's department manager can take this action",{status:403});
      if(before.current_stage==="hr"&&!(["Super Admin","HR Manager"].includes(user.role_name)))throw new Response("Only HR can take this action",{status:403});
      if(decision==="reject" && !clean(payload.reason)) throw new Response("Rejection reason is required",{status:400});
      let status:string,currentStage:string;
      if(decision==="approve"&&before.current_stage==="manager"){status="pending_hr";currentStage="hr";} else if(decision==="approve"){status="hr_approved";currentStage="completed";} else {status=before.current_stage==="manager"?"manager_rejected":"hr_rejected";currentStage="completed";}
      await d1.batch([d1.prepare("UPDATE requests SET status=?,current_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,currentStage,requestId),d1.prepare("INSERT INTO approvals (request_id,stage,actor_user_id,action,reason,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)").bind(requestId,String(before.current_stage),user.id,decision,clean(payload.reason)||null)]);
      await audit(d1,request,user,decision,"request_approvals","request",String(requestId),before,{status,currentStage});
      return Response.json({ok:true,status,currentStage});
    }
    if(action==="attendance_event") {
      await authorize(d1,user,"attendance","create");
      const requestedEmployeeId=Number(payload.employeeId)||null;
      const employeeId=(user.role_name==="Super Admin"||user.role_name==="HR Manager")?(requestedEmployeeId||user.employee_id):user.employee_id;
      if(!employeeId) throw new Response("Employee profile required",{status:400});
      if(!(await canAccessEmployee(d1,user,employeeId)))throw new Response("Employee is outside your access scope",{status:403});
      const eventType=required(payload.eventType,"Event type");
      if(eventType!=="check_in"&&eventType!=="check_out") throw new Response("Event type must be check_in or check_out",{status:400});
      const last=await d1.prepare("SELECT event_type FROM attendance_logs WHERE employee_id=? ORDER BY event_at DESC LIMIT 1").bind(employeeId).first<{event_type:string}>();
      if(last?.event_type===eventType) throw new Response(`Duplicate ${eventType} is not allowed`,{status:409});
      const now=new Date().toISOString(), workDate=now.slice(0,10), time=now.slice(11,16);
      // Checking out without an open check-in would otherwise update zero rows and report success.
      if(eventType==="check_out"){
        const open=await d1.prepare("SELECT id FROM daily_attendance WHERE employee_id=? AND work_date=? AND actual_in IS NOT NULL").bind(employeeId,workDate).first<{id:number}>();
        if(!open) throw new Response("There is no check-in recorded for today",{status:409});
      }
      await d1.prepare("INSERT INTO attendance_logs (employee_id,event_at,event_type,source,device,location,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(employeeId,now,eventType,"remote","Web portal",clean(payload.location)||null,user.id).run();
      if(eventType==="check_in") await d1.prepare("INSERT INTO daily_attendance (employee_id,work_date,scheduled_in,scheduled_out,actual_in,attendance_type,status,created_at,updated_at) VALUES (?,?,'09:00','17:00',?,'remote','remote',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(employee_id,work_date) DO UPDATE SET actual_in=excluded.actual_in,attendance_type='remote',status='remote',updated_at=CURRENT_TIMESTAMP").bind(employeeId,workDate,time).run();
      else await d1.prepare("UPDATE daily_attendance SET actual_out=?,worked_minutes=GREATEST(0,CAST(EXTRACT(EPOCH FROM ((? || ' ' || ?)::timestamp - (? || ' ' || actual_in)::timestamp))/60 AS INTEGER)),updated_at=CURRENT_TIMESTAMP WHERE employee_id=? AND work_date=?").bind(time,workDate,time,workDate,employeeId,workDate).run();
      await audit(d1,request,user,eventType,"attendance","employee",String(employeeId),null,{now,source:"remote"});
      return Response.json({ok:true,eventAt:now});
    }
    if(action==="create_holiday") {
      await authorize(d1,user,"leave_management","create");
      const result=await d1.prepare("INSERT INTO holidays (name_en,name_ar,holiday_date,country,attendance_types,recurrence_type,days,original_date,original_date_behavior,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(required(payload.nameEn,"English name"),required(payload.nameAr,"Arabic name"),required(payload.holidayDate,"Holiday date"),required(payload.country,"Country"),clean(payload.attendanceTypes,1000),clean(payload.recurrenceType)==="annual"?"annual":"once",Number(payload.days)||1,clean(payload.originalDate)||null,clean(payload.originalDateBehavior)||"holiday",clean(payload.notes,1000)||null).first<{id:number}>();
      await audit(d1,request,user,"create","leave_management","holiday",String(result!.id),null,payload);
      return Response.json({ok:true,id:result!.id},{status:201});
    }
    if(action==="save_permissions") {
      await authorize(d1,user,"permissions","manage_settings");
      const roleId=Number(payload.roleId); const values=Array.isArray(payload.permissions)?payload.permissions as Json[]:[];
      for(const p of values) await d1.prepare("INSERT INTO permissions (role_id,module,action,allowed) VALUES (?,?,?,?) ON CONFLICT(role_id,module,action) DO UPDATE SET allowed=excluded.allowed").bind(roleId,required(p.module,"module"),required(p.permission,"permission"),p.allowed?1:0).run();
      await audit(d1,request,user,"update","permissions","role",String(roleId),null,{count:values.length});
      return Response.json({ok:true});
    }
    if(action==="archive") {
      const entity=required(payload.entity,"entity"), id=Number(payload.id);
      const map:Record<string,{table:string,module:string,statusColumn:string}>={employee:{table:"employees",module:"employees",statusColumn:"employment_status"},department:{table:"departments",module:"departments",statusColumn:"status"},job_title:{table:"job_titles",module:"job_titles",statusColumn:"status"},holiday:{table:"holidays",module:"leave_management",statusColumn:"status"}};
      const target=map[entity]; if(!target) throw new Response("Unsupported entity",{status:400});
      await authorize(d1,user,target.module,"delete");
      await d1.prepare(`UPDATE ${target.table} SET ${target.statusColumn}='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
      await audit(d1,request,user,"archive",target.module,entity,String(id));
      return Response.json({ok:true});
    }
    if(action==="save_salary_structure") {
      await authorize(d1,user,"payroll","edit_draft");
      const employeeId=Number(payload.employeeId);
      if(!employeeId) throw new Response("Employee is required",{status:400});
      const employee=await d1.prepare("SELECT id,country FROM employees WHERE id=? AND employment_status!='deleted'").bind(employeeId).first<{id:number;country:string}>();
      if(!employee) throw new Response("Employee not found",{status:404});
      const basicSalary=Number(payload.basicSalary);
      if(!(basicSalary>0)) throw new Response("Basic salary must be greater than zero",{status:400});
      const effectiveFrom=required(payload.effectiveFrom,"Effective from date");
      const country=clean(payload.country)||employee.country;
      const currency=clean(payload.currency)||(country==="Egypt"?"EGP":"SAR");
      const allowances=(Array.isArray(payload.allowances)?payload.allowances as Json[]:[]).map(a=>{
        const type=required(a.type,"Allowance type");
        const hasAmount=a.amount!==undefined&&a.amount!==null&&a.amount!=="";
        const hasPercentage=a.percentage!==undefined&&a.percentage!==null&&a.percentage!=="";
        if(hasAmount===hasPercentage) throw new Response("Each allowance needs exactly one of a fixed amount or a percentage",{status:400});
        return {type,amount:hasAmount?Number(a.amount):null,percentage:hasPercentage?Number(a.percentage):null};
      });
      const openStructure=await d1.prepare("SELECT id FROM salary_structures WHERE employee_id=? AND effective_to IS NULL").bind(employeeId).first<{id:number}>();
      if(openStructure) {
        const closeDate=new Date(`${effectiveFrom}T00:00:00`); closeDate.setDate(closeDate.getDate()-1);
        await d1.prepare("UPDATE salary_structures SET effective_to=? WHERE id=?").bind(closeDate.toISOString().slice(0,10),openStructure.id).run();
      }
      const inserted=await d1.prepare("INSERT INTO salary_structures (employee_id,basic_salary,country,currency,effective_from,effective_to,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) RETURNING id").bind(employeeId,basicSalary,country,currency,effectiveFrom,clean(payload.effectiveTo)||null).first<{id:number}>();
      for(const allowance of allowances) await d1.prepare("INSERT INTO salary_allowances (salary_structure_id,type,amount,percentage) VALUES (?,?,?,?)").bind(inserted!.id,allowance.type,allowance.amount,allowance.percentage).run();
      await audit(d1,request,user,"create","payroll","salary_structure",String(inserted!.id),null,{employeeId,basicSalary,effectiveFrom,allowanceCount:allowances.length});
      return Response.json({ok:true,id:inserted!.id},{status:201});
    }
    if(action==="save_loan") {
      await authorize(d1,user,"payroll","edit_draft");
      const employeeId=Number(payload.employeeId);
      if(!employeeId) throw new Response("Employee is required",{status:400});
      const employee=await d1.prepare("SELECT id FROM employees WHERE id=? AND employment_status!='deleted'").bind(employeeId).first<{id:number}>();
      if(!employee) throw new Response("Employee not found",{status:404});
      const totalAmount=Number(payload.totalAmount), monthlyInstallment=Number(payload.monthlyInstallment);
      if(!(totalAmount>0)) throw new Response("Total amount must be greater than zero",{status:400});
      if(!(monthlyInstallment>0)) throw new Response("Monthly installment must be greater than zero",{status:400});
      const issuedAt=required(payload.issuedAt,"Issue date");
      const result=await d1.prepare("INSERT INTO loans_advances (employee_id,total_amount,remaining_amount,monthly_installment,status,issued_at,created_at) VALUES (?,?,?,?,'active',?,CURRENT_TIMESTAMP) RETURNING id").bind(employeeId,totalAmount,totalAmount,monthlyInstallment,issuedAt).first<{id:number}>();
      await audit(d1,request,user,"create","payroll","loan",String(result!.id),null,{employeeId,totalAmount,monthlyInstallment});
      return Response.json({ok:true,id:result!.id},{status:201});
    }
    if(action==="save_tax_bracket") {
      await authorize(d1,user,"payroll","edit_draft");
      const country=required(payload.country,"Country");
      const minAmount=Number(payload.minAmount);
      const maxAmountRaw=payload.maxAmount;
      const maxAmount=maxAmountRaw===""||maxAmountRaw===null||maxAmountRaw===undefined?null:Number(maxAmountRaw);
      const rate=Number(payload.rate);
      if(!(rate>=0)) throw new Response("Rate must be zero or greater",{status:400});
      if(maxAmount!==null&&maxAmount<=minAmount) throw new Response("Maximum amount must be greater than minimum amount",{status:400});
      const effectiveFrom=required(payload.effectiveFrom,"Effective from date");
      const bracketId=Number(payload.taxBracketId)||null;
      if(bracketId) {
        const before=await d1.prepare("SELECT * FROM tax_brackets WHERE id=?").bind(bracketId).first<Row>();
        if(!before) throw new Response("Tax bracket not found",{status:404});
        await d1.prepare("UPDATE tax_brackets SET country=?,min_amount=?,max_amount=?,rate=?,effective_from=? WHERE id=?").bind(country,minAmount,maxAmount,rate,effectiveFrom,bracketId).run();
        await audit(d1,request,user,"update","payroll","tax_bracket",String(bracketId),before,{country,minAmount,maxAmount,rate,effectiveFrom});
        return Response.json({ok:true,id:bracketId});
      }
      const result=await d1.prepare("INSERT INTO tax_brackets (country,min_amount,max_amount,rate,effective_from) VALUES (?,?,?,?,?) RETURNING id").bind(country,minAmount,maxAmount,rate,effectiveFrom).first<{id:number}>();
      await audit(d1,request,user,"create","payroll","tax_bracket",String(result!.id),null,{country,minAmount,maxAmount,rate,effectiveFrom});
      return Response.json({ok:true,id:result!.id},{status:201});
    }
    if(action==="save_insurance_rate") {
      await authorize(d1,user,"payroll","edit_draft");
      const country=required(payload.country,"Country");
      const employeeRate=Number(payload.employeeRate), employerRate=Number(payload.employerRate);
      if(!(employeeRate>=0)||!(employerRate>=0)) throw new Response("Rates must be zero or greater",{status:400});
      const effectiveFrom=required(payload.effectiveFrom,"Effective from date");
      const rateId=Number(payload.insuranceRateId)||null;
      if(rateId) {
        const before=await d1.prepare("SELECT * FROM insurance_rates WHERE id=?").bind(rateId).first<Row>();
        if(!before) throw new Response("Insurance rate not found",{status:404});
        await d1.prepare("UPDATE insurance_rates SET country=?,employee_rate=?,employer_rate=?,effective_from=? WHERE id=?").bind(country,employeeRate,employerRate,effectiveFrom,rateId).run();
        await audit(d1,request,user,"update","payroll","insurance_rate",String(rateId),before,{country,employeeRate,employerRate,effectiveFrom});
        return Response.json({ok:true,id:rateId});
      }
      const result=await d1.prepare("INSERT INTO insurance_rates (country,employee_rate,employer_rate,effective_from) VALUES (?,?,?,?) RETURNING id").bind(country,employeeRate,employerRate,effectiveFrom).first<{id:number}>();
      await audit(d1,request,user,"create","payroll","insurance_rate",String(result!.id),null,{country,employeeRate,employerRate,effectiveFrom});
      return Response.json({ok:true,id:result!.id},{status:201});
    }
    if(action==="create_payroll_run") {
      await authorize(d1,user,"payroll","create_run");
      const month=Number(payload.month), year=Number(payload.year), country=required(payload.country,"Country");
      if(!Number.isInteger(month)||month<1||month>12) throw new Response("Month must be between 1 and 12",{status:400});
      if(!Number.isInteger(year)||year<2000||year>2100) throw new Response("Year is invalid",{status:400});
      const existing=await d1.prepare("SELECT id FROM payroll_runs WHERE month=? AND year=? AND country=?").bind(month,year,country).first<{id:number}>();
      if(existing) throw new Response("A payroll run already exists for this month, year and country",{status:409});
      const result=await d1.prepare("INSERT INTO payroll_runs (month,year,country,status,created_at) VALUES (?,?,?,'draft',CURRENT_TIMESTAMP) RETURNING id").bind(month,year,country).first<{id:number}>();
      await audit(d1,request,user,"create","payroll","payroll_run",String(result!.id),null,{month,year,country,status:"draft"});
      return Response.json({ok:true,id:result!.id},{status:201});
    }
    if(action==="calculate_payroll_run") {
      await authorize(d1,user,"payroll","edit_draft");
      const payrollRunId=Number(payload.payrollRunId);
      const run=await d1.prepare("SELECT * FROM payroll_runs WHERE id=?").bind(payrollRunId).first<Row>();
      if(!run) throw new Response("Payroll run not found",{status:404});
      if(run.status!=="draft") throw new Response("Only draft runs can be calculated",{status:400});
      const outcome=await calculatePayrollRun(d1,{id:payrollRunId,month:Number(run.month),year:Number(run.year),country:String(run.country)});
      await audit(d1,request,user,"calculate","payroll","payroll_run",String(payrollRunId),null,{itemCount:outcome.itemCount,skipped:outcome.skipped});
      return Response.json({ok:true,...outcome});
    }
    if(action==="submit_payroll_run") {
      await authorize(d1,user,"payroll","edit_draft");
      const payrollRunId=Number(payload.payrollRunId);
      const run=await d1.prepare("SELECT * FROM payroll_runs WHERE id=?").bind(payrollRunId).first<Row>();
      if(!run) throw new Response("Payroll run not found",{status:404});
      if(run.status!=="draft") throw new Response("Only draft runs can be submitted for approval",{status:400});
      const itemCount=await d1.prepare("SELECT COUNT(*)::int AS count FROM payroll_items WHERE payroll_run_id=?").bind(payrollRunId).first<{count:number}>();
      if(!itemCount?.count) throw new Response("Calculate the payroll run before submitting it",{status:400});
      await d1.prepare("UPDATE payroll_runs SET status='pending_hr' WHERE id=?").bind(payrollRunId).run();
      await audit(d1,request,user,"submit","payroll","payroll_run",String(payrollRunId),{status:run.status},{status:"pending_hr"});
      return Response.json({ok:true,status:"pending_hr"});
    }
    if(action==="approve_payroll_run") {
      await authorize(d1,user,"payroll","approve");
      const payrollRunId=Number(payload.payrollRunId);
      const run=await d1.prepare("SELECT * FROM payroll_runs WHERE id=?").bind(payrollRunId).first<Row>();
      if(!run) throw new Response("Payroll run not found",{status:404});
      if(run.status!=="pending_hr") throw new Response("Only runs pending HR approval can be approved",{status:400});
      const items=(await d1.prepare("SELECT DISTINCT employee_id FROM payroll_items WHERE payroll_run_id=?").bind(payrollRunId).all()).results as {employee_id:number}[];
      const loanUpdates:{id:number;remaining:number;status:string}[]=[];
      for(const item of items) {
        const loans=(await d1.prepare("SELECT id,remaining_amount,monthly_installment FROM loans_advances WHERE employee_id=? AND status='active' ORDER BY issued_at ASC").bind(item.employee_id).all()).results as {id:number;remaining_amount:number;monthly_installment:number}[];
        for(const loan of loans) {
          const remaining=Number(loan.remaining_amount)||0;
          if(remaining<=0) continue;
          const applied=Math.min(Number(loan.monthly_installment)||0,remaining);
          if(applied<=0) continue;
          const newRemaining=round2(remaining-applied);
          loanUpdates.push({id:loan.id,remaining:newRemaining,status:newRemaining<=0?"paid_off":"active"});
        }
      }
      await d1.batch([
        d1.prepare("UPDATE payroll_runs SET status='approved',approved_by=?,approved_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id,payrollRunId),
        ...loanUpdates.map(update=>d1.prepare("UPDATE loans_advances SET remaining_amount=?,status=? WHERE id=?").bind(update.remaining,update.status,update.id)),
      ]);
      await audit(d1,request,user,"approve","payroll","payroll_run",String(payrollRunId),{status:run.status},{status:"approved",approvedBy:user.id,loanUpdates});
      return Response.json({ok:true,status:"approved"});
    }
    if(action==="lock_payroll_run") {
      await authorize(d1,user,"payroll","lock");
      const payrollRunId=Number(payload.payrollRunId);
      const run=await d1.prepare("SELECT * FROM payroll_runs WHERE id=?").bind(payrollRunId).first<Row>();
      if(!run) throw new Response("Payroll run not found",{status:404});
      if(run.status!=="approved") throw new Response("Only approved runs can be locked",{status:400});
      await d1.prepare("UPDATE payroll_runs SET status='locked',locked_at=CURRENT_TIMESTAMP WHERE id=?").bind(payrollRunId).run();
      await audit(d1,request,user,"lock","payroll","payroll_run",String(payrollRunId),{status:run.status},{status:"locked"});
      return Response.json({ok:true,status:"locked"});
    }
    if(action==="reopen_payroll_run") {
      await authorize(d1,user,"payroll","reopen");
      const payrollRunId=Number(payload.payrollRunId);
      const reason=required(payload.reason,"Reopen reason");
      const run=await d1.prepare("SELECT * FROM payroll_runs WHERE id=?").bind(payrollRunId).first<Row>();
      if(!run) throw new Response("Payroll run not found",{status:404});
      if(run.status!=="locked") throw new Response("Only locked runs can be reopened",{status:400});
      await d1.prepare("UPDATE payroll_runs SET status='draft',approved_by=NULL,approved_at=NULL,locked_at=NULL WHERE id=?").bind(payrollRunId).run();
      await audit(d1,request,user,"reopen","payroll","payroll_run",String(payrollRunId),{status:run.status,approvedBy:run.approved_by,approvedAt:run.approved_at,lockedAt:run.locked_at},{status:"draft",reason});
      return Response.json({ok:true,status:"draft"});
    }
    if(action==="export_bank_file"||action==="export_accounting_summary") {
      await authorize(d1,user,"payroll","approve");
      const payrollRunId=Number(payload.payrollRunId);
      const run=await d1.prepare("SELECT * FROM payroll_runs WHERE id=?").bind(payrollRunId).first<Row>();
      if(!run) throw new Response("Payroll run not found",{status:404});
      if(!["approved","locked"].includes(String(run.status))) throw new Response("Only approved or locked runs can be exported",{status:400});
      if(action==="export_bank_file") {
        const rows=(await d1.prepare("SELECT e.employee_code,e.name_en,e.name_ar,e.bank_name,e.bank_account_number,e.bank_iban,pi.net_salary FROM payroll_items pi JOIN employees e ON e.id=pi.employee_id WHERE pi.payroll_run_id=? ORDER BY e.name_en").bind(payrollRunId).all()).results;
        const settingRow=await d1.prepare("SELECT value_json FROM system_settings WHERE setting_key='payroll_bank_export'").first<{value_json:string}>();
        let layout:{columns?:{field:string;header:string}[]}={};
        try{layout=JSON.parse(settingRow?.value_json||"{}");}catch{layout={};}
        const columns=Array.isArray(layout.columns)&&layout.columns.length?layout.columns:[{field:"employee_code",header:"Employee code"},{field:"name_en",header:"Name"},{field:"bank_name",header:"Bank"},{field:"bank_account_number",header:"Account number"},{field:"bank_iban",header:"IBAN"},{field:"net_salary",header:"Net salary"}];
        await audit(d1,request,user,"export","payroll","payroll_run",String(payrollRunId),null,{type:"bank_file",rowCount:rows.length});
        return Response.json({ok:true,columns,rows});
      }
      const totals=await d1.prepare("SELECT COUNT(*)::int AS employee_count,COALESCE(SUM(basic_salary),0) AS basic_salary,COALESCE(SUM(total_allowances),0) AS total_allowances,COALESCE(SUM(overtime_amount),0) AS overtime_amount,COALESCE(SUM(absence_deduction),0) AS absence_deduction,COALESCE(SUM(unpaid_leave_deduction),0) AS unpaid_leave_deduction,COALESCE(SUM(loan_deduction),0) AS loan_deduction,COALESCE(SUM(insurance_deduction),0) AS insurance_deduction,COALESCE(SUM(tax_deduction),0) AS tax_deduction,COALESCE(SUM(net_salary),0) AS net_salary FROM payroll_items WHERE payroll_run_id=?").bind(payrollRunId).first<Row>();
      const byType=(await d1.prepare("SELECT sa.type,COALESCE(SUM(COALESCE(sa.amount,(COALESCE(sa.percentage,0)/100.0)*ss.basic_salary)),0) AS amount FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payroll_run_id JOIN salary_structures ss ON ss.employee_id=pi.employee_id AND ss.effective_from::date<=(make_date(pr.year,pr.month,1)+INTERVAL '1 month'-INTERVAL '1 day')::date AND (ss.effective_to IS NULL OR ss.effective_to::date>=make_date(pr.year,pr.month,1)) JOIN salary_allowances sa ON sa.salary_structure_id=ss.id WHERE pi.payroll_run_id=? GROUP BY sa.type ORDER BY sa.type").bind(payrollRunId).all()).results;
      await audit(d1,request,user,"export","payroll","payroll_run",String(payrollRunId),null,{type:"accounting_summary"});
      return Response.json({ok:true,totals,allowancesByType:byType});
    }
    throw new Response("Unsupported action",{status:400});
  } catch(error) { return apiError(error); }
  finally { await d1.close(); }
}

async function apiError(error: unknown) {
  // Validation failures are thrown as plain-text Responses; the client reads JSON,
  // so re-wrap them or every message degrades to a generic "Request failed (4xx)".
  if(error instanceof Response) {
    const message=await error.text().catch(()=>"");
    return Response.json({error:message||error.statusText||"Request failed"},{status:error.status});
  }
  const message=error instanceof Error?error.message:"Unexpected server error";
  console.error(error);
  return Response.json({error:message},{status:500});
}
