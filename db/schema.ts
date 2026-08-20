import { sql } from "drizzle-orm";
import { doublePrecision, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
};

export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(),
  managerEmployeeId: integer("manager_employee_id"), parentId: integer("parent_id"),
  status: text("status").notNull().default("active"), ...timestamps,
});

export const jobTitles = pgTable("job_titles", {
  id: serial("id").primaryKey(),
  nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(),
  departmentId: integer("department_id"), status: text("status").notNull().default("active"), ...timestamps,
});

export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  employeeCode: text("employee_code").notNull(), nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(),
  workEmail: text("work_email").notNull(), fingerprintCode: text("fingerprint_code"),
  personalPhone: text("personal_phone"), workPhone: text("work_phone"), nationality: text("nationality"),
  gender: text("gender"), birthDate: text("birth_date"), identificationNumber: text("identification_number"), address: text("address"),
  departmentId: integer("department_id"), jobTitleId: integer("job_title_id"), managerId: integer("manager_id"),
  organizationalLevel: integer("organizational_level").notNull().default(1),
  startDate: text("start_date").notNull(), endDate: text("end_date"), employmentStatus: text("employment_status").notNull().default("active"),
  salary: doublePrecision("salary"), salaryCurrency: text("salary_currency").default("SAR"), country: text("country").notNull(),
  workLocation: text("work_location"), employmentType: text("employment_type").default("full_time"),
  scheduleType: text("schedule_type").default("fixed"), workDays: text("work_days").default("0,1,2,3,4"),
  checkInTime: text("check_in_time").default("09:00"), checkOutTime: text("check_out_time").default("17:00"),
  graceMinutes: integer("grace_minutes").default(15), requiredDailyMinutes: integer("required_daily_minutes").default(480),
  bankName: text("bank_name"), bankAccountNumber: text("bank_account_number"), bankIban: text("bank_iban"),
  avatarUrl: text("avatar_url"), ...timestamps,
}, (t) => [uniqueIndex("idx_employees_employee_code").on(t.employeeCode), uniqueIndex("idx_employees_work_email").on(t.workEmail), index("idx_employees_department_status").on(t.departmentId, t.employmentStatus), index("idx_employees_manager").on(t.managerId)]);

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(), name: text("name").notNull(), description: text("description"), isSystem: integer("is_system").notNull().default(0), ...timestamps,
}, (t) => [uniqueIndex("idx_roles_name").on(t.name)]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(), authUserId: text("auth_user_id"), email: text("email").notNull(), employeeId: integer("employee_id"), roleId: integer("role_id").notNull(),
  passwordHash: text("password_hash"), sessionVersion: integer("session_version").notNull().default(1), failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "string" }), passwordChangedAt: timestamp("password_changed_at", { withTimezone: true, mode: "string" }),
  status: text("status").notNull().default("active"), mustChangePassword: integer("must_change_password").notNull().default(0), lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "string" }), ...timestamps,
}, (t) => [uniqueIndex("idx_users_email").on(t.email), uniqueIndex("idx_users_auth_user_id").on(t.authUserId)]);

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(), roleId: integer("role_id").notNull(), module: text("module").notNull(), action: text("action").notNull(), allowed: integer("allowed").notNull().default(0),
}, (t) => [uniqueIndex("idx_permissions_role_module_action").on(t.roleId, t.module, t.action)]);

export const requests = pgTable("requests", {
  id: serial("id").primaryKey(), requestCode: text("request_code").notNull(), employeeId: integer("employee_id").notNull(), type: text("type").notNull(),
  fromDate: text("from_date"), toDate: text("to_date"), requestDate: text("request_date"), requestTime: text("request_time"), amount: doublePrecision("amount"), currency: text("currency"),
  reason: text("reason"), notes: text("notes"), detailsJson: text("details_json").default("{}"), status: text("status").notNull().default("pending_manager"), currentStage: text("current_stage").notNull().default("manager"), ...timestamps,
}, (t) => [uniqueIndex("idx_requests_code").on(t.requestCode), index("idx_requests_employee_status").on(t.employeeId, t.status), index("idx_requests_stage_status").on(t.currentStage, t.status)]);

