ALTER TABLE "lifecycle_template_tasks"
ADD COLUMN IF NOT EXISTS "owner_user_id" integer;
