ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "marital_status" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "profile_notes" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_job_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL REFERENCES "employees"("id"),
	"company_id" integer REFERENCES "companies"("id"),
	"branch_id" integer REFERENCES "branches"("id"),
	"department_id" integer REFERENCES "departments"("id"),
	"section_id" integer REFERENCES "departments"("id"),
	"job_title_id" integer REFERENCES "job_titles"("id"),
	"position_id" integer REFERENCES "positions"("id"),
	"start_date" text NOT NULL,
	"end_date" text,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_employee_job_history_employee" ON "employee_job_history" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_employee_job_history_open" ON "employee_job_history" USING btree ("employee_id") WHERE "end_date" IS NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_emergency_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL REFERENCES "employees"("id"),
	"name" text NOT NULL,
	"relationship" text NOT NULL,
	"phone" text NOT NULL,
	"alternate_phone" text,
	"is_primary" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_employee_emergency_contacts_employee" ON "employee_emergency_contacts" USING btree ("employee_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_medical_insurance" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL REFERENCES "employees"("id"),
	"plan_id" integer NOT NULL REFERENCES "medical_insurance_plans"("id"),
	"card_number" text,
	"start_date" text NOT NULL,
	"end_date" text,
	"dependents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_employee_medical_insurance_active" ON "employee_medical_insurance" USING btree ("employee_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "administrative_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_number" text NOT NULL,
	"decision_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"effective_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" integer NOT NULL REFERENCES "users"("id"),
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" integer REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_administrative_decisions_number" ON "administrative_decisions" USING btree ("decision_number");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "administrative_decision_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_id" integer NOT NULL REFERENCES "administrative_decisions"("id"),
	"employee_id" integer NOT NULL REFERENCES "employees"("id"),
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" integer REFERENCES "users"("id"),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "administrative_decision_recipients_pair" UNIQUE("decision_id","employee_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_decision_recipients_pending" ON "administrative_decision_recipients" USING btree ("employee_id","acknowledged_at");--> statement-breakpoint
-- One open history row per employee from the current assignment, so every profile starts with its present job.
INSERT INTO "employee_job_history" ("employee_id","company_id","branch_id","department_id","section_id","job_title_id","position_id","start_date","change_reason")
SELECT e.id,e.company_id,e.branch_id,e.department_id,e.section_id,e.job_title_id,e.position_id,COALESCE(NULLIF(e.assignment_effective_date,''),NULLIF(e.start_date,''),CURRENT_DATE::text),'current_assignment'
FROM employees e WHERE e.employment_status<>'deleted' AND NOT EXISTS (SELECT 1 FROM employee_job_history h WHERE h.employee_id=e.id);--> statement-breakpoint
-- Administrative decisions: HR managers and department managers may open the page and send decisions by default.
INSERT INTO "permissions" ("role_id","module","action","allowed")
SELECT r.id,'administrative_decisions',a.action,1 FROM roles r CROSS JOIN (VALUES ('view'),('create')) AS a(action)
WHERE r.name IN ('HR Manager','Department Manager')
ON CONFLICT ("role_id","module","action") DO NOTHING;
