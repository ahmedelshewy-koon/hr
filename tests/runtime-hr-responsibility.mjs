import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

// App modules use extensionless relative imports (resolved by Vite); resolve them the same way here.
registerHooks({ resolve(specifier, context, next) { if (specifier.startsWith('.')) { const base = new URL(specifier, context.parentURL); for (const ext of ['', '.ts', '.tsx']) { const file = fileURLToPath(base) + ext; if (fs.existsSync(file) && fs.statSync(file).isFile()) return next(base.href + ext, context); } } return next(specifier, context); } });
const { saveOrganizationEntity, previewOrganizationEntity } = await import('../app/organization/catalog-service.ts');
const { saveEmployeeProfile } = await import('../app/employees/profile-update.ts');
const { effectiveHrSql, requireEmployeeHr, assertEmployeeHr } = await import('../app/employees/hr-assignment.ts');
const { readOrganizationCatalog } = await import('../app/organization/assignment-service.ts');
const { readHrRoster } = await import('../app/organization/hr-roster.ts');
const { resolveEmployeeHrResponsibility, hrSetupSummary } = await import('../app/organization/hr-responsibility.ts');
const { readOrganizationInsights } = await import('../app/organization/settings-insights.ts');
const { organizationDuplicateError } = await import('../app/organization/duplicate-error.ts');
const { aggregateApprovals } = await import('../app/approvals/approval-aggregation.ts');
const { syncOperationalNotifications } = await import('../app/notifications/notification-service.ts');

