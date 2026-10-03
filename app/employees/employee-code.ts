import type { TransactionDatabase } from "../../db/postgres";

export const DEFAULT_EMPLOYEE_CODE_PREFIX = "EMP";
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/;

/** KS + 7 → "KS-007". Numbers past 999 simply grow ("KS-1000"). */
export function formatEmployeeCode(prefix: string, number: number) {
  return `${prefix}-${String(number).padStart(3, "0")}`;
}

/** Initials of the English (or main) company name: "KOON Software" → "KS". */
export function suggestedCodePrefix(name: string) {
  const words = name.normalize("NFKD").replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const initials = words.map(word => word[0]).join("").toUpperCase().slice(0, 4);
  return initials.length >= 2 ? initials : (words[0] || "").toUpperCase().slice(0, 3) || DEFAULT_EMPLOYEE_CODE_PREFIX;
}

/** Trimmed, validated code typed by HR in the employee profile. Throws a 400 Response when invalid. */
export function cleanEmployeeCode(value: unknown) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) throw new Response("Employee code must be 1-30 letters, digits, - or _", { status: 400 });
  return code;
}

export async function companyCodePrefix(db: TransactionDatabase, companyId: unknown) {
  if (!Number(companyId)) return DEFAULT_EMPLOYEE_CODE_PREFIX;
  const company = await db.prepare("SELECT employee_code_prefix FROM companies WHERE id=?").bind(Number(companyId)).first<{ employee_code_prefix: string | null }>();
  return company?.employee_code_prefix || DEFAULT_EMPLOYEE_CODE_PREFIX;
}

/**
 * Next free code in the company's sequence (highest existing PREFIX-n plus one).
 * Callers hold the employee-write advisory lock (validateEmployeeWrite), so two creates cannot pick the same number;
 * the unique index on employee_code is the final guard.
 */
export async function nextEmployeeCode(db: TransactionDatabase, companyId: unknown) {
  const prefix = await companyCodePrefix(db, companyId);
  const row = await db.prepare("SELECT COALESCE(MAX(substring(employee_code from '-([0-9]+)$')::int),0) AS last FROM employees WHERE employee_code ~ ('^' || ?::text || '-[0-9]+$')")
    .bind(prefix.replace(/[^A-Za-z0-9_]/g, "")).first<{ last: number }>();
  return formatEmployeeCode(prefix, Number(row?.last || 0) + 1);
}

/** Rejects a code already used by another employee, with a message HR can act on. */
export async function assertEmployeeCodeFree(db: TransactionDatabase, code: string, employeeId: number) {
  const taken = await db.prepare("SELECT id,name_en,name_ar FROM employees WHERE upper(employee_code)=upper(?) AND id<>?").bind(code, employeeId).first<{ id: number; name_ar: string | null; name_en: string | null }>();
  if (taken) throw new Response(`الرقم الوظيفي ${code} مستخدم بالفعل للموظف ${taken.name_ar || taken.name_en || taken.id} / Employee code ${code} is already used by ${taken.name_en || taken.name_ar || taken.id}`, { status: 409 });
}
