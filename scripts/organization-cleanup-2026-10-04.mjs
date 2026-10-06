// One-off cleanup of the live organization data (2026-10-04): merges duplicate units into canonical records,
// fixes names, binds job titles/positions to canonical departments and corrects the Asus Cards / Riyadh HR rule.
// Every change asserts the record still holds the values inspected beforehand, so concurrent edits abort the run.
// Verification (integrity check, headcounts, employee codes) runs inside the same transaction before COMMIT.
// Usage: node scripts/organization-cleanup-2026-10-04.mjs            (dry run: everything, then ROLLBACK)
//        node scripts/organization-cleanup-2026-10-04.mjs --apply    (same, then COMMIT)
import postgres from 'postgres';
import fs from 'node:fs';
import { organizationIntegrityIssues } from '../app/organization/integrity.ts';
import { HR_ROSTER_SQL } from '../app/organization/hr-roster.ts';

const APPLY = process.argv.includes('--apply');
const url = process.env.DATABASE_URL || 'postgresql://koon_hr_admin@127.0.0.1:5545/koon_hr';
const sql = postgres(url, { max: 1 });
const log = [];
const ROLLBACK = Symbol('rollback');
const same = (a, b) => String(a ?? null) === String(b ?? null);
const fail = message => { throw new Error(`ABORT: ${message}`); };

async function audit(tx, action, table, id, before, after) {
  await tx`INSERT INTO audit_logs (user_id,action,module,record_type,record_id,previous_value,new_value,ip_address)
    VALUES (NULL,${action},'organization',${table},${String(id)},${JSON.stringify(before)},${JSON.stringify(after)},'org-cleanup-2026-10-04')`;
}

