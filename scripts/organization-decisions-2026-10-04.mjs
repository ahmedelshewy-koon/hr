// Follow-up to organization-cleanup-2026-10-04: applies the business decisions confirmed afterwards
// (Asus Cards / Cairo HR rule, mobile developers, E5, E22, E34, Business Development manager).
// Every change asserts the record still holds the values inspected beforehand; verification runs before COMMIT.
// Usage: node scripts/organization-decisions-2026-10-04.mjs            (dry run, ROLLBACK)
//        node scripts/organization-decisions-2026-10-04.mjs --apply    (COMMIT)
import postgres from 'postgres';
import fs from 'node:fs';
import { organizationIntegrityIssues } from '../app/organization/integrity.ts';
import { HR_ROSTER_SQL } from '../app/organization/hr-roster.ts';

const APPLY = process.argv.includes('--apply');
const TAG = 'org-decisions-2026-10-04';
const sql = postgres(process.env.DATABASE_URL || 'postgresql://koon_hr_admin@127.0.0.1:5545/koon_hr', { max: 1 });
const log = [];
const ROLLBACK = Symbol('rollback');
const same = (a, b) => String(a ?? null) === String(b ?? null);
const fail = message => { throw new Error(`ABORT: ${message}`); };
const CURRENT = ['active', 'probation', 'notice_period'];

