# Office workspace operations

## Architecture and security

The Node.js server serves the branded frontend, CSS, local fonts and authorized API. SQLite keeps business records, timestamps, session hashes, and reminder delivery state on the office machine. The browser signs in on the same origin using an HttpOnly, SameSite session cookie. HTTPS additionally enforces the Secure cookie flag. Sessions expire after 12 hours. Failed login attempts are rate limited in SQLite. Changing an employee’s password or deactivating an account revokes its sessions. Private calendar tokens are stored as hashes. The admin can review recent account access events in Employees.

The API enforces employee ownership, admin authorization, JSON validation and same-origin mutation checks. An inactive user’s history remains attached to the original account. Browser GPS requires permission and a recent, accurate reading. Browser coordinates can be manipulated. Offline mode shows a generic reconnect screen and keeps private records out of the service worker cache. GPS observations are sent only when valid and online.

## Administrator workflow

1. Open **Employees** to enroll staff, reset passwords, change account access or review access history.
2. Set the authorized office coordinates in **Dashboard → Company location**. Under **Attendance → Attendance settings**, configure working minutes, the GPS grace period, office hours, and weekly leave rules. The default requirement is 480 minutes.
3. Book shoots from **Shoot calendar**. Enter coordinates or an optional Google Maps link and add extra stops as needed. Review lead and crew conflicts. Mark the shoot complete to schedule editing and a delivery deadline.
4. Use **Attendance** to review a location gap or process a time adjustment. An interrupted location check creates a review record. It leaves the shift open and does not deduct automatically from pay. Account deactivation is shown as a separate administrative closure.
5. Use **Finances** for payment due dates, overdue balances and CSV export. Monthly cash reports use the payment or expense date. Shoot balances use the shoot date and all payments attached to that shoot.
6. Use **Approvals** for work and HR requests. Publish payroll records, company holidays and announcements through their respective sections.

## Employee workflow

Sign in with your assigned account. Under **My profile**, maintain a private notepad or change your password. The notepad is available only to its owner through the application. An operator with direct access to SQLite or backups can read the stored data.

Select the office or an assigned shoot and check in with GPS. A verified departure beyond the geofence automatically closes the working interval. Returning to the same eligible pin resumes attendance unless you cancelled automatic return. Keep the page available to the browser. A locked phone or suspended tab can pause GPS. After the grace period, the workspace flags location as unverified and stores the interruption for review. It requests a fresh GPS reading as soon as feasible. Use **Notifications → Test GPS** for a device check or **Request a time change** to submit a correction.

Use **My Schedule → Connect calendar** to create a private calendar URL. Calendar clients need network access to the office URL and control their own refresh interval. Keep the subscription link private. Revoke or replace it if it was shared unintentionally.

Work reminders appear in the workspace independently of Web Push. If your admin enabled optional Web Push, register each compatible browser or installed app under **Notifications**. A test reminder checks whether the browser provider accepted the message. Delivery on a locked or offline phone depends on browser and device settings.

## Backup and recovery

From the checkout, run:

```powershell
.\scripts\backup.ps1
node .\scripts\database-backup.js verify D:\ConceptBackups\YOUR-SNAPSHOT.sqlite
.\scripts\restore.ps1 -Backup D:\ConceptBackups\YOUR-SNAPSHOT.sqlite -NewDatabase C:\ConceptPrivate\verified-recovery.sqlite
```

The online backup uses SQLite’s snapshot API. Backup rotation only applies to workspace snapshot filenames in the configured directory. Restoration always writes a new file. For production recovery, stop the workspace, retain the current database, and select the verified recovery file using `DATABASE_PATH`. Restart and run the health check and a sign-in test. For a code rollback after a schema migration, restore both the previous commit and its corresponding verified snapshot. Store at least one protected backup separately from the data drive.

## Troubleshooting

- **Cannot sign in after migration**. Verify the configured database and re-enroll the administrator under the same email. Employee password resets are available in Employees.
- **GPS unavailable on a phone**. Check the HTTPS certificate, location permission, and browser status. Compare the coordinates using Device checks.
- **Health check fails**. Use the local URL first. Check the server output, `data/logs`, or Task Scheduler history, `.env`, and the database directory permissions. Then test the proxy’s HTTPS address.
- **Calendar events lag**. Check that the calendar device can reach the office hostname and that its subscription is active. Calendar providers refresh on their own schedules.
- **Backups are missing**. Check the Windows backup task’s result, writable destination and free storage. Run a manual backup and verify the result before retrying the task.

