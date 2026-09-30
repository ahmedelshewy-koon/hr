DROP TABLE "leave_policies" CASCADE;
--> statement-breakpoint
DELETE FROM "system_settings" WHERE "setting_key" IN ('leave', 'leave_settings', 'leave_policies');
