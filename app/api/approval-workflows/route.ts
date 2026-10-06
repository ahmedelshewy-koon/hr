import { withDatabase } from '../route-helpers';
import { enforceWriteOrigin, hasPermission, requireActor } from '../api-security';
import { seesWholeCompany } from '../../employees/hr-data-scope';
import { requireModule, body } from '../../talent/talent-service';
import { REQUEST_TYPES, validateWorkflow } from '../../approvals/workflow-policy';

export async function GET(request:Request){return withDatabase('Unable to load approval workflows',async db=>{
  const actor=await requireActor(request,db);
  if(!seesWholeCompany(actor))throw new Response('Forbidden',{status:403});
  await requireModule(db,actor,'system_settings','view');
  const [companies,departments,users,leaves,workflows]=await Promise.all([
    db.prepare("SELECT id,name,status FROM companies ORDER BY name").all(),
    // Departments and sections that a company-specific workflow may target; legacy units without a company are excluded.
    db.prepare("SELECT id,company_id,parent_id,organization_kind,name_en,name_ar FROM departments WHERE status='active' AND company_id IS NOT NULL ORDER BY company_id,name_en").all(),
    db.prepare("SELECT u.id,e.name_en,e.name_ar,u.email,e.company_id FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.status='active' AND e.employment_status IN ('active','probation','notice_period') ORDER BY e.name_en").all(),
    db.prepare("SELECT id,name_en,name_ar FROM leave_types WHERE status='active' AND code<>'OFFICIAL' ORDER BY name_en").all(),
    db.prepare('SELECT * FROM approval_workflows ORDER BY company_id,request_type,department_id NULLS FIRST').all(),
  ]);
  return Response.json({companies:companies.results,departments:departments.results,users:users.results,types:[...REQUEST_TYPES.map(t=>({key:t.key,en:t.en,ar:t.ar})),...leaves.results.map(t=>({key:`leave:${t.id}`,en:t.name_en,ar:t.name_ar}))],workflows:workflows.results.map(w=>({...w,steps:JSON.parse(String(w.steps_json))})),canManage:await hasPermission(db,actor,'system_settings','manage_settings')},{headers:{'cache-control':'no-store'}});
});}
export async function POST(request:Request){return withDatabase('Unable to save approval workflow',async db=>{
  enforceWriteOrigin(request);const actor=await requireActor(request,db);
  if(!seesWholeCompany(actor))throw new Response('Forbidden',{status:403});
  await requireModule(db,actor,'system_settings','manage_settings');
  const input=validateWorkflow(await body(request));
  return db.transaction(async tx=>{
    await tx.prepare('SELECT pg_advisory_xact_lock(?,?)').bind(873,input.companyId).run();
    if(!await tx.prepare("SELECT id FROM companies WHERE id=? AND status='active' FOR SHARE").bind(input.companyId).first())throw new Response('الشركة غير مفعلة / Company is inactive',{status:409});
    if(input.departmentId!==null&&!await tx.prepare("SELECT id FROM departments WHERE id=? AND company_id=? AND status='active' FOR SHARE").bind(input.departmentId,input.companyId).first())throw new Response('القسم غير متاح لهذه الشركة / Department is not available for this company',{status:409});
    if(input.requestType.startsWith('leave:')&&!await tx.prepare("SELECT id FROM leave_types WHERE id=? AND status='active' AND code<>'OFFICIAL'").bind(Number(input.requestType.split(':')[1])).first())throw new Response('نوع الإجازة غير متاح / Leave type unavailable',{status:409});
    if(input.active)for(const step of input.steps)if(step.kind==='user'&&!await tx.prepare("SELECT u.id FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.id=? AND u.status='active' AND e.employment_status IN ('active','probation','notice_period') FOR SHARE OF u,e").bind(step.userId).first())throw new Response('أحد الموافقين غير متاح / Approver unavailable',{status:409});
    const before=await tx.prepare('SELECT * FROM approval_workflows WHERE company_id=? AND request_type=? AND coalesce(department_id,0)=? FOR UPDATE').bind(input.companyId,input.requestType,input.departmentId??0).first();
    if(Number(before?.version||0)!==input.version)throw new Response('تم تعديل المسار من مستخدم آخر. حدّث الصفحة / Workflow changed. Refresh before saving.',{status:409});
    const version=input.version+1,steps=JSON.stringify(input.steps);
    // The advisory lock plus the row lock serialize saves for one company; the unique scope index backs this up.
    const row=before
      ?await tx.prepare('UPDATE approval_workflows SET version=?,active=?,steps_json=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *').bind(version,input.active,steps,actor.id,before.id).first()
      :await tx.prepare('INSERT INTO approval_workflows (company_id,department_id,request_type,version,active,steps_json,updated_by) VALUES (?,?,?,?,?,?,?) RETURNING *').bind(input.companyId,input.departmentId,input.requestType,version,input.active,steps,actor.id).first();
    await tx.prepare('INSERT INTO approval_workflow_versions (workflow_id,version,active,steps_json,changed_by) VALUES (?,?,?,?,?)').bind(row!.id,version,input.active,steps,actor.id).run();
    return Response.json({ok:true,workflow:{...row,steps:input.steps}});
  });
});}
