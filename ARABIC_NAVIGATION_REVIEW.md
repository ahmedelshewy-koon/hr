# Sanad HR — Arabic, Terminology & Navigation Review

Date: 2026-09-19 · Scope: Arabic wording, terminology consistency, page naming and navigation only.
No database schema, HR data, business rules or authorization rules were changed.

## Summary

| Area | Result |
|---|---|
| Arabic strings reviewed | 2,141 Arabic literals across 25 source files, plus every English validation/authorization message the API can return (about 280) |
| Terminology | One approved Arabic term per concept; about a dozen concepts had two to four competing terms |
| Page names | 9 of 16 pages had a different name in the sidebar, page header or permission/availability lists; all now read from one table |
| Navigation bugs fixed | 6 (notification deep links, notification fallbacks, 15 notification types without an Arabic title, raw enum text in notifications, dead dashboard buttons, capitalization mismatch in three English headers) |
| Server errors in the Arabic UI | Every API validation message (286 exact entries plus patterns) now has approved Arabic wording; nothing falls back to English |
| Checks | typecheck clean · lint 0 errors · build passes · 127/131 node tests pass (the one failure is not from this work, see §8) · browser smoke test 275 checks in Arabic and 218 in English across four roles, 0 failures |

Two new modules carry the fixes, so wording and routing rules live in one place each:
[app/navigation-labels.ts](app/navigation-labels.ts) (page names and notification routing) and
[app/api-messages.ts](app/api-messages.ts) (Arabic wording for server messages).

---

## 1. Arabic wording issues found

**Literal or mistaken translations**
- "الدور الوظيفي" was used for the *access role* (English: "Access role"). It literally means "job role", which collides with "المسمى الوظيفي". Now «دور المستخدم».
- "انتهاء العمل" / «إنهاء الخدمة» labelled the employee's `end_date`, which the system uses as the **contract end date**. «إنهاء الخدمة» means offboarding, so the employee card showed the wrong concept. Now «تاريخ انتهاء العقد».
- "بدء العمل" / "بداية العمل" (three spellings for the start date). Now «تاريخ المباشرة».
- "نوع/سبب الانفصال" (separation) in the offboarding record. Now «نوع/سبب إنهاء الخدمة», matching the module name.
- "راتبي" as the tab for payslips. Now «قسائم راتبي».
- Grammar: «تم إعادة فتح …» → «تمت إعادة فتح …» (payroll run and training program).
- "تقارير نظام الموارد البشرية المكتمل" (a literal rendering of "Complete HRMS reports"). Now «تقارير إضافية للموارد البشرية».
- "قسم أب" (literal "parent department"). Now «قسم أعلى», as used elsewhere in the app.
- "الإخطار المسبق بالأيام", "طلب مرفق بعد عدد أيام", "منضمون هذا الشهر", "صافي الإجمالي", "فترة السماح بالدقائق" reworded to read naturally.
- "معلق / معلّق / المعلق" used for three different ideas (pending, unfinished, outstanding).

**Colloquial or transliterated words**
- "كورس / كورسات / كورساتي" (20 occurrences) → «برنامج تدريبي / برامجي التدريبية».
- "الداشبورد" → «لوحة التحكم». "مقفولة" / "الأدمن" → «مغلقة» / «مدير النظام». "أرقام الاختبار" → «البيانات التجريبية».

**Spelling and orthography**
- Two tanween conventions were mixed (46 words like «مؤقتاً» beside 70 like «مؤقتًا»). Unified on fathatan-before-alif (مؤقتًا).
- «عن بعد» (2) beside «عن بُعد» (7) → «عن بُعد».
- ASCII digits inside Arabic sentences («4 خانات», «15 دقيقة») next to Arabic-Indic digits elsewhere → «٤ خانات», «١٥ دقيقة».

