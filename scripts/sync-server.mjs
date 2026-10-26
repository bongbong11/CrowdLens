import { copyFile, mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('server-plugin/runtime/', root), { recursive: true });
for (const file of ['core.js', 'engine.js', 'prompts.js', 'sheets.js', 'snapshot.js']) await copyFile(new URL(`src/${file}`, root), new URL(`server-plugin/runtime/${file}`, root));
await writeFile(new URL('server-plugin/runtime/package.json', root), '{"type":"module","private":true}\n');
