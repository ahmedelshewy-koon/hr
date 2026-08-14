import { getChatGPTUser } from "../../chatgpt-auth";
import { createDatabase, type PostgresDatabase } from "../../../db/postgres";

type Json = Record<string, unknown>;
type AppUser = { id: number; email: string; role_id: number; role_name: string; employee_id: number | null };

const SUPER_ADMIN_MODULES = ["dashboard","employee_portal","employee_requests","request_approvals","employees","employee_salaries","job_titles","departments","leave_management","attendance","attendance_adjustments","organization_chart","users","permissions","system_settings","reports"];
const ACTIONS = ["view","create","edit","delete","approve","export","manage_settings"];

async function ensureSeed(d1: PostgresDatabase) {
  const now = new Date().toISOString();
  const roleNames = ["Super Admin","Admin","HR Manager","HR","Direct Manager","Employee"];
  for (const name of roleNames) await d1.prepare("INSERT OR IGNORE INTO roles (name, description, is_system, created_at, updated_at) VALUES (?, ?, 1, ?, ?)").bind(name, `${name} system role`, now, now).run();
  const superRole = await d1.prepare("SELECT id FROM roles WHERE name = 'Super Admin'").first<{ id: number }>();
  if (superRole) for (const module of SUPER_ADMIN_MODULES) for (const action of ACTIONS) await d1.prepare("INSERT OR IGNORE INTO permissions (role_id, module, action, allowed) VALUES (?, ?, ?, 1)").bind(superRole.id, module, action).run();

  const leaveTypes = [["Annual leave","إجازة سنوية",1,0],["Sick leave","إجازة مرضية",1,1],["Unpaid leave","إجازة بدون راتب",0,0]];
  for (const l of leaveTypes) await d1.prepare("INSERT INTO leave_types (name_en,name_ar,paid,attachment_required,manager_approval,hr_approval,status,created_at,updated_at) SELECT ?,?,?,?,1,1,'active',?,? WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE name_en=?)").bind(...l, now, now, l[0]).run();
}

async function currentUser(request: Request, d1: PostgresDatabase): Promise<AppUser> {
  const auth = await getChatGPTUser();
  const url = new URL(request.url);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!auth && !local) throw new Response("Authentication required", { status: 401 });
  const authId = auth?.userId ?? "local-postgres-owner";
  const email = auth?.email ?? "local.owner@koon.local";
  let user = await d1.prepare("SELECT u.id,u.email,u.role_id,u.employee_id,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.auth_user_id=? OR lower(u.email)=lower(?)").bind(authId, email).first<AppUser>();
  if (!user) {
    const role = await d1.prepare("SELECT id FROM roles WHERE name='Super Admin'").first<{ id: number }>();
    if (!role) throw new Error("Super Admin role is unavailable");
    const inserted = await d1.prepare("INSERT INTO users (auth_user_id,email,role_id,status,last_login_at,created_at,updated_at) VALUES (?,?,?,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(authId,email,role.id).first<{id:number}>();
    user = { id: inserted!.id, email, role_id: role.id, role_name: "Super Admin", employee_id: null };
  } else {
    if (user.role_name !== "Super Admin") {
      const status = await d1.prepare("SELECT status FROM users WHERE id=?").bind(user.id).first<{status:string}>();
      if (status?.status !== "active") throw new Response("Account disabled", { status: 403 });
    }
    await d1.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP, auth_user_id=? WHERE id=?").bind(authId,user.id).run();
  }
  return user;
}

async function authorize(d1: PostgresDatabase, user: AppUser, module: string, action: string) {
  if (user.role_name === "Super Admin") return;
  const permission = await d1.prepare("SELECT allowed FROM permissions WHERE role_id=? AND module=? AND action=?").bind(user.role_id,module,action).first<{allowed:number}>();
  if (!permission?.allowed) throw new Response("Permission denied", { status: 403 });
}

