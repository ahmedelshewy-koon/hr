ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "fingerprint_required" integer DEFAULT 1 NOT NULL;
