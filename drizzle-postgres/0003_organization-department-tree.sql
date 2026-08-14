UPDATE departments
SET name_en='Koon', name_ar='كون', parent_id=(SELECT id FROM departments WHERE name_en='Managing Director Office' LIMIT 1), updated_at=CURRENT_TIMESTAMP
WHERE name_en='Business Development';
--> statement-breakpoint
UPDATE departments
SET parent_id=(SELECT id FROM departments WHERE name_en='Managing Director Office' LIMIT 1), updated_at=CURRENT_TIMESTAMP
WHERE name_en IN ('Asus Merchants','Koon Agency');
--> statement-breakpoint
UPDATE departments
SET parent_id=(SELECT id FROM departments WHERE name_en='Koon' LIMIT 1), updated_at=CURRENT_TIMESTAMP
WHERE name_en='Technology';
--> statement-breakpoint
UPDATE departments
SET parent_id=(SELECT id FROM departments WHERE name_en='Technology' LIMIT 1), updated_at=CURRENT_TIMESTAMP
WHERE name_en IN ('IT Systems','Software Development','UX/UI','Data Analytics');
--> statement-breakpoint
UPDATE departments
SET parent_id=(SELECT id FROM departments WHERE name_en='Asus Merchants' LIMIT 1), updated_at=CURRENT_TIMESTAMP
WHERE name_en IN ('Accounting','Sales','Customer Service','Human Resources','Contracts');
