# SANA Dark Mode: Master Prompt

Companion to the Light Mode master prompt. **The two modes never share tokens.**

## Token separation rules

- Light tokens live in `app/sana-tokens.css` under `:root`. Do not edit them for Dark work.
- Dark tokens live in `app/sana-tokens-dark.css` under `[data-theme="dark"]`. Every name ends in `-dark`.
- Values that happen to be equal in both modes (`--sana-green-50/200/400/900`, primary gradient stops) are still referenced by mode-specific names in Dark.
- Values that differ and must never be mixed:

| Concern | Light | Dark |
|---|---|---|
| Shell | `--sana-shell` #EBEBEB | `--sana-shell-dark` #111B1B |
| Card shadow | `rgba(0,204,161,.16)` | `rgba(161,236,221,.16)` |
| Card border | `--sana-border` #F5F5F5 | `--sana-border-dark` #073028 |
| Sidebar item height / gap | 44px / 16px | 55px / 24px |
| Hover | `--sana-hover` #188164 | `--sana-hover-dark` #0B4237 |
| Secondary button | #F4F3EF / #0B4237 | #111B1B / #25C6A3 |
| Text | black-based | white-based |

- Components must not read both families in one rule. Dark overrides go inside `[data-theme="dark"] ...` selectors only.
- Status: **applied** (2026-10-13). `app/sana-tokens-dark.css` is imported by `globals.css`; `app/sana-dark-theme.css` (imported last in `hr-app.tsx`) maps the Dark values onto the shared semantic names under `html[data-theme="dark"]`. The topbar `ThemeToggle` (`app/theme-toggle.tsx`) stores the choice in `localStorage["hr-theme"]`; `layout.tsx` applies it before paint. Printing always uses Light.
- Foreground-only aliases (`--sana-on-fill`, `--sana-on-fill-soft`, `--sana-on-fill-canvas`, `--sana-brand-text`, `--sana-accent-text`) are used for `color:` so Dark can remap surfaces without turning button text dark. Use them for new text-on-fill rules; use `--sana-white`/`--sana-canvas`/`--sana-line` only for surfaces and borders.
- The landing page (`.landing`) re-declares the Light tokens, so it looks the same in both modes.
- `tests/sana-design-system.test.mjs` fails if a Dark token is not `-dark` suffixed or collides with a Light token.

---

## Prompt (verbatim)

Apply the following SANA DARK MODE visual design system to the EXISTING product.

STRICT RULE: This is a VISUAL RESTYLE ONLY.

Do NOT change: content, labels, translations, logo, navigation, page structure, widgets, KPIs, charts, chart data, tables, table data, forms, filters, workflows, routes, permissions, business logic, functionality.

The EXISTING PRODUCT is the source of truth for content, structure and functionality. The REFERENCE IMAGE is VISUAL-ONLY. Never copy its content, KPIs, charts, tables, labels, widgets or information architecture.

### Global style
- Brand: SANA / سنع. Font: Alexandria globally.
- Direction: clean, minimal, enterprise-grade, premium, calm, data-dense but comfortable, suitable for long work sessions. Arabic-first RTL + English LTR.

### Outer background
Gradient `#031212 → #083934`. Subtle, dark, premium.

### App shell
Background `#111B1B`, radius 16px. No other gradient inside the shell.

### Cards
- Gradient `#021615 → #000000`, radius 24px, padding 16px, border `#073028`.
- Shadow `0px 0px 8px 0px rgba(161,236,221,0.16)`. Do not increase the glow; softly elevated, not neon.

### Borders
- Default `#073028`: cards, inputs, forms, dropdowns, search, filters, normal panels, tabs, modal dividers, standard containers.
- Internal dense `#021914`: tables, row separators, dense data sections, inner panel dividers.
- Secondary button border `#25C6A3`. Switch bar border `#073028`. No other border colors.

### Tables / internal data surfaces
Background `#000C0C`, separators `#021914`, white-based text. Preserve all data, columns and functionality.

### Typography (strict)
- All general text is white or a white-based tonal hierarchy. Headline `#FFFFFF`, general text `#FFFFFF`, supporting text and metadata white with reduced emphasis but readable.
- No green for general text. Green is for brand, interaction, selected states and visualization only.
- Scale: H1 24 Bold; H2 20 Bold; H3/card title 16 Medium/Bold; body large 16; body 14; supporting 12–13; small 10–11; minimum metadata 9. Font Alexandria. No oversized headings.

