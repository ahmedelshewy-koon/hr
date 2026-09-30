# Sanad HR — Lint Cleanup Report

**Date:** 2026-09-19
**Scope:** Clear the remaining `npm run lint` errors and reduce warnings without changing business logic, permissions, API behavior, database schema or user-facing workflows.

---

## Result

| | Before | After |
|---|---|---|
| Lint errors | **22** | **0** |
| Lint warnings | **7** | **5** |
| `npx tsc --noEmit` | pass | pass |
| `node --test tests/*.test.mjs` | 125 tests: 122 pass, 3 skipped, 0 fail | identical |
| `npm run build` | pass | pass |

Nothing was committed. No database, schema, API route or migration file was touched.

Two of the 22 errors are cleared with a documented `eslint-disable-next-line`, not a code change. They are listed under [Left unresolved](#left-unresolved-and-why) because you asked to be told about every one.

---

## Every original issue, classified

| Rule | Count | Kind | Resolution |
|---|---|---|---|
| `jsx-a11y/label-has-associated-control` | 9 errors | False positive from the rule's depth limit | Rule option `depth: 3` in `eslint.config.mjs` |
| `jsx-a11y/no-static-element-interactions` | 7 errors | Backdrop click-to-close on a plain `div` | `role="presentation"` on the backdrop `div` |
| `react-hooks/set-state-in-effect` | 6 errors | Four different patterns, see below | 4 refactored, 2 documented disables |
| `react-hooks/exhaustive-deps` | 2 warnings | One real, one about a request counter ref | Both fixed |
| `@next/next/no-img-element` | 5 warnings | Not actionable in this stack | Left as is |

### Accessibility (16 errors)

**Labels (9).** All nine are the same markup: `<label><input type="checkbox"/><span><b>{text}</b><small>…</small></span></label>`. The text is inside the label, so each control does have an accessible name, but it sits three levels below the `<label>` and the rule stops looking at two. Sites: `employee-drawer.tsx` (settings toggle), `hr-app.tsx` (3 leave-type options, 3 leave switches, 1 org-employee picker), `recruitment/recruitment-forms.tsx` (interviewer picker).

Fix: one project-wide option, `["error", { depth: 3 }]`, with a comment explaining why. The rule still fails on a label that has no text within three levels. **This is the one judgment call in the pass**: it relaxes the rule for the whole project rather than changing the 9 markup sites. If you would rather keep the default depth, the alternative is to flatten those labels (which needs CSS re-checks), so say so and I will do that instead.

The same change made a **pre-existing blanket `/* eslint-disable jsx-a11y/label-has-associated-control */`** at the top of `leave-policies-panel.tsx` redundant. ESLint reported it as unused, and I removed it. The file lints clean without it.

**Backdrops (7).** Six drawers in `employee-drawer.tsx` (payroll run, salary structure, loan, tax bracket, insurance rate, bank export layout) and the leave-type drawer in `hr-app.tsx` close on `onMouseDown` of their full-screen wrapper. Fix: `role="presentation"` on that wrapper.

Why not the `modal-scrim` button that most other drawers in the app use? These seven wrappers have **no dimmed backdrop today**, and `.modal-scrim` adds a tinted, blurred one. Switching would have changed how they look. `role="presentation"` changes neither DOM nor pixels (no stylesheet keys on `role`), and keyboard users already have the labeled close and Cancel buttons inside each panel. Backdrop click stays a pointer-only shortcut.

### `set-state-in-effect` (6 errors) — not one issue

| # | Location | What it really was | Resolution |
|---|---|---|---|
| 1 | `hr-app.tsx` `useHRData` | `void load()` in an effect. `load` only sets state **after** an `await`; nothing is set synchronously. The rule's analysis cannot tell. | The initial load now goes through the same local `refresh` handler the `hr-data-changed` listener already used. **Behavior is identical**; this satisfies the analyzer, it does not fix a bug. |
| 2 | `hr-app.tsx` language and sidebar | Reads `localStorage` once after mount and sets state. Real synchronous set. | Documented disable, see below. |
| 3 | `recruitment-workspace.tsx` requirements draft | Effect copied `data.requirements` into a draft whenever not editing. | Refactored: the draft is derived while not editing, and a copy is taken when editing starts. |
| 4 | `recruitment-workspace.tsx` candidate correction form | Same pattern; only ever shown while correcting. | Refactored: the form is filled from the candidate when correction starts. Also removed the `exhaustive-deps` warning on it. |
| 5 | `recruitment-workspace.tsx` `load()` | `setLoading(true)` runs synchronously on every route change. Real. | Documented disable, see below. |
| 6 | `recruitment/recruitment-forms.tsx` `CandidateDrawer` | Effect cleared screening questions when the job was cleared. | Refactored: cleared in the same render (React's "adjust state when a value changes" pattern); initial state accounts for a missing job. |

The other warning, `exhaustive-deps` on `latestRequest.current` in the `useHRData` cleanup, is fixed by aliasing the ref object inside the effect. The cleanup still bumps the same counter, so late responses are still discarded.

---

## Left unresolved, and why

### 5 × `@next/next/no-img-element` (warnings)

Four static `/sanad-logo.png` images (sidebar, login, org print header, lifecycle header) and one user avatar in `hr-app.tsx`. The app runs on vinext (Vite + Cloudflare), uses `next/image` nowhere, and has no Next image optimizer. Swapping in `<Image>` would need explicit sizes, would touch the print layout, and gives no benefit here. I did not turn the rule off globally either; five warnings is a smaller footprint than a config exemption.

### 2 × documented `eslint-disable-next-line react-hooks/set-state-in-effect`

Both carry a comment explaining the reason. Neither was added blindly.

1. **`hr-app.tsx`, saved language and sidebar state.** `localStorage` does not exist on the server, so the saved value must be applied after hydration or the first client render would not match the server HTML. The React-recommended alternative, `useSyncExternalStore`, would also start syncing these preferences across browser tabs and would change what happens when `localStorage` is blocked. That is a behavior change, so I did not do it.
2. **`recruitment-workspace.tsx`, `load()` on route change.** `load()` sets `loading` (which swaps the whole view for the spinner) before it fetches. It has to do that whenever the route changes. Avoiding it means either a data-fetching library or moving the flag into every navigation handler; the second is unsafe because navigating to the same route creates a new `route` object without re-running the effect, which would leave the spinner up forever. I did not route the call through a wrapper to hide it from the analyzer, because unlike #1 above the synchronous set here is real.

### Suppressions that were already in the repo (unchanged)

`approvals-center.tsx` (`no-autofocus`, reason given), `recruitment-service.ts` (`no-control-regex`, reason given), `ui-types.ts` (`no-explicit-any`, reason given). Net suppression count: +2 line-level disables, −1 file-level disable.

---

## Files changed

| File | Change |
|---|---|
| `eslint.config.mjs` | `label-has-associated-control` option `depth: 3`, with comment |
| `app/employee-drawer.tsx` | `role="presentation"` on 6 drawer backdrops |
| `app/hr-app.tsx` | `role="presentation"` on the leave-type drawer backdrop; `useHRData` effect (local `refresh`, ref alias); documented disable + comment on the preferences effect |
| `app/recruitment-workspace.tsx` | Requirements draft derived from data, copy on edit start; correction form filled on start; documented disable + comment on `load()` effect |
| `app/recruitment/recruitment-forms.tsx` | `CandidateDrawer` clears questions in render instead of in an effect |
| `app/leave-policies-panel.tsx` | Removed the now-redundant file-level `eslint-disable` |
| `MIGRATION_SAFETY_REPORT.md` | One backup path rewritten with forward slashes. See [build hazard](#markdown-file-broke-the-build-and-the-dev-server). Text only. |
| `LINT_CLEANUP_REPORT.md` | This file |

`git diff` for these files also shows earlier uncommitted work (the working tree was already dirty), so its counts are not a measure of this pass.

---

## Validation

Final run against the current working tree:

| Command | Result |
|---|---|
| `npm run lint` | 0 errors, 5 warnings (all `no-img-element`) |
| `npx tsc --noEmit` | pass |
| `npm run build` | pass |
| `node --test tests/*.test.mjs` | 125 tests, 122 pass, 3 skipped, 0 fail. The 3 skips are the same opt-in tests as before. |

### Browser smoke test

Run in headless Chrome against a **throwaway sandbox**: a scratch copy of the repo, a restored copy of the database, and login credentials generated for the sandbox only. The sandbox server, database and credentials were deleted afterwards. Your dev server on port 3000 and the real database were not used for testing; the real database still has no test rows.

44 checks, all passing. (A few early attempts failed because of mistakes in my test script, such as stale Arabic text, Arabic-Indic digits and hard-coded expected values. None were app failures.)

| Area | What was checked |
|---|---|
| App shell / `useHRData` | Login, dashboard data loads; `hr-data-changed` triggers a refetch of `/api/hr` |
| Language and sidebar (disabled effect) | Toggle to English and reload: still English/LTR. Collapse sidebar and reload: still collapsed. Restored afterwards. |
| 6 payroll drawers | For each: click inside stays open, backdrop click closes, X closes. Loan drawer: empty save shows the validation error and stays open; Cancel closes. |
| Label toggles | Clicking the label text flips the checkbox in the settings drawer, leave-type drawer (3 options) and leave-policy drawer |
| Leave-type drawer | `role="presentation"` present; inside click stays open; backdrop click closes |
| Requirements draft | Edit starts from saved values; changing a weight updates the total to 95% and disables Save; Cancel restores; re-entering edit shows saved (not discarded) values; a valid edit saves; the next edit starts from the new saved version |
| Candidate drawer | Opens on the first open job with its screening question; clearing the job clears the question at once; re-selecting reloads it; candidate saves |
| Correction form | Prefilled from the candidate; Cancel hides it; re-open shows the original values, not the discarded edit; after a save, the next correction starts from the saved value |
| Recruitment route change (disabled effect) | Opening a job from the list shows the loading state, then the detail |

**Not verified:** screen-reader output (only DOM roles and behavior), browsers other than Chrome, right-to-left layout of the recruitment screens beyond what the tests touched, and saving in the settings and leave-policy drawers (only opening, toggling and closing).

---

## Things found along the way (outside the requested scope)

### Markdown file broke the build and the dev server

`npm run build` failed mid-pass with `Invalid code point 11940551` in `globals.css`, and your dev server on port 3000 was returning HTTP 500 for the same reason. Cause: Tailwind v4 scans every file in the project, including Markdown. `MIGRATION_SAFETY_REPORT.md` (written last session) contained a Windows path with the text `d--HR` followed by a backslash and `b632c71b`, which CSS reads as a hex escape for code point 0xB632C7. I changed that one path to forward slashes and the build passed again. The dev server was serving a stale scan, so I touched `app/globals.css` (timestamp only) and it returned to 200.

This will recur with any document that contains a backslash followed by six hex digits. A durable fix is to exclude Markdown from scanning in `globals.css` with `@source not "../*.md";`. I did not apply it (untested, and outside this task). This report avoids such paths.

### Someone else is editing `hr-app.tsx` right now

The file changed several times while I worked (a `focusEmployeeId` feature and a new `app/navigation-labels.ts`). My edits there are small and exact-match. Near the end, a `pageLabel` import in that file was flagged as unused (an error from their in-progress work). I removed it, but their code started using `pageLabel` a moment earlier, so my edit briefly broke their typecheck. I restored the import right away and `tsc` is clean again. If you saw a transient `pageLabel` error at about 13:11, that was me. The lint result above includes their in-progress state as of the final run.

### Smaller observations, not changed

- **Duplicate React keys.** Opening the Create Job drawer logs "two children with the same key". The `employees` list in `/api/recruitment` returned ids 1 and 2 twice (48 rows). I saw this in a copy of your data. It is unrelated to this pass, and I did not check the real database.
- **One console 404** appeared in some page loads. I could not reproduce or identify the resource.
- **Payroll drawers look sparse** (cramped header, fields and footer, no dimmed backdrop). I did not investigate whether that is intended.

---

## Re-running the checks

```bash
npm run lint
npx tsc --noEmit
npm run build
node --test tests/*.test.mjs
```
