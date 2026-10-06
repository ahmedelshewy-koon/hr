import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateDecision } from '../app/decisions/decision-service.ts';
import { validateContact, validateInsurance, validatePersonal } from '../app/employees/profile-extras.ts';
import { assignmentChanged, historyStartDate } from '../app/employees/job-history.ts';

const refused = (fn, status = 400) => assert.throws(fn, error => error instanceof Response && error.status === status);
const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a decision needs a title, text, a known type and at least one valid recipient', () => {
  const ok = validateDecision({ title: ' Holiday ', body: 'Text', employeeIds: [3, '3', 5] });
  assert.deepEqual(ok, { title: 'Holiday', body: 'Text', decisionType: 'administrative_decision', effectiveDate: null, employeeIds: [3, 5] });
  refused(() => validateDecision({ title: '', body: 'x', employeeIds: [1] }));
  refused(() => validateDecision({ title: 't', body: '', employeeIds: [1] }));
  refused(() => validateDecision({ title: 't', body: 'x', employeeIds: [] }));
  refused(() => validateDecision({ title: 't', body: 'x', employeeIds: [0] }));
  refused(() => validateDecision({ title: 't', body: 'x', decisionType: 'memo', employeeIds: [1] }));
  refused(() => validateDecision({ title: 't', body: 'x', effectiveDate: '04/10/2026', employeeIds: [1] }));
  refused(() => validateDecision({ title: 't', body: 'x', employeeIds: Array.from({ length: 2001 }, (_, i) => i + 1) }));
});

test('emergency contacts need a name, a known relationship and a phone number', () => {
  assert.deepEqual(validateContact({ name: 'Mona', relationship: 'parent', phone: '+20 100 123 4567', is_primary: true }), { name: 'Mona', relationship: 'parent', phone: '+20 100 123 4567', alternate_phone: null, is_primary: 1 });
  refused(() => validateContact({ name: '', relationship: 'parent', phone: '0100123456' }));
  refused(() => validateContact({ name: 'A', relationship: 'boss', phone: '0100123456' }));
  refused(() => validateContact({ name: 'A', relationship: 'parent', phone: 'abc' }));
  refused(() => validateContact({ name: 'A', relationship: 'parent', phone: '0100123456', alternate_phone: '12' }));
});

test('insurance needs a plan and a start date; the end date cannot precede it', () => {
  assert.equal(validateInsurance({ plan_id: '2', start_date: '2026-01-01', dependents: '' }).dependents, 0);
  refused(() => validateInsurance({ start_date: '2026-01-01' }));
  refused(() => validateInsurance({ plan_id: 1, start_date: '' }));
  refused(() => validateInsurance({ plan_id: 1, start_date: '2026-05-01', end_date: '2026-04-01' }));
  refused(() => validateInsurance({ plan_id: 1, start_date: '2026-05-01', dependents: 30 }));
});

test('marital status is one of the known values; notes are optional', () => {
  assert.deepEqual(validatePersonal({ marital_status: 'married', profile_notes: '  ' }), { marital_status: 'married', profile_notes: null });
  assert.deepEqual(validatePersonal({}), { marital_status: null, profile_notes: null });
  refused(() => validatePersonal({ marital_status: 'complicated' }));
});

test('job history starts a new entry only when company, branch, unit, title or position changes', () => {
  const before = { company_id: 6, branch_id: 3, department_id: 3, section_id: null, job_title_id: 58, position_id: 21, manager_id: 33 };
  assert.equal(assignmentChanged(before, { ...before, manager_id: 20 }), false, 'a manager change alone is not a job change');
  assert.equal(assignmentChanged(before, { ...before, section_id: 86 }), true);
  assert.equal(assignmentChanged(before, { ...before, job_title_id: '58' }), false, 'string/number ids compare equal');
  assert.equal(historyStartDate('2026-03-01', '2026-10-05'), '2026-03-01');
  assert.equal(historyStartDate('', '2026-10-05'), '2026-10-05');
  assert.equal(historyStartDate(null, '2026-10-05'), '2026-10-05');
});

test('every assignment write records job history in the same transaction', () => {
  const source = read('app/organization/assignment-service.ts');
  assert.match(source, /assignment_effective_date=\? WHERE id=\?`\)[^\n]*\n[^\n]*\n\s*await recordJobHistory\(db,employeeId,before,next,effective/);
});

test('administrative decisions: page permission, acknowledge for anyone, sending needs create; prompt mounted in the app shell', () => {
  const route = read('app/api/decisions/route.ts');
  assert.ok(route.indexOf("view === 'pending'") < route.indexOf("'administrative_decisions', 'view'"), 'pending check needs no module permission');
  const post = route.slice(route.indexOf('export async function POST'));
  assert.ok(post.indexOf("action === 'acknowledge'") < post.indexOf("'administrative_decisions', 'create'"), 'acknowledging needs no module permission');
  assert.match(route, /enforceWriteOrigin\(request\)/);
  assert.match(read('app/page-availability.ts'), /decisions: \["administrative_decisions"\]/);
  const app = read('app/hr-app.tsx');
  assert.match(app, /<DecisionPrompt rtl=\{rtl\} \/>/);
  assert.match(app, /visiblePage === "decisions" && <DecisionsPage/);
  assert.match(app, /administrative_decision_received:\[/);
  const service = read('app/decisions/decision-service.ts');
  assert.match(service, /outside your scope', 403/, 'recipients outside the sender scope are refused');
  assert.match(service, /WHERE r\.decision_id=\? AND r\.employee_id=\? FOR UPDATE OF r/, 'only the recipient can acknowledge');
  assert.match(read('drizzle-postgres/0041_employee_profile_and_decisions.sql'), /WHERE r\.name IN \('HR Manager','Department Manager'\)/);
});

test('profile: manager-added leave is approved directly; edit is one transaction; managers can only cancel their reports', () => {
  const leave = read('app/leave/leave-service.ts');
  assert.match(leave, /const directApproval=!workflow&&\(input\.onBehalf==="manager"/);
  assert.match(leave, /export async function editLeaveRequest[\s\S]*?input\.db\.transaction\(async tx=>\{[\s\S]*?cancelLeaveInTx\(tx,[\s\S]*?createLeaveInTx\(tx,/);
  assert.match(leave, /input\.actor\.roleName==="Department Manager"&&Number\(row\.employee_id\)!==Number\(input\.actor\.employeeId\)\)await assertEmployeeManager/);
  const api = read('app/api/employees/[id]/route.ts');
  assert.match(api, /canManageLeave=!isSelf&&canActOnRequests&&\["Department Manager","HR Manager","Super Admin"\]\.includes\(user\.role_name\)/);
  assert.match(api, /tab==="insurance"\|\|tab==="contacts"\)\{\s*if\(!canViewPersonal\)throw/);
  const profile = read('app/api/employees/[id]/profile/route.ts');
  assert.match(profile, /\['Super Admin', 'HR Manager'\]\.includes\(actor\.roleName\)/);
  assert.match(profile, /requirePermission\(db, actor, 'employees', 'edit'\)/);
});
