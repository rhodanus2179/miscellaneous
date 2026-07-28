import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sw = await readFile(resolve(root, 'sw.js'), 'utf8');
const match = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
if (!match) throw new Error('APP_SHELL not found');
const assets = [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
for (const asset of assets) {
  if (asset === './') continue;
  const clean = asset.replace(/^\.\//, '').split('?')[0];
  await access(resolve(root, clean));
}
const modules = [...(await readFile(resolve(root, 'js/app.js'), 'utf8')).matchAll(/from '\.\/([^']+)'/g)].map(item => `js/${item[1]}`);
for (const modulePath of modules) await access(resolve(root, modulePath));
console.log(`Validated ${assets.length} cached assets and ${modules.length} app imports.`);
