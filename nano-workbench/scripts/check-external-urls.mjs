import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}
const files = [path.join(root, 'index.html'), ...walk(path.join(root, 'js'))];
const violations = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?:src|href)=["']https?:\/\/[^"']+|fetch\(\s*["']https?:\/\//g)) {
    violations.push(`${path.relative(root, file)}: ${match[0]}`);
  }
}
if (violations.length) { console.error('Runtime external URLs found:\n' + violations.join('\n')); process.exit(1); }
console.log(`No runtime external URLs found (${files.length} files)`);
