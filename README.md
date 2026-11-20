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

1. Under **Dashboard → Company location**, paste the office’s Google Maps link and save the location. Share links that resolve to a GPS pin fill the coordinates automatically. If a link only contains a place name or its redirect is unavailable, drop a pin in Maps and share it or enter its latitude and longitude. The office geofence is 100 metres.
2. Under **Employees**, add each person, set their company sign-in email and password, and share the credentials privately. Use **Edit employee** to update a profile or reset its password. A password reset or email change ends current sessions.
3. Under **Schedule → Schedule shoot**, enter the shoot name, client name and mobile number, Maps link, date, time, duration, and expected income. You can use an existing client or create one during scheduling. Times are in India Standard Time.
4. Assign work directly to an employee to put it in the priority section of their schedule. Choose **Open for employee requests** to let employees apply. Employees see basic opportunity information until an admin approves a request, which assigns the work and shares its details.
5. Under **Finances**, record full or partial payments against shoots and add company expenses. Edit a payment or expense in its history to correct an entry. Shoot balances show expected income, receipts, and outstanding payments. Cash profit to date is receipts minus recorded expenses. Amounts are in INR.
6. Use **Clients** to review owner contacts and client notes. Use **Schedule** and **Attendance** to review employees’ assignments, tracked work, and clock records.

## Employee workflow

Sign in with the credentials from the admin. **My Schedule** shows assigned work first, with a **Priority** badge. **Available Work** shows open opportunities and the status of any requests.

Clock in and out at the office or an assigned shoot with a fresh GPS reading. Shoot check-in opens 30 minutes before the start and ends after the scheduled duration. Clock-out remains available at the original site. Attendance requires a reading within 100 metres that meets the browser accuracy check. At a shoot, clocking in also starts the work timer and clocking out stops it.

Keep the workspace open and allow location access for automatic departures and returns. A reliable reading outside the geofence clocks you out. Returning to the same eligible site clocks you back in. **Cancel auto return** ends that waiting state. A locked screen, suspended tab, or closed browser can interrupt the updates. Location access requires HTTPS or localhost.

Scheduled work creates an in-app reminder when its start enters the 30-minute window while the server is running. Supported desktop browsers can also show alerts while the app is open.

## Connect the GitHub Pages site to Supabase

The Pages build points to the project in [supabase/project.json](supabase/project.json). Supabase Postgres holds the shared studio records and the `concept-api` Edge Function handles account creation, sign-in, and permissions. Admins sign in through Supabase Authentication. Employees use the credentials the admin creates in the workspace. The private database schema is accessible through the function, and the website bundle contains only its public URL.

1. In the GitHub repository, open **Settings → Secrets and variables → Actions → Secrets**. Add the following repository secrets. Keep the values in GitHub Secrets or Supabase secrets.

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_ACCESS_TOKEN` | A Supabase access token from the account that can manage the project. |
   | `SUPABASE_DB_PASSWORD` | The project’s Postgres database password. |

2. Run **Actions → Deploy Supabase backend → Run workflow** on `main`. It applies the database migration, sets the allowed website origin, deploys the function, and checks the session endpoint.
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

Run `npm test` to check sign-in and role permissions, scheduling, approvals, GPS attendance, reminders, financial records, and persistence across a server restart.
