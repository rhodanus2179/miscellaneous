import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['index.html', ...fs.readdirSync(path.join(root, 'js')).filter((x) => x.endsWith('.js')).map((x) => `js/${x}`)];
const violations = [];
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const match of text.matchAll(/(?:src|href)=["']https?:\/\/[^"']+|fetch\(\s*["']https?:\/\//g)) violations.push(`${rel}: ${match[0]}`);
}
if (violations.length) { console.error('Runtime external URLs found:\n' + violations.join('\n')); process.exit(1); }
console.log('No runtime external URLs found');
