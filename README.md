# Concept Photography Studio Workspace

An admin dashboard and employee portal for studio scheduling, location-verified attendance, work approvals, and finances.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm start
```

Create or update the local development admin with `npm run create-local-admin -- admin@example.com`. Enter the password at the terminal prompt, then sign in at http://localhost:3000. The workspace starts empty and stores its data in `data/workforce.sqlite`. Set `DATABASE_PATH` to use another SQLite file and `PORT` to use another local port. On upgrade, the original built-in sample accounts and their work are hidden. Existing employee records can be enrolled by setting a password in **Employees**.

## Admin workflow

1. Under **Dashboard → Company location**, paste the office’s Google Maps link and save the location. Share links that resolve to a GPS pin fill the coordinates automatically. If a link only contains a place name or its redirect is unavailable, drop a pin in Maps and share it or enter its latitude and longitude. The office geofence is 100 metres. Use **Open in Google Maps** to open a saved office or shoot pin.
2. Under **Employees**, add each person, set their company sign-in email and password, and share the credentials privately. Use **Edit employee** to update a profile or reset its password. A password reset or email change ends current sessions.
3. Under **Shoot calendar → Book shoot**, enter the shoot name, client, Maps link, **From** and **To** times in IST, and expected income. For a shoot with more than one stop, check **Multiple shoot locations** below the main Google Maps field and add a link for each additional stop. Review any crew bookings or approved leave that overlap before saving. The end can fall on the next date for a booking of up to 24 hours. After marking a shoot done, use **Schedule editing** to assign an editor, set the editing times and delivery deadline, and view progress on the shoot. Use **Edit schedule** to correct the original booking.
4. Assign work directly to an employee to put it in the priority section of their schedule. Choose **Open for employee requests** to let employees apply. Employees see basic opportunity information until an admin approves a request, which assigns the work and shares its details.
5. Under **Finances**, record full or partial payments against shoots, set due dates, and add company expenses. Choose a month to review shoots by schedule date and cash by transaction date. Use **Overdue payments** for unpaid balances due before today and **Export CSV** to download the report. Cash profit is receipts minus recorded expenses. Amounts are in INR.
6. Use **Clients** to review owner contacts and client notes. Use **Schedule** and **Attendance** to review employees’ assignments, tracked work, and clock records.

## Employee workflow

Sign in with the credentials from the admin. **My Schedule** shows assigned work first, with a **Priority** badge. **Available Work** shows open opportunities and the status of any requests.

Clock in and out at the office or an assigned shoot with a fresh GPS reading. Shoot check-in opens 30 minutes before the start and ends after the scheduled duration. For a shoot with several locations, select the shoot and GPS checks the nearest saved pin. Clock-out remains available at the pin where you checked in. Attendance requires a reading within 100 metres that meets the browser accuracy check. At a shoot, clocking in also starts the work timer and clocking out stops it.

Keep the workspace open and allow location access for automatic departures and returns. A reliable reading outside the geofence clocks you out. Returning to the same eligible site clocks you back in. **Cancel auto return** ends that waiting state. A locked screen, suspended tab, or closed browser can interrupt the updates. Location access requires HTTPS or localhost.

Open **Notifications → Enable mobile alerts** on each phone and grant permission. On an iPhone or iPad, use Safari’s **Share → Add to Home Screen**, then sign in from the installed app and enable alerts there. On Android, enable alerts in a supported browser such as Chrome.

Under **Notifications → Device checks**, test GPS at the office or an assigned shoot without making an attendance entry. Once mobile alerts are enabled on the phone, use **Send test reminder** and check the phone for the notification.

The hosted workspace checks schedules every minute and sends a push around 30 minutes before assigned work starts. Assignments added inside that window are picked up on the next check. Push can arrive while the workspace is closed. Use **Disable mobile alerts** or sign out to stop alerts on that device. Delivery time depends on the phone’s connection and notification settings. The Notifications page also keeps the in-app reminders.

### Subscribe to your assigned work

In the hosted workspace, open **My Schedule → Connect calendar → Create private link**. Copy the link and subscribe in the calendar account associated with your work email. In Google Calendar, use **Other calendars → From URL** on the web. In Outlook, use **Add calendar → Subscribe from web**. In Apple Calendar, use **Open Apple Calendar** or paste the URL into a new subscription.

Each feed includes only work assigned to that employee and uses the scheduled start and duration. Calendar providers check for changes on their own refresh schedules. Keep the link private. Replacing or disabling a link stops access through the previous URL. Admins can see feed activity in the employee directory.

## Employee dashboard

Staff can check in and out from the dashboard, review the last 14 days or a selected month under **Attendance**, and submit corrections. Admins approve requests in **Approvals**. Approved times appear in the daily report while verified GPS records stay available. Set an employee’s employment start date to include eligible past days in absence totals.

Use **Attendance → Attendance settings** to set office hours, the weekly day off, and monthly casual leave. The initial settings use Sunday as the weekly day off and award two casual days per month. Use **Leave & holidays** to enter company holidays. Employees can request full-day, half-day, and unpaid leave. Approved leave uses the configured allowance and excludes weekly days off and holidays.

Admins can book shoots with a lead and optional crew in **Shoot calendar**. Each assigned person sees the booking, receives their own reminders, and can check in at the shoot. Postponed shoots stay in the rescheduling list until rebooked. Use **Tasks** for individual work, **Work log** for timers and manual notes, **Payslips** to publish private pay records, and **Announcements** to send updates inside the workspace.

## Connect the GitHub Pages site to Supabase

The Pages build points to the project in [supabase/project.json](supabase/project.json). Supabase Postgres holds the shared studio records and the `concept-api` Edge Function handles account creation, sign-in, and permissions. Admins sign in through Supabase Authentication. Employees use the credentials the admin creates in the workspace. The private database schema is accessible through the function, and the website bundle contains only its public URL.

1. In the GitHub repository, open **Settings → Secrets and variables → Actions → Secrets**. Add the following repository secrets. Keep the values in GitHub Secrets or Supabase secrets.

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_ACCESS_TOKEN` | A Supabase access token from the account that can manage the project. |
   | `SUPABASE_DB_PASSWORD` | The project’s Postgres database password. |

