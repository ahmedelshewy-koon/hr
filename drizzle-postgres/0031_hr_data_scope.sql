-- Also added at runtime by ensureAuthSchema (portal-auth.ts), so this must tolerate an existing column.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hr_data_scope" text DEFAULT 'all' NOT NULL;
