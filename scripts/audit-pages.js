import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, copyFile, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../dist', import.meta.url));
const destination = resolve(process.argv[2] ?? 'lighthouse-reports');
const prefix = '/Concept-Photography/';
const categories = ['performance', 'accessibility', 'best-practices', 'seo'];
const signInInsights = ['cache-insight', 'image-delivery-insight', 'network-dependency-tree-insight', 'render-blocking-insight'];
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

async function audit(profile, output) {
  await run('npx', [
    '--yes', 'lighthouse@13.6.0', url,
    ...(profile === 'desktop' ? ['--preset=desktop'] : []),
    '--quiet', '--no-enable-error-reporting',
    `--only-categories=${categories.join(',')}`,
    '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage',
    '--output=html', '--output=json', `--output-path=${output}`,
  ], { timeout: 120_000 });
  return JSON.parse(await readFile(output + '.report.json', 'utf8'));
}

try {
  for (const profile of ['mobile', 'desktop']) {
    const output = join(destination, profile);
    const runs = profile === 'mobile' && process.env.GITHUB_ACTIONS === 'true' ? 3 : 1;
    const samples = [];
    for (let index = 1; index <= runs; index++) {
      const sample = runs === 1 ? output : `${output}-${index}`;
      samples.push({ path: sample, report: await audit(profile, sample) });
    }
    const performance = samples.map(({ report }) => report.categories.performance.score * 100);
    samples.sort((a, b) => a.report.categories.performance.score - b.report.categories.performance.score);
    const { path, report } = samples[Math.floor(runs / 2)];
    if (runs > 1) {
      await Promise.all(['html', 'json'].map((ext) => copyFile(`${path}.report.${ext}`, `${output}.report.${ext}`)));
    }
    const scores = categories.map((category) => [category, report.categories[category].score * 100]);
    const metrics = performanceMetrics.map(([id, label]) => `${label} ${report.audits[id].displayValue}`).join(', ');
    const label = runs > 1 ? `${profile} median of ${runs} (${performance.join(', ')})` : profile;
    const result = `${label}: ${scores.map(([category, score]) => `${category} ${score}`).join(', ')}. ${metrics}.`;
    console.log(result);
    if (summary) await appendFile(summary, `- ${result}\n`);
    const otherScoresPass = samples.every(({ report }) => categories.slice(1).every((id) => report.categories[id].score === 1));
    if (report.categories.performance.score !== 1 || !otherScoresPass) {
      if (summary) console.error(`::error title=Lighthouse score below 100::${result}`);
      process.exitCode = 1;
    }
    const flagged = signInInsights.filter((id) => samples.some(({ report }) => report.audits[id]?.score !== 1));
    const insightResult = flagged.length
      ? `${profile} sign-in insights still flagged: ${flagged.map((id) => report.audits[id]?.title ?? id).join(', ')}.`
      : `${profile} passed the cache lifetime, image delivery, dependency tree, and render-blocking checks.`;
    console.log(insightResult);
    if (summary) await appendFile(summary, `- ${insightResult}\n`);
    if (flagged.length) {
      if (summary) console.error(`::error title=Lighthouse sign-in insights flagged::${insightResult}`);
      for (const { path, report } of samples) {
        const dependency = report.audits['network-dependency-tree-insight'];
        if (dependency?.score !== 1) {
          const chains = dependency?.details?.items.find(({ value }) => value?.type === 'network-tree')?.value.chains;
          const urls = (nodes) => Object.values(nodes).flatMap(({ url, children }) => [url, ...urls(children)]);
          if (chains) {
            const requests = urls(chains).map((url) => url.startsWith('data:') ? url.split(',')[0] : url);
            console.error(`${summary ? '::notice title=Critical requests::' : ''}${path} ${requests.join(', ')}`);
          }
        }
      }
      process.exitCode = 1;
    }
  }
} finally {
  server.close();
}