2. Run **Actions → Deploy Supabase backend → Run workflow** on `main`. It applies migrations, sets the allowed website origin, deploys the function, and verifies sign-in and the scheduled push worker.
3. In **Supabase → Authentication → Users**, use **Add user** to create the admin with an email and password. Enable **Auto Confirm User** when creating it.
4. In the project’s **SQL Editor**, authorize that Auth user as the studio admin. Replace the example email with the email you just created.

   ```sql
   select concept.authorize_admin('admin@example.com');
   ```

5. Sign in with the admin email and password. [Open Concept Photography](https://marykamalaperli.github.io/Concept-Photography/)

Authorizing a Supabase user preserves the existing admin profile and studio records. Re-run the SQL statement after changing the admin email in Supabase or transferring admin access. The authorization step ends the previous admin sessions. Employees continue signing in with their existing workspace accounts.

The live Pages build uses `USE_SUPABASE=1`. Run `USE_SUPABASE=1 npm run build:pages` to reproduce it in `dist/`. A configured `WORKSPACE_URL` repository variable overrides Supabase and retains the standalone Node sign-in link. Remove the override and rerun **Deploy GitHub Pages** to use Supabase instead.

The local Node app uses SQLite. To host it separately, serve it behind HTTPS with a persistent SQLite volume and set `SECURE_COOKIES=1`. The reverse proxy must preserve the public Host header.

## Verify

GitHub Pages builds publish desktop and mobile Lighthouse reports as the **lighthouse-sign-in-reports** artifact. Before deployment, the desktop and median mobile performance scores must be 100. Every run must also score 100 for accessibility, best practices, and SEO and pass the cache lifetime, image delivery, dependency tree, and render-blocking checks. The artifact includes all three mobile samples.

With Chrome installed, run `USE_SUPABASE=1 npm run build:pages` and `node scripts/audit-pages.js` to write the HTML and JSON reports to `lighthouse-reports/` locally.

Run `npm test` to check sign-in and role permissions, scheduling, approvals, GPS attendance, reminders, financial records, and persistence across a server restart.
