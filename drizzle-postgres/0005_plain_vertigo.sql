ALTER TABLE "holidays" ADD COLUMN IF NOT EXISTS "attendance_types" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN IF NOT EXISTS "recurrence_type" text DEFAULT 'once' NOT NULL;
