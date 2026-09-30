# Stage 5 — Final Integration, Data Cleanup & Production Readiness

Run 2026-09-27. **No live data was changed.** The live cleanup is fully prepared and rehearsed. It waits on the business decisions in §2, because the stage rules forbid inferring them.

Evidence folder: `outputs/stage5-final/`.

| File | Contents |
|---|---|
| `live-reconciliation.json` / `.txt` | Fresh read-only reconciliation (§1) |
| `simulate-plan.mjs`, `simulation-*.json` | The plan judged by the real pure validators |
| `rehearse-plan.mjs`, `rehearse-retirement.mjs`, `rehearsal/` | The plan executed through the real services on a verified restore |
| `qa-browser.mjs`, `qa/` | Browser acceptance: 77 checks plus screenshots |
| `verify/` | Tests, tsc, lint, build and runtime logs |

Architecture is unchanged:

- Settings holds the master data.
- The Employee Profile is the only place an employee's assignment is set.
- `employees.manager_id` is the only reporting line.
- The chart is derived and read-only.

There was no schema change.

## 1. Fresh live reconciliation (read-only, 2026-09-27)

Snapshot identifiers:

- Employee fingerprint `27b90f50…`. It is identical to the Stage 4 after-snapshot, so no assignment changed since Stage 4.
- Tables: 86 public + drizzle journal (87).
- Latest audit row: 1121.

**Companies (5 KOON Software, 6 Asus Cards, 7 KOON Agency):** all active. Only the legacy `name` is set; `name_ar`, `name_en` and `code` are empty.

**Branches:**

| Branch | Code | State |
|---|---|---|
| Riyadh (2) | RIY | Linked to all three companies |
| Cairo (3) | CAI | Linked to all three companies |
| Branch 1 | `0` | Name `0`, country Andorra. Unlinked and unreferenced |

**Units:**

- KOON Software: U1, U6, U11 (departments) and U18 (team).
- Asus Cards: U2, U3, U10, U12, U13, U17, U19, U21.
- KOON Agency:
  - U65–U68 (departments) and U69–U71 (teams), all **inactive** with scope `all`.
  - **U72 "KOON Agency" (وكاله كون)**, an active department created on 2026-09-26 at 20:57 by admin@koonhr.com through Settings (audit 1120). T4 Marketing Manager was then rebound from U4 to U72 (audit 1121).
- Legacy (no company): U4, U5, U14, U16, U20, U22, U23, U25, U26. U7 and U24 are deleted.

No unit uses a selected branch scope.

**Positions:**

| Position | Title / unit | Occupant |
|---|---|---|
| P1 Software Developer | T1, U1 | none |
| P2 | — | E9 |
| P3 | — | E15 |
| P4 UI/UX Designer | T21, U11 | none |
| P5 Asus Cards CEO | company-level | E33 |

**Empty masters:** grades, work locations, HR rules and `hr_responsibles`. The three HR-capable accounts are not linked to employees.

**Employees:**

| | Count |
|---|---|
| Current employees (plus 3 deleted records) | 45 |
| Complete | 16 |
| Needs Review | 29 |
| With errors | 0 |
| Missing Company | 25 |
| Missing Branch | 27 |
| Missing Department (not company-level) | 1 (E43) |
| Missing Position | 42 |
| On a legacy unit | 15 |

**Reporting:**

- No self-manager, no cycle, no missing or inactive manager.
- No real cross-company line.
- One incomplete pair: E1 is in company 5, but their manager E19 has no company.
- 14 roots.

**Recruitment:** job opening 19 ("it", status open) points at legacy U20.

**Other department references:** `interview_*`, `job_offers` and `performance_cycles.department_ids` hold no organizational references to legacy units beyond opening 19.

## 2. Business decisions required (cannot be inferred)

Each decision below was rehearsed with the stated option (✓ = the proposed option validated end to end through the real services). Values marked *placeholder* are rehearsal stand-ins, not approvals.

