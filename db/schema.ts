import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const departments = sqliteTable("departments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(),
  managerEmployeeId: integer("manager_employee_id"), parentId: integer("parent_id"),
  status: text("status").notNull().default("active"), ...timestamps,
});

export const jobTitles = sqliteTable("job_titles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(),
  departmentId: integer("department_id"), status: text("status").notNull().default("active"), ...timestamps,
});

export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeCode: text("employee_code").notNull(), nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(),
  workEmail: text("work_email").notNull(), fingerprintCode: text("fingerprint_code"),
  personalPhone: text("personal_phone"), workPhone: text("work_phone"), nationality: text("nationality"),
  gender: text("gender"), birthDate: text("birth_date"), identificationNumber: text("identification_number"), address: text("address"),
  departmentId: integer("department_id"), jobTitleId: integer("job_title_id"), managerId: integer("manager_id"),
  startDate: text("start_date").notNull(), endDate: text("end_date"), employmentStatus: text("employment_status").notNull().default("active"),
  salary: real("salary"), salaryCurrency: text("salary_currency").default("SAR"), country: text("country").notNull(),
  workLocation: text("work_location"), employmentType: text("employment_type").default("full_time"),
  scheduleType: text("schedule_type").default("fixed"), workDays: text("work_days").default("0,1,2,3,4"),
  checkInTime: text("check_in_time").default("09:00"), checkOutTime: text("check_out_time").default("17:00"),
  graceMinutes: integer("grace_minutes").default(15), requiredDailyMinutes: integer("required_daily_minutes").default(480),
  avatarUrl: text("avatar_url"), ...timestamps,
}, (t) => [uniqueIndex("idx_employees_employee_code").on(t.employeeCode), uniqueIndex("idx_employees_work_email").on(t.workEmail), index("idx_employees_department_status").on(t.departmentId, t.employmentStatus), index("idx_employees_manager").on(t.managerId)]);

export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), description: text("description"), isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false), ...timestamps,
}, (t) => [uniqueIndex("idx_roles_name").on(t.name)]);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }), authUserId: text("auth_user_id"), email: text("email").notNull(), employeeId: integer("employee_id"), roleId: integer("role_id").notNull(),
  status: text("status").notNull().default("active"), mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false), lastLoginAt: text("last_login_at"), ...timestamps,
}, (t) => [uniqueIndex("idx_users_email").on(t.email), uniqueIndex("idx_users_auth_user_id").on(t.authUserId)]);

export const permissions = sqliteTable("permissions", {
  id: integer("id").primaryKey({ autoIncrement: true }), roleId: integer("role_id").notNull(), module: text("module").notNull(), action: text("action").notNull(), allowed: integer("allowed", { mode: "boolean" }).notNull().default(false),
}, (t) => [uniqueIndex("idx_permissions_role_module_action").on(t.roleId, t.module, t.action)]);

export const requests = sqliteTable("requests", {
  id: integer("id").primaryKey({ autoIncrement: true }), requestCode: text("request_code").notNull(), employeeId: integer("employee_id").notNull(), type: text("type").notNull(),
  fromDate: text("from_date"), toDate: text("to_date"), requestDate: text("request_date"), requestTime: text("request_time"), amount: real("amount"), currency: text("currency"),
  reason: text("reason"), notes: text("notes"), detailsJson: text("details_json").default("{}"), status: text("status").notNull().default("pending_manager"), currentStage: text("current_stage").notNull().default("manager"), ...timestamps,
}, (t) => [uniqueIndex("idx_requests_code").on(t.requestCode), index("idx_requests_employee_status").on(t.employeeId, t.status), index("idx_requests_stage_status").on(t.currentStage, t.status)]);

