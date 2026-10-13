-- Integration variables ({{name}}), request path variables (:id) and request documentation.
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "variables" text;--> statement-breakpoint
ALTER TABLE "integration_requests" ADD COLUMN IF NOT EXISTS "path_vars" text;--> statement-breakpoint
ALTER TABLE "integration_requests" ADD COLUMN IF NOT EXISTS "description" text;
