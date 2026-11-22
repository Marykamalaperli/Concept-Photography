import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginView } from './public/access-view.js';
import { openStore } from './store.js';
import { sqliteAdapter } from './sqlite-adapter.js';
import { createApi } from './supabase/functions/_shared/workspace-api.js';
import { refreshReminders } from './supabase/functions/_shared/reminders.js';

const root = dirname(fileURLToPath(import.meta.url));
const database = process.env.DATABASE_PATH || resolve(root, 'data/workforce.sqlite');
if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
const db = sqliteAdapter(openStore(new DatabaseSync(database)));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);

const api = createApi(db, {
  secureCookies: process.env.SECURE_COOKIES === '1',
});

const assets = new Map([
  ['/', ['public/index.html', 'text/html']],
  ['/access.css', ['public/access.css', 'text/css']],
  ['/styles.css', ['public/styles.css', 'text/css']],
  ['/hr-views.js', ['public/hr-views.js', 'text/javascript']],
  ['/hr-policy.js', ['supabase/functions/_shared/hr-policy.js', 'text/javascript']],
  ['/app.js', ['public/app.js', 'text/javascript']],
  ['/start-workspace.js', ['public/start-workspace.js', 'text/javascript']],
  ['/access-view.js', ['public/access-view.js', 'text/javascript']],
  ['/mobile-alerts.js', ['public/mobile-alerts.js', 'text/javascript']],
  ['/push-worker.js', ['public/push-worker.js', 'text/javascript']],
  ['/manifest.webmanifest', ['public/manifest.webmanifest', 'application/manifest+json']],
  ['/concept-logo.png', ['public/concept-logo.png', 'image/png']],
  ['/brand-mark.png', ['public/brand-mark.png', 'image/png']],
  ['/app-icon-192.png', ['public/app-icon-192.png', 'image/png']],
  ['/app-icon-512.png', ['public/app-icon-512.png', 'image/png']],
  ['/sign-in.webp', ['public/sign-in.webp', 'image/webp']],
  ['/sign-in.avif', ['public/sign-in.avif', 'image/avif']],
  ['/sign-in-logo.png', ['public/sign-in-logo.png', 'image/png']],
  ['/attendance-policy.js', ['supabase/functions/_shared/attendance-policy.js', 'text/javascript']],
  ['/studio.webp', ['public/studio.webp', 'image/webp']],
  ['/inter.woff2', ['node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'font/woff2']],
  ['/manrope.woff2', ['node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2', 'font/woff2']],
]);

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      const payload = await api(req, res, path);
      sendJson(res, 200, payload);
      return;
    }
    const icon = path.match(/^\/icons\/([a-z0-9-]+)\.svg$/);
    const asset = assets.get(path) || (icon && [`node_modules/lucide-static/icons/${icon[1]}.svg`, 'image/svg+xml']);
    if (!asset || !['GET', 'HEAD'].includes(req.method)) {
      sendJson(res, 404, { error: 'Page not found.' });
      return;
    }
    const source = await readFile(resolve(root, asset[0]));
    const content = path === '/' ? source.toString('utf8')
      .replace('<!-- ACCESS_HEAD -->', '<link rel="stylesheet" href="./access.css">\n  <script type="module" src="./start-workspace.js"></script>')
      .replace('<!-- SIGN_IN -->', () => loginView()) : source;
    res.writeHead(200, {
      'Content-Type': asset[1],
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
    if (status === 500) console.error(error);
    sendJson(res, status, { error: status === 500 ? 'Something went wrong. Try again.' : error.message });
  }
});

setInterval(() => {
  refreshReminders(db).catch((error) => console.error('Could not refresh work reminders.', error));
}, 15000).unref();

server.listen(port, host, () => console.log(`Concept Photography workspace listening on http://${host}:${server.address().port}`));
