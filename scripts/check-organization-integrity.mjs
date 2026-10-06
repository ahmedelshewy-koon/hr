// Read-only integrity check of the live organization data (hierarchy, duplicates, titles, CEO positions, HR rules,
// current employee assignments) plus headcounts. The session is read-only: any write would fail.
// Usage: node scripts/check-organization-integrity.mjs [--json]
import postgres from 'postgres';
import { organizationIntegrityIssues } from '../app/organization/integrity.ts';
import { HR_ROSTER_SQL } from '../app/organization/hr-roster.ts';

const url = process.env.DATABASE_URL || 'postgresql://koon_hr_admin@127.0.0.1:5545/koon_hr';
const sql = postgres(url, { connection: { default_transaction_read_only: 'on' }, max: 1 });
try {
  const read = table => sql.unsafe(`SELECT * FROM ${table} ORDER BY 1`);
  const catalog = {
    companies: await read('companies'), branches: await read('branches'), companyBranches: await read('company_branches'),
    departments: await read('departments'), branchScopes: await read('organization_branch_scopes'), positions: await read('positions'),
    grades: await read('job_grades'), workLocations: await read('work_locations'), hrRules: await read('hr_responsibility_rules'), jobTitles: await read('job_titles'),
  };
  const employees = await sql`SELECT id,employee_code,name_en,name_ar,employment_status,company_id,branch_id,department_id,section_id,team_id,position_id,job_title_id,work_location_id,grade_id,manager_id,hr_user_id FROM employees ORDER BY id`;
  const roster = await sql.unsafe(HR_ROSTER_SQL.replace(/\?/g, ''));
  const issues = organizationIntegrityIssues(catalog, employees, roster);
  const current = employees.filter(e => ['active', 'probation', 'notice_period'].includes(e.employment_status));
  const count = key => Object.fromEntries([...current.reduce((m, e) => m.set(e[key] ?? 'none', (m.get(e[key] ?? 'none') || 0) + 1), new Map())].sort());
  const result = { currentEmployees: current.length, byCompany: count('company_id'), byBranch: count('branch_id'), issues };
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`current employees: ${result.currentEmployees}  by company: ${JSON.stringify(result.byCompany)}  by branch: ${JSON.stringify(result.byBranch)}`);
    for (const issue of issues) console.log(`${issue.code}  ${issue.type}#${issue.id}  ${issue.message}`);
    console.log(`${issues.length} issue(s)`);
  }
  process.exitCode = issues.length ? 1 : 0;
} finally { await sql.end(); }
