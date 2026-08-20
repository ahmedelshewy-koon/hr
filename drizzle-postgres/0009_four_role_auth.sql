ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "session_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp with time zone;
--> statement-breakpoint
INSERT INTO roles (name,description,is_system,created_at,updated_at) VALUES ('Department Manager','Department-scoped manager',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(name) DO NOTHING;
--> statement-breakpoint
UPDATE users SET role_id=(SELECT id FROM roles WHERE name='HR Manager') WHERE role_id IN (SELECT id FROM roles WHERE name IN ('Admin','HR'));
--> statement-breakpoint
UPDATE users SET role_id=(SELECT id FROM roles WHERE name='Department Manager') WHERE role_id=(SELECT id FROM roles WHERE name='Direct Manager');
--> statement-breakpoint
DELETE FROM permissions WHERE role_id IN (SELECT id FROM roles WHERE name IN ('Admin','HR','Direct Manager'));
--> statement-breakpoint
DELETE FROM roles WHERE name IN ('Admin','HR','Direct Manager');
