ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "employee_code_prefix" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "legacy_employee_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_companies_employee_code_prefix" ON "companies" USING btree ("employee_code_prefix");