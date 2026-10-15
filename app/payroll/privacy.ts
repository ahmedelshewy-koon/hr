type Row = Record<string, unknown>;

const moneyFields = new Set([
  "amount", "basic", "basic_salary", "salary", "gross", "deductions",
  "employer", "net", "total_gross", "total_deductions", "total_net",
]);
const mask = (row: Row): Row => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [key, moneyFields.has(key) ? null : value]),
);
const maskRows = (rows: Row[] = []) => rows.map(mask);

/** Non-privileged viewers receive structure and status, never a monetary value that could reveal basic salary. */
export function redactPayrollPreview<T extends { people: Row[]; lines: Row[]; employees: Row[] }>(view: T): T {
  return { ...view, people: maskRows(view.people), lines: maskRows(view.lines), employees: maskRows(view.employees) };
}

export function redactPayrollWorkspace<T extends { employees: Row[]; runs: Row[]; variables: Row[]; recurring: Row[] }>(view: T): T {
  return { ...view, employees: maskRows(view.employees), runs: maskRows(view.runs), variables: maskRows(view.variables), recurring: maskRows(view.recurring) };
}

export function redactPayrollRunDetail<T extends { run: Row; lines: Row[] }>(view: T): T {
  return { ...view, run: mask(view.run), lines: maskRows(view.lines) };
}

/** Remove complete sections at the API boundary; hiding tabs alone is insufficient. */
export function filterPayrollWorkspace<T extends Record<string, unknown>>(view: T, grants: Record<string, boolean>): T {
  const copy: Record<string, unknown> = { ...view };
  const keep = (field: string, ...pages: string[]) => {
    if (!pages.some(page => grants[page])) copy[field] = field === "erp" || field === "lock" ? null : [];
  };
  keep("runs", "payrollRun");
  keep("variables", "payrollVariableEntry");
  keep("recurring", "payrollEmployeeElements", "payrollMatrixEntry");
  keep("eligibility", "payrollEligibility");
  keep("managers", "hrManagerSetup");
  keep("users", "hrManagerSetup");
  keep("erp", "sajelErpSetup");
  keep("mappings", "buCostCenterMapping");
  keep("employees", "payrollRun", "payrollMonthPreview", "payrollEmployeeElements", "payrollMatrixEntry", "payrollVariableEntry", "businessUnitSetup", "buCostCenterMapping");
  keep("elements", "payrollRun", "payrollMonthPreview", "payrollElementSetup", "payrollEligibility", "payrollEmployeeElements", "payrollMatrixEntry", "payrollVariableEntry");
  keep("currencies", "payrollRun", "sajelErpSetup");
  keep("businessUnits", "businessUnitSetup", "buCostCenterMapping", "hrManagerSetup");
  keep("costCenters", "costCenterSetup", "buCostCenterMapping");
  keep("departments", "payrollEligibility");
  keep("jobTitles", "payrollEligibility");
  keep("lock", "payrollRun", "payrollMonthPreview");
  return copy as T;
}
