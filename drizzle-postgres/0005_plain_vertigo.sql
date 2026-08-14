ALTER TABLE "holidays" ADD COLUMN "attendance_types" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "recurrence_type" text DEFAULT 'once' NOT NULL;