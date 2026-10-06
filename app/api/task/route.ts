import { createDatabase } from '../../../db/postgres';
import { requireActor } from '../api-security';
import { EMPLOYEE_MANAGER_SQL } from '../../employees/hr-assignment';

// Work directory only: never expose payroll, personal contacts or HR records.
// Authentication and reporting relationships remain owned by HR.
export async function GET(request: Request) {
  const db = createDatabase();
  const headers = { 'cache-control': 'no-store' };
  try {
    const actor = await requireActor(request, db);
    const account = await db.prepare('SELECT must_change_password FROM users WHERE id=?').bind(actor.id).first<{must_change_password:number}>();
    if (account?.must_change_password) return Response.json({error:'Open HR and change your password before signing in to TASK.'},{status:403,headers});
    const rows = (await db.prepare(`SELECT u.id AS "userId", e.id AS "employeeId",
      COALESCE(NULLIF(e.name_en,''),e.name_ar,u.email) AS name, u.email,
      COALESCE(c.name_en,c.name,'') AS company, COALESCE(b.name_en,'') AS branch,
      COALESCE(d.name_en,'') AS department, COALESCE(j.name_en,'') AS "jobTitle",
      ${EMPLOYEE_MANAGER_SQL} AS "managerId"
      FROM users u JOIN employees e ON e.id=u.employee_id
      LEFT JOIN companies c ON c.id=e.company_id LEFT JOIN branches b ON b.id=e.branch_id
      LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id
      WHERE u.status='active' AND e.employment_status IN ('active','probation','notice_period')
      ORDER BY e.id,u.id`).all()).results;
    const employees = rows.map(row => ({...row,userId:String(row.userId),employeeId:String(row.employeeId),managerId:row.managerId == null ? null : String(row.managerId)}));
    const employee = employees.find(row => row.userId===String(actor.id));
    // A system administrator can be an account without an employee record.
    if (!employee && (actor.employeeId !== null || actor.roleName!=='Super Admin')) return Response.json({error:'An active HR employee account is required.'},{status:403,headers});
    const me = {...(employee || {userId:String(actor.id),employeeId:`account:${actor.id}`,name:actor.email,email:actor.email,company:'',branch:'',department:'',jobTitle:'System administrator',managerId:null}), isHrAdmin:actor.roleName==='Super Admin'};
    return Response.json({me, employees, directReports:employees.filter(row => row.managerId===me.employeeId && row.userId!==me.userId)},{headers});
  } catch (error) {
    if (error instanceof Response) return new Response(error.body,{status:error.status,headers});
    return Response.json({error:'HR directory is temporarily unavailable.'},{status:503,headers});
  } finally { await db.close(); }
}