export const approvals = pgTable("approvals", {
  id: serial("id").primaryKey(), requestId: integer("request_id").notNull(), stage: text("stage").notNull(), actorUserId: integer("actor_user_id").notNull(),
  action: text("action").notNull(), reason: text("reason"), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("idx_approvals_request").on(t.requestId)]);

export const attendanceLogs = pgTable("attendance_logs", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), eventAt: timestamp("event_at", { withTimezone: true, mode: "string" }).notNull(), eventType: text("event_type").notNull(),
  source: text("source").notNull(), device: text("device"), location: text("location"), createdByUserId: integer("created_by_user_id"), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("idx_attendance_logs_employee_event").on(t.employeeId, t.eventAt)]);

export const dailyAttendance = pgTable("daily_attendance", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), workDate: text("work_date").notNull(), scheduledIn: text("scheduled_in"), scheduledOut: text("scheduled_out"),
  actualIn: text("actual_in"), actualOut: text("actual_out"), workedMinutes: integer("worked_minutes").default(0), requiredMinutes: integer("required_minutes").default(480), lateMinutes: integer("late_minutes").default(0), earlyMinutes: integer("early_minutes").default(0), overtimeMinutes: integer("overtime_minutes").default(0), attendanceType: text("attendance_type").default("office"), status: text("status").notNull(), note: text("note"), ...timestamps,
}, (t) => [uniqueIndex("idx_daily_attendance_employee_date").on(t.employeeId, t.workDate), index("idx_daily_attendance_date_status").on(t.workDate, t.status)]);

export const leaveTypes = pgTable("leave_types", {
  id: serial("id").primaryKey(), code: text("code").notNull(), nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(), defaultDays: integer("default_days").notNull().default(0), paid: integer("paid").notNull().default(1), attachmentRequired: integer("attachment_required").notNull().default(0), managerApproval: integer("manager_approval").notNull().default(1), hrApproval: integer("hr_approval").notNull().default(1), status: text("status").notNull().default("active"), ...timestamps,
}, (t) => [uniqueIndex("idx_leave_types_code").on(t.code)]);

export const leavePolicies = pgTable("leave_policies", {
  id: serial("id").primaryKey(), leaveTypeId: integer("leave_type_id").notNull(), country: text("country").notNull(), annualEntitlement: doublePrecision("annual_entitlement").notNull(), minServiceMonths: integer("min_service_months").default(0), carryForward: integer("carry_forward").notNull().default(0), maxCarryForward: doublePrecision("max_carry_forward").default(0), expiryDays: integer("expiry_days"), status: text("status").notNull().default("active"), ...timestamps,
});

export const leaveBalances = pgTable("leave_balances", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), leaveTypeId: integer("leave_type_id").notNull(), year: integer("year").notNull(), entitlement: doublePrecision("entitlement").notNull(), used: doublePrecision("used").notNull().default(0), pending: doublePrecision("pending").notNull().default(0),
}, (t) => [uniqueIndex("idx_leave_balances_employee_type_year").on(t.employeeId, t.leaveTypeId, t.year)]);

export const holidays = pgTable("holidays", {
  id: serial("id").primaryKey(), nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(), holidayDate: text("holiday_date").notNull(), country: text("country").notNull(), attendanceTypes: text("attendance_types").notNull().default(""), recurrenceType: text("recurrence_type").notNull().default("once"), days: doublePrecision("days").notNull().default(1), originalDate: text("original_date"), originalDateBehavior: text("original_date_behavior").default("holiday"), notes: text("notes"), status: text("status").notNull().default("active"), ...timestamps,
}, (t) => [index("idx_holidays_country_date").on(t.country, t.holidayDate)]);

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), name: text("name").notNull(), category: text("category").notNull(), objectKey: text("object_key").notNull(), contentType: text("content_type"), sizeBytes: integer("size_bytes"), expiryDate: text("expiry_date"), uploadedByUserId: integer("uploaded_by_user_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("idx_documents_employee").on(t.employeeId)]);

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(), userId: integer("user_id"), action: text("action").notNull(), module: text("module").notNull(), recordType: text("record_type"), recordId: text("record_id"), previousValue: text("previous_value"), newValue: text("new_value"), ipAddress: text("ip_address"), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("idx_audit_module_created").on(t.module, t.createdAt), index("idx_audit_user_created").on(t.userId, t.createdAt)]);

