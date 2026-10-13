import type { ApiActor } from "../api/api-security";
import type { PostgresDatabase, TransactionDatabase } from "../../db/postgres";

type Db = PostgresDatabase | TransactionDatabase;
type Actor = Pick<ApiActor, "id" | "roleId" | "roleName">;

export const PAYROLL_PAGE_PERMISSIONS = {
  "/payroll/element-setup": "payrollElementSetup",
  "/payroll/eligibility": "payrollEligibility",
  "/payroll/employee-elements": "payrollEmployeeElements",
  "/payroll/matrix-entry": "payrollMatrixEntry",
  "/payroll/variable-entry": "payrollVariableEntry",
  "/payroll/month-preview": "payrollMonthPreview",
  "/payroll/run": "payrollRun",
  "/deduction-rules-setup": "deductionRulesSetup",
  "/timesheet-management": "timesheetManagement",
  "/saved-attendance": "savedAttendance",
  "/attendance-type-setup": "attendanceTypeSetup",
  "/shift-plans-setup": "shiftPlansSetup",
  "/vacation-setup": "vacationSetup",
  "/hr-manager-setup": "hrManagerSetup",
  "/business-unit-setup": "businessUnitSetup",
  "/cost-center-setup": "costCenterSetup",
  "/business-unit-cost-center-mapping": "buCostCenterMapping",
  "/wfh-checkin": "wfhCheckin",
  "/zk-attendance-logs": "zkAttendanceLogs",
  "/sajel-erp-setup": "sajelErpSetup",
} as const;

export type PayrollPageKey = typeof PAYROLL_PAGE_PERMISSIONS[keyof typeof PAYROLL_PAGE_PERMISSIONS];
const actionPage: Record<string, PayrollPageKey> = {
  save_element: "payrollElementSetup",
  save_eligibility: "payrollEligibility",
  remove_eligibility: "payrollEligibility",
  save_employee_element: "payrollEmployeeElements",
  save_matrix_entries: "payrollMatrixEntry",
  save_variable: "payrollVariableEntry",
  delete_variable: "payrollVariableEntry",
  calculate_run: "payrollRun",
  confirm: "payrollRun",
  rollback: "payrollRun",
  lock: "payrollRun",
  unlock: "payrollRun",
  post_erp: "payrollRun",
  reset_failed_erp: "sajelErpSetup",
  submit_reconciliation: "sajelErpSetup",
  verify_reconciliation: "sajelErpSetup",
  rollback_sent: "sajelErpSetup",
  save_currency: "sajelErpSetup",
  save_business_unit: "businessUnitSetup",
  delete_business_unit: "businessUnitSetup",
  import_business_units: "businessUnitSetup",
  assign_business_unit: "businessUnitSetup",
  save_cost_center: "costCenterSetup",
  import_cost_centers: "costCenterSetup",
  bulk_delete_cost_centers: "costCenterSetup",
  save_mapping: "buCostCenterMapping",
  save_hr_manager: "hrManagerSetup",
  reorder_hr_managers: "hrManagerSetup",
  save_erp: "sajelErpSetup",
};

export function payrollPageForAction(action: string): PayrollPageKey | null {
  return actionPage[action] ?? null;
}

export async function hasPayrollPage(db: Db, actor: Actor, page: PayrollPageKey, action: "view" | "edit" = "view") {
  if (actor.roleName === "Super Admin") return true;
  const role = await db.prepare("SELECT allowed FROM permissions WHERE role_id=? AND module=? AND action=?")
    .bind(actor.roleId, page, action).first<{ allowed: number }>();
  if (!role?.allowed) return false;
  const personal = await db.prepare("SELECT allowed FROM user_permissions WHERE user_id=? AND menu_item=? ORDER BY id DESC LIMIT 1")
    .bind(actor.id, page).first<{ allowed: number }>();
  return personal == null || Boolean(personal.allowed);
}

export async function requirePayrollPage(db: Db, actor: Actor, page: PayrollPageKey, action: "view" | "edit" = "view") {
  if (!(await hasPayrollPage(db, actor, page, action))) throw new Response("Permission denied", { status: 403 });
}

export async function payrollPageGrants(db: Db, actor: Actor) {
  const entries = await Promise.all([...new Set(Object.values(PAYROLL_PAGE_PERMISSIONS))].map(async page =>
    [page, await hasPayrollPage(db, actor, page)] as const));
  return Object.fromEntries(entries) as Record<PayrollPageKey, boolean>;
}
