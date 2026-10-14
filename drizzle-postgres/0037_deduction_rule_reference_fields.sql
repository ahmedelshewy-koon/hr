ALTER TABLE "deduction_rules" ALTER COLUMN "min_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deduction_rules" ADD COLUMN IF NOT EXISTS "absence_notice" text;