async function audit(tx, action, table, id, before, after) {
  await tx`INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,ip_address)
    VALUES (NULL,${action},'organization',${table},${String(id)},${JSON.stringify(before)},${JSON.stringify(after)},${TAG})`;
}
async function update(tx, table, id, expect, set, note) {
  const [row] = await tx.unsafe(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
  if (!row) fail(`${table}#${id} not found`);
  for (const [k, v] of Object.entries(expect)) if (!same(row[k], v)) fail(`${table}#${id}.${k} is ${row[k]}, expected ${v}`);
  const keys = Object.keys(set);
  await tx.unsafe(`UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')},updated_at=now() WHERE id=$1`, [id, ...keys.map(k => set[k])]);
  const before = Object.fromEntries(keys.map(k => [k, row[k] ?? null]));
  await audit(tx, 'organization_decision_update', table, id, before, set);
  log.push({ table, id, before, after: set, note });
}
async function insert(tx, table, values, note) {
  const keys = Object.keys(values);
  const [row] = await tx.unsafe(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, keys.map(k => values[k]));
  await audit(tx, 'organization_decision_create', table, row.id, null, values);
  log.push({ table, id: row.id, before: null, after: values, note });
  return row.id;
}
async function employee(tx, id) { const [row] = await tx`SELECT * FROM employees WHERE id=${id}`; if (!row) fail(`employee #${id} missing`); return row; }

async function snapshot(tx) {
  const read = table => tx.unsafe(`SELECT * FROM ${table} ORDER BY 1`);
  const catalog = {
    companies: await read('companies'), branches: await read('branches'), companyBranches: await read('company_branches'),
    departments: await read('departments'), branchScopes: await read('organization_branch_scopes'), positions: await read('positions'),
    grades: await read('job_grades'), workLocations: await read('work_locations'), hrRules: await read('hr_responsibility_rules'), jobTitles: await read('job_titles'),
  };
  const employees = await tx`SELECT id,employee_code,name_en,name_ar,employment_status,company_id,branch_id,department_id,section_id,team_id,position_id,job_title_id,work_location_id,grade_id,manager_id,hr_user_id FROM employees ORDER BY id`;
  const roster = await tx.unsafe(HR_ROSTER_SQL);
  const current = employees.filter(e => CURRENT.includes(e.employment_status));
  const count = key => JSON.stringify(Object.fromEntries([...current.reduce((m, e) => m.set(e[key] ?? 'none', (m.get(e[key] ?? 'none') || 0) + 1), new Map())].sort()));
  const crossManagers = await tx`SELECT e.id FROM employees e JOIN employees m ON m.id=e.manager_id WHERE e.employment_status IN ('active','probation','notice_period') AND e.company_id IS DISTINCT FROM m.company_id`;
  const crossUnitManagers = await tx`SELECT d.id FROM departments d JOIN employees m ON m.id=d.manager_employee_id WHERE d.status='active' AND d.company_id IS DISTINCT FROM m.company_id`;
  const issues = organizationIntegrityIssues(catalog, employees, roster);
  return {
    issues, employeeIssues: issues.filter(i => i.type === 'employee'),
    crossManagers: crossManagers.map(r => r.id), crossUnitManagers: crossUnitManagers.map(r => r.id),
    totals: { all: employees.length, current: current.length, byCompany: count('company_id'), byBranch: count('branch_id') },
    codes: employees.map(e => `${e.id}:${e.employee_code}`).join('|'),
  };
}

let result;
const skipped = [];
try {
  await sql.begin(async tx => {
    await tx`SET LOCAL lock_timeout = '10s'`;
    await tx`SELECT pg_advisory_xact_lock(78231)`;
    const before = await snapshot(tx);

    // 1. HR responsibility: kept rules are asserted unchanged; Asus Cards / Cairo -> عبدالحميد after eligibility checks.
    const rules = await tx`SELECT id,company_id,branch_id,hr_user_id FROM hr_responsibility_rules WHERE status='active' ORDER BY id`;
    if (JSON.stringify(rules.map(r => [r.id, r.company_id, r.branch_id, r.hr_user_id])) !== JSON.stringify([[1, 5, 3, 9], [2, 6, 2, 18]])) fail(`active HR rules changed: ${JSON.stringify(rules)}`);
    const [hr5] = await tx`SELECT e.id, e.employee_code, e.company_id, e.employment_status, u.status account_status, r.name role, h.status roster_status,
        EXISTS (SELECT 1 FROM company_branches WHERE company_id=6 AND branch_id=3) linked
      FROM users u JOIN employees e ON e.id=u.employee_id JOIN roles r ON r.id=u.role_id JOIN hr_responsibles h ON h.user_id=u.id WHERE u.id=5`;
    if (!hr5 || hr5.id !== 5 || hr5.employee_code !== 'AC-002' || hr5.company_id !== 6 || hr5.employment_status !== 'active' || hr5.account_status !== 'active' || !['HR Manager', 'Super Admin'].includes(hr5.role) || hr5.roster_status !== 'active' || !hr5.linked)
      fail(`user 5 is not an eligible Asus Cards HR: ${JSON.stringify(hr5)}`);
    await insert(tx, 'hr_responsibility_rules', { company_id: 6, branch_id: 3, hr_user_id: 5, status: 'active' }, 'Asus Cards / Cairo -> عبدالحميد حسن ابراهيم يسن (AC-002, Asus Cards, active, eligible HR Manager)');

    // 2. Mobile developers: E2/E13 hold the Mobile App Developer title and position, so they and P9 move to section U18.
    const holders = await tx`SELECT id FROM employees WHERE position_id=9 ORDER BY id`;
    if (holders.map(r => r.id).join(',') !== '2,13') fail(`P9 holders are [${holders.map(r => r.id)}]`);
    for (const id of [2, 13]) {
      const e = await employee(tx, id);
      if (e.job_title_id !== 46 || e.employment_status !== 'active') fail(`E${id} is not an active Mobile App Developer`);
    }
    await update(tx, 'positions', 9, { company_id: 5, department_id: 1, section_id: 73, job_title_id: 46 }, { section_id: 18 }, 'Mobile App Developer position -> Mobile App Development');
    for (const id of [2, 13]) await update(tx, 'employees', id, { company_id: 5, branch_id: 3, department_id: 1, section_id: 73, job_title_id: 46, position_id: 9 }, { section_id: 18 }, 'Software Development -> Mobile App Development (title/position Mobile App Developer)');

    // 3. E5: General Services Manager in Asus Cards > Human Resources > General Services. HR role/roster untouched.
    const gsTitle = await insert(tx, 'job_titles', { name_ar: 'مدير الخدمات العامة', name_en: 'General Services Manager', department_id: 3, status: 'active' }, 'new title (bound to Human Resources: titles bind to departments)');
    const gsPosition = await insert(tx, 'positions', { name_ar: 'مدير الخدمات العامة', name_en: 'General Services Manager', code: 'ASUS-POS-GEN-SVC-MGR', company_id: 6, department_id: 3, section_id: 86, job_title_id: gsTitle, is_ceo: 0, status: 'active' }, 'new position in General Services');
    await update(tx, 'employees', 5, { company_id: 6, branch_id: 3, department_id: 3, section_id: null, job_title_id: 58, position_id: 21 }, { section_id: 86, job_title_id: gsTitle, position_id: gsPosition }, 'HR Manager -> General Services Manager (HR account role and roster unchanged)');

    // 4. E22: confirmed Asus Cards HR employee (company 6, department Human Resources) -> HR Specialist under ماجد العنزي.
    const e22 = await employee(tx, 22), e20 = await employee(tx, 20);
    if (e22.company_id === 6 && e22.department_id === 3 && e22.employment_status === 'active' && e22.manager_id === 21 && !e22.job_title_id && !e22.position_id
      && e20.company_id === 6 && CURRENT.includes(e20.employment_status) && e20.manager_id !== 22) {
      const hrSpecPosition = await insert(tx, 'positions', { name_ar: 'أخصائي موارد بشرية', name_en: 'HR Specialist', code: 'ASUS-POS-HR-SPEC', company_id: 6, department_id: 3, section_id: null, job_title_id: 59, is_ceo: 0, status: 'active' }, 'new HR Specialist position');
      await update(tx, 'employees', 22, { company_id: 6, branch_id: 3, department_id: 3 }, { job_title_id: 59, position_id: hrSpecPosition, manager_id: 20 }, 'HR Specialist; manager مي سمير (Sales Representative) -> ماجد العنزي');
    } else skipped.push({ employee: 22, reason: 'current data contradicts the decision', data: { e22, e20 } });

    // 5. E34: Digital Marketing Manager position (P28) instead of Marketing Manager (P27); P27 gets its own title.
    if ((await tx`SELECT id FROM employees WHERE position_id IN (27,28) ORDER BY id`).map(r => r.id).join(',') !== '34') fail('P27/P28 holders changed');
    await update(tx, 'employees', 34, { company_id: 7, department_id: 92, section_id: 93, job_title_id: 77, position_id: 27 }, { position_id: 28 }, 'position Marketing Manager -> Digital Marketing Manager (matches title T77 and section Digital Marketing)');
    await update(tx, 'positions', 27, { company_id: 7, department_id: 92, job_title_id: null }, { job_title_id: 66 }, 'Marketing Manager position now carries the Marketing Manager title (no holder)');

    // 6. Business Development: remove the KOON Agency manager; no replacement.
    await update(tx, 'departments', 82, { company_id: 6, manager_employee_id: 6 }, { manager_employee_id: null }, 'manager عبدالله الشهراني (KOON Agency) removed; left empty');

    const after = await snapshot(tx);
    if (JSON.stringify(after.totals) !== JSON.stringify(before.totals)) fail(`headcounts changed: ${JSON.stringify(before.totals)} -> ${JSON.stringify(after.totals)}`);
    if (after.codes !== before.codes) fail('employee ids/codes changed');
    if (after.issues.length) fail(`integrity issues: ${JSON.stringify(after.issues)}`);
    if (after.crossManagers.length || after.crossUnitManagers.length) fail(`cross-company managers: ${JSON.stringify(after)}`);
    result = { mode: APPLY ? 'apply' : 'dry-run', at: new Date().toISOString(), skipped,
      before: { totals: before.totals, issues: before.issues, crossManagers: before.crossManagers, crossUnitManagers: before.crossUnitManagers },
      after: { totals: after.totals, issues: after.issues, crossManagers: after.crossManagers, crossUnitManagers: after.crossUnitManagers }, changes: log };
    if (!APPLY) throw ROLLBACK;
  });
} catch (error) {
  if (error !== ROLLBACK) { console.error(error.message); process.exitCode = 1; }
} finally { await sql.end(); }

if (result) {
  fs.mkdirSync('outputs/org-decisions-2026-10-04', { recursive: true });
  const file = `outputs/org-decisions-2026-10-04/${result.mode}-result.json`;
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`${result.mode}: ${result.changes.length} changes, skipped ${JSON.stringify(skipped.map(s => s.employee))}; issues ${result.before.issues.length} -> ${result.after.issues.length}; cross-company unit managers ${JSON.stringify(result.before.crossUnitManagers)} -> ${JSON.stringify(result.after.crossUnitManagers)}; totals ${JSON.stringify(result.after.totals)}; ${APPLY ? 'COMMITTED' : 'ROLLED BACK'}; ${file}`);
}
