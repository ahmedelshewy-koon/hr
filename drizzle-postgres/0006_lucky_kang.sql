ALTER TABLE "leave_types" ADD COLUMN IF NOT EXISTS "code" text;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN IF NOT EXISTS "default_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

UPDATE "leave_types" SET "code"='ANNUAL_21', "name_en"='Annual Leave', "name_ar"='إجازة سنوية 21', "default_days"=21, "paid"=1, "manager_approval"=1, "hr_approval"=1, "status"='active', "updated_at"=CURRENT_TIMESTAMP WHERE lower("name_en")='annual leave';--> statement-breakpoint
UPDATE "leave_types" SET "code"='SICK', "name_en"='Sick Leave', "name_ar"='إجازة مرضية', "default_days"=30, "paid"=1, "manager_approval"=1, "hr_approval"=1, "status"='active', "updated_at"=CURRENT_TIMESTAMP WHERE lower("name_en")='sick leave';--> statement-breakpoint
UPDATE "leave_types" SET "code"='UNPAID', "name_en"='Unpaid Leave', "name_ar"='إجازة بدون راتب', "default_days"=0, "paid"=0, "manager_approval"=1, "hr_approval"=1, "status"='active', "updated_at"=CURRENT_TIMESTAMP WHERE lower("name_en")='unpaid leave';--> statement-breakpoint
UPDATE "leave_types" SET "code"='LEGACY_' || "id" WHERE "code" IS NULL;--> statement-breakpoint

INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT '6','Casual leave','إجازة عارضة',6,1,0,1,1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='6');--> statement-breakpoint
INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT 'ANNUAL_21','Annual Leave','إجازة سنوية 21',21,1,0,1,1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='ANNUAL_21');--> statement-breakpoint
INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT 'ANNUAL_10','Year Insurance Annual Vacation 10','إجازات المؤمن عليه 10 عام',30,1,0,1,1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='ANNUAL_10');--> statement-breakpoint
INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT 'ANNUAL_15','annual 15 day for first Year','إجازة 15 يوم أول عام',15,1,0,1,1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='ANNUAL_15');--> statement-breakpoint
INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT 'EXAM-VACATION','Exam Vacation','إجازة امتحانات',100,1,0,1,1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='EXAM-VACATION');--> statement-breakpoint
INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT 'KSA-ANNUAL','KSA Annual Vacation','إجازات السعودية',20,1,0,1,1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='KSA-ANNUAL');--> statement-breakpoint
INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT 'MATERNITY','Maternity Leave','إجازة وضع',70,1,0,1,1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='MATERNITY');--> statement-breakpoint
INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT 'OFFICIAL','Official Holiday','إجازة رسمية',365,1,0,0,0,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='OFFICIAL');--> statement-breakpoint
INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT 'PATERNITY','Paternity Leave','إجازة أبوة',3,1,0,1,1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='PATERNITY');--> statement-breakpoint
INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT 'SICK','Sick Leave','إجازة مرضية',30,1,0,1,1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='SICK');--> statement-breakpoint
INSERT INTO "leave_types" ("code","name_en","name_ar","default_days","paid","attachment_required","manager_approval","hr_approval","status","created_at","updated_at")
SELECT 'UNPAID','Unpaid Leave','إجازة بدون راتب',0,0,0,1,1,'active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM "leave_types" WHERE "code"='UNPAID');--> statement-breakpoint

ALTER TABLE "leave_types" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_leave_types_code" ON "leave_types" USING btree ("code");
