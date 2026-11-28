# Release candidate security verification

The internal review used synthetic accounts, private test files and temporary SQLite databases. It covers the Node.js workspace and its saved data across the feature and integration branches. [Release notes](RELEASE_NOTES.md) · [Branch verification](BRANCH_TRACKER.md)

| Area | Control and verification |
| --- | --- |
| Accounts and sessions | Scrypt credentials, cookie restrictions, persistent login throttling, and server-side revocation. Regression tests verify inactive accounts, role changes, session scope and sign-out. |
| Role and record access | Delegated permission and explicit record access both apply. Tests reject unrelated client, project, task and worksheet access and verify grant revocation within a live session. |
| GPS privacy | Employee and worksheet API responses return a location-recorded indicator. Exact device fixes are available on administrator Attendance until retention clears them. A regression verifies unauthorized access rejection, retained clock totals and the database record. |
| Files and backups | Private file endpoints apply record authorization and validate file size and type. Backup and restore verify SQLite integrity, foreign keys and attachment checksums. The rehearsal compares a restored copy with its source. |
| Offline work | Queued updates are encrypted, bound to the account and versioned. Tests cover wrong-account access, duplicate sync, stale writes and conflicts. |
| CI and release | Feature and development pushes use read-only verification permissions. Linux runs the dependency audit and Windows checks scripts and isolated operational workflows. Production publication requires separate approval. |

Office acceptance verifies physical storage ACLs, the limited service account, trusted HTTPS and remote access, real phones, notification enrollment and an authorized restore. Independent penetration testing falls outside the scope of this internal review. [Office acceptance](PRODUCTION_ACCEPTANCE.md) · [Recovery and retention](OPERATIONS.md)
