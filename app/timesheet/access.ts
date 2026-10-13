import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";
import type { ApiActor } from "../api/api-security";
import { MANAGED_DEPARTMENTS_CTE } from "../organization/department-scope.ts";
import { employeePayrollCountry } from "./time.ts";
import { branchHrEmployeeIds, isBranchScopedHr, seesWholeCompany } from "../employees/hr-data-scope.ts";

type Db = PostgresDatabase | TransactionDatabase;

/** The permission module of the page (page id `timesheet_management`, route /timesheet-management). */
export const TIMESHEET_MODULE = "timesheetManagement";
export const TIMESHEET_ACTIONS = ["view", "create", "edit", "delete", "approve", "export", "manage_settings"] as const;

export type TimesheetAccess = {
  canView: boolean;
  /** Add / edit / approve / recalculate / confirm month: Super Admin or HR with the edit permission. */
  canEdit: boolean;
  canApprove: boolean;
  canExport: boolean;
  /** Master admin only: unlock a confirmed month, unlock a payroll month. */
  isMaster: boolean;
};

export async function timesheetAccess(db: Db, actor: Pick<ApiActor, "id" | "roleId" | "roleName">): Promise<TimesheetAccess> {
  const isMaster = actor.roleName === "Super Admin";
  const isHr = isMaster || actor.roleName === "HR Manager";
  const granted = new Set<string>();
  if (!isMaster) {
    const rows = (await db.prepare("SELECT action FROM permissions WHERE role_id=? AND module=? AND allowed=1").bind(actor.roleId, TIMESHEET_MODULE).all<{ action: string }>()).results;
    for (const row of rows) granted.add(row.action);
  }
  const payrollTables=await db.prepare("SELECT to_regclass('public.hr_managers') IS NOT NULL AND to_regclass('public.user_permissions') IS NOT NULL AS ready").first<{ready:boolean}>();
  const listedManager=isMaster||!payrollTables?.ready||Boolean(await db.prepare("SELECT 1 AS listed FROM hr_managers WHERE user_id=? AND is_active=1").bind(actor.id).first());
  const personal=payrollTables?.ready&&!isMaster?await db.prepare("SELECT allowed FROM user_permissions WHERE user_id=? AND menu_item=? ORDER BY id DESC LIMIT 1").bind(actor.id,TIMESHEET_MODULE).first<{allowed:number}>():null;
  const allows = (action: string) => listedManager && (isMaster || granted.has(action)) && (personal==null || Boolean(personal.allowed));
  return {
    canView: allows("view"),
    canEdit: isHr && allows("edit"),
    canApprove: isHr && (allows("approve") || allows("edit")),
    canExport: allows("export") || allows("view"),
    isMaster,
  };
}

/**
 * The employees the actor may see on the timesheet, or null for everyone. Same boundaries as the rest of the app: the whole
 * company for Super Admin and company-wide HR, the responsible employees for a branch HR (the HR Manager's "linked
 * working business units"), a manager's departments plus themself, and only themself for any other role.
 */
/**
 * Payroll's HR manager assignment (hr_managers + hr_manager_business_units, migration 0053): an HR manager sees only the
 * employees of their linked working business units, limited to their region. Read-only and guarded, so the timesheet keeps
 * working before that migration exists. Returns undefined when the actor has no assignment.
 */
async function assignedHrEmployeeIds(db: Db, actor: ApiActor): Promise<number[] | undefined> {
  if (actor.roleName === "Super Admin") return undefined;
  const ready = await db.prepare("SELECT to_regclass('public.hr_managers') IS NOT NULL AND to_regclass('public.hr_manager_business_units') IS NOT NULL AS ready").first<{ ready: boolean }>();
  if (!ready?.ready) return undefined;
  const manager = await db.prepare("SELECT id,region FROM hr_managers WHERE user_id=? AND is_active=1").bind(actor.id).first<{ id: number; region: string | null }>();
  if (!manager) return undefined;
  const units = (await db.prepare("SELECT business_unit_id FROM hr_manager_business_units WHERE manager_id=?").bind(manager.id).all<{ business_unit_id: number }>()).results.map(row => Number(row.business_unit_id));
  const rows = (await db.prepare("SELECT id,country,salary_country,working_business_unit_id FROM employees WHERE employment_status!='deleted'").all()).results;
  return rows.filter(row => (!manager.region || employeePayrollCountry(row) === manager.region) && (!units.length || units.includes(Number(row.working_business_unit_id)))).map(row => Number(row.id));
}

export async function visibleEmployeeIds(db: Db, actor: ApiActor): Promise<number[] | null> {
  const assigned = await assignedHrEmployeeIds(db, actor);
  if (assigned) return assigned;
  if(actor.roleName==="HR Manager"){
    const ready=await db.prepare("SELECT to_regclass('public.hr_managers') IS NOT NULL AS ready").first<{ready:boolean}>();
    if(ready?.ready)return [];
  }
  if (seesWholeCompany(actor)) return null;
  if (isBranchScopedHr(actor)) return (await branchHrEmployeeIds(db, actor)) ?? [];
  const own = actor.employeeId ? [actor.employeeId] : [];
  if (actor.roleName !== "Department Manager" || !actor.employeeId) return own;
  const rows = (await db.prepare(`${MANAGED_DEPARTMENTS_CTE} SELECT id FROM employees WHERE employment_status!='deleted' AND department_id IN (SELECT id FROM managed)`).bind(actor.employeeId).all<{ id: number }>()).results;
  return [...new Set([...rows.map(row => Number(row.id)), ...own])];
}

export async function assertEmployeeVisible(db: Db, actor: ApiActor, employeeId: number) {
  const ids = await visibleEmployeeIds(db, actor);
  if (ids !== null && !ids.includes(employeeId)) throw new Response("Employee is outside your access scope", { status: 403 });
}
