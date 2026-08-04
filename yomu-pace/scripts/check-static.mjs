import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'index.html','styles.css','manifest.webmanifest','sw.js','js/main.js','js/app.js','js/ui.js','js/reader.js','js/chunking.js','js/markdown.js','js/storage.js',
  'vendor/budoux/budoux.js','vendor/budoux/LICENSE','icons/icon-192.png','icons/icon-512.png'
];
for (const path of required) await stat(join(root, path));

async function walk(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

const jsFiles = (await walk(root)).filter((path) => /\.(?:js|mjs)$/u.test(path));
const runtimeFiles = jsFiles.filter((file) => !file.includes('/tests/') && !file.includes('/scripts/'));

for (const file of runtimeFiles) {
  const source = await readFile(file, 'utf8');
  const importPatterns = [
    /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gu,
    /import\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ];
  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) throw new Error(`Bare/external import in ${file}: ${specifier}`);
      await stat(resolve(dirname(file), specifier));
    }
  }
}

for (const file of runtimeFiles) {
  const source = await readFile(file, 'utf8');
  if (/https?:\/\//u.test(source) && !file.endsWith('vendor/budoux/budoux.js')) {
    const allowed = source.replace(/https?:\/\/example\.com[^'"`\s)]*/gu, '');
    if (/https?:\/\//u.test(allowed)) throw new Error(`External runtime URL in ${file}`);
  }
}

const sw = await readFile(join(root, 'sw.js'), 'utf8');
for (const path of required.filter((item) => !item.includes('LICENSE'))) {
  if (!sw.includes(`./${path}`) && path !== 'sw.js') throw new Error(`Service Worker cache is missing ${path}`);
}
console.log(`Static checks passed: ${runtimeFiles.length} runtime JavaScript files`);
