import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const assetsMatch = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!assetsMatch) throw new Error('ASSETS list not found');
const assets = [...assetsMatch[1].matchAll(/['"](\.\/[^'"]+)['"]/g)].map((m) => m[1]);
const missing = assets.filter((item) => item !== './' && !fs.existsSync(path.join(root, item.slice(2))));
if (missing.length) { console.error('Missing SW assets:', missing); process.exit(1); }
console.log(`Service Worker assets OK (${assets.length})`);
