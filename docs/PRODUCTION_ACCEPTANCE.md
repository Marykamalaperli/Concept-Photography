# Office installation and production acceptance

Use a fresh Windows rehearsal checkout, a new SQLite path and synthetic accounts. Keep the current live workspace open for business while the rehearsal runs. Record the reviewed Git SHA, Windows and Node versions, browser and phone models, dates in IST, evidence, and the person signing off on each group. Keep passwords, private content and precise employee location readings out of shared screenshots.

## 1. Office network and Windows preflight

- [ ] Check out the published `v1.0.0-rc.1` tag and record the full SHA. Confirm the Ubuntu and Windows checks, run `npm.cmd run verify:release` locally, and save the synthetic migration reconciliation with the rehearsal record. [Release notes](RELEASE_NOTES.md) · [Branch tracker](BRANCH_TRACKER.md)
- [ ] Confirm Node.js 24 or newer, available disk space and a separate authorized backup volume. Restrict database, attachment, backup, TLS and environment files with Windows ACLs. Use a limited Windows service account and configure the computer to remain available during employee access hours.
- [ ] Install dependencies with `scripts\install.ps1` in the rehearsal checkout. Confirm its `.env` points to a new database and attachment folder. Verify the database opens after `scripts\start-server.ps1` and `scripts\health-check.ps1` pass. Compare existing production database and attachment paths before proceeding.
- [ ] Use `Get-NetIPConfiguration` and the router to confirm the machine's LAN IP and gateway. Assign a DHCP reservation. Test the rehearsal hostname and port using `Resolve-DnsName` and `Test-NetConnection <hostname> -Port 443` from another LAN device.
- [ ] Compare the router's WAN address to the address reported by the ISP. Private WAN ranges, including `100.64.0.0/10`, or a mismatch warrant an ISP check for CGNAT or upstream NAT. For remote access, use a supported public connection or an approved office VPN. A tunnel is optional. Limit firewall and forwarding rules to the deployment's HTTPS proxy and certificate needs. Keep the internal Node port on loopback.
- [ ] Confirm the hostname and certificate chain are trusted by employee devices. Verify the configured `PUBLIC_ORIGIN` and the dedicated proxy address. Check LAN access and remote access from mobile data separately. If the router cannot serve its public hostname internally, use split DNS or the approved VPN route.
- [ ] Register the startup and backup tasks under the dedicated account. Start, stop and restart with `scripts\service.ps1`. Reboot Windows, wait for health checks and sign in again. In the rehearsal, arrange a controlled service failure and verify Task Scheduler recovery and logs. Verify the HTTPS proxy also starts unattended.

[Windows setup](INSTALLATION.md) · [Safe operations and recovery](OPERATIONS.md)

## 2. Real accounts and employee devices

- [ ] Provision the first administrator in the office database using `npm.cmd run create-local-admin -- ADMIN-EMAIL`. Log in and confirm access to employees, settings, finance, projects, and audit. Create a limited rehearsal employee and verify sign-in, sign-out, deactivation, password reset, and access revocation in an existing session.
- [ ] Sign in with one authorized real administrator and one authorized real employee after importing the verified copy. Check current schedules, assignments, history and the account's own worksheet. Confirm a delegate can see an assigned project's records and loses access when the grant is removed.
- [ ] Install the website from Chrome on Android and from Safari's Share menu on iPhone. Test both the installed app and the browser, then check navigation, calendar, large text, VoiceOver or TalkBack, and a representative employee workflow with a keyboard or assistive technology.
- [ ] Allow, deny and revoke GPS permission at the office. Confirm clear guidance and an interruption review after the configured grace period. With GPS available and the app active, check in and out at the office. Walk beyond its configured boundary, wait for confirmed departure, return, and verify automatic check-in. Try an inaccurate location reading and an unassigned shoot. Test each authorized pin of a real outdoor shoot with the assigned employee. Record arrival, departure and once-only interval creation.
- [ ] Start official shoot travel, arrive at the assigned shoot, and check in. Reconcile travel, lunch, personal breaks, GPS gaps, manual corrections and overnight attendance against the employee and manager worksheet views. Check policy versions on adjacent days.
- [ ] Repeat movement with the phone locked, the tab backgrounded and the app closed. Record behavior separately for Android and iPhone. Browsers may suspend GPS in those states. Verify the unverified gap and employee-reported departure workflow. Staff may need to reopen the app to confirm a departure or return.
- [ ] Enable mobile reminders on each approved device. Schedule a rehearsal shoot far enough ahead to confirm the reminder arrives around 30 minutes before the start. Test notifications with the app open and closed, focus/do-not-disturb settings, device opt-in, Google Calendar or Outlook subscription, and reassignment. Calendar refresh and OS push delivery depend on each provider.
- [ ] Disconnect an active employee, report End shift, and confirm the device stores the report. Reconnect under a different account and verify isolation. Sign the original employee back in, verify one recorded departure or a reviewable conflict, and compare that result with the worksheet. Repeat with a work log and schedule draft.

## 3. Backups, import and cutover

- [ ] Run a scheduled and manual backup. Verify the timestamp, retention setting, protected backup location, and matching `.files` directory when the database has attachments. Restore to a separate path, run `node scripts/database-backup.js verify <restored-file>`, open the restored database, and verify active records and an attachment download. Keep the backup and restore audit evidence.
- [ ] Run the legacy dry run on a dedicated authorized export, reconcile counts per table, then import into a new office SQLite file. Compare booked, received and spent amounts down to the paise and sample partial payments, outstanding balances, expense categories, staff records and assignments. Run SQLite integrity and foreign-key checks and document discrepancies before approval. Protect and dispose of temporary exports according to the studio's data policy.
- [ ] Rehearse final switching and rollback with synthetic data. During the approved production window, briefly pause writes, take a verified source backup and final export, repeat reconciliation, and confirm accounts, HTTPS, attendance, records and backups in the new system. Resume writes only after the acceptance owner signs off. Publish the optional Pages launcher only after final office HTTPS approval.
- [ ] If acceptance fails before writes resume, route users back to the previous service and preserve the new copy for diagnosis. If writes have resumed, pause both services, preserve verified backups of both sides and reconcile the new records before changing routes. Keep the legacy Supabase service available until the owner approves retirement separately.

[Migration and financial reconciliation](MIGRATION.md) · [Cutover and rollback](OPERATIONS.md)

## Sign-off

| Acceptance group | Owner | Result and evidence |
| --- | --- | --- |
| Windows, LAN, HTTPS and remote access | | |
| Android, iPhone, GPS and reminders | | |
| Access, backup and recovery | | |
| Data, financial reconciliation and cutover | | |

Development evidence comes from temporary SQLite databases and simulated browser devices. Office networking, scheduled-task behavior on the studio computer, real phones, authorized production import and production cutover are recorded here during acceptance.
