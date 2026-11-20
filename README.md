# Concept Photography Studio Workspace

An employee management MVP for scheduling studio work, tracking time on tasks, and recording attendance.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm start
```

Open http://localhost:3000. The first launch creates a SQLite database in `data/` and loads sample employees, assignments, and attendance. The profile selector switches demo employees. Use `npm test` to verify reminder timing, timer and attendance workflows, and data persistence across a restart.

## Try the workflow

1. Switch to the studio manager profile and open **Dashboard → Time Clock → Office Location**. Set the office name and GPS coordinates. Use **Use my current location** if you are at the site. The built-in office and shoot coordinates are examples.
2. Open **Team** to add employees. From **Schedule → New Task**, select **Photo shoot**, assign it to an employee, and enter the shoot’s coordinates. Use **Edit Shoot Location** on an existing shoot to update its site. The schedule uses India Standard Time.
3. Switch to the assigned employee. On the shoot card, select **Clock In at Shoot**. Shoot check-in opens 30 minutes before the scheduled start and closes at the end of the estimated duration. The Time Clock also lists eligible shoots alongside the office. Employees can clock out of an active shift at its original site after the scheduled window ends.
4. The browser requests a fresh location at check-in and check-out. Attendance requires a location reading that verifies the employee is within 100 metres of the selected site. Checking in at a shoot starts its task timer. Checking out stops it.
5. Keep the workspace open and allow location access for automatic clock changes. A reliable reading beyond the boundary clocks the employee out. Returning to the same eligible site clocks them back in and resumes shoot time. **Cancel auto return** stops that behavior. Browser and device settings can suspend location updates, including when the screen locks or the browser closes.
6. Assign yourself a task starting in the next 30 minutes to try **Notifications**. The server creates one in-app reminder per task when its start enters the 30-minute window. On a supported desktop browser, enable browser alerts on the Notifications page to receive new reminders for the selected employee while the app is open. The server needs to be running during the reminder window.

The Attendance Log shows the assigned site, the GPS readings at clock events, and automatic departures and returns. The location watcher sends a reading to the server only when the browser detects a possible clock event. Location access requires HTTPS or localhost.

## Demo scope

The workspace runs on loopback by default. The employee selector is for demonstration. The manager profile can configure sites in the demo, and real employee use requires authentication and verified account permissions. Use sample data until employee sign-in and manager permissions are added. Reminder delivery is in-app and optionally via an open desktop browser.

Set `SEED_DEMO=0` and `DATABASE_PATH` to a new SQLite file for a clean workspace. For example, `SEED_DEMO=0 DATABASE_PATH=data/clean.sqlite npm start`. Set `PORT` to use a different local port.

## GitHub Pages demo

In the GitHub repository, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Then run **Deploy GitHub Pages** from the Actions tab, or push to `main`. Once the workflow deploys, the demo is available at https://marykamalaperli.github.io/Concept-Photography/.

The Pages build packages sample records and saves changes in the browser that made them. Employees, tasks, time entries, and GPS records are local to that browser. Reminder checks run while the demo is open. The Node.js and SQLite version can still be run locally using the instructions above.

Run `npm run build:pages` to generate the static site in `dist/`.
