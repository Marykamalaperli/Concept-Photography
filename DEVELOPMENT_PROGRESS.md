# Concept Photography self-hosted development progress

## Continuation after 37ca25e

The development branch extends the same Node.js 24 and SQLite workspace with reviewed scheduling, attendance and breaks, worksheets, client projects, secure evidence, footage storage approval, revenue contribution, finance reporting, delegated reviews and offline departure reconciliation. Schema versions 10–21 upgrade existing databases. The [requirements matrix](docs/REQUIREMENTS_MATRIX.md) covers all 60 original sections and 21 continuation sections.

- Daily plans are drafted, submitted and approved with revision history. Managers can assign flexible work without setting a start time. Employees see their next available task on the board. Emergency shoots move overlapping non-shoot work into rescheduling while retaining recorded time.
- Multiple authorized office and shoot pins use configured distance and accuracy limits. Two recent GPS observations confirm automatic changes. The End shift action records an employee’s departure even when GPS is unavailable. Encrypted departure reports can survive reload and synchronize when the same employee signs in again.
- An administrator can grant four review permissions across seven staff roles. Private work, financial data and project files are authorized separately. Worksheet performance comparisons exclude approved leave, official travel, GPS gaps and tasks awaiting or affected by schedule changes.
- Per-device Web Push preferences keep schedule reminders and actionable work updates separate. Work updates omit private notes, locations and client details.
- Private attachments use configurable disk storage and SQLite metadata. Checksummed backups include attachments. A completed shoot queues one storage check, with a configurable assignee and screenshot approval.
- Revenue contributions use a share of booked shoot value and closed work sessions. Company receipt, expense and cash profit figures remain separate. Project and finance reports are based on actual records. Growth comparisons match elapsed dates for incomplete months and years.

### Verification

- 31 Node tests pass locally with synthetic records. GitHub Actions run on Linux and Windows without deploying.
- Chromium exercised both roles, including attendance, breaks, plans and approvals, evidence, worksheet CSV, footage, project access, revenue, finance and offline departure reconciliation. The responsive sweep covered 20 admin routes and 17 employee routes at widths of 320, 375, 390, 768, 1024, 1440 and 1920 pixels.
- The local public launcher Lighthouse audit scored 100 in performance, accessibility, best practices and SEO on desktop and mobile. Latest report files are available in the session’s scratch output. This measures the static launcher. The authenticated workspace was checked in Chromium rather than assigned those scores.

### Remaining development

Start with permission rules for delegated client and project administration. The existing role matrix and scoped project APIs provide the entry points. Add regression tests for grant, revocation, ownership and financial isolation. Follow with remaining business audit events, active profile photos and configurable policy thresholds. Assisted-technology checks, real office devices, Windows startup, HTTPS, backup rehearsal and production cutover remain separate acceptance work.

## Baseline at 37ca25e

### Review range

Base `cd7f077` on `main`. Development branch `self-hosted-workspace-migration`. The branch originally pointed at the base commit. This is a review increment of the larger transformation. It leaves the live site and existing hosted database running.

