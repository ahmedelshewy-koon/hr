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
  id: serial("id").primaryKey(), name: text("name").notNull(), nameEn: text("name_en"), nameAr: text("name_ar"), description: text("description"), isSystem: integer("is_system").notNull().default(0), ...timestamps,
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
  leaveTypeId: integer("leave_type_id"), requestedDays: doublePrecision("requested_days"), balanceYear: integer("balance_year"), balanceEffect: text("balance_effect").default("none"),
  fromDate: text("from_date"), toDate: text("to_date"), requestDate: text("request_date"), requestTime: text("request_time"), amount: doublePrecision("amount"), currency: text("currency"),
  reason: text("reason"), notes: text("notes"), detailsJson: text("details_json").default("{}"), status: text("status").notNull().default("pending_manager"), currentStage: text("current_stage").notNull().default("manager"), ...timestamps,
}, (t) => [uniqueIndex("idx_requests_code").on(t.requestCode), index("idx_requests_employee_status").on(t.employeeId, t.status), index("idx_requests_stage_status").on(t.currentStage, t.status), index("idx_requests_employee_leave_dates").on(t.employeeId, t.leaveTypeId, t.fromDate, t.toDate, t.status)]);

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

export const attendanceCorrections = pgTable("attendance_corrections", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), dailyAttendanceId: integer("daily_attendance_id"), attendanceDate: text("attendance_date").notNull(),
  correctionType: text("correction_type").notNull(), originalValues: text("original_values").notNull().default("{}"), requestedValues: text("requested_values").notNull().default("{}"),
  reason: text("reason").notNull(), notes: text("notes"), status: text("status").notNull().default("pending_manager"), currentStage: text("current_stage").notNull().default("manager"),
  requestedByUserId: integer("requested_by_user_id").notNull(), resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }), ...timestamps,
}, (t) => [index("idx_attendance_corrections_employee_date").on(t.employeeId,t.attendanceDate),index("idx_attendance_corrections_status_stage").on(t.status,t.currentStage)]);

export const attendanceCorrectionActions = pgTable("attendance_correction_actions", {
  id: serial("id").primaryKey(), correctionId: integer("correction_id").notNull(), stage: text("stage").notNull(), actorUserId: integer("actor_user_id").notNull(),
  action: text("action").notNull(), reason: text("reason"), beforeValues: text("before_values"), afterValues: text("after_values"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("idx_attendance_correction_actions_correction").on(t.correctionId,t.createdAt)]);

export const attendanceExceptions = pgTable("attendance_exceptions", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), dailyAttendanceId: integer("daily_attendance_id"), attendanceDate: text("attendance_date").notNull(),
  exceptionType: text("exception_type").notNull(), status: text("status").notNull().default("open"), correctionId: integer("correction_id"), detailsJson: text("details_json").notNull().default("{}"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }), resolvedByUserId: integer("resolved_by_user_id"), ...timestamps,
}, (t) => [uniqueIndex("idx_attendance_exceptions_active_key").on(t.employeeId,t.attendanceDate,t.exceptionType),index("idx_attendance_exceptions_status_date").on(t.status,t.attendanceDate)]);

export const leaveTypes = pgTable("leave_types", {
  id: serial("id").primaryKey(), code: text("code").notNull(), nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(), defaultDays: integer("default_days").notNull().default(0), paid: integer("paid").notNull().default(1), attachmentRequired: integer("attachment_required").notNull().default(0), managerApproval: integer("manager_approval").notNull().default(1), hrApproval: integer("hr_approval").notNull().default(1), status: text("status").notNull().default("active"), ...timestamps,
}, (t) => [uniqueIndex("idx_leave_types_code").on(t.code)]);

export const employeeLeaveTypes = pgTable("employee_leave_types", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), leaveTypeId: integer("leave_type_id").notNull(), assignedByUserId: integer("assigned_by_user_id"), ...timestamps,
}, (t) => [uniqueIndex("idx_employee_leave_types_employee_type").on(t.employeeId,t.leaveTypeId),index("idx_employee_leave_types_type").on(t.leaveTypeId)]);

