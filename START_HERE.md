# Start with Concept Photography

## Try the workspace on Windows

Install Git and Node.js 24, open PowerShell, then run these commands from the reviewed checkout. Use the exact `v1.0.0-rc.1` tag for controlled office acceptance. [Release notes](docs/RELEASE_NOTES.md)

```powershell
.\scripts\setup-office.ps1 -CheckOnly
.\scripts\setup-office.ps1
```

Open the address printed in PowerShell. Use the separate temporary administrator and employee sign-ins shown there. Try a schedule, attendance and an approval, then press Ctrl+C to remove the synthetic rehearsal. [Windows installation](docs/INSTALLATION.md)

## Prepare an approved office installation

Use the commit chosen for the office rehearsal. Replace the example paths with dedicated folders. Keep backups on a separate authorized drive where available.

```powershell
.\scripts\setup-office.ps1 -Mode Configure -DataDirectory 'C:\ConceptPrivate' -BackupDirectory 'D:\ConceptBackups' -CheckOnly
.\scripts\setup-office.ps1 -Mode Configure -DataDirectory 'C:\ConceptPrivate' -BackupDirectory 'D:\ConceptBackups'
npm.cmd run create-local-admin -- YOUR-ADMIN-EMAIL
.\scripts\start-server.ps1
```

The local admin command prompts for the password without displaying it. For a migration rehearsal, follow the migration guide before provisioning the admin on the restored database. Use a second PowerShell window to run `.\scripts\health-check.ps1` while the server is running. Secure the Windows folders and arrange trusted HTTPS before allowing other devices to connect. [Migration](docs/MIGRATION.md) · [Office acceptance](docs/PRODUCTION_ACCEPTANCE.md)

From the candidate checkout, `npm.cmd ci` and `npm.cmd run verify:release` run the local checks. The synthetic migration can also run separately with `npm.cmd run migration:rehearse`.
