# Concept Photography frontend design system

## Creative direction

The studio ledger direction uses warm paper, dark olive navigation, and a brass accent drawn from the company mark. Its visual cues come from studio contact sheets and production schedules. Rules, aligned numbers and date groups make busy pages easy to scan. The existing studio photograph and logo anchor sign-in. Operational pages give that space to work and records.

Three directions were considered.

| Direction | Evaluation |
| --- | --- |
| Studio ledger | Warm, legible surfaces, familiar photographic branding and clear hierarchy for schedules and finance. Selected. |
| Monochrome darkroom | A strong fit for image editing sessions. The studio also uses this product outdoors, at shoots, and for long finance and attendance tables. |
| Architectural operations | A crisp neutral grid suits large tables. The brand would rely more heavily on its logo to distinguish it from a general office tool. |

The application uses a light workspace with dark navigation. A separate dark theme would benefit some editors in dim rooms, but this phase prioritizes field visibility and consistent contrast across reports, statuses and dialogs. Theme controls would need their own complete visual and contrast pass.

## Skills and resources

| Resource | How it informed the work |
| --- | --- |
| Cloud Environment Desktop | Read the skill guidance. Used actual rendered pages for visual inspection and Playwright for repeatable captures, viewport sweeps and flows. Captures contain synthetic accounts and records. |
| Cloud Environment Runtime | Read the skill and its repository reference. Verified the repository, branch and baseline checkout, used isolated local servers, avoided reserved ports and delivered evidence via workspace files. |
| Playwright, Chromium and axe-core | Reused the available local tools for viewport, keyboard, performance and accessibility checks. These tools are outside the workspace's runtime dependency tree. |
| Repository fixtures and prior verification | Used `scripts/demo.js`, the existing workflow rehearsal, the production acceptance checklist and the prior performance report as the baseline. |
| Existing assets and local dependencies | Reused the company mark, login photograph, Inter and Manrope from the installed Fontsource packages, and Lucide from the local package. |

The cloud skill catalog and executor skills were checked, along with repository and parent instructions. The available cloud catalog listed runtime, desktop and environment onboarding. The last one covers environment setup. The executor had no skills and the checkout had no applicable AGENTS.md. The specifically named frontend design, UI/UX, design system, impeccable, Playwright and accessibility skill packages were unavailable. Playwright and axe-core tooling was available and used directly. No packages, artwork, fonts or design subscriptions were added.

## Color and typography

| Role | Token or value | Use |
| --- | --- | --- |
| Paper, surfaces and rules | `--paper #f3f2e9`, `--white #fffdf7`, `--stroke #dcd9cb` | Page, tables, dialogs and separators |
| Main and secondary text | `--ink #282a20`, `--muted #5d5e50` | Headlines, data and supporting copy |
| Olive and dark navigation | `--accent #444e2d`, `--accent-hover #323b21`, `--night #23261a` | Primary actions, links and navigation |
| Brass | `--brass #d6c377`, `--gold #6e561f` | Mark-aligned accents, review counts and selected date emphasis |
| Input and focus | `--control #a49f88`, `--focus #6c632c` | Input boundaries and visible keyboard focus |
| Semantic states | Sage, sand, peach and neutral | Positive, attention, interruption and inactive states, always paired with text |
| Plots | Olive and umber | Paired measures, with a legend and exact-value table |

Manrope is retained for workspace headings and prominent totals. Inter is retained for navigation, data and forms. The lightweight sign-in and public launcher use system typography. Headings are generally 27–32 px, body copy 13–14 px and compact metadata 11–12 px. Numbers for times, currency and quantities use tabular figures. Status labels keep their words at small widths where they affect a decision.

The spacing scale uses 4, 8, 12, 16, 24 and 32 px. Most surfaces use a 6 px corner radius and thin dividers. Compact UI favors grouped rows and open space. Dialog elevation marks the active interaction layer. Inter and Manrope use the SIL Open Font License, and Lucide uses the ISC license. [Dependency and license notes](ZERO_COST_AUDIT.md)

## Component and layout patterns

- The login and launcher share a two-panel composition. The existing photograph receives a large crop on wide screens and a short header on mobile. The sign-in action and labelled inputs remain directly visible.
- The desktop sidebar groups authorized routes by purpose. Breadcrumbs show the section. On mobile, a bottom dock exposes the three most common role actions and a drawer provides the full workspace. The dock accounts for device safe areas. Escape closes the drawer and returns focus.
- The administrator dashboard uses a single ruled summary strip, a dated shoot agenda, a separate review inbox, a duty register, and month-to-date cash. On smaller screens the inbox comes first.
- The employee dashboard anchors on the live clock, verified site, progress toward the day’s work target, and work priorities. Flexible assignments are identified explicitly. Footage responsibilities appear when relevant to the signed-in account.
- Day-to-day and weekly planning use date-grouped rows. Unscheduled and postponed work have explicit labels. On desktop the month grid limits crowded cells to two events and a link to all bookings on that date. At 720 px and below, the grouped agenda is the default surface.
- Finance, revenue and worksheets use a shared comparison chart for paired values or meaningful short lists. It keeps a zero baseline, shows scale ticks and a legend, exposes exact values in a keyboard-accessible table and keeps net cash signed. Full finance and worksheet exports retain their existing formats.
- Employee and client directories, project files, attendance, payroll and audit history use registers or data tables. Tables may scroll within a labelled region. The surrounding page fits the viewport.
- Task details, profile, attachments, approval decisions and settings use a consistent dialog and action treatment. Settings and permission forms use explicit labels. Pending, unsuccessful, offline and empty states provide a next action when one is available.

## Accessibility and responsive review

Use native controls, focus indicators, semantic headings and named table regions. Pair color with text. Make touch actions at least 44 px high for primary clock and dock controls. Dialogs use bounded heights and return focus after Escape. The design uses no decorative motion and respects reduced-motion preferences. Charts offer labelled values directly without hover.

Checked viewport widths are 320, 375, 390, 768, 1024, 1440 and 1920 px. Those checks use Chromium and synthetic records. Operating-system screen readers, live camera and GPS behavior on staff phones, and office network latency remain part of controlled office acceptance. [Office acceptance](PRODUCTION_ACCEPTANCE.md)

## Visual review

The downloadable design evidence opens with `DESIGN_REVIEW.html` and contains the `before`, `iteration-1` and `after` folders, browser and Lighthouse reports, and a matched sign-in benchmark. The baseline is commit `ada6b2f` and the records are synthetic. The demo was expanded to include bookings on the current studio day so the final agenda also exercises populated rows. Matched dashboard captures use identical fixture data for both versions.

| View | Before | After |
| --- | --- | --- |
| Sign-in and launcher | Small logo over an equal split, rounded shell and key tile above the action | More room for the photograph, a small corner logo, and a quieter form |
| Admin dashboard | Separate metric cards and an ungrouped list of links | A ruled summary, today's bookings, a review inbox, and grouped navigation |
| Employee phone view | Work controls within scrolled content and a one-row cluster of break actions | Thumb navigation, hourly progress, and a two-column break control layout |
| Shoot calendar | Seven compressed columns on phones | Native chronological agenda on narrow screens and a capped month grid on desktop |
| Finance, worksheet and revenue | Repetitive rows for trends and large detail blocks | Scaled comparisons, exact-value tables and independent reporting sections |

The intermediate captures showed cramped break controls and a large full-width location panel. The next visual pass spaced the break buttons, grouped GPS feedback, reduced the location panel to a concise horizontal section, and separated the notification inbox from device settings. [Development and verification report](FINAL_DEVELOPMENT_REPORT.md)
