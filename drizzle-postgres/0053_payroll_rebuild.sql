-- Additive payroll rebuild. Historical payroll_items, salary_structures and accounting data remain intact.
CREATE TABLE IF NOT EXISTS business_units (id serial PRIMARY KEY, code text NOT NULL UNIQUE, name_en text NOT NULL, name_ar text NOT NULL, is_active integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS business_unit_cost_center_mapping (id serial PRIMARY KEY, business_unit_id integer NOT NULL REFERENCES business_units(id), cost_center_id integer NOT NULL REFERENCES cost_centers(id), payroll_dr_account text, CONSTRAINT idx_bu_cc_mapping UNIQUE (business_unit_id,cost_center_id));
CREATE TABLE IF NOT EXISTS payroll_currencies (code text PRIMARY KEY, name_en text NOT NULL, name_ar text NOT NULL, sar_rate double precision NOT NULL CHECK (sar_rate > 0), is_active integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO payroll_currencies(code,name_en,name_ar,sar_rate) VALUES ('SAR','Saudi riyal','ريال سعودي',1) ON CONFLICT(code) DO NOTHING;
CREATE TABLE IF NOT EXISTS hr_managers (id serial PRIMARY KEY, user_id integer NOT NULL UNIQUE REFERENCES users(id), region text CHECK(region IN ('Egypt','KSA') OR region IS NULL), admin_order integer NOT NULL DEFAULT 0, is_active integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS hr_manager_business_units (manager_id integer NOT NULL REFERENCES hr_managers(id), business_unit_id integer NOT NULL REFERENCES business_units(id), CONSTRAINT idx_hr_manager_unit UNIQUE(manager_id,business_unit_id));
CREATE TABLE IF NOT EXISTS payroll_elements (id serial PRIMARY KEY, code text NOT NULL UNIQUE, name_en text NOT NULL, name_ar text NOT NULL, element_type text NOT NULL CHECK(element_type IN ('earning','deduction','employer_contribution')), classification text, calculation_type text NOT NULL DEFAULT 'fixed' CHECK(calculation_type IN ('fixed','percentage','formula','delay_minutes','absence_days','variable')), default_amount double precision NOT NULL DEFAULT 0, formula text, sort_order integer NOT NULL DEFAULT 0, is_active integer NOT NULL DEFAULT 1, element_account text, element_account_name text, is_basic_salary_element integer NOT NULL DEFAULT 0, is_delay_minutes_element integer NOT NULL DEFAULT 0, is_absence_element integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_basic_flag ON payroll_elements(is_basic_salary_element) WHERE is_basic_salary_element=1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_delay_flag ON payroll_elements(is_delay_minutes_element) WHERE is_delay_minutes_element=1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_absence_flag ON payroll_elements(is_absence_element) WHERE is_absence_element=1;
CREATE TABLE IF NOT EXISTS payroll_element_eligibility (id serial PRIMARY KEY, element_id integer NOT NULL REFERENCES payroll_elements(id), job_title_id integer, department_id integer);
CREATE TABLE IF NOT EXISTS payroll_employee_elements (id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), element_id integer NOT NULL REFERENCES payroll_elements(id), amount double precision NOT NULL DEFAULT 0, effective_from text NOT NULL, effective_to text, is_active integer NOT NULL DEFAULT 1, notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_payroll_employee_elements_period ON payroll_employee_elements(employee_id,effective_from,effective_to);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS working_business_unit_id integer REFERENCES business_units(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS dopay_employee_number text;
ALTER TABLE payroll_variable_entries ADD COLUMN IF NOT EXISTS element_id integer REFERENCES payroll_elements(id);
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS sar_currency_rate double precision;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS currency text;
DROP INDEX IF EXISTS idx_payroll_runs_month_year_country;
CREATE UNIQUE INDEX idx_payroll_runs_month_year_country ON payroll_runs(month,year,country) WHERE currency IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_period_currency ON payroll_runs(month,year,country,currency) WHERE currency IS NOT NULL;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_gross double precision NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_deductions double precision NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_net double precision NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS employee_count integer NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS input_fingerprint text;
ALTER TABLE approval_workflow_runs ALTER COLUMN workflow_id DROP NOT NULL;
CREATE TABLE IF NOT EXISTS request_escalations (id serial PRIMARY KEY, workflow_run_id integer NOT NULL REFERENCES approval_workflow_runs(id), request_id integer NOT NULL REFERENCES requests(id), from_step integer NOT NULL, to_step integer NOT NULL, from_user_id integer REFERENCES users(id), to_user_id integer NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS idx_request_escalations_run_step ON request_escalations(workflow_run_id,from_step);
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS confirmed_by integer;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS sent_to_accounting_by integer;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS sent_to_accounting_at timestamptz;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS erp_post_started_at timestamptz;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS erp_post_failed_at timestamptz;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS erp_batch_number text;
CREATE TABLE IF NOT EXISTS payroll_run_lines (id serial PRIMARY KEY, run_id integer NOT NULL REFERENCES payroll_runs(id), employee_id integer NOT NULL REFERENCES employees(id), element_id integer REFERENCES payroll_elements(id), element_code text NOT NULL, element_name_en text NOT NULL, element_name_ar text NOT NULL, element_type text NOT NULL, amount double precision NOT NULL, minutes double precision NOT NULL DEFAULT 0, currency text NOT NULL, notes text, business_unit_code text, cost_center_code text, department_code text, element_account text, fallback_account text, employee_code text);
CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_run_employee ON payroll_run_lines(run_id,employee_id);
CREATE TABLE IF NOT EXISTS payroll_erp_settings (id integer PRIMARY KEY DEFAULT 1 CHECK(id=1), invoice_url text NOT NULL DEFAULT '', invoice_method text NOT NULL DEFAULT 'POST', batch_url text NOT NULL DEFAULT '', batch_method text NOT NULL DEFAULT 'GET', api_key text NOT NULL DEFAULT '', default_status text NOT NULL DEFAULT 'DRAFT', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payroll_erp_invoice_attempts (id serial PRIMARY KEY, run_id integer NOT NULL REFERENCES payroll_runs(id), batch_number text NOT NULL, business_unit_code text NOT NULL, http_status integer NOT NULL, response_body text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_payroll_erp_invoice_attempts_run ON payroll_erp_invoice_attempts(run_id,id);
CREATE TABLE IF NOT EXISTS payroll_erp_reconciliations (id serial PRIMARY KEY, run_id integer NOT NULL REFERENCES payroll_runs(id), outcome text NOT NULL CHECK(outcome IN ('not_posted','voided','posted')), evidence_reference text NOT NULL, note text, submitted_by integer NOT NULL REFERENCES users(id), submitted_at timestamptz NOT NULL DEFAULT now(), verified_by integer REFERENCES users(id), verified_at timestamptz, used_by integer REFERENCES users(id), used_at timestamptz);
CREATE INDEX IF NOT EXISTS idx_payroll_erp_reconciliations_run ON payroll_erp_reconciliations(run_id,id);
CREATE TABLE IF NOT EXISTS employee_wfh_days (id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), wfh_date text NOT NULL, approved_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT idx_employee_wfh_days_employee_date UNIQUE(employee_id,wfh_date));
CREATE TABLE IF NOT EXISTS wfh_sessions (id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), work_date text NOT NULL, checked_in_at timestamptz NOT NULL, checked_out_at timestamptz, created_by integer NOT NULL REFERENCES users(id), forced_by integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_wfh_sessions_employee_date ON wfh_sessions(employee_id,work_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wfh_sessions_one_open ON wfh_sessions(employee_id) WHERE checked_out_at IS NULL;
CREATE TABLE IF NOT EXISTS saved_attendance (id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id), employee_code text NOT NULL, work_date text NOT NULL, check_in text, check_out text, work_minutes integer NOT NULL DEFAULT 0, expected_minutes integer NOT NULL DEFAULT 0, difference_minutes integer NOT NULL DEFAULT 0, status text NOT NULL, vacation_type text, deduction_rule_id integer, deduction_amount double precision NOT NULL DEFAULT 0, absence_has_notice integer, is_confirmed integer NOT NULL DEFAULT 1, batch_id text NOT NULL, entry_notification_sent integer NOT NULL DEFAULT 0, exit_notification_sent integer NOT NULL DEFAULT 0, deduction_notification_sent integer NOT NULL DEFAULT 0, confirmed_by integer NOT NULL REFERENCES users(id), confirmed_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT idx_saved_attendance_employee_date UNIQUE(employee_id,work_date));
CREATE INDEX IF NOT EXISTS idx_saved_attendance_date ON saved_attendance(work_date);
CREATE TABLE IF NOT EXISTS user_permissions (id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id), menu_item text NOT NULL, allowed integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_user_permissions_latest ON user_permissions(user_id,menu_item,id);
CREATE TABLE IF NOT EXISTS portal_session_activity (token_hash text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, last_activity_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_portal_session_activity_user ON portal_session_activity(user_id,last_activity_at);
-- Seed the specified notice defaults only where an organization has no active absence rule.
INSERT INTO deduction_rules(name_en,name_ar,rule_type,min_minutes,deduction_type,value,absence_notice,status)
SELECT v.name_en,v.name_ar,'absence',0,'days_of_wage',v.wage_days,v.notice,'active'
FROM (VALUES ('Absence with notice','غياب بإشعار',1.0,'with_notice'),('Absence without notice','غياب بدون إشعار',2.0,'without_notice')) AS v(name_en,name_ar,wage_days,notice)
WHERE NOT EXISTS(SELECT 1 FROM deduction_rules WHERE rule_type='absence' AND status='active');
-- Reuse existing roles and permissions. The per-user table can narrow these grants, never elevate them.
INSERT INTO permissions(role_id,module,action,allowed)
SELECT r.id,p.page,a.action,1
FROM roles r
CROSS JOIN (VALUES
 ('payrollElementSetup'),('payrollEligibility'),('payrollEmployeeElements'),('payrollMatrixEntry'),
 ('payrollVariableEntry'),('payrollMonthPreview'),('payrollRun'),('deductionRulesSetup'),
 ('savedAttendance'),('attendanceTypeSetup'),('shiftPlansSetup'),('vacationSetup'),
 ('hrManagerSetup'),('businessUnitSetup'),('costCenterSetup'),('buCostCenterMapping'),
 ('wfhCheckin'),('zkAttendanceLogs'),('sajelErpSetup')
) AS p(page)
CROSS JOIN (VALUES ('view'),('edit')) AS a(action)
WHERE r.name IN ('Super Admin','HR Manager')
ON CONFLICT(role_id,module,action) DO NOTHING;
-- A payroll or timesheet dependent employee cannot be removed, including by an older endpoint.
CREATE OR REPLACE FUNCTION reject_employee_payroll_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM payroll_run_lines WHERE employee_id=OLD.id) OR EXISTS(SELECT 1 FROM payroll_items WHERE employee_id=OLD.id) OR EXISTS(SELECT 1 FROM timesheets WHERE employee_id=OLD.id) THEN RAISE EXCEPTION 'Employee has payroll or timesheet history'; END IF;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_reject_employee_payroll_delete ON employees;
CREATE TRIGGER trg_reject_employee_payroll_delete BEFORE DELETE ON employees FOR EACH ROW EXECUTE FUNCTION reject_employee_payroll_delete();
