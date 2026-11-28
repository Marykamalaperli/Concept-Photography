# Install the office workspace on Windows

Use these instructions after the branch passes review and the office deployment is approved. The office machine needs persistent local storage, a Windows account for running the workspace, and Node.js 24 or newer. Install Git for Windows and Node.js for all users, then open a new PowerShell window. [Node.js downloads](https://nodejs.org/en/download) · [Git for Windows](https://git-scm.com/install/windows)

Use the [office network preflight and acceptance checklist](PRODUCTION_ACCEPTANCE.md) for the installation rehearsal. From a reviewed checkout, `scripts\setup-office.ps1 -CheckOnly` checks prerequisites. Running `scripts\setup-office.ps1` starts the temporary synthetic rehearsal and prints its address and credentials. Ctrl+C removes the temporary data. [Quick start](../START_HERE.md)

## Set up a local rehearsal

Run PowerShell as the user who will manage the source checkout. Use an empty folder and a reviewed branch or release commit.

```powershell
New-Item -ItemType Directory -Path C:\ConceptOffice -Force
Set-Location C:\ConceptOffice
git clone https://github.com/Marykamalaperli/Concept-Photography.git workspace
Set-Location .\workspace
git switch self-hosted-workspace-migration
Set-ExecutionPolicy -Scope Process RemoteSigned
.\scripts\install.ps1
notepad .env
```

Use a dedicated folder for the database and another for backups. Restrict their Windows ACLs and the ACLs for `.env` and TLS key files to the service account and designated administrators. For example, use `DATABASE_PATH=C:/ConceptPrivate/workforce.sqlite` and `BACKUP_DIRECTORY=D:/ConceptBackups` in `.env`. Create these volumes or folders only where appropriate for the office machine. Set `HOST=127.0.0.1` for the local rehearsal.

Run the migration dry run before creating an office database from production data. For an empty rehearsal database, provision the local admin directly. For an imported database, provision the admin using the same email as the imported administrator to keep its ID and records.

```powershell
npm.cmd run create-local-admin -- YOUR-ADMIN-EMAIL
.\scripts\start-server.ps1
```

Leave that terminal open. In a second PowerShell window, run:

```powershell
Set-Location C:\ConceptOffice\workspace
.\scripts\health-check.ps1
Start-Process http://127.0.0.1:3000
```

Add employee credentials and the office pin in the application. Use the coordinates directly to verify attendance without a maps provider.

## HTTPS and phone access

For production, configure a hostname under your control and an HTTPS certificate trusted by the employee devices. Keep the app on loopback and use a free reverse proxy such as Caddy. A minimal Caddyfile is:

```caddyfile
workspace.your-domain.example {
    reverse_proxy 127.0.0.1:3000
}
```

Use your real DNS name. In `.env`, set the same HTTPS origin and the loopback proxy IP:

```dotenv
PUBLIC_ORIGIN=https://workspace.your-domain.example
TRUST_PROXY_IP=127.0.0.1
HOST=127.0.0.1
PORT=3000
```

Use a proxy that sets the forwarded client address itself. Keep port 3000 restricted to loopback. Expose only the proxy’s intended HTTPS listener on the office firewall. Alternatively, configure both `TLS_KEY_PATH` and `TLS_CERT_PATH` for Node to terminate HTTPS directly. Ensure the certificate covers the actual name used by phones.

On the office LAN, employees need to resolve the hostname and trust the certificate. Caddy’s internal CA can be used on managed devices once each device trusts the office CA. Public certificate issuance and remote access depend on DNS, public reachability and the network’s configuration. If the ISP uses CGNAT or blocks inbound connections, keep the service LAN-only until an authorized office VPN, public address, or approved access route is available. [Caddy HTTPS documentation](https://caddyserver.com/docs/automatic-https)

Open the HTTPS address on Android and iPhone, sign in, allow location, and perform the agreed office and shoot attendance tests. App installation is optional. Keep the app available for browser GPS updates. The Notifications page supports in-app reminders. To opt in to mobile Web Push, set `ENABLE_WEB_PUSH=1` and register the phone again on the new origin.

## Startup and backups

Use an elevated PowerShell session to register tasks under a dedicated Windows account. Give that account access to the checkout, data and backup directories. Keep it separate from the administrator’s Windows account. Windows stores the scheduled-task credentials.

```powershell
Set-Location C:\ConceptOffice\workspace
.\scripts\setup-autostart.ps1 -ServiceCredential (Get-Credential)
.\scripts\service.ps1 Start
.\scripts\health-check.ps1 -BaseUrl https://workspace.your-domain.example
```

The workspace task starts at boot and can restart after a failure. The backup task runs daily at 02:00 Windows local time. Configure the HTTPS proxy’s startup as well. Review Task Scheduler history and run a backup and restore rehearsal before relying on this configuration.

## Approved updates and optional Pages launcher

Review the commit on GitHub, schedule downtime, take the proxy out of service, and run the update script. Use the full approved commit SHA that was merged into `main`.

```powershell
.\scripts\service.ps1 Stop
.\scripts\update.ps1 -ApprovedCommit YOUR_APPROVED_COMMIT_SHA
.\scripts\service.ps1 Start
.\scripts\health-check.ps1 -BaseUrl https://workspace.your-domain.example
```

The script verifies that the full commit SHA is on `main` and backs up the database and private files before checkout. Record its printed previous commit and backup path. If dependency installation fails, the script attempts to restore the previous source and dependencies before returning an error. Keep the service stopped if either recovery step fails. An update that starts and changes the schema may require switching to the verified backup before reverting the code. [Recovery procedure](OPERATIONS.md#backup-and-recovery)

Once the office server and migrated data are verified, set the `WORKSPACE_URL` repository variable to the office HTTPS URL. In GitHub, use **Settings → Pages → GitHub Actions**. Run **Actions → Publish approved office launcher** on `main` and confirm the cutover in the workflow input. Recheck the destination, HTTPS, and sign-in before announcing the switch.

For an installation with private attachments, review `FILE_STORAGE_DIRECTORY` and `FILE_RETENTION_DAYS` in [.env.example](../.env.example). Keep each backup and its adjacent `.files` folder together. Follow the [attachment recovery steps](OPERATIONS.md#private-attachments-and-recovery) when rehearsing a restore.
