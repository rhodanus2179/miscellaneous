import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunks } from '../js/chunker.js';

test('chunks are contiguous source ranges and reconstruct exactly', () => {
  const source = '第1段落です。\r\n\r\n第2段落です。🙂\n'.repeat(180);
  const chunks = createChunks(source, { targetLength: 240, maxLength: 320, minLength: 80 });
  assert.ok(chunks.length > 1); assert.equal(chunks[0].start, 0); assert.equal(chunks.at(-1).end, source.length);
  for (let i = 1; i < chunks.length; i += 1) assert.equal(chunks[i - 1].end, chunks[i].start);
  assert.equal(chunks.map(({ start, end }) => source.slice(start, end)).join(''), source);
});

test('chunk boundary never splits a surrogate pair', () => {
  const source = 'a'.repeat(49) + '🙂' + 'b'.repeat(80);
  const chunks = createChunks(source, { targetLength: 50, maxLength: 50, minLength: 20 });
  for (const { end } of chunks.slice(0, -1)) {
    const prev = source.charCodeAt(end - 1); const next = source.charCodeAt(end);
    const splitPair = prev >= 0xD800 && prev <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF;
    assert.equal(splitPair, false);
  }
});