export const approvals = sqliteTable("approvals", {
  id: integer("id").primaryKey({ autoIncrement: true }), requestId: integer("request_id").notNull(), stage: text("stage").notNull(), actorUserId: integer("actor_user_id").notNull(),
  action: text("action").notNull(), reason: text("reason"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("idx_approvals_request").on(t.requestId)]);

export const attendanceLogs = sqliteTable("attendance_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }), employeeId: integer("employee_id").notNull(), eventAt: text("event_at").notNull(), eventType: text("event_type").notNull(),
  source: text("source").notNull(), device: text("device"), location: text("location"), createdByUserId: integer("created_by_user_id"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("idx_attendance_logs_employee_event").on(t.employeeId, t.eventAt)]);

export const dailyAttendance = sqliteTable("daily_attendance", {
  id: integer("id").primaryKey({ autoIncrement: true }), employeeId: integer("employee_id").notNull(), workDate: text("work_date").notNull(), scheduledIn: text("scheduled_in"), scheduledOut: text("scheduled_out"),
  actualIn: text("actual_in"), actualOut: text("actual_out"), workedMinutes: integer("worked_minutes").default(0), requiredMinutes: integer("required_minutes").default(480), lateMinutes: integer("late_minutes").default(0), earlyMinutes: integer("early_minutes").default(0), overtimeMinutes: integer("overtime_minutes").default(0), attendanceType: text("attendance_type").default("office"), status: text("status").notNull(), note: text("note"), ...timestamps,
}, (t) => [uniqueIndex("idx_daily_attendance_employee_date").on(t.employeeId, t.workDate), index("idx_daily_attendance_date_status").on(t.workDate, t.status)]);

export const leaveTypes = sqliteTable("leave_types", {
  id: integer("id").primaryKey({ autoIncrement: true }), nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(), paid: integer("paid", { mode: "boolean" }).notNull().default(true), attachmentRequired: integer("attachment_required", { mode: "boolean" }).notNull().default(false), managerApproval: integer("manager_approval", { mode: "boolean" }).notNull().default(true), hrApproval: integer("hr_approval", { mode: "boolean" }).notNull().default(true), status: text("status").notNull().default("active"), ...timestamps,
});

export const leavePolicies = sqliteTable("leave_policies", {
  id: integer("id").primaryKey({ autoIncrement: true }), leaveTypeId: integer("leave_type_id").notNull(), country: text("country").notNull(), annualEntitlement: real("annual_entitlement").notNull(), minServiceMonths: integer("min_service_months").default(0), carryForward: integer("carry_forward", { mode: "boolean" }).notNull().default(false), maxCarryForward: real("max_carry_forward").default(0), expiryDays: integer("expiry_days"), status: text("status").notNull().default("active"), ...timestamps,
});

export const leaveBalances = sqliteTable("leave_balances", {
  id: integer("id").primaryKey({ autoIncrement: true }), employeeId: integer("employee_id").notNull(), leaveTypeId: integer("leave_type_id").notNull(), year: integer("year").notNull(), entitlement: real("entitlement").notNull(), used: real("used").notNull().default(0), pending: real("pending").notNull().default(0),
}, (t) => [uniqueIndex("idx_leave_balances_employee_type_year").on(t.employeeId, t.leaveTypeId, t.year)]);

export const holidays = sqliteTable("holidays", {
  id: integer("id").primaryKey({ autoIncrement: true }), nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(), holidayDate: text("holiday_date").notNull(), country: text("country").notNull(), days: real("days").notNull().default(1), originalDate: text("original_date"), originalDateBehavior: text("original_date_behavior").default("holiday"), notes: text("notes"), status: text("status").notNull().default("active"), ...timestamps,
}, (t) => [index("idx_holidays_country_date").on(t.country, t.holidayDate)]);

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }), employeeId: integer("employee_id").notNull(), name: text("name").notNull(), category: text("category").notNull(), objectKey: text("object_key").notNull(), contentType: text("content_type"), sizeBytes: integer("size_bytes"), expiryDate: text("expiry_date"), uploadedByUserId: integer("uploaded_by_user_id").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("idx_documents_employee").on(t.employeeId)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }), userId: integer("user_id"), action: text("action").notNull(), module: text("module").notNull(), recordType: text("record_type"), recordId: text("record_id"), previousValue: text("previous_value"), newValue: text("new_value"), ipAddress: text("ip_address"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("idx_audit_module_created").on(t.module, t.createdAt), index("idx_audit_user_created").on(t.userId, t.createdAt)]);
