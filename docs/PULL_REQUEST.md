## Self-hosted Concept Photography workspace

Move the studio’s admin and employee portals to Node.js 24 and SQLite. This branch includes independent login, employee attendance, scheduling, private calendars, reminders, files and business reporting. Continue review using the synthetic rehearsal provided by `npm run demo`.

- Add record-scoped client and project administration, role review permissions, active profile photos and searchable account and business audit history.
- Connect both dashboards to current work, approvals, footage and reporting. Use policy versions for historical worksheets. Apply the same acknowledgement and completion review to scheduled and ad-hoc tasks.
- Add encrypted offline note, progress, completion draft, work log, attendance and schedule updates with account isolation, revision validation and conflict recovery.
- Add historical footage selection, secure local attachments, retention policy, verified backups, financial reports and documented Windows preflight and acceptance.
- Improve authenticated loading, client pagination, keyboard focus, responsive layouts and calendar contrast.

## Verification

- 35 Node regression tests cover access, legacy import, work policies, scheduling, GPS, encrypted offline sync, finance, private files, retention and recovery.
- Synthetic Chromium checks cover administrator and employee routes at seven widths. Authenticated accessibility and performance are reported separately from the public launcher’s local Lighthouse scores.
- The GitHub Actions workflow targets Ubuntu and Windows and validates PowerShell syntax on Windows.

[Final development report](FINAL_DEVELOPMENT_REPORT.md) · [Requirements matrix](REQUIREMENTS_MATRIX.md) · [Office acceptance](PRODUCTION_ACCEPTANCE.md) · [GitHub comparison](https://github.com/Marykamalaperli/Concept-Photography/compare/main...self-hosted-workspace-migration?expand=1)

## Review and release

Review and test this branch before planning office installation. The production site, Supabase database, office server and production data are outside this development rehearsal.
