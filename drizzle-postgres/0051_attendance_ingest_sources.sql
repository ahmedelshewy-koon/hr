-- API ingest sources: external programs (for example a ZK integration) that POST punch records to /api/biometric-ingest.
-- Each source has its own API key and its own virtual device, so sources never mix in matching or tracking.
CREATE TABLE IF NOT EXISTS "attendance_ingest_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_hint" text NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_ip" text,
	"last_error" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_attendance_ingest_sources_key_hash" ON "attendance_ingest_sources" USING btree ("key_hash");
--> statement-breakpoint
-- Same column as 0047; repeated so this migration works on its own.
ALTER TABLE "attendance_devices" ADD COLUMN IF NOT EXISTS "country" text;
--> statement-breakpoint
-- A device with a source_id is the virtual device of an ingest source: nothing connects to it, records are pushed in.
ALTER TABLE "attendance_devices" ADD COLUMN IF NOT EXISTS "source_id" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_attendance_devices_source" ON "attendance_devices" USING btree ("source_id") WHERE "source_id" IS NOT NULL;
