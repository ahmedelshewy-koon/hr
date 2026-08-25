ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "name_en" text;
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "name_ar" text;
--> statement-breakpoint
UPDATE "roles" SET "name_en"="name" WHERE "name_en" IS NULL;
