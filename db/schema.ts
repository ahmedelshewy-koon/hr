import { sql } from "drizzle-orm";
import {
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
};

export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  managerEmployeeId: integer("manager_employee_id"),
  parentId: integer("parent_id"),
  unitType: text("unit_type").notNull().default("department"),
  companyId: integer("company_id").references(() => companies.id),
  organizationKind: text("organization_kind"),
  branchScope: text("branch_scope").notNull().default("all"),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const jobTitles = pgTable("job_titles", {
  id: serial("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  departmentId: integer("department_id"),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const employees = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    employeeCode: text("employee_code").notNull(),
    // The pre-renumbering code (e.g. EMP1767255793641), kept so old exports and searches still match.
    legacyEmployeeCode: text("legacy_employee_code"),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    workEmail: text("work_email").notNull(),
    fingerprintCode: text("fingerprint_code"),
    personalPhone: text("personal_phone"),
    workPhone: text("work_phone"),
    nationality: text("nationality"),
    nationalityCountry: text("nationality_country"),
    religion: text("religion"),
    passportNumber: text("passport_number"),
    gender: text("gender"),
    birthDate: text("birth_date"),
    identificationNumber: text("identification_number"),
    address: text("address"),
    departmentId: integer("department_id"),
    jobTitleId: integer("job_title_id"),
    managerId: integer("manager_id"),
    companyId: integer("company_id"),
    branchId: integer("branch_id").references(() => branches.id),
    sectionId: integer("section_id").references(() => departments.id),
    teamId: integer("team_id").references(() => departments.id),
    positionId: integer("position_id").references(() => positions.id),
    gradeId: integer("grade_id").references(() => jobGrades.id),
    workLocationId: integer("work_location_id").references(() => workLocations.id),
    assignmentEffectiveDate: text("assignment_effective_date"),
    hrUserId: integer("hr_user_id"),
    organizationalLevel: integer("organizational_level").notNull().default(1),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    employmentStatus: text("employment_status").notNull().default("active"),
    salary: doublePrecision("salary"),
    salaryCurrency: text("salary_currency").default("SAR"),
    country: text("country").notNull(),
    workLocation: text("work_location"),
    employmentType: text("employment_type").default("full_time"),
    scheduleType: text("schedule_type").default("fixed"),
    workDays: text("work_days").default("0,1,2,3,4"),
    checkInTime: text("check_in_time").default("09:00"),
    checkOutTime: text("check_out_time").default("17:00"),
    graceMinutes: integer("grace_minutes").default(15),
    requiredDailyMinutes: integer("required_daily_minutes").default(480),
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    bankIban: text("bank_iban"),
    avatarUrl: text("avatar_url"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("idx_employees_employee_code").on(t.employeeCode),
    uniqueIndex("idx_employees_work_email").on(t.workEmail),
    index("idx_employees_department_status").on(
      t.departmentId,
      t.employmentStatus,
    ),
    index("idx_employees_manager").on(t.managerId),
    index("idx_employees_company").on(t.companyId),
    index("idx_employees_hr_user").on(t.hrUserId),
    foreignKey({columns:[t.companyId],foreignColumns:[companies.id],name:"employees_company_id_fkey"}),
    foreignKey({columns:[t.hrUserId],foreignColumns:[users.id],name:"employees_hr_user_id_fkey"}),
    index("idx_employees_contract_end").on(t.employmentStatus, t.endDate),
  ],
);

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  nameEn: text("name_en"),
  code: text("code").unique(),
  // Prefix for generated employee codes (KS → KS-001). Null falls back to EMP.
  employeeCodePrefix: text("employee_code_prefix"),
  status: text("status").notNull().default("active"),
  ...timestamps,
}, t => [uniqueIndex("idx_companies_name").on(sql`lower(btrim(${t.name}))`), uniqueIndex("idx_companies_employee_code_prefix").on(t.employeeCodePrefix)]);

// Organizational master data. No backfill or reinterpretation of legacy assignments.
export const branches = pgTable("branches", {
  id: serial("id").primaryKey(), nameAr: text("name_ar").notNull(), nameEn: text("name_en").notNull(),
  code: text("code").notNull().unique(), country: text("country"), city: text("city"),
  status: text("status").notNull().default("active"), ...timestamps,
});
export const companyBranches = pgTable("company_branches", {
  id: serial("id").primaryKey(), companyId: integer("company_id").notNull().references(() => companies.id),
  branchId: integer("branch_id").notNull().references(() => branches.id),
}, t => [unique("company_branches_pair").on(t.companyId,t.branchId)]);
export const organizationBranchScopes = pgTable("organization_branch_scopes", {
  id: serial("id").primaryKey(), departmentId: integer("department_id").notNull().references(() => departments.id),
  branchId: integer("branch_id").notNull().references(() => branches.id),
}, t => [unique("organization_branch_scopes_pair").on(t.departmentId,t.branchId)]);
export const jobGrades = pgTable("job_grades", {
  sortOrder: integer("sort_order").notNull().default(0),
  id: serial("id").primaryKey(), nameAr: text("name_ar").notNull(), nameEn: text("name_en").notNull(),
  code: text("code").notNull().unique(), status: text("status").notNull().default("active"), ...timestamps,
});
export const positions = pgTable("positions", {
  id: serial("id").primaryKey(), nameAr: text("name_ar").notNull(), nameEn: text("name_en").notNull(),
  code: text("code").notNull().unique(), companyId: integer("company_id").notNull().references(() => companies.id),
  jobTitleId: integer("job_title_id").references(() => jobTitles.id),
  departmentId: integer("department_id").references(() => departments.id),
  sectionId: integer("section_id").references(() => departments.id), teamId: integer("team_id").references(() => departments.id),
  gradeId: integer("grade_id").references(() => jobGrades.id),
  isCeo: integer("is_ceo").notNull().default(0), status: text("status").notNull().default("active"), ...timestamps,
}, t => [uniqueIndex("positions_company_ceo").on(t.companyId).where(sql`${t.isCeo}=1 AND ${t.status}='active'`)]);
export const workLocations = pgTable("work_locations", {
  id: serial("id").primaryKey(), nameAr: text("name_ar").notNull(), nameEn: text("name_en").notNull(),
  code: text("code").notNull().unique(), branchId: integer("branch_id").references(() => branches.id),
  status: text("status").notNull().default("active"), ...timestamps,
});
export const hrResponsibilityRules = pgTable("hr_responsibility_rules", {
  id: serial("id").primaryKey(), companyId: integer("company_id").references(() => companies.id),
  branchId: integer("branch_id").notNull().references(() => branches.id),
  hrUserId: integer("hr_user_id").notNull().references(() => hrResponsibles.userId),
  status: text("status").notNull().default("active"), ...timestamps,
}, t => [uniqueIndex("hr_rules_active_scope").on(sql`coalesce(${t.companyId},0)`,t.branchId).where(sql`${t.status}='active'`)]);

