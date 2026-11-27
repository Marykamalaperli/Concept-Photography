import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { accessView, workspaceAddress } from '../public/access-view.js';

const output = new URL('../dist/', import.meta.url);
const publicFiles = new URL('../public/', import.meta.url);
const packages = new URL('../node_modules/', import.meta.url);
const brandAssets = ['concept-logo.png', 'brand-mark.png'];

async function renderAccess(entry, slot, content, scriptName) {
  const iconPath = /\.\/icons\/([a-z0-9-]+)\.svg/g;
  const icons = [...new Set([...content.matchAll(iconPath)].map(([path]) => path))];
  const dataUrl = async (base, asset, type) => `data:${type};base64,${(await readFile(new URL(asset, base))).toString('base64')}`;
  const [css, photo, logo, iconData, script] = await Promise.all([
    readFile(new URL('access.css', publicFiles), 'utf8'),
    dataUrl(publicFiles, 'sign-in.avif', 'image/avif'),
    dataUrl(publicFiles, 'sign-in-logo.png', 'image/png'),
    Promise.all(icons.map((path) => dataUrl(packages, `lucide-static/${path.slice(2)}`, 'image/svg+xml'))),
    scriptName ? build({
      entryPoints: [fileURLToPath(new URL(scriptName, publicFiles))],
      bundle: true, write: false, minify: true, format: 'esm',
    }).then(({ outputFiles }) => outputFiles[0].text) : '',
  ]);
  const inlineIcons = new Map(icons.map((path, index) => [path, iconData[index]]));
  const body = content.replace('./sign-in.avif', photo).replace('./sign-in-logo.png', logo)
    .replace(iconPath, (path) => inlineIcons.get(path));
  const scriptHash = script ? ` 'sha256-${createHash('sha256').update(script).digest('base64')}'` : '';
  const policy = `default-src 'self'; script-src 'self'${scriptHash}; img-src 'self' data:; connect-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; base-uri 'none'`;
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
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

async function pagesLauncher(workspace) {
  const entry = await readFile(new URL('pages.html', import.meta.url), 'utf8');
  const assets = [...brandAssets, 'sign-in.webp'];
  await Promise.all(assets.map((asset) => cp(new URL(asset, publicFiles), new URL(asset, output))));
  return renderAccess(entry, '<!-- WORKSPACE_ACCESS -->', openWorkspaceView(workspace), workspace ? null : 'open-workspace.js');
}

await rm(output, { recursive: true, force: true });
await mkdir(new URL('icons/', output), { recursive: true });
const workspace = process.env.WORKSPACE_URL?.trim();
const html = await pagesLauncher(workspace);
await Promise.all([
  writeFile(new URL('index.html', output), html),
  writeFile(new URL('.nojekyll', output), ''),
  cp(new URL('lucide-static/LICENSE', packages), new URL('lucide-LICENSE.txt', output)),
  ...['inter', 'manrope'].flatMap((font) => [
    cp(new URL(`@fontsource-variable/${font}/files/${font}-latin-wght-normal.woff2`, packages), new URL(`${font}.woff2`, output)),
    cp(new URL(`@fontsource-variable/${font}/LICENSE`, packages), new URL(`${font}-LICENSE.txt`, output)),
  ]),
]);