## Daily plans, attendance and worksheets

- Employees prepare the next working day in **Daily plans** and submit it by 6:00 PM IST or before explicitly ending the shift. Holidays, the weekly day off, and approved full-day leave determine the next working day. An administrator approves the plan before it creates tasks. Use a revision before work starts and individual change requests afterwards.
- Company location accepts the primary office and up to nine additional pins. Attendance settings define separate office and shoot radii and the maximum acceptable reported GPS accuracy. An automatic departure or return requires two consistent recent samples. Keep the browser open for reliable tracking.
- The time clock supports timed lunch, personal breaks and assigned shoot travel. End shift can close attendance when GPS is unavailable. The recorded departure and any gaps, missing plan or hours shortfall go to the administrator in Approvals. Checkout and travel can also be used between locations. Employees should choose End shift when finishing the working day.
- Worksheets use Asia/Kolkata dates. Daily totals omit recorded breaks and count assigned travel only once. Weekly reports run Monday–Sunday. CSV opens in Excel, and the print view can be saved as PDF. Historical totals use current rules and approved corrections. The shift review retains the hours recorded when a shift ended.

## Projects, evidence and revenue

- Create the client, then create a project for that client and select it when booking a shoot. Upload a private file through the client or project, then attach it as a project resource to share with assigned crew and editors. Employees can see resources for their assigned project. Client administration and payment totals require administrator access.
- Set the Data Storage Manager under **Footage storage**. Select Sai's existing employee account when available. When a shoot is marked done, the system creates one verification. The assigned employee confirms transfer and storage, supplies drive and backup references and submits a PNG or JPEG screenshot. An administrator reviews the verification. Earlier completed shoots are outside automatic creation.
- A completed shoot can have amount-based or percentage-based revenue allocations for its crew and editors. Percentages round down to whole paise. Clear allocations before changing the shoot value. Contribution reports use the completion date and closed shoot or editing sessions, and leave receipt and payroll totals separate.
- Finance reports support monthly, yearly and all-time views, receipt and expense categories, client and project breakdowns, CSV and print/PDF. Cash profit always equals received payments minus expenses recorded in the report period.

## Private attachments and recovery

- The default file directory is beside the SQLite database, using the database filename followed by `.files`. To use a separate private drive, set `FILE_STORAGE_DIRECTORY` to a directory dedicated to this workspace and restrict its operating-system permissions to the service and backup accounts.
- Uploads accept PNG, JPEG and PDF, with a 10 MB limit for work files and a 3 MB limit for profile photos. Downloads require a signed-in account with access to the record. Evidence and shared resources stay attached until the corresponding workflow permits unlinking.
- Removing an attachment immediately revokes download access. Its disk copy expires after `FILE_RETENTION_DAYS` (30 by default). File deletion uses the filesystem and the backup retention schedule.
- Each backup contains a verified SQLite snapshot and, if attachments exist, an adjacent directory named by appending `.files` to the snapshot filename. Keep the pair together. Backup and restore verify attachment sizes and SHA-256 checksums.
- Run `node scripts/database-backup.js verify <backup.sqlite>` against the pair. Restore to a new SQLite file using the existing restore script. Its attachments restore into the new file’s adjacent `.files` directory. Point `DATABASE_PATH` and any custom `FILE_STORAGE_DIRECTORY` at the restored pair after verification.

## Delegated review and offline attendance

Open **Employees → Role permissions** to grant review permissions to an access role, and **Access role** on the employee’s row to assign it. Delegates use **Review queue** for daily plans, task changes and completions, attendance and leave, or footage. Permission changes apply on the employee’s next API request. Staff review permissions do not grant access to financial records, employee management or the general business audit.

If the connection drops while an employee uses End shift, the loaded tab keeps that departure request in memory and pauses GPS monitoring. Keep the tab open until it confirms delivery. The server records it with GPS unverified and with a review requirement. If the shift has already changed, the server preserves the existing record and sends the issue to the administrator. Review the attendance and business audit before applying a time correction. Closing or reloading the tab clears an unsent request.

The worksheet’s work performance panel shows facts from the selected employee and date period. A missing check-in is shown separately from approved unpaid leave. Task comparisons skip periods with confirmed leave, official travel, GPS verification gaps or task approvals and schedule changes.
