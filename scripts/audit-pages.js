import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../dist', import.meta.url));
const destination = resolve(process.argv[2] ?? 'lighthouse-reports');
const prefix = '/Concept-Photography/';
const categories = ['performance', 'accessibility', 'best-practices', 'seo'];
const performanceMetrics = [
  ['first-contentful-paint', 'First paint'], ['largest-contentful-paint', 'Largest paint'],
  ['speed-index', 'Speed index'], ['total-blocking-time', 'Blocking time'], ['cumulative-layout-shift', 'Layout shift'],
];
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2',
};
const compressible = new Set(['.html', '.css', '.js', '.webmanifest', '.svg']);
const run = promisify(execFile);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) return response.writeHead(404).end();
    const path = resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html');
    const extension = extname(path);
    if (!path.startsWith(root + sep) || !Object.hasOwn(types, extension)) return response.writeHead(404).end();
    const asset = await readFile(path);
    const gzip = compressible.has(extension) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '');
    const body = gzip ? gzipSync(asset) : asset;
    response.writeHead(200, {
      'Content-Type': types[extension],
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=600',
      Vary: 'Accept-Encoding',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await readFile(join(root, 'index.html'));
await mkdir(destination, { recursive: true });
await once(server.listen(0, '127.0.0.1'), 'listening');
const url = `http://127.0.0.1:${server.address().port}${prefix}`;
const summary = process.env.GITHUB_STEP_SUMMARY;

try {
  for (const profile of ['mobile', 'desktop']) {
    const output = join(destination, profile);
    await run('npx', [
      '--yes', 'lighthouse@13.6.0', url,
      ...(profile === 'desktop' ? ['--preset=desktop'] : []),
      '--quiet', '--no-enable-error-reporting',
      `--only-categories=${categories.join(',')}`,
      '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage',
      '--output=html', '--output=json', `--output-path=${output}`,
    ], { timeout: 120_000 });
    const report = JSON.parse(await readFile(output + '.report.json', 'utf8'));
    const scores = categories.map((category) => [category, report.categories[category].score * 100]);
    const metrics = performanceMetrics.map(([id, label]) => `${label} ${report.audits[id].displayValue}`).join(', ');
    const result = `${profile}: ${scores.map(([category, score]) => `${category} ${score}`).join(', ')}. ${metrics}.`;
    console.log(result);
    if (summary) await appendFile(summary, `- ${result}\n`);
    if (scores.some(([, score]) => score !== 100)) {
      if (summary) console.error(`::error title=Lighthouse score below 100::${result}`);
      process.exitCode = 1;
    }
  }
} finally {
  server.close();
}
