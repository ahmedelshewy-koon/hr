import { enrichWorkflowRows } from '../../../approvals/workflow-service';
import { effectiveHrSql, requireEmployeeHr } from '../../../employees/hr-assignment';
import { pendingApproverColumns } from '../../../approvals/approval-chain-sql';
import { resolveEmployeeHrFromDb } from '../../../organization/hr-responsibility-service';
import { organizationReady } from '../../../organization/assignment-service';
import { assertEmployeeHr, assertEmployeeManager } from "../../../employees/hr-assignment";
import { MANAGED_DEPARTMENTS_CTE } from "../../../organization/department-scope";
import { ensureAuthSchema, requirePortalSession } from "../../../portal-auth";
import { createDatabase, type PostgresDatabase } from "../../../../db/postgres";
import { apiFailure, loadPermissions } from "../../api-security";
import { canViewEmployeeProfile, profileFieldPolicy } from "../../../employees/profile-access";
import { branchHrCanSee, isBranchScopedHr } from "../../../employees/hr-data-scope";
import { readJobHistory } from "../../../employees/job-history";
import { readProfileExtras } from "../../../employees/profile-extras";
import { employeeAcknowledgements } from "../../../decisions/decision-service";

type Viewer={id:number;role_id:number;role_name:string;employee_id:number|null;hr_data_scope?:string|null};
type Row=Record<string,unknown>;
async function canAccess(db:PostgresDatabase,user:Viewer,employeeId:number){
  const scopeActor={id:user.id,roleName:user.role_name,employeeId:user.employee_id,hrDataScope:user.hr_data_scope};
  if(isBranchScopedHr(scopeActor))return branchHrCanSee(db,scopeActor,employeeId);
  const managed=user.role_name==="Department Manager"&&Boolean(user.employee_id)&&Boolean(await db.prepare(`${MANAGED_DEPARTMENTS_CTE} SELECT e.id FROM employees e WHERE e.id=? AND e.department_id IN (SELECT id FROM managed)`).bind(user.employee_id,employeeId).first<Row>());
  return canViewEmployeeProfile({roleName:user.role_name,isSelf:Number(user.employee_id)===employeeId,isInManagedScope:managed});
}

