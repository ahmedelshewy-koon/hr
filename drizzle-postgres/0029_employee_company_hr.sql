CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name ON companies (lower(btrim(name)));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hr_responsibles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id);
--> statement-breakpoint
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hr_user_id INTEGER REFERENCES users(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_employees_hr_user ON employees(hr_user_id);
