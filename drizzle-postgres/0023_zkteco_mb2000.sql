CREATE TABLE IF NOT EXISTS "attendance_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"model" text NOT NULL,
	"ip_address" text NOT NULL,
	"port" integer DEFAULT 4370 NOT NULL,
	"timezone" text DEFAULT 'Africa/Cairo' NOT NULL,
	"sync_interval_seconds" integer DEFAULT 300 NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"device_time" timestamp with time zone,
	"user_count" integer DEFAULT 0 NOT NULL,
	"log_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_attendance_devices_ip_port" ON "attendance_devices" USING btree ("ip_address","port");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_device_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" integer NOT NULL,
	"device_user_id" text NOT NULL,
	"device_uid" integer,
	"employee_id" integer,
	"display_name" text NOT NULL,
	"privilege" integer DEFAULT 0 NOT NULL,
	"card_number" text,
	"enabled" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_attendance_device_users_identity" ON "attendance_device_users" USING btree ("device_id","device_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_device_users_employee" ON "attendance_device_users" USING btree ("employee_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_device_punches" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" integer NOT NULL,
	"device_user_id" text NOT NULL,
	"employee_id" integer,
	"punch_serial" integer,
	"punched_at" timestamp with time zone NOT NULL,
	"punch_type" integer DEFAULT 0 NOT NULL,
	"verify_type" integer DEFAULT 0 NOT NULL,
	"attendance_log_id" integer,
	"raw_data" text DEFAULT '{}' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_attendance_device_punches_dedupe" ON "attendance_device_punches" USING btree ("device_id","device_user_id","punched_at","punch_type","verify_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_device_punches_employee_time" ON "attendance_device_punches" USING btree ("employee_id","punched_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_device_syncs" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"requested_by_user_id" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"users_found" integer DEFAULT 0 NOT NULL,
	"punches_found" integer DEFAULT 0 NOT NULL,
	"punches_imported" integer DEFAULT 0 NOT NULL,
	"unmatched_users" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attendance_device_syncs_status_requested" ON "attendance_device_syncs" USING btree ("status","requested_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_attendance_device_syncs_active" ON "attendance_device_syncs" ("device_id") WHERE "status" IN ('queued','running');
--> statement-breakpoint
INSERT INTO "attendance_devices" ("name","model","ip_address","port","timezone","sync_interval_seconds","enabled","status")
VALUES ('Main office biometric','ZKTeco MB2000','192.168.1.147',4370,'Africa/Cairo',300,1,'offline')
ON CONFLICT ("ip_address","port") DO UPDATE SET "model"=excluded."model","name"=excluded."name","updated_at"=CURRENT_TIMESTAMP;
