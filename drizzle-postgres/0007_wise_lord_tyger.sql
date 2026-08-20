CREATE TABLE "insurance_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"employee_rate" double precision NOT NULL,
	"employer_rate" double precision NOT NULL,
	"effective_from" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans_advances" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"total_amount" double precision NOT NULL,
	"remaining_amount" double precision NOT NULL,
	"monthly_installment" double precision NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"issued_at" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"payroll_run_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"basic_salary" double precision DEFAULT 0 NOT NULL,
	"total_allowances" double precision DEFAULT 0 NOT NULL,
	"overtime_amount" double precision DEFAULT 0 NOT NULL,
	"absence_deduction" double precision DEFAULT 0 NOT NULL,
	"unpaid_leave_deduction" double precision DEFAULT 0 NOT NULL,
	"loan_deduction" double precision DEFAULT 0 NOT NULL,
	"insurance_deduction" double precision DEFAULT 0 NOT NULL,
	"tax_deduction" double precision DEFAULT 0 NOT NULL,
	"net_salary" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"country" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_allowances" (
	"id" serial PRIMARY KEY NOT NULL,
	"salary_structure_id" integer NOT NULL,
	"type" text NOT NULL,
	"amount" double precision,
	"percentage" double precision
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"basic_salary" double precision NOT NULL,
	"country" text NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_brackets" (
	"id" serial PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"min_amount" double precision NOT NULL,
	"max_amount" double precision,
	"rate" double precision NOT NULL,
	"effective_from" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_insurance_rates_country_effective" ON "insurance_rates" USING btree ("country","effective_from");--> statement-breakpoint
CREATE INDEX "idx_loans_advances_employee_status" ON "loans_advances" USING btree ("employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payroll_items_run_employee" ON "payroll_items" USING btree ("payroll_run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payroll_runs_month_year_country" ON "payroll_runs" USING btree ("month","year","country");--> statement-breakpoint
CREATE INDEX "idx_salary_allowances_structure" ON "salary_allowances" USING btree ("salary_structure_id");--> statement-breakpoint
CREATE INDEX "idx_salary_structures_employee_effective" ON "salary_structures" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "idx_tax_brackets_country_effective" ON "tax_brackets" USING btree ("country","effective_from");