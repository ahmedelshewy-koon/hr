DROP INDEX "idx_employees_work_email";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_employees_work_email" ON "employees" USING btree ("work_email") WHERE employment_status <> 'deleted';