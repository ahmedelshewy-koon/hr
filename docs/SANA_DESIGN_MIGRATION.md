# SANA HR visual-system migration

Date: 1 October 2026

## Reference audit

Both supplied SVGs were inspected as vector source and rendered before implementation. The primary reference is `C:/Users/elshewy/Desktop/DESIGN SYSTEM.svg` (6023 × 4113). The composition reference is `C:/Users/elshewy/Desktop/dashboard - ref.svg` (1440 × 2817).

| Rule | Supplied reference | HR implementation |
| --- | --- | --- |
| Palette | White, #F4F3EF, #F0EDE8, #E7E7E7, #A8A8A8, #D9FBF3, #95E0D1, #79CBAA, #0B4237, #111B1B | Shared named tokens; old blue/navy aliases resolve to SANA colors |
| Structure | Dark teal navigation, inset neutral workspace, white header and widgets | Shared responsive application shell; RTL and English layouts retained |
| Spacing | 4, 8, 12, 16, 24, 32, 48, 64px | Shared spacing tokens in feature padding and gaps; 24px desktop workspace padding |
| Grid | 24px margin, 16px gutter, 16–24px gaps | 16px KPI gutters and 24px widget gaps; existing feature-specific grids retained |
| Typography | H1 bold 24px, H2 bold 20px, body regular/medium | 24px/20px bold headings, 16px body, compact 14px table text and 12px supporting labels |
| Containers | 24–32px radii | 24px cards and rounded controls, 32px large containers; circles and chart geometry retained |
| Borders/shadows | Thin borders; 8–16px shadow blur | Neutral CRM table/card hairlines; teal outlined controls; shared restrained shadow tokens |
| Buttons/inputs | Teal gradients, dark/outlined variants, rounded inputs, disabled/error states | Existing control classes consume shared tokens; focus, disabled, and invalid states retained |
| Charts | Dark teal, mint and green families | Shared chart tokens for attendance, report styles and evaluation graphics |

The SVG lettering is converted to paths: neither file identifies the UI font family. HR retains its locally hosted IBM Plex Sans Arabic. The typography sample's body note includes 16px/9px; small interactive/table text remains 12–14px for legibility. The shared SANA HR text wordmark is not a claim to reproduce the outlined SANA logo geometry.

## Existing frontend audit and implementation

The application uses React 19 and Vinext/Vite. `app/hr-app.tsx` owns the shell, permitted destinations, common dashboard, and existing shared controls. `app/globals.css` contains baseline tokens and layout rules; `app/typography.css`, `app/page-title.css`, `app/sidebar-glass.css`, and `app/mobile-experience.css` layer shared presentation. Feature CSS covers employees, profiles, attendance, leave, organization and its company/branch/department/position forms, payroll, recruitment, learning/evaluation, reports, approvals, assets, and settings.

The initial implementation mixed blue/navy colors, glass gradients, several radii and shadows, and feature-specific literal values. The migration replaces these visual values with shared SANA tokens while retaining the feature selectors and structural rules. It does not replace domain components or their data contracts.

- `app/sana-tokens.css`: reusable palette, spacing, radius, shadow, button and chart tokens.
- `app/sana-theme.css`: shared shell and component presentation, with desktop/collapsed/mobile/print rules.
- `app/sana-brand.tsx`: shared module wordmark for navigation and sign-in.
- Existing feature styles: token-based colors, radii, padding and gaps.
- Dashboard: existing attendance KPI buttons moved to a top row, preserving their values, permissions and detail-dialog callbacks. The ring and distribution keep their real attendance data.
- Inline evaluation/certificate graphics and sign-in pattern assets use the same palette.

The repository already contained substantial uncommitted work. No backend, authorization, route, database, migration or API changes were made by this visual migration. No production records were written. All browser checks used intercepted fixture responses; screenshots contain synthetic data.

## Validation

- TypeScript: `npx tsc --noEmit` passed.
- Production: `npm run build` passed (existing large-chunk and route-classification notices remain).
- Existing role/navigation suite: **245 checks passed**, four roles.
- Rendering and organization checks: **23 passed, 1 skipped**, no failures. The existing attendance runtime test was skipped because its optional runtime environment was not enabled.
- Shared token validation: verifies every SANA reference resolves and the token graph contains no cycles.
- Browser inspection: all 15 permitted destinations rendered at 1440px and 390px with no client errors or document-level horizontal overflow. English layout, the mobile drawer, employee profile, employee creation form, and sign-in were also inspected.
- Lint is not clean: three existing errors outside this migration remain in `app/biometric-setup.tsx` (`jsx-a11y/no-autofocus`) and `app/organization/impact-policy.ts` (two unused parameters), along with existing image warnings.

Local evidence is retained under `tmp/sana-reference/`: reference renders, desktop screenshots for each destination, mobile navigation/dashboard, employee profile/form, login, build logs and `visual-results.json`.

Browser fixtures validate layout and navigation, not production integrations. Organization rendering tests cover assignment fields and permission-aware profile controls; not every populated company/branch/position dialog was exercised in a browser. No new standalone HR features or pages were invented to fill gaps in the existing product.
