CREATE TABLE IF NOT EXISTS "workforce_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"branch_id" integer,
	"plan_year" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"previous_plan_id" integer,
	"notes" text,
	"activated_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workforce_plans_status_check" CHECK ("status" IN ('draft','active','archived')),
	CONSTRAINT "workforce_plans_year_check" CHECK ("plan_year" BETWEEN 2000 AND 2100)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workforce_plan_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"branch_id" integer,
	"department_id" integer,
	"job_title_id" integer NOT NULL,
	"required_headcount" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workforce_plan_lines_required_check" CHECK ("required_headcount" >= 0 AND "required_headcount" <= 100000)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workforce_plan_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"line_id" integer,
	"action" text NOT NULL,
	"branch_id" integer,
	"department_id" integer,
	"job_title_id" integer,
	"previous_required" integer,
	"new_required" integer,
	"detail" text,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workforce_plans_company_id_companies_id_fk') THEN ALTER TABLE "workforce_plans" ADD CONSTRAINT "workforce_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workforce_plans_branch_id_branches_id_fk') THEN ALTER TABLE "workforce_plans" ADD CONSTRAINT "workforce_plans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workforce_plans_previous_plan_id_fk') THEN ALTER TABLE "workforce_plans" ADD CONSTRAINT "workforce_plans_previous_plan_id_fk" FOREIGN KEY ("previous_plan_id") REFERENCES "public"."workforce_plans"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workforce_plan_lines_plan_id_fk') THEN ALTER TABLE "workforce_plan_lines" ADD CONSTRAINT "workforce_plan_lines_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workforce_plans"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workforce_plan_lines_branch_id_branches_id_fk') THEN ALTER TABLE "workforce_plan_lines" ADD CONSTRAINT "workforce_plan_lines_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workforce_plan_lines_department_id_departments_id_fk') THEN ALTER TABLE "workforce_plan_lines" ADD CONSTRAINT "workforce_plan_lines_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workforce_plan_lines_job_title_id_job_titles_id_fk') THEN ALTER TABLE "workforce_plan_lines" ADD CONSTRAINT "workforce_plan_lines_job_title_id_job_titles_id_fk" FOREIGN KEY ("job_title_id") REFERENCES "public"."job_titles"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workforce_plan_events_plan_id_fk') THEN ALTER TABLE "workforce_plan_events" ADD CONSTRAINT "workforce_plan_events_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."workforce_plans"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workforce_plans_active_scope" ON "workforce_plans" USING btree ("company_id",coalesce("branch_id",0),"plan_year") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workforce_plans_scope" ON "workforce_plans" USING btree ("company_id","plan_year","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_workforce_plan_lines_scope" ON "workforce_plan_lines" USING btree ("plan_id",coalesce("branch_id",0),coalesce("department_id",0),"job_title_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workforce_plan_events_plan" ON "workforce_plan_events" USING btree ("plan_id","created_at");--> statement-breakpoint
INSERT INTO "permissions" ("role_id","module","action","allowed")
SELECT r."id", 'workforce_planning', a."action",
  CASE WHEN r."name" = 'HR Manager' AND a."action" IN ('view','create','edit','approve','delete','export') THEN 1
       WHEN r."name" = 'Department Manager' AND a."action" = 'view' THEN 1
       ELSE 0 END
FROM "roles" r
CROSS JOIN (VALUES ('view'),('create'),('edit'),('approve'),('delete'),('export')) AS a("action")
WHERE r."name" IN ('HR Manager','Department Manager','Employee')
ON CONFLICT ("role_id","module","action") DO NOTHING;
