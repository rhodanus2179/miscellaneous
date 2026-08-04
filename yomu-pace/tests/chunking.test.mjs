import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkBlock, durationForChunk, normalizeForReading, protectedRanges, sentenceRanges } from '../js/chunking.js';

function block(text, kind = 'paragraph') { return { id:'b1', kind, text, sourceStart:0, sourceEnd:text.length, autoPlayable:true }; }

test('チャンクを連結すると正規化本文へ戻る', () => {
  const text = '循環型社会の形成に向けて、市町村による分別収集を促進します。';
  const chunks = chunkBlock('doc', block(text));
  assert.equal(chunks.map((item) => item.text).join(''), normalizeForReading(text));
});

test('URL中の疑問符を文末と誤認しない', () => {
  const url = 'https://example.com/path?q=123';
  const text = `詳しくは${url}を確認してください。`;
  const ranges = sentenceRanges(text);
  assert.equal(ranges.length, 1);
  const chunks = chunkBlock('doc', block(text));
  assert.ok(chunks.some((chunk) => chunk.text.includes(url)));
});

test('数値と単位を保護する', () => {
  const text = '10 t/日ではなく、処理能力は20m³です。';
  const chunks = chunkBlock('doc', block(text));
  assert.ok(chunks.some((chunk) => chunk.text.includes('20m³')));
  assert.ok(protectedRanges(text).length >= 1);
});

test('句読点だけのチャンクを生成しない', () => {
  const chunks = chunkBlock('doc', block('今日は晴れです。しかし、風は強いです。'), 'short');
  assert.ok(chunks.every((chunk) => !/^[、。，．！？!?]+$/u.test(chunk.text)));
});

test('同じ入力から同じIDを生成する', () => {
  const a = chunkBlock('doc', block('同じ文章は同じ結果になります。'));
  const b = chunkBlock('doc', block('同じ文章は同じ結果になります。'));
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
});

test('文末休止は表示時間を増やす', () => {
  const common = { visibleCharacterCount:8, text:'同じ長さです', kind:'paragraph', flags:{hasLatin:false,hasNumber:false,hasUnit:false,hasUrl:false,hasBrackets:false,usedFallbackSplit:false} };
  assert.ok(durationForChunk({...common,pauseClass:'sentence'}) > durationForChunk({...common,pauseClass:'none'}));
});