| # | Decision | Rehearsed option | Alternatives / notes |
|---|---|---|---|
| D1 | E33 Asus Cards CEO | T26 CEO → **Generic**; E33 Department U14 → none (keeps company 6 + P5) ✓ | Branch for E33: none today — Riyadh / Cairo / leave empty |
| D2 | E19 KOON Software head | New **KOON-POS-CEO** (company 5, is_ceo, no unit); T14 Technology Director → Generic; E19 U4 → none ✓ | Or keep E19 in a KS Department with a department-bound title |
| D3 | E6 KOON Agency head | **Model A:** new AGENCY-POS-CEO + T4 Marketing Manager → Generic ✓ (U72 then unused → delete) | **Model B:** E6 → U72 department, keep T4→U72, no position ✓ (honours the admin's 2026-09-26 change) |
| D4 | Branch of E19's team (E19, E1, E2, E3, E7, E13, E18, E11, E27) | *placeholder* Cairo | No approved branch exists. Riyadh validates identically |
| D5 | E11 (legacy U4, T8 Data Analyst → U4) | *placeholder* U11 UX/UI + T8 → Generic ✓ | E11 is U11's recorded manager and manages E27 there. This must be confirmed, not inferred |
| D6 | **E22** (Asus Support U19, Data Entry, manager E19) | *placeholder* stays Asus Cards, manager → E4 (who manages Support staff E25/E35), Cairo ✓ | E22 **blocks E19's transfer** (partial team). E22 cannot follow E19 into KS while in U19 (an Asus unit) ✗ |
| D7 | E1 title T3 HR Manager (Asus HR) while in Software Development | Left as is (warning) | Change E1's title, or accept |
| D8 | E5 (legacy U20, T34 General Manager → U20) + reports E14, E30 | Company Asus Cards; new **ASUS-POS-GM** (company-level, not CEO); T34 → Generic; *placeholder* Cairo ✓ | Or a Department for E5; branches for E5/E14/E30 |
| D9 | **E78** (legacy U20, T10 → U3; no company/manager) | Not rehearsed — needs Company, Branch, Department, manager | Last blocker for retiring U20 and U14 |
| D10 | T31 Sales Specialist, used by E42 (Agency) and E77/E79 (Asus Sales) | **Generic** ✓ (resolves E77/E79) | Rebind to U67 and give E77/E79 an Asus title |
| D11 | KOON Agency branch scope | `all` for U65–U71 ✓ | Minimal (U65 R+C, U66 R+C, U67 R, U68 R, U69 C, U70 R, U71 R) ✓ — derived from D12 placements, so it must be business-approved, not inferred |
| D12 | Agency placements/branches per the prepared list | Cairo: E34, E10 → U69; E17 → U66. Riyadh: E16, E26 → U70; E41 → U66; E24, E39, E43 → U71; E40 → U68; E42 → U67 ✓ | E39 is today in KOON Software U11 (manager E6) — confirm the move |
| D13 | Agency title rebinding U5 → new departments | T7, T12, T27 → U65; T13, T19, T30 → U66; T29 → U68 ✓ | T29 "Sales and Projects Manager": U68 or U67 |
| D14 | E24, E39 title | T21 (KOON Software UI/UX, U11) → **T19** (Agency UI/UX) ✓ | Or make T21 Generic |
| D15 | Company names/codes | — | Arabic name, English name and code for all three companies (not guessed) |
| D16 | Branch 1 junk | Delete ✓ (never referenced now) | Or deactivate |
| D17 | HR responsibility | — | No eligible HR responsible exists (no HR account is linked to an employee). All six Company × Branch pairs have no rule |
| D18 | Optional: exact existing Positions | — | P1 fits E2, E3, E7, E13, E18 (T1, U1); P4 fits E27 (T21, U11). Positions are optional |
| D19 | Job opening 19 → U20 (open) | — | Keep the historical link; close or retarget it in Recruitment before U20 is deactivated |

Work Locations and Grades stay empty. The legacy free-text work location values are country names ("Egypt", "Saudi Arabia", and implausible ones such as "Jamaica" or "Cocos (Keeling) Islands" for Cairo staff). They are kept intact and are not a source for anything. Suggested masters, only if wanted: Riyadh HQ, Cairo Office, Remote, Client Site.

## 3. Rehearsed execution plan (order matters)

These steps were executed on a restore of a fresh live backup (details in §6), in this order, through the real services. Each step ran in its own transaction with audit rows as the maintenance actor (`user_id NULL`); no application user was fabricated.

1. **L1:** T26 → Generic; E33 Profile save (Department U14 → none).
2. **L2:**
   - Create KOON-POS-CEO.
   - T14 and T8 → Generic.
   - E22 Profile save (D6).
   - **Team Transfer rooted at E19** (9 employees).
3. **L3:** create ASUS-POS-GM; T34 → Generic; **Team Transfer rooted at E5** (E5, E14, E30).
4. **A1:** activate U65–U68, then U69–U71. A parent must be active before its children. Each activation requires the SCOPE_REVIEW_REQUIRED token.
5. **A2:** rebind the Agency titles first (impact preview plus confirmation token), then create AGENCY-POS-CEO. Rebinding after the transfer is refused (JOB_TITLE_DEPARTMENT_MISMATCH).
6. **A3:** **Team Transfer rooted at E6** (11 employees; E24 and E39 also change title to T19); E43 Profile save.
7. **Retirement:**
   - Deactivate U22, U23, U25 and U26.
   - Archive the unused T35 and T5, then deactivate U4, U5 and U16.
   - Delete U72 (Model A) and Branch 1.
   - U20 and U14 wait on E78 (D9) and opening 19 (D19).

Negative probes on the same clone were refused as expected:

| Probe | Error |
|---|---|
| Deactivating an in-use unit | ACTIVE_DEPENDENTS |
| A second active CEO position | CEO_OCCUPIED |
| A cross-company manager | MANAGER_COMPANY_MISMATCH |
| A stale review | STALE_REVIEW |
| Deleting a legacy unit | LEGACY_UNIT |
| Transferring E19 without E22/E11 decided | PARTIAL_TEAM_TRANSFER / LEGACY_UNIT |

**Result on the clone** (same reconciliation script):

| | Now | After plan |
|---|---|---|
| Complete | 16 | **42** |
| Needs Review | 29 | **3** |
| Errors | 0 | 0 |
| Missing Company | 25 | 1 |
| Missing Branch | 27 | 2 |
| Missing Department | 1 | 0 |
| On a legacy unit | 15 | 1 |
| Missing Position | 42 | 39 |

- **Remaining Needs Review:** E1 (title, D7), E33 (branch, D1) and E78 (D9).
- **Reporting:** no cycles, no cross-company lines, no incomplete lines.
- **Roots:** each company head (E19, E33, E6) and E5, plus existing independent roots (E4, E15, E20, E29, E37, E43, E77, E78, E79, E81).
- **Tables touched:** only employees, job_titles, positions, departments and audit_logs; the others are unchanged.

**Executing on live** repeats the safety sequence with the approved values: fresh backup → SHA-256 → full restore → exact rehearsal → compare with live → guarded transactions → post-commit verification. The scripts above are the rehearsal, and none of them can target :5545.

## 4. Code changes (small, tested)

| File | Change |
|---|---|
| `app/organization/org-errors.ts` | New code `ACTION_RETIRED` and `retiredOrganizationAction()` helper |
| `app/api/hr/route.ts` | Six retired legacy department-structure actions now return the structured bilingual `ACTION_RETIRED` (410; 409 for `save_department` on a migrated DB) instead of raw text. One was English-only |
| `app/api/hr/route.ts`, `app/employees/company-hr-catalog.ts` | `save_company` / `save_hr_responsible` audit: see below |
| `app/organization/duplicate-error.ts` | Unique-constraint violations now return structured errors: CEO_OCCUPIED on `is_ceo`, REFERENCED_ENTITY_CONFLICT on `code` / `name_en` / `branch_id` |
| `app/organization-team-transfer.tsx` | The dialog showed a company as `#6`: it ignored the legacy `companies.name`, which is the only name live companies have. Found in browser QA; fixed |
| `app/organization/reporting-tree.ts` | Marked `@deprecated` (test-only, see §7) |
| Tests | `tests/organization-unit-type.test.mjs` and `tests/organization-stage1-review.test.mjs` now pin the structured contracts |

The audit change in detail:

- **Before:** the route wrote a row without `record_id` or `previous_value`. On a migrated DB, `save_company` also produced a second row with `user_id NULL`, because the actor wasn't passed through.
- **After:** exactly one row with actor, table, record id and the before/after rows.

## 5. Integration review

- **Settings / Profile / Chart:**
  - Everything goes through one validator (`assignmentIssues` / `assignmentGroupIssues`), used by the Profile save, Team Transfer, position validation and chart diagnostics.
  - Settings saves go preview → `enforcePlan` → save with the same impact functions, so a preview cannot disagree with the save.
  - No duplicate validation paths were found that are worth removing.
- **UI manageability:** every step in §3 is an existing supported UI operation: Settings, Job Titles, Employee Profile, Team Transfer. **Nothing in normal organizational operations requires direct DB access.**
- **Audit:** these all write actor, entity, action, before/after and a timestamp in the same transaction:
  - employee save;
  - team transfer (one row per employee plus a summary row);
  - company, branch and link changes (`relationChanges`);
  - unit activation, deactivation and scope (`statusChange`, `branchIds`);
  - title rebinding (`bindingChange`);
  - positions, HR rules, work locations, grades;
  - delete.
- **Concurrency:** every organizational write takes advisory lock 78231 and uses `FOR UPDATE`. Reviews are checked for staleness (`assignmentBefore`, `reviewed`, confirmation tokens). Previews also take the lock; that existing choice was left as is.
- **Performance:** `/api/organization` usage counts run about 25 grouped queries per load, with no N+1 per row. `/api/hr` still sends the full payload the chart derives from (known, acceptable at 45 employees). No bottleneck justified changes.

## 6. Verification

- **Backup:** `outputs/stage5-final/rehearsal/live-2026-09-26T22-16-34-368Z.dump`, SHA-256 `854059a8ecc82c62367dd160729b572bbdedeb725ce6e7a366ce3a599861b950`.
- **Restore:** full restore on :5691. All 87 tables match live (row counts and content hashes); schema hash `5d7221e8…` is equal; 31 migrations.
- **Rehearsal:** logs in `rehearsal/rehearsal-log.json`, `retirement-log.json` and `rehearsal-table-diff.json`.
  - Plan: 29 steps pass and 4 negative probes are refused.
  - Retirement: 11 steps pass, and 5 are refused as expected: U4 and U5 until their titles are archived, U20 and U14 blocked, and the legacy delete.
  - The CEO probe ran at the service level before the `duplicate-error` fix. At the API boundary, the same violation now returns CEO_OCCUPIED.
- **Tests:**
  - Unit: 347 tests, 343 pass, 3 skipped, 1 fail. The failure is the known Arabic tanween test in `arabic-navigation`, identical in the baseline and unrelated.
  - Runtime isolated (`tests/runtime-org-manageability.mjs`, :5677): 13/13; 87 tables unchanged after rollback.
- **TypeScript:** 0 errors.
- **Lint:** 0 errors, 9 existing `<img>` warnings.
- **Build:** passes.
- **Browser QA:** 77/77 against the rehearsed clone through the preview on :3021, in Arabic RTL and English LTR at 1440, 820 and 390 px. Covered:
  - Reporting view.
  - Needs Review: exactly E1, E33 and E78.
  - Company leadership equals the company-level positions.
  - Organization view by Department and by Branch: each employee placed once; "Branch not assigned" equals the DB count, with no Country inference.
  - Quick View; Profile from Needs Review.
  - Settings: all five sections, including the Agency teams.
  - Team Transfer dialog.
  - Department-manager restricted view: no identity leak.
  - No writes during QA.
- **Live:** employee and organization fingerprints are unchanged; there are no audit rows after 1121.

## 7. Obsolete code

| Item | Verdict | Reason |
|---|---|---|
| `app/organization/reporting-tree.ts` | Deprecate (marked) | No app import; used by `organization-assignments.test.mjs` and three runtime scripts |
| `LegacyOrgPage` (hr-app.tsx) | Keep | Renders only when `organizationReady` is false (pre-migration databases / older packaged sites) |
| Legacy `save_department` / `delete_department` / `archive department` pre-migration branches | Keep | Pre-migration fallback only; migrated DBs get ACTION_RETIRED or `assertCanDeactivate` |
| `organizational_level` / `refreshReportingLevels` | Keep | Still used by the legacy page and the employees list ordering; the chart ignores it |

## 8. Remaining limitations

- The live cleanup has not been executed; it waits on §2.
- After the plan, three genuine Needs Review items remain until D1, D7 and D9 are decided.
- The company names stay legacy-only until D15.
- HR responsibility routing has no rules, because no HR account is linked to an employee.
- Job opening 19 still points at legacy U20.
