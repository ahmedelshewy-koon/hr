-- Weekdays (0=Sunday … 6=Saturday, a subset of work_days) the employee works remotely; every other working day is an office day.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "remote_days" text DEFAULT '' NOT NULL;
