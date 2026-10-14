CREATE TABLE IF NOT EXISTS "cost_centers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"debit_account" text NOT NULL,
	"company_id" integer REFERENCES "companies"("id"),
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_cost_centers_code" ON "cost_centers" USING btree (upper("code"));--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "cost_center_id" integer REFERENCES "cost_centers"("id");--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "salary_country" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_employees_cost_center" ON "employees" USING btree ("cost_center_id");
