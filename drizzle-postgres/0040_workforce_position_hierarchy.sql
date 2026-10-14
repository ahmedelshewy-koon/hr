ALTER TABLE "workforce_plan_lines" ADD COLUMN IF NOT EXISTS "parent_line_id" integer;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workforce_plan_lines_parent_line_id_fk') THEN ALTER TABLE "workforce_plan_lines" ADD CONSTRAINT "workforce_plan_lines_parent_line_id_fk" FOREIGN KEY ("parent_line_id") REFERENCES "public"."workforce_plan_lines"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_workforce_plan_lines_parent" ON "workforce_plan_lines" USING btree ("parent_line_id");
