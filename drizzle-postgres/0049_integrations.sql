-- Integrations (التكاملات): saved external API connections and their requests, driven from a Postman-style workbench.
CREATE TABLE IF NOT EXISTS "integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"auth_config" text,
	"default_headers" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"integration_id" integer NOT NULL REFERENCES "integrations"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"params" text,
	"headers" text,
	"body_type" text DEFAULT 'none' NOT NULL,
	"body" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_integration_requests_integration" ON "integration_requests" USING btree ("integration_id");
