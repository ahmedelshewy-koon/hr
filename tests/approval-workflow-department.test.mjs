import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateWorkflow } from '../app/approvals/workflow-policy.ts';

const value = { companyId: 2, requestType: 'expense', version: 0, active: true, steps: [{ kind: 'manager' }] };

test('a workflow is company-wide unless a department is chosen', () => {
  assert.equal(validateWorkflow(value).departmentId, null);
  assert.equal(validateWorkflow({ ...value, departmentId: '' }).departmentId, null);
  assert.equal(validateWorkflow({ ...value, departmentId: null }).departmentId, null);
  assert.equal(validateWorkflow({ ...value, departmentId: '77' }).departmentId, 77);
  // Policy errors are thrown as HTTP responses, like the rest of workflow-policy.
  for (const bad of [0, -1, 1.5, 'abc']) assert.throws(() => validateWorkflow({ ...value, departmentId: bad }), error => error instanceof Response && error.status === 400);
});

test('resolution prefers team, then section, then department, then the company-wide workflow, among active ones', () => {
  const source = fs.readFileSync(new URL('../app/approvals/workflow-service.ts', import.meta.url), 'utf8');
  assert.match(source, /w\.active=true AND \(w\.department_id IS NULL OR w\.department_id IN \(e\.team_id,e\.section_id,e\.department_id\)\)/);
  assert.match(source, /ORDER BY CASE WHEN w\.department_id IS NULL THEN 3 WHEN w\.department_id=e\.team_id THEN 0 WHEN w\.department_id=e\.section_id THEN 1 ELSE 2 END LIMIT 1/);
});

test('saves are scoped by company, request type and department, and the department must belong to the company', () => {
  const route = fs.readFileSync(new URL('../app/api/approval-workflows/route.ts', import.meta.url), 'utf8');
  assert.match(route, /coalesce\(department_id,0\)=\?/);
  assert.match(route, /FROM departments WHERE id=\? AND company_id=\? AND status='active'/);
  const migration = fs.readFileSync(new URL('../drizzle-postgres/0038_approval_workflow_department.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "idx_approval_workflows_scope" ON "approval_workflows" USING btree \("company_id","request_type",coalesce\("department_id",0\)\)/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS "approval_workflows_company_id_request_type_key"/);
});
