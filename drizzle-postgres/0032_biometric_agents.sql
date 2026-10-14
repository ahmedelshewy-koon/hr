CREATE TABLE "attendance_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"agent_version" text,
	"last_seen_at" timestamp with time zone,
	"last_ip" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "idx_attendance_devices_ip_port";--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "agent_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_attendance_agents_token_hash" ON "attendance_agents" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_attendance_devices_agent_ip_port" ON "attendance_devices" USING btree ("agent_id","ip_address","port");