**Mixed Arabic/English and raw values shown to users**
- API validation and authorization errors were shown in English inside the Arabic UI ("Employee not found", "Rejection reason is required", …). Now translated.
- Fifteen notification types had no Arabic title and displayed «غير محدد» (see §4).
- The secondary line of notifications showed the internal marker `request_waiting` as «غير محدد», job titles as «غير محدد», and ISO dates reversed inside RTL text («01-10-2026» for 2026-10-01).

## 2. Terminology standardized

Rules applied: one word per concept; keep an English term only where it is the clearer choice (CSV, Excel, UTF-8, PDF); do not change stored enum values, only their displayed label.

Notable decisions (details in the dictionary below):
- **Approvals.** The whole module already used the verb «اعتماد» and the status «معتمد» (78 + 29 occurrences). I standardized the module on «الاعتمادات» rather than «الموافقات» so the noun, verb and status share one root; «تتطلب موافقة» became «تتطلب اعتمادًا».
- **Pending.** «قيد الانتظار» for status; «بانتظار …» for "awaiting X"; «معلّق مؤقتًا» kept for "on hold"; «غير مكتمل» / «متبقية» where the English meant unfinished or outstanding (a "pending" mandatory training is not waiting for anyone, it is incomplete).
- **Training.** «برنامج تدريبي» for course/program everywhere; «دورة» is kept only for review cycles and payroll runs.
- **Assets.** The page and profile tab are «العهد والأصول» (the sidebar said «الأصول», the page header «أصول الموظفين», another list «العهد»).
- **Recruiter vs hiring manager.** «مسؤول التوظيف» and «مدير التوظيف» differed by one word for two different roles. Recruiter is now «أخصائي التوظيف».
- **Check-in/out.** «الحضور / الانصراف» everywhere; «الدخول / الخروج» removed from attendance tables (login/logout keep «تسجيل الدخول/الخروج»).

## 3. Major wording changes

| Was | Now | Where |
|---|---|---|
| اعتماد الطلبات / مركز الاعتمادات / الموافقات | **الاعتمادات** | sidebar, page header, permission list, page-availability panel, loading text |
| الأصول / أصول الموظفين | **العهد والأصول** | sidebar, header, profile tab, report card, permission list |
| التعلم / مركز التدريب والتطوير | **التعلم والتطوير** | sidebar, header, permission list |
| إدارة الرواتب (header) vs الرواتب (sidebar) | **الرواتب** | header |
| لوحة المعلومات | **لوحة التحكم** | page-availability panel |
| دورة حياة الموظف | **التهيئة وإنهاء الخدمة** | page-availability panel, legacy talent workspace |
| الدور الوظيفي | **دور المستخدم** | employee drawer, users page, templates |
| بدء العمل / بداية العمل | **تاريخ المباشرة** | employee drawer, profile, cards, validation messages |
| انتهاء العمل / «إنهاء الخدمة» (end date) | **تاريخ انتهاء العقد** | employee drawer, profile, cards |
| معلق / المعلق / معلقة | **قيد الانتظار** (or غير مكتمل / متبقية) | balances, dashboard, requests, recruitment queues, lifecycle |
| كورساتي … | **برامجي التدريبية …** | learning workspace |
| طلب تأخير · Work from home → عمل عن بُعد | **تأخر عن الدوام** · **عمل من المنزل** | request drawer, request tables |
| الدخول / الخروج | **الحضور / الانصراف** | portal, profile attendance table |

Ambiguous wording was made specific: server failures now say what failed instead of showing English (see [app/api-messages.ts](app/api-messages.ts)), and the second reports section now reads «تقرير الأداء», «تقرير التوظيف», … to match «تقرير الحضور» etc. The generic «تنفيذ الإجراء» messages that remain in payroll are only fallbacks: every payroll action already passes its own specific message.

## 4. Broken navigation found and fixed

