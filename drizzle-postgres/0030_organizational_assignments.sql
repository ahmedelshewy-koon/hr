CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"code" text NOT NULL,
	"country" text,
	"city" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "company_branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	CONSTRAINT "company_branches_pair" UNIQUE("company_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "hr_responsibility_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"branch_id" integer NOT NULL,
	"hr_user_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_grades" (
	"sort_order" integer DEFAULT 0 NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_grades_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "organization_branch_scopes" (
	"id" serial PRIMARY KEY NOT NULL,
	"department_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	CONSTRAINT "organization_branch_scopes_pair" UNIQUE("department_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"code" text NOT NULL,
	"company_id" integer NOT NULL,
	"job_title_id" integer,
	"department_id" integer,
	"section_id" integer,
	"team_id" integer,
	"grade_id" integer,
	"is_ceo" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "work_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"code" text NOT NULL,
	"branch_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_locations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "name_ar" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "name_en" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "organization_kind" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "branch_scope" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "section_id" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "team_id" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "position_id" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "grade_id" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "work_location_id" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "assignment_effective_date" text;--> statement-breakpoint
ALTER TABLE "company_branches" ADD CONSTRAINT "company_branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_branches" ADD CONSTRAINT "company_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_responsibility_rules" ADD CONSTRAINT "hr_responsibility_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_responsibility_rules" ADD CONSTRAINT "hr_responsibility_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_responsibility_rules" ADD CONSTRAINT "hr_responsibility_rules_hr_user_id_hr_responsibles_user_id_fk" FOREIGN KEY ("hr_user_id") REFERENCES "public"."hr_responsibles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branch_scopes" ADD CONSTRAINT "organization_branch_scopes_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_branch_scopes" ADD CONSTRAINT "organization_branch_scopes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_job_title_id_job_titles_id_fk" FOREIGN KEY ("job_title_id") REFERENCES "public"."job_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_section_id_departments_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_team_id_departments_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_grade_id_job_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."job_grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_locations" ADD CONSTRAINT "work_locations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_rules_active_scope" ON "hr_responsibility_rules" USING btree (coalesce("company_id",0),"branch_id") WHERE "hr_responsibility_rules"."status"='active';--> statement-breakpoint
CREATE UNIQUE INDEX "positions_company_ceo" ON "positions" USING btree ("company_id") WHERE "positions"."is_ceo"=1 AND "positions"."status"='active';--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_section_id_departments_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_team_id_departments_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_grade_id_job_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."job_grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_work_location_id_work_locations_id_fk" FOREIGN KEY ("work_location_id") REFERENCES "public"."work_locations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_code_unique" UNIQUE("code");
