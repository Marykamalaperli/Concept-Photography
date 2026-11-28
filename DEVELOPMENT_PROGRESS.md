# Concept Photography development progress

The self-hosted workspace runs on Node.js 24 and local SQLite. The frontend redesign starts at `ada6b2f` on `self-hosted-workspace-migration`. The complete inventory covers 60 original requirements, 21 continuation requirements, 24 pre-rehearsal requirements and 24 frontend requirements. [Requirements matrix](docs/REQUIREMENTS_MATRIX.md)

| Area | Development result |
| --- | --- |
| Access | Role permissions are checked alongside explicit client and project grants. Revocation takes effect on the next request. Staff photos use private uploads and an active profile photo. Account and business activity share a searchable administrator audit history. |
| Business policy | Dated work-hour policies preserve prior worksheets. GPS boundaries, confirmation count and timing, breaks, travel, overtime, daily plan deadlines, evidence and retention are configurable. |
| Workforce | Both dashboards summarize live work and review priorities. Acknowledgement, timing, evidence and completion review apply consistently to regular editing and studio tasks. Old completed shoots can be selected for footage verification. |
| Offline | Encrypted account-bound updates cover notepads, work logs, time and leave requests, daily schedule drafts and private task progress or completion drafts. Synchronization is idempotent, checks versions, and preserves conflicting text for review. Offline departure reconciliation remains separate. |
| Reports and operations | Finance remains integer paise internally and reports cover recorded income, expenses and outstanding balances. Private attachment backups verify checksums. Windows task registration, reviewed updates and health checks are ready for rehearsal. |
| Frontend design | The studio ledger design covers access, both dashboards, delegated reviews, navigation, scheduling, and the cash, revenue and worksheet reports. The phone layout puts attendance, GPS, breaks and the shoot agenda within reach. |
| Performance and access | Final browser coverage includes 280 route and viewport checks and 51 automated accessibility checks. The local public launcher scores 100 in all four Lighthouse categories on desktop and mobile. |

[Frontend design system](docs/FRONTEND_DESIGN_SYSTEM.md) · [Final development report](docs/FINAL_DEVELOPMENT_REPORT.md) · [Pull request description](docs/PULL_REQUEST.md) · [Installation](docs/INSTALLATION.md) · [Migration](docs/MIGRATION.md) · [Office acceptance](docs/PRODUCTION_ACCEPTANCE.md)
