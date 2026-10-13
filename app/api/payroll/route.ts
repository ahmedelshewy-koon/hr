import { withDatabase } from "../route-helpers";
import { enforceWriteOrigin, requireActor, enforceRateLimit } from "../api-security";
import { assertPayrollEmployee, assertUnlocked, requirePayrollCountry, calculateRun, erpPreview, payrollAccess, preview, runAction, saveElement, saveEmployeeElement, saveVariable, workspace } from "../../payroll/service";
import { buildInvoices, type PayrollLine } from "../../payroll/engine";
import { postInvoices, validateErpConfig } from "../../payroll/erp";
import { payrollPageForAction, payrollPageGrants, requirePayrollPage } from "../../payroll/permissions";
import { filterPayrollWorkspace, redactPayrollRunDetail } from "../../payroll/privacy";
import { mayVerifyReconciliation, mayResetErpAttempt, mayRollbackSentRun } from "../../payroll/reconciliation";
import type { PostgresDatabase } from "../../../db/postgres";

type Row=Record<string,unknown>;
const num=(value:unknown)=>Number(value)||0;
const json=(body:unknown)=>Response.json(body,{headers:{"cache-control":"private, no-store"}});
const selected=(value:unknown)=>{if(value==null||value==="")return "Egypt";if(value==="Egypt"||value==="KSA")return value;throw new Response("Select Egypt or KSA",{status:400});};
const requireMaster=(access:{master:boolean})=>{if(!access.master) throw new Response("Master admin required",{status:403});};
async function requireSchema(db:PostgresDatabase) {
  const ready=await db.prepare("SELECT to_regclass('public.payroll_elements') IS NOT NULL AND to_regclass('public.payroll_run_lines') IS NOT NULL AND to_regclass('public.timesheets') IS NOT NULL AS ready").first();
  if(!ready?.ready) throw new Response("Payroll rebuild requires unapplied migrations 0052 and 0053",{status:503});
}

export async function GET(request:Request) {
  return withDatabase("Unable to load payroll",async db=>{
    const actor=await requireActor(request,db),url=new URL(request.url),year=num(url.searchParams.get("year"))||new Date().getUTCFullYear(),month=num(url.searchParams.get("month"))||new Date().getUTCMonth()+1,country=selected(url.searchParams.get("country"));
    await requireSchema(db);
    const view=url.searchParams.get("view")||"workspace";
    if(view==="preview") {await requirePayrollPage(db,actor,"payrollMonthPreview");return json(await preview(db,actor,year,month,country));}
    if(view==="erp_preview") {await requirePayrollPage(db,actor,"payrollRun");return json(await erpPreview(db,actor,num(url.searchParams.get("runId"))));}
    if(view==="erp_history") {
      const access=await payrollAccess(db,actor);requireMaster(access);await requirePayrollPage(db,actor,"sajelErpSetup");
      const runId=num(url.searchParams.get("runId"));
      const attempts=(await db.prepare("SELECT * FROM payroll_erp_invoice_attempts WHERE run_id=? ORDER BY id").bind(runId).all()).results;
      const reconciliations=(await db.prepare("SELECT * FROM payroll_erp_reconciliations WHERE run_id=? ORDER BY id DESC").bind(runId).all()).results;
      return json({attempts,reconciliations});
    }
    if(view==="business_unit_report") {
      await requirePayrollPage(db,actor,"businessUnitSetup");
      const access=await payrollAccess(db,actor);requireMaster(access);
      const rows=(await db.prepare("SELECT e.id,e.employee_code,e.name_en,e.name_ar,e.company_id,co.name AS company_name,e.working_business_unit_id,b.code AS business_unit_code,e.salary_country AS payroll_country FROM employees e LEFT JOIN companies co ON co.id=e.company_id LEFT JOIN business_units b ON b.id=e.working_business_unit_id WHERE e.employment_status!='deleted' ORDER BY e.employee_code,e.id").all()).results;
      return json({rows,missing:rows.filter(row=>!row.working_business_unit_id).length});
    }
    if(view==="run_lines") {
      await requirePayrollPage(db,actor,"payrollRun");
      const access=await payrollAccess(db,actor);if(access.units) throw new Response("Business unit scoped users cannot view a country-wide run",{status:403});const run=await db.prepare("SELECT * FROM payroll_runs WHERE id=? AND currency IS NOT NULL").bind(num(url.searchParams.get("runId"))).first<Row>();
      if(!run||String(run.country)!==country) throw new Response("Run not found",{status:404});
      if(access.region&&access.region!==country) throw new Response("Region is outside your scope",{status:403});
      const lines=(await db.prepare("SELECT l.*,p.is_basic_salary_element FROM payroll_run_lines l LEFT JOIN payroll_elements p ON p.id=l.element_id WHERE l.run_id=? ORDER BY l.employee_id,l.id").bind(run.id).all()).results;
      return json(access.head?{run,lines}:redactPayrollRunDetail({run,lines}));
    }
    await payrollAccess(db,actor);
    const grants=await payrollPageGrants(db,actor);
    if(!Object.values(grants).some(Boolean)) throw new Response("Permission denied",{status:403});
    return json({...filterPayrollWorkspace(await workspace(db,actor,year,month,country),grants),permissions:grants});
  });
}