export const leavePolicies = pgTable("leave_policies", {
  id: serial("id").primaryKey(), leaveTypeId: integer("leave_type_id").notNull(), country: text("country").notNull(), annualEntitlement: doublePrecision("annual_entitlement").notNull(), minServiceMonths: integer("min_service_months").default(0), carryForward: integer("carry_forward").notNull().default(0), maxCarryForward: doublePrecision("max_carry_forward").default(0), expiryDays: integer("expiry_days"), status: text("status").notNull().default("active"), ...timestamps,
}, (t) => [index("idx_leave_policies_type_country_status").on(t.leaveTypeId, t.country, t.status)]);

export const leaveBalances = pgTable("leave_balances", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), leaveTypeId: integer("leave_type_id").notNull(), year: integer("year").notNull(), entitlement: doublePrecision("entitlement").notNull(), used: doublePrecision("used").notNull().default(0), pending: doublePrecision("pending").notNull().default(0),
}, (t) => [uniqueIndex("idx_leave_balances_employee_type_year").on(t.employeeId, t.leaveTypeId, t.year)]);

export const holidays = pgTable("holidays", {
  id: serial("id").primaryKey(), nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(), holidayDate: text("holiday_date").notNull(), country: text("country").notNull(), attendanceTypes: text("attendance_types").notNull().default(""), recurrenceType: text("recurrence_type").notNull().default("once"), days: doublePrecision("days").notNull().default(1), originalDate: text("original_date"), originalDateBehavior: text("original_date_behavior").default("holiday"), notes: text("notes"), status: text("status").notNull().default("active"), ...timestamps,
}, (t) => [index("idx_holidays_country_date").on(t.country, t.holidayDate)]);

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), name: text("name").notNull(), category: text("category").notNull(), documentNumber: text("document_number"), objectKey: text("object_key").notNull(), contentType: text("content_type").notNull(), sizeBytes: integer("size_bytes").notNull(), issueDate: text("issue_date"), expiryDate: text("expiry_date"), status: text("status").notNull().default("active"), version: integer("version").notNull().default(1), replacedDocumentId: integer("replaced_document_id"), uploadedByUserId: integer("uploaded_by_user_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(), archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" }),
}, (t) => [index("idx_documents_employee").on(t.employeeId), index("idx_documents_expiry_status").on(t.status,t.expiryDate), uniqueIndex("idx_documents_object_key").on(t.objectKey)]);

export const documentCategories = pgTable("document_categories", {
  id: serial("id").primaryKey(), code: text("code").notNull(), nameEn: text("name_en").notNull(), nameAr: text("name_ar").notNull(), requiresExpiry: integer("requires_expiry").notNull().default(0), requiredDocument: integer("required_document").notNull().default(0), employeeCanView: integer("employee_can_view").notNull().default(1), employeeCanUpload: integer("employee_can_upload").notNull().default(0), managerCanView: integer("manager_can_view").notNull().default(0), allowedMimeTypes: text("allowed_mime_types").notNull().default("application/pdf,image/png,image/jpeg"), maxSizeBytes: integer("max_size_bytes").notNull().default(10485760), country: text("country"), employmentType: text("employment_type"), status: text("status").notNull().default("active"), ...timestamps,
}, (t) => [uniqueIndex("idx_document_categories_code").on(t.code), index("idx_document_categories_required").on(t.requiredDocument,t.status)]);

