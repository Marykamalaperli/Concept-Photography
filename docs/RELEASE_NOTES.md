# Concept Photography v1.0.0-rc.1

This candidate is for controlled Windows office acceptance. The Git tag identifies the integrated commit to rehearse. [GitHub candidate tag](https://github.com/Marykamalaperli/Concept-Photography/tree/v1.0.0-rc.1)

## Changes since the Studio Ledger baseline

- Attendance calculations now limit open breaks and travel to dates they overlap. Worksheet filter edits survive a workspace refresh.
- The Windows wizard can start a temporary rehearsal or prepare separate local database and backup paths. The existing configuration is protected on repeat setup.
- Precise device fixes are restricted to administrator Attendance. Employee views and worksheets retain the recorded site, time and verification status.
- Controlled shutdown waits for accepted requests and maintenance before closing SQLite. Windows updates verify the approved commit and attempt to restore the previous checkout and dependencies if installation fails.
- The synthetic migration command reconciles imported and restored records, credential handling, attendance and financial totals in paise.
- Feature branches, pull requests and integration pushes run the Ubuntu and Windows verification jobs. The existing GitHub Pages publish step remains a manual release action after approved cutover.

## Verification and office acceptance

Locally, `npm run verify:release` runs the Node tests, dependency audit, launcher build and synthetic migration rehearsal. The candidate also needs passing Actions jobs on both platforms, a browser workflow check and an accessibility sweep for the exact integrated commit. [Branch tracker](BRANCH_TRACKER.md) · [Security audit](SECURITY_AUDIT.md)

Use the pinned candidate for office checks. Record the Windows task and restart results, trusted HTTPS, staff device access, all assigned GPS pins, reminders, authorized migration totals and backup recovery. The studio owner’s separate approval controls production changes. [Windows quick start](../START_HERE.md) · [Office acceptance](PRODUCTION_ACCEPTANCE.md) · [Migration and recovery](MIGRATION.md)
