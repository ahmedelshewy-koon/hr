CREATE TABLE IF NOT EXISTS "attendance_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"shift_based" integer DEFAULT 0 NOT NULL,
	"start_time" text,
	"end_time" text,
	"late_allowance_minutes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deduction_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"rule_type" text NOT NULL,
	"min_minutes" integer DEFAULT 0 NOT NULL,
	"max_minutes" integer,
	"deduction_type" text,
	"value" double precision,
	"overtime_multiplier" double precision,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medical_insurance_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"provider" text NOT NULL,
	"coverage_type" text NOT NULL,
	"max_coverage" double precision NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"employee_contribution" double precision DEFAULT 0 NOT NULL,
	"company_contribution" double precision DEFAULT 100 NOT NULL,
	"family_coverage" integer DEFAULT 0 NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_categories" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_attendance_types_code" ON "attendance_types" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deduction_rules_type_status" ON "deduction_rules" USING btree ("rule_type","status");