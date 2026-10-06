// HTTP integration for department-scoped approval workflows, with disposable fixture companies, units and accounts.
// It writes fixtures, so run it against an isolated clone only:
//   REQUEST_TEST_URL=http://localhost:3027 REQUEST_TEST_VARS=outputs/hr-settings/preview/.dev.vars node tests/runtime-approval-workflow-department.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import postgres from 'postgres';

const varsPath = process.env.REQUEST_TEST_VARS || '.dev.vars';
const vars = Object.fromEntries(fs.readFileSync(varsPath, 'utf8').split(/\r?\n/).filter(s => /^[A-Z_]+=/.test(s)).map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const base = process.env.REQUEST_TEST_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const sql = postgres(vars.DATABASE_URL, { max: 1 }), marker = `wf-dept-${Date.now()}`, companies = [], units = [], employees = [], users = [];
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; console.log(`PASS  ${message}`); };
const cookie = user => { const payload = Buffer.from(JSON.stringify({ userId: user.id, email: user.email, sessionVersion: 1, exp: Math.floor(Date.now() / 1000) + 1200 })).toString('base64url'); return `koon_portal_session=${payload}.${crypto.createHmac('sha256', vars.KOON_AUTH_SECRET).update(payload).digest('base64url')}`; };
async function call(user, path, body, expected = 200) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { cookie: cookie(user), origin: base, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  assert.equal(response.status, expected, `${path} ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
async function unit(name, companyId, kind = 'department', parentId = null) {
  const [row] = await sql`INSERT INTO departments(name_en,name_ar,company_id,organization_kind,parent_id) VALUES (${marker + name},${marker + name},${companyId},${kind},${parentId}) RETURNING id`;
  units.push(row.id); return row.id;
}
async function actor(name, role, placement = {}) {
  const email = `${marker}-${name}@example.invalid`;
  const [e] = await sql`INSERT INTO employees(employee_code,name_en,name_ar,work_email,start_date,country,company_id,department_id,section_id) VALUES (${marker + name},${name},${name},${email},'2025-01-01','Egypt',${companies[0]},${placement.department ?? null},${placement.section ?? null}) RETURNING id`;
  employees.push(e.id);
  const [u] = await sql`INSERT INTO users(email,employee_id,role_id,status,must_change_password) VALUES (${email},${e.id},(SELECT id FROM roles WHERE name=${role}),'active',0) RETURNING id,email,employee_id`;
  users.push(u.id); return u;
}
const firstApprover = async request => Number(JSON.parse((await sql`SELECT steps_json FROM approval_workflow_runs WHERE source_type='employee_request' AND source_id=${request.id}`)[0].steps_json)[0].userId);
const runDepartment = async request => (await sql`SELECT department_id FROM approval_workflow_runs WHERE source_type='employee_request' AND source_id=${request.id}`)[0].department_id;
const submit = owner => call(owner, '/api/hr', { action: 'create_request', type: 'Expense reimbursement', reason: 'Department workflow test', amount: 10, currency: 'SAR' }, 201);

try {
  for (let i = 0; i < 2; i++) { const [c] = await sql`INSERT INTO companies(name) VALUES (${marker + i}) RETURNING id`; companies.push(c.id); }
  const sales = await unit('sales', companies[0]), salesSupport = await unit('support', companies[0], 'section', sales), finance = await unit('finance', companies[0]);
  const foreign = await unit('foreign', companies[1]);
  const admin = await actor('admin', 'Super Admin'), companyApprover = await actor('company-approver', 'Employee'), salesApprover = await actor('sales-approver', 'Employee'), supportApprover = await actor('support-approver', 'Employee');
  const noUnit = await actor('no-unit', 'Employee'), inSales = await actor('in-sales', 'Employee', { department: sales }), inSupport = await actor('in-support', 'Employee', { department: sales, section: salesSupport }), inFinance = await actor('in-finance', 'Employee', { department: finance });

  const catalog = await call(admin, '/api/approval-workflows');
  ok(catalog.departments.some(d => d.id === sales) && catalog.departments.some(d => d.id === salesSupport && d.parent_id === sales), 'catalog lists the company departments and their sections');
  const config = (departmentId, approver, version = 0, active = true) => ({ companyId: companies[0], departmentId, requestType: 'expense', version, active, steps: [{ kind: 'user', userId: approver.id }] });
  await call(admin, '/api/approval-workflows', config(null, companyApprover));
  await call(admin, '/api/approval-workflows', config(sales, salesApprover));
  await call(admin, '/api/approval-workflows', config(salesSupport, supportApprover));
  ok(true, 'company-wide, department and section workflows for the same request type save side by side');
  await call(admin, '/api/approval-workflows', config(sales, salesApprover), 409);
  ok(true, 'a stale save of the department workflow is refused');
  await call(admin, '/api/approval-workflows', config(foreign, salesApprover), 409);
  ok(true, 'a department from another company is refused');
  await call(admin, '/api/approval-workflows', { ...config(-3, salesApprover) }, 400);
  ok(true, 'an invalid department id is refused');
  const saved = (await call(admin, '/api/approval-workflows')).workflows.filter(w => w.company_id === companies[0]);
  ok(saved.length === 3 && saved.filter(w => w.department_id === null).length === 1, 'exactly one company-wide and two unit workflows are stored');

  ok(await firstApprover(await submit(noUnit)) === companyApprover.id, 'an employee without a department follows the company workflow');
  const salesRequest = await submit(inSales);
  ok(await firstApprover(salesRequest) === salesApprover.id && await runDepartment(salesRequest) === sales, 'a department employee follows the department workflow (and the run records it)');
  ok(await firstApprover(await submit(inSupport)) === supportApprover.id, 'a section employee follows the section workflow over the department one');
  ok(await firstApprover(await submit(inFinance)) === companyApprover.id, 'a department without its own workflow falls back to the company workflow');
  await call(admin, '/api/approval-workflows', config(salesSupport, supportApprover, 1, false));
  ok(await firstApprover(await submit(inSupport)) === salesApprover.id, 'disabling the section workflow falls back to the department workflow');
  const queue = await call(salesApprover, '/api/approvals');
  ok(queue.items.some(i => i.source_id === salesRequest.id && i.actionable), 'the department approver sees the request as actionable');
  console.log(`${checks} checks passed`);
} finally {
  await sql.begin(async tx => {
    if (users.length) { await tx`DELETE FROM notifications WHERE user_id=ANY(${users}::int[])`; await tx`DELETE FROM audit_logs WHERE user_id=ANY(${users}::int[])`; }
    if (employees.length) { await tx`DELETE FROM approvals WHERE request_id IN (SELECT id FROM requests WHERE employee_id=ANY(${employees}::int[]))`; await tx`DELETE FROM approval_workflow_runs WHERE employee_id=ANY(${employees}::int[])`; await tx`DELETE FROM requests WHERE employee_id=ANY(${employees}::int[])`; }
    if (companies.length) { await tx`DELETE FROM approval_workflow_versions WHERE workflow_id IN (SELECT id FROM approval_workflows WHERE company_id=ANY(${companies}::int[]))`; await tx`DELETE FROM approval_workflows WHERE company_id=ANY(${companies}::int[])`; }
    if (users.length) await tx`DELETE FROM users WHERE id=ANY(${users}::int[])`;
    if (employees.length) await tx`DELETE FROM employees WHERE id=ANY(${employees}::int[])`;
    if (units.length) await tx`DELETE FROM departments WHERE id=ANY(${units}::int[])`;
    if (companies.length) await tx`DELETE FROM companies WHERE id=ANY(${companies}::int[])`;
  });
  await sql.end();
}
