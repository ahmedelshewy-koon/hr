ALTER TABLE performance_goals ADD COLUMN IF NOT EXISTS measurement_type text NOT NULL DEFAULT 'percentage';
--> statement-breakpoint
ALTER TABLE performance_goals ADD COLUMN IF NOT EXISTS actual_result text;
--> statement-breakpoint
ALTER TABLE performance_goals ADD COLUMN IF NOT EXISTS employee_rating double precision;
--> statement-breakpoint
ALTER TABLE performance_goals ADD COLUMN IF NOT EXISTS manager_rating double precision;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_goals_measurement_type') THEN
    ALTER TABLE performance_goals ADD CONSTRAINT performance_goals_measurement_type CHECK (measurement_type IN ('percentage','number','rating','yes_no'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_goals_employee_rating') THEN
    ALTER TABLE performance_goals ADD CONSTRAINT performance_goals_employee_rating CHECK (employee_rating IS NULL OR (employee_rating >= 1 AND employee_rating <= 5));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_goals_manager_rating') THEN
    ALTER TABLE performance_goals ADD CONSTRAINT performance_goals_manager_rating CHECK (manager_rating IS NULL OR (manager_rating >= 1 AND manager_rating <= 5));
  END IF;
END $$;
