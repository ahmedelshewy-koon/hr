/**
 * Pure aggregation over timesheet rows, shared by the page (cards, naughty corner, deduction summary), the Excel export,
 * the print view and the payroll posting so they can never disagree. Rows are the API shape (snake_case columns).
 */
export type SheetRow = Record<string, unknown>;
export type CardKey = "approved" | "waiting" | "absent" | "late" | "early" | "overtime" | "vacation" | "holiday" | "wfh";
export const CARD_KEYS: readonly CardKey[] = ["approved", "waiting", "absent", "late", "early", "overtime", "vacation", "holiday", "wfh"];

const num = (value: unknown) => Number(value) || 0;
const status = (row: SheetRow) => String(row.status ?? "");

/** Which rows a summary card stands for; clicking a card filters the grid to exactly these. */
export function matchesCard(row: SheetRow, card: CardKey): boolean {
  switch (card) {
    case "approved": return status(row) === "approved";
    case "waiting": return status(row) === "pending" || status(row) === "waiting_for_exit";
    case "absent": return num(row.is_absent) === 1 || status(row) === "absent";
    case "late": return num(row.late_minutes) > 0;
    case "early": return num(row.early_leave_minutes) > 0;
    case "overtime": return num(row.overtime_minutes) > 0;
    case "vacation": return status(row) === "vacation";
    case "holiday": return status(row) === "holiday";
    case "wfh": return status(row) === "wfh";
  }
}
export const filterByCard = (rows: SheetRow[], card: CardKey | null | "") => (card ? rows.filter(row => matchesCard(row, card)) : rows);

export type Summary = {
  total: number; approved: number; waiting: number; absent: number; lateCount: number; lateMinutes: number; earlyCount: number; earlyMinutes: number;
  overtimeCount: number; overtimeMinutes: number; vacation: number; holiday: number; wfh: number; totalDeduction: number; totalOvertimeAmount: number; workMinutes: number;
};

export function summarize(rows: SheetRow[]): Summary {
  const summary: Summary = { total: rows.length, approved: 0, waiting: 0, absent: 0, lateCount: 0, lateMinutes: 0, earlyCount: 0, earlyMinutes: 0, overtimeCount: 0, overtimeMinutes: 0, vacation: 0, holiday: 0, wfh: 0, totalDeduction: 0, totalOvertimeAmount: 0, workMinutes: 0 };
  for (const row of rows) {
    if (matchesCard(row, "approved")) summary.approved++;
    if (matchesCard(row, "waiting")) summary.waiting++;
    if (matchesCard(row, "absent")) summary.absent++;
    if (matchesCard(row, "late")) { summary.lateCount++; summary.lateMinutes += num(row.late_minutes); }
    if (matchesCard(row, "early")) { summary.earlyCount++; summary.earlyMinutes += num(row.early_leave_minutes); }
    if (matchesCard(row, "overtime")) { summary.overtimeCount++; summary.overtimeMinutes += num(row.overtime_minutes); }
    if (matchesCard(row, "vacation")) summary.vacation++;
    if (matchesCard(row, "holiday")) summary.holiday++;
    if (matchesCard(row, "wfh")) summary.wfh++;
    // A rejected entry is not a valid record, so it costs nothing and earns nothing.
    if (status(row) !== "rejected") { summary.totalDeduction += num(row.deduction_amount); summary.totalOvertimeAmount += num(row.overtime_amount); }
    summary.workMinutes += num(row.total_work_minutes);
  }
  summary.totalDeduction = Math.round(summary.totalDeduction * 100) / 100;
  summary.totalOvertimeAmount = Math.round(summary.totalOvertimeAmount * 100) / 100;
  return summary;
}

export type NaughtyEntry = { employee_id: number; employee_name: string; employee_name_ar: string; department_name: string; count: number; minutes: number };

/** Employees who are late most often in the period. Approved delays already carry zero late minutes, so they never count. */
export function naughtyCorner(rows: SheetRow[], limit = 10): NaughtyEntry[] {
  const byEmployee = new Map<number, NaughtyEntry>();
  for (const row of rows) {
    const minutes = num(row.late_minutes);
    if (minutes <= 0 || status(row) === "rejected") continue;
    const id = num(row.employee_id), entry = byEmployee.get(id) ?? { employee_id: id, employee_name: String(row.employee_name ?? ""), employee_name_ar: String(row.employee_name_ar ?? ""), department_name: String(row.department_name ?? ""), count: 0, minutes: 0 };
    entry.count++; entry.minutes += minutes; byEmployee.set(id, entry);
  }
  return [...byEmployee.values()].sort((a, b) => b.count - a.count || b.minutes - a.minutes || a.employee_name.localeCompare(b.employee_name)).slice(0, limit);
}
export const lateRecords = (rows: SheetRow[], employeeId: number) =>
  rows.filter(row => num(row.employee_id) === employeeId && num(row.late_minutes) > 0).sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));

