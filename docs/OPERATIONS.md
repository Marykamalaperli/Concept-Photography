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
