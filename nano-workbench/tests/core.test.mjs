import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../js/markdown.js';
import { promptMessage, normalizeAiError } from '../js/ai.js';
import { formatBytes, formatDuration } from '../js/utils.js';

globalThis.location = new URL('https://example.test/nano-workbench/');

test('markdown escapes raw HTML', () => {
  const html = renderMarkdown('<script>alert(1)</script>');
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('markdown blocks javascript URLs', () => {
  const html = renderMarkdown('[x](javascript:alert(1))');
  assert.doesNotMatch(html, /javascript:/i);
});

test('markdown renders code fences safely', () => {
  const html = renderMarkdown('```html\n<img onerror=alert(1)>\n```');
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
});

test('promptMessage creates multimodal payload', () => {
  const blob = new Blob(['x'], { type: 'image/png' });
  const payload = promptMessage('比較して', [{ normalizedBlob: blob }]);
  assert.equal(payload[0].role, 'user');
  assert.equal(payload[0].content[0].type, 'text');
  assert.equal(payload[0].content[1].type, 'image');
  assert.equal(payload[0].content[1].value, blob);
});

test('AI errors are normalized', () => {
  assert.equal(normalizeAiError(new DOMException('x', 'QuotaExceededError')).code, 'CONTEXT_EXCEEDED');
  assert.equal(normalizeAiError(new DOMException('x', 'AbortError')).code, 'USER_CANCELLED');
});

test('format helpers', () => {
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatDuration(65000), '1m 05s');
});