1. **Notification deep links dropped the record.** `employees?employee=7` was cut to `employees`, so the contract-expiry and document-expiry alerts opened the employee list, not the employee. The Employees page now opens that employee's profile. (Editing from that profile uses the loaded list row, so the existing edit flow is unchanged.)
2. **Notifications sent people to an unrelated page.** An Employee receiving "asset assigned", "document expiring" or "contract expiring" was pointed at `assets` / `employees`, which their role cannot open; the app silently showed the first menu item (the dashboard). Now: open the page if allowed; else the recipient's own **Employee Portal** (for `employees` and `assets` only); else stay put and show «لا تملك صلاحية فتح الصفحة المرتبطة بهذا الإشعار».
3. **Fifteen notification types had no Arabic title.** performance_review_assigned / returned / finalized / overdue, performance_manager_review_complete, lifecycle_task_overdue, onboarding_started, offboarding_started, asset_assigned, asset_returned, training_assigned / updated / completed / overdue, certification_expiring showed «غير محدد». All have titles now, and a test fails if the server ever emits a title the bell cannot translate.
4. **Notification detail line.** `request_waiting` and job titles rendered as «غير محدد»; ISO dates rendered back-to-front in RTL. Now hidden / shown as-is / shown as localized dates.
5. **Dead dashboard buttons for the Employee role.** The "Next holiday → View all" button pointed at *Leave Management*, a page Employees cannot open, so it did nothing visible. Dashboard buttons now link only where the user has access (the holiday card falls back to the portal, which shows the next holiday) and are hidden when nothing is reachable.
6. **Header ≠ sidebar in English.** "Leave management", "Users & permissions", "Reports & exports" (headers) vs "Leave Management", "Users & Permissions", "Reports & Exports" (sidebar). Headers now read the shared table.

## 5. Dead or incorrect links

Checked and working: every sidebar item; employee card "View profile / Edit / Delete"; department "Open department" and org-chart nodes; recruitment Overview → Jobs / Interviews, job → candidate, and the three Back buttons; report export links (all 11 report types are handled by `/api/reports`); recruitment document links; portal "Back to daily workspace"; notification links (after the fixes above).

Found and left as-is (see §9): the "Help & support" sidebar item only showed a "coming soon" toast; the recruitment candidate page's Back button returns to the candidate list, not to the job it was opened from.

## 6. Permission / navigation

- The menu is driven by the server's `allowed_pages` (role grants filtered by Super Admin page availability); pages outside it are not rendered and fall back to the first allowed page only if access is revoked while a page is open. I did not change this.
- Verified in a browser for **Super Admin, HR Manager, Department Manager, Employee**: each sees exactly its granted pages, none of the restricted pages appear in the menu, and no click reaches a page outside the list.
- All API routes authenticate (`requireActor` / `requirePortalSession`) and authorize (module permission or employee scope); a hand-typed URL can therefore not return data the role cannot see. No authorization code was changed.
- Fix 2 above only *chooses among* pages already in `allowedPages`; it cannot grant access.

## 7. Files changed

New
- `app/navigation-labels.ts` — approved page names, `resolveNotificationDestination`
- `app/api-messages.ts` — `localizeApiMessage` (286 exact messages + patterns)
- `tests/arabic-navigation.test.mjs` — regression tests (6)
- `tests/runtime-navigation-smoke.mjs` — opt-in Playwright smoke test (fixture-only, no database)
- `ARABIC_NAVIGATION_REVIEW.md`

Modified (wording/navigation only)
`app/hr-app.tsx`, `app/approvals-center.tsx`, `app/attendance-workspace.tsx`, `app/biometric-workspace.tsx`, `app/employee-drawer.tsx`, `app/employee-portal-workspace.tsx`, `app/employee-profile-360.tsx`, `app/employee-request-drawer.tsx`, `app/learning-workspace.tsx`, `app/leave-approvals-workspace.tsx`, `app/leave-policies-panel.tsx`, `app/lifecycle-workspace.tsx`, `app/localization.ts`, `app/page-availability-panel.tsx`, `app/performance-workspace.tsx`, `app/recruitment-workspace.tsx`, `app/recruitment/recruitment-forms.tsx`, `app/talent-workspaces.tsx`, `app/api/auth/route.ts` (three Arabic messages only).