export async function POST(request:Request) {
  return withDatabase("Unable to update payroll",async db=>{
    enforceWriteOrigin(request);const actor=await requireActor(request,db);
    await requireSchema(db);
    await enforceRateLimit(db,request,"payroll-write",120,3600,actor.id);
    const input=await request.json().catch(()=>null) as Row|null;if(!input) throw new Response("Invalid request",{status:400});
    const action=String(input.action||""),country=selected(input.country),year=num(input.year),month=num(input.month),access=await payrollAccess(db,actor);
    const page=payrollPageForAction(action);
    if(!page) throw new Response("Unknown payroll action",{status:400});
    await requirePayrollPage(db,actor,page,"edit");
    if(action==="save_element") return json(await saveElement(db,actor,input));
    if(action==="save_employee_element") return json(await db.transaction(async tx=>{await tx.prepare("SELECT pg_advisory_xact_lock(905204)").run();return saveEmployeeElement(tx,actor,input);}));
    if(action==="save_matrix_entries") {
      const entries=Array.isArray(input.entries)?input.entries:[];
      if(!entries.length||entries.length>500) throw new Response("Choose 1 to 500 matrix entries",{status:400});
      const keys=new Set<string>();
      for(const item of entries){if(!item||typeof item!=="object"||Array.isArray(item))throw new Response("Invalid matrix entry",{status:400});const row=item as Row,key=`${num(row.employeeId)}:${num(row.elementId)}`;if(keys.has(key))throw new Response("Duplicate matrix entry",{status:400});keys.add(key);}
      return json(await db.transaction(async tx=>{
        await tx.prepare("SELECT pg_advisory_xact_lock(905204)").run();
        await assertUnlocked(tx,year,month,country);
        const saved=[];
        for(const item of entries) saved.push(await saveEmployeeElement(tx,actor,{...(item as Row),country}));
        return {saved:saved.length};
      }));
    }
    if(action==="save_variable") return json(await saveVariable(db,actor,input));
    if(action==="calculate_run") return json(await calculateRun(db,actor,year,month,country,String(input.salaryCurrency||""),Number(input.sarRate)));
    if(["confirm","rollback","lock","unlock"].includes(action)) return json(await runAction(db,actor,num(input.runId),action));
    if(action==="save_currency") {requireMaster(access);const code=String(input.code||"").toUpperCase();const rate=Number(input.sarRate);if(!/^[A-Z]{3}$/.test(code)||!Number.isFinite(rate)||rate<=0) throw new Response("Invalid currency",{status:400});return json(await db.prepare("INSERT INTO payroll_currencies(code,name_en,name_ar,sar_rate) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET name_en=excluded.name_en,name_ar=excluded.name_ar,sar_rate=excluded.sar_rate,updated_at=CURRENT_TIMESTAMP RETURNING *").bind(code,input.nameEn,input.nameAr,code==="SAR"?1:rate).first());}
    if(action==="save_business_unit") {requireMaster(access);const code=String(input.code||"").trim(),nameEn=String(input.nameEn||"").trim(),nameAr=String(input.nameAr||"").trim(),active=input.isActive===false||input.isActive===0?0:1;if(!code||!nameEn||!nameAr) throw new Response("Business Unit code and names required",{status:400});const id=num(input.id);if(id){const before=await db.prepare("SELECT id FROM business_units WHERE id=?").bind(id).first();if(!before)throw new Response("Business Unit not found",{status:404});return json(await db.prepare("UPDATE business_units SET code=?,name_en=?,name_ar=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *").bind(code,nameEn,nameAr,active,id).first());}return json(await db.prepare("INSERT INTO business_units(code,name_en,name_ar,is_active) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET name_en=excluded.name_en,name_ar=excluded.name_ar,is_active=excluded.is_active,updated_at=CURRENT_TIMESTAMP RETURNING *").bind(code,nameEn,nameAr,active).first());}
    if(action==="delete_business_unit") {requireMaster(access);const id=num(input.id);if(!id)throw new Response("Business Unit not found",{status:404});return json(await db.transaction(async tx=>{const unit=await tx.prepare("SELECT id FROM business_units WHERE id=? FOR UPDATE").bind(id).first();if(!unit)throw new Response("Business Unit not found",{status:404});const used=await tx.prepare("SELECT EXISTS(SELECT 1 FROM employees WHERE working_business_unit_id=?) OR EXISTS(SELECT 1 FROM business_unit_cost_center_mapping WHERE business_unit_id=?) OR EXISTS(SELECT 1 FROM hr_manager_business_units WHERE business_unit_id=?) AS used").bind(id,id,id).first<{used:boolean}>();if(used?.used)throw new Response("Assigned or mapped Business Units cannot be deleted",{status:409});return tx.prepare("DELETE FROM business_units WHERE id=? RETURNING id").bind(id).first();}));}
    if(action==="import_business_units"||action==="import_cost_centers") {
      requireMaster(access);
      const rows=input.rows;
      if(!Array.isArray(rows)||rows.length<1||rows.length>5000) throw new Response("Import requires 1 to 5000 rows",{status:400});
      const seen=new Set<string>();
      const parsed=rows.map((raw,index)=>{
        if(!raw||typeof raw!=="object"||Array.isArray(raw)) throw new Response(`Invalid import row ${index+2}`,{status:400});
        const row=raw as Row,code=String(row.code||"").trim(),nameEn=String(row.name_en||"").trim(),nameAr=String(row.name_ar||"").trim();
        if(!code||code.length>80||!nameEn||nameEn.length>200||!nameAr||nameAr.length>200) throw new Response(`Code and bilingual names required on row ${index+2}`,{status:400});
        if(seen.has(code.toLowerCase())) throw new Response(`Duplicate code in import: ${code}`,{status:400});
        seen.add(code.toLowerCase());
        const active=String(row.is_active??"1").toLowerCase();
        if(!["1","0","true","false","active","inactive"].includes(active)) throw new Response(`Invalid active status on row ${index+2}`,{status:400});
        return {code,nameEn,nameAr,description:String(row.description||"").trim().slice(0,1000),active:["1","true","active"].includes(active)};
      });
      return json(await db.transaction(async tx=>{
        for(const row of parsed) {
          if(action==="import_business_units") await tx.prepare("INSERT INTO business_units(code,name_en,name_ar,is_active) VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET name_en=excluded.name_en,name_ar=excluded.name_ar,is_active=excluded.is_active,updated_at=CURRENT_TIMESTAMP").bind(row.code,row.nameEn,row.nameAr,row.active?1:0).run();
          else {
            await tx.prepare("SELECT pg_advisory_xact_lock(905207)").run();
            const matches=(await tx.prepare("SELECT id FROM cost_centers WHERE code=? ORDER BY id").bind(row.code).all()).results;
            if(matches.length>1) throw new Response(`Cost Center code ${row.code} belongs to multiple existing records`,{status:409});
            if(matches.length) await tx.prepare("UPDATE cost_centers SET name_en=?,name_ar=?,description=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.nameEn,row.nameAr,row.description||null,row.active?"active":"inactive",matches[0].id).run();
            else await tx.prepare("INSERT INTO cost_centers(code,name_en,name_ar,description,status) VALUES(?,?,?,?,?)").bind(row.code,row.nameEn,row.nameAr,row.description||null,row.active?"active":"inactive").run();
          }
        }
        return {imported:parsed.length};
      }));
    }
    if(action==="save_cost_center") {requireMaster(access);const code=String(input.code||"").trim(),nameEn=String(input.nameEn||"").trim(),nameAr=String(input.nameAr||"").trim(),id=num(input.id);if(!code||!nameEn||!nameAr) throw new Response("Cost Center code and names required",{status:400});return json(await db.transaction(async tx=>{await tx.prepare("SELECT pg_advisory_xact_lock(905207)").run();const matches=(await tx.prepare("SELECT id FROM cost_centers WHERE code=? ORDER BY id").bind(code).all()).results;if(matches.some(row=>num(row.id)!==id))throw new Response("Cost Center code already exists",{status:409});if(id){const result=await tx.prepare("UPDATE cost_centers SET code=?,name_en=?,name_ar=?,description=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *").bind(code,nameEn,nameAr,input.description||null,input.isActive===false?"inactive":"active",id).first();if(!result)throw new Response("Cost Center not found",{status:404});return result;}return tx.prepare("INSERT INTO cost_centers(code,name_en,name_ar,description,status) VALUES(?,?,?,?,?) RETURNING *").bind(code,nameEn,nameAr,input.description||null,input.isActive===false?"inactive":"active").first();}));}
    if(action==="bulk_delete_cost_centers") {
      requireMaster(access);
      const ids=Array.isArray(input.ids)?input.ids.map(num):[];
      if(!ids.length||ids.length>500||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length) throw new Response("Choose 1 to 500 distinct Cost Centers",{status:400});
      return json(await db.transaction(async tx=>{
        const existing=(await tx.prepare("SELECT id FROM cost_centers WHERE id=ANY(?::integer[]) FOR UPDATE").bind(ids).all()).results;
        if(existing.length!==ids.length) throw new Response("Cost Center not found",{status:404});
        const used=await tx.prepare("SELECT EXISTS(SELECT 1 FROM employees WHERE cost_center_id=ANY(?::integer[])) OR EXISTS(SELECT 1 FROM business_unit_cost_center_mapping WHERE cost_center_id=ANY(?::integer[])) AS used").bind(ids,ids).first<{used:boolean}>();
        if(used?.used) throw new Response("Assigned or mapped Cost Centers cannot be deleted",{status:409});
        await tx.prepare("DELETE FROM cost_centers WHERE id=ANY(?::integer[])").bind(ids).run();
        return {deleted:ids.length};
      }));
    }
    if(action==="save_mapping") {requireMaster(access);return json(await db.prepare("INSERT INTO business_unit_cost_center_mapping(business_unit_id,cost_center_id,payroll_dr_account) VALUES(?,?,?) ON CONFLICT(business_unit_id,cost_center_id) DO UPDATE SET payroll_dr_account=excluded.payroll_dr_account RETURNING *").bind(num(input.businessUnitId),num(input.costCenterId),input.payrollDrAccount||null).first());}
    if(action==="save_eligibility") {requireMaster(access);const elementId=num(input.elementId);if(!elementId||(!num(input.jobTitleId)&&!num(input.departmentId))) throw new Response("Choose a job title or department",{status:400});return json(await db.prepare("INSERT INTO payroll_element_eligibility(element_id,job_title_id,department_id) VALUES(?,?,?) RETURNING *").bind(elementId,num(input.jobTitleId)||null,num(input.departmentId)||null).first());}
    if(action==="remove_eligibility") {requireMaster(access);return json(await db.prepare("DELETE FROM payroll_element_eligibility WHERE id=? RETURNING id").bind(num(input.id)).first());}
    if(action==="save_hr_manager") {requireMaster(access);const userId=num(input.userId),region=input.region==="Egypt"||input.region==="KSA"?String(input.region):null;const user=await db.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(userId).first();if(!user) throw new Response("Active user required",{status:400});return db.transaction(async tx=>{await tx.prepare("SELECT pg_advisory_xact_lock(905205)").run();const old=await tx.prepare("SELECT id,region FROM hr_managers WHERE user_id=?").bind(userId).first<Row>();let manager;if(old){const nextOrder=old.region===region?null:await tx.prepare("SELECT COALESCE(MAX(admin_order),-1)+1 AS next_order FROM hr_managers WHERE region IS NOT DISTINCT FROM ?").bind(region).first<Row>();manager=await tx.prepare("UPDATE hr_managers SET region=?,admin_order=COALESCE(?,admin_order),is_active=? WHERE id=? RETURNING *").bind(region,nextOrder?.next_order??null,input.isActive===false?0:1,old.id).first<Row>();await tx.prepare("DELETE FROM hr_manager_business_units WHERE manager_id=?").bind(old.id).run();}else{const nextOrder=await tx.prepare("SELECT COALESCE(MAX(admin_order),-1)+1 AS next_order FROM hr_managers WHERE region IS NOT DISTINCT FROM ?").bind(region).first<Row>();manager=await tx.prepare("INSERT INTO hr_managers(user_id,region,admin_order,is_active) VALUES(?,?,?,1) RETURNING *").bind(userId,region,nextOrder?.next_order??0).first<Row>();}if(!manager) throw new Response("Unable to save HR manager",{status:500});for(const unitId of Array.isArray(input.businessUnitIds)?input.businessUnitIds:[]) await tx.prepare("INSERT INTO hr_manager_business_units(manager_id,business_unit_id) VALUES(?,?) ON CONFLICT DO NOTHING").bind(manager.id,num(unitId)).run();const peers=(await tx.prepare("SELECT id FROM hr_managers WHERE region IS NOT DISTINCT FROM ? AND is_active=1 ORDER BY admin_order,id").bind(region).all()).results;for(let i=0;i<peers.length;i++)await tx.prepare("UPDATE hr_managers SET admin_order=? WHERE id=?").bind(i,peers[i].id).run();if(old&&old.region!==region){const previous=(await tx.prepare("SELECT id FROM hr_managers WHERE region IS NOT DISTINCT FROM ? AND is_active=1 ORDER BY admin_order,id").bind(old.region).all()).results;for(let i=0;i<previous.length;i++)await tx.prepare("UPDATE hr_managers SET admin_order=? WHERE id=?").bind(i,previous[i].id).run();}return json(manager);});}
    if(action==="reorder_hr_managers") {requireMaster(access);const region=input.region==="Egypt"||input.region==="KSA"?String(input.region):null,ids=Array.isArray(input.ids)?input.ids.map(num):[];return db.transaction(async tx=>{await tx.prepare("SELECT pg_advisory_xact_lock(905205)").run();const peers=(await tx.prepare("SELECT id FROM hr_managers WHERE region IS NOT DISTINCT FROM ? AND is_active=1 ORDER BY admin_order,id").bind(region).all()).results.map(row=>num(row.id));if(peers.length!==ids.length||ids.some(id=>!peers.includes(id))) throw new Response("Manager order must contain every active manager in the region",{status:400});for(let i=0;i<ids.length;i++)await tx.prepare("UPDATE hr_managers SET admin_order=? WHERE id=?").bind(i,ids[i]).run();return json({ids});});}
    if(action==="save_erp") {requireMaster(access);const methods=["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"];if(!methods.includes(String(input.invoiceMethod))||!methods.includes(String(input.batchMethod))||!["DRAFT","POSTED"].includes(String(input.defaultStatus))) throw new Response("Invalid ERP setup",{status:400});try{validateErpConfig({invoiceUrl:String(input.invoiceUrl||""),invoiceMethod:String(input.invoiceMethod),batchUrl:String(input.batchUrl||""),batchMethod:String(input.batchMethod),apiKey:String(input.apiKey||"configured")});}catch(error){throw new Response(error instanceof Error?error.message:"Invalid ERP URL",{status:400});}return json(await db.prepare("INSERT INTO payroll_erp_settings(id,invoice_url,invoice_method,batch_url,batch_method,api_key,default_status) VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET invoice_url=excluded.invoice_url,invoice_method=excluded.invoice_method,batch_url=excluded.batch_url,batch_method=excluded.batch_method,api_key=CASE WHEN excluded.api_key='' THEN payroll_erp_settings.api_key ELSE excluded.api_key END,default_status=excluded.default_status,updated_at=CURRENT_TIMESTAMP RETURNING id,invoice_url,invoice_method,batch_url,batch_method,default_status").bind(input.invoiceUrl,input.invoiceMethod,input.batchUrl,input.batchMethod,input.apiKey||"",input.defaultStatus).first());}
    if(action==="post_erp") {
      requireMaster(access);const runId=num(input.runId);
      const run=await db.prepare("SELECT * FROM payroll_runs WHERE id=? AND currency IS NOT NULL").bind(runId).first<Row>();
      if(!run||run.status!=="confirmed"||run.sent_to_accounting_at||run.erp_post_started_at) throw new Response("Run cannot be sent; a previous ERP attempt may require reconciliation",{status:409});
      const view=await erpPreview(db,actor,runId);
      if(view.warnings.length) throw new Response(`Resolve ERP warnings: ${view.warnings.join("; ")}`,{status:409});
      const settings=await db.prepare("SELECT * FROM payroll_erp_settings WHERE id=1").first<Row>();if(!settings) throw new Response("ERP setup required",{status:409});
      const lines=(await db.prepare("SELECT * FROM payroll_run_lines WHERE run_id=?").bind(runId).all()).results as PayrollLine[];
      const elements=(await db.prepare("SELECT * FROM payroll_elements").all()).results;
      const mappings=(await db.prepare("SELECT * FROM business_unit_cost_center_mapping").all()).results;
      const claimed=await db.prepare("UPDATE payroll_runs SET erp_post_started_at=CURRENT_TIMESTAMP,erp_post_failed_at=NULL WHERE id=? AND erp_post_started_at IS NULL AND sent_to_accounting_at IS NULL RETURNING id").bind(runId).first();
      if(!claimed) throw new Response("ERP posting is already in progress or needs reconciliation",{status:409});
      let result;
      try {result=await postInvoices({invoiceUrl:String(settings.invoice_url),invoiceMethod:String(settings.invoice_method),batchUrl:String(settings.batch_url),batchMethod:String(settings.batch_method),apiKey:String(settings.api_key)},batch=>{
        const built=buildInvoices(lines,view.employees,elements,mappings,num(run.sar_currency_rate),String(settings.default_status),batch);
        if(built.warnings.length) throw new Error(built.warnings.join("; "));
        return built.invoices;
      },fetch,async item=>{await db.prepare("INSERT INTO payroll_erp_invoice_attempts(run_id,batch_number,business_unit_code,http_status,response_body) VALUES(?,?,?,?,?)").bind(runId,item.batchNumber,item.businessUnitCode,item.status,item.responseBody).run();});} catch(cause) {await db.prepare("UPDATE payroll_runs SET erp_post_failed_at=CURRENT_TIMESTAMP WHERE id=?").bind(runId).run();throw cause;}
      await db.prepare("UPDATE payroll_runs SET sent_to_accounting_at=CURRENT_TIMESTAMP,sent_to_accounting_by=?,erp_batch_number=? WHERE id=? AND sent_to_accounting_at IS NULL").bind(actor.id,result.batchNumber,runId).run();
      return json(result);
    }
    if(action==="submit_reconciliation") {
      requireMaster(access);const runId=num(input.runId),outcome=String(input.outcome||""),reference=String(input.evidenceReference||"").trim(),note=String(input.note||"").trim();
      if(!["not_posted","voided","posted"].includes(outcome)||reference.length<4||reference.length>200||note.length>2000) throw new Response("Invalid ERP reconciliation evidence",{status:400});
      const run=await db.prepare("SELECT id FROM payroll_runs WHERE id=? AND erp_post_started_at IS NOT NULL").bind(runId).first();
      if(!run) throw new Response("ERP attempt not found",{status:404});
      return json(await db.prepare("INSERT INTO payroll_erp_reconciliations(run_id,outcome,evidence_reference,note,submitted_by) VALUES(?,?,?,?,?) RETURNING *").bind(runId,outcome,reference,note||null,actor.id).first());
    }
    if(action==="verify_reconciliation") {
      requireMaster(access);const id=num(input.id),reference=String(input.evidenceReference||"").trim();
      if(reference.length<4||reference.length>200) throw new Response("Verified accounting reference required",{status:400});
      return db.transaction(async tx=>{
        const row=await tx.prepare("SELECT * FROM payroll_erp_reconciliations WHERE id=? FOR UPDATE").bind(id).first<Row>();
        if(!row||!mayVerifyReconciliation(row,actor.id)) throw new Response("Independent reconciliation verifier required",{status:409});
        if(reference!==row.evidence_reference) throw new Response("Accounting reference does not match submitted evidence",{status:409});
        return json(await tx.prepare("UPDATE payroll_erp_reconciliations SET verified_by=?,verified_at=CURRENT_TIMESTAMP WHERE id=? RETURNING *").bind(actor.id,id).first());
      });
    }
    if(action==="reset_failed_erp"||action==="rollback_sent") {
      requireMaster(access);const runId=num(input.runId);
      return db.transaction(async tx=>{
        await tx.prepare("SELECT pg_advisory_xact_lock(905206)").run();
        const run=await tx.prepare("SELECT * FROM payroll_runs WHERE id=? FOR UPDATE").bind(runId).first<Row>();
        const reconciliation=await tx.prepare("SELECT * FROM payroll_erp_reconciliations WHERE run_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE").bind(runId).first<Row>();
        const allowed=run&&(action==="reset_failed_erp"?mayResetErpAttempt(run,reconciliation):mayRollbackSentRun(run,reconciliation));
        if(!allowed) throw new Response("Verified ERP reconciliation required",{status:409});
        const updated=action==="reset_failed_erp"
          ?await tx.prepare("UPDATE payroll_runs SET erp_post_started_at=NULL,erp_post_failed_at=NULL WHERE id=? RETURNING id").bind(runId).first()
          :await tx.prepare("UPDATE payroll_runs SET sent_to_accounting_at=NULL,sent_to_accounting_by=NULL,erp_post_started_at=NULL,erp_post_failed_at=NULL WHERE id=? RETURNING id").bind(runId).first();
        await tx.prepare("UPDATE payroll_erp_reconciliations SET used_by=?,used_at=CURRENT_TIMESTAMP WHERE id=?").bind(actor.id,reconciliation!.id).run();
        return json(updated);
      });
    }
    if(action==="assign_business_unit") {requireMaster(access);const id=num(input.employeeId),unitId=num(input.businessUnitId)||null;await assertPayrollEmployee(db,actor,id);if(unitId&&!await db.prepare("SELECT 1 AS active FROM business_units WHERE id=? AND is_active=1").bind(unitId).first())throw new Response("Working Business Unit is not active",{status:400});return json(await db.prepare("UPDATE employees SET working_business_unit_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? RETURNING id,working_business_unit_id").bind(unitId,id).first());}
    if(action==="delete_variable") return json(await db.transaction(async tx=>{
      await tx.prepare("SELECT pg_advisory_xact_lock(905204)").run();
      const employee=await assertPayrollEmployee(tx,actor,num(input.employeeId));
      const employeeCountry=requirePayrollCountry(employee);
      if(employeeCountry!==country) throw new Response("Employee belongs to another payroll country",{status:403});
      await assertUnlocked(tx,year,month,country);
      const confirmed=await tx.prepare("SELECT 1 AS confirmed FROM payroll_runs WHERE year=? AND month=? AND country=? AND status='confirmed' AND currency IS NOT NULL LIMIT 1").bind(year,month,country).first();
      if(confirmed) throw new Response("Confirmed payroll run blocks variable entry changes",{status:409});
      return tx.prepare("DELETE FROM payroll_variable_entries WHERE id=? AND employee_id=? AND period_key=? AND source='manual' RETURNING id").bind(num(input.id),num(input.employeeId),`${year}-${String(month).padStart(2,"0")}`).first();
    }));
    throw new Response("Unknown payroll action",{status:400});
  });
}
