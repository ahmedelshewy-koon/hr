ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "document_number" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "issue_date" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "replaced_document_id" integer;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "documents" SET "content_type"='application/octet-stream' WHERE "content_type" IS NULL;
--> statement-breakpoint
UPDATE "documents" SET "size_bytes"=0 WHERE "size_bytes" IS NULL;
--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "content_type" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "size_bytes" SET NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_categories" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name_en" text NOT NULL,
  "name_ar" text NOT NULL,
  "requires_expiry" integer DEFAULT 0 NOT NULL,
  "required_document" integer DEFAULT 0 NOT NULL,
  "employee_can_view" integer DEFAULT 1 NOT NULL,
  "employee_can_upload" integer DEFAULT 0 NOT NULL,
  "manager_can_view" integer DEFAULT 0 NOT NULL,
  "allowed_mime_types" text DEFAULT 'application/pdf,image/png,image/jpeg' NOT NULL,
  "max_size_bytes" integer DEFAULT 10485760 NOT NULL,
  "country" text,
  "employment_type" text,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_document_categories_code" ON "document_categories" ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_categories_required" ON "document_categories" ("required_document","status");
--> statement-breakpoint
INSERT INTO "document_categories" ("code","name_en","name_ar","requires_expiry","required_document","employee_can_view","employee_can_upload","manager_can_view") VALUES
 ('employment_contract','Employment Contract','عقد العمل',0,1,1,0,0),
 ('national_id','National ID','الهوية الوطنية',1,0,1,0,0),
 ('passport','Passport','جواز السفر',1,0,1,0,0),
 ('work_permit','Iqama / Work Permit','الإقامة / تصريح العمل',1,0,1,0,0),
 ('certificate','Certificate','شهادة',0,0,1,0,0),
 ('medical_certificate','Medical Certificate','شهادة طبية',0,0,1,1,0),
 ('hr_letter','HR Letter','خطاب موارد بشرية',0,0,1,0,0),
 ('experience_certificate','Experience Certificate','شهادة خبرة',0,0,1,0,0),
 ('other','Other','أخرى',0,0,1,0,0)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer NOT NULL,
  "version" integer NOT NULL,
  "object_key" text NOT NULL,
  "name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "uploaded_by_user_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "document_versions_document_version_unique" UNIQUE("document_id","version"),
  CONSTRAINT "document_versions_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "type" text NOT NULL,
  "title_key" text NOT NULL,
  "message_key" text,
  "entity_type" text,
  "entity_id" text,
  "target_path" text,
  "dedupe_key" text,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_read_created" ON "notifications" ("user_id","read_at","created_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_notifications_dedupe" ON "notifications" ("user_id","dedupe_key") WHERE "dedupe_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_rollovers" (
  "id" serial PRIMARY KEY NOT NULL,
  "employee_id" integer NOT NULL,
  "leave_type_id" integer NOT NULL,
  "from_year" integer NOT NULL,
  "to_year" integer NOT NULL,
  "source_available" double precision NOT NULL,
  "carried_amount" double precision NOT NULL,
  "expires_at" text,
  "run_by_user_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "leave_rollovers_once_unique" UNIQUE("employee_id","leave_type_id","from_year","to_year")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_expiry_status" ON "documents" ("status","expiry_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_documents_object_key" ON "documents" ("object_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_leave_rollovers_year" ON "leave_rollovers" ("to_year","employee_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "security_rate_limits" (
  "bucket_key" text PRIMARY KEY NOT NULL,
  "window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "count" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_security_rate_limits_updated" ON "security_rate_limits" ("updated_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.add_fk_if_clean(p_constraint_name text, child_table text, child_column text, parent_table text, parent_column text, delete_action text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE orphan_exists boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname=p_constraint_name) THEN RETURN; END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I c LEFT JOIN %I p ON p.%I=c.%I WHERE c.%I IS NOT NULL AND p.%I IS NULL)',child_table,parent_table,parent_column,child_column,child_column,parent_column) INTO orphan_exists;
  IF orphan_exists THEN
    RAISE NOTICE 'Skipping constraint % because orphan rows exist; repair data and rerun the integrity migration',p_constraint_name;
  ELSE
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I) ON DELETE %s',child_table,p_constraint_name,child_column,parent_table,parent_column,delete_action);
  END IF;
END $$;
--> statement-breakpoint
SELECT pg_temp.add_fk_if_clean('users_employee_fk','users','employee_id','employees','id','SET NULL');
SELECT pg_temp.add_fk_if_clean('users_role_fk','users','role_id','roles','id','RESTRICT');
SELECT pg_temp.add_fk_if_clean('requests_employee_fk','requests','employee_id','employees','id','RESTRICT');
SELECT pg_temp.add_fk_if_clean('approvals_request_fk','approvals','request_id','requests','id','RESTRICT');
SELECT pg_temp.add_fk_if_clean('attendance_logs_employee_fk','attendance_logs','employee_id','employees','id','RESTRICT');
SELECT pg_temp.add_fk_if_clean('daily_attendance_employee_fk','daily_attendance','employee_id','employees','id','RESTRICT');
SELECT pg_temp.add_fk_if_clean('leave_balances_employee_fk','leave_balances','employee_id','employees','id','RESTRICT');
SELECT pg_temp.add_fk_if_clean('leave_balances_type_fk','leave_balances','leave_type_id','leave_types','id','RESTRICT');
SELECT pg_temp.add_fk_if_clean('documents_employee_fk','documents','employee_id','employees','id','RESTRICT');
SELECT pg_temp.add_fk_if_clean('documents_uploader_fk','documents','uploaded_by_user_id','users','id','RESTRICT');
SELECT pg_temp.add_fk_if_clean('attendance_corrections_employee_fk','attendance_corrections','employee_id','employees','id','RESTRICT');
SELECT pg_temp.add_fk_if_clean('correction_actions_correction_fk','attendance_correction_actions','correction_id','attendance_corrections','id','RESTRICT');
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='notifications_user_fk') THEN ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_versions_document_fk') THEN ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_versions_uploader_fk') THEN ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploader_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='leave_rollovers_employee_fk') THEN ALTER TABLE "leave_rollovers" ADD CONSTRAINT "leave_rollovers_employee_fk" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='leave_rollovers_type_fk') THEN ALTER TABLE "leave_rollovers" ADD CONSTRAINT "leave_rollovers_type_fk" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT; END IF;
END $$;