export const systemSettings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  settingKey: text("setting_key").notNull(),
  valueJson: text("value_json").notNull().default("{}"),
  updatedByUserId: integer("updated_by_user_id"),
  ...timestamps,
}, (t) => [uniqueIndex("idx_system_settings_key").on(t.settingKey)]);

export const salaryStructures = pgTable("salary_structures", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), basicSalary: doublePrecision("basic_salary").notNull(),
  country: text("country").notNull(), currency: text("currency").notNull().default("SAR"), effectiveFrom: text("effective_from").notNull(), effectiveTo: text("effective_to"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("idx_salary_structures_employee_effective").on(t.employeeId, t.effectiveFrom)]);

export const salaryAllowances = pgTable("salary_allowances", {
  id: serial("id").primaryKey(), salaryStructureId: integer("salary_structure_id").notNull(), type: text("type").notNull(),
  amount: doublePrecision("amount"), percentage: doublePrecision("percentage"),
}, (t) => [index("idx_salary_allowances_structure").on(t.salaryStructureId)]);

export const payrollRuns = pgTable("payroll_runs", {
  id: serial("id").primaryKey(), month: integer("month").notNull(), year: integer("year").notNull(), country: text("country").notNull(),
  status: text("status").notNull().default("draft"), approvedBy: integer("approved_by"), approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
  lockedAt: timestamp("locked_at", { withTimezone: true, mode: "string" }), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("idx_payroll_runs_month_year_country").on(t.month, t.year, t.country)]);

export const payrollItems = pgTable("payroll_items", {
  id: serial("id").primaryKey(), payrollRunId: integer("payroll_run_id").notNull(), employeeId: integer("employee_id").notNull(),
  basicSalary: doublePrecision("basic_salary").notNull().default(0), totalAllowances: doublePrecision("total_allowances").notNull().default(0),
  overtimeAmount: doublePrecision("overtime_amount").notNull().default(0), absenceDeduction: doublePrecision("absence_deduction").notNull().default(0),
  unpaidLeaveDeduction: doublePrecision("unpaid_leave_deduction").notNull().default(0), loanDeduction: doublePrecision("loan_deduction").notNull().default(0),
  insuranceDeduction: doublePrecision("insurance_deduction").notNull().default(0), taxDeduction: doublePrecision("tax_deduction").notNull().default(0),
  netSalary: doublePrecision("net_salary").notNull().default(0),
}, (t) => [uniqueIndex("idx_payroll_items_run_employee").on(t.payrollRunId, t.employeeId)]);

export const loansAdvances = pgTable("loans_advances", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), totalAmount: doublePrecision("total_amount").notNull(),
  remainingAmount: doublePrecision("remaining_amount").notNull(), monthlyInstallment: doublePrecision("monthly_installment").notNull(),
  status: text("status").notNull().default("active"), issuedAt: text("issued_at").notNull(), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("idx_loans_advances_employee_status").on(t.employeeId, t.status)]);

export const taxBrackets = pgTable("tax_brackets", {
  id: serial("id").primaryKey(), country: text("country").notNull(), minAmount: doublePrecision("min_amount").notNull(),
  maxAmount: doublePrecision("max_amount"), rate: doublePrecision("rate").notNull(), effectiveFrom: text("effective_from").notNull(),
}, (t) => [index("idx_tax_brackets_country_effective").on(t.country, t.effectiveFrom)]);

export const insuranceRates = pgTable("insurance_rates", {
  id: serial("id").primaryKey(), country: text("country").notNull(), employeeRate: doublePrecision("employee_rate").notNull(),
  employerRate: doublePrecision("employer_rate").notNull(), effectiveFrom: text("effective_from").notNull(),
}, (t) => [index("idx_insurance_rates_country_effective").on(t.country, t.effectiveFrom)]);

export const postgresHealthcheck = sql`select 1`;