| Area | Delivered in this branch | Work still outstanding |
|---|---|---|
| Standalone architecture | Extracted the shared modules into `lib/`, removed the hosted runtime and deployment configuration, enabled same-origin SQLite sessions, private calendar feeds, independent reminder scheduling, optional Web Push, and HTTPS configuration | Office network and TLS rehearsal with the real hostname |
| Accounts | Local administrator enrollment, scrypt credentials, persistent throttling, employee creation and password reset, activation and deactivation, password change, access history, private notes | Custom permission matrix and auditing every business mutation |
| Attendance | Preserved office and multi-pin shoot verification, automatic departure and return, configurable GPS grace period, a durable gap history, and configurable daily attendance targets | Multiple office pins, geofence and accuracy settings, repeated boundary confirmation, travel, lunch and break accounting, shift closure reviews, and employee worksheets |
| Scheduling | Preserved month calendar, lead and crew assignment, conflict warnings, open work approval, shoot states, editing handoff, timers, and calendar subscriptions | Daily schedule drafts and approvals, weekly and daily calendar views, full task lifecycle, evidence, emergency rescheduling, extension requests and 6 PM submissions |
| Reminders | Preserved in-app work start reminders, optional closed-app Web Push, test reminders, read state and retries | Event-driven assignment and approval notices and the new reminders for tasks, breaks, end-of-day and storage |
| Clients and files | Retained private client directory and client links on assignments | Searchable project resource records, validated local uploads and downloads, configurable footage manager workflow, evidence review, and file backups |
| Finance | Preserved payments, expenses, due dates, overdue balances and CSV, with six-month cash trends and a cash margin from recorded transactions | Categorized receipts and expenses, client and employee allocation, additional reporting periods, receipts, PDF and Excel reports, and performance analytics |
| User experience | Kept the existing brand, local typography and icons, removed the decorative admin hero, added account controls and GPS status, and provided a private-data-free offline screen | Full portal redesign, detailed task and project interfaces, and offline synchronization |
| Deployment and recovery | Added a legacy exporter/importer, integrity and count reconciliation, online SQLite backup and safe restore, Windows scripts, and a gated Pages launcher workflow | Run scheduled tasks, real backups, migration, and device testing on the office machine |

GPS interruptions are recorded for administrative review. They do not automatically create deductions or close an attendance shift. A verified departure still closes the interval. Daily target progress uses recorded attendance intervals and approved adjustments. It does not compute net payable work when separate break and travel policies are required.

## Repository changes

- `lib/` now owns accounts, SQLite-compatible workflows, attendance and gap checks, HR, optional Web Push, calendars and reminders.
- `public/` keeps the login, admin and employee interfaces. An offline navigation fallback caches only a generic screen.
- `server.js` serves the same-origin workspace and implements `/healthz` and private `/calendar/<token>.ics`.
- `store.js` adds migrations 7–9 for calendar versions, throttling, optional push, GPS verification and gap history, account status, access audit and notes.
- New authenticated endpoints include `/api/profile`, `/api/profile/password`, `/api/profile/notes`, `/api/employees/access`, and admin-only `/api/access-audit`. Attendance accepts verified in-area samples and HR settings accept the daily target and GPS grace period.
- The old hosted-only authentication, Postgres adapter, Edge Function, and hosted deployment workflows were removed from this branch. Their pre-migration state is available at the base commit.
- `scripts/migration/` and `scripts/database-backup.js` provide independent preflight and recovery. The PowerShell scripts handle installation, startup, Task Scheduler control, health checks, backup, restore and reviewed updates.
- `.github/workflows/checks.yml` runs tests without deploying. The launcher publishing workflow can only run manually on `main` after cutover confirmation.

## Verification

- Twelve Node tests pass. They cover role isolation, persistence, geofence transitions, verification gaps, account changes, financial arithmetic, reminders, calendar access, migration validation and backup restoration.
- A PostgreSQL 17 rehearsal applied the compatible legacy schema to a synthetic database. The exporter and importer reconciled two employees, one office, one client, one shoot, one payment and one expense. The snapshot had 1,200,500 paise booked, 200,000 paise received and 11,000 paise spent. Its SQLite integrity check passed.
- Chromium verified sign-in, office GPS, notes isolation, and offline navigation against a temporary SQLite database. The dashboard sweep covered 320, 375, 390, 768, 1024, 1440 and 1920 pixels. The browser observed no external network requests in that scenario. The optional Web Push scheduler and calendar operations are covered separately.
- The local launcher Lighthouse report scored 100 in performance, accessibility, best practices, and SEO on desktop and mobile. This audit covers the public launcher.
- The production dependency audit reported zero known vulnerabilities in npm’s advisory database at the time of testing.
- Screenshots from the synthetic browser session are available in the task workspace under `scratch/concept-office-preview`.

Production data was not included in development and has not been migrated. The office server, production HTTPS, Windows task execution and real-phone GPS and Web Push require their respective deployment checks. The project has not undergone an external penetration test.

## Deployment references

[Windows setup](docs/INSTALLATION.md) · [Migration walkthrough](docs/MIGRATION.md) · [Operations, security and recovery](docs/OPERATIONS.md) · [Cost audit](docs/ZERO_COST_AUDIT.md)
