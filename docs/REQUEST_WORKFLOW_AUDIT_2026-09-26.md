# Employee request workflow audit — 2026-09-26

## Result

23 local API integration scenarios passed against the running application at localhost:3000. All reached the employee's final approved/resolved status and notification after department-manager and HR approval. Dedicated test fixtures were removed in `finally`.

The production configuration still has two active employees without an eligible non-self department manager: **E001 (نواف المطيرى)** and **EMP1786006205511 (مريم -)**. The latter has no department. Neither had pending manager-stage requests during the audit. An administrator must specify their department/approval owner; no reporting assignments were invented or changed.

## Cases tested individually

| Group | Cases | Result |
|---|---|---|
| Standard requests | Work from home; late arrival; early departure; expense reimbursement; experience certificate; other request | 6 passed |
| Active leave types | Annual Leave; Sick Leave; Unpaid Leave; Casual leave; Year Insurance Annual Vacation 10; annual 15 day for first Year; Exam Vacation; KSA Annual Vacation; Maternity Leave; Paternity Leave | 10 passed |
| Attendance corrections | Forgot check-in; forgot check-out; wrong check-in; wrong check-out; late justification; early departure justification; other | 7 passed |

All ten active leave types currently require both manager and HR approval.

For standard and leave requests, verified submission as Employee, pending-manager status in employee API data, manager notification and actionable approval, pending-HR status after manager approval, HR notification and actionable approval, final approved status and employee notification, and exactly two ordered approval history entries. Pending leave balance reservations are cleared after approval.

For attendance corrections, verified manager and HR notification/approval in sequence and employee-visible resolved status and notification.

All cases reject HR approval before the manager, a manager outside the authorized department tree, employee approval, manager approval at the HR stage, and duplicate final HR approval. Standard and leave requests additionally verify that neither a reporting supervisor with Employee role nor a manager who merely belongs to the department receives its approval notification.

## Defect reproduced and fixed

Manager notifications previously followed `employees.manager_id`. A reporting supervisor can differ from the department manager and can lack approval permissions. A dedicated supervisor fixture reproduced missing department-manager notification.

`app/notifications/notification-service.ts` now resolves active Department Manager accounts through their explicitly managed department trees for both employee requests and attendance corrections. It excludes self-approval. A second regression prevents notifying a manager solely because their employee profile belongs to a department they do not manage. Both regression cases were observed failing before their respective fixes and passed in the final suite.

## Evidence and rerun

- `node tests/runtime-request-workflows.mjs`: 23 passed, exit 0; final output in `tests/request-workflows-last-run.log`.
- `node --test tests/unified-approvals.test.mjs tests/attendance-corrections.test.mjs tests/leave-engine.test.mjs`: 29 passed, zero failures.
- ESLint on the changed notification service and new runtime test: passed.
- `npx tsc --noEmit`: passed.
- Independent code review of the notification fix: no remaining finding after correcting scope.
- `tests/request-routing-gaps.json`: read-only configuration audit identifying employees without an eligible approver.

## Scope of verification

Tests exercised real HTTP endpoints and persisted database state with temporary actors and signed test sessions. They did not exercise password login, browser clicks/visual rendering, hosted deployment, email delivery, or binary medical-report upload/download. The sick-leave test uses a dedicated medical-document metadata fixture. Notifications were checked through the in-app notification endpoint, whose synchronization occurs when fetched. Existing historical notifications were not rewritten. No real employee requests were approved or rejected by this test.
