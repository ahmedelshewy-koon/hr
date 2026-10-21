-- Timesheet Management: the per-day timesheet, its month locks and edit exceptions, the payroll variable entries and period
-- locks it feeds, and the schedule sources the calculation needs (weekly shift plans, rotating assignments, company WFH days).
-- Nothing existing is dropped or rewritten: every ALTER adds a nullable/defaulted column and daily_attendance is untouched.
CREATE TABLE IF NOT EXISTS "timesheets" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"work_date" text NOT NULL,
	"scheduled_start" text,
	"scheduled_end" text,
	"actual_start" text,
	"actual_end" text,
	"break_duration_minutes" integer DEFAULT 0 NOT NULL,
	"schedule_override" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_absent" integer DEFAULT 0 NOT NULL,
	"absence_reason" text,
	"absence_has_notice" integer,
	"absence_override" text,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_leave_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"total_work_minutes" integer DEFAULT 0 NOT NULL,
	"deduction_amount" double precision DEFAULT 0 NOT NULL,
	"overtime_amount" double precision DEFAULT 0 NOT NULL,
	"deduction_rule_id" integer,
	"deduction_details" text,
	"deduction_notification_sent" integer DEFAULT 0 NOT NULL,
	"deduction_notification_sent_at" timestamp with time zone,
	"changed_start" text,
	"changed_end" text,
	"changed_by" integer,
	"changed_at" timestamp with time zone,
	"manager_note" text,
	"manager_note_by" integer,
	"manager_note_at" timestamp with time zone,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"label_en" text,
	"label_ar" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timesheet_edit_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"month_key" text NOT NULL,
	"employee_id" integer NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"granted_by" integer,
	"closed_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timesheet_month_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"month_key" text NOT NULL,
	"payroll_country" text NOT NULL,
	"confirmed" integer DEFAULT 1 NOT NULL,
	"confirmed_by" integer,
	"confirmed_at" timestamp with time zone,
	"unlocked_by" integer,
	"unlocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_variable_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"period_key" text NOT NULL,
	"element" text NOT NULL,
	"quantity" double precision DEFAULT 0 NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'timesheet' NOT NULL,
	"detail_json" text,
	"posted_by" integer,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_month_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_key" text NOT NULL,
	"payroll_country" text NOT NULL,
	"sent_by" integer,
	"sent_at" timestamp with time zone,
	"employees_count" integer DEFAULT 0 NOT NULL,
	"delay_total" double precision DEFAULT 0 NOT NULL,
	"absence_total" double precision DEFAULT 0 NOT NULL,
	"locked" integer DEFAULT 0 NOT NULL,
	"locked_by" integer,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_plan_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text,
	"end_time" text,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"is_off" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"shift_date" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"is_off" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_wfh_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"wfh_date" text NOT NULL,
	"payroll_country" text DEFAULT '' NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "attendance_type_id" integer;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "shift_plan_id" integer;
--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN IF NOT EXISTS "religion" text;
--> statement-breakpoint
ALTER TABLE "attendance_types" ADD COLUMN IF NOT EXISTS "early_exit_allowance_minutes" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "attendance_types" ADD COLUMN IF NOT EXISTS "weekend_days" text DEFAULT '' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timesheet_edit_permissions" ADD CONSTRAINT "timesheet_edit_permissions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_variable_entries" ADD CONSTRAINT "payroll_variable_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_plan_details" ADD CONSTRAINT "shift_plan_details_plan_id_shift_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."shift_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_timesheets_employee_date" ON "timesheets" USING btree ("employee_id","work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_timesheets_date_status" ON "timesheets" USING btree ("work_date","status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_timesheet_edit_permissions_month_employee" ON "timesheet_edit_permissions" USING btree ("month_key","employee_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_timesheet_month_locks_month_country" ON "timesheet_month_locks" USING btree ("month_key","payroll_country");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payroll_variable_entries_key" ON "payroll_variable_entries" USING btree ("employee_id","period_key","element");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payroll_variable_entries_period" ON "payroll_variable_entries" USING btree ("period_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payroll_month_locks_period_country" ON "payroll_month_locks" USING btree ("period_key","payroll_country");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_shift_plan_details_plan_weekday" ON "shift_plan_details" USING btree ("plan_id","weekday");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_shift_assignments_employee_date" ON "shift_assignments" USING btree ("employee_id","shift_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_company_wfh_days_date_country" ON "company_wfh_days" USING btree ("wfh_date","payroll_country");
--> statement-breakpoint
-- Page permission for the Timesheet Management module (module key timesheetManagement). Super Admin gets every action,
-- HR Manager the working set; other roles get nothing until an administrator grants it in the permission matrix.
INSERT INTO "permissions" ("role_id","module","action","allowed")
SELECT r."id",'timesheetManagement',a."action",CASE WHEN r."name"='Super Admin' THEN 1 WHEN a."action" IN ('view','create','edit','approve','export') THEN 1 ELSE 0 END
FROM "roles" r CROSS JOIN (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export'),('manage_settings')) AS a("action")
WHERE r."name" IN ('Super Admin','HR Manager')
ON CONFLICT ("role_id","module","action") DO NOTHING;
