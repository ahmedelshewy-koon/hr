import type { TransactionDatabase } from '../../db/postgres';
import { hashPassword } from '../password-hash.ts';
import type { Row } from '../ui-types';
import { previewOrganizationEntity, saveOrganizationEntity } from './catalog-service.ts';

const current = ['active', 'probation', 'notice_period'];
const id = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

/** Save the simple company + branch assignment and provision the selected employee for HR routing. */
export async function saveHrAssignment(db: TransactionDatabase, input: Row, actorId: number) {
  const companyId = id(input.companyId), branchId = id(input.branchId), employeeId = id(input.employeeId);
  // Who the chosen HR sees: only the employees it is responsible for (a branch HR, the default here) or everyone.
  const hrDataScope = input.hrDataScope === 'all' ? 'all' : 'assigned';
  if (!companyId || !branchId || !employeeId) throw new Response('اختر الشركة والفرع والموظف المسؤول', { status: 400 });
  await db.prepare('SELECT pg_advisory_xact_lock(78231)').run();
  const employee = await db.prepare('SELECT id,work_email,employment_status FROM employees WHERE id=? AND employment_status!=\'deleted\'').bind(employeeId).first<Row>();
  if (!employee) throw new Response('الموظف غير موجود', { status: 404 });
  if (!current.includes(String(employee.employment_status))) throw new Response('اختر موظفًا حاليًا', { status: 400 });
  const role = await db.prepare("SELECT id FROM roles WHERE name='HR Manager'").first<{ id: number }>();
  if (!role) throw new Response('دور مدير الموارد البشرية غير موجود', { status: 409 });
  let user = await db.prepare('SELECT u.id,u.role_id,u.status,u.hr_data_scope,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.employee_id=?').bind(employeeId).first<Row>();
  let temporaryPassword: string | null = null;
  if (!user) {
    const email = String(employee.work_email ?? '').trim().toLowerCase();
    if (!email) throw new Response('أضف البريد الإلكتروني الوظيفي للموظف أولًا لإنشاء حسابه', { status: 400 });
    if (await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').bind(email).first()) throw new Response('البريد الإلكتروني مستخدم في حساب آخر', { status: 409 });
    temporaryPassword = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const passwordHash = await hashPassword(temporaryPassword);
    const created = await db.prepare("INSERT INTO users(email,employee_id,role_id,status,password_hash,must_change_password,session_version,failed_login_attempts,hr_data_scope,created_at,updated_at) VALUES (?,?,?,'active',?,1,1,0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(email, employeeId, role.id, passwordHash, hrDataScope).first<{ id: number }>();
    user = { id: created!.id, role_id: role.id, role_name: 'HR Manager', status: 'active', hr_data_scope: hrDataScope };
    await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,new_value) VALUES (?,'create','users','user',?,?)").bind(actorId, String(user.id), JSON.stringify({ employeeId, email, roleName: 'HR Manager', mustChangePassword: true })).run();
  } else if (!['Super Admin', 'HR Manager'].includes(String(user.role_name)) || user.status !== 'active') {
    const before = { role_id: user.role_id, role_name: user.role_name, status: user.status };
    const keepAdmin = user.role_name === 'Super Admin';
    await db.prepare("UPDATE users SET role_id=?,status='active',session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(keepAdmin ? user.role_id : role.id, user.id).run();
    await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value) VALUES (?,'update','users','user',?, ?, ?)").bind(actorId, String(user.id), JSON.stringify(before), JSON.stringify({ role_id: keepAdmin ? user.role_id : role.id, role_name: keepAdmin ? 'Super Admin' : 'HR Manager', status: 'active' })).run();
  }
  // Super Admin always sees everyone; for an HR account the visibility chosen here applies from its next sign-in.
  if (user.role_name !== 'Super Admin' && user.hr_data_scope !== hrDataScope) {
    await db.prepare("UPDATE users SET hr_data_scope=?,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(hrDataScope, user.id).run();
    await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value) VALUES (?,'update','users','user',?,?,?)").bind(actorId, String(user.id), JSON.stringify({ hr_data_scope: user.hr_data_scope ?? 'all' }), JSON.stringify({ hr_data_scope: hrDataScope })).run();
  }
  await db.prepare("INSERT INTO hr_responsibles(user_id,status) VALUES (?,'active') ON CONFLICT(user_id) DO UPDATE SET status='active',updated_at=CURRENT_TIMESTAMP").bind(user.id).run();
  const existing = await db.prepare("SELECT id FROM hr_responsibility_rules WHERE company_id=? AND branch_id=? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,id DESC LIMIT 1").bind(companyId, branchId).first<{ id: number }>();
  const record = { id: existing?.id, rule_type: 'company_branch', company_id: companyId, branch_id: branchId, hr_user_id: user.id, status: 'active' };
  const preview = await previewOrganizationEntity(db, 'hrRules', record);
  if (!preview.ok) throw new Response(preview.blocking.map(issue => issue.message_ar).join(' • ') || 'تعذر حفظ مسؤول الموارد البشرية', { status: 400 });
  const saved = await saveOrganizationEntity(db, 'hrRules', { ...record, confirmImpact: preview.confirmationToken }, actorId);
  // The company + branch choice becomes every employee's HR there: per-employee overrides are cleared so each profile
  // resolves to this rule. The chosen HR's own record keeps its HR, since nobody approves their own requests.
  const cleared = ((await db.prepare("UPDATE employees SET hr_user_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND branch_id=? AND id<>? AND hr_user_id IS NOT NULL AND employment_status<>'deleted' RETURNING id,employee_code")
    .bind(companyId, branchId, employeeId).all<Row>()).results ?? []);
  if (cleared.length) await db.prepare("INSERT INTO audit_logs(user_id,action,module,record_type,record_id,new_value) VALUES (?,'update','employees','hr_assignment',?,?)")
    .bind(actorId, `${companyId}:${branchId}`, JSON.stringify({ hrUserId: user.id, clearedEmployeeOverrides: cleared.map(row => Number(row.id)) })).run();
  const covered = await db.prepare("SELECT count(*)::int AS count FROM employees WHERE company_id=? AND branch_id=? AND id<>? AND employment_status<>'deleted' AND hr_user_id IS NULL").bind(companyId, branchId, employeeId).first<{ count: number }>();
  return { ...saved, employeeId, userId: user.id, temporaryPassword, hrDataScope: user.role_name === 'Super Admin' ? 'all' : hrDataScope, overridesCleared: cleared.length, employeesCovered: Number(covered?.count ?? 0) };
}
