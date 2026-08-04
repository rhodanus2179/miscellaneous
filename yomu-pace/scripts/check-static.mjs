import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'index.html','styles.css','manifest.webmanifest','sw.js','js/main.js','js/app.js','js/ui.js','js/reader.js','js/chunking.js','js/markdown.js','js/storage.js',
  'vendor/budoux/budoux.js','vendor/budoux/LICENSE','icons/icon.svg'
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

async function exportedNames(modulePath) {
  const source = await readFile(modulePath, 'utf8');
  const names = new Set();
  const declarationPatterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gu,
    /export\s+class\s+([A-Za-z_$][\w$]*)/gu,
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gu,
  ];
  for (const pattern of declarationPatterns) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/gu)) {
    for (const item of match[1].split(',')) {
      const parts = item.trim().split(/\s+as\s+/u);
      if (parts[1]) names.add(parts[1].trim());
      else if (parts[0]) names.add(parts[0].trim());
    }
  }
  return names;
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

  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gu)) {
    const target = resolve(dirname(file), match[2]);
    const available = await exportedNames(target);
    for (const item of match[1].split(',')) {
      const importedName = item.trim().split(/\s+as\s+/u)[0]?.trim();
      if (importedName && !available.has(importedName)) {
        throw new Error(`Missing named export ${importedName} in ${target}, imported by ${file}`);
      }
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
