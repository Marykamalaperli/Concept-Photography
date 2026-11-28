## Self-hosted Concept Photography workspace

Move the studio’s admin and employee portals to Node.js 24 and SQLite. This branch includes independent login, employee attendance, scheduling, private calendars, reminders, files and business reporting. Continue review using the synthetic rehearsal provided by `npm run demo`.

- Add record-scoped client and project administration, role review permissions, active profile photos and searchable account and business audit history.
- Connect both dashboards to current work, approvals, footage and reporting. Use policy versions for historical worksheets. Apply the same acknowledgement and completion review to scheduled and ad-hoc tasks.
- Add encrypted offline note, progress, completion draft, work log, attendance and schedule updates with account isolation, revision validation and conflict recovery.
- Add historical footage selection, secure local attachments, retention policy, verified backups, financial reports and documented Windows preflight and acceptance.
- Apply the studio ledger visual system to sign-in, both role dashboards and operational modules. Group authorized navigation and add a phone dock, live attendance controls and an agenda for shoots.
- Use chronological schedules, a calendar day drill-down and accessible exact-value tables for cash, revenue contribution and working-hours charts. Refine notification, settings, audit, private file and delegated review screens.

## Verification

- 35 Node regression tests cover access, legacy import, work policies, scheduling, GPS, encrypted offline sync, finance, private files, retention and recovery.
- Synthetic Chromium checks cover 280 route and viewport combinations at seven widths. Axe reported zero violations across 51 checked views and states. Matched local median sign-in was 291 ms for administrators and 264 ms for employees.
- The public launcher scored 100 in all four Lighthouse categories on desktop and mobile. GitHub Actions passed on Ubuntu and Windows for `5fb0c8e`. [GitHub Actions run](https://github.com/Marykamalaperli/Concept-Photography/actions/runs/46129639923)

[Design system](FRONTEND_DESIGN_SYSTEM.md) · [Final development report](FINAL_DEVELOPMENT_REPORT.md) · [Requirements matrix](REQUIREMENTS_MATRIX.md) · [Office acceptance](PRODUCTION_ACCEPTANCE.md) · [GitHub comparison](https://github.com/Marykamalaperli/Concept-Photography/compare/main...self-hosted-workspace-migration?expand=1)

## Review and release

Review and test the branch before planning office installation. The acceptance checklist covers physical phones, screen readers, office network performance, trusted HTTPS, deployment and migration.
