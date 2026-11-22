import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { accessView, loginView, workspaceAddress } from '../public/access-view.js';

const output = new URL('../dist/', import.meta.url);
const publicFiles = new URL('../public/', import.meta.url);
const packages = new URL('../node_modules/', import.meta.url);
const brandAssets = ['concept-logo.png', 'brand-mark.png'];
const signInAssets = ['sign-in.avif', 'sign-in.webp', 'sign-in-logo.png'];

async function renderAccess(entry, slot, content, scriptName, apiOrigin) {
  const iconPath = /\.\/icons\/([a-z0-9-]+)\.svg/g;
  const icons = [...new Set([...content.matchAll(iconPath)].map(([path]) => path))];
  const dataUrl = async (base, asset, type) => `data:${type};base64,${(await readFile(new URL(asset, base))).toString('base64')}`;
  const [css, photo, logo, iconData, script, workspaceAssets] = await Promise.all([
    readFile(new URL('access.css', publicFiles), 'utf8'),
    dataUrl(publicFiles, 'sign-in.avif', 'image/avif'),
    dataUrl(publicFiles, 'sign-in-logo.png', 'image/png'),
    Promise.all(icons.map((path) => dataUrl(packages, `lucide-static/${path.slice(2)}`, 'image/svg+xml'))),
    scriptName ? build({
      entryPoints: [fileURLToPath(new URL(scriptName, publicFiles))],
      bundle: true, write: false, minify: true, format: 'esm',
    }).then(({ outputFiles }) => outputFiles[0].text) : '',
    apiOrigin ? Promise.all(['app.js', 'styles.css'].map((asset) => readFile(new URL(asset, output)))) : [],
  ]);
  const inlineIcons = new Map(icons.map((path, index) => [path, iconData[index]]));
  const body = content.replace('./sign-in.avif', photo).replace('./sign-in-logo.png', logo)
    .replace(iconPath, (path) => inlineIcons.get(path));
  const scriptHash = script ? ` 'sha256-${createHash('sha256').update(script).digest('base64')}'` : '';
  const version = workspaceAssets.length ? createHash('sha256').update(Buffer.concat(workspaceAssets)).digest('hex').slice(0, 12) : '';
  const policy = `default-src 'self'; script-src 'self'${scriptHash}; img-src 'self' data:; connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'`;
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    apiOrigin && `<meta name="concept-api" content="${apiOrigin}/functions/v1/concept-api">`,
    version && `<meta name="concept-assets" content="${version}">`,
    `<style>${css.trim()}</style>`,
    script && `<script type="module">${script}</script>`,
  ].filter(Boolean).join('\n  ');
  return entry.replace('<!-- ACCESS_HEAD -->', () => head).replace(slot, () => body);
}

function openWorkspaceView(workspace) {
  let content;
  if (workspace) {
    const href = workspaceAddress(workspace).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    content = `<a class="btn primary auth-submit" href="${href}">Open workspace sign-in
      <i class="icon" aria-hidden="true" style="--icon:url('./icons/arrow-right.svg')"></i></a>
      <p class="auth-help">Use the credentials provided by your studio admin.</p>`;
  } else {
    content = `<form id="open-workspace" class="sign-in-fields" method="dialog">
      <label>Workspace address
        <span class="auth-input">
          <i class="icon" aria-hidden="true" style="--icon:url('./icons/link.svg')"></i>
          <input name="workspaceUrl" type="url" inputmode="url" maxlength="2048"
            autocomplete="url" placeholder="https://…" aria-describedby="workspace-help" required>
        </span>
      </label>
      <p class="form-error" role="alert" hidden></p>
      <button type="submit" class="btn primary auth-submit">Open workspace sign-in
        <i class="icon" aria-hidden="true" style="--icon:url('./icons/arrow-right.svg')"></i></button>
    </form>
    <p class="auth-help" id="workspace-help">Ask your studio admin for the company workspace address.</p>
    <noscript><p class="form-error">Enable JavaScript to open a workspace from this page.</p></noscript>`;
  }
  return accessView({
    title: 'Sign in',
    description: workspace ? 'Continue to your company workspace to sign in.' : 'Enter your workspace address to reach company sign-in.',
    content,
  });
}

async function pagesApp() {
  const { url } = JSON.parse(await readFile(new URL('../supabase/project.json', import.meta.url), 'utf8'));
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) {
    throw new Error('Set a valid hosted project URL in supabase/project.json.');
  }
  const entry = (await readFile(new URL('index.html', publicFiles), 'utf8'))
    .replace('rel="manifest"', 'data-workspace-manifest');
  const assets = [
    ...brandAssets,
    ...signInAssets,
    'styles.css', 'studio.webp', 'push-worker.js', 'manifest.webmanifest', 'app-icon-192.png', 'app-icon-512.png',
  ];
  await Promise.all([
    ...assets.map((asset) => cp(new URL(asset, publicFiles), new URL(asset, output))),
    build({
      entryPoints: [fileURLToPath(new URL('app.js', publicFiles))],
      outfile: fileURLToPath(new URL('app.js', output)),
      bundle: true, minify: true, format: 'esm',
      plugins: [{
        name: 'workspace-policy-modules',
        setup(plugin) {
          plugin.onResolve({ filter: /^\.\/(attendance-policy|hr-policy)\.js$/ }, ({ path }) => ({
            path: fileURLToPath(new URL(`../supabase/functions/_shared/${path.slice(2)}`, import.meta.url)),
          }));
        },
      }],
    }),
    cp(new URL('lucide-static/icons/', packages), new URL('icons/', output), { recursive: true }),
  ]);
  return renderAccess(entry, '<!-- SIGN_IN -->', loginView(), 'start-workspace.js', url);
}

async function pagesLauncher(workspace) {
  const entry = await readFile(new URL('pages.html', import.meta.url), 'utf8');
  const assets = [...brandAssets, 'sign-in.webp'];
  await Promise.all(assets.map((asset) => cp(new URL(asset, publicFiles), new URL(asset, output))));
  return renderAccess(entry, '<!-- WORKSPACE_ACCESS -->', openWorkspaceView(workspace), workspace ? null : 'open-workspace.js');
}

await rm(output, { recursive: true, force: true });
await mkdir(new URL('icons/', output), { recursive: true });
const workspace = process.env.WORKSPACE_URL?.trim();
const html = !workspace && process.env.USE_SUPABASE === '1' ? await pagesApp() : await pagesLauncher(workspace);
await Promise.all([
  writeFile(new URL('index.html', output), html),
  writeFile(new URL('.nojekyll', output), ''),
  cp(new URL('lucide-static/LICENSE', packages), new URL('lucide-LICENSE.txt', output)),
  ...['inter', 'manrope'].flatMap((font) => [
    cp(new URL(`@fontsource-variable/${font}/files/${font}-latin-wght-normal.woff2`, packages), new URL(`${font}.woff2`, output)),
    cp(new URL(`@fontsource-variable/${font}/LICENSE`, packages), new URL(`${font}-LICENSE.txt`, output)),
  ]),
]);
