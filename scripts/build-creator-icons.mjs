// MIT License. Copyright (c) 2026 Valhallab SASU.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('lucide-static/package.json'));
const { version } = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const names = {
  file: 'file',
  code: 'file-code-2',
  folder: 'folder',
  newFile: 'file-plus-2',
  newFolder: 'folder-plus',
  rename: 'pencil',
  trash: 'trash-2',
  collapse: 'copy-minus',
  check: 'check',
  close: 'x',
  chevron: 'chevron-right',
  refresh: 'refresh-cw',
  move: 'grip',
};
const icons = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) => {
  // Keep the official drawing and stroke attributes intact. Only add accessibility metadata.
  const svg = (await readFile(join(source, 'icons', `${name}.svg`), 'utf8'))
    .replace('<svg', '<svg aria-hidden="true" focusable="false"').trim();
  return [key, svg];
})));
const preview = join(root, 'tools/creator-kit/preview/index.html');
const html = await readFile(preview, 'utf8');
if (!html.includes('<button id="reload"')) throw new Error('Preview refresh button is missing');
let updated = html;
for (const [id, icon] of [['reload', 'refresh'], ['widget-move', 'move']]) {
  updated = updated.replace(new RegExp(`(<button id="${id}"[^>]*>)[\\s\\S]*?</button>`), (_match, opening) => `${opening}${icons[icon]}</button>`);
}
await writeFile(preview, updated);
const license = await readFile(join(source, 'LICENSE'));
for (const folder of ['tools/creator-kit/preview']) {
  await writeFile(join(root, folder, 'lucide-LICENSE.txt'), license);
}
console.log(`Creator icons generated from lucide-static ${version}.`);