### Text color exceptions
Primary button `#FFFFFF`; secondary button `#25C6A3`; sidebar active `#0B4237`; sidebar hover `#FFFFFF`; selected switch `#FFFFFF`; semantic statuses may use functional colors. Everything else white-based.

### Buttons
- Primary: gradient `#1C7B61 → #0B4237`, text `#FFFFFF`, radius 32px, hover `#0B4237`.
- Secondary: bg `#111B1B`, border `#25C6A3`, text `#25C6A3`, radius 32px. This treatment applies ONLY to secondary buttons.
- Interactions subtle: no scaling, glow or layout shift.

### Global hover
`#0B4237`. Subtle; no neon, scaling or movement.

### Sidebar
Preserve content, order, routes and behavior.
- Item: height 55px, radius 16px, horizontal padding 16px, vertical gap 24px, icon 18–20px, icon-label gap 8px, label Alexandria Medium 14px, default text/icons white-based.
- Active: fill `#F4F3EF`, text and icon `#0B4237`.
- Hover: bg `#0B4237`, text and icon `#FFFFFF`. Do not enlarge or move items.

### Switch bar / segmented control
Background `#111B1B`, border `#073028`, radius 16px. Selected item: gradient `#1C7B61 → #0B4237`, radius 16px, text `#FFFFFF`. Unselected: white-based.

### Supporting colors
Approved: `#D9FBF3`, `#95E0D1`, `#79CBAA`, `#0B4237`. For charts, visualization, progress, selected states, icon backgrounds, small accents. Not random.

### Icon backgrounds
LIGHT green behind standard icons: `#D9FBF3` or light tonal `#95E0D1` / `#79CBAA`. Not dark green.

### Layout
Margin 24px, gutter 16px, gaps 16/24, spacing in multiples of 8 only (8, 16, 24, 32, 40, 48, 56, 64), card padding 16px.

### Header / topbar
Preserve content and function. Dark surface consistent with `#111B1B`, border `#073028`, white-based text, compact.

### Inputs / forms / dropdowns
Background `#111B1B` (or appropriate dark input surface), border `#073028`, white-based text, Alexandria. Focus: approved green interaction styling. Error: semantic danger. Preserve labels, validation, behavior.

### Charts
Do not change type, data, series meaning, labels, titles, functionality. Where safe, prefer `#0B4237 #79CBAA #95E0D1 #D9FBF3`. Gridlines `#021914`. Container uses the card system.

### Modals / popups
Open in the CENTER of the page; never turn normal modals into side drawers. Surface `#000000` or near-black flat, border/dividers `#073028`, white-based text, backdrop black translucent + blur, padding ~24px.

### Badges / status
Compact. Approved green palette where appropriate. Semantic success/warning/danger/info keep functional colors, never decorative.

### Motion
Fast 120–150ms, standard 180–200ms, slow 240–300ms; restrained ease-out / ease-in-out; no bouncing or exaggerated scaling.

### Accessibility
WCAG AA where feasible; visible keyboard focus; readable contrast; keyboard interaction preserved; usability over styling.

### Implementation
Apply through shared tokens / CSS variables (see `app/sana-tokens-dark.css`). No conflicting duplicate theme values.

### Content firewall
Never copy or infer content from the reference. Ignore extra cards, KPIs, charts, navigation, tables, sections. Do not OCR the reference. REFERENCE = VISUAL STYLE ONLY. APPLICATION = CONTENT + STRUCTURE + FUNCTIONALITY.

### Global consistency
One Dark family across ALL pages: same card shadows, borders, type scale, sidebar states, buttons, switch bars, tables, modals. No green general text.

### Final QA (real browser, not just build/typecheck)
Alexandria everywhere; text white-based; outer gradient `#031212 → #083934`; shell `#111B1B` r16; cards `#021615 → #000000` r24 p16 border `#073028` shadow `rgba(161,236,221,.16)`; tables `#000C0C` with `#021914` borders; primary gradient; secondary `#111B1B/#25C6A3`; buttons r32; hover `#0B4237`; sidebar 55px / r16 / gap 24 / active `#F4F3EF` + `#0B4237`; switch bar `#111B1B/#073028` with gradient selected; 8pt spacing, margin 24, gutter 16; modals centered with black blur backdrop; light icon backgrounds; no content/logic/KPI/chart/table changes; RTL + LTR; no overflow regression; desktop/tablet/mobile functional.

FINAL RULE: DO NOT CHANGE LOCKED VALUES. DO NOT REINTERPRET COLORS. DO NOT APPROXIMATE SPACING. DO NOT CHANGE CONTENT, STRUCTURE OR FUNCTIONALITY. Only apply the SANA DARK MODE visual system.