export type Component = { kind?: string; ruleId?: number; ruleEn?: string; ruleAr?: string; minutes?: number; amount?: number; wageDays?: number; fixedAmount?: number };
export const components = (row: SheetRow): Component[] => {
  try { const parsed = JSON.parse(String(row.deduction_details ?? "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

export type EmployeeDeduction = {
  employee_id: number; employee_code: string; employee_name: string; employee_name_ar: string; department_name: string; department_name_ar: string;
  lateCount: number; delayMinutes: number; earlyCount: number; earlyMinutes: number;
  absentWithNotice: number; absentWithoutNotice: number; absentUnset: number;
  delayAmount: number; absenceAmount: number; overtimeMinutes: number; overtimeAmount: number; totalDeduction: number; chargedAbsenceDays: number;
};
const money = (value: number) => Math.round(value * 100) / 100;

/** Deduction Summary: one line per employee. An absence whose notice is not set yet is listed but never charged. */
export function deductionSummary(rows: SheetRow[]): { employees: EmployeeDeduction[]; grand: Omit<EmployeeDeduction, "employee_id" | "employee_code" | "employee_name" | "employee_name_ar" | "department_name" | "department_name_ar"> } {
  const map = new Map<number, EmployeeDeduction>();
  const blank = () => ({ lateCount: 0, delayMinutes: 0, earlyCount: 0, earlyMinutes: 0, absentWithNotice: 0, absentWithoutNotice: 0, absentUnset: 0, delayAmount: 0, absenceAmount: 0, overtimeMinutes: 0, overtimeAmount: 0, totalDeduction: 0, chargedAbsenceDays: 0 });
  for (const row of rows) {
    if (status(row) === "rejected") continue;
    const id = num(row.employee_id);
    const entry = map.get(id) ?? { employee_id: id, employee_code: String(row.employee_code ?? ""), employee_name: String(row.employee_name ?? ""), employee_name_ar: String(row.employee_name_ar ?? ""), department_name: String(row.department_name ?? ""), department_name_ar: String(row.department_name_ar ?? ""), ...blank() };
    if (num(row.late_minutes) > 0) { entry.lateCount++; entry.delayMinutes += num(row.late_minutes); }
    if (num(row.early_leave_minutes) > 0) { entry.earlyCount++; entry.earlyMinutes += num(row.early_leave_minutes); }
    if (matchesCard(row, "absent")) {
      if (row.absence_has_notice === null || row.absence_has_notice === undefined) entry.absentUnset++;
      else if (num(row.absence_has_notice) === 1) entry.absentWithNotice++; else entry.absentWithoutNotice++;
    }
    for (const part of components(row)) {
      if (part.kind === "absence") { entry.absenceAmount += num(part.amount); if (num(part.amount) > 0 || num(part.wageDays) > 0) entry.chargedAbsenceDays++; }
      else entry.delayAmount += num(part.amount);
    }
    entry.overtimeMinutes += num(row.overtime_minutes); entry.overtimeAmount += num(row.overtime_amount);
    map.set(id, entry);
  }
  const employees = [...map.values()].map(entry => ({ ...entry, delayAmount: money(entry.delayAmount), absenceAmount: money(entry.absenceAmount), overtimeAmount: money(entry.overtimeAmount), totalDeduction: money(entry.delayAmount + entry.absenceAmount) }))
    .filter(entry => entry.lateCount || entry.earlyCount || entry.absentWithNotice || entry.absentWithoutNotice || entry.absentUnset || entry.totalDeduction)
    .sort((a, b) => a.employee_name.localeCompare(b.employee_name));
  const grand = employees.reduce((sum, entry) => {
    for (const key of Object.keys(blank()) as (keyof ReturnType<typeof blank>)[]) sum[key] += entry[key];
    return sum;
  }, blank());
  for (const key of ["delayAmount", "absenceAmount", "overtimeAmount", "totalDeduction"] as const) grand[key] = money(grand[key]);
  return { employees, grand };
}
