import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
const publicFiles = new URL('../public/', import.meta.url);
const packages = new URL('../node_modules/', import.meta.url);
const workspace = process.env.WORKSPACE_URL;
let link = '<p>Ask your studio admin for the workspace address.</p>';
if (workspace) {
  const url = new URL(workspace);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('WORKSPACE_URL must be an HTTPS address.');
  const href = url.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  link = `<a class="btn primary" href="${href}">Open workspace sign-in</a>`;
}

await rm(output, { recursive: true, force: true });
await mkdir(new URL('icons/', output), { recursive: true });
const entry = await readFile(new URL('pages.html', import.meta.url), 'utf8');
await writeFile(new URL('index.html', output), entry.replace('<!-- WORKSPACE_LINK -->', link));
await writeFile(new URL('.nojekyll', output), '');

await Promise.all([
  ...['styles.css', 'studio.webp'].map((asset) => cp(new URL(asset, publicFiles), new URL(asset, output))),
  cp(new URL('lucide-static/icons/camera.svg', packages), new URL('icons/camera.svg', output)),
  cp(new URL('lucide-static/LICENSE', packages), new URL('lucide-LICENSE.txt', output)),
  ...['inter', 'manrope'].flatMap((font) => [
    cp(new URL(`@fontsource-variable/${font}/files/${font}-latin-wght-normal.woff2`, packages), new URL(`${font}.woff2`, output)),
    cp(new URL(`@fontsource-variable/${font}/LICENSE`, packages), new URL(`${font}-LICENSE.txt`, output)),
  ]),
]);
