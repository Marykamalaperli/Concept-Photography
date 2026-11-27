# Concept Photography final development report

The self-hosted admin and employee workspace is ready for a controlled office rehearsal. Development continued from `56c6c40` on `self-hosted-workspace-migration` with temporary SQLite databases and synthetic records. The migrations preserve the historical work policy of an existing SQLite database or imported legacy records. [GitHub comparison](https://github.com/Marykamalaperli/Concept-Photography/compare/main...self-hosted-workspace-migration?expand=1)

## Delivered

- Client and project delegation checks both role permissions and record scope. Task reviews, footage reviews and private evidence follow the same record grants. Profile photos use private uploads. Authorized records use the active photo and fall back to initials. The admin audit groups searchable account activity, staff and project changes, approvals, financial changes, policy versions and recovery evidence.
- Employee and manager dashboards connect current attendance, breaks, travel, schedules, assignments, reviews, footage, worksheets, notifications and relevant financial summaries. Editing and studio tasks follow the same acknowledgement, timer and completion review rules. Managers can queue footage verification for selected historical shoots.
- Dated work policy preserves historical worksheet calculations. The settings page configures work hours, GPS confirmation, breaks, travel, overtime, deadlines, evidence and retention. Precise GPS fixes and detailed audit metadata can expire while attendance totals and audit events remain available.
- Offline work uses encrypted, account-bound queues for notes, schedule drafts, private progress and completion drafts, work logs, leave and attendance requests, and reported departures. Synchronization rejects outdated revisions and prevents duplicates. The owner can recover queued text after a conflict.
- Finance keeps booked value, actual receipts, pending payments, expenditures and allocations separately in integer paise. Monthly and annual views, matching elapsed-period comparisons, client and project totals, CSV and print-to-PDF use recorded data.

[Requirements matrix](REQUIREMENTS_MATRIX.md) · [Pull request description](PULL_REQUEST.md)

## Verification

- The Node.js regression suite has 35 passing tests, up from 31 at the starting commit. New cases cover delegated scope and immediate revocation, dated policy and required evidence, encrypted offline writes and stale versions, and historical detail retention. Expanded coverage verifies profile photo restore, private attachment expiry, historical footage backfill, import policy preservation, conditional state authorization and backup audit evidence. [Ubuntu and Windows checks](https://github.com/Marykamalaperli/Concept-Photography/actions?query=branch%3Aself-hosted-workspace-migration)
- Chromium exercised both roles and verified 22 administrator routes and 17 employee routes at 320, 375, 390, 768, 1024, 1440 and 1920 pixels. It also exercised mobile offline sign-out and account switching, private photo upload and activation, and reviewed shift and task flows. Axe reported zero violations across 45 checked views, including the delegated desk and selected dialogs. Keyboard checks covered dialog focus and Escape. Screen-reader use and real-device touch and GPS testing belong to the office checklist.
- The local public launcher scored 100 for performance, accessibility, best practices and SEO on desktop and mobile. The Lighthouse run passed the cache, image delivery, network dependency tree and render-blocking checks. The numbers below measure the authenticated workspace separately.

## Authenticated performance

The local test used Chromium with a loopback Node.js server and SQLite populated with 80 employees, 480 clients, 480 projects and 480 shoots, plus attendance, payments, expenses and work queues. The mobile view used a 390 px viewport. Times measure interaction and rendering on the test machine, without office Wi-Fi or mobile network latency.

| Measured operation | Administrator | Employee |
| --- | ---: | ---: |
| Sign-in to usable dashboard | 363 ms | 473 ms |
| Workspace API median of five responses | 24 ms | 39 ms |
| Monthly worksheet API median of five responses | 5 ms | 6 ms |
| Dashboard navigation | 35 ms | 25 ms |
| Task board navigation | 16 ms | 17 ms |
| Shoot calendar navigation | 60 ms | 67 ms |
| Notifications navigation | 50 ms | 16 ms |
| Client directory navigation | 33 ms | — |
| Finance report navigation | 357 ms | — |

An approximately 654 KB administrator snapshot compressed to about 33 KB in the synthetic benchmark. An unchanged snapshot returns HTTP 304 with an empty body. Initial client-directory rendering uses 30 rows. The worksheet session query uses the composite employee and time index. Local reminder, studio-notice and attendance-gap processing took approximately 0.75–3 ms per cycle with Web Push disabled. Physical network timings and closed-app delivery will be measured during office acceptance.

## Security and independent operation

The internal review covered scrypt password hashing, session limits and revocation, persistent throttling, account and role checks, record grants, private attachments, parameterized database queries, HTML escaping, same-origin protection, content security policy and structured input. Negative tests covered anonymous access, unrelated clients and projects, stale and cross-account offline updates, cross-origin requests, invalid file content, oversized uploads, path traversal and altered backups. Audit search is restricted to administrators. The service worker keeps a generic offline page, and authenticated responses use `no-store`.

The browser used only its loopback workspace origin during the core flows. The server, login, data, notices, reports, and recovery work without Supabase or paid backend services. Google Maps resolution uses constrained Google URLs. Optional Web Push validates supported HTTPS providers and rejects redirects. Private calendar subscriptions need access to the workspace URL. `npm audit --audit-level=low` reported zero known vulnerabilities in the project's dependency tree.

The office operator controls filesystem ACLs, TLS, device access and protected backups. This report records internal verification. Independent penetration testing remains separate. [Security and operations](OPERATIONS.md) · [Dependency and cost audit](ZERO_COST_AUDIT.md)

## Office acceptance

Run `npm run demo` to review both portals with temporary credentials and synthetic records. The office team can then check Windows startup and recovery, trusted HTTPS, LAN and remote access, Android and iPhone GPS behavior, mobile reminders, an authorized import, financial reconciliation, backups, and rollback. Production cutover requires acceptance by the studio owner.

[Installation](INSTALLATION.md) · [Acceptance checklist](PRODUCTION_ACCEPTANCE.md) · [Migration](MIGRATION.md)
