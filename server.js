import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { mkdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginView } from './public/access-view.js';
import { openStore } from './store.js';
import { sqliteAdapter } from './sqlite-adapter.js';
import { createApi } from './lib/workspace-api.js';
import { refreshReminders } from './lib/reminders.js';
import { createCalendar } from './lib/calendar.js';
import { createMobilePush } from './lib/mobile-push.js';
import { refreshAttendanceGaps } from './lib/attendance-gaps.js';

if (process.platform !== 'win32') process.umask(0o077);

const root = dirname(fileURLToPath(import.meta.url));
const database = process.env.DATABASE_PATH || resolve(root, 'data/workforce.sqlite');
if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
const db = sqliteAdapter(openStore(new DatabaseSync(database)));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const publicOrigin = process.env.PUBLIC_ORIGIN && new URL(process.env.PUBLIC_ORIGIN);
if (publicOrigin && (publicOrigin.href !== `${publicOrigin.origin}/` ||
    (publicOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(publicOrigin.hostname)))) {
  throw new Error('Set PUBLIC_ORIGIN to the HTTPS workspace origin with no path, query, or credentials.');
}
const keyPath = process.env.TLS_KEY_PATH;
const certPath = process.env.TLS_CERT_PATH;
if (Boolean(keyPath) !== Boolean(certPath)) throw new Error('Set both TLS_KEY_PATH and TLS_CERT_PATH for direct HTTPS.');
const secureCookies = Boolean(keyPath || publicOrigin?.protocol === 'https:' || process.env.SECURE_COOKIES === '1');
if (!keyPath && !['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error('Direct LAN access requires HTTPS. Bind a reverse-proxied workspace to loopback.');
}
const trustedProxy = process.env.TRUST_PROXY_IP;
if (trustedProxy && (!isIP(trustedProxy) || !publicOrigin || !secureCookies)) {
  throw new Error('TRUST_PROXY_IP requires a proxy IP address and an HTTPS public origin.');
}

const mobilePush = process.env.ENABLE_WEB_PUSH === '1'
  ? createMobilePush((await import('web-push')).default, process.env.WEB_PUSH_CONTACT || publicOrigin?.origin || 'https://localhost')
  : undefined;
let api;
let calendar;

const assets = new Map([
  ['/', ['public/index.html', 'text/html']],
  ['/access.css', ['public/access.css', 'text/css']],
  ['/styles.css', ['public/styles.css', 'text/css']],
  ['/hr-views.js', ['public/hr-views.js', 'text/javascript']],
  ['/hr-policy.js', ['lib/hr-policy.js', 'text/javascript']],
  ['/app.js', ['public/app.js', 'text/javascript']],
  ['/finance-report.js', ['public/finance-report.js', 'text/javascript']],
  ['/start-workspace.js', ['public/start-workspace.js', 'text/javascript']],
  ['/access-view.js', ['public/access-view.js', 'text/javascript']],
  ['/mobile-alerts.js', ['public/mobile-alerts.js', 'text/javascript']],
  ['/push-worker.js', ['public/push-worker.js', 'text/javascript']],
  ['/offline.html', ['public/offline.html', 'text/html']],
  ['/manifest.webmanifest', ['public/manifest.webmanifest', 'application/manifest+json']],
  ['/concept-logo.png', ['public/concept-logo.png', 'image/png']],
  ['/brand-mark.png', ['public/brand-mark.png', 'image/png']],
  ['/app-icon-192.png', ['public/app-icon-192.png', 'image/png']],
  ['/app-icon-512.png', ['public/app-icon-512.png', 'image/png']],
  ['/sign-in.webp', ['public/sign-in.webp', 'image/webp']],
  ['/sign-in.avif', ['public/sign-in.avif', 'image/avif']],
  ['/sign-in-logo.png', ['public/sign-in-logo.png', 'image/png']],
  ['/attendance-policy.js', ['lib/attendance-policy.js', 'text/javascript']],
  ['/studio.webp', ['public/studio.webp', 'image/webp']],
  ['/inter.woff2', ['node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'font/woff2']],
  ['/manrope.woff2', ['node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2', 'font/woff2']],
]);

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const handle = async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/healthz' && req.method === 'GET') {
      await db.get('SELECT 1');
      sendJson(res, 200, { ok: true });
      return;
    }
    const feed = path.match(/^\/calendar\/([a-f0-9]{64})\.ics$/);
    if (feed && ['GET', 'HEAD'].includes(req.method)) {
      const content = await calendar.read(db, feed[1], { track: req.method === 'GET' });
      res.writeHead(content === null ? 404 : 200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store' });
      res.end(req.method === 'HEAD' ? undefined : content ?? '');
      return;
    }
    if (path.startsWith('/api/')) {
      const forwarded = req.headers['x-forwarded-for']?.split(',').at(-1)?.trim();
      if (trustedProxy && req.socket.remoteAddress?.replace(/^::ffff:/, '') === trustedProxy && isIP(forwarded ?? '')) {
        req.clientAddress = forwarded;
      }
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
    const features = [
      /(?:^|;\s*)concept_session=[a-f0-9]{64}(?:;|$)/.test(req.headers.cookie ?? '') && '<meta name="concept-session" content="possible">',
      mobilePush && '<meta name="concept-web-push" content="enabled">',
    ].filter(Boolean).join('\n  ');
    const content = path === '/' ? source.toString('utf8')
      .replace('<!-- ACCESS_HEAD -->', `${features}\n  <link rel="stylesheet" href="./access.css">\n  <script type="module" src="./start-workspace.js"></script>`)
      .replace('<!-- SIGN_IN -->', () => loginView()) : source;
    res.writeHead(200, {
      'Content-Type': asset[1],
      'Cache-Control': path === '/' ? 'private, no-store' :
        /^(image|font)\//.test(asset[1]) ? 'public, max-age=86400' : 'no-cache',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
    if (status === 500) console.error('Request failed.', error.code ?? error.name);
    sendJson(res, status, { error: status === 500 ? 'Something went wrong. Try again.' : error.message,
      ...(status === 409 && error.conflicts ? { conflicts: error.conflicts } : {}) });
  }
};

const server = keyPath
  ? createSecureServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, handle)
  : createServer(handle);
let checkingReminders = false;
setInterval(async () => {
  if (checkingReminders) return;
  checkingReminders = true;
  try {
    await refreshReminders(db);
    await refreshAttendanceGaps(db);
    await mobilePush?.dispatch(db);
  } catch (error) {
    console.error('Could not refresh work reminders.', error.code ?? error.name);
  } finally {
    checkingReminders = false;
  }
}, 15000).unref();

server.listen(port, host, () => {
  const displayHost = host.includes(':') ? `[${host}]` : host;
  const localUrl = `${keyPath ? 'https' : 'http'}://${displayHost}:${server.address().port}`;
  calendar = createCalendar({ workspaceUrl: publicOrigin?.origin ?? localUrl });
  api = createApi(db, { secureCookies, mobilePush, calendar, siteOrigin: publicOrigin?.origin });
  console.log(`Concept Photography workspace listening on ${localUrl}`);
});
