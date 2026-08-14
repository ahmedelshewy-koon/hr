CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"stage" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"device" text,
	"location" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"record_type" text,
	"record_id" text,
	"previous_value" text,
	"new_value" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"work_date" text NOT NULL,
	"scheduled_in" text,
	"scheduled_out" text,
	"actual_in" text,
	"actual_out" text,
	"worked_minutes" integer DEFAULT 0,
	"required_minutes" integer DEFAULT 480,
	"late_minutes" integer DEFAULT 0,
	"early_minutes" integer DEFAULT 0,
	"overtime_minutes" integer DEFAULT 0,
	"attendance_type" text DEFAULT 'office',
	"status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"manager_employee_id" integer,
	"parent_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"expiry_date" text,
	"uploaded_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"work_email" text NOT NULL,
	"fingerprint_code" text,
	"personal_phone" text,
	"work_phone" text,
	"nationality" text,
	"gender" text,
	"birth_date" text,
	"identification_number" text,
	"address" text,
	"department_id" integer,
	"job_title_id" integer,
	"manager_id" integer,
	"start_date" text NOT NULL,
	"end_date" text,
	"employment_status" text DEFAULT 'active' NOT NULL,
	"salary" double precision,
	"salary_currency" text DEFAULT 'SAR',
	"country" text NOT NULL,
	"work_location" text,
	"employment_type" text DEFAULT 'full_time',
	"schedule_type" text DEFAULT 'fixed',
	"work_days" text DEFAULT '0,1,2,3,4',
	"check_in_time" text DEFAULT '09:00',
	"check_out_time" text DEFAULT '17:00',
	"grace_minutes" integer DEFAULT 15,
	"required_daily_minutes" integer DEFAULT 480,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"holiday_date" text NOT NULL,
	"country" text NOT NULL,
	"days" double precision DEFAULT 1 NOT NULL,
	"original_date" text,
	"original_date_behavior" text DEFAULT 'holiday',
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_titles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"department_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type_id" integer NOT NULL,
	"year" integer NOT NULL,
	"entitlement" double precision NOT NULL,
	"used" double precision DEFAULT 0 NOT NULL,
	"pending" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"leave_type_id" integer NOT NULL,
	"country" text NOT NULL,
	"annual_entitlement" double precision NOT NULL,
	"min_service_months" integer DEFAULT 0,
	"carry_forward" integer DEFAULT 0 NOT NULL,
	"max_carry_forward" double precision DEFAULT 0,
	"expiry_days" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"paid" integer DEFAULT 1 NOT NULL,
	"attachment_required" integer DEFAULT 0 NOT NULL,
	"manager_approval" integer DEFAULT 1 NOT NULL,
	"hr_approval" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role_id" integer NOT NULL,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"allowed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_code" text NOT NULL,
	"employee_id" integer NOT NULL,
	"type" text NOT NULL,
	"from_date" text,
	"to_date" text,
	"request_date" text,
	"request_time" text,
	"amount" double precision,
	"currency" text,
	"reason" text,
	"notes" text,
	"details_json" text DEFAULT '{}',
	"status" text DEFAULT 'pending_manager' NOT NULL,
	"current_stage" text DEFAULT 'manager' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth_user_id" text,
	"email" text NOT NULL,
	"employee_id" integer,
	"role_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"must_change_password" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_approvals_request" ON "approvals" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_logs_employee_event" ON "attendance_logs" USING btree ("employee_id","event_at");--> statement-breakpoint
CREATE INDEX "idx_audit_module_created" ON "audit_logs" USING btree ("module","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_user_created" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_daily_attendance_employee_date" ON "daily_attendance" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "idx_daily_attendance_date_status" ON "daily_attendance" USING btree ("work_date","status");--> statement-breakpoint
CREATE INDEX "idx_documents_employee" ON "documents" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_employees_employee_code" ON "employees" USING btree ("employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_employees_work_email" ON "employees" USING btree ("work_email");--> statement-breakpoint
CREATE INDEX "idx_employees_department_status" ON "employees" USING btree ("department_id","employment_status");--> statement-breakpoint
CREATE INDEX "idx_employees_manager" ON "employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "idx_holidays_country_date" ON "holidays" USING btree ("country","holiday_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_leave_balances_employee_type_year" ON "leave_balances" USING btree ("employee_id","leave_type_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_permissions_role_module_action" ON "permissions" USING btree ("role_id","module","action");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_requests_code" ON "requests" USING btree ("request_code");--> statement-breakpoint
CREATE INDEX "idx_requests_employee_status" ON "requests" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "idx_requests_stage_status" ON "requests" USING btree ("current_stage","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_roles_name" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_auth_user_id" ON "users" USING btree ("auth_user_id");