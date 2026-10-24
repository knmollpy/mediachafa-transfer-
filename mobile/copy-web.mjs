import { cp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

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