export const hrResponsibles = pgTable("hr_responsibles", {
  userId: integer("user_id").primaryKey(),
  status: text("status").notNull().default("active"),
  ...timestamps,
}, t => [foreignKey({columns:[t.userId],foreignColumns:[users.id],name:"hr_responsibles_user_id_fkey"})]);

export const roles = pgTable(
  "roles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    nameAr: text("name_ar"),
    description: text("description"),
    isSystem: integer("is_system").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("idx_roles_name").on(t.name)],
);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    authUserId: text("auth_user_id"),
    email: text("email").notNull(),
    employeeId: integer("employee_id"),
    roleId: integer("role_id").notNull(),
    passwordHash: text("password_hash"),
    sessionVersion: integer("session_version").notNull().default(1),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", {
      withTimezone: true,
      mode: "string",
    }),
    passwordChangedAt: timestamp("password_changed_at", {
      withTimezone: true,
      mode: "string",
    }),
    status: text("status").notNull().default("active"),
    mustChangePassword: integer("must_change_password").notNull().default(0),
    hrDataScope: text("hr_data_scope").notNull().default("all"),
    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("idx_users_email").on(t.email),
    uniqueIndex("idx_users_auth_user_id").on(t.authUserId),
  ],
);

export const permissions = pgTable(
  "permissions",
  {
    id: serial("id").primaryKey(),
    roleId: integer("role_id").notNull(),
    module: text("module").notNull(),
    action: text("action").notNull(),
    allowed: integer("allowed").notNull().default(0),
  },
  (t) => [
    uniqueIndex("idx_permissions_role_module_action").on(
      t.roleId,
      t.module,
      t.action,
    ),
  ],
);

export const requests = pgTable(
  "requests",
  {
    id: serial("id").primaryKey(),
    requestCode: text("request_code").notNull(),
    employeeId: integer("employee_id").notNull(),
    type: text("type").notNull(),
    leaveTypeId: integer("leave_type_id"),
    requestedDays: doublePrecision("requested_days"),
    balanceYear: integer("balance_year"),
    balanceEffect: text("balance_effect").default("none"),
    fromDate: text("from_date"),
    toDate: text("to_date"),
    requestDate: text("request_date"),
    requestTime: text("request_time"),
    amount: doublePrecision("amount"),
    currency: text("currency"),
    reason: text("reason"),
    notes: text("notes"),
    detailsJson: text("details_json").default("{}"),
    status: text("status").notNull().default("pending_manager"),
    currentStage: text("current_stage").notNull().default("manager"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("idx_requests_code").on(t.requestCode),
    index("idx_requests_employee_status").on(t.employeeId, t.status),
    index("idx_requests_stage_status").on(t.currentStage, t.status),
    index("idx_requests_employee_leave_dates").on(
      t.employeeId,
      t.leaveTypeId,
      t.fromDate,
      t.toDate,
      t.status,
    ),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id").notNull(),
    stage: text("stage").notNull(),
    actorUserId: integer("actor_user_id").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_approvals_request").on(t.requestId)],
);

export const attendanceLogs = pgTable(
  "attendance_logs",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    eventAt: timestamp("event_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    eventType: text("event_type").notNull(),
    source: text("source").notNull(),
    device: text("device"),
    location: text("location"),
    createdByUserId: integer("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_attendance_logs_employee_event").on(t.employeeId, t.eventAt),
  ],
);

// An office connector: a small program on the customer's LAN that reads the devices and posts to the hosted app.
export const attendanceAgents = pgTable(
  "attendance_agents",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenHint: text("token_hint").notNull(),
    enabled: integer("enabled").notNull().default(1),
    agentVersion: text("agent_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    lastIp: text("last_ip"),
    createdByUserId: integer("created_by_user_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("idx_attendance_agents_token_hash").on(t.tokenHash)],
);

export const attendanceDevices = pgTable(
  "attendance_devices",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id"),
    name: text("name").notNull(),
    model: text("model").notNull(),
    ipAddress: text("ip_address").notNull(),
    port: integer("port").notNull().default(4370),
    timezone: text("timezone").notNull().default("Africa/Cairo"),
    syncIntervalSeconds: integer("sync_interval_seconds").notNull().default(300),
    enabled: integer("enabled").notNull().default(1),
    status: text("status").notNull().default("offline"),
    deviceTime: timestamp("device_time", { withTimezone: true, mode: "string" }),
    userCount: integer("user_count").notNull().default(0),
    logCount: integer("log_count").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true, mode: "string" }),
    lastError: text("last_error"),
    ...timestamps,
  },
  // Branches can reuse the same private address on different LANs, so the address is unique per connector.
  (t) => [uniqueIndex("idx_attendance_devices_agent_ip_port").on(t.agentId, t.ipAddress, t.port)],
);

export const attendanceDeviceUsers = pgTable(
  "attendance_device_users",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("device_id").notNull(),
    deviceUserId: text("device_user_id").notNull(),
    deviceUid: integer("device_uid"),
    employeeId: integer("employee_id"),
    displayName: text("display_name").notNull(),
    privilege: integer("privilege").notNull().default(0),
    cardNumber: text("card_number"),
    enabled: integer("enabled").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("idx_attendance_device_users_identity").on(t.deviceId, t.deviceUserId),
    index("idx_attendance_device_users_employee").on(t.employeeId),
  ],
);

