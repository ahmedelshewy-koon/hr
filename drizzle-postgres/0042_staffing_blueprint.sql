-- 1. Remove the superseded Workforce Planning tables (0039/0040). They were never filled in any environment this was checked on;
--    the guard refuses to drop them if anyone has entered data, so nothing can be lost silently.
DO $$
DECLARE n integer := 0; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workforce_plan_events','workforce_plan_lines','workforce_plans'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      IF n > 0 THEN RAISE EXCEPTION 'Table % still has % row(s); export or review them before dropping (nothing was changed)', t, n; END IF;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
DROP TABLE IF EXISTS "workforce_plan_events";--> statement-breakpoint
DROP TABLE IF EXISTS "workforce_plan_lines";--> statement-breakpoint
DROP TABLE IF EXISTS "workforce_plans";--> statement-breakpoint
DELETE FROM "permissions" WHERE "module" = 'workforce_planning';--> statement-breakpoint
-- 2. Company Staffing Blueprint.
CREATE TABLE IF NOT EXISTS "blueprint_company_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blueprint_company_types_code_unique" UNIQUE("code")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staffing_blueprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"company_type_id" integer NOT NULL,
	"size" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description_en" text,
	"description_ar" text,
	"is_default" integer DEFAULT 0 NOT NULL,
	"company_id" integer,
	"source_blueprint_id" integer,
	"expected_employees" integer,
	"branches_count" integer,
	"country" text,
	"business_model" text,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staffing_blueprints_kind_check" CHECK ("kind" IN ('template','company')),
	CONSTRAINT "staffing_blueprints_size_check" CHECK ("size" IN ('micro','small','medium','large'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blueprint_departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"blueprint_id" integer NOT NULL,
	"parent_id" integer,
	"kind" text DEFAULT 'department' NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"required" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blueprint_departments_kind_check" CHECK ("kind" IN ('department','section','team'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blueprint_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"blueprint_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"parent_position_id" integer,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	"seniority" text DEFAULT 'mid' NOT NULL,
	"required" integer DEFAULT 1 NOT NULL,
	"per_branch" integer DEFAULT 0 NOT NULL,
	"description_en" text,
	"description_ar" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blueprint_positions_headcount_check" CHECK ("headcount" >= 0 AND "headcount" <= 10000)
);--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staffing_blueprints_company_type_id_blueprint_company_types_id_fk') THEN ALTER TABLE "staffing_blueprints" ADD CONSTRAINT "staffing_blueprints_company_type_id_blueprint_company_types_id_fk" FOREIGN KEY ("company_type_id") REFERENCES "public"."blueprint_company_types"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staffing_blueprints_company_id_companies_id_fk') THEN ALTER TABLE "staffing_blueprints" ADD CONSTRAINT "staffing_blueprints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staffing_blueprints_source_blueprint_id_staffing_blueprints_id_fk') THEN ALTER TABLE "staffing_blueprints" ADD CONSTRAINT "staffing_blueprints_source_blueprint_id_staffing_blueprints_id_fk" FOREIGN KEY ("source_blueprint_id") REFERENCES "public"."staffing_blueprints"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blueprint_departments_blueprint_id_staffing_blueprints_id_fk') THEN ALTER TABLE "blueprint_departments" ADD CONSTRAINT "blueprint_departments_blueprint_id_staffing_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."staffing_blueprints"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blueprint_departments_parent_id_blueprint_departments_id_fk') THEN ALTER TABLE "blueprint_departments" ADD CONSTRAINT "blueprint_departments_parent_id_blueprint_departments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."blueprint_departments"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blueprint_positions_blueprint_id_staffing_blueprints_id_fk') THEN ALTER TABLE "blueprint_positions" ADD CONSTRAINT "blueprint_positions_blueprint_id_staffing_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."staffing_blueprints"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blueprint_positions_department_id_blueprint_departments_id_fk') THEN ALTER TABLE "blueprint_positions" ADD CONSTRAINT "blueprint_positions_department_id_blueprint_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."blueprint_departments"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = left('blueprint_positions_parent_position_id_blueprint_positions_id_fk', 63)) THEN ALTER TABLE "blueprint_positions" ADD CONSTRAINT "blueprint_positions_parent_position_id_blueprint_positions_id_fk" FOREIGN KEY ("parent_position_id") REFERENCES "public"."blueprint_positions"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_staffing_blueprints_kind" ON "staffing_blueprints" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_staffing_blueprints_company" ON "staffing_blueprints" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blueprint_departments_blueprint" ON "blueprint_departments" USING btree ("blueprint_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_blueprint_positions_blueprint" ON "blueprint_positions" USING btree ("blueprint_id","department_id");--> statement-breakpoint
-- 3. Permissions (existing RBAC). Super Admin bypasses the table. HR Manager designs and applies company blueprints; only Super Admin
--    manages the template library (manage_settings). Managers and employees have no access until a role is explicitly granted.
INSERT INTO "permissions" ("role_id","module","action","allowed")
SELECT r."id", 'staffing_blueprint', a."action",
  CASE WHEN r."name" = 'HR Manager' AND a."action" IN ('view','create','edit','approve','delete') THEN 1 ELSE 0 END
FROM "roles" r
CROSS JOIN (VALUES ('view'),('create'),('edit'),('approve'),('delete'),('manage_settings')) AS a("action")
WHERE r."name" IN ('HR Manager','Department Manager','Employee')
ON CONFLICT ("role_id","module","action") DO NOTHING;
