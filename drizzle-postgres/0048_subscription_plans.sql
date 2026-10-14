-- System subscription plans (باقات النظام): managed on the Plans page and shown on the public landing page.
CREATE TABLE IF NOT EXISTS "subscription_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"description_ar" text,
	"description_en" text,
	"features_ar" text,
	"features_en" text,
	"price" double precision,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"duration_months" integer DEFAULT 1 NOT NULL,
	"max_employees" integer,
	"is_featured" integer DEFAULT 0 NOT NULL,
	"show_on_landing" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_subscription_plans_code" ON "subscription_plans" USING btree (upper("code"));