export const attendanceDevicePunches = pgTable(
  "attendance_device_punches",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("device_id").notNull(),
    deviceUserId: text("device_user_id").notNull(),
    employeeId: integer("employee_id"),
    punchSerial: integer("punch_serial"),
    punchedAt: timestamp("punched_at", { withTimezone: true, mode: "string" }).notNull(),
    punchType: integer("punch_type").notNull().default(0),
    verifyType: integer("verify_type").notNull().default(0),
    attendanceLogId: integer("attendance_log_id"),
    rawData: text("raw_data").notNull().default("{}"),
    importedAt: timestamp("imported_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_attendance_device_punches_dedupe").on(t.deviceId, t.deviceUserId, t.punchedAt, t.punchType, t.verifyType),
    index("idx_attendance_device_punches_employee_time").on(t.employeeId, t.punchedAt),
  ],
);

export const attendanceDeviceSyncs = pgTable(
  "attendance_device_syncs",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("device_id").notNull(),
    status: text("status").notNull().default("queued"),
    trigger: text("trigger").notNull().default("manual"),
    requestedByUserId: integer("requested_by_user_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    usersFound: integer("users_found").notNull().default(0),
    punchesFound: integer("punches_found").notNull().default(0),
    punchesImported: integer("punches_imported").notNull().default(0),
    unmatchedUsers: integer("unmatched_users").notNull().default(0),
    error: text("error"),
  },
  (t) => [
    index("idx_attendance_device_syncs_status_requested").on(t.status, t.requestedAt),
    uniqueIndex("idx_attendance_device_syncs_active").on(t.deviceId).where(sql`${t.status} IN ('queued','running')`),
  ],
);

export const dailyAttendance = pgTable(
  "daily_attendance",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    workDate: text("work_date").notNull(),
    scheduledIn: text("scheduled_in"),
    scheduledOut: text("scheduled_out"),
    actualIn: text("actual_in"),
    actualOut: text("actual_out"),
    workedMinutes: integer("worked_minutes").default(0),
    requiredMinutes: integer("required_minutes").default(480),
    lateMinutes: integer("late_minutes").default(0),
    earlyMinutes: integer("early_minutes").default(0),
    overtimeMinutes: integer("overtime_minutes").default(0),
    attendanceType: text("attendance_type").default("office"),
    status: text("status").notNull(),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("idx_daily_attendance_employee_date").on(
      t.employeeId,
      t.workDate,
    ),
    index("idx_daily_attendance_date_status").on(t.workDate, t.status),
  ],
);

export const attendanceCorrections = pgTable(
  "attendance_corrections",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    dailyAttendanceId: integer("daily_attendance_id"),
    attendanceDate: text("attendance_date").notNull(),
    correctionType: text("correction_type").notNull(),
    originalValues: text("original_values").notNull().default("{}"),
    requestedValues: text("requested_values").notNull().default("{}"),
    reason: text("reason").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("pending_manager"),
    currentStage: text("current_stage").notNull().default("manager"),
    requestedByUserId: integer("requested_by_user_id").notNull(),
    resolvedAt: timestamp("resolved_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (t) => [
    index("idx_attendance_corrections_employee_date").on(
      t.employeeId,
      t.attendanceDate,
    ),
    index("idx_attendance_corrections_status_stage").on(
      t.status,
      t.currentStage,
    ),
  ],
);

export const attendanceCorrectionActions = pgTable(
  "attendance_correction_actions",
  {
    id: serial("id").primaryKey(),
    correctionId: integer("correction_id").notNull(),
    stage: text("stage").notNull(),
    actorUserId: integer("actor_user_id").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    beforeValues: text("before_values"),
    afterValues: text("after_values"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_attendance_correction_actions_correction").on(
      t.correctionId,
      t.createdAt,
    ),
  ],
);

export const attendanceExceptions = pgTable(
  "attendance_exceptions",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    dailyAttendanceId: integer("daily_attendance_id"),
    attendanceDate: text("attendance_date").notNull(),
    exceptionType: text("exception_type").notNull(),
    status: text("status").notNull().default("open"),
    correctionId: integer("correction_id"),
    detailsJson: text("details_json").notNull().default("{}"),
    resolvedAt: timestamp("resolved_at", {
      withTimezone: true,
      mode: "string",
    }),
    resolvedByUserId: integer("resolved_by_user_id"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("idx_attendance_exceptions_active_key").on(
      t.employeeId,
      t.attendanceDate,
      t.exceptionType,
    ),
    index("idx_attendance_exceptions_status_date").on(
      t.status,
      t.attendanceDate,
    ),
  ],
);

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    defaultDays: integer("default_days").notNull().default(0),
    paid: integer("paid").notNull().default(1),
    attachmentRequired: integer("attachment_required").notNull().default(0),
    managerApproval: integer("manager_approval").notNull().default(1),
    hrApproval: integer("hr_approval").notNull().default(1),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [uniqueIndex("idx_leave_types_code").on(t.code)],
);

export const employeeLeaveTypes = pgTable("employee_leave_types", {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    leaveTypeId: integer("leave_type_id").notNull(),
    assignedByUserId: integer("assigned_by_user_id"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("idx_employee_leave_types_employee_type").on(
      t.employeeId,
      t.leaveTypeId,
    ),
    index("idx_employee_leave_types_type").on(t.leaveTypeId),
  ],
);

export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    leaveTypeId: integer("leave_type_id").notNull(),
    year: integer("year").notNull(),
    entitlement: doublePrecision("entitlement").notNull(),
    used: doublePrecision("used").notNull().default(0),
    pending: doublePrecision("pending").notNull().default(0),
  },
  (t) => [
    uniqueIndex("idx_leave_balances_employee_type_year").on(
      t.employeeId,
      t.leaveTypeId,
      t.year,
    ),
  ],
);