async function audit(d1: PostgresDatabase, request: Request, user: AppUser, action: string, module: string, recordType?: string, recordId?: string, previous?: unknown, next?: unknown) {
  await d1.prepare("INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,ip_address,created_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(user.id, action, module, recordType ?? null, recordId ?? null, previous ? JSON.stringify(previous) : null, next ? JSON.stringify(next) : null, request.headers.get("cf-connecting-ip")).run();
}

function clean(value: unknown, max = 500) { return typeof value === "string" ? value.trim().slice(0,max) : ""; }
function required(value: unknown, name: string) { const v=clean(value); if(!v) throw new Response(`${name} is required`,{status:400}); return v; }

export async function GET(request: Request) {
  const d1 = createDatabase();
  try {
    await ensureSeed(d1);
    const user = await currentUser(request,d1);
    await authorize(d1,user,"dashboard","view");
    const [employeeRows,departmentRows,jobRows,requestRows,attendanceRows,holidayRows,roleRows,userRows,auditRows] = await Promise.all([
      d1.prepare("SELECT e.*,d.name_en AS department_name,j.name_en AS job_title_name,m.name_en AS manager_name FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id LEFT JOIN employees m ON m.id=e.manager_id WHERE e.employment_status!='deleted' ORDER BY e.id DESC LIMIT 250").all(),
      d1.prepare("SELECT d.*,COUNT(e.id) AS employee_count FROM departments d LEFT JOIN employees e ON e.department_id=d.id AND e.employment_status!='deleted' GROUP BY d.id ORDER BY d.name_en").all(),
      d1.prepare("SELECT j.*,d.name_en AS department_name,COUNT(e.id) AS employee_count FROM job_titles j LEFT JOIN departments d ON d.id=j.department_id LEFT JOIN employees e ON e.job_title_id=j.id GROUP BY j.id,d.name_en ORDER BY j.name_en").all(),
      d1.prepare("SELECT q.*,e.name_en AS employee_name,e.name_ar AS employee_name_ar,d.name_en AS department_name FROM requests q JOIN employees e ON e.id=q.employee_id LEFT JOIN departments d ON d.id=e.department_id ORDER BY q.id DESC LIMIT 250").all(),
      d1.prepare("SELECT a.*,e.name_en AS employee_name,e.name_ar AS employee_name_ar,d.name_en AS department_name FROM daily_attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments d ON d.id=e.department_id ORDER BY a.work_date DESC,a.id DESC LIMIT 250").all(),
      d1.prepare("SELECT * FROM holidays WHERE status!='deleted' ORDER BY holiday_date").all(),
      d1.prepare("SELECT r.*,COUNT(u.id) AS user_count FROM roles r LEFT JOIN users u ON u.role_id=r.id GROUP BY r.id ORDER BY r.id").all(),
      d1.prepare("SELECT u.id,u.email,u.employee_id,u.status,u.last_login_at,u.role_id,r.name AS role_name,e.name_en AS employee_name,d.name_en AS department_name FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id ORDER BY u.id").all(),
      d1.prepare("SELECT a.*,u.email AS user_email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 50").all(),
    ]);
    const permissions = await d1.prepare("SELECT role_id,module,action,allowed FROM permissions ORDER BY role_id,module,action").all();
    return Response.json({ currentUser:user, employees:employeeRows.results, departments:departmentRows.results, jobTitles:jobRows.results, requests:requestRows.results, attendance:attendanceRows.results, holidays:holidayRows.results, roles:roleRows.results, users:userRows.results, permissions:permissions.results, audit:auditRows.results });
  } catch(error) { return apiError(error); }
  finally { await d1.close(); }
}

export async function POST(request: Request) {
  const d1 = createDatabase();
  try {
    await ensureSeed(d1);
    const user=await currentUser(request,d1);
    const payload=await request.json() as Json;
    const action=required(payload.action,"action");
    if(action==="create_employee") {
      await authorize(d1,user,"employees","create");
      const nameEn=required(payload.nameEn,"English name"), nameAr=required(payload.nameAr,"Arabic name"), email=required(payload.workEmail,"Work email").toLowerCase();
      const max=await d1.prepare("SELECT COALESCE(MAX(id),0)+1 AS next FROM employees").first<{next:number}>();
      const code=`EMP-${String(max?.next??1).padStart(5,"0")}`;
      const result=await d1.prepare("INSERT INTO employees (employee_code,name_en,name_ar,work_email,fingerprint_code,personal_phone,work_phone,nationality,gender,birth_date,identification_number,address,department_id,job_title_id,manager_id,start_date,end_date,employment_status,salary,salary_currency,country,work_location,employment_type,schedule_type,work_days,check_in_time,check_out_time,grace_minutes,required_daily_minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id")
        .bind(code,nameEn,nameAr,email,clean(payload.fingerprintCode)||null,clean(payload.personalPhone)||null,clean(payload.workPhone)||null,clean(payload.nationality)||null,clean(payload.gender)||null,clean(payload.birthDate)||null,clean(payload.identificationNumber)||null,clean(payload.address,1000)||null,Number(payload.departmentId)||null,Number(payload.jobTitleId)||null,Number(payload.managerId)||null,required(payload.startDate,"Start date"),clean(payload.endDate)||null,clean(payload.employmentStatus)||"active",Number(payload.salary)||null,clean(payload.salaryCurrency)||"SAR",required(payload.country,"Country"),clean(payload.workLocation)||null,clean(payload.employmentType)||"full_time",clean(payload.scheduleType)||"fixed",clean(payload.workDays)||"0,1,2,3,4",clean(payload.checkInTime)||"09:00",clean(payload.checkOutTime)||"17:00",Number(payload.graceMinutes)||15,Number(payload.requiredDailyMinutes)||480).first<{id:number}>();
      const employeeRole=await d1.prepare("SELECT id FROM roles WHERE name='Employee'").first<{id:number}>();
      if(employeeRole) await d1.prepare("INSERT INTO users (email,employee_id,role_id,status,must_change_password,created_at,updated_at) VALUES (?,?,?,'active',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").bind(email,result!.id,employeeRole.id).run();
      await audit(d1,request,user,"create","employees","employee",String(result!.id),null,{code,nameEn,email});
      return Response.json({ok:true,id:result!.id,employeeCode:code},{status:201});
    }
    if(action==="create_request") {
      await authorize(d1,user,"employee_requests","create");
      let employeeId=Number(payload.employeeId)||user.employee_id;
      if(!employeeId) employeeId=(await d1.prepare("SELECT id FROM employees ORDER BY id LIMIT 1").first<{id:number}>())?.id;
      if(!employeeId) throw new Response("Employee profile required",{status:400});
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
      if(decision==="reject" && !clean(payload.reason)) throw new Response("Rejection reason is required",{status:400});
      let status:string,currentStage:string;
      if(decision==="approve"&&before.current_stage==="manager"){status="pending_hr";currentStage="hr";} else if(decision==="approve"){status="hr_approved";currentStage="completed";} else {status=before.current_stage==="manager"?"manager_rejected":"hr_rejected";currentStage="completed";}
      await d1.batch([d1.prepare("UPDATE requests SET status=?,current_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status,currentStage,requestId),d1.prepare("INSERT INTO approvals (request_id,stage,actor_user_id,action,reason,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)").bind(requestId,String(before.current_stage),user.id,decision,clean(payload.reason)||null)]);
      await audit(d1,request,user,decision,"request_approvals","request",String(requestId),before,{status,currentStage});
      return Response.json({ok:true,status,currentStage});
    }
    if(action==="attendance_event") {
      await authorize(d1,user,"attendance","create");
      let employeeId=Number(payload.employeeId)||user.employee_id;
      if(!employeeId) employeeId=(await d1.prepare("SELECT id FROM employees ORDER BY id LIMIT 1").first<{id:number}>())?.id;
      if(!employeeId) throw new Response("Employee profile required",{status:400});
      const eventType=required(payload.eventType,"Event type");
      const last=await d1.prepare("SELECT event_type FROM attendance_logs WHERE employee_id=? ORDER BY event_at DESC LIMIT 1").bind(employeeId).first<{event_type:string}>();
      if(last?.event_type===eventType) throw new Response(`Duplicate ${eventType} is not allowed`,{status:409});
      const now=new Date().toISOString(), workDate=now.slice(0,10), time=now.slice(11,16);
      await d1.prepare("INSERT INTO attendance_logs (employee_id,event_at,event_type,source,device,location,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(employeeId,now,eventType,"remote","Web portal",clean(payload.location)||null,user.id).run();
      if(eventType==="check_in") await d1.prepare("INSERT INTO daily_attendance (employee_id,work_date,scheduled_in,scheduled_out,actual_in,attendance_type,status,created_at,updated_at) VALUES (?,?,'09:00','17:00',?,'remote','remote',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(employee_id,work_date) DO UPDATE SET actual_in=excluded.actual_in,attendance_type='remote',status='remote',updated_at=CURRENT_TIMESTAMP").bind(employeeId,workDate,time).run();
      else await d1.prepare("UPDATE daily_attendance SET actual_out=?,worked_minutes=GREATEST(0,CAST(EXTRACT(EPOCH FROM ((? || ' ' || ?)::timestamp - (? || ' ' || actual_in)::timestamp))/60 AS INTEGER)),updated_at=CURRENT_TIMESTAMP WHERE employee_id=? AND work_date=?").bind(time,workDate,time,workDate,employeeId,workDate).run();
      await audit(d1,request,user,eventType,"attendance","employee",String(employeeId),null,{now,source:"remote"});
      return Response.json({ok:true,eventAt:now});
    }
    if(action==="create_holiday") {
      await authorize(d1,user,"leave_management","create");
      const result=await d1.prepare("INSERT INTO holidays (name_en,name_ar,holiday_date,country,days,original_date,original_date_behavior,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id").bind(required(payload.nameEn,"English name"),required(payload.nameAr,"Arabic name"),required(payload.holidayDate,"Holiday date"),required(payload.country,"Country"),Number(payload.days)||1,clean(payload.originalDate)||null,clean(payload.originalDateBehavior)||"holiday",clean(payload.notes,1000)||null).first<{id:number}>();
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
    throw new Response("Unsupported action",{status:400});
  } catch(error) { return apiError(error); }
  finally { await d1.close(); }
}

function apiError(error: unknown) {
  if(error instanceof Response) return error;
  const message=error instanceof Error?error.message:"Unexpected server error";
  console.error(error);
  return Response.json({error:message},{status:500});
}
