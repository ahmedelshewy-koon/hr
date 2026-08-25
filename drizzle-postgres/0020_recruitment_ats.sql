ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS job_title_id integer;
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS recruiter_employee_id integer;
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS responsibilities text;
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS requirements_version integer NOT NULL DEFAULT 1;
ALTER TABLE job_openings ADD COLUMN IF NOT EXISTS published_at timestamptz;
--> statement-breakpoint
ALTER TABLE candidates ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_stage;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_job_title text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_company text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS total_experience double precision;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS education_json text NOT NULL DEFAULT '[]';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS skills_json text NOT NULL DEFAULT '[]';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS languages_json text NOT NULL DEFAULT '[]';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS certifications_json text NOT NULL DEFAULT '[]';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS projects_json text NOT NULL DEFAULT '[]';
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS profile_version integer NOT NULL DEFAULT 1;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS human_corrected_at timestamptz;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS merged_into_candidate_id integer;
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidates_job_email_unique;
--> statement-breakpoint
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS application_id integer;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS plan_stage_id integer;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS end_at timestamptz;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 60;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS meeting_method text;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS notes text;
--> statement-breakpoint
ALTER TABLE job_offers DROP CONSTRAINT IF EXISTS job_offers_candidate_unique;
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS application_id integer;
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS position text;
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS department_id integer;
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS manager_employee_id integer;
ALTER TABLE job_offers ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
CREATE TABLE job_requirements (
  id serial PRIMARY KEY, job_id integer NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  category text NOT NULL, name text NOT NULL, description text, priority text NOT NULL DEFAULT 'required',
  weight double precision NOT NULL, minimum_value text, notes text, sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_requirement_category CHECK (category IN ('work_experience','technical_skills','domain_experience','education','certifications','language','location','availability','other')),
  CONSTRAINT job_requirement_priority CHECK (priority IN ('required','preferred')),
  CONSTRAINT job_requirement_weight CHECK (weight > 0 AND weight <= 100)
);
CREATE INDEX idx_job_requirements_job_version ON job_requirements(job_id,version,active);
INSERT INTO job_requirements(job_id,category,name,description,priority,weight,sort_order,version,active)
SELECT j.id,'other','Legacy requirements',NULLIF(j.requirements,''),'required',100,10,j.requirements_version,1
FROM job_openings j WHERE NOT EXISTS (SELECT 1 FROM job_requirements r WHERE r.job_id=j.id);
--> statement-breakpoint
CREATE TABLE job_screening_questions (
  id serial PRIMARY KEY, job_id integer NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  question text NOT NULL, answer_type text NOT NULL, importance text NOT NULL DEFAULT 'informational',
  options_json text NOT NULL DEFAULT '[]', knockout_rule_json text, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screening_answer_type CHECK (answer_type IN ('yes_no','single_choice','multiple_choice','number','text','date')),
  CONSTRAINT screening_importance CHECK (importance IN ('informational','important','knockout'))
);
CREATE INDEX idx_screening_questions_job ON job_screening_questions(job_id,sort_order);
--> statement-breakpoint
CREATE TABLE recruitment_stages (
  id serial PRIMARY KEY, job_id integer NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  stage_key text NOT NULL, name_en text NOT NULL, name_ar text NOT NULL, stage_type text NOT NULL,
  sort_order integer NOT NULL, terminal integer NOT NULL DEFAULT 0, active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recruitment_stage_type CHECK (stage_type IN ('applied','screening','shortlist','interview','review','offer','hired')),
  CONSTRAINT recruitment_stage_job_key UNIQUE(job_id,stage_key), CONSTRAINT recruitment_stage_job_order UNIQUE(job_id,sort_order)
);
--> statement-breakpoint
INSERT INTO recruitment_stages(job_id,stage_key,name_en,name_ar,stage_type,sort_order,terminal)
SELECT j.id,v.stage_key,v.name_en,v.name_ar,v.stage_type,v.sort_order,v.terminal FROM job_openings j CROSS JOIN (VALUES
 ('applied','Applied','تم التقديم','applied',10,0),('screening','Screening','الفرز', 'screening',20,0),
 ('shortlisted','Shortlisted','القائمة المختصرة','shortlist',30,0),('hr_interview','HR Interview','مقابلة الموارد البشرية','interview',40,0),
 ('technical_interview','Technical Interview','المقابلة الفنية','interview',50,0),('management_interview','Management Interview','مقابلة الإدارة','interview',60,0),
 ('final_review','Final Review','المراجعة النهائية','review',70,0),('offer','Offer','العرض الوظيفي','offer',80,0),('hired','Hired','تم التعيين','hired',90,1)
) v(stage_key,name_en,name_ar,stage_type,sort_order,terminal)
ON CONFLICT(job_id,stage_key) DO NOTHING;
--> statement-breakpoint
CREATE TABLE candidate_applications (
  id serial PRIMARY KEY, candidate_id integer NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
  job_id integer NOT NULL REFERENCES job_openings(id) ON DELETE RESTRICT, current_stage_id integer REFERENCES recruitment_stages(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active', source text, screening_answers_json text NOT NULL DEFAULT '{}', screening_flags_json text NOT NULL DEFAULT '[]',
  recruiter_employee_id integer REFERENCES employees(id) ON DELETE SET NULL, stage_entered_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz NOT NULL DEFAULT now(),
  rejection_stage_id integer REFERENCES recruitment_stages(id) ON DELETE RESTRICT, rejection_reason text, rejection_notes text, communication_status text, decision_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_application_status CHECK (status IN ('active','on_hold','withdrawn','rejected','offer','hired')),
  CONSTRAINT candidate_application_unique UNIQUE(candidate_id,job_id)
);
CREATE INDEX idx_candidate_applications_job_stage ON candidate_applications(job_id,current_stage_id,status);
CREATE INDEX idx_candidate_applications_recruiter ON candidate_applications(recruiter_employee_id,status);
--> statement-breakpoint
INSERT INTO candidate_applications(candidate_id,job_id,current_stage_id,status,source,recruiter_employee_id,stage_entered_at,applied_at,created_at,updated_at)
SELECT c.id,c.job_id,s.id,CASE c.stage WHEN 'rejected' THEN 'rejected' WHEN 'withdrawn' THEN 'withdrawn' WHEN 'hired' THEN 'hired' WHEN 'offer' THEN 'offer' ELSE 'active' END,
       c.source,j.recruiter_employee_id,c.updated_at,c.created_at,c.created_at,c.updated_at
FROM candidates c JOIN job_openings j ON j.id=c.job_id
JOIN recruitment_stages s ON s.job_id=c.job_id AND s.stage_key=CASE c.stage WHEN 'applied' THEN 'applied' WHEN 'screening' THEN 'screening' WHEN 'interview' THEN 'technical_interview' WHEN 'final_interview' THEN 'management_interview' WHEN 'offer' THEN 'offer' WHEN 'hired' THEN 'hired' ELSE 'applied' END
ON CONFLICT(candidate_id,job_id) DO NOTHING;
--> statement-breakpoint
UPDATE interviews i SET application_id=ca.id FROM candidate_applications ca WHERE ca.candidate_id=i.candidate_id AND i.application_id IS NULL;
UPDATE job_offers o SET application_id=ca.id,position=COALESCE(o.position,j.title),department_id=COALESCE(o.department_id,j.department_id),manager_employee_id=COALESCE(o.manager_employee_id,j.hiring_manager_employee_id)
FROM candidate_applications ca JOIN job_openings j ON j.id=ca.job_id WHERE ca.candidate_id=o.candidate_id AND ca.job_id=o.job_id AND o.application_id IS NULL;
--> statement-breakpoint
WITH app_map AS (
  SELECT ca.id AS old_application_id,MIN(ca.id) OVER(PARTITION BY lower(c.email),ca.job_id) AS keep_application_id
  FROM candidate_applications ca JOIN candidates c ON c.id=ca.candidate_id
) UPDATE interviews i SET application_id=m.keep_application_id FROM app_map m WHERE i.application_id=m.old_application_id AND m.old_application_id<>m.keep_application_id;
WITH app_map AS (
  SELECT ca.id AS old_application_id,MIN(ca.id) OVER(PARTITION BY lower(c.email),ca.job_id) AS keep_application_id
  FROM candidate_applications ca JOIN candidates c ON c.id=ca.candidate_id
) UPDATE job_offers o SET application_id=m.keep_application_id FROM app_map m WHERE o.application_id=m.old_application_id AND m.old_application_id<>m.keep_application_id;
WITH app_map AS (
  SELECT ca.id AS old_application_id,MIN(ca.id) OVER(PARTITION BY lower(c.email),ca.job_id) AS keep_application_id
  FROM candidate_applications ca JOIN candidates c ON c.id=ca.candidate_id
) DELETE FROM candidate_applications ca USING app_map m WHERE ca.id=m.old_application_id AND m.old_application_id<>m.keep_application_id;
WITH profile_map AS (SELECT id,MIN(id) OVER(PARTITION BY lower(email)) AS canonical_id FROM candidates)
UPDATE candidate_applications ca SET candidate_id=m.canonical_id FROM profile_map m WHERE ca.candidate_id=m.id AND m.id<>m.canonical_id;
WITH profile_map AS (SELECT id,MIN(id) OVER(PARTITION BY lower(email)) AS canonical_id FROM candidates)
UPDATE interviews i SET candidate_id=m.canonical_id FROM profile_map m WHERE i.candidate_id=m.id AND m.id<>m.canonical_id;
WITH profile_map AS (SELECT id,MIN(id) OVER(PARTITION BY lower(email)) AS canonical_id FROM candidates)
UPDATE job_offers o SET candidate_id=m.canonical_id FROM profile_map m WHERE o.candidate_id=m.id AND m.id<>m.canonical_id;
WITH profile_map AS (SELECT id,MIN(id) OVER(PARTITION BY lower(email)) AS canonical_id FROM candidates)
UPDATE candidates c SET merged_into_candidate_id=m.canonical_id,updated_at=CURRENT_TIMESTAMP FROM profile_map m WHERE c.id=m.id AND m.id<>m.canonical_id;
CREATE UNIQUE INDEX idx_candidates_active_email ON candidates((lower(email))) WHERE merged_into_candidate_id IS NULL;
--> statement-breakpoint
CREATE TABLE candidate_stage_history (
  id serial PRIMARY KEY, application_id integer NOT NULL REFERENCES candidate_applications(id) ON DELETE CASCADE,
  from_stage_id integer REFERENCES recruitment_stages(id) ON DELETE RESTRICT, to_stage_id integer NOT NULL REFERENCES recruitment_stages(id) ON DELETE RESTRICT,
  action text NOT NULL, reason text, actor_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_candidate_stage_history_application ON candidate_stage_history(application_id,created_at);
INSERT INTO candidate_stage_history(application_id,to_stage_id,action,actor_user_id,created_at)
SELECT ca.id,ca.current_stage_id,'migrated',c.created_by_user_id,c.created_at FROM candidate_applications ca JOIN candidates c ON c.id=ca.candidate_id WHERE ca.current_stage_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE candidate_documents (
  id serial PRIMARY KEY, candidate_id integer NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
  application_id integer REFERENCES candidate_applications(id) ON DELETE SET NULL, document_type text NOT NULL DEFAULT 'cv',
  name text NOT NULL, object_key text NOT NULL UNIQUE, content_type text NOT NULL, size_bytes integer NOT NULL, version integer NOT NULL DEFAULT 1,
  parsing_status text NOT NULL DEFAULT 'uploaded', parsing_confidence double precision, parsing_error text,
  uploaded_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_document_type CHECK (document_type IN ('cv','cover_letter','portfolio','other')),
  CONSTRAINT candidate_document_parse_status CHECK (parsing_status IN ('uploaded','parsing','complete','failed'))
);
CREATE INDEX idx_candidate_documents_candidate ON candidate_documents(candidate_id,document_type,version);
--> statement-breakpoint
CREATE TABLE candidate_cv_parsed_data (
  id serial PRIMARY KEY, document_id integer NOT NULL UNIQUE REFERENCES candidate_documents(id) ON DELETE CASCADE,
  parser_version text NOT NULL, raw_text text, extracted_json text NOT NULL DEFAULT '{}', corrected_json text,
  status text NOT NULL, confidence double precision, parsed_at timestamptz, corrected_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  corrected_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_cv_parse_status CHECK (status IN ('complete','partial','failed','corrected'))
);
--> statement-breakpoint
CREATE TABLE candidate_match_results (
  id serial PRIMARY KEY, application_id integer NOT NULL REFERENCES candidate_applications(id) ON DELETE CASCADE,
  overall_score double precision NOT NULL, classification text NOT NULL, job_requirements_version integer NOT NULL,
  candidate_profile_version integer NOT NULL, cv_document_version integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'complete',
  strong_matches_json text NOT NULL DEFAULT '[]', partial_matches_json text NOT NULL DEFAULT '[]', missing_requirements_json text NOT NULL DEFAULT '[]',
  concerns_json text NOT NULL DEFAULT '[]', suggested_questions_json text NOT NULL DEFAULT '[]', created_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_match_score CHECK (overall_score >= 0 AND overall_score <= 100)
);
CREATE INDEX idx_candidate_match_application_created ON candidate_match_results(application_id,created_at DESC);
CREATE TABLE candidate_requirement_scores (
  id serial PRIMARY KEY, match_result_id integer NOT NULL REFERENCES candidate_match_results(id) ON DELETE CASCADE,
  requirement_id integer NOT NULL REFERENCES job_requirements(id) ON DELETE RESTRICT, score double precision NOT NULL,
  evidence_status text NOT NULL, evidence text, rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requirement_match_score CHECK (score >= 0 AND score <= 100),
  CONSTRAINT requirement_evidence_status CHECK (evidence_status IN ('confirmed','inferred','not_found','needs_verification')),
  CONSTRAINT candidate_requirement_score_unique UNIQUE(match_result_id,requirement_id)
);
--> statement-breakpoint
CREATE TABLE interview_templates (
  id serial PRIMARY KEY, name text NOT NULL, scope_type text NOT NULL DEFAULT 'company', department_id integer REFERENCES departments(id) ON DELETE CASCADE,
  job_family text, job_id integer REFERENCES job_openings(id) ON DELETE CASCADE, description text, status text NOT NULL DEFAULT 'active',
  created_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_template_scope CHECK (scope_type IN ('company','department','job_family','job'))
);
CREATE INDEX idx_interview_templates_scope ON interview_templates(scope_type,department_id,status);
CREATE TABLE interview_template_stages (
  id serial PRIMARY KEY, template_id integer NOT NULL REFERENCES interview_templates(id) ON DELETE CASCADE, stage_key text NOT NULL,
  name_en text NOT NULL, name_ar text NOT NULL, sort_order integer NOT NULL, duration_minutes integer NOT NULL DEFAULT 60,
  passing_guidance text, required_feedback integer NOT NULL DEFAULT 1, independent_evaluations integer NOT NULL DEFAULT 1,
  aggregation_weight double precision NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_template_stage_order UNIQUE(template_id,sort_order), CONSTRAINT template_stage_weight CHECK (aggregation_weight > 0)
);
CREATE TABLE interview_template_stage_interviewers (
  id serial PRIMARY KEY, template_stage_id integer NOT NULL REFERENCES interview_template_stages(id) ON DELETE CASCADE,
  role_key text, employee_id integer REFERENCES employees(id) ON DELETE CASCADE, required integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_interviewer_assignment CHECK (role_key IS NOT NULL OR employee_id IS NOT NULL)
);
CREATE INDEX idx_template_stage_interviewers_stage ON interview_template_stage_interviewers(template_stage_id);
--> statement-breakpoint
CREATE TABLE interview_questions (
  id serial PRIMARY KEY, question text NOT NULL, what_good_looks_like text, evaluation_guidance text, question_type text NOT NULL,
  department_id integer REFERENCES departments(id) ON DELETE SET NULL, job_id integer REFERENCES job_openings(id) ON DELETE CASCADE,
  job_family text, skill text, competency text, seniority text, interview_stage text, interviewer_role text,
  score_min integer NOT NULL DEFAULT 1, score_max integer NOT NULL DEFAULT 5, status text NOT NULL DEFAULT 'active',
  created_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_question_type CHECK (question_type IN ('technical','behavioral','situational','leadership','communication','culture_fit','role_specific','verification')),
  CONSTRAINT interview_question_score_range CHECK (score_min >= 1 AND score_max <= 10 AND score_max > score_min)
);
CREATE INDEX idx_interview_questions_scope ON interview_questions(department_id,job_id,question_type,status);
CREATE TABLE interview_template_stage_questions (
  id serial PRIMARY KEY, template_stage_id integer NOT NULL REFERENCES interview_template_stages(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE, sort_order integer NOT NULL DEFAULT 0,
  required integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_stage_question_unique UNIQUE(template_stage_id,question_id)
);
CREATE TABLE interview_template_scorecard_criteria (
  id serial PRIMARY KEY, template_stage_id integer NOT NULL REFERENCES interview_template_stages(id) ON DELETE CASCADE,
  name_en text NOT NULL, name_ar text NOT NULL, description text, weight double precision NOT NULL,
  required integer NOT NULL DEFAULT 1, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_scorecard_weight CHECK (weight > 0 AND weight <= 100)
);
CREATE INDEX idx_template_scorecard_stage ON interview_template_scorecard_criteria(template_stage_id,sort_order);
--> statement-breakpoint
CREATE TABLE interview_plans (
  id serial PRIMARY KEY, job_id integer NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  source_template_id integer REFERENCES interview_templates(id) ON DELETE SET NULL, name text NOT NULL, version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active', created_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT interview_plans_job_status UNIQUE(job_id,status)
);
CREATE TABLE interview_plan_stages (
  id serial PRIMARY KEY, plan_id integer NOT NULL REFERENCES interview_plans(id) ON DELETE CASCADE,
  source_template_stage_id integer REFERENCES interview_template_stages(id) ON DELETE SET NULL, stage_key text NOT NULL,
  name_en text NOT NULL, name_ar text NOT NULL, sort_order integer NOT NULL, duration_minutes integer NOT NULL DEFAULT 60,
  passing_guidance text, required_feedback integer NOT NULL DEFAULT 1, independent_evaluations integer NOT NULL DEFAULT 1,
  aggregation_weight double precision NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_plan_stage_order UNIQUE(plan_id,sort_order), CONSTRAINT plan_stage_weight CHECK (aggregation_weight > 0)
);
CREATE TABLE interview_stage_interviewers (
  id serial PRIMARY KEY, plan_stage_id integer NOT NULL REFERENCES interview_plan_stages(id) ON DELETE CASCADE,
  role_key text, employee_id integer REFERENCES employees(id) ON DELETE CASCADE, required integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_interviewer_assignment CHECK (role_key IS NOT NULL OR employee_id IS NOT NULL)
);
CREATE INDEX idx_interview_stage_interviewers_stage ON interview_stage_interviewers(plan_stage_id);
CREATE TABLE interview_stage_questions (
  id serial PRIMARY KEY, plan_stage_id integer NOT NULL REFERENCES interview_plan_stages(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE, sort_order integer NOT NULL DEFAULT 0,
  required integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_stage_question_unique UNIQUE(plan_stage_id,question_id)
);
CREATE TABLE interview_scorecard_criteria (
  id serial PRIMARY KEY, plan_stage_id integer NOT NULL REFERENCES interview_plan_stages(id) ON DELETE CASCADE,
  name_en text NOT NULL, name_ar text NOT NULL, description text, weight double precision NOT NULL,
  required integer NOT NULL DEFAULT 1, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_scorecard_weight CHECK (weight > 0 AND weight <= 100)
);
CREATE INDEX idx_interview_scorecard_stage ON interview_scorecard_criteria(plan_stage_id,sort_order);
--> statement-breakpoint
CREATE TABLE interview_participants (
  id serial PRIMARY KEY, interview_id integer NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT, role_key text, required integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'assigned', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_participant_status CHECK (status IN ('assigned','accepted','declined','completed')),
  CONSTRAINT interview_participant_unique UNIQUE(interview_id,employee_id)
);
CREATE INDEX idx_interview_participant_employee ON interview_participants(employee_id,status);
CREATE TABLE interview_evaluations (
  id serial PRIMARY KEY, interview_id integer NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES interview_participants(id) ON DELETE RESTRICT,
  interviewer_employee_id integer NOT NULL REFERENCES employees(id) ON DELETE RESTRICT, notes text, recommendation text,
  overall_score double precision, status text NOT NULL DEFAULT 'draft', submitted_at timestamptz,
  created_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_evaluation_status CHECK (status IN ('draft','submitted')),
  CONSTRAINT interview_evaluation_recommendation CHECK (recommendation IS NULL OR recommendation IN ('strong_hire','hire','mixed','no_hire')),
  CONSTRAINT interview_evaluation_score CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)),
  CONSTRAINT interview_evaluation_interviewer_unique UNIQUE(interview_id,interviewer_employee_id)
);
CREATE INDEX idx_interview_evaluation_status ON interview_evaluations(status,submitted_at);
CREATE TABLE interview_evaluation_scores (
  id serial PRIMARY KEY, evaluation_id integer NOT NULL REFERENCES interview_evaluations(id) ON DELETE CASCADE,
  criterion_id integer NOT NULL REFERENCES interview_scorecard_criteria(id) ON DELETE RESTRICT,
  score double precision NOT NULL, comments text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_evaluation_score_range CHECK (score >= 1 AND score <= 5),
  CONSTRAINT interview_evaluation_score_unique UNIQUE(evaluation_id,criterion_id)
);
--> statement-breakpoint
ALTER TABLE interviews ADD CONSTRAINT interviews_application_fk FOREIGN KEY(application_id) REFERENCES candidate_applications(id) ON DELETE CASCADE;
ALTER TABLE interviews ADD CONSTRAINT interviews_plan_stage_fk FOREIGN KEY(plan_stage_id) REFERENCES interview_plan_stages(id) ON DELETE RESTRICT;
ALTER TABLE job_offers ADD CONSTRAINT offers_application_fk FOREIGN KEY(application_id) REFERENCES candidate_applications(id) ON DELETE RESTRICT;
ALTER TABLE job_offers ADD CONSTRAINT offers_department_fk FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE job_offers ADD CONSTRAINT offers_manager_fk FOREIGN KEY(manager_employee_id) REFERENCES employees(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_job_offers_application ON job_offers(application_id) WHERE application_id IS NOT NULL;
CREATE INDEX idx_job_offers_status_approval ON job_offers(status,approval_status);
CREATE INDEX idx_job_openings_recruiter ON job_openings(recruiter_employee_id,status);
CREATE INDEX idx_job_openings_hiring_manager ON job_openings(hiring_manager_employee_id,status);
CREATE INDEX idx_interviews_application_stage ON interviews(application_id,plan_stage_id,scheduled_at);
--> statement-breakpoint
INSERT INTO interview_questions(question,what_good_looks_like,evaluation_guidance,question_type,interview_stage,score_min,score_max,status,created_by_user_id)
SELECT v.question,v.good,v.guidance,v.qtype,v.stage,1,5,'active',u.id FROM (SELECT id FROM users ORDER BY id LIMIT 1) u CROSS JOIN (VALUES
 ('What attracted you to this role, and which experience is most relevant?','Connects specific experience to the role.','Look for evidence, not enthusiasm alone.','role_specific','hr_screening'),
 ('Describe a difficult problem you solved and how you validated the result.','Uses a structured approach and measurable validation.','Probe assumptions, trade-offs, and outcome.','situational','technical_interview'),
 ('Explain a technical decision you would revisit and what you learned.','Shows ownership, judgment, and learning.','Score depth and candor.','technical','technical_interview'),
 ('Tell us about a disagreement with a stakeholder or teammate.','Communicates respectfully and resolves conflict constructively.','Separate communication skill from agreement with the decision.','behavioral','management_interview'),
 ('What would your first 90 days in this role look like?','Prioritizes learning, relationships, and job outcomes.','Look for a realistic, role-specific plan.','leadership','management_interview')
) v(question,good,guidance,qtype,stage)
WHERE NOT EXISTS (SELECT 1 FROM interview_questions);
--> statement-breakpoint
INSERT INTO interview_templates(name,scope_type,description,status,created_by_user_id)
SELECT 'SANAD Structured Interview','company','Reusable independent-evaluation plan for standard hiring','active',u.id FROM users u ORDER BY u.id LIMIT 1
ON CONFLICT DO NOTHING;
INSERT INTO interview_template_stages(template_id,stage_key,name_en,name_ar,sort_order,duration_minutes,passing_guidance,required_feedback,independent_evaluations,aggregation_weight)
SELECT t.id,v.stage_key,v.name_en,v.name_ar,v.sort_order,v.duration,v.guidance,1,1,v.weight FROM interview_templates t CROSS JOIN (VALUES
 ('hr_screening','HR Screening','فرز الموارد البشرية',10,30,'Verify motivation, availability, and essential requirements.',25.0),
 ('technical_interview','Technical Interview','المقابلة الفنية',20,60,'Use evidence-based questions and score the configured criteria.',45.0),
 ('management_interview','Management Interview','مقابلة الإدارة',30,45,'Evaluate role scope, leadership, and team contribution.',30.0)
) v(stage_key,name_en,name_ar,sort_order,duration,guidance,weight)
WHERE t.name='SANAD Structured Interview' AND NOT EXISTS (SELECT 1 FROM interview_template_stages x WHERE x.template_id=t.id);
INSERT INTO interview_template_stage_interviewers(template_stage_id,role_key,required)
SELECT s.id,CASE s.stage_key WHEN 'hr_screening' THEN 'recruiter' WHEN 'technical_interview' THEN 'hiring_manager' ELSE 'department_manager' END,1
FROM interview_template_stages s JOIN interview_templates t ON t.id=s.template_id AND t.name='SANAD Structured Interview'
WHERE NOT EXISTS (SELECT 1 FROM interview_template_stage_interviewers x WHERE x.template_stage_id=s.id);
INSERT INTO interview_template_stage_questions(template_stage_id,question_id,sort_order,required)
SELECT s.id,q.id,row_number() OVER(PARTITION BY s.id ORDER BY q.id),1 FROM interview_template_stages s JOIN interview_templates t ON t.id=s.template_id AND t.name='SANAD Structured Interview'
JOIN interview_questions q ON q.interview_stage=s.stage_key
ON CONFLICT(template_stage_id,question_id) DO NOTHING;
INSERT INTO interview_template_scorecard_criteria(template_stage_id,name_en,name_ar,description,weight,required,sort_order)
SELECT s.id,v.name_en,v.name_ar,v.description,v.weight,1,v.sort_order FROM interview_template_stages s JOIN interview_templates t ON t.id=s.template_id AND t.name='SANAD Structured Interview'
CROSS JOIN (VALUES ('Relevant Experience','الخبرة ذات الصلة','Evidence of experience relevant to this stage.',25.0,10),('Problem Solving','حل المشكلات','Quality and structure of judgment.',25.0,20),('Communication','التواصل','Clarity, listening, and precision.',25.0,30),('Role Fit','الملاءمة للدور','Ability to perform the role requirements.',25.0,40)) v(name_en,name_ar,description,weight,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM interview_template_scorecard_criteria x WHERE x.template_stage_id=s.id);
--> statement-breakpoint
INSERT INTO interview_plans(job_id,source_template_id,name,version,status,created_by_user_id)
SELECT j.id,t.id,j.title||' Interview Plan',1,'active',j.created_by_user_id FROM job_openings j CROSS JOIN LATERAL (SELECT id FROM interview_templates WHERE name='SANAD Structured Interview' ORDER BY id LIMIT 1) t
ON CONFLICT(job_id,status) DO NOTHING;
INSERT INTO interview_plan_stages(plan_id,source_template_stage_id,stage_key,name_en,name_ar,sort_order,duration_minutes,passing_guidance,required_feedback,independent_evaluations,aggregation_weight)
SELECT p.id,s.id,s.stage_key,s.name_en,s.name_ar,s.sort_order,s.duration_minutes,s.passing_guidance,s.required_feedback,s.independent_evaluations,s.aggregation_weight
FROM interview_plans p JOIN interview_template_stages s ON s.template_id=p.source_template_id
ON CONFLICT(plan_id,sort_order) DO NOTHING;
INSERT INTO interview_stage_interviewers(plan_stage_id,role_key,employee_id,required)
SELECT ps.id,x.role_key,x.employee_id,x.required FROM interview_plan_stages ps JOIN interview_template_stage_interviewers x ON x.template_stage_id=ps.source_template_stage_id
WHERE NOT EXISTS (SELECT 1 FROM interview_stage_interviewers y WHERE y.plan_stage_id=ps.id AND y.role_key IS NOT DISTINCT FROM x.role_key AND y.employee_id IS NOT DISTINCT FROM x.employee_id);
INSERT INTO interview_stage_questions(plan_stage_id,question_id,sort_order,required)
SELECT ps.id,x.question_id,x.sort_order,x.required FROM interview_plan_stages ps JOIN interview_template_stage_questions x ON x.template_stage_id=ps.source_template_stage_id
ON CONFLICT(plan_stage_id,question_id) DO NOTHING;
INSERT INTO interview_scorecard_criteria(plan_stage_id,name_en,name_ar,description,weight,required,sort_order)
SELECT ps.id,x.name_en,x.name_ar,x.description,x.weight,x.required,x.sort_order FROM interview_plan_stages ps JOIN interview_template_scorecard_criteria x ON x.template_stage_id=ps.source_template_stage_id
WHERE NOT EXISTS (SELECT 1 FROM interview_scorecard_criteria y WHERE y.plan_stage_id=ps.id);
--> statement-breakpoint
INSERT INTO interview_participants(interview_id,employee_id,role_key,required,status,created_at,updated_at)
SELECT i.id,i.interviewer_employee_id,'legacy_interviewer',1,CASE WHEN i.status='completed' THEN 'completed' ELSE 'assigned' END,i.created_at,i.updated_at FROM interviews i
ON CONFLICT(interview_id,employee_id) DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_open_job_requirement_weights() RETURNS trigger AS $$
DECLARE total_weight double precision;
BEGIN
  IF NEW.status='open' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.requirements_version IS DISTINCT FROM NEW.requirements_version) THEN
    SELECT COALESCE(SUM(weight),0) INTO total_weight FROM job_requirements WHERE job_id=NEW.id AND active=1 AND version=NEW.requirements_version;
    IF abs(total_weight-100.0)>0.001 THEN RAISE EXCEPTION 'Open job requirement weights must total 100%% (current total: %)',total_weight USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS validate_open_job_requirement_weights ON job_openings;
CREATE TRIGGER validate_open_job_requirement_weights BEFORE INSERT OR UPDATE OF status,requirements_version ON job_openings FOR EACH ROW EXECUTE FUNCTION enforce_open_job_requirement_weights();
--> statement-breakpoint
INSERT INTO system_settings(setting_key,value_json,created_at,updated_at)
VALUES ('recruitment_matching','{"thresholds":{"strong":85,"good":70,"review":50},"cvWeight":40,"interviewWeight":60,"protectedCharacteristicsExcluded":true}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO NOTHING;
--> statement-breakpoint
INSERT INTO permissions(role_id,module,action,allowed)
SELECT r.id,'recruitment',a.action,CASE WHEN r.name IN ('Super Admin','HR Manager') THEN 1 WHEN r.name='Department Manager' AND a.action IN ('view','create','edit','approve') THEN 1 WHEN r.name='Employee' AND a.action='view' THEN 1 ELSE 0 END
FROM roles r CROSS JOIN (VALUES ('view'),('create'),('edit'),('delete'),('approve'),('export'),('manage_settings')) a(action)
ON CONFLICT(role_id,module,action) DO UPDATE SET allowed=EXCLUDED.allowed;
