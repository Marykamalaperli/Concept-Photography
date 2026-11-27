# Migrate the existing hosted workspace

This utility is for the controlled cutover phase. It reads a restricted export and builds a new SQLite file. Production data migration remains a separate, office-side operation.

## Export and rehearse

Use an authorized PostgreSQL login and the connection parameters for the existing hosted database. Use a private directory outside the public checkout. Install the PostgreSQL command-line tools on the migration machine. Set the connection values in PowerShell without including a password in the command:

```powershell
$env:PGHOST = 'YOUR_DATABASE_HOST'
$env:PGPORT = '5432'
$env:PGDATABASE = 'postgres'
$env:PGUSER = 'YOUR_AUTHORIZED_DATABASE_USER'
$env:PGSSLMODE = 'require'
psql -W -X -A -t -v ON_ERROR_STOP=1 -f .\scripts\migration\export-legacy.sql -o C:\ConceptPrivate\legacy-export.json
node .\scripts\migration\import-office.js C:\ConceptPrivate\legacy-export.json --dry-run
```

The exporter reads the `concept` schema in one snapshot. The report prints counts, enrollment counts, and aggregate booked value, payments and expenses in paise. It preserves IDs, foreign keys, ISO business dates, and millisecond timestamps. The import verifies SQLite integrity and foreign keys. Compare the aggregate amounts and record counts with the source before proceeding.

Keep the export private. Compatible employee scrypt hashes are carried over. The hosted administrator has to set a local password with the existing admin email. The admin can re-enroll employees with missing or incompatible credentials after importing. The export excludes hosted identity references, access sessions, push subscriptions, provider credentials, and private calendar tokens. Staff can re-subscribe and register notifications from the new origin.

## Build the cutover database

Before the final export, back up the legacy system, arrange a write freeze, and agree on rollback. Use a new destination path.

```powershell
node .\scripts\migration\import-office.js C:\ConceptPrivate\legacy-export.json --output C:\ConceptPrivate\workforce-cutover.sqlite
node .\scripts\database-backup.js verify C:\ConceptPrivate\workforce-cutover.sqlite
```

The utility refuses to overwrite an existing destination. Point `DATABASE_PATH` at the verified file while the application is stopped. Set the local admin password, restart, and test employee access, calendar and notification setup, actual GPS and financial totals. Take a verified snapshot of the new database after testing.

Keep the old site and database available for the rollback window. Switch users only after the new site is verified. Retire the old deployment and remove obsolete GitHub secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` after the rollback period and after checking for other consumers of those secrets. Never commit exports, databases or backups.

## Continuation tables

Migrations 10–21 install the scheduling, attendance, attachment, footage, revenue, project, delegated access, offline departures, unscheduled task flags, work-update push tracking and offline queue encryption keys. The legacy importer preserves exported records and their original IDs, counts and cash totals. Historical rows gain default values for new settings and optional fields. Workflows that did not exist in the source begin empty. In particular, importing a completed shoot does not generate a new footage-check assignment. Post-cutover backups include any private attachments created in the self-hosted workspace.
