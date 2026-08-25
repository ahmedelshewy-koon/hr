ALTER TABLE departments
ADD COLUMN IF NOT EXISTS unit_type text DEFAULT 'department' NOT NULL;
--> statement-breakpoint
UPDATE departments
SET unit_type = 'company',
    updated_at = CURRENT_TIMESTAMP
WHERE lower(trim(name_en)) IN ('koon software', 'asus cards', 'asas card', 'koon agency')
   OR regexp_replace(trim(name_ar), '[أإآ]', 'ا', 'g') IN ('كون', 'كون برمجة', 'كون للبرمجة', 'اسس كارد', 'وكالة كون', 'وكاله كون');
--> statement-breakpoint
ALTER TABLE departments
DROP CONSTRAINT IF EXISTS departments_unit_type_check;
--> statement-breakpoint
ALTER TABLE departments
ADD CONSTRAINT departments_unit_type_check CHECK (unit_type IN ('company', 'department'));
