/**
 * Payroll country, decided in one place. Payroll runs only in Egypt and KSA. Stored values vary
 * ("KSA", "Saudi Arabia", Arabic names), so they are normalized when read and never rewritten.
 * An employee with no recognizable stored payroll country has none: there is deliberately no
 * fallback to the work country, branch or salary currency.
 */
export type PayrollCountry = "Egypt" | "KSA";
export const PAYROLL_COUNTRIES: readonly PayrollCountry[] = ["Egypt", "KSA"];

const EGYPT_ALIASES = ["egypt", "eg", "egy", "مصر", "جمهورية مصر العربية"];
const KSA_ALIASES = ["ksa", "saudi arabia", "saudi", "sa", "kingdom of saudi arabia", "السعودية", "المملكة العربية السعودية"];
const ALIASES: Record<string, PayrollCountry> = Object.fromEntries([...EGYPT_ALIASES.map(alias => [alias, "Egypt"]), ...KSA_ALIASES.map(alias => [alias, "KSA"])]);

/** Canonical payroll country for a stored or submitted value; null when it is empty or not a payroll country. */
export function normalizePayrollCountry(value: unknown): PayrollCountry | null {
  return ALIASES[String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase()] ?? null;
}

/** The employee's payroll country from the stored salary_country only. Null means unresolved. */
export function employeePayrollCountry(employee: { salary_country?: unknown }): PayrollCountry | null {
  return normalizePayrollCountry(employee.salary_country);
}

const sqlList = (aliases: string[]) => aliases.map(alias => `'${alias.replace(/'/g, "''")}'`).join(",");
/** SQL twin of employeePayrollCountry for a salary_country column; yields NULL when unresolved. */
export function payrollCountrySql(column = "e.salary_country"): string {
  const value = `lower(regexp_replace(btrim(coalesce(${column},'')),'\\s+',' ','g'))`;
  return `(CASE WHEN ${value} IN (${sqlList(EGYPT_ALIASES)}) THEN 'Egypt' WHEN ${value} IN (${sqlList(KSA_ALIASES)}) THEN 'KSA' END)`;
}
