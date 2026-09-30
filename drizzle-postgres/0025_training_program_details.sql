CREATE TABLE IF NOT EXISTS "training_materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"object_key" text,
	"file_name" text,
	"content_type" text,
	"size_bytes" integer,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN IF NOT EXISTS "duration_hours" double precision;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN IF NOT EXISTS "instructor_employee_id" integer;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN IF NOT EXISTS "instructor_name" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_training_materials_course" ON "training_materials" USING btree ("course_id");
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_duration" CHECK (duration_hours IS NULL OR (duration_hours > 0 AND duration_hours <= 1000)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_instructor_single" CHECK (instructor_employee_id IS NULL OR instructor_name IS NULL); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_instructor_fk" FOREIGN KEY (instructor_employee_id) REFERENCES employees(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "training_materials" ADD CONSTRAINT "training_materials_kind" CHECK (kind IN ('link','file')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "training_materials" ADD CONSTRAINT "training_materials_payload" CHECK ((kind = 'link' AND url IS NOT NULL) OR (kind = 'file' AND object_key IS NOT NULL)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "training_materials" ADD CONSTRAINT "training_materials_course_fk" FOREIGN KEY (course_id) REFERENCES training_courses(id) ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
