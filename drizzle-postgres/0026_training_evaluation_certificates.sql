ALTER TABLE "training_enrollments" ADD COLUMN IF NOT EXISTS "evaluation_json" text;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD COLUMN IF NOT EXISTS "certificate_number" text;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD COLUMN IF NOT EXISTS "certificate_json" text;--> statement-breakpoint
ALTER TABLE "training_enrollments" ADD COLUMN IF NOT EXISTS "certificate_issued_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_training_enrollments_certificate_number" ON "training_enrollments" USING btree ("certificate_number");