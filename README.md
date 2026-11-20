# Concept Photography Studio Workspace

An admin dashboard and employee portal for studio scheduling, location-verified attendance, work approvals, and finances.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm start
```

Open http://localhost:3000 and create the first admin account. The workspace starts empty and stores its data in `data/workforce.sqlite`. Set `DATABASE_PATH` to use another SQLite file and `PORT` to use another local port. On upgrade, the original built-in sample accounts and their work are hidden. Existing employee records can be enrolled by setting a password in **Employees**.

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

## Hosting

Serve the Node app behind HTTPS with a persistent volume for SQLite. Set `HOST=0.0.0.0` if your hosting environment requires it, and set `SECURE_COOKIES=1` for HTTPS. Configure the proxy to preserve the public Host header. Before opening a new remote workspace to users, set a strong `ADMIN_SETUP_TOKEN` as a server secret. The first-run form requires that token away from localhost. Admin setup is one-time and the token can be removed after the account is created. The server needs outbound HTTPS access to Google Maps to expand short links.

The GitHub Pages workflow publishes the sign-in entry page. Once the Node app has an HTTPS address, set **Settings → Secrets and variables → Actions → Variables → WORKSPACE_URL** to that address and rerun **Deploy GitHub Pages**. The **Open workspace sign-in** button then opens the hosted login directly. Without a default address, staff can paste their workspace URL. The Node app handles all passwords and shared records. Run `npm run build:pages` to generate the entry page in `dist/`.

## Verify

Run `npm test` to check sign-in and role permissions, scheduling, approvals, GPS attendance, reminders, financial records, and persistence across a server restart.