> Another session was editing the same working tree (notably `hr-app.tsx`, `employee-drawer.tsx`, `navigation-labels.ts`) while this review ran. The changes above were re-checked to be present at the end, but `git diff` on those files will also show that session's edits.

## 8. Tests performed

| Check | Result |
|---|---|
| `tsc --noEmit` | passes |
| `eslint app tests db worker …` | 0 errors (5 pre-existing `<img>` warnings) |
| `npm run build` | passes; all 19 API routes and the page are still registered (approvals, assets, auth, dashboard, documents, documents/:id, employees/:id, hr, learning, lifecycle, notifications, operations ×3, performance, recruitment, recruitment/documents/:id, reports, talent/options) |
| `node --test tests/*.test.mjs` | 131 tests: **127 pass, 1 fails, 3 skipped** (opt-in DB tests). Includes the 6 new tests. |
| Browser smoke test (Chromium, all `/api/**` calls intercepted) | Arabic: 275 checks, 0 failures · English: 218 checks, 0 failures |

The smoke test covers, per role: menu contents and names; each page opens, header equals the approved name, no console/page errors; no English words on Arabic pages; RTL/LTR direction; every dashboard button lands on an accessible page; six notification links resolve correctly (including the employee deep link and the "no access" message). Screenshots of the Arabic dashboard (with the notification panel), Learning and Assets pages were inspected for RTL layout.

**The one failing test is not caused by this work.** `rendered-html.test.mjs › "provides personal account login, password change, and logout controls"` looks for the class `profile-logout` in `hr-app.tsx`. That class was removed by the other session's sidebar redesign (`sidebar-glass.css`, which also removed the Help button) while this review was running. I did not touch the sidebar footer.

To re-run the browser test: `RUNTIME_BASE_URL=http://localhost:3000 PLAYWRIGHT_MODULE=<playwright-core path> node tests/runtime-navigation-smoke.mjs` (`SMOKE_LANG=en` for English).

## 9. Issues intentionally left unchanged

- **Holiday seed names** in `app/api/hr/route.ts` contain hamza-less spellings («اجازة», «الاضحى»). The seed de-duplicates on `(holiday_date, name_ar)`, so correcting the code would insert duplicate holidays into an existing database. Correct them through the holiday editor or an HR-approved data fix.
- **"الكيان" (entity)** in "نوع الكيان" is acceptable legal-entity wording and is pinned by an existing test.
- **Grammatical gender in some statuses** (e.g. «ملغاة», «لم تبدأ» in lifecycle agree with «عملية»). Consistent inside the module; changing it would make the module inconsistent with itself.
- **The default password 123456** is written on the Users page and in messages. That is a security/business decision, so only its wording was left alone.
- **Hard-coded "2026"** in "قائمة الإجازات الرسمية 2026" and "لا توجد إجازات في 2026".
- **English wording** was only changed where needed to make a page name identical across sidebar and header. English field labels such as "Work start / Work end" were not rewritten, so the Arabic (تاريخ المباشرة / تاريخ انتهاء العقد) is now clearer than its English counterpart.
- `LeaveApprovalsWorkspace` and the non-asset modes of `TalentWorkspace` are not mounted anywhere; they were kept (aligned to the new terms) rather than removed.
- The Users page label: `navigation-labels.ts` originally set it to «المستخدمون والصلاحيات» / "Users & Permissions"; another session has since shortened it to «المستخدمون» / "Users". The page still manages roles and permissions, so the longer name is more accurate, but I left their edit in place.

## 10. Recommended follow-up

