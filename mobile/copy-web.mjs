import { cp, mkdir, copyFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('./www/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'manifest.webmanifest', 'sw.js']) {
  await copyFile(new URL(file, root), new URL(file, output));
}
await cp(new URL('icons/', root), new URL('icons/', output), { recursive: true });
