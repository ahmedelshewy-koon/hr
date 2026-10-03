// Gives every employee a short per-company code (KS-001, AC-001, ...) and keeps the old one in legacy_employee_code.
//   node scripts/renumber-employee-codes.mjs            dry run: prints the old → new mapping, changes nothing
//   node scripts/renumber-employee-codes.mjs --apply    writes the mapping in one transaction (audit-logged)
// Needs migration 0034_employee_codes. Safe to re-run: employees that already have a code in their company's
// PREFIX-n sequence keep it; only the others are numbered after the highest existing number.
import fs from "node:fs";
import postgres from "postgres";

const apply = process.argv.includes("--apply");
const local = fs.existsSync(".dev.vars") ? fs.readFileSync(".dev.vars", "utf8") : "";
const url = process.env.DATABASE_URL || local.match(/^DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!url) throw new Error("DATABASE_URL is required");
const DEFAULT_PREFIX = "EMP";

/** Same rule as suggestedCodePrefix in app/employees/employee-code.ts. */
function suggestedCodePrefix(name) {
  const words = String(name || "").normalize("NFKD").replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const initials = words.map(word => word[0]).join("").toUpperCase().slice(0, 4);
  return initials.length >= 2 ? initials : (words[0] || "").toUpperCase().slice(0, 3) || DEFAULT_PREFIX;
}
const format = (prefix, number) => `${prefix}-${String(number).padStart(3, "0")}`;
const ROLLBACK = Symbol("dry run");

const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
try {
  await sql.begin(async tx => {
    const [columns] = await tx`SELECT count(*)::int AS n FROM information_schema.columns WHERE (table_name='companies' AND column_name='employee_code_prefix') OR (table_name='employees' AND column_name='legacy_employee_code')`;
    if (columns.n !== 2) throw new Error("Apply migration 0034_employee_codes first");
    await tx`SELECT pg_advisory_xact_lock(78231)`;
    await tx`LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`;

    // 1. Company prefixes: keep any already set, derive the rest from the company name and keep them unique.
    const companies = await tx`SELECT id, name, name_en, employee_code_prefix FROM companies ORDER BY id FOR UPDATE`;
    const used = new Set([DEFAULT_PREFIX, ...companies.map(c => c.employee_code_prefix).filter(Boolean)]);
    const prefixChanges = [];
    for (const company of companies) {
      if (company.employee_code_prefix) continue;
      const base = suggestedCodePrefix(company.name_en || company.name);
      let prefix = base, n = 2;
      while (used.has(prefix)) prefix = `${base}${n++}`;
      used.add(prefix);
      company.employee_code_prefix = prefix;
      prefixChanges.push({ company: company.name_en || company.name, prefix });
      await tx`UPDATE companies SET employee_code_prefix=${prefix}, updated_at=CURRENT_TIMESTAMP WHERE id=${company.id}`;
    }
    const prefixOf = new Map(companies.map(c => [Number(c.id), c.employee_code_prefix]));

    // 2. Number each company's employees: current staff by start date first, then deleted records.
    const employees = await tx`SELECT id, employee_code, company_id, start_date, employment_status, name_en FROM employees
      ORDER BY company_id NULLS LAST, (employment_status='deleted'), start_date NULLS LAST, id`;
    const groups = new Map();
    for (const employee of employees) {
      const prefix = prefixOf.get(Number(employee.company_id)) || DEFAULT_PREFIX;
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix).push(employee);
    }
    const mapping = [];
    for (const [prefix, rows] of groups) {
      const pattern = new RegExp(`^${prefix}-(\\d+)$`);
      let last = Math.max(0, ...employees.map(e => Number(pattern.exec(e.employee_code)?.[1] || 0)));
      for (const employee of rows) {
        if (pattern.test(employee.employee_code)) continue;
        mapping.push({ id: employee.id, name: employee.name_en, status: employee.employment_status, from: employee.employee_code, to: format(prefix, ++last) });
      }
    }

    // 3. Two passes so a new code never collides with an old one still in place.
    for (const row of mapping) await tx`UPDATE employees SET legacy_employee_code=COALESCE(legacy_employee_code, employee_code), employee_code=${`TMP-RENUMBER-${row.id}`} WHERE id=${row.id}`;
    for (const row of mapping) {
      await tx`UPDATE employees SET employee_code=${row.to}, updated_at=CURRENT_TIMESTAMP WHERE id=${row.id}`;
      await tx`INSERT INTO audit_logs(user_id,action,module,record_type,record_id,previous_value,new_value) VALUES (NULL,'renumber_employee_code','employees','employee',${String(row.id)},${JSON.stringify({ employee_code: row.from })},${JSON.stringify({ employee_code: row.to, legacy_employee_code: row.from })})`;
    }
    const [check] = await tx`SELECT count(*)::int AS total, count(DISTINCT employee_code)::int AS distinct_codes, count(*) FILTER (WHERE employee_code LIKE 'TMP-RENUMBER-%')::int AS leftovers FROM employees`;
    if (check.total !== employees.length || check.total !== check.distinct_codes || check.leftovers) throw new Error(`Post-check failed: ${JSON.stringify(check)}`);

    if (prefixChanges.length) console.table(prefixChanges);
    console.table(mapping.map(({ id, name, status, from, to }) => ({ id, name, status, from, to })));
    console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run (rolled back)", renumbered: mapping.length, employees: check.total }));
    if (!apply) throw ROLLBACK;
  });
} catch (error) {
  if (error !== ROLLBACK) throw error;
} finally {
  await sql.end({ timeout: 5 });
}
