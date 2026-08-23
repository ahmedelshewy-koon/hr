CREATE TABLE "employee_leave_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type_id" integer NOT NULL,
	"assigned_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_employee_leave_types_employee_type" ON "employee_leave_types" USING btree ("employee_id","leave_type_id");--> statement-breakpoint
CREATE INDEX "idx_employee_leave_types_type" ON "employee_leave_types" USING btree ("leave_type_id");--> statement-breakpoint
INSERT INTO "employee_leave_types" ("employee_id","leave_type_id","created_at","updated_at")
SELECT DISTINCT e.id,lt.id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM "employees" e
JOIN "leave_types" lt ON lt.status='active' AND lt.code<>'OFFICIAL'
JOIN "leave_policies" lp ON lp.leave_type_id=lt.id AND lp.status='active' AND lp.country IN (e.country,'Both','KSA & Egypt')
WHERE e.employment_status IN ('active','probation','notice_period')
ON CONFLICT ("employee_id","leave_type_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "employee_leave_types" ("employee_id","leave_type_id","created_at","updated_at")
SELECT DISTINCT lb.employee_id,lb.leave_type_id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM "leave_balances" lb
JOIN "employees" e ON e.id=lb.employee_id
JOIN "leave_types" lt ON lt.id=lb.leave_type_id AND lt.status='active' AND lt.code<>'OFFICIAL'
WHERE e.employment_status IN ('active','probation','notice_period')
ON CONFLICT ("employee_id","leave_type_id") DO NOTHING;
