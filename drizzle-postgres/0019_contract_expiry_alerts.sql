UPDATE "employees"
SET "end_date"=(("start_date"::date + INTERVAL '1 year' - INTERVAL '1 day')::date)::text,
    "updated_at"=CURRENT_TIMESTAMP
WHERE "end_date" IS NULL
  AND "employment_status" IN ('active','probation','notice_period');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_employees_contract_end" ON "employees" USING btree ("employment_status","end_date");
