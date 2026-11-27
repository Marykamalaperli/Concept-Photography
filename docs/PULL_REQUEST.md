## Self-hosted Concept Photography workspace

Move the studio workspace to Node.js 24 and SQLite. Keep the existing login, calendar subscriptions, employee and administrator portals, and optional mobile reminders.

- Add daily plan approvals, task change and completion reviews, emergency scheduling, and next-workday reminders.
- Add multiple office pins, configurable GPS boundaries, break and shoot-travel timers, shift review, worksheets and offline departure reconciliation.
- Add scoped client projects and delivery links, private attachments with verified backups, footage approval, revenue contributions and expanded financial reporting.
- Add delegated review permissions and audit records for scheduling, attendance, files, access and financial changes.

## Verification

- 27 local Node tests cover access, legacy import, scheduling, GPS, offline departures, finances, private uploads, project authorization, footage approval and database and attachment recovery.
- GitHub Actions runs the regression suite on Linux and Windows.
- Chromium exercised admin and employee workflows at seven viewport widths using synthetic data.
- The public launcher scored 100 in all four Lighthouse categories in the local desktop and mobile check. Authenticated flows were verified separately in Chromium.

## Review and release

Review the remaining development and office acceptance work in [DEVELOPMENT_PROGRESS.md](../DEVELOPMENT_PROGRESS.md) and the [requirements matrix](REQUIREMENTS_MATRIX.md). This branch changes the development workspace. Office setup, live deployment and production data migration follow a separate approval and rehearsal.