// Isolated only: the disposable cluster from outputs/hr-responsibility/setup-cluster.mjs. Never reads DATABASE_URL
// and never connects to the live port. Every fixture write happens in one transaction that is rolled back; full
// table fingerprints are compared before and after.
const { cluster, port, database } = JSON.parse(fs.readFileSync('outputs/hr-responsibility/cluster.json', 'utf8'));
assert.notEqual(port, 5545);
const sql = postgres(`postgresql://koon_hr_admin@127.0.0.1:${port}/${database}`, { max: 1 });
function adapter(tx) { return { prepare(source) { let values = []; const execute = () => { let i = 0; return tx.unsafe(source.replace(/\?/g, () => '$' + ++i), values); }; return { bind(...v) { values = v; return this; }, async all() { return { results: await execute() }; }, async first() { return (await execute())[0] ?? null; }, async run() { return execute(); } }; }, async batch() { throw new Error('unused'); }, async transaction(fn) { return fn(this); } }; }
async function inventory(tx) { const rows = await tx`SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('public','drizzle') ORDER BY 1,2`; const out = {}; for (const r of rows) { const [v] = await tx.unsafe(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),'')) AS hash FROM "${r.table_schema}"."${r.table_name}" t`); out[`${r.table_schema}.${r.table_name}`] = v; } return out; }
async function codeOf(promise) { const error = await promise.then(() => null, e => e); if (!error) return 'resolved'; if (error instanceof Response) { const text = await error.clone().text(); try { return JSON.parse(text).code ?? `${error.status}:${text}`; } catch { return `${error.status}:${text}`; } } return error.code ?? String(error); }
const passed = []; const check = async (name, fn) => { await fn(); passed.push(name); console.log('✔', name); };
const rollback = new Error('ROLLBACK_HR_RESPONSIBILITY');
const result = { startedAt: new Date().toISOString(), database: `127.0.0.1:${port}/${database}` };
const KS = 5, ASUS = 6, AGENCY = 7, RIYADH = 2, CAIRO = 3;
try {
  const [server] = await sql`SELECT current_database() AS database,inet_server_port() AS port,current_setting('data_directory') AS directory`;
  assert.equal(server.port, port); assert.equal(server.database, database); assert.equal(path.resolve(server.directory), path.resolve(cluster));
  const baseline = await inventory(sql);
  try { await sql.begin(async tx => {
    await tx`SET LOCAL lock_timeout='5s'`; await tx`SET LOCAL statement_timeout='60s'`;
    const db = adapter(tx);
    const role = async name => (await tx`SELECT id FROM roles WHERE name=${name}`)[0].id;
    // Synthetic HR people in the clone only: two linked HR Managers, one unlinked Super Admin account.
    const person = async (code, en, ar) => (await tx`INSERT INTO employees (employee_code,name_en,name_ar,work_email,start_date,country,employment_status,company_id,branch_id) VALUES (${code},${en},${ar},${code.toLowerCase() + '@example.invalid'},'2026-01-01','Egypt','active',${ASUS},${CAIRO}) RETURNING id`)[0].id;
    const account = async (email, roleName, employeeId) => (await tx`INSERT INTO users (email,role_id,employee_id,status,must_change_password) VALUES (${email},${await role(roleName)},${employeeId},'active',0) RETURNING id`)[0].id;
    const saraEmp = await person('HRRT-SARA', 'Sara Ahmed (QA)', 'سارة أحمد'), monaEmp = await person('HRRT-MONA', 'Mona Ali (QA)', 'منى علي');
    const SARA = await account('hrrt-sara@example.invalid', 'HR Manager', saraEmp), MONA = await account('hrrt-mona@example.invalid', 'HR Manager', monaEmp);
    const UNLINKED = await account('hrrt-unlinked@example.invalid', 'Super Admin', null);
    for (const id of [SARA, MONA, UNLINKED]) await tx`INSERT INTO hr_responsibles (user_id,status) VALUES (${id},'active')`;
    const [actor] = await tx`SELECT id FROM users WHERE email='admin@koonhr.com'`;
    const actorId = actor?.id ?? SARA;
    const current = async () => tx`SELECT id,company_id,branch_id,hr_user_id,employment_status FROM employees WHERE employment_status IN ('active','probation','notice_period') ORDER BY id`;
    const hrSql = await effectiveHrSql(db);
    const effective = async id => (await tx.unsafe(`SELECT ${hrSql} AS hr FROM employees e WHERE e.id=$1`, [id]))[0].hr;
    const jsResolve = async employee => resolveEmployeeHrResponsibility({ employee, catalog: await readOrganizationCatalog(db), roster: await readHrRoster(db) });
    const available = async id => requireEmployeeHr(db, id).then(() => true, e => { if (e instanceof Response && e.status === 409) return false; throw e; });
    const parity = async label => {
      for (const e of await current()) {
        const js = await jsResolve(e);
        assert.equal(Number(await effective(e.id)) || null, js.hrUserId, `${label}: SQL vs resolver for employee ${e.id}`);
        assert.equal(await available(e.id), js.available, `${label}: availability for employee ${e.id}`);
      }
    };
    const asusCairo = (await tx`SELECT id FROM employees WHERE company_id=${ASUS} AND branch_id=${CAIRO} AND employment_status IN ('active','probation','notice_period') AND employee_code NOT LIKE 'HRRT-%' ORDER BY id`).map(r => r.id);
    const ksCairo = (await tx`SELECT id FROM employees WHERE company_id=${KS} AND branch_id=${CAIRO} AND employment_status IN ('active','probation','notice_period') ORDER BY id`).map(r => r.id);
    const asusRiyadh = (await tx`SELECT id FROM employees WHERE company_id=${ASUS} AND branch_id=${RIYADH} AND employment_status IN ('active','probation','notice_period') ORDER BY id`).map(r => r.id);
    const unassigned = (await tx`SELECT id FROM employees WHERE branch_id IS NULL AND company_id IS NULL AND employment_status IN ('active','probation','notice_period') ORDER BY id LIMIT 1`)[0].id;
    result.population = { asusCairo: asusCairo.length, ksCairo: ksCairo.length, asusRiyadh: asusRiyadh.length };
    const employeesHash = async () => (await tx`SELECT md5(string_agg(row_to_json(e)::text,chr(10) ORDER BY e.id)) h FROM employees e`)[0].h;

    await check('empty rules: every current employee resolves to none, SQL and resolver agree', async () => {
      assert.equal((await tx`SELECT count(*)::int c FROM hr_responsibility_rules`)[0].c, 0);
      await parity('empty');
      const insights = await readOrganizationInsights(db);
      const summary = hrSetupSummary(await readOrganizationCatalog(db), insights.hrRoster, insights.hrEmployees);
      assert.equal(summary.resolved, 0); assert.ok(summary.needsSetup >= asusCairo.length + ksCairo.length + asusRiyadh.length);
      assert.ok(insights.unlinkedHrAccounts.some(a => a.email === 'hrrt-unlinked@example.invalid'));
    });

    let asusRule, riyadhFallback;
    await check('create Company + Branch rules; the first rule needs impact confirmation', async () => {
      const record = { rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: SARA, status: 'active' };
      assert.equal(await codeOf(saveOrganizationEntity(db, 'hrRules', record, actorId)), 'IMPACT_NOT_CONFIRMED');
      const preview = await previewOrganizationEntity(db, 'hrRules', record);
      assert.equal(preview.impact.hr.toThisRule.length, asusCairo.length + 2, 'Asus+Cairo staff (+2 synthetic HR people, not self-served)');
      const before = await employeesHash();
      asusRule = (await saveOrganizationEntity(db, 'hrRules', { ...record, confirmImpact: preview.confirmationToken }, actorId)).id;
      assert.equal(await employeesHash(), before, 'a rule save never writes employee records');
      const audit = (await tx`SELECT * FROM audit_logs WHERE record_type='hr_responsibility_rules' AND record_id=${String(asusRule)}`)[0];
      assert.equal(audit.action, 'create'); assert.equal(Number(audit.user_id), actorId); assert.equal(JSON.parse(audit.new_value).hr_user_id, SARA);
      const ksPreview = await previewOrganizationEntity(db, 'hrRules', { rule_type: 'company_branch', company_id: KS, branch_id: CAIRO, hr_user_id: MONA, status: 'active' });
      await saveOrganizationEntity(db, 'hrRules', { rule_type: 'company_branch', company_id: KS, branch_id: CAIRO, hr_user_id: MONA, status: 'active', confirmImpact: ksPreview.confirmationToken }, actorId);
      const agencyPreview = await previewOrganizationEntity(db, 'hrRules', { rule_type: 'company_branch', company_id: AGENCY, branch_id: CAIRO, hr_user_id: SARA, status: 'active' });
      assert.equal(agencyPreview.ok, true, 'the same HR may serve several company+branch scopes');
      await saveOrganizationEntity(db, 'hrRules', { rule_type: 'company_branch', company_id: AGENCY, branch_id: CAIRO, hr_user_id: SARA, status: 'active', confirmImpact: agencyPreview.confirmationToken ?? undefined }, actorId);
      for (const id of asusCairo) assert.equal(Number(await effective(id)), SARA);
      for (const id of ksCairo) assert.equal(Number(await effective(id)), MONA, 'different HR per company in the same branch');
      await parity('company+branch');
    });

    await check('duplicates, unlinked HR, junk branch and ambiguous type are refused with structured codes', async () => {
      assert.equal(await codeOf(saveOrganizationEntity(db, 'hrRules', { rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: MONA, status: 'active' }, actorId)), 'HR_RULE_DUPLICATE');
      assert.equal(await codeOf(saveOrganizationEntity(db, 'hrRules', { rule_type: 'company_branch', company_id: ASUS, branch_id: RIYADH, hr_user_id: UNLINKED, status: 'active' }, actorId)), 'HR_ACCOUNT_NOT_LINKED');
      assert.equal(await codeOf(saveOrganizationEntity(db, 'hrRules', { rule_type: 'branch_fallback', branch_id: 1, hr_user_id: SARA, status: 'active' }, actorId)), 'BRANCH_NOT_LINKED');
      assert.equal(await codeOf(saveOrganizationEntity(db, 'hrRules', { branch_id: RIYADH, hr_user_id: SARA, status: 'active' }, actorId)), 'HR_RULE_TYPE_INVALID');
      // The database index is the last line of defence; its violation is also translated.
      const raw = await tx.savepoint(sp => sp`INSERT INTO hr_responsibility_rules (company_id,branch_id,hr_user_id,status) VALUES (${ASUS},${CAIRO},${MONA},'active')`).then(() => null, e => e);
      assert.equal((await organizationDuplicateError(raw).json()).code, 'HR_RULE_DUPLICATE');
    });

    await check('branch fallback resolves when no company rule exists; company rules win', async () => {
      const record = { rule_type: 'branch_fallback', branch_id: RIYADH, hr_user_id: MONA, status: 'active' };
      const preview = await previewOrganizationEntity(db, 'hrRules', record);
      assert.equal(preview.impact.hr.toThisRule.length, asusRiyadh.length);
      riyadhFallback = (await saveOrganizationEntity(db, 'hrRules', { ...record, confirmImpact: preview.confirmationToken }, actorId)).id;
      for (const id of asusRiyadh) { const js = await jsResolve((await tx`SELECT * FROM employees WHERE id=${id}`)[0]); assert.deepEqual([js.source, js.hrUserId], ['branch_fallback', MONA]); }
      const cairoFallback = await previewOrganizationEntity(db, 'hrRules', { rule_type: 'branch_fallback', branch_id: CAIRO, hr_user_id: MONA, status: 'active' });
      assert.equal(cairoFallback.impact.hr.toThisRule.length, 0, 'Cairo employees keep their company rules');
      await parity('fallback');
    });

    await check('employee override wins, is audited, and clearing it returns to the rule without storing the rule result', async () => {
      const id = ksCairo[0];
      const read = async () => (await tx`SELECT * FROM employees WHERE id=${id}`)[0];
      await saveEmployeeProfile(db, id, { hrUserId: SARA }, { id: actorId });
      assert.equal(Number((await read()).hr_user_id), SARA); assert.equal(Number(await effective(id)), SARA);
      await assertEmployeeHr(db, id, SARA);
      assert.equal(await codeOf(assertEmployeeHr(db, id, MONA)), '403:هذا الطلب متاح فقط لمسؤول الموارد البشرية المعيّن للموظف.');
      const audit = (await tx`SELECT previous_value,new_value FROM audit_logs WHERE record_type='employee' AND record_id=${String(id)} ORDER BY id DESC LIMIT 1`)[0];
      assert.equal(JSON.parse(audit.previous_value).hr_user_id, null); assert.equal(JSON.parse(audit.new_value).hr_user_id, SARA);
      await saveEmployeeProfile(db, id, { hrUserId: '' }, { id: actorId });
      assert.equal((await read()).hr_user_id, null, 'cleared override is NULL, not the resolved HR');
      assert.equal(Number(await effective(id)), MONA);
      assert.equal(await codeOf(saveEmployeeProfile(db, id, { hrUserId: UNLINKED }, { id: actorId })), 'HR_ACCOUNT_NOT_LINKED');
      assert.equal(await codeOf(saveEmployeeProfile(db, saraEmp, { hrUserId: MONA }, { id: SARA, employeeId: saraEmp, roleName: 'HR Manager' })), 'HR_OVERRIDE_INVALID', 'no self-change of HR');
    });

    await check('company/branch change re-resolves HR and never creates an implicit override', async () => {
      const id = asusCairo[0];
      await tx`UPDATE employees SET company_id=${KS} WHERE id=${id}`;
      assert.equal(Number(await effective(id)), MONA);
      await tx`UPDATE employees SET company_id=${ASUS},branch_id=${RIYADH} WHERE id=${id}`;
      assert.equal(Number(await effective(id)), MONA, 'Riyadh fallback');
      assert.equal((await tx`SELECT hr_user_id FROM employees WHERE id=${id}`)[0].hr_user_id, null);
      await tx`UPDATE employees SET branch_id=${CAIRO} WHERE id=${id}`;
      const missing = await jsResolve((await tx`SELECT * FROM employees WHERE id=${unassigned}`)[0]);
      assert.deepEqual([missing.source, missing.reason], ['none', 'missing_company_branch']);
      assert.equal(await available(unassigned), false, 'missing HR is an explicit handled state (409)');
    });

    await check('changing a rule HR and deactivating rules: preview matches the result; stale reviews are refused', async () => {
      const change = { id: asusRule, rule_type: 'company_branch', company_id: ASUS, branch_id: CAIRO, hr_user_id: MONA, status: 'active' };
      const preview = await previewOrganizationEntity(db, 'hrRules', change);
      assert.equal(preview.impact.hr.toThisRule.length, asusCairo.length + 2, 'every Asus+Cairo employee switches from Sara to Mona (the two synthetic HR people included)');
      await tx`UPDATE employees SET hr_user_id=${SARA} WHERE id=${asusCairo[1]}`; // someone got an override after the review
      assert.equal(await codeOf(saveOrganizationEntity(db, 'hrRules', { ...change, confirmImpact: preview.confirmationToken }, actorId)), 'STALE_REVIEW');
      const fresh = await previewOrganizationEntity(db, 'hrRules', change);
      assert.ok(fresh.impact.hr.overridesUnchanged.some(p => p.id === asusCairo[1]));
      await saveOrganizationEntity(db, 'hrRules', { ...change, confirmImpact: fresh.confirmationToken }, actorId);
      assert.equal(Number(await effective(asusCairo[0])), MONA); assert.equal(Number(await effective(asusCairo[1])), SARA, 'override untouched');
      const off = { id: riyadhFallback, rule_type: 'branch_fallback', branch_id: RIYADH, hr_user_id: MONA, status: 'inactive' };
      const offPreview = await previewOrganizationEntity(db, 'hrRules', off);
      assert.equal(offPreview.impact.hr.toNone.length, asusRiyadh.length);
      await saveOrganizationEntity(db, 'hrRules', { ...off, confirmImpact: offPreview.confirmationToken }, actorId);
      for (const id of asusRiyadh) assert.equal(await available(id), false);
      const audit = (await tx`SELECT new_value FROM audit_logs WHERE record_type='hr_responsibility_rules' AND record_id=${String(riyadhFallback)} ORDER BY id DESC LIMIT 1`)[0];
      assert.deepEqual(JSON.parse(audit.new_value).statusChange, { before: 'active', after: 'inactive' });
      await parity('after changes');
    });

    await check('an HR account that loses its employee link stops receiving requests (no silent fallback)', async () => {
      await tx`UPDATE users SET employee_id=NULL WHERE id=${MONA}`;
      assert.equal(await available(ksCairo[0]), false);
      await parity('unlinked');
      await tx`UPDATE users SET employee_id=${monaEmp} WHERE id=${MONA}`;
    });

    await check('approval queues and notifications run with the effective HR SQL', async () => {
      const [employee] = await tx`SELECT id FROM employees WHERE id=${ksCairo[0]}`;
      await tx`INSERT INTO requests (request_code,employee_id,type,status,current_stage,created_at,updated_at) VALUES ('HRQA-REQ-1',${employee.id},'leave','pending_hr','hr',now(),now())`.catch(async () => {
        await tx`INSERT INTO requests (employee_id,type,status,current_stage) VALUES (${employee.id},'leave','pending_hr','hr')`;
      });
      const mona = (await aggregateApprovals(db, { id: MONA, role_name: 'HR Manager', employee_id: monaEmp, department_id: null })).items;
      const sara = (await aggregateApprovals(db, { id: SARA, role_name: 'HR Manager', employee_id: saraEmp, department_id: null })).items;
      assert.ok(mona.some(item => Number(item.employee_id) === employee.id), 'rule-resolved HR sees the request');
      assert.ok(!sara.some(item => Number(item.employee_id) === employee.id), 'other HR does not');
      await syncOperationalNotifications(db);
    });

    result.passed = passed;
    throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
  const after = await inventory(sql);
  assert.deepEqual(after, baseline, 'rollback left every table unchanged');
  result.tables = Object.keys(baseline).length; result.finishedAt = new Date().toISOString();
  fs.writeFileSync('outputs/hr-responsibility/isolated-verification.json', JSON.stringify(result, null, 2));
  console.log(`${passed.length} isolated checks passed; ${result.tables} tables unchanged after rollback`);
} finally { await sql.end({ timeout: 5 }); }
