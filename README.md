# Concept Photography Office Workspace

Concept Photography’s admin and employee portals run on one Node.js server with SQLite. The server serves the website, authenticated API, private calendars, and the in-app reminder scheduler from the same origin.

## Run locally

Install Node.js 24 or newer. Run these commands from the repository root.

```sh
npm ci
npm run create-local-admin -- admin@example.invalid
npm start
```

Enter the admin password at the terminal prompt, then open http://127.0.0.1:3000. The workspace starts empty. For isolated development, set `DATABASE_PATH` to a temporary SQLite file. Copy [.env.example](.env.example) to `.env` for persistent local settings. These settings can live outside the source checkout through environment variables.

For a guided rehearsal, run `npm ci` and `npm run demo`. Open the loopback address printed by the command and use the separate, randomly generated administrator and employee credentials. The demo creates a temporary SQLite file and attachment directory with synthetic schedules, attendance, approvals, files workflow and finance records. Press Ctrl+C to stop and delete the rehearsal. Use `npm run demo -- 20` for a larger dataset with 80 employees, 480 clients and shoots.

## Office deployment and operations

- [Windows installation, HTTPS, startup and updates](docs/INSTALLATION.md)
- [Legacy data export, rehearsal and migration](docs/MIGRATION.md)
- [Office network preflight and production acceptance checklist](docs/PRODUCTION_ACCEPTANCE.md)
- [Architecture, security, backup recovery and staff guides](docs/OPERATIONS.md)
- [Development progress and remaining requirements](DEVELOPMENT_PROGRESS.md)
- [Dependency and cost audit](docs/ZERO_COST_AUDIT.md)

## Checks and GitHub Pages

```sh
npm test
npm run build:pages
node scripts/audit-pages.js
```

The Pages build creates a public studio launcher in `dist/`. Set `WORKSPACE_URL` when building it to provide the HTTPS link to the office server. The launcher also accepts a workspace address when this setting is empty. Run the Lighthouse audit with Chrome or Chromium available. GitHub Actions tests the migration branch on Linux and Windows. Publishing the launcher is separate from building and testing it.