export const holidays = pgTable(
  "holidays",
  {
    id: serial("id").primaryKey(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    holidayDate: text("holiday_date").notNull(),
    country: text("country").notNull(),
    attendanceTypes: text("attendance_types").notNull().default(""),
    recurrenceType: text("recurrence_type").notNull().default("once"),
    days: doublePrecision("days").notNull().default(1),
    originalDate: text("original_date"),
    originalDateBehavior: text("original_date_behavior").default("holiday"),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [index("idx_holidays_country_date").on(t.country, t.holidayDate)],
);

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    documentNumber: text("document_number"),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    issueDate: text("issue_date"),
    expiryDate: text("expiry_date"),
    status: text("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    replacedDocumentId: integer("replaced_document_id"),
    uploadedByUserId: integer("uploaded_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (t) => [
    index("idx_documents_employee").on(t.employeeId),
    index("idx_documents_expiry_status").on(t.status, t.expiryDate),
    uniqueIndex("idx_documents_object_key").on(t.objectKey),
  ],
);

export const documentCategories = pgTable(
  "document_categories",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    requiresExpiry: integer("requires_expiry").notNull().default(0),
    requiredDocument: integer("required_document").notNull().default(0),
    employeeCanView: integer("employee_can_view").notNull().default(1),
    employeeCanUpload: integer("employee_can_upload").notNull().default(0),
    managerCanView: integer("manager_can_view").notNull().default(0),
    allowedMimeTypes: text("allowed_mime_types")
      .notNull()
      .default("application/pdf,image/png,image/jpeg"),
    maxSizeBytes: integer("max_size_bytes").notNull().default(10485760),
    country: text("country"),
    employmentType: text("employment_type"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("idx_document_categories_code").on(t.code),
    index("idx_document_categories_required").on(t.requiredDocument, t.status),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id").notNull(),
    version: integer("version").notNull(),
    objectKey: text("object_key").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedByUserId: integer("uploaded_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("document_versions_document_version_unique").on(
      t.documentId,
      t.version,
    ),
    unique("document_versions_object_key_unique").on(t.objectKey),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    type: text("type").notNull(),
    titleKey: text("title_key").notNull(),
    messageKey: text("message_key"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    targetPath: text("target_path"),
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_notifications_user_read_created").on(
      t.userId,
      t.readAt,
      t.createdAt,
    ),
    uniqueIndex("idx_notifications_dedupe")
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
  ],
);

export const leaveRollovers = pgTable(
  "leave_rollovers",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    leaveTypeId: integer("leave_type_id").notNull(),
    fromYear: integer("from_year").notNull(),
    toYear: integer("to_year").notNull(),
    sourceAvailable: doublePrecision("source_available").notNull(),
    carriedAmount: doublePrecision("carried_amount").notNull(),
    expiresAt: text("expires_at"),
    runByUserId: integer("run_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("leave_rollovers_once_unique").on(
      t.employeeId,
      t.leaveTypeId,
      t.fromYear,
      t.toYear,
    ),
    index("idx_leave_rollovers_year").on(t.toYear, t.employeeId),
  ],
);

export const securityRateLimits = pgTable(
  "security_rate_limits",
  {
    bucketKey: text("bucket_key").primaryKey(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
    count: integer("count").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_security_rate_limits_updated").on(t.updatedAt)],
);

export const performanceRatingScales = pgTable("performance_rating_scales", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  minScore: doublePrecision("min_score").notNull().default(1),
  maxScore: doublePrecision("max_score").notNull().default(5),
  labelsJson: text("labels_json").notNull().default("{}"),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const performanceCycles = pgTable(
  "performance_cycles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    cycleType: text("cycle_type").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    status: text("status").notNull().default("draft"),
    departmentIds: text("department_ids").notNull().default(""),
    ratingScaleId: integer("rating_scale_id"),
    hrReviewRequired: integer("hr_review_required").notNull().default(1),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [index("idx_performance_cycles_status_dates").on(t.status, t.endDate)],
);

export const performanceReviews = pgTable(
  "performance_reviews",
  {
    id: serial("id").primaryKey(),
    cycleId: integer("cycle_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    managerEmployeeId: integer("manager_employee_id"),
    status: text("status").notNull().default("draft"),
    selfReview: text("self_review"),
    selfRating: doublePrecision("self_rating"),
    managerReview: text("manager_review"),
    managerRating: doublePrecision("manager_rating"),
    hrReview: text("hr_review"),
    hrRating: doublePrecision("hr_rating"),
    finalScore: doublePrecision("final_score"),
    finalizedByUserId: integer("finalized_by_user_id"),
    finalizedAt: timestamp("finalized_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (t) => [
    unique("performance_reviews_unique").on(
      t.cycleId,
      t.employeeId,
    ),
    index("idx_performance_reviews_employee_status").on(t.employeeId, t.status),
  ],
);

export const performanceGoals = pgTable(
  "performance_goals",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("review_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    target: text("target").notNull(),
    measurementType: text("measurement_type").notNull().default("percentage"),
    actualResult: text("actual_result"),
    weight: doublePrecision("weight").notNull(),
    progress: doublePrecision("progress").notNull().default(0),
    result: doublePrecision("result"),
    employeeRating: doublePrecision("employee_rating"),
    managerRating: doublePrecision("manager_rating"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [index("idx_performance_goals_review").on(t.reviewId)],
);

export const performanceComments = pgTable("performance_comments", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id").notNull(),
  authorUserId: integer("author_user_id").notNull(),
  stage: text("stage").notNull(),
  comment: text("comment").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const jobOpenings = pgTable(
  "job_openings",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    departmentId: integer("department_id"),
    jobTitleId: integer("job_title_id"),
    hiringManagerEmployeeId: integer("hiring_manager_employee_id"),
    recruiterEmployeeId: integer("recruiter_employee_id"),
    location: text("location"),
    employmentType: text("employment_type").notNull().default("full_time"),
    openingsCount: integer("openings_count").notNull().default(1),
    summary: text("summary"),
    responsibilities: text("responsibilities"),
    description: text("description"),
    requirements: text("requirements"),
    status: text("status").notNull().default("draft"),
    createdDate: text("created_date").notNull().default(sql`CURRENT_DATE`),
    closingDate: text("closing_date"),
    requirementsVersion: integer("requirements_version").notNull().default(1),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "string",
    }),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [
    index("idx_job_openings_status_department").on(t.status, t.departmentId),
    index("idx_job_openings_recruiter").on(t.recruiterEmployeeId, t.status),
    index("idx_job_openings_hiring_manager").on(
      t.hiringManagerEmployeeId,
      t.status,
    ),
  ],
);
export const jobRequirements = pgTable(
  "job_requirements",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priority: text("priority").notNull().default("required"),
    weight: doublePrecision("weight").notNull(),
    minimumValue: text("minimum_value"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    active: integer("active").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index("idx_job_requirements_job_version").on(t.jobId, t.version, t.active),
  ],
);
export const jobScreeningQuestions = pgTable(
  "job_screening_questions",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    question: text("question").notNull(),
    answerType: text("answer_type").notNull(),
    importance: text("importance").notNull().default("informational"),
    optionsJson: text("options_json").notNull().default("[]"),
    knockoutRuleJson: text("knockout_rule_json"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("idx_screening_questions_job").on(t.jobId, t.sortOrder)],
);
export const candidates = pgTable(
  "candidates",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    location: text("location"),
    currentJobTitle: text("current_job_title"),
    currentCompany: text("current_company"),
    totalExperience: doublePrecision("total_experience"),
    educationJson: text("education_json").notNull().default("[]"),
    skillsJson: text("skills_json").notNull().default("[]"),
    languagesJson: text("languages_json").notNull().default("[]"),
    certificationsJson: text("certifications_json").notNull().default("[]"),
    projectsJson: text("projects_json").notNull().default("[]"),
    resumeDocumentId: integer("resume_document_id"),
    source: text("source"),
    notes: text("notes"),
    stage: text("stage").notNull().default("applied"),
    profileVersion: integer("profile_version").notNull().default(1),
    humanCorrectedAt: timestamp("human_corrected_at", {
      withTimezone: true,
      mode: "string",
    }),
    mergedIntoCandidateId: integer("merged_into_candidate_id"),
    convertedEmployeeId: integer("converted_employee_id"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [
    index("idx_candidates_job_stage").on(t.jobId, t.stage),
  ],
);
export const recruitmentStages = pgTable(
  "recruitment_stages",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    stageKey: text("stage_key").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    stageType: text("stage_type").notNull(),
    sortOrder: integer("sort_order").notNull(),
    terminal: integer("terminal").notNull().default(0),
    active: integer("active").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique("recruitment_stage_job_key").on(t.jobId, t.stageKey),
    unique("recruitment_stage_job_order").on(t.jobId, t.sortOrder),
  ],
);
export const candidateApplications = pgTable(
  "candidate_applications",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull(),
    jobId: integer("job_id").notNull(),
    currentStageId: integer("current_stage_id"),
    status: text("status").notNull().default("active"),
    source: text("source"),
    screeningAnswersJson: text("screening_answers_json")
      .notNull()
      .default("{}"),
    screeningFlagsJson: text("screening_flags_json").notNull().default("[]"),
    recruiterEmployeeId: integer("recruiter_employee_id"),
    stageEnteredAt: timestamp("stage_entered_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    rejectionStageId: integer("rejection_stage_id"),
    rejectionReason: text("rejection_reason"),
    rejectionNotes: text("rejection_notes"),
    communicationStatus: text("communication_status"),
    decisionAt: timestamp("decision_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (t) => [
    unique("candidate_application_unique").on(
      t.candidateId,
      t.jobId,
    ),
    index("idx_candidate_applications_job_stage").on(
      t.jobId,
      t.currentStageId,
      t.status,
    ),
    index("idx_candidate_applications_recruiter").on(
      t.recruiterEmployeeId,
      t.status,
    ),
  ],
);
export const candidateStageHistory = pgTable(
  "candidate_stage_history",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id").notNull(),
    fromStageId: integer("from_stage_id"),
    toStageId: integer("to_stage_id").notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    actorUserId: integer("actor_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_candidate_stage_history_application").on(
      t.applicationId,
      t.createdAt,
    ),
  ],
);
export const candidateDocuments = pgTable(
  "candidate_documents",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull(),
    applicationId: integer("application_id"),
    documentType: text("document_type").notNull().default("cv"),
    name: text("name").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    version: integer("version").notNull().default(1),
    parsingStatus: text("parsing_status").notNull().default("uploaded"),
    parsingConfidence: doublePrecision("parsing_confidence"),
    parsingError: text("parsing_error"),
    uploadedByUserId: integer("uploaded_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("candidate_documents_object_key_key").on(t.objectKey),
    index("idx_candidate_documents_candidate").on(
      t.candidateId,
      t.documentType,
      t.version,
    ),
  ],
);
export const candidateCvParsedData = pgTable(
  "candidate_cv_parsed_data",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id").notNull(),
    parserVersion: text("parser_version").notNull(),
    rawText: text("raw_text"),
    extractedJson: text("extracted_json").notNull().default("{}"),
    correctedJson: text("corrected_json"),
    status: text("status").notNull(),
    confidence: doublePrecision("confidence"),
    parsedAt: timestamp("parsed_at", { withTimezone: true, mode: "string" }),
    correctedByUserId: integer("corrected_by_user_id"),
    correctedAt: timestamp("corrected_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (t) => [unique("candidate_cv_parsed_data_document_id_key").on(t.documentId)],
);
export const candidateMatchResults = pgTable(
  "candidate_match_results",
  {
    id: serial("id").primaryKey(),
    applicationId: integer("application_id").notNull(),
    overallScore: doublePrecision("overall_score").notNull(),
    classification: text("classification").notNull(),
    jobRequirementsVersion: integer("job_requirements_version").notNull(),
    candidateProfileVersion: integer("candidate_profile_version").notNull(),
    cvDocumentVersion: integer("cv_document_version").notNull().default(0),
    status: text("status").notNull().default("complete"),
    strongMatchesJson: text("strong_matches_json").notNull().default("[]"),
    partialMatchesJson: text("partial_matches_json").notNull().default("[]"),
    missingRequirementsJson: text("missing_requirements_json")
      .notNull()
      .default("[]"),
    concernsJson: text("concerns_json").notNull().default("[]"),
    suggestedQuestionsJson: text("suggested_questions_json")
      .notNull()
      .default("[]"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [
    index("idx_candidate_match_application_created").on(
      t.applicationId,
      t.createdAt,
    ),
  ],
);
export const candidateRequirementScores = pgTable(
  "candidate_requirement_scores",
  {
    id: serial("id").primaryKey(),
    matchResultId: integer("match_result_id").notNull(),
    requirementId: integer("requirement_id").notNull(),
    score: doublePrecision("score").notNull(),
    evidenceStatus: text("evidence_status").notNull(),
    evidence: text("evidence"),
    rationale: text("rationale").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("candidate_requirement_score_unique").on(
      t.matchResultId,
      t.requirementId,
    ),
  ],
);
export const interviewTemplates = pgTable(
  "interview_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    scopeType: text("scope_type").notNull().default("company"),
    departmentId: integer("department_id"),
    jobFamily: text("job_family"),
    jobId: integer("job_id"),
    description: text("description"),
    status: text("status").notNull().default("active"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [
    index("idx_interview_templates_scope").on(
      t.scopeType,
      t.departmentId,
      t.status,
    ),
  ],
);
export const interviewTemplateStages = pgTable(
  "interview_template_stages",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id").notNull(),
    stageKey: text("stage_key").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    sortOrder: integer("sort_order").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    passingGuidance: text("passing_guidance"),
    requiredFeedback: integer("required_feedback").notNull().default(1),
    independentEvaluations: integer("independent_evaluations")
      .notNull()
      .default(1),
    aggregationWeight: doublePrecision("aggregation_weight")
      .notNull()
      .default(1),
    ...timestamps,
  },
  (t) => [
    unique("interview_template_stage_order").on(
      t.templateId,
      t.sortOrder,
    ),
  ],
);
export const interviewTemplateStageInterviewers = pgTable(
  "interview_template_stage_interviewers",
  {
    id: serial("id").primaryKey(),
    templateStageId: integer("template_stage_id").notNull(),
    roleKey: text("role_key"),
    employeeId: integer("employee_id"),
    required: integer("required").notNull().default(1),
    ...timestamps,
  },
  (t) => [index("idx_template_stage_interviewers_stage").on(t.templateStageId)],
);
export const interviewQuestions = pgTable(
  "interview_questions",
  {
    id: serial("id").primaryKey(),
    question: text("question").notNull(),
    whatGoodLooksLike: text("what_good_looks_like"),
    evaluationGuidance: text("evaluation_guidance"),
    questionType: text("question_type").notNull(),
    departmentId: integer("department_id"),
    jobId: integer("job_id"),
    jobFamily: text("job_family"),
    skill: text("skill"),
    competency: text("competency"),
    seniority: text("seniority"),
    interviewStage: text("interview_stage"),
    interviewerRole: text("interviewer_role"),
    scoreMin: integer("score_min").notNull().default(1),
    scoreMax: integer("score_max").notNull().default(5),
    status: text("status").notNull().default("active"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [
    index("idx_interview_questions_scope").on(
      t.departmentId,
      t.jobId,
      t.questionType,
      t.status,
    ),
  ],
);
export const interviewTemplateStageQuestions = pgTable(
  "interview_template_stage_questions",
  {
    id: serial("id").primaryKey(),
    templateStageId: integer("template_stage_id").notNull(),
    questionId: integer("question_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    required: integer("required").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique("template_stage_question_unique").on(
      t.templateStageId,
      t.questionId,
    ),
  ],
);
export const interviewTemplateScorecardCriteria = pgTable(
  "interview_template_scorecard_criteria",
  {
    id: serial("id").primaryKey(),
    templateStageId: integer("template_stage_id").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    description: text("description"),
    weight: doublePrecision("weight").notNull(),
    required: integer("required").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("idx_template_scorecard_stage").on(t.templateStageId, t.sortOrder),
  ],
);
export const interviewPlans = pgTable(
  "interview_plans",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    sourceTemplateId: integer("source_template_id"),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("active"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [unique("interview_plans_job_status").on(t.jobId, t.status)],
);
export const interviewPlanStages = pgTable(
  "interview_plan_stages",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id").notNull(),
    sourceTemplateStageId: integer("source_template_stage_id"),
    stageKey: text("stage_key").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    sortOrder: integer("sort_order").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    passingGuidance: text("passing_guidance"),
    requiredFeedback: integer("required_feedback").notNull().default(1),
    independentEvaluations: integer("independent_evaluations")
      .notNull()
      .default(1),
    aggregationWeight: doublePrecision("aggregation_weight")
      .notNull()
      .default(1),
    ...timestamps,
  },
  (t) => [
    unique("interview_plan_stage_order").on(t.planId, t.sortOrder),
  ],
);
export const interviewStageInterviewers = pgTable(
  "interview_stage_interviewers",
  {
    id: serial("id").primaryKey(),
    planStageId: integer("plan_stage_id").notNull(),
    roleKey: text("role_key"),
    employeeId: integer("employee_id"),
    required: integer("required").notNull().default(1),
    ...timestamps,
  },
  (t) => [index("idx_interview_stage_interviewers_stage").on(t.planStageId)],
);
export const interviewStageQuestions = pgTable(
  "interview_stage_questions",
  {
    id: serial("id").primaryKey(),
    planStageId: integer("plan_stage_id").notNull(),
    questionId: integer("question_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    required: integer("required").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    unique("interview_stage_question_unique").on(
      t.planStageId,
      t.questionId,
    ),
  ],
);
export const interviewScorecardCriteria = pgTable(
  "interview_scorecard_criteria",
  {
    id: serial("id").primaryKey(),
    planStageId: integer("plan_stage_id").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    description: text("description"),
    weight: doublePrecision("weight").notNull(),
    required: integer("required").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("idx_interview_scorecard_stage").on(t.planStageId, t.sortOrder),
  ],
);
export const interviews = pgTable(
  "interviews",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull(),
    applicationId: integer("application_id"),
    planStageId: integer("plan_stage_id"),
    interviewerEmployeeId: integer("interviewer_employee_id").notNull(),
    scheduledAt: timestamp("scheduled_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, mode: "string" }),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    interviewType: text("interview_type").notNull(),
    meetingMethod: text("meeting_method"),
    location: text("location"),
    notes: text("notes"),
    feedback: text("feedback"),
    rating: doublePrecision("rating"),
    recommendation: text("recommendation"),
    status: text("status").notNull().default("scheduled"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [
    index("idx_interviews_interviewer_date").on(
      t.interviewerEmployeeId,
      t.scheduledAt,
    ),
    index("idx_interviews_application_stage").on(
      t.applicationId,
      t.planStageId,
      t.scheduledAt,
    ),
  ],
);
export const interviewParticipants = pgTable(
  "interview_participants",
  {
    id: serial("id").primaryKey(),
    interviewId: integer("interview_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    roleKey: text("role_key"),
    required: integer("required").notNull().default(1),
    status: text("status").notNull().default("assigned"),
    ...timestamps,
  },
  (t) => [
    unique("interview_participant_unique").on(
      t.interviewId,
      t.employeeId,
    ),
    index("idx_interview_participant_employee").on(t.employeeId, t.status),
  ],
);
export const interviewEvaluations = pgTable(
  "interview_evaluations",
  {
    id: serial("id").primaryKey(),
    interviewId: integer("interview_id").notNull(),
    participantId: integer("participant_id").notNull(),
    interviewerEmployeeId: integer("interviewer_employee_id").notNull(),
    notes: text("notes"),
    recommendation: text("recommendation"),
    overallScore: doublePrecision("overall_score"),
    status: text("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", {
      withTimezone: true,
      mode: "string",
    }),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("interview_evaluation_interviewer_unique").on(
      t.interviewId,
      t.interviewerEmployeeId,
    ),
    index("idx_interview_evaluation_status").on(t.status, t.submittedAt),
  ],
);
export const interviewEvaluationScores = pgTable(
  "interview_evaluation_scores",
  {
    id: serial("id").primaryKey(),
    evaluationId: integer("evaluation_id").notNull(),
    criterionId: integer("criterion_id").notNull(),
    score: doublePrecision("score").notNull(),
    comments: text("comments"),
    ...timestamps,
  },
  (t) => [
    unique("interview_evaluation_score_unique").on(
      t.evaluationId,
      t.criterionId,
    ),
  ],
);
export const jobOffers = pgTable(
  "job_offers",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    candidateId: integer("candidate_id").notNull(),
    applicationId: integer("application_id"),
    offerDate: text("offer_date").notNull(),
    joiningDate: text("joining_date").notNull(),
    position: text("position"),
    departmentId: integer("department_id"),
    managerEmployeeId: integer("manager_employee_id"),
    approvalStatus: text("approval_status").notNull().default("pending"),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    decidedByUserId: integer("decided_by_user_id"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("idx_job_offers_application")
      .on(t.applicationId)
      .where(sql`${t.applicationId} IS NOT NULL`),
    index("idx_job_offers_status_approval").on(t.status, t.approvalStatus),
  ],
);

export const lifecycleTemplates = pgTable("lifecycle_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  lifecycleType: text("lifecycle_type").notNull(),
  status: text("status").notNull().default("active"),
  createdByUserId: integer("created_by_user_id").notNull(),
  ...timestamps,
});
export const lifecycleTemplateTasks = pgTable("lifecycle_template_tasks", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull(),
  title: text("title").notNull(),
  ownerType: text("owner_type").notNull().default("hr"),
  ownerUserId: integer("owner_user_id"),
  dueOffsetDays: integer("due_offset_days").notNull().default(0),
  required: integer("required").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
});
export const employeeLifecycles = pgTable(
  "employee_lifecycles",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    lifecycleType: text("lifecycle_type").notNull(),
    templateId: integer("template_id"),
    status: text("status").notNull().default("pending"),
    reasonType: text("reason_type"),
    lastWorkingDate: text("last_working_date"),
    notes: text("notes"),
    exitInterview: text("exit_interview"),
    deactivateAccountOnCompletion: integer("deactivate_account_on_completion")
      .notNull()
      .default(1),
    startedByUserId: integer("started_by_user_id").notNull(),
    completedByUserId: integer("completed_by_user_id"),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (t) => [
    index("idx_lifecycle_employee_type_status").on(
      t.employeeId,
      t.lifecycleType,
      t.status,
    ),
  ],
);
export const lifecycleTasks = pgTable(
  "lifecycle_tasks",
  {
    id: serial("id").primaryKey(),
    lifecycleId: integer("lifecycle_id").notNull(),
    title: text("title").notNull(),
    ownerUserId: integer("owner_user_id"),
    employeeId: integer("employee_id").notNull(),
    dueDate: text("due_date"),
    status: text("status").notNull().default("pending"),
    required: integer("required").notNull().default(1),
    notes: text("notes"),
    completedByUserId: integer("completed_by_user_id"),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (t) => [
    index("idx_lifecycle_tasks_owner_due").on(
      t.ownerUserId,
      t.status,
      t.dueDate,
    ),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: serial("id").primaryKey(),
    assetCode: text("asset_code").notNull(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    brandModel: text("brand_model"),
    serialNumber: text("serial_number"),
    status: text("status").notNull().default("available"),
    assetCondition: text("asset_condition").notNull().default("good"),
    referenceDate: text("reference_date"),
    notes: text("notes"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("assets_asset_code_key").on(t.assetCode),
    index("idx_assets_status_category").on(t.status, t.category),
  ],
);
export const assetAssignments = pgTable(
  "asset_assignments",
  {
    id: serial("id").primaryKey(),
    assetId: integer("asset_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    assignedByUserId: integer("assigned_by_user_id").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    assignedCondition: text("assigned_condition"),
    assignedNotes: text("assigned_notes"),
    returnedAt: timestamp("returned_at", {
      withTimezone: true,
      mode: "string",
    }),
    returnedByUserId: integer("returned_by_user_id"),
    returnCondition: text("return_condition"),
    returnNotes: text("return_notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_asset_assignments_employee_active").on(
      t.employeeId,
      t.returnedAt,
    ),
  ],
);

export const trainingCourses = pgTable(
  "training_courses",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    provider: text("provider"),
    courseType: text("course_type").notNull(),
    description: text("description"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    status: text("status").notNull().default("draft"),
    mandatory: integer("mandatory").notNull().default(0),
    validityMonths: integer("validity_months"),
    durationHours: doublePrecision("duration_hours"),
    instructorEmployeeId: integer("instructor_employee_id"),
    instructorName: text("instructor_name"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [index("idx_training_courses_status_dates").on(t.status, t.endDate)],
);
export const trainingMaterials = pgTable(
  "training_materials",
  {
    id: serial("id").primaryKey(),
    courseId: integer("course_id").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    url: text("url"),
    objectKey: text("object_key"),
    fileName: text("file_name"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    createdByUserId: integer("created_by_user_id").notNull(),
    ...timestamps,
  },
  (t) => [index("idx_training_materials_course").on(t.courseId)],
);
export const trainingEnrollments = pgTable(
  "training_enrollments",
  {
    id: serial("id").primaryKey(),
    courseId: integer("course_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    status: text("status").notNull().default("assigned"),
    dueDate: text("due_date"),
    completionDate: text("completion_date"),
    score: doublePrecision("score"),
    certificateDocumentId: integer("certificate_document_id"),
    certificateExpiry: text("certificate_expiry"),
    evaluationJson: text("evaluation_json"),
    certificateNumber: text("certificate_number"),
    certificateJson: text("certificate_json"),
    certificateIssuedAt: timestamp("certificate_issued_at", {
      withTimezone: true,
      mode: "string",
    }),
    assignedByUserId: integer("assigned_by_user_id").notNull(),
    completedByUserId: integer("completed_by_user_id"),
    ...timestamps,
  },
  (t) => [
    unique("training_enrollments_unique").on(
      t.courseId,
      t.employeeId,
    ),
    uniqueIndex("idx_training_enrollments_certificate_number").on(
      t.certificateNumber,
    ),
    index("idx_training_enrollments_employee_status").on(
      t.employeeId,
      t.status,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    action: text("action").notNull(),
    module: text("module").notNull(),
    recordType: text("record_type"),
    recordId: text("record_id"),
    previousValue: text("previous_value"),
    newValue: text("new_value"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_audit_module_created").on(t.module, t.createdAt),
    index("idx_audit_user_created").on(t.userId, t.createdAt),
  ],
);

export const systemSettings = pgTable(
  "system_settings",
  {
    id: serial("id").primaryKey(),
    settingKey: text("setting_key").notNull(),
    valueJson: text("value_json").notNull().default("{}"),
    updatedByUserId: integer("updated_by_user_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("idx_system_settings_key").on(t.settingKey)],
);

export const salaryStructures = pgTable(
  "salary_structures",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    basicSalary: doublePrecision("basic_salary").notNull(),
    country: text("country").notNull(),
    currency: text("currency").notNull().default("SAR"),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_salary_structures_employee_effective").on(
      t.employeeId,
      t.effectiveFrom,
    ),
  ],
);

export const salaryAllowances = pgTable(
  "salary_allowances",
  {
    id: serial("id").primaryKey(),
    salaryStructureId: integer("salary_structure_id").notNull(),
    type: text("type").notNull(),
    amount: doublePrecision("amount"),
    percentage: doublePrecision("percentage"),
  },
  (t) => [index("idx_salary_allowances_structure").on(t.salaryStructureId)],
);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: serial("id").primaryKey(),
    month: integer("month").notNull(),
    year: integer("year").notNull(),
    country: text("country").notNull(),
    status: text("status").notNull().default("draft"),
    approvedBy: integer("approved_by"),
    approvedAt: timestamp("approved_at", {
      withTimezone: true,
      mode: "string",
    }),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_payroll_runs_month_year_country").on(
      t.month,
      t.year,
      t.country,
    ),
  ],
);

export const payrollItems = pgTable(
  "payroll_items",
  {
    id: serial("id").primaryKey(),
    payrollRunId: integer("payroll_run_id").notNull(),
    employeeId: integer("employee_id").notNull(),
    basicSalary: doublePrecision("basic_salary").notNull().default(0),
    totalAllowances: doublePrecision("total_allowances").notNull().default(0),
    overtimeAmount: doublePrecision("overtime_amount").notNull().default(0),
    absenceDeduction: doublePrecision("absence_deduction").notNull().default(0),
    unpaidLeaveDeduction: doublePrecision("unpaid_leave_deduction")
      .notNull()
      .default(0),
    loanDeduction: doublePrecision("loan_deduction").notNull().default(0),
    insuranceDeduction: doublePrecision("insurance_deduction")
      .notNull()
      .default(0),
    taxDeduction: doublePrecision("tax_deduction").notNull().default(0),
    netSalary: doublePrecision("net_salary").notNull().default(0),
  },
  (t) => [
    uniqueIndex("idx_payroll_items_run_employee").on(
      t.payrollRunId,
      t.employeeId,
    ),
  ],
);

export const loansAdvances = pgTable(
  "loans_advances",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull(),
    totalAmount: doublePrecision("total_amount").notNull(),
    remainingAmount: doublePrecision("remaining_amount").notNull(),
    monthlyInstallment: doublePrecision("monthly_installment").notNull(),
    status: text("status").notNull().default("active"),
    issuedAt: text("issued_at").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_loans_advances_employee_status").on(t.employeeId, t.status),
  ],
);

export const taxBrackets = pgTable(
  "tax_brackets",
  {
    id: serial("id").primaryKey(),
    country: text("country").notNull(),
    minAmount: doublePrecision("min_amount").notNull(),
    maxAmount: doublePrecision("max_amount"),
    rate: doublePrecision("rate").notNull(),
    effectiveFrom: text("effective_from").notNull(),
  },
  (t) => [
    index("idx_tax_brackets_country_effective").on(t.country, t.effectiveFrom),
  ],
);

export const insuranceRates = pgTable(
  "insurance_rates",
  {
    id: serial("id").primaryKey(),
    country: text("country").notNull(),
    employeeRate: doublePrecision("employee_rate").notNull(),
    employerRate: doublePrecision("employer_rate").notNull(),
    effectiveFrom: text("effective_from").notNull(),
  },
  (t) => [
    index("idx_insurance_rates_country_effective").on(
      t.country,
      t.effectiveFrom,
    ),
  ],
);

export const postgresHealthcheck = sql`select 1`;
