CREATE TABLE "attendance_correction_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"correction_id" integer NOT NULL,
	"stage" text NOT NULL,
	"actor_user_id" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"before_values" text,
	"after_values" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"daily_attendance_id" integer,
	"attendance_date" text NOT NULL,
	"correction_type" text NOT NULL,
	"original_values" text DEFAULT '{}' NOT NULL,
	"requested_values" text DEFAULT '{}' NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending_manager' NOT NULL,
	"current_stage" text DEFAULT 'manager' NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"daily_attendance_id" integer,
	"attendance_date" text NOT NULL,
	"exception_type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"correction_id" integer,
	"details_json" text DEFAULT '{}' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_attendance_correction_actions_correction" ON "attendance_correction_actions" USING btree ("correction_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_attendance_corrections_employee_date" ON "attendance_corrections" USING btree ("employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "idx_attendance_corrections_status_stage" ON "attendance_corrections" USING btree ("status","current_stage");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_attendance_exceptions_active_key" ON "attendance_exceptions" USING btree ("employee_id","attendance_date","exception_type");--> statement-breakpoint
CREATE INDEX "idx_attendance_exceptions_status_date" ON "attendance_exceptions" USING btree ("status","attendance_date");