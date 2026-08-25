import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  classificationForScore,
  consolidateEvaluations,
  matchCandidate,
  parseCvText,
  validateFairRequirements,
  validateRequirementWeights,
} from "../app/recruitment/recruitment-service.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const api = await read("app/recruitment/recruitment-api.ts");
const access = await read("app/recruitment/recruitment-access.ts");
const ui = await read("app/recruitment-workspace.tsx");
const migration = await read("drizzle-postgres/0020_recruitment_ats.sql");

test("structured requirements must total exactly 100 percent", () => {
  assert.equal(validateRequirementWeights([{ weight: 35 }, { weight: 65 }]), 100);
  assert.throws(
    () => validateRequirementWeights([{ weight: 35 }, { weight: 60 }]),
    (error) => error instanceof Response && error.status === 400,
  );
  assert.throws(
    () => validateRequirementWeights([]),
    (error) => error instanceof Response && error.status === 400,
  );
});

test("protected characteristics are rejected from matching requirements", () => {
  assert.throws(
    () => validateFairRequirements([{ name: "Candidate age below 30" }]),
    (error) => error instanceof Response && error.status === 400,
  );
  assert.throws(
    () => validateFairRequirements([{ name: "الجنسية المصرية" }]),
    (error) => error instanceof Response && error.status === 400,
  );
  assert.doesNotThrow(() =>
    validateFairRequirements([{ name: "SQL performance tuning" }]),
  );
});

test("candidate matching is weighted, deterministic, and evidence-backed", () => {
  const result = matchCandidate(
    [
      { id: 1, category: "work_experience", name: "Data analysis experience", minimum_value: "3", priority: "required", weight: 30 },
      { id: 2, category: "technical_skills", name: "SQL Python", priority: "required", weight: 40 },
      { id: 3, category: "language", name: "English", priority: "preferred", weight: 20 },
      { id: 4, category: "certifications", name: "AWS", priority: "preferred", weight: 10 },
    ],
    {
      totalExperience: 4,
      location: "Cairo",
      currentJobTitle: "Data Analyst",
      currentCompany: "SANAD Labs",
      education: ["BSc Computer Science"],
      skills: ["SQL", "Python"],
      languages: ["English"],
      certifications: [],
      projects: ["Analytics warehouse"],
      rawText: "Four years working on analytics and reporting.",
    },
  );
  assert.equal(result.overallScore, 90);
  assert.equal(result.classification, "strong_match");
  assert.equal(result.requirements.length, 4);
  assert.equal(result.requirements[0].evidenceStatus, "confirmed");
  assert.ok(result.missingRequirements.includes("AWS"));
  assert.ok(result.suggestedQuestions.length > 0);
});

test("match bands remain configurable", () => {
  assert.equal(classificationForScore(84), "good_match");
  assert.equal(
    classificationForScore(84, { strong: 80, good: 65, review: 45 }),
    "strong_match",
  );
});

test("CV parsing failure-safe extraction produces editable structured fields", () => {
  const parsed = parseCvText(`Mohamed Ahmed\nmohamed@example.com\n+20 100 000 0000\nData Analyst\n2019 - 2024\nSkills: SQL, Python, Power BI\nLanguages: Arabic, English\nBachelor of Computer Science`);
  assert.equal(parsed.email, "mohamed@example.com");
  assert.ok(Number(parsed.totalExperience) >= 4);
  assert.ok(parsed.skills.includes("sql"));
  assert.ok(parsed.languages.includes("English"));
});

test("consolidation transparently weights stages separately from CV matching", () => {
  const result = consolidateEvaluations(
    [
      { id: 1, name: "HR", aggregationWeight: 30, evaluations: [
        { overallScore: 80, submitted: true, required: true },
        { overallScore: 90, submitted: true, required: true },
      ] },
      { id: 2, name: "Technical", aggregationWeight: 70, evaluations: [
        { overallScore: 70, submitted: true, required: true },
      ] },
    ],
    90,
    { cvWeight: 40, interviewWeight: 60 },
  );
  assert.equal(result.stageResults[0].score, 85);
  assert.equal(result.interviewScore, 74.5);
  assert.equal(result.decisionSupportScore, 80.7);
  assert.equal(result.allRequiredComplete, true);
  assert.deepEqual(result.formula, {
    cvWeight: 40,
    interviewWeight: 60,
    stageAggregation: "weighted mean of submitted independent evaluations",
  });
});

test("backend enforces assignment scope and independent evaluation privacy", () => {
  assert.match(access, /interview_participants/);
  assert.match(access, /Interview access denied/);
  assert.match(api, /Submitted evaluations are immutable/);
  assert.match(api, /Only an assigned interviewer can evaluate this interview/);
  assert.match(api, /canViewConsolidated/);
  assert.match(api, /allSubmitted/);
  assert.match(api, /UNIQUE\(interview_id,interviewer_employee_id\)|ON CONFLICT\(interview_id,interviewer_employee_id\)/);
});

test("ATS schema preserves history, versions matching, and protects integrity", () => {
  for (const table of [
    "job_requirements",
    "candidate_applications",
    "candidate_documents",
    "candidate_match_results",
    "recruitment_stages",
    "interview_templates",
    "interview_plans",
    "interview_participants",
    "interview_evaluations",
    "candidate_stage_history",
  ]) assert.match(migration, new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table}`));
  assert.match(migration, /job_requirements_version/);
  assert.match(migration, /candidate_profile_version/);
  assert.match(migration, /cv_document_version/);
  assert.match(migration, /validate_open_job_requirement_weights/);
  assert.match(migration, /UNIQUE\(candidate_id,job_id\)/);
  assert.doesNotMatch(migration, /ALTER TABLE (?:payroll|salary|loans|tax|insurance)/i);
});

test("job, CV, pipeline, interview, offer, and onboarding actions are server-side", () => {
  for (const action of [
    "create_job",
    "update_job_requirements",
    "add_candidate",
    "update_candidate",
    "run_match",
    "move_application",
    "reject_application",
    "schedule_interview",
    "reschedule_interview",
    "cancel_interview",
    "save_evaluation",
    "submit_evaluation",
    "create_template",
    "create_offer",
    "approve_offer",
    "decide_offer",
    "convert_hire",
  ]) assert.match(api, new RegExp(`action === "${action}"`));
  assert.match(api, /createEmployeeRecord/);
  assert.match(api, /lifecycle_type='onboarding'/);
});

test("Arabic-first responsive UI exposes the full operational workspace", () => {
  for (const label of [
    "نظرة عامة",
    "الوظائف",
    "المرشحون",
    "المقابلات",
    "إعداد المقابلات",
    "تحليل المطابقة",
    "بطاقات التقييم",
  ]) assert.match(ui, new RegExp(label));
  assert.match(ui, /My interviews/);
  assert.match(ui, /Correct extracted data/);
  assert.match(ui, /Save new version/);
  assert.match(ui, /"Pipeline", "المسار"/);
});
