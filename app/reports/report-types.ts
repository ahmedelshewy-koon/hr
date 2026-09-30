import type { ReportPeriod } from "./report-period";

/** Bilingual name pair as stored on departments, leave types, courses, ... */
export type Named = { name_en: string | null; name_ar: string | null };
export type Person = { employee_id: number; employee_code: string; name_en: string; name_ar: string; department_en: string | null; department_ar: string | null };
export type CountRow = { key: string; count: number };
export type DatedPerson = Person & { date: string };

export type WorkforceReport = {
  active: number;
  inactive: number;
  byStatus: CountRow[];
  byDepartment: (Named & { count: number })[];
  byCountry: CountRow[];
  byType: CountRow[];
  byTenure: CountRow[];
  averageTenureYears: number;
  hires: { total: number; rows: DatedPerson[] };
  leavers: { total: number; rows: DatedPerson[] };
  turnoverRate: number;
  contractsEnding: { total: number; rows: DatedPerson[] };
};

export type AttendanceTotals = {
  workdays: number; attended: number; absent: number; leave_days: number; late_days: number; late_minutes: number;
  early_days: number; overtime_minutes: number; worked_minutes: number; remote_days: number; missing_checkout: number;
  needs_review: number; employees: number;
};
export type AttendanceReport = {
  /** Rows before today only: a day that has not finished cannot count as an absence. */
  through: string;
  totals: AttendanceTotals;
  previous: AttendanceTotals;
  daily: { date: string; attended: number; late: number; absent: number }[];
  byDepartment: (Named & { employees: number; workdays: number; attended: number; absent: number; late_days: number; late_minutes: number })[];
  topLate: (Person & { days: number; minutes: number })[];
  topAbsent: (Person & { days: number })[];
  openExceptions: number;
};

export type LeaveReport = {
  totals: { requests: number; approved: number; pending: number; rejected: number; approved_days: number; previous_approved_days: number };
  byType: (Named & { requests: number; approved: number; pending: number; rejected: number; approved_days: number })[];
  byDepartment: (Named & { days: number })[];
  topTakers: (Person & { days: number; requests: number })[];
  balanceYear: number;
  balances: (Named & { employees: number; entitlement: number; used: number; pending: number })[];
  highBalances: (Person & { entitlement: number; used: number; pending: number })[];
  onLeaveToday: number;
  upcoming: { total: number; rows: (Person & { leave_en: string; leave_ar: string; from_date: string; to_date: string; days: number })[] };
};

export type ApprovalsReport = {
  totals: { total: number; approved: number; pending_manager: number; pending_hr: number; rejected: number; cancelled: number; previous_total: number };
  averageHours: number | null;
  byKind: { key: string; total: number; approved: number; pending: number; rejected: number }[];
  pendingNow: { manager: number; hr: number; overdue: number };
  oldest: { total: number; rows: (Person & { request_code: string; kind: string; status: string; stage: string; age_days: number })[] };
};

export type DocumentsReport = {
  totals: { active: number; valid: number; expiring: number; expired: number; no_expiry: number };
  byCategory: (Named & { total: number; expired: number; expiring: number })[];
  attention: { total: number; rows: (Person & { category_en: string | null; category_ar: string | null; name: string; expiry_date: string; days_left: number })[] };
  missing: { total: number; byCategory: (Named & { count: number })[]; employees: (Person & { count: number; names_en: string; names_ar: string })[] };
};

export type RecruitmentReport = {
  openJobs: number;
  openPositions: number;
  pipeline: number;
  applications: number;
  hired: number;
  rejected: number;
  stalled: number;
  avgDaysToHire: number | null;
  byStage: (Named & { key: string; count: number })[];
  bySource: { key: string; applications: number; hired: number }[];
  jobs: { id: number; title: string; openings_count: number; created_date: string; pipeline: number; hired: number }[];
};

export type LifecycleReport = {
  types: { type: string; lifecycles: number; tasks: number; done: number; overdue: number }[];
  completedInPeriod: CountRow[];
  overdueTasks: { total: number; rows: (Person & { title: string; due_date: string; type: string; days_late: number })[] };
};

export type AssetsReport = {
  inventory: { byStatus: CountRow[]; byCategory: { key: string; total: number; assigned: number }[]; poorCondition: number } | null;
  unreturned: { total: number; rows: (Person & { asset_code: string; asset_name: string; category: string; assigned_at: string })[] };
};

export type LearningReport = {
  totals: { assigned: number; in_progress: number; completed: number; failed: number; completed_in_period: number };
  completionRate: number;
  mandatoryOverdue: { total: number; rows: (Person & { course: string; due_date: string; days_late: number })[] };
  certificates: { total: number; rows: (Person & { course: string; expiry: string; days_left: number })[] };
  byCourse: { title: string; mandatory: number; enrolled: number; completed: number; avg_score: number | null }[];
};

export type ReportOverview = {
  period: ReportPeriod;
  previous: ReportPeriod;
  today: string;
  generatedAt: string;
  /** "team" when a department manager sees only their own branch of the organisation. */
  scope: "company" | "team";
  workforce: WorkforceReport;
  attendance: AttendanceReport;
  leave: LeaveReport;
  approvals: ApprovalsReport;
  documents: DocumentsReport | null;
  recruitment: RecruitmentReport | null;
  lifecycle: LifecycleReport | null;
  assets: AssetsReport | null;
  learning: LearningReport | null;
};
