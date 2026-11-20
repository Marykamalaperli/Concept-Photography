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

1. Open **Team** and add an employee.
2. Choose **New Task**, assign it, and set the start time, location, and estimated duration. The schedule uses India Standard Time.
3. Switch to the assigned employee to start, pause, resume, or complete the task. **Tasks** shows both estimated and tracked time.
4. Use **Time Clock** to clock in and out. Each action requests the browser’s location and records the timestamp, coordinates, and reported accuracy. Location capture requires HTTPS or localhost and permission from the browser.
5. Assign yourself a task starting in the next 30 minutes to try **Notifications**. The server creates one in-app reminder per task when its start enters the 30-minute window. On a supported desktop browser, enable browser alerts on the Notifications page to receive new reminders for the selected employee while the app is open. The server needs to be running during the reminder window.

## Demo scope

The workspace runs on loopback by default. The employee selector is for demonstration and provides no authentication or access control. Use sample data until employee sign-in and manager permissions are added. Reminder delivery is in-app and optionally via an open desktop browser.

Set `SEED_DEMO=0` and `DATABASE_PATH` to a new SQLite file for a clean workspace. For example, `SEED_DEMO=0 DATABASE_PATH=data/clean.sqlite npm start`. Set `PORT` to use a different local port.

## GitHub Pages demo

In the GitHub repository, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Then run **Deploy GitHub Pages** from the Actions tab, or push to `main`. Once the workflow deploys, the demo is available at https://marykamalaperli.github.io/Concept-Photography/.

The Pages build packages sample records and saves changes in the browser that made them. Employees, tasks, time entries, and GPS records are local to that browser. Reminder checks run while the demo is open. The Node.js and SQLite version can still be run locally using the instructions above.

Run `npm run build:pages` to generate the static site in `dist/`.
