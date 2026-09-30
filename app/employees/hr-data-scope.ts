import { effectiveHrSql } from './hr-assignment.ts';
import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";

type Db = PostgresDatabase | TransactionDatabase;

/**
 * Which employees an HR account may see. `all` (the default, and the HR manager's setting) is the whole company;
 * `assigned` is a branch HR: only the employees whose resolved HR responsible is this account (employee override,
 * then Company + Branch rule, then Branch fallback — the same resolver that routes their requests), plus themself.
 * Super Admin is always `all`. Other roles keep their own department/self scoping and are not affected.
 */
export type HrDataScope = 'all' | 'assigned';
export const HR_DATA_SCOPES: readonly HrDataScope[] = ['all', 'assigned'];
export const HR_SCOPED_ROLES = ["Super Admin", "HR Manager"] as const;

export type ScopeActor = { id: number; roleName: string; employeeId: number | null; hrDataScope?: HrDataScope | string | null };

export function normalizeHrDataScope(value: unknown): HrDataScope {
  return value === 'assigned' ? 'assigned' : 'all';
}

/** True only for Super Admin and for HR Manager accounts left on the company-wide setting. */
export function seesWholeCompany(actor: Pick<ScopeActor, 'roleName' | 'hrDataScope'>) {
  if (actor.roleName === "Super Admin") return true;
  return actor.roleName === "HR Manager" && normalizeHrDataScope(actor.hrDataScope) === 'all';
}

/** A branch-scoped HR account: HR privileges, but limited to the employees it is responsible for. */
export function isBranchScopedHr(actor: Pick<ScopeActor, 'roleName' | 'hrDataScope'>) {
  return actor.roleName === "HR Manager" && normalizeHrDataScope(actor.hrDataScope) === 'assigned';
}

export async function readHrDataScope(db: Db, userId: number): Promise<HrDataScope> {
  const row = await db.prepare("SELECT hr_data_scope FROM users WHERE id=?").bind(userId).first<{ hr_data_scope: string | null }>();
  return normalizeHrDataScope(row?.hr_data_scope);
}

/**
 * SQL predicate over an employees row aliased `e` for a branch-scoped HR account, or null when the actor is not
 * branch-scoped (whole company, or a role whose scoping is handled elsewhere).
 */
export async function branchHrEmployeeSql(db: Db, actor: ScopeActor): Promise<string | null> {
  if (!isBranchScopedHr(actor)) return null;
  const hrSql = await effectiveHrSql(db);
  return `(${hrSql}=${Number(actor.id)} OR e.id=${Number(actor.employeeId) || -1})`;
}

/** The employee ids a branch-scoped HR account may see, or null when it is not branch-scoped. */
export async function branchHrEmployeeIds(db: Db, actor: ScopeActor): Promise<number[] | null> {
  const predicate = await branchHrEmployeeSql(db, actor);
  if (predicate === null) return null;
  const rows = (await db.prepare(`SELECT e.id FROM employees e WHERE e.employment_status!='deleted' AND ${predicate}`).all<{ id: number }>()).results;
  return rows.map(row => Number(row.id));
}

export async function branchHrCanSee(db: Db, actor: ScopeActor, employeeId: number): Promise<boolean> {
  const predicate = await branchHrEmployeeSql(db, actor);
  if (predicate === null) return true;
  return Boolean(await db.prepare(`SELECT 1 AS ok FROM employees e WHERE e.id=? AND ${predicate}`).bind(employeeId).first());
}
