import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import postgres from "postgres";

const vars = fs.readFileSync(".dev.vars", "utf8");
const line = vars.split(/\r?\n/).find(value => value.startsWith("DATABASE_URL="));
if (!line) throw Error("Local DATABASE_URL is missing");
const source = new URL(line.slice(13).trim().replace(/^['"]|['"]$/g, ""));
if (!["localhost", "127.0.0.1", "::1"].includes(source.hostname)) throw Error("Only local PostgreSQL is permitted");
const sourceName = decodeURIComponent(source.pathname.slice(1));
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sourceName)) throw Error("Unsafe local database name");
const testName = `payroll_isolated_${process.pid}_${Date.now()}`;
const clone = new URL(source);
clone.pathname = `/${testName}`;
const postgresBin = "C:/Program Files/PostgreSQL/18/bin";
const cliEnv = { ...process.env, PGPASSWORD: decodeURIComponent(source.password) };
const common = ["-h", source.hostname, "-p", source.port || "5432", "-U", decodeURIComponent(source.username)];
const admin = postgres(source.toString(), { max: 1, prepare: false, ssl: false });
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = {}", shortCircuit: true };
  if(specifier==="./password-hash"&&context.parentURL?.endsWith("/app/portal-auth.ts")) return nextResolve("./password-hash.ts",context);
  return nextResolve(specifier, context);
} });
let created = false;
function command(binary, args) {
  const result = spawnSync(`${postgresBin}/${binary}.exe`, args, { env: cliEnv, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw Error(`${binary} failed: ${result.stderr.slice(0, 2000)}`);
  return result.stdout;
}
try {
  await admin.unsafe(`CREATE DATABASE "${testName}"`);
  created = true;
  const schema = command("pg_dump", [...common, "--schema-only", "--no-owner", "--no-privileges", sourceName]);
  const restore = spawnSync(`${postgresBin}/psql.exe`, [...common, "-v", "ON_ERROR_STOP=1", "-d", testName], { input: schema, env: cliEnv, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (restore.status !== 0) throw Error(`schema restore failed: ${restore.stderr.slice(0, 2000)}`);
  const db = postgres(clone.toString(), { max: 1, prepare: false, ssl: false });
  try {
    for (const migration of ["0052_timesheet_management.sql", "0053_payroll_rebuild.sql", "0054_deleted_employee_email.sql"]) {
      const sql = fs.readFileSync(`drizzle-postgres/${migration}`, "utf8").replaceAll("--> statement-breakpoint", "");
      await db.unsafe(sql);
    }
    const [state] = await db`SELECT to_regclass('public.timesheets') IS NOT NULL AS timesheets, to_regclass('public.payroll_run_lines') IS NOT NULL AS payroll, to_regclass('public.user_permissions') IS NOT NULL AS page_permissions`;
    if (!state.timesheets || !state.payroll || !state.page_permissions) throw Error("Isolated migration tables missing");
    const defaults=await db`SELECT absence_notice,value FROM deduction_rules WHERE rule_type='absence' AND status='active' ORDER BY absence_notice`;
    if(defaults.length!==2||defaults[0].absence_notice!=="with_notice"||Number(defaults[0].value)!==1||defaults[1].absence_notice!=="without_notice"||Number(defaults[1].value)!==2)throw Error("Default notice deduction rules are missing");
    console.log("Fresh local schema clone migrated through 0054; Timesheet, Payroll and page permission tables verified.");
    if (process.argv.includes("--columns")) {
      const columns = await db`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('users','employees','roles','salary_structures','payroll_variable_entries','timesheets','payroll_month_locks','deduction_rules') AND is_nullable='NO' AND column_default IS NULL ORDER BY table_name,ordinal_position`;
      console.log(columns.map(row => `${row.table_name}.${row.column_name}`).join("\n"));
    }
    if (process.argv.includes("--e2e")) {
      const [role] = await db`INSERT INTO roles(name) VALUES('Super Admin') RETURNING id`;
      const [user] = await db`INSERT INTO users(email,role_id) VALUES('payroll-isolated@example.invalid',${role.id}) RETURNING id`;
      const [unit] = await db`INSERT INTO business_units(code,name_en,name_ar) VALUES('UNIT-T','Test unit','اختبار') RETURNING id`;
      const [center] = await db`INSERT INTO cost_centers(code,name_en,name_ar,status) VALUES('CC-T','Test center','اختبار','active') RETURNING id`;
      await db`INSERT INTO business_unit_cost_center_mapping(business_unit_id,cost_center_id,payroll_dr_account) VALUES(${unit.id},${center.id},'5000')`;
      const [employee] = await db`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,salary_country,salary_currency,working_business_unit_id,cost_center_id) VALUES('E-T','Payroll Test','اختبار','payroll-employee@example.invalid','2026-01-01','Egypt','Egypt','EGP',${unit.id},${center.id}) RETURNING id`;
      await db`INSERT INTO salary_structures(employee_id,basic_salary,country,effective_from) VALUES(${employee.id},9000,'Egypt','2026-01-01')`;
      await db`INSERT INTO payroll_currencies(code,name_en,name_ar,sar_rate) VALUES('EGP','Egyptian pound','جنيه',0.08)`;
      for (const [code, kind, flag] of [["BASIC","earning","is_basic_salary_element"],["DELAY","deduction","is_delay_minutes_element"],["ABS","deduction","is_absence_element"]]) {
        await db.unsafe(`INSERT INTO payroll_elements(code,name_en,name_ar,element_type,${flag},element_account) VALUES($1,$2,$3,$4,1,$5)`, [code, code, code, kind, "5000"]);
      }
      await db`INSERT INTO timesheets(employee_id,work_date,status,late_minutes,deduction_amount,deduction_details) VALUES(${employee.id},'2026-09-30','approved',30,150,'[{"kind":"late","minutes":30,"amount":150}]')`;
      process.env.DATABASE_URL = clone.toString();
      process.env.KOON_AUTH_SECRET = "isolated-payroll-session-test-secret";
      const { createDatabase } = await import("../db/postgres.ts");
      const {createPortalSession,registerPortalSession,requirePortalSession}=await import("../app/portal-auth.ts");
      const { sendToPayroll, rollbackPayrollPeriod, setPayrollLock } = await import("../app/timesheet/payroll.ts");
      const { calculateRun, runAction, erpPreview, saveVariable } = await import("../app/payroll/service.ts");
      const { postInvoices } = await import("../app/payroll/erp.ts");
      const { loadEmployees, loadFacts, dayOverride } = await import("../app/timesheet/facts.ts");
      const { savedAttendanceSnapshot } = await import("../app/attendance/saved-attendance.ts");
      const serviceDb = createDatabase();
      const actor = { id: user.id, roleId: role.id, roleName: "Super Admin", employeeId: null, email: "payroll-isolated@example.invalid", hrDataScope: "all" };
      const token=await createPortalSession({id:user.id,email:actor.email,session_version:1});
      await registerPortalSession(serviceDb,token,user.id);
      const sessionRequest=new Request("http://localhost/api/payroll",{headers:{cookie:`koon_portal_session=${token}`}});
      await requirePortalSession(sessionRequest,serviceDb);
      await db`UPDATE portal_session_activity SET last_activity_at=now()-interval '3 hours 1 minute' WHERE user_id=${user.id}`;
      let idleRejected=false;try{await requirePortalSession(sessionRequest,serviceDb);}catch(error){idleRejected=error instanceof Response&&error.status===401;}
      if(!idleRejected)throw Error("Three-hour idle timeout did not revoke the session");
      const request = new Request("http://localhost/api/timesheet-management", { method: "POST", headers: { origin: "http://localhost" } });
      try {
        const posted = await sendToPayroll(serviceDb, request, actor, "2026-10", "Egypt");
        if (posted.entries !== 1 || posted.delayTotal !== 150) throw Error(`Deduction posting mismatch: ${JSON.stringify(posted)}`);
        const rolled=await rollbackPayrollPeriod(serviceDb,request,actor,"2026-10","Egypt");
        if(rolled.entriesRemoved!==1)throw Error("Deduction rollback did not remove the posted entry");
        await sendToPayroll(serviceDb,request,actor,"2026-10","Egypt");
        await setPayrollLock(serviceDb,request,actor,"2026-10","Egypt",true);
        let lockRejected=false;try{await calculateRun(serviceDb,actor,2026,10,"Egypt","EGP",0.08);}catch(error){lockRejected=error instanceof Response&&error.status===423;}
        if(!lockRejected)throw Error("Locked payroll period allowed recalculation");
        await setPayrollLock(serviceDb,request,actor,"2026-10","Egypt",false);
        let run = await calculateRun(serviceDb, actor, 2026, 10, "Egypt", "EGP", 0.08);
        if (Number(run.total_net) !== 8850) throw Error(`Payroll net mismatch: ${run.total_net}`);
        await db`UPDATE salary_structures SET basic_salary=9100 WHERE employee_id=${employee.id}`;
        let staleRejected=false;try{await runAction(serviceDb,actor,Number(run.id),"confirm");}catch(error){staleRejected=error instanceof Response&&error.status===409;}
        if(!staleRejected)throw Error("Changed salary input did not invalidate the draft run");
        await db`UPDATE salary_structures SET basic_salary=9000 WHERE employee_id=${employee.id}`;
        run=await calculateRun(serviceDb,actor,2026,10,"Egypt","EGP",0.08);
        await runAction(serviceDb, actor, Number(run.id), "confirm");
        const [ordinaryElement]=await db`INSERT INTO payroll_elements(code,name_en,name_ar,element_type,element_account) VALUES('BONUS','Bonus','Bonus','earning','5000') RETURNING id`;
        let confirmedVariableRejected=false;
        try{await saveVariable(serviceDb,actor,{employeeId:employee.id,elementId:ordinaryElement.id,year:2026,month:10,country:'Egypt',amount:100});}catch(error){confirmedVariableRejected=error instanceof Response&&error.status===409;}
        if(!confirmedVariableRejected)throw Error('Confirmed run allowed variable entry mutation');
        let repostRejected=false;try{await sendToPayroll(serviceDb,request,actor,"2026-10","Egypt");}catch(error){repostRejected=error instanceof Response&&error.status===409;}
        if(!repostRejected)throw Error("Confirmed run allowed deduction reposting");
        const invoice = await erpPreview(serviceDb, actor, Number(run.id));
        if (invoice.warnings.length || invoice.invoices.length !== 1) throw Error(`Invoice preview mismatch: ${JSON.stringify(invoice.warnings)}`);
        const sent = await postInvoices({ invoiceUrl: "https://example.invalid/invoice", invoiceMethod: "POST", batchUrl: "https://example.invalid/batch", batchMethod: "GET", apiKey: "test-only" }, batch => invoice.invoices.map(item => ({ ...item, batchNumber: batch })), async url => url.endsWith("/batch") ? Response.json({batchNumber:"TEST-BATCH"}) : Response.json({id:"TEST-INVOICE"}));
        if (sent.results.length !== 1) throw Error("ERP simulation did not send one invoice");
        const partial=[];
        let invoiceCalls=0,partialRejected=false;
        try{await postInvoices({invoiceUrl:"https://example.invalid/invoice",invoiceMethod:"POST",batchUrl:"https://example.invalid/batch",batchMethod:"GET",apiKey:"test-only"},batch=>[{businessUnitCode:"UNIT-T",batchNumber:batch},{businessUnitCode:"UNIT-X",batchNumber:batch}],async url=>url.endsWith("/batch")?Response.json({batchNumber:"PARTIAL-BATCH"}):Response.json({id:++invoiceCalls},{status:invoiceCalls===1?200:503}),item=>{partial.push(item);});}catch{partialRejected=true;}
        if(!partialRejected||invoiceCalls!==2||partial.length!==2||partial[0].status!==200||partial[1].status!==503)throw Error("ERP partial failure was not stopped and recorded");
        await db`INSERT INTO employee_wfh_days(employee_id,wfh_date,approved_by) VALUES(${employee.id},'2026-10-13',${user.id})`;
        const people = await loadEmployees(serviceDb,{employeeIds:[employee.id],departmentIds:null,employeeId:0,country:"Egypt"});
        const facts = await loadFacts(serviceDb,people,"2026-10-13","2026-10-13");
        if (dayOverride(facts,people[0],"2026-10-13")?.kind !== "wfh") throw Error("Assigned WFH day did not reach Timesheet");
        const [reviewed] = await db`SELECT t.*,e.employee_code FROM timesheets t JOIN employees e ON e.id=t.employee_id WHERE t.employee_id=${employee.id} AND t.work_date='2026-09-30'`;
        const snapshot=savedAttendanceSnapshot(reviewed,"TEST-SNAPSHOT");
        await db`INSERT INTO saved_attendance(employee_id,employee_code,work_date,status,batch_id,work_minutes,expected_minutes,difference_minutes,deduction_amount,confirmed_by) VALUES(${snapshot.employeeId},${snapshot.employeeCode},${snapshot.workDate},${snapshot.status},${snapshot.batchId},${snapshot.workMinutes},${snapshot.expectedMinutes},${snapshot.differenceMinutes},${snapshot.deductionAmount},${user.id})`;
        const [saved] = await db`SELECT deduction_amount FROM saved_attendance WHERE employee_id=${employee.id}`;
        if (Number(saved.deduction_amount)!==150) throw Error("Saved attendance lost the reviewed deduction");
        const [company]=await db`INSERT INTO companies(name) VALUES('Payroll Test Company') RETURNING id`;
        const [hrRole]=await db`INSERT INTO roles(name) VALUES('HR Manager') RETURNING id`;
        const [managerEmployee]=await db`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,salary_country,company_id) VALUES('M-T','Direct Manager','مدير','manager@example.invalid','2026-01-01','Saudi Arabia','KSA',${company.id}) RETURNING id`;
        const [managerUser]=await db`INSERT INTO users(email,employee_id,role_id) VALUES('manager@example.invalid',${managerEmployee.id},${hrRole.id}) RETURNING id`;
        const [requester]=await db`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,salary_country,company_id,working_business_unit_id,manager_id) VALUES('R-T','KSA Requester','طالب','requester@example.invalid','2026-01-01','Saudi Arabia','KSA',${company.id},${unit.id},${managerEmployee.id}) RETURNING id`;
        const hrUsers=[];
        for(const [index,region] of ['KSA','KSA','Egypt'].entries()){
          const [hrEmployee]=await db`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,salary_country,company_id) VALUES(${`HR-T${index}`},${`HR ${index}`},'موارد',${`hr${index}@example.invalid`},'2026-01-01',${region==='KSA'?'Saudi Arabia':'Egypt'},${region},${company.id}) RETURNING id`;
          const [hrUser]=await db`INSERT INTO users(email,employee_id,role_id) VALUES(${`hr${index}@example.invalid`},${hrEmployee.id},${hrRole.id}) RETURNING id`;
          const [hrManager]=await db`INSERT INTO hr_managers(user_id,region,admin_order,is_active) VALUES(${hrUser.id},${region},${index===2?0:index},1) RETURNING id`;
          await db`INSERT INTO hr_manager_business_units(manager_id,business_unit_id) VALUES(${hrManager.id},${unit.id})`;
          hrUsers.push(hrUser.id);
        }
        const {resolveWorkflow,attachWorkflow}=await import('../app/approvals/workflow-service.ts');
        const {escalateStaleRequests}=await import('../app/approvals/request-escalation.ts');
        const approvalSnapshot=await serviceDb.transaction(tx=>resolveWorkflow(tx,requester.id,'work_from_home'));
        if(!approvalSnapshot||approvalSnapshot.workflowId!==null||approvalSnapshot.steps.map(step=>step.userId).join(',')!==[managerUser.id,hrUsers[0],hrUsers[1]].join(','))throw Error(`Payroll-region approval chain mismatch: ${JSON.stringify(approvalSnapshot?.steps)}`);
        const [requestRow]=await db`INSERT INTO requests(request_code,employee_id,type,status,current_stage) VALUES('ER-TEST-0001',${requester.id},'Work from home','pending_manager','manager') RETURNING id`;
        await serviceDb.transaction(tx=>attachWorkflow(tx,'employee_request',requestRow.id,approvalSnapshot));
        await db`UPDATE approval_workflow_runs SET updated_at=CURRENT_TIMESTAMP-INTERVAL '4 days' WHERE source_type='employee_request' AND source_id=${requestRow.id}`;
        const escalated=await escalateStaleRequests(serviceDb);
        if(escalated.escalated!==1)throw Error('Three-day request escalation did not advance the manager stage');
        const [next]=await db`SELECT current_user_id,current_step FROM approval_workflow_runs WHERE source_type='employee_request' AND source_id=${requestRow.id}`;
        if(Number(next.current_user_id)!==Number(hrUsers[0])||Number(next.current_step)!==1)throw Error('Request did not escalate to KSA HR level zero');
        const {deleteUserAccount,deleteEmployeeAccounts,provisionEmployeeAccount,deletedUserEmail}=await import('../app/users/account-lifecycle.ts');
        const [employeeRole]=await db`INSERT INTO roles(name) VALUES('Employee') RETURNING id`;
        const accountInput={email:'payroll-employee@example.invalid',employeeId:employee.id,roleId:employeeRole.id,passwordHash:'isolated-test-hash'};
        const originalAccount=await serviceDb.transaction(tx=>provisionEmployeeAccount(tx,accountInput));
        await db`INSERT INTO audit_logs(user_id,action,module,record_type,record_id) VALUES(${originalAccount},'create','users','user',${String(originalAccount)})`;
        const originalToken=await createPortalSession({id:originalAccount,email:accountInput.email,session_version:1});
        await registerPortalSession(serviceDb,originalToken,originalAccount);
        if(!await serviceDb.transaction(tx=>deleteUserAccount(tx,originalAccount)))throw Error('User account was not deleted');
        const [removed]=await db`SELECT status,email,password_hash,session_version FROM users WHERE id=${originalAccount}`;
        if(removed.status!=='deleted'||removed.email!==deletedUserEmail(originalAccount)||removed.password_hash!==null||Number(removed.session_version)!==2)throw Error('Deleted account remained usable or retained its unique email');
        const [sessionCount]=await db`SELECT COUNT(*)::int AS count FROM portal_session_activity WHERE user_id=${originalAccount}`;
        if(Number(sessionCount.count)!==0)throw Error('Deleted account retained an active session');
        const replacement=await serviceDb.transaction(tx=>provisionEmployeeAccount(tx,accountInput));
        if(replacement===originalAccount)throw Error('New login inherited the deleted user audit identity');
        const [historicalAudit]=await db`SELECT user_id FROM audit_logs WHERE user_id=${originalAccount} AND action='create' AND module='users' LIMIT 1`;
        if(Number(historicalAudit?.user_id)!==originalAccount)throw Error('Historical user audit reference was lost');
        const linkedDeleted=await serviceDb.transaction(tx=>deleteEmployeeAccounts(tx,employee.id));
        if(linkedDeleted.length!==1||linkedDeleted[0]!==replacement)throw Error('Employee deletion did not delete its current login');
        await db`UPDATE employees SET employment_status='deleted' WHERE id=${employee.id}`;
        const [history]=await db`SELECT COUNT(*)::int AS count FROM payroll_run_lines WHERE employee_id=${employee.id}`;
        if(Number(history.count)===0)throw Error('Employee deletion lost historical payroll lines');
        const [newEmployee]=await db`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country) VALUES('E-T-REHIRE','Payroll Rehire','اختبار','payroll-employee@example.invalid','2026-10-01','Egypt') RETURNING id`;
        const newLogin=await serviceDb.transaction(tx=>provisionEmployeeAccount(tx,{...accountInput,employeeId:newEmployee.id}));
        if(newLogin===replacement||newLogin===originalAccount)throw Error('Rehired employee inherited a deleted login identity');
        const [oldEmployee]=await db`SELECT work_email FROM employees WHERE id=${employee.id}`;
        if(oldEmployee.work_email!==accountInput.email)throw Error('Former employee work email was not preserved');
        console.log("Isolated E2E: WFH and saved attendance -> deductions -> month lock -> Payroll Run -> fake ERP; KSA escalation and user/employee account deletion with retained history passed.");
      } finally { await serviceDb.close(); }
    }
  } finally { await db.end(); }
} finally {
  if (created) {
    if (!/^payroll_isolated_\d+_\d+$/.test(testName)) throw Error("Unsafe cleanup target");
    await admin.unsafe(`DROP DATABASE IF EXISTS "${testName}" WITH (FORCE)`);
  }
  await admin.end();
}
