import { cp, mkdir, copyFile, readFile, writeFile, readdir, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('./www/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['manifest.webmanifest', 'sw.js']) await copyFile(new URL(file, root), new URL(file, output));
await cp(new URL('icons/', root), new URL('icons/', output), { recursive: true });
await copyFile(new URL('mobile/native-ui.css', root), new URL('native-ui.css', output));
const [source, nativeRuntime] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('mobile/native-ui.js', root), 'utf8')
]);
let mobilePage = source.replace('</head>', '<script>window.MEDIA_NATIVE_APP=true;</script><link rel="stylesheet" href="/native-ui.css"></head>');
const closingScript = mobilePage.lastIndexOf('</script>');
if (closingScript < 0) throw new Error('No se encontró el script principal de MediaChafa.');
mobilePage = mobilePage.slice(0, closingScript) + '\n' + nativeRuntime + '\n' + mobilePage.slice(closingScript);
await writeFile(new URL('index.html', output), mobilePage);

async function installAndroidLauncherIcon() {
  const resources = new URL('./android/app/src/main/res/', root);
  let folders;
  try { folders = await readdir(resources); } catch { return; }
  if (!folders.length) return;

  const svg = await readFile(new URL('icons/app.svg', root), 'utf8');
  const encoded = svg.match(/href="data:image\/jpeg;base64,([^"\s]+)"/)?.[1];
  if (!encoded) throw new Error('El ícono de MediaChafa no contiene la imagen JPEG esperada.');
  const photo = Buffer.from(encoded, 'base64');
  if (photo.length < 1000) throw new Error('La imagen del ícono de MediaChafa está incompleta.');

  const names = ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground'];
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    const directory = new URL(`mipmap-${density}/`, resources);
    await mkdir(directory, { recursive: true });
    for (const file of await readdir(directory)) {
      if (names.includes(file.replace(/\.[^.]+$/, ''))) await rm(new URL(file, directory));
    }
    for (const name of names) await writeFile(new URL(`${name}.jpg`, directory), photo);
  }

  const adaptive = new URL('mipmap-anydpi-v26/', resources);
  await mkdir(adaptive, { recursive: true });
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n`;
  await writeFile(new URL('ic_launcher.xml', adaptive), xml);
  await writeFile(new URL('ic_launcher_round.xml', adaptive), xml);
  const values = new URL('values/', resources);
  await mkdir(values, { recursive: true });
  await writeFile(new URL('ic_launcher_background.xml', values), '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#070b21</color></resources>\n');
}

await installAndroidLauncherIcon();
