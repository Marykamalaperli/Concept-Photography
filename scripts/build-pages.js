import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../store.js';

const output = new URL('../dist/', import.meta.url);
const publicFiles = new URL('../public/', import.meta.url);
const packages = new URL('../node_modules/', import.meta.url);

await mkdir(output, { recursive: true });
const entry = await readFile(new URL('index.html', publicFiles), 'utf8');
await writeFile(new URL('index.html', output), entry.replace('</head>', '  <meta name="concept-mode" content="pages">\n</head>'));
await writeFile(new URL('.nojekyll', output), '');

await Promise.all([
  ...['app.js', 'styles.css', 'studio.webp', 'pages-demo.js', 'attendance-policy.js'].map((asset) =>
    cp(new URL(asset, publicFiles), new URL(asset, output))),
  cp(new URL('lucide-static/icons/', packages), new URL('icons/', output), { recursive: true }),
  cp(new URL('lucide-static/LICENSE', packages), new URL('lucide-LICENSE.txt', output)),
  ...['inter', 'manrope'].flatMap((font) => [
    cp(new URL(`@fontsource-variable/${font}/files/${font}-latin-wght-normal.woff2`, packages), new URL(`${font}.woff2`, output)),
    cp(new URL(`@fontsource-variable/${font}/LICENSE`, packages), new URL(`${font}-LICENSE.txt`, output)),
  ]),
]);

// Generate fixtures exclusively from the built-in sample data.
const anchor = Date.parse('2026-01-01T00:00:00+05:30');
const attendanceAnchor = anchor + 13 * 60 * 60_000;
const db = openStore(new DatabaseSync(':memory:'), { seed: true, now: attendanceAnchor });
const fixture = {
  anchor,
  attendanceAnchor,
  office: db.prepare('SELECT name, latitude, longitude FROM office WHERE id = 1').get(),
  employees: db.prepare('SELECT * FROM employees ORDER BY id').all(),
  tasks: db.prepare('SELECT * FROM tasks ORDER BY start_at, id').all(),
  sessions: db.prepare('SELECT * FROM task_sessions ORDER BY start_at DESC').all(),
  attendance: db.prepare('SELECT * FROM attendance ORDER BY clock_in DESC').all(),
};
db.close();
await writeFile(new URL('demo-data.json', output), JSON.stringify(fixture));
