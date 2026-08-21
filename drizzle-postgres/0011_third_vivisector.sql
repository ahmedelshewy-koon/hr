ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "leave_type_id" integer;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "requested_days" double precision;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "balance_year" integer;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "balance_effect" text DEFAULT 'none';--> statement-breakpoint
-- These auth columns predate the current Drizzle snapshot. Keep the generated
-- reconciliation idempotent for databases that already applied migration 0009.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "session_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leave_policies_type_country_status" ON "leave_policies" USING btree ("leave_type_id","country","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_requests_employee_leave_dates" ON "requests" USING btree ("employee_id","leave_type_id","from_date","to_date","status");--> statement-breakpoint

-- Seed only missing policies from the leave type's configured default. Existing
-- HR-authored policies always win and are never overwritten.
INSERT INTO "leave_policies" ("leave_type_id","country","annual_entitlement","min_service_months","carry_forward","max_carry_forward","expiry_days","status","created_at","updated_at")
SELECT lt.id, country.name, lt.default_days, 0, 0, 0, NULL, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "leave_types" lt
CROSS JOIN (VALUES ('Egypt'),('Saudi Arabia')) AS country(name)
WHERE lt.status='active'
  AND lt.code NOT IN ('OFFICIAL','UNPAID')
  AND (lt.code <> 'KSA-ANNUAL' OR country.name='Saudi Arabia')
  AND NOT EXISTS (
    SELECT 1 FROM "leave_policies" lp
    WHERE lp.leave_type_id=lt.id AND lp.country=country.name AND lp.status='active'
  );--> statement-breakpoint

-- Repair only untouched imported zero balances. Any balance with activity is
-- preserved so the migration cannot overwrite operational history.
UPDATE "leave_balances" lb
SET entitlement=(
  SELECT lp.annual_entitlement
  FROM "employees" e
  JOIN "leave_policies" lp ON lp.leave_type_id=lb.leave_type_id
    AND lp.status='active' AND lp.country IN (e.country,'Both','KSA & Egypt')
  WHERE e.id=lb.employee_id
  ORDER BY CASE WHEN lp.country=e.country THEN 0 ELSE 1 END,lp.id DESC
  LIMIT 1
)
WHERE lb.entitlement=0 AND lb.used=0 AND lb.pending=0
  AND EXISTS (
    SELECT 1 FROM "employees" e JOIN "leave_policies" lp
      ON lp.leave_type_id=lb.leave_type_id AND lp.status='active'
      AND lp.country IN (e.country,'Both','KSA & Egypt')
    WHERE e.id=lb.employee_id
  );
