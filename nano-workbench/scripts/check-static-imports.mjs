import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const queue = [path.join(root, 'js', 'main.js')];
const seen = new Set();
const missing = [];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/(?:from\s+|import\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
    const resolved = path.resolve(path.dirname(file), match[1]);
    if (!fs.existsSync(resolved)) missing.push(`${path.relative(root, file)} -> ${match[1]}`);
    else if (resolved.endsWith('.js')) queue.push(resolved);
  }
}
if (missing.length) {
  console.error('Missing static imports:\n' + missing.join('\n'));
  process.exit(1);
}
console.log(`Static imports OK (${seen.size} modules)`);
