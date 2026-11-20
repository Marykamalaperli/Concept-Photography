import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { accessView, workspaceAddress } from '../public/access-view.js';

const output = new URL('../dist/', import.meta.url);
const publicFiles = new URL('../public/', import.meta.url);
const packages = new URL('../node_modules/', import.meta.url);
const workspace = process.env.WORKSPACE_URL?.trim();
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

await rm(output, { recursive: true, force: true });
await mkdir(new URL('icons/', output), { recursive: true });
const entry = await readFile(new URL('pages.html', import.meta.url), 'utf8');
const html = entry.replace('<!-- WORKSPACE_ACCESS -->', () => accessView({
  title: 'Sign in',
  description: workspace ? 'Continue to your company workspace to sign in.' : 'Enter your workspace address to reach company sign-in.',
  content,
})).replace('<!-- WORKSPACE_SCRIPT -->', workspace ? '' : '<script type="module" src="./open-workspace.js"></script>');
await writeFile(new URL('index.html', output), html);
await writeFile(new URL('.nojekyll', output), '');

await Promise.all([
  ...['styles.css', 'sign-in.webp', ...(workspace ? [] : ['open-workspace.js', 'access-view.js'])]
    .map((asset) => cp(new URL(asset, publicFiles), new URL(asset, output))),
  ...['camera', 'key-round', 'arrow-right', ...(workspace ? [] : ['link'])].map((icon) =>
    cp(new URL(`lucide-static/icons/${icon}.svg`, packages), new URL(`icons/${icon}.svg`, output))),
  cp(new URL('lucide-static/LICENSE', packages), new URL('lucide-LICENSE.txt', output)),
  ...['inter', 'manrope'].flatMap((font) => [
    cp(new URL(`@fontsource-variable/${font}/files/${font}-latin-wght-normal.woff2`, packages), new URL(`${font}.woff2`, output)),
    cp(new URL(`@fontsource-variable/${font}/LICENSE`, packages), new URL(`${font}-LICENSE.txt`, output)),
  ]),
]);