export const documentVersions = pgTable("document_versions", {
  id: serial("id").primaryKey(), documentId: integer("document_id").notNull(), version: integer("version").notNull(), objectKey: text("object_key").notNull(), name: text("name").notNull(), contentType: text("content_type").notNull(), sizeBytes: integer("size_bytes").notNull(), uploadedByUserId: integer("uploaded_by_user_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("idx_document_versions_document_version").on(t.documentId,t.version), uniqueIndex("idx_document_versions_object_key").on(t.objectKey)]);

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(), userId: integer("user_id").notNull(), type: text("type").notNull(), titleKey: text("title_key").notNull(), messageKey: text("message_key"), entityType: text("entity_type"), entityId: text("entity_id"), targetPath: text("target_path"), dedupeKey: text("dedupe_key"), readAt: timestamp("read_at", { withTimezone: true, mode: "string" }), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("idx_notifications_user_read_created").on(t.userId,t.readAt,t.createdAt), uniqueIndex("idx_notifications_dedupe").on(t.userId,t.dedupeKey)]);

export const leaveRollovers = pgTable("leave_rollovers", {
  id: serial("id").primaryKey(), employeeId: integer("employee_id").notNull(), leaveTypeId: integer("leave_type_id").notNull(), fromYear: integer("from_year").notNull(), toYear: integer("to_year").notNull(), sourceAvailable: doublePrecision("source_available").notNull(), carriedAmount: doublePrecision("carried_amount").notNull(), expiresAt: text("expires_at"), runByUserId: integer("run_by_user_id"), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [uniqueIndex("idx_leave_rollovers_once").on(t.employeeId,t.leaveTypeId,t.fromYear,t.toYear), index("idx_leave_rollovers_year").on(t.toYear,t.employeeId)]);

export const securityRateLimits = pgTable("security_rate_limits", {
  bucketKey: text("bucket_key").primaryKey(), windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(), count: integer("count").notNull().default(1), updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("idx_security_rate_limits_updated").on(t.updatedAt)]);

export const performanceRatingScales = pgTable("performance_rating_scales", {
  id: serial("id").primaryKey(), name: text("name").notNull(), minScore: doublePrecision("min_score").notNull().default(1), maxScore: doublePrecision("max_score").notNull().default(5), labelsJson: text("labels_json").notNull().default("{}"), status: text("status").notNull().default("active"), ...timestamps,
});

export const performanceCycles = pgTable("performance_cycles", {
  id: serial("id").primaryKey(), name: text("name").notNull(), cycleType: text("cycle_type").notNull(), startDate: text("start_date").notNull(), endDate: text("end_date").notNull(), status: text("status").notNull().default("draft"), departmentIds: text("department_ids").notNull().default(""), ratingScaleId: integer("rating_scale_id"), hrReviewRequired: integer("hr_review_required").notNull().default(1), createdByUserId: integer("created_by_user_id").notNull(), ...timestamps,
}, (t) => [index("idx_performance_cycles_status_dates").on(t.status,t.endDate)]);

export const performanceReviews = pgTable("performance_reviews", {
  id: serial("id").primaryKey(), cycleId: integer("cycle_id").notNull(), employeeId: integer("employee_id").notNull(), managerEmployeeId: integer("manager_employee_id"), status: text("status").notNull().default("draft"), selfReview: text("self_review"), selfRating: doublePrecision("self_rating"), managerReview: text("manager_review"), managerRating: doublePrecision("manager_rating"), hrReview: text("hr_review"), hrRating: doublePrecision("hr_rating"), finalScore: doublePrecision("final_score"), finalizedByUserId: integer("finalized_by_user_id"), finalizedAt: timestamp("finalized_at",{withTimezone:true,mode:"string"}), ...timestamps,
}, (t) => [uniqueIndex("idx_performance_reviews_cycle_employee").on(t.cycleId,t.employeeId),index("idx_performance_reviews_employee_status").on(t.employeeId,t.status)]);

export const performanceGoals = pgTable("performance_goals", {
  id: serial("id").primaryKey(), reviewId: integer("review_id").notNull(), title: text("title").notNull(), description: text("description"), target: text("target").notNull(), measurementType: text("measurement_type").notNull().default("percentage"), actualResult: text("actual_result"), weight: doublePrecision("weight").notNull(), progress: doublePrecision("progress").notNull().default(0), result: doublePrecision("result"), employeeRating: doublePrecision("employee_rating"), managerRating: doublePrecision("manager_rating"), createdByUserId: integer("created_by_user_id").notNull(), ...timestamps,
}, (t) => [index("idx_performance_goals_review").on(t.reviewId)]);

export const performanceComments = pgTable("performance_comments", { id:serial("id").primaryKey(),reviewId:integer("review_id").notNull(),authorUserId:integer("author_user_id").notNull(),stage:text("stage").notNull(),comment:text("comment").notNull(),createdAt:timestamp("created_at",{withTimezone:true,mode:"string"}).notNull().defaultNow() });

export const jobOpenings = pgTable("job_openings", {
  id:serial("id").primaryKey(),title:text("title").notNull(),departmentId:integer("department_id"),hiringManagerEmployeeId:integer("hiring_manager_employee_id"),location:text("location"),employmentType:text("employment_type").notNull().default("full_time"),openingsCount:integer("openings_count").notNull().default(1),description:text("description"),requirements:text("requirements"),status:text("status").notNull().default("draft"),createdDate:text("created_date").notNull(),closingDate:text("closing_date"),createdByUserId:integer("created_by_user_id").notNull(),...timestamps,
},t=>[index("idx_job_openings_status_department").on(t.status,t.departmentId)]);
export const candidates = pgTable("candidates", { id:serial("id").primaryKey(),jobId:integer("job_id").notNull(),name:text("name").notNull(),email:text("email").notNull(),phone:text("phone"),resumeDocumentId:integer("resume_document_id"),source:text("source"),notes:text("notes"),stage:text("stage").notNull().default("applied"),convertedEmployeeId:integer("converted_employee_id"),createdByUserId:integer("created_by_user_id").notNull(),...timestamps },t=>[uniqueIndex("idx_candidates_job_email").on(t.jobId,t.email),index("idx_candidates_job_stage").on(t.jobId,t.stage)]);
export const interviews = pgTable("interviews", { id:serial("id").primaryKey(),candidateId:integer("candidate_id").notNull(),interviewerEmployeeId:integer("interviewer_employee_id").notNull(),scheduledAt:timestamp("scheduled_at",{withTimezone:true,mode:"string"}).notNull(),interviewType:text("interview_type").notNull(),feedback:text("feedback"),rating:doublePrecision("rating"),recommendation:text("recommendation"),status:text("status").notNull().default("scheduled"),createdByUserId:integer("created_by_user_id").notNull(),...timestamps },t=>[index("idx_interviews_interviewer_date").on(t.interviewerEmployeeId,t.scheduledAt)]);
export const jobOffers = pgTable("job_offers", { id:serial("id").primaryKey(),jobId:integer("job_id").notNull(),candidateId:integer("candidate_id").notNull(),offerDate:text("offer_date").notNull(),joiningDate:text("joining_date").notNull(),status:text("status").notNull().default("draft"),notes:text("notes"),decidedByUserId:integer("decided_by_user_id"),createdByUserId:integer("created_by_user_id").notNull(),...timestamps },t=>[uniqueIndex("idx_job_offers_candidate").on(t.candidateId)]);

export const lifecycleTemplates = pgTable("lifecycle_templates", { id:serial("id").primaryKey(),name:text("name").notNull(),lifecycleType:text("lifecycle_type").notNull(),status:text("status").notNull().default("active"),createdByUserId:integer("created_by_user_id").notNull(),...timestamps });
export const lifecycleTemplateTasks = pgTable("lifecycle_template_tasks", { id:serial("id").primaryKey(),templateId:integer("template_id").notNull(),title:text("title").notNull(),ownerType:text("owner_type").notNull().default("hr"),ownerUserId:integer("owner_user_id"),dueOffsetDays:integer("due_offset_days").notNull().default(0),required:integer("required").notNull().default(1),sortOrder:integer("sort_order").notNull().default(0) });
export const employeeLifecycles = pgTable("employee_lifecycles", { id:serial("id").primaryKey(),employeeId:integer("employee_id").notNull(),lifecycleType:text("lifecycle_type").notNull(),templateId:integer("template_id"),status:text("status").notNull().default("pending"),reasonType:text("reason_type"),lastWorkingDate:text("last_working_date"),notes:text("notes"),exitInterview:text("exit_interview"),deactivateAccountOnCompletion:integer("deactivate_account_on_completion").notNull().default(1),startedByUserId:integer("started_by_user_id").notNull(),completedByUserId:integer("completed_by_user_id"),completedAt:timestamp("completed_at",{withTimezone:true,mode:"string"}),...timestamps },t=>[index("idx_lifecycle_employee_type_status").on(t.employeeId,t.lifecycleType,t.status)]);
export const lifecycleTasks = pgTable("lifecycle_tasks", { id:serial("id").primaryKey(),lifecycleId:integer("lifecycle_id").notNull(),title:text("title").notNull(),ownerUserId:integer("owner_user_id"),employeeId:integer("employee_id").notNull(),dueDate:text("due_date"),status:text("status").notNull().default("pending"),required:integer("required").notNull().default(1),notes:text("notes"),completedByUserId:integer("completed_by_user_id"),completedAt:timestamp("completed_at",{withTimezone:true,mode:"string"}),...timestamps },t=>[index("idx_lifecycle_tasks_owner_due").on(t.ownerUserId,t.status,t.dueDate)]);

export const assets = pgTable("assets", { id:serial("id").primaryKey(),assetCode:text("asset_code").notNull(),category:text("category").notNull(),name:text("name").notNull(),brandModel:text("brand_model"),serialNumber:text("serial_number"),status:text("status").notNull().default("available"),assetCondition:text("asset_condition").notNull().default("good"),referenceDate:text("reference_date"),notes:text("notes"),createdByUserId:integer("created_by_user_id").notNull(),...timestamps },t=>[uniqueIndex("idx_assets_code").on(t.assetCode),index("idx_assets_status_category").on(t.status,t.category)]);
export const assetAssignments = pgTable("asset_assignments", { id:serial("id").primaryKey(),assetId:integer("asset_id").notNull(),employeeId:integer("employee_id").notNull(),assignedByUserId:integer("assigned_by_user_id").notNull(),assignedAt:timestamp("assigned_at",{withTimezone:true,mode:"string"}).notNull().defaultNow(),assignedCondition:text("assigned_condition"),assignedNotes:text("assigned_notes"),returnedAt:timestamp("returned_at",{withTimezone:true,mode:"string"}),returnedByUserId:integer("returned_by_user_id"),returnCondition:text("return_condition"),returnNotes:text("return_notes"),createdAt:timestamp("created_at",{withTimezone:true,mode:"string"}).notNull().defaultNow() },t=>[index("idx_asset_assignments_employee_active").on(t.employeeId,t.returnedAt)]);

export const trainingCourses = pgTable("training_courses", { id:serial("id").primaryKey(),title:text("title").notNull(),provider:text("provider"),courseType:text("course_type").notNull(),description:text("description"),startDate:text("start_date"),endDate:text("end_date"),status:text("status").notNull().default("draft"),mandatory:integer("mandatory").notNull().default(0),validityMonths:integer("validity_months"),createdByUserId:integer("created_by_user_id").notNull(),...timestamps },t=>[index("idx_training_courses_status_dates").on(t.status,t.endDate)]);
export const trainingEnrollments = pgTable("training_enrollments", { id:serial("id").primaryKey(),courseId:integer("course_id").notNull(),employeeId:integer("employee_id").notNull(),status:text("status").notNull().default("assigned"),dueDate:text("due_date"),completionDate:text("completion_date"),score:doublePrecision("score"),certificateDocumentId:integer("certificate_document_id"),certificateExpiry:text("certificate_expiry"),assignedByUserId:integer("assigned_by_user_id").notNull(),completedByUserId:integer("completed_by_user_id"),...timestamps },t=>[uniqueIndex("idx_training_enrollments_course_employee").on(t.courseId,t.employeeId),index("idx_training_enrollments_employee_status").on(t.employeeId,t.status)]);

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