1. Move the remaining inline `rtl ? "…" : "…"` strings (≈2,000) into one dictionary keyed by id. Terminology would then be enforced by construction instead of by the new guard test.
2. Have the API return message *codes* alongside the English text so the client never has to match on strings; `api-messages.ts` can then shrink to a code table.
3. Give the workspaces real URLs (or at least query parameters). Learning, performance and approval notifications can only open the module, not the specific enrollment, review or request, because the app has no per-record routes.
4. Make the recruitment candidate page's Back return to the originating job.
5. Decide the fate of the "Help & support" entry (the other session's redesign has removed it from the sidebar).
6. Replace the default password with a one-time generated password shown once.
7. Fix the holiday seed spellings with a reviewed data migration.
8. Fix or update `rendered-html.test.mjs` once the sidebar redesign settles (`profile-logout` pin).

---

## Arabic terminology dictionary

| English | Approved Arabic | Notes |
|---|---|---|
| Dashboard | لوحة التحكم | |
| Employee Portal | بوابة الموظف | |
| Approvals (module) | الاعتمادات | approve = اعتماد, approved = معتمد |
| Employees / Employee | الموظفون / الموظف | |
| Leave Management / Leave | إدارة الإجازات / الإجازة | profile tab: الإجازات |
| Attendance | الحضور والانصراف | |
| Check-in / Check-out | الحضور / الانصراف | login stays تسجيل الدخول |
| Remote (attendance) | عن بُعد | |
| Work from home (request) | عمل من المنزل | |
| Late arrival (request) | تأخر عن الدوام | |
| Performance | الأداء | review cycle = دورة تقييم |
| Recruitment | التوظيف | |
| Candidate | المرشح | |
| Job (opening) | الوظيفة | |
| Recruiter | أخصائي التوظيف | |
| Hiring manager | مدير التوظيف | |
| Onboarding & Offboarding | التهيئة وإنهاء الخدمة | offboarding = إنهاء الخدمة |
| Assets | العهد والأصول | single item: أصل |
| Learning & Development | التعلم والتطوير | |
| Training program / course | برنامج تدريبي | not كورس / دورة |
| Organization Chart | الهيكل التنظيمي | |
| Users & Permissions | المستخدمون والصلاحيات | see §9 note on the shortened label |
| Access role | دور المستخدم | not الدور الوظيفي |
| Reports & Exports | التقارير والتصدير | each card: تقرير … |
| Payroll | الرواتب | payroll run = دورة رواتب; payslip = قسيمة الراتب |
| Settings | الإعدادات | |
| Notifications | الإشعارات | |
| Department | القسم | parent department = القسم الأعلى |
| Job title | المسمى الوظيفي | not الوظيفة |
| Direct manager | المدير المباشر | |
| Department manager | مدير القسم | |
| HR / HR Manager | الموارد البشرية / مدير الموارد البشرية | |
| Super Admin | مدير النظام | |
| Employee ID | الرقم الوظيفي | not الكود |
| Code (generic) | الرمز | |
| Work email | البريد الوظيفي | |
| Start date (employment) | تاريخ المباشرة | |
| Contract end date | تاريخ انتهاء العقد | |
| Status | الحالة | |
| Pending | قيد الانتظار | |
| Awaiting (a person) | بانتظار … | |
| On hold | معلّق مؤقتًا | |
| Incomplete / outstanding | غير مكتمل / متبقٍ | |
| Approved | معتمد | |
| Rejected | مرفوض | |
| Completed | مكتمل | |
| Cancelled | ملغي | |
| Active / Archived | نشط / مؤرشف | |
| Overdue | متأخر | |
| Probation / Notice period | تحت التجربة / فترة إشعار | |
| Country: Saudi Arabia / Egypt | السعودية / مصر | |
| Save / Cancel / Close | حفظ / إلغاء / إغلاق | |
| Refresh / Retry | تحديث / إعادة المحاولة | |