/** Update one row after checking `expect`; records before/after for the report and the audit log. */
async function update(tx, table, id, expect, set, note) {
  const [row] = await tx.unsafe(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
  if (!row) fail(`${table}#${id} not found`);
  for (const [k, v] of Object.entries(expect)) if (!same(row[k], v)) fail(`${table}#${id}.${k} is ${row[k]}, expected ${v}`);
  const keys = Object.keys(set);
  await tx.unsafe(`UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')},updated_at=now() WHERE id=$1`, [id, ...keys.map(k => set[k])]);
  const before = Object.fromEntries(keys.map(k => [k, row[k] ?? null]));
  await audit(tx, set.status && set.status !== row.status ? 'organization_cleanup_deactivate' : 'organization_cleanup_update', table, id, before, set);
  log.push({ table, id, before, after: set, note });
}

/** Moves exactly the expected employees (by id) from one reference to another. */
async function moveEmployees(tx, where, expectedIds, set, note) {
  const rows = await tx.unsafe(`SELECT id,department_id,section_id,team_id FROM employees WHERE ${where} ORDER BY id FOR UPDATE`);
  const ids = rows.map(r => r.id);
  if (ids.join(',') !== expectedIds.join(',')) fail(`employees WHERE ${where} are [${ids}], expected [${expectedIds}]`);
  for (const row of rows) await update(tx, 'employees', row.id, {}, set, note);
}

/** Refuses to retire a unit while anything other than a deleted employee still points at it. */
async function assertUnitUnreferenced(tx, unitId) {
  const [refs] = await tx`SELECT
    (SELECT count(*)::int FROM employees WHERE ${unitId} IN (department_id,section_id,team_id) AND employment_status<>'deleted') employees,
    (SELECT count(*)::int FROM positions WHERE ${unitId} IN (department_id,section_id,team_id)) positions,
    (SELECT count(*)::int FROM job_titles WHERE department_id=${unitId} AND status='active') titles,
    (SELECT count(*)::int FROM departments WHERE parent_id=${unitId} AND status='active') children,
    (SELECT count(*)::int FROM organization_branch_scopes WHERE department_id=${unitId}) scopes,
    (SELECT count(*)::int FROM job_openings WHERE department_id=${unitId}) openings,
    (SELECT count(*)::int FROM job_offers WHERE department_id=${unitId}) offers,
    (SELECT count(*)::int FROM interview_templates WHERE department_id=${unitId}) templates,
    (SELECT count(*)::int FROM interview_questions WHERE department_id=${unitId}) questions`;
  const used = Object.entries(refs).filter(([, n]) => n > 0);
  if (used.length) fail(`unit #${unitId} still referenced: ${JSON.stringify(Object.fromEntries(used))}`);
}
async function retireUnit(tx, id, expect, note) { await assertUnitUnreferenced(tx, id); await update(tx, 'departments', id, { status: 'active', ...expect }, { status: 'inactive' }, note); }
async function archiveTitle(tx, id, expect, note) {
  const [refs] = await tx`SELECT (SELECT count(*)::int FROM employees WHERE job_title_id=${id}) employees, (SELECT count(*)::int FROM positions WHERE job_title_id=${id}) positions, (SELECT count(*)::int FROM job_openings WHERE job_title_id=${id}) openings`;
  if (refs.employees || refs.positions || refs.openings) fail(`job title #${id} still referenced: ${JSON.stringify(refs)}`);
  await update(tx, 'job_titles', id, { status: 'active', ...expect }, { status: 'archived' }, note);
}

async function snapshot(tx) {
  const read = table => tx.unsafe(`SELECT * FROM ${table} ORDER BY 1`);
  const catalog = {
    companies: await read('companies'), branches: await read('branches'), companyBranches: await read('company_branches'),
    departments: await read('departments'), branchScopes: await read('organization_branch_scopes'), positions: await read('positions'),
    grades: await read('job_grades'), workLocations: await read('work_locations'), hrRules: await read('hr_responsibility_rules'), jobTitles: await read('job_titles'),
  };
  const employees = await tx`SELECT id,employee_code,name_en,name_ar,employment_status,company_id,branch_id,department_id,section_id,team_id,position_id,job_title_id,work_location_id,grade_id,manager_id,hr_user_id FROM employees ORDER BY id`;
  const roster = await tx.unsafe(HR_ROSTER_SQL);
  const current = employees.filter(e => ['active', 'probation', 'notice_period'].includes(e.employment_status));
  const count = key => JSON.stringify(Object.fromEntries([...current.reduce((m, e) => m.set(e[key] ?? 'none', (m.get(e[key] ?? 'none') || 0) + 1), new Map())].sort()));
  return {
    issues: organizationIntegrityIssues(catalog, employees, roster),
    totals: { all: employees.length, current: current.length, byCompany: count('company_id'), byBranch: count('branch_id') },
    codes: employees.map(e => `${e.id}:${e.employee_code}`).join('|'),
  };
}

let result;
try {
  await sql.begin(async tx => {
    await tx`SET LOCAL lock_timeout = '10s'`;
    await tx`SELECT pg_advisory_xact_lock(78231)`;
    const before = await snapshot(tx);

    // 1. Branches: remove the never-used test branch "0" (no company, employee, rule, scope or location refs).
    const [branchRefs] = await tx`SELECT (SELECT count(*)::int FROM company_branches WHERE branch_id=1) links, (SELECT count(*)::int FROM employees WHERE branch_id=1) employees,
      (SELECT count(*)::int FROM hr_responsibility_rules WHERE branch_id=1) rules, (SELECT count(*)::int FROM organization_branch_scopes WHERE branch_id=1) scopes, (SELECT count(*)::int FROM work_locations WHERE branch_id=1) locations`;
    if (Object.values(branchRefs).some(n => n > 0)) fail(`branch #1 is referenced: ${JSON.stringify(branchRefs)}`);
    const [branch0] = await tx`SELECT * FROM branches WHERE id=1 FOR UPDATE`;
    if (!branch0 || branch0.code !== '0' || branch0.name_en !== '0' || branch0.country !== 'Andorra') fail('branch #1 is not the expected test branch');
    await tx`DELETE FROM branches WHERE id=1`;
    await audit(tx, 'organization_cleanup_delete', 'branches', 1, branch0, null);
    log.push({ table: 'branches', id: 1, before: branch0, after: null, note: 'invalid test branch "0" deleted (zero references)' });

    // 2. Companies
    await update(tx, 'companies', 7, { name_ar: 'وكاله كون' }, { name_ar: 'وكالة كون' }, 'Arabic spelling');

    // 3. KOON Software
    await update(tx, 'departments', 1, { company_id: 5, name_ar: 'تكنولوجيا' }, { name_ar: 'التكنولوجيا' }, 'Technology Arabic name');
    await update(tx, 'departments', 76, { company_id: 5, name_ar: 'امن الشبكات' }, { name_ar: 'أمن الشبكات' }, 'Arabic spelling');
    await assertUnitUnreferenced(tx, 18);
    await update(tx, 'departments', 18, { company_id: 5, parent_id: 1, organization_kind: 'team' }, { organization_kind: 'section' }, 'Mobile App Development: team -> section like its four siblings (no references)');
    await update(tx, 'job_titles', 47, { name_en: 'Network  Security' }, { name_ar: 'أخصائي أمن الشبكات', name_en: 'Network & Security Specialist' }, 'bad title name');
    await update(tx, 'positions', 11, { company_id: 5, job_title_id: 47 }, { name_ar: 'أخصائي أمن الشبكات', name_en: 'Network & Security Specialist' }, 'bad position name');
    await update(tx, 'positions', 8, { company_id: 5, job_title_id: null, section_id: 73 }, { job_title_id: 45 }, 'link Web Developer title (holders E1,E3,E7,E18 already have T45)');
    await update(tx, 'positions', 9, { company_id: 5, job_title_id: null, section_id: 73 }, { name_ar: 'مطور تطبيقات موبايل', job_title_id: 46 }, 'link Mobile App Developer title (holders E2,E13 already have T46)');
    await update(tx, 'positions', 12, { company_id: 5, job_title_id: null, section_id: 75 }, { job_title_id: 48 }, 'link IT Support Specialist title (no holders)');

    // 4. Asus Cards — Human Resources / General Services
    await update(tx, 'departments', 3, { company_id: 6, organization_kind: 'department', manager_employee_id: 20 }, { name_ar: 'الموارد البشرية', name_en: 'Human Resources' }, 'canonical Human Resources');
    await retireUnit(tx, 80, { company_id: 6, name_ar: 'الموارد البشريه' }, 'duplicate Human Resources (unreferenced)');
    await update(tx, 'departments', 86, { company_id: 6, organization_kind: 'section', parent_id: 3, manager_employee_id: 5 }, { name_ar: 'الخدمات العامة', name_en: 'General Services' }, 'canonical General Services (section under HR)');
    await moveEmployees(tx, 'department_id=90', [14, 30, 78], { department_id: 3, section_id: 86 }, 'General Services duplicate U90/U91 -> HR U3 / General Services U86');
    await update(tx, 'positions', 22, { department_id: 90, section_id: 91 }, { department_id: 3, section_id: 86 }, 'General Services Specialist position -> canonical units');
    await update(tx, 'job_titles', 61, { department_id: null }, { department_id: 3 }, 'General Services Specialist bound to HR (titles bind to departments)');
    await retireUnit(tx, 91, { parent_id: 90, name_en: 'General Services' }, 'duplicate General Services section (General Services -> General Services)');
    await retireUnit(tx, 90, { parent_id: null, name_en: 'General Services' }, 'duplicate General Services department');
    await archiveTitle(tx, 3, { department_id: 3, name_en: 'HR Manager' }, 'duplicate HR Manager (unreferenced; T58 kept, held by E5/E20)');
    await update(tx, 'job_titles', 58, { department_id: 3, name_en: 'HR Manager' }, { name_ar: 'مدير الموارد البشرية' }, 'Arabic spelling');

    // 5. Asus Cards — Finance / Accounting
    await update(tx, 'departments', 79, { company_id: 6, organization_kind: 'department', manager_employee_id: 37 }, { name_ar: 'المالية', name_en: 'Finance' }, 'canonical Finance');
    await update(tx, 'departments', 85, { company_id: 6, organization_kind: 'section', parent_id: 12, manager_employee_id: 37 }, { parent_id: 79, name_ar: 'الحسابات', name_en: 'Accounting' }, 'canonical Accounting section moved under Finance');
    await moveEmployees(tx, 'department_id=12', [28, 31, 37], { department_id: 79 }, 'Accounting department U12 -> Finance U79 (section Accounting U85 kept)');
    await update(tx, 'positions', 18, { department_id: 12, section_id: 85 }, { department_id: 79, section_id: null }, 'Finance Manager belongs to Finance itself (no holders)');
    await update(tx, 'positions', 19, { department_id: 12, section_id: 85 }, { department_id: 79 }, 'Accounting Manager');
    await update(tx, 'positions', 20, { department_id: 12, section_id: 85 }, { department_id: 79 }, 'Accountant');
    await update(tx, 'job_titles', 25, { department_id: 12 }, { department_id: 79 }, 'Accountant -> Finance');
    await update(tx, 'job_titles', 55, { department_id: 12 }, { department_id: 79, name_ar: 'مدير المالية' }, 'Finance Manager -> Finance, Arabic spelling');
    await update(tx, 'job_titles', 56, { department_id: null }, { department_id: 79 }, 'Accounting Manager (held by E37) -> Finance');
    await archiveTitle(tx, 28, { department_id: 12, name_en: 'Accounting Manager' }, 'duplicate Accounting Manager (unreferenced; T56 kept)');
    await archiveTitle(tx, 57, { department_id: 12, name_en: 'Accountant' }, 'duplicate Accountant (unreferenced; T25 kept)');
    await retireUnit(tx, 12, { parent_id: null, name_en: 'Accounting' }, 'duplicate Accounting department (Accounting -> Accounting)');

    // 6. Asus Cards — Sales, Contracts, Operations, Business Development
    await update(tx, 'departments', 83, { company_id: 6, parent_id: 77, name_en: 'المبيعات' }, { name_en: 'Sales' }, 'English name');
    await retireUnit(tx, 88, { parent_id: 78, name_en: 'Contracts' }, 'duplicate Contracts section (Contracts -> Contracts)');
    await update(tx, 'departments', 81, { company_id: 6, organization_kind: 'department', manager_employee_id: 36 }, { name_ar: 'التشغيل', name_en: 'Operations' }, 'canonical Operations');
    await moveEmployees(tx, 'section_id=89', [36], { section_id: null }, 'Operations section U89 merged into Operations U81');
    await retireUnit(tx, 89, { parent_id: 81, name_en: 'Operations' }, 'duplicate Operations section (Operations -> Operations)');
    await update(tx, 'job_titles', 60, { department_id: 81, name_ar: 'التشغيليه' }, { name_ar: 'مدير التشغيل', name_en: 'Operations Manager' }, 'invalid title "Operations" -> Operations Manager (holder E36 manages U81; position P25 already says Operations Manager)');
    await update(tx, 'job_titles', 53, { department_id: 77 }, { name_ar: 'أخصائي دعم العملاء' }, 'Arabic spelling');
    await update(tx, 'job_titles', 54, { department_id: 78 }, { name_ar: 'أخصائي تعاقدات' }, 'Arabic spelling');
    await update(tx, 'departments', 82, { company_id: 6, name_ar: 'تطوير الاعمال' }, { name_ar: 'تطوير الأعمال' }, 'Arabic spelling');
    await update(tx, 'departments', 87, { company_id: 6, parent_id: 82, name_ar: 'اسس للتجار' }, { name_ar: 'ASUS للتجار' }, 'Arabic name');

    // 7. Asus Cards CEO: the company-scoped position becomes the company CEO position (holder E33 has no manager).
    await update(tx, 'positions', 13, { company_id: 6, job_title_id: 50, is_ceo: 0 }, { is_ceo: 1 }, 'Asus Cards CEO position (company-scoped, like Agency P26)');

    // 8. KOON Agency: the company is not a department — CEO becomes company-level, unit U72 retired.
    await update(tx, 'employees', 6, { company_id: 7, department_id: 72, position_id: 26 }, { department_id: null }, 'Agency CEO is company-level (like Asus CEO E33)');
    await update(tx, 'positions', 26, { company_id: 7, department_id: 72, is_ceo: 1 }, { department_id: null }, 'CEO position company-level');
    await archiveTitle(tx, 4, { department_id: 72, name_en: 'Marketing Manager' }, 'duplicate Marketing Manager bound to U72 (unreferenced; T66 kept)');
    await update(tx, 'departments', 93, { company_id: 7, organization_kind: 'department', parent_id: null }, { organization_kind: 'section', parent_id: 92 }, 'Digital Marketing under Marketing');
    await update(tx, 'departments', 94, { company_id: 7, organization_kind: 'department', parent_id: null }, { organization_kind: 'section', parent_id: 92, name_ar: 'التواصل الاجتماعي' }, 'Social Media under Marketing, Arabic spelling');
    await moveEmployees(tx, 'department_id=93', [10, 34], { department_id: 92, section_id: 93 }, 'Digital Marketing is now a section of Marketing');
    await moveEmployees(tx, 'department_id=94', [26], { department_id: 92, section_id: 94 }, 'Social Media is now a section of Marketing');
    for (const id of [68, 77]) await update(tx, 'job_titles', id, { department_id: 93 }, { department_id: 92 }, 'Digital Marketing title -> Marketing (titles bind to departments)');
    await update(tx, 'job_titles', 69, { department_id: 94 }, { department_id: 92 }, 'Social Media title -> Marketing');
    await update(tx, 'job_titles', 78, { department_id: 94 }, { department_id: 92, name_ar: 'كاتب محتوى' }, 'Content Creator -> Marketing, Arabic spelling');
    await archiveTitle(tx, 67, { department_id: 92, name_en: 'Digital Marketing Manager' }, 'duplicate Digital Marketing Manager (unreferenced; T77 kept, held by E34)');
    await update(tx, 'departments', 96, { company_id: 7, name_ar: 'واجهة وتجربة مستخدم' }, { name_ar: 'واجهة وتجربة المستخدم' }, 'Arabic name');
    const agencyPositions = [
      [27, { department_id: null, job_title_id: null }, { department_id: 92 }, 'Marketing Manager position -> Marketing (holder E34; title left empty, see report)'],
      [28, { department_id: 72, job_title_id: null }, { department_id: 92, section_id: 93, job_title_id: 77 }, 'Digital Marketing Manager position'],
      [29, { department_id: null, job_title_id: null }, { department_id: 92, section_id: 93, job_title_id: 68 }, 'Digital Marketing Specialist position (holder E10 has T68)'],
      [30, { department_id: 72, job_title_id: null }, { department_id: 92, section_id: 94, job_title_id: 69 }, 'Social Media Specialist position'],
      [31, { department_id: null, job_title_id: null }, { department_id: 95, job_title_id: 70 }, 'Design Manager position (holder E41 has T70)'],
      [32, { department_id: null, job_title_id: null }, { department_id: 95, job_title_id: 71 }, 'Graphic Designer position (holder E17 has T71)'],
      [33, { department_id: null, job_title_id: null }, { department_id: 96, job_title_id: 72 }, 'UI/UX Designer position (holders E24,E39 have T72)'],
      [34, { department_id: null, job_title_id: null }, { department_id: 97, job_title_id: 73 }, 'Sales Manager position'],
      [35, { department_id: null, job_title_id: null }, { department_id: 97, job_title_id: 74 }, 'Sales Specialist position (holder E42 has T74)'],
      [36, { department_id: null, job_title_id: null }, { department_id: 98, job_title_id: 75 }, 'Projects Manager position (holder E40 has T75)'],
      [37, { department_id: null, job_title_id: null }, { department_id: 98, job_title_id: 76 }, 'Projects Specialist position (holder E16 has T76)'],
      [38, { department_id: 94, job_title_id: 69 }, { name_ar: 'كاتب محتوى', department_id: 92, section_id: 94, job_title_id: 78 }, 'Content Creator position: correct title and units (no holders)'],
    ];
    for (const [id, expect, set, note] of agencyPositions) await update(tx, 'positions', id, { company_id: 7, ...expect }, set, note);
    await retireUnit(tx, 72, { company_id: 7, name_en: 'KOON Agency' }, 'company-as-department retired (only deleted employee E43 still points at it)');

    // 9. HR responsibility: Asus Cards / Riyadh belongs to the Asus HR Manager AC-016, verified first.
    const [hr] = await tx`SELECT e.id, e.employee_code, e.company_id, e.branch_id, e.employment_status, u.status account_status, r.name role, h.status roster_status
      FROM users u JOIN employees e ON e.id=u.employee_id JOIN roles r ON r.id=u.role_id JOIN hr_responsibles h ON h.user_id=u.id WHERE u.id=18`;
    if (!hr || hr.employee_code !== 'AC-016' || hr.company_id !== 6 || hr.employment_status !== 'active' || hr.account_status !== 'active' || hr.role !== 'HR Manager' || hr.roster_status !== 'active') fail(`user 18 is not an eligible Asus Cards HR: ${JSON.stringify(hr)}`);
    await update(tx, 'hr_responsibility_rules', 2, { company_id: 6, branch_id: 2, hr_user_id: 17, status: 'active' }, { hr_user_id: 18 }, 'Asus Cards / Riyadh -> ماجد العنزي (AC-016, Asus Cards, active HR Manager)');

    // Verification inside the transaction.
    const after = await snapshot(tx);
    if (JSON.stringify(after.totals) !== JSON.stringify(before.totals)) fail(`headcounts changed: ${JSON.stringify(before.totals)} -> ${JSON.stringify(after.totals)}`);
    if (after.codes !== before.codes) fail('employee ids/codes changed');
    if (after.issues.length) fail(`integrity issues remain: ${JSON.stringify(after.issues, null, 1)}`);
    result = { mode: APPLY ? 'apply' : 'dry-run', at: new Date().toISOString(), before: { totals: before.totals, issues: before.issues }, after: { totals: after.totals, issues: after.issues }, changes: log };
    if (!APPLY) throw ROLLBACK;
  });
} catch (error) {
  if (error !== ROLLBACK) { console.error(error.message); process.exitCode = 1; }
} finally { await sql.end(); }

if (result) {
  fs.mkdirSync('outputs/org-cleanup-2026-10-04', { recursive: true });
  const file = `outputs/org-cleanup-2026-10-04/${result.mode}-result.json`;
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`${result.mode}: ${result.changes.length} changes, ${result.before.issues.length} -> ${result.after.issues.length} integrity issues; totals ${JSON.stringify(result.after.totals)}; ${APPLY ? 'COMMITTED' : 'ROLLED BACK'}; report ${file}`);
}
