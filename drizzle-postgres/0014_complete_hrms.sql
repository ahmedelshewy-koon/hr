CREATE TABLE IF NOT EXISTS performance_rating_scales (
  id serial PRIMARY KEY, name text NOT NULL, min_score double precision NOT NULL DEFAULT 1,
  max_score double precision NOT NULL DEFAULT 5, labels_json text NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_rating_scales_range CHECK (max_score > min_score)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS performance_cycles (
  id serial PRIMARY KEY, name text NOT NULL, cycle_type text NOT NULL, start_date text NOT NULL, end_date text NOT NULL,
  status text NOT NULL DEFAULT 'draft', department_ids text NOT NULL DEFAULT '', rating_scale_id integer,
  hr_review_required integer NOT NULL DEFAULT 1, created_by_user_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_cycles_type CHECK (cycle_type IN ('monthly','quarterly','semiannual','annual')),
  CONSTRAINT performance_cycles_status CHECK (status IN ('draft','active','completed','archived')),
  CONSTRAINT performance_cycles_dates CHECK (end_date >= start_date)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS performance_reviews (
  id serial PRIMARY KEY, cycle_id integer NOT NULL, employee_id integer NOT NULL, manager_employee_id integer,
  status text NOT NULL DEFAULT 'draft', self_review text, self_rating double precision, manager_review text,
  manager_rating double precision, hr_review text, hr_rating double precision, final_score double precision,
  finalized_by_user_id integer, finalized_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_reviews_unique UNIQUE(cycle_id, employee_id),
  CONSTRAINT performance_reviews_status CHECK (status IN ('draft','self_review','manager_review','hr_review','completed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS performance_goals (
  id serial PRIMARY KEY, review_id integer NOT NULL, title text NOT NULL, description text, target text NOT NULL,
  weight double precision NOT NULL, progress double precision NOT NULL DEFAULT 0, result double precision,
  created_by_user_id integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_goals_weight CHECK (weight > 0 AND weight <= 100),
  CONSTRAINT performance_goals_progress CHECK (progress >= 0 AND progress <= 100),
  CONSTRAINT performance_goals_result CHECK (result IS NULL OR (result >= 0 AND result <= 100))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS performance_comments (
  id serial PRIMARY KEY, review_id integer NOT NULL, author_user_id integer NOT NULL, stage text NOT NULL,
  comment text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS job_openings (
  id serial PRIMARY KEY, title text NOT NULL, department_id integer, hiring_manager_employee_id integer, location text,
  employment_type text NOT NULL DEFAULT 'full_time', openings_count integer NOT NULL DEFAULT 1, description text,
  requirements text, status text NOT NULL DEFAULT 'draft', created_date text NOT NULL DEFAULT CURRENT_DATE::text,
  closing_date text, created_by_user_id integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_openings_count CHECK (openings_count > 0),
  CONSTRAINT job_openings_status CHECK (status IN ('draft','open','on_hold','closed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS candidates (
  id serial PRIMARY KEY, job_id integer NOT NULL, name text NOT NULL, email text NOT NULL, phone text,
  resume_document_id integer, source text, notes text, stage text NOT NULL DEFAULT 'applied', converted_employee_id integer,
  created_by_user_id integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidates_stage CHECK (stage IN ('applied','screening','interview','final_interview','offer','hired','rejected','withdrawn')),
  CONSTRAINT candidates_job_email_unique UNIQUE(job_id,email)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_converted_employee ON candidates(converted_employee_id) WHERE converted_employee_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS interviews (
  id serial PRIMARY KEY, candidate_id integer NOT NULL, interviewer_employee_id integer NOT NULL,
  scheduled_at timestamptz NOT NULL, interview_type text NOT NULL, feedback text, rating double precision, recommendation text,
  status text NOT NULL DEFAULT 'scheduled', created_by_user_id integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interviews_status CHECK (status IN ('scheduled','completed','cancelled')),
  CONSTRAINT interviews_rating CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS job_offers (
  id serial PRIMARY KEY, job_id integer NOT NULL, candidate_id integer NOT NULL, offer_date text NOT NULL,
  joining_date text NOT NULL, status text NOT NULL DEFAULT 'draft', notes text, decided_by_user_id integer,
  created_by_user_id integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_offers_status CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  CONSTRAINT job_offers_candidate_unique UNIQUE(candidate_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lifecycle_templates (
  id serial PRIMARY KEY, name text NOT NULL, lifecycle_type text NOT NULL, status text NOT NULL DEFAULT 'active',
  created_by_user_id integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lifecycle_templates_type CHECK (lifecycle_type IN ('onboarding','offboarding'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lifecycle_template_tasks (
  id serial PRIMARY KEY, template_id integer NOT NULL, title text NOT NULL, owner_type text NOT NULL DEFAULT 'hr',
  due_offset_days integer NOT NULL DEFAULT 0, required integer NOT NULL DEFAULT 1, sort_order integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS employee_lifecycles (
  id serial PRIMARY KEY, employee_id integer NOT NULL, lifecycle_type text NOT NULL, template_id integer,
  status text NOT NULL DEFAULT 'pending', reason_type text, last_working_date text, notes text, exit_interview text,
  deactivate_account_on_completion integer NOT NULL DEFAULT 1, started_by_user_id integer NOT NULL,
  completed_by_user_id integer, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_lifecycles_type CHECK (lifecycle_type IN ('onboarding','offboarding')),
  CONSTRAINT employee_lifecycles_status CHECK (status IN ('pending','in_progress','completed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_lifecycles_active ON employee_lifecycles(employee_id,lifecycle_type) WHERE status IN ('pending','in_progress');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS lifecycle_tasks (
  id serial PRIMARY KEY, lifecycle_id integer NOT NULL, title text NOT NULL, owner_user_id integer, employee_id integer NOT NULL,
  due_date text, status text NOT NULL DEFAULT 'pending', required integer NOT NULL DEFAULT 1, notes text,
  completed_by_user_id integer, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lifecycle_tasks_status CHECK (status IN ('pending','in_progress','completed','blocked'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assets (
  id serial PRIMARY KEY, asset_code text NOT NULL UNIQUE, category text NOT NULL, name text NOT NULL, brand_model text,
  serial_number text, status text NOT NULL DEFAULT 'available', asset_condition text NOT NULL DEFAULT 'good', reference_date text,
  notes text, created_by_user_id integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_status CHECK (status IN ('available','assigned','maintenance','lost','retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_serial ON assets(serial_number) WHERE serial_number IS NOT NULL AND serial_number<>'';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS asset_assignments (
  id serial PRIMARY KEY, asset_id integer NOT NULL, employee_id integer NOT NULL, assigned_by_user_id integer NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(), assigned_condition text, assigned_notes text,
  returned_at timestamptz, returned_by_user_id integer, return_condition text, return_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_assignments_active ON asset_assignments(asset_id) WHERE returned_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS training_courses (
  id serial PRIMARY KEY, title text NOT NULL, provider text, course_type text NOT NULL, description text,
  start_date text, end_date text, status text NOT NULL DEFAULT 'draft', mandatory integer NOT NULL DEFAULT 0,
  validity_months integer, created_by_user_id integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_courses_type CHECK (course_type IN ('internal','external','online')),
  CONSTRAINT training_courses_status CHECK (status IN ('draft','active','completed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS training_enrollments (
  id serial PRIMARY KEY, course_id integer NOT NULL, employee_id integer NOT NULL, status text NOT NULL DEFAULT 'assigned',
  due_date text, completion_date text, score double precision, certificate_document_id integer, certificate_expiry text,
  assigned_by_user_id integer NOT NULL, completed_by_user_id integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_enrollments_status CHECK (status IN ('assigned','in_progress','completed','failed','cancelled')),
  CONSTRAINT training_enrollments_unique UNIQUE(course_id,employee_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_performance_cycles_status_dates ON performance_cycles(status,end_date);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_employee_status ON performance_reviews(employee_id,status);
CREATE INDEX IF NOT EXISTS idx_performance_goals_review ON performance_goals(review_id);
CREATE INDEX IF NOT EXISTS idx_job_openings_status_department ON job_openings(status,department_id);
CREATE INDEX IF NOT EXISTS idx_candidates_job_stage ON candidates(job_id,stage);
CREATE INDEX IF NOT EXISTS idx_interviews_interviewer_date ON interviews(interviewer_employee_id,scheduled_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_employee_type_status ON employee_lifecycles(employee_id,lifecycle_type,status);
CREATE INDEX IF NOT EXISTS idx_lifecycle_tasks_owner_due ON lifecycle_tasks(owner_user_id,status,due_date);
CREATE INDEX IF NOT EXISTS idx_assets_status_category ON assets(status,category);
CREATE INDEX IF NOT EXISTS idx_asset_assignments_employee_active ON asset_assignments(employee_id,returned_at);
CREATE INDEX IF NOT EXISTS idx_training_courses_status_dates ON training_courses(status,end_date);
CREATE INDEX IF NOT EXISTS idx_training_enrollments_employee_status ON training_enrollments(employee_id,status);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_cycles_scale_fk') THEN ALTER TABLE performance_cycles ADD CONSTRAINT performance_cycles_scale_fk FOREIGN KEY(rating_scale_id) REFERENCES performance_rating_scales(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_reviews_cycle_fk') THEN ALTER TABLE performance_reviews ADD CONSTRAINT performance_reviews_cycle_fk FOREIGN KEY(cycle_id) REFERENCES performance_cycles(id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_reviews_employee_fk') THEN ALTER TABLE performance_reviews ADD CONSTRAINT performance_reviews_employee_fk FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_goals_review_fk') THEN ALTER TABLE performance_goals ADD CONSTRAINT performance_goals_review_fk FOREIGN KEY(review_id) REFERENCES performance_reviews(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='performance_comments_review_fk') THEN ALTER TABLE performance_comments ADD CONSTRAINT performance_comments_review_fk FOREIGN KEY(review_id) REFERENCES performance_reviews(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='job_openings_department_fk') THEN ALTER TABLE job_openings ADD CONSTRAINT job_openings_department_fk FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE SET NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='candidates_job_fk') THEN ALTER TABLE candidates ADD CONSTRAINT candidates_job_fk FOREIGN KEY(job_id) REFERENCES job_openings(id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='candidates_employee_fk') THEN ALTER TABLE candidates ADD CONSTRAINT candidates_employee_fk FOREIGN KEY(converted_employee_id) REFERENCES employees(id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='interviews_candidate_fk') THEN ALTER TABLE interviews ADD CONSTRAINT interviews_candidate_fk FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='offers_candidate_fk') THEN ALTER TABLE job_offers ADD CONSTRAINT offers_candidate_fk FOREIGN KEY(candidate_id) REFERENCES candidates(id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='template_tasks_template_fk') THEN ALTER TABLE lifecycle_template_tasks ADD CONSTRAINT template_tasks_template_fk FOREIGN KEY(template_id) REFERENCES lifecycle_templates(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lifecycles_employee_fk') THEN ALTER TABLE employee_lifecycles ADD CONSTRAINT lifecycles_employee_fk FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lifecycle_tasks_lifecycle_fk') THEN ALTER TABLE lifecycle_tasks ADD CONSTRAINT lifecycle_tasks_lifecycle_fk FOREIGN KEY(lifecycle_id) REFERENCES employee_lifecycles(id) ON DELETE CASCADE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assignments_asset_fk') THEN ALTER TABLE asset_assignments ADD CONSTRAINT assignments_asset_fk FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='assignments_employee_fk') THEN ALTER TABLE asset_assignments ADD CONSTRAINT assignments_employee_fk FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='enrollments_course_fk') THEN ALTER TABLE training_enrollments ADD CONSTRAINT enrollments_course_fk FOREIGN KEY(course_id) REFERENCES training_courses(id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='enrollments_employee_fk') THEN ALTER TABLE training_enrollments ADD CONSTRAINT enrollments_employee_fk FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='enrollments_document_fk') THEN ALTER TABLE training_enrollments ADD CONSTRAINT enrollments_document_fk FOREIGN KEY(certificate_document_id) REFERENCES documents(id) ON DELETE SET NULL; END IF;
END $$;
--> statement-breakpoint
INSERT INTO performance_rating_scales(name,min_score,max_score,labels_json) SELECT 'Standard 5-point',1,5,'{"1":"Needs improvement","2":"Developing","3":"Meets expectations","4":"Exceeds expectations","5":"Outstanding"}' WHERE NOT EXISTS (SELECT 1 FROM performance_rating_scales);
--> statement-breakpoint
INSERT INTO lifecycle_templates(name,lifecycle_type,created_by_user_id)
SELECT 'Standard Onboarding','onboarding',u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Super Admin' ORDER BY u.id LIMIT 1 ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO lifecycle_templates(name,lifecycle_type,created_by_user_id)
SELECT 'Standard Offboarding','offboarding',u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Super Admin' ORDER BY u.id LIMIT 1 ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO lifecycle_template_tasks(template_id,title,owner_type,due_offset_days,required,sort_order)
SELECT t.id,v.title,v.owner_type,v.days,1,v.sort FROM lifecycle_templates t CROSS JOIN (VALUES
('Employee documents','hr',0,1),('Account creation','hr',0,2),('Policy acknowledgment','employee',3,3),('Equipment assignment','hr',1,4),('Orientation','manager',5,5),('Probation objectives','manager',10,6)) v(title,owner_type,days,sort)
WHERE t.lifecycle_type='onboarding' AND NOT EXISTS (SELECT 1 FROM lifecycle_template_tasks x WHERE x.template_id=t.id);
--> statement-breakpoint
INSERT INTO lifecycle_template_tasks(template_id,title,owner_type,due_offset_days,required,sort_order)
SELECT t.id,v.title,v.owner_type,v.days,1,v.sort FROM lifecycle_templates t CROSS JOIN (VALUES
('Manager clearance','manager',-7,1),('HR clearance','hr',-3,2),('Asset return','hr',-2,3),('Document collection','hr',-1,4),('Access closure','hr',0,5),('Exit interview','hr',-2,6)) v(title,owner_type,days,sort)
WHERE t.lifecycle_type='offboarding' AND NOT EXISTS (SELECT 1 FROM lifecycle_template_tasks x WHERE x.template_id=t.id);
--> statement-breakpoint
INSERT INTO permissions(role_id,module,action,allowed)
SELECT r.id,m.module,a.action,CASE WHEN r.name IN ('Super Admin','HR Manager') THEN 1 WHEN r.name='Department Manager' AND a.action IN ('view','edit','approve') THEN 1 WHEN r.name='Employee' AND m.module IN ('performance','onboarding','offboarding','assets','learning') AND a.action='view' THEN 1 ELSE 0 END
FROM roles r CROSS JOIN (VALUES ('performance'),('recruitment'),('onboarding'),('offboarding'),('assets'),('learning')) m(module)
CROSS JOIN (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export'),('manage_settings')) a(action)
ON CONFLICT(role_id,module,action) DO UPDATE SET allowed=EXCLUDED.allowed;