export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  const db=createDatabase();
  try{
    await ensureAuthSchema(db);const session=await requirePortalSession(request,db),{id}=await context.params,employeeId=Number(id);if(!employeeId)throw new Response("Employee not found",{status:404});
    const user=await db.prepare("SELECT u.id,u.role_id,u.employee_id,u.hr_data_scope,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.status='active'").bind(session.userId).first<Viewer>();if(!user)throw new Response("Account disabled",{status:403});
    if(!(await canAccess(db,user,employeeId)))throw new Response("Employee is outside your access scope",{status:403});
    // One query for the whole permission grid: this handler asks up to fourteen questions.
    const perms=await loadPermissions(db,{roleId:user.role_id,roleName:user.role_name});
    const hrSql=await effectiveHrSql(db);
    const employee=await db.prepare(`SELECT e.company_id,e.hr_user_id,${hrSql} AS resolved_hr_user_id,co.name AS company_name,COALESCE(he.name_en,hu.email) AS hr_name,COALESCE(he.name_ar,he.name_en,hu.email) AS hr_name_ar,e.id,e.employee_code,e.name_en,e.name_ar,e.work_email,e.work_phone,e.department_id,e.job_title_id,e.manager_id,e.organizational_level,e.start_date,e.end_date,e.employment_status,e.country,e.work_location,e.employment_type,e.schedule_type,e.work_days,e.remote_days,e.check_in_time,e.check_out_time,e.grace_minutes,e.required_daily_minutes,e.fingerprint_required,e.avatar_url,e.created_at,e.updated_at,d.name_en AS department_name,d.name_ar AS department_name_ar,j.name_en AS job_title_name,j.name_ar AS job_title_name_ar,m.name_en AS manager_name,m.name_ar AS manager_name_ar FROM employees e LEFT JOIN companies co ON co.id=e.company_id LEFT JOIN users hu ON hu.id=${hrSql} LEFT JOIN employees he ON he.id=hu.employee_id LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN job_titles j ON j.id=e.job_title_id LEFT JOIN employees m ON m.id=e.manager_id WHERE e.id=? AND e.employment_status!='deleted'`).bind(employeeId).first<Row>();if(!employee)throw new Response("Employee not found",{status:404});
    if(await organizationReady(db))Object.assign(employee,await db.prepare("SELECT e.branch_id,e.section_id,e.team_id,e.position_id,e.grade_id,e.work_location_id,e.assignment_effective_date,b.name_en AS branch_name,b.name_ar AS branch_name_ar,s.name_en AS section_name,s.name_ar AS section_name_ar,t.name_en AS team_name,t.name_ar AS team_name_ar,p.name_en AS position_name,p.name_ar AS position_name_ar,g.name_en AS grade_name,g.name_ar AS grade_name_ar,w.name_en AS location_name,w.name_ar AS location_name_ar FROM employees e LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN departments s ON s.id=e.section_id LEFT JOIN departments t ON t.id=e.team_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN job_grades g ON g.id=e.grade_id LEFT JOIN work_locations w ON w.id=e.work_location_id WHERE e.id=?").bind(employeeId).first());
    // Derived with the shared resolver; employees.hr_user_id stays the explicit override only.
    const hrResolution=await resolveEmployeeHrFromDb(db,employeeId);
    employee.hr_source=hrResolution?.source??(employee.hr_user_id?'employee_override':'none');
    employee.hr_rule_id=hrResolution?.ruleId??null;
    employee.hr_reason=hrResolution?.reason??null;
    try{await requireEmployeeHr(db,employeeId);employee.hr_available=true;}catch(error){if(!(error instanceof Response))throw error;employee.hr_available=false;}
    if(employee.manager_id&&!await canAccess(db,user,Number(employee.manager_id))){employee.manager_name=null;employee.manager_name_ar=null;}
    let canViewRequests=Number(user.employee_id)===employeeId;
    // Viewing the requests is open to all HR in scope; acting on them (adding/cancelling leave) stays with the responsible manager/HR.
    let canActOnRequests=canViewRequests;
    if(!canViewRequests){
      try{
        if(user.role_name==="Department Manager"){await assertEmployeeManager(db,employeeId,user.employee_id);canViewRequests=true;canActOnRequests=true;}
        else if(["HR Manager","Super Admin"].includes(user.role_name)){await assertEmployeeHr(db,employeeId,user.id);canViewRequests=true;canActOnRequests=true;}
      }catch(error){if(!(error instanceof Response)||![403,409].includes(error.status))throw error;}
      if(["HR Manager","Super Admin"].includes(user.role_name))canViewRequests=true;
    }
    const requestEmployeeId=canViewRequests?employeeId:-1;
    const url=new URL(request.url),tab=url.searchParams.get("tab")||"overview",year=new Date().getUTCFullYear(),month=new Date().toISOString().slice(0,7),page=Math.max(1,Number(url.searchParams.get("page"))||1),limit=Math.min(50,Math.max(10,Number(url.searchParams.get("limit"))||25)),offset=(page-1)*limit;
    const [attendanceSummary,leaveBalances,requestCounts,exceptions,corrections,pendingRequests,account,documentAlerts,missingDocuments]=await Promise.all([
      db.prepare("SELECT COUNT(*) FILTER (WHERE status IN ('present','late','remote'))::integer AS present,COUNT(*) FILTER (WHERE late_minutes>0)::integer AS late,COUNT(*) FILTER (WHERE status='absent')::integer AS absent,COUNT(*) FILTER (WHERE attendance_type='remote')::integer AS remote,COUNT(*) FILTER (WHERE status='leave')::integer AS on_leave FROM daily_attendance WHERE employee_id=? AND work_date LIKE ?").bind(employeeId,`${month}%`).first<Row>(),
      db.prepare("SELECT lb.id,lb.year,lb.entitlement,lb.used,lb.pending,(lb.entitlement-lb.used-lb.pending) AS available,lt.code,lt.name_en,lt.name_ar FROM leave_balances lb JOIN employee_leave_types elt ON elt.employee_id=lb.employee_id AND elt.leave_type_id=lb.leave_type_id JOIN leave_types lt ON lt.id=lb.leave_type_id WHERE lb.employee_id=? AND lb.year=? ORDER BY lt.id LIMIT 20").bind(employeeId,year).all(),
      db.prepare("SELECT COUNT(*)::integer AS total,COUNT(*) FILTER (WHERE status IN ('pending_manager','pending_hr'))::integer AS pending,COUNT(*) FILTER (WHERE status IN ('hr_approved','approved'))::integer AS approved,COUNT(*) FILTER (WHERE status LIKE '%rejected%' OR status='rejected')::integer AS rejected FROM requests WHERE employee_id=? AND EXTRACT(YEAR FROM created_at)=?").bind(requestEmployeeId,year).first<Row>(),
      db.prepare("SELECT id,attendance_date,exception_type,status,correction_id FROM attendance_exceptions WHERE employee_id=? AND status IN ('open','correction_requested','pending_manager','pending_hr') ORDER BY attendance_date DESC LIMIT 10").bind(employeeId).all(),
      db.prepare("SELECT id,attendance_date,correction_type,status,current_stage,created_at FROM attendance_corrections WHERE employee_id=? AND status IN ('pending_manager','pending_hr') ORDER BY created_at DESC LIMIT 10").bind(requestEmployeeId).all(),
      db.prepare("SELECT id,request_code,type,status,current_stage,from_date,to_date,created_at FROM requests WHERE employee_id=? AND status IN ('pending_manager','pending_hr') ORDER BY created_at DESC LIMIT 10").bind(requestEmployeeId).all(),
      ["Super Admin","HR Manager"].includes(user.role_name)&&perms.allows("users","view")?db.prepare("SELECT u.id,u.email,u.status,u.must_change_password,u.last_login_at,u.created_at,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.employee_id=?").bind(employeeId).first<Row>():Promise.resolve(null),
      db.prepare("SELECT id,category,expiry_date,CASE WHEN expiry_date<CURRENT_DATE::text THEN 'expired' ELSE 'expiring_soon' END AS status FROM documents WHERE employee_id=? AND status='active' AND expiry_date<=(CURRENT_DATE+30)::text ORDER BY expiry_date LIMIT 10").bind(employeeId).all(),
      db.prepare("SELECT c.code,c.name_en,c.name_ar FROM document_categories c JOIN employees e ON e.id=? WHERE c.status='active' AND c.required_document=1 AND (c.country IS NULL OR c.country=e.country) AND (c.employment_type IS NULL OR c.employment_type=e.employment_type) AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.employee_id=e.id AND d.category=c.code AND d.status='active') ORDER BY c.id LIMIT 10").bind(employeeId).all(),
    ]);
    const policy=profileFieldPolicy({roleName:user.role_name,canEditEmployee:perms.allows("employees","edit"),canViewUsers:perms.allows("users","view"),canEditUsers:perms.allows("users","edit")}),canEdit=policy.canEdit,canViewAccount=policy.canViewAccount&&Boolean(account),canManageAccount=policy.canManageAccount&&Boolean(account);
    const alertRows=[...(exceptions.results as Row[]).map(row=>({kind:"attendance_exception",...row})),...(corrections.results as Row[]).map(row=>({kind:"attendance_correction",...row})),...(pendingRequests.results as Row[]).map(row=>({kind:"pending_request",...row})),...(documentAlerts.results as Row[]).map(row=>({kind:"document_attention",...row})),...(missingDocuments.results as Row[]).map(row=>({kind:"missing_required_document",status:"missing",...row})),...(account&&Number(account.must_change_password)?[{kind:"password_change_required",status:"open"}]:[])];
    const [canViewOnboarding,canViewOffboarding,canViewAssets,canViewLearning]=await Promise.all([perms.allows("onboarding","view"),perms.allows("offboarding","view"),perms.allows("assets","view"),perms.allows("learning","view")]);
    // Personal details (ID, passport, marital status, HR notes) are served only by /api/employees/[id]/profile to HR or the employee themself.
    // Contacts, insurance and acknowledgements below follow the same rule.
    const isSelf=Number(user.employee_id)===employeeId,canViewPersonal=policy.canViewPrivate||isSelf;
    // The direct manager sees the personal card on Overview (never HR notes, contacts, insurance or acknowledgements).
    const isDirectManager=!isSelf&&await assertEmployeeManager(db,employeeId,Number(user.employee_id)||null).then(()=>true,()=>false);
    const profileReady=Boolean((await db.prepare("SELECT to_regclass('public.employee_job_history') AS name").first<Row>())?.name);
    // Add / cancel leave from the profile: the employee's direct manager or their HR (never for oneself).
    const canManageLeave=!isSelf&&canActOnRequests&&["Department Manager","HR Manager","Super Admin"].includes(user.role_name);
    const base={employee,summary:{attendance:{...attendanceSummary,needs_review:exceptions.results.length},leaveBalances:leaveBalances.results,requests:requestCounts},alerts:alertRows,permissions:{canViewRequests,canEdit,canViewPersonal,canViewPersonalDetails:canViewPersonal||isDirectManager,canManageLeave,canEditLeave:canManageLeave&&perms.allows("leave_management","edit"),canManageProfile:canEdit&&profileReady,canViewAccount,canManageAccount,canViewPrivate:policy.canViewPrivate,canViewLifecycle:canViewOnboarding||canViewOffboarding,canViewAssets,canViewLearning},account:canViewAccount?account:null,viewerRole:user.role_name,tab};
    if(tab==="overview"){
      const recent=(await db.prepare("SELECT 'request' AS source,id::text AS source_id,type AS action,status,created_at FROM requests WHERE employee_id=? UNION ALL SELECT 'attendance_correction',id::text,correction_type,status,created_at FROM attendance_corrections WHERE employee_id=? ORDER BY created_at DESC LIMIT 8").bind(requestEmployeeId,requestEmployeeId).all()).results;
      return Response.json({...base,recentActivity:recent});
    }
    if(tab==="attendance"){
      const [rows,logs,allExceptions,allCorrections,actions]=await Promise.all([
        /^\d{4}-\d{2}$/.test(url.searchParams.get("month")||"")?db.prepare("SELECT * FROM daily_attendance WHERE employee_id=? AND work_date LIKE ? ORDER BY work_date DESC LIMIT 62").bind(employeeId,`${url.searchParams.get("month")}%`).all():db.prepare("SELECT * FROM daily_attendance WHERE employee_id=? ORDER BY work_date DESC LIMIT ? OFFSET ?").bind(employeeId,limit+1,offset).all(),
        db.prepare("SELECT id,event_at,event_type,source,device,location FROM attendance_logs WHERE employee_id=? ORDER BY event_at DESC LIMIT 200").bind(employeeId).all(),
        db.prepare("SELECT * FROM attendance_exceptions WHERE employee_id=? ORDER BY attendance_date DESC,id DESC LIMIT 100").bind(employeeId).all(),
        db.prepare("SELECT * FROM attendance_corrections WHERE employee_id=? ORDER BY attendance_date DESC,id DESC LIMIT 100").bind(requestEmployeeId).all(),
        db.prepare("SELECT a.* FROM attendance_correction_actions a JOIN attendance_corrections c ON c.id=a.correction_id WHERE c.employee_id=? ORDER BY a.created_at,a.id LIMIT 300").bind(requestEmployeeId).all(),
      ]);await enrichWorkflowRows(db,allCorrections.results,'attendance_correction');return Response.json({...base,attendance:rows.results.slice(0,limit),attendanceLogs:logs.results,attendanceExceptions:allExceptions.results,attendanceCorrections:allCorrections.results,attendanceCorrectionActions:actions.results,pagination:{page,limit,hasMore:rows.results.length>limit}});
    }
    if(tab==="leave"){
      const [requests,approvals,leaveTypes]=await Promise.all([db.prepare(`SELECT q.id,q.request_code,q.type,q.leave_type_id,q.from_date,q.to_date,q.requested_days,q.status,q.current_stage,q.reason,q.notes,q.created_at,lt.name_en AS leave_type_name,lt.name_ar AS leave_type_name_ar,cbe.name_en AS created_by_name,cbe.name_ar AS created_by_name_ar,${pendingApproverColumns(hrSql)} FROM requests q JOIN employees e ON e.id=q.employee_id JOIN leave_types lt ON lt.id=q.leave_type_id LEFT JOIN users cbu ON cbu.id=NULLIF(q.details_json::jsonb->'leave'->'createdOnBehalfBy'->>'userId','')::int LEFT JOIN employees cbe ON cbe.id=cbu.employee_id WHERE q.employee_id=? ORDER BY q.created_at DESC LIMIT ? OFFSET ?`).bind(requestEmployeeId,limit+1,offset).all(),db.prepare("SELECT a.*,u.email AS actor_email,ae.name_en AS actor_name,ae.name_ar AS actor_name_ar FROM approvals a JOIN requests q ON q.id=a.request_id LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN employees ae ON ae.id=u.employee_id WHERE q.employee_id=? AND q.leave_type_id IS NOT NULL ORDER BY a.created_at,a.id LIMIT 300").bind(requestEmployeeId).all(),db.prepare("SELECT lt.id,lt.code,lt.name_en,lt.name_ar,lt.default_days FROM employee_leave_types elt JOIN leave_types lt ON lt.id=elt.leave_type_id WHERE elt.employee_id=? AND lt.status='active' AND lt.code<>'OFFICIAL' ORDER BY lt.id").bind(employeeId).all()]);await enrichWorkflowRows(db,requests.results,'employee_request');return Response.json({...base,leaveRequests:requests.results.slice(0,limit),leaveTypes:leaveTypes.results,requestApprovals:approvals.results,pagination:{page,limit,hasMore:requests.results.length>limit}});
    }
    if(tab==="requests"){
      const [requests,approvals,attendanceRequests,attendanceActions]=await Promise.all([db.prepare(`SELECT q.*,${pendingApproverColumns(hrSql)} FROM requests q JOIN employees e ON e.id=q.employee_id WHERE q.employee_id=? ORDER BY q.created_at DESC LIMIT ? OFFSET ?`).bind(requestEmployeeId,limit+1,offset).all(),db.prepare("SELECT a.*,u.email AS actor_email,ae.name_en AS actor_name,ae.name_ar AS actor_name_ar FROM approvals a JOIN requests q ON q.id=a.request_id LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN employees ae ON ae.id=u.employee_id WHERE q.employee_id=? ORDER BY a.created_at,a.id LIMIT 300").bind(requestEmployeeId).all(),db.prepare("SELECT * FROM attendance_corrections WHERE employee_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(requestEmployeeId,limit+1,offset).all(),db.prepare("SELECT a.* FROM attendance_correction_actions a JOIN attendance_corrections c ON c.id=a.correction_id WHERE c.employee_id=? ORDER BY a.created_at,a.id LIMIT 300").bind(requestEmployeeId).all()]);await enrichWorkflowRows(db,requests.results,'employee_request');await enrichWorkflowRows(db,attendanceRequests.results,'attendance_correction');return Response.json({...base,requests:requests.results.slice(0,limit),requestApprovals:approvals.results,attendanceCorrections:attendanceRequests.results.slice(0,limit),attendanceCorrectionActions:attendanceActions.results,pagination:{page,limit,hasMore:requests.results.length>limit||attendanceRequests.results.length>limit}});
    }
    if(tab==="lifecycle"){if(!(perms.allows("onboarding","view"))&&!(perms.allows("offboarding","view")))throw new Response("Lifecycle access denied",{status:403});const [lifecycles,tasks]=await Promise.all([db.prepare("SELECT l.*,COUNT(t.id)::int AS task_count,COUNT(t.id) FILTER(WHERE t.status='completed')::int AS completed_tasks,CASE WHEN COUNT(t.id)=0 THEN 0 ELSE ROUND(100.0*COUNT(t.id) FILTER(WHERE t.status='completed')/COUNT(t.id))::int END AS progress FROM employee_lifecycles l LEFT JOIN lifecycle_tasks t ON t.lifecycle_id=l.id WHERE l.employee_id=? GROUP BY l.id ORDER BY l.id DESC LIMIT ? OFFSET ?").bind(employeeId,limit+1,offset).all(),db.prepare("SELECT t.* FROM lifecycle_tasks t JOIN employee_lifecycles l ON l.id=t.lifecycle_id WHERE l.employee_id=? ORDER BY t.due_date,t.id LIMIT 500").bind(employeeId).all()]);return Response.json({...base,lifecycles:lifecycles.results.slice(0,limit),lifecycleTasks:tasks.results,pagination:{page,limit,hasMore:lifecycles.results.length>limit}});}
    if(tab==="assets"){if(!(perms.allows("assets","view")))throw new Response("Asset access denied",{status:403});const rows=await db.prepare("SELECT x.*,a.asset_code,a.category,a.name AS asset_name,a.brand_model,a.serial_number,a.status AS asset_status FROM asset_assignments x JOIN assets a ON a.id=x.asset_id WHERE x.employee_id=? ORDER BY x.assigned_at DESC LIMIT ? OFFSET ?").bind(employeeId,limit+1,offset).all();return Response.json({...base,assetAssignments:rows.results.slice(0,limit),pagination:{page,limit,hasMore:rows.results.length>limit}});}
    if(tab==="learning"){if(!(perms.allows("learning","view")))throw new Response("Learning access denied",{status:403});const rows=await db.prepare("SELECT x.*,c.title AS course_title,c.provider,c.course_type,c.mandatory FROM training_enrollments x JOIN training_courses c ON c.id=x.course_id WHERE x.employee_id=? ORDER BY x.id DESC LIMIT ? OFFSET ?").bind(employeeId,limit+1,offset).all();return Response.json({...base,trainingEnrollments:rows.results.slice(0,limit),pagination:{page,limit,hasMore:rows.results.length>limit}});}
    if(tab==="account"){if(!canViewAccount)throw new Response("Account details are restricted",{status:403});return Response.json(base);}
    if(tab==="history")return Response.json({...base,jobHistory:profileReady?await readJobHistory(db,employeeId):[]});
    if(tab==="insurance"||tab==="contacts"){
      if(!canViewPersonal)throw new Response("Personal details are restricted",{status:403});
      const extras=profileReady?await readProfileExtras(db,employeeId):{contacts:[],insurance:[]};
      const plans=policy.canEdit&&profileReady?(await db.prepare("SELECT id,name_en,name_ar,provider,coverage_type,currency FROM medical_insurance_plans WHERE status='active' ORDER BY name_en").all()).results:[];
      return Response.json({...base,...extras,insurancePlans:plans});
    }
    if(tab==="acknowledgements"){if(!canViewPersonal)throw new Response("Acknowledgements are restricted",{status:403});return Response.json({...base,acknowledgements:await employeeAcknowledgements(db,employeeId)});}
    if(tab==="employment")return Response.json(base);
    throw new Response("Unsupported profile tab",{status:400});
  }catch(error){return apiFailure(error,"Unable to load employee profile");}finally{await db.close();}
}
