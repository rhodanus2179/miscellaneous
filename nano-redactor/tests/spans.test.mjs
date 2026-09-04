import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSpans, resolveEntitySpans } from '../js/spans.js';

test('hallucinated model text is ignored', () => {
  const result = resolveEntitySpans('佐藤さんに確認しました。', [{ text:'山田太郎', type:'PERSON' }]);
  assert.deepEqual(result.spans, []); assert.equal(result.warnings[0].code, 'MODEL_SPAN_NOT_FOUND');
});

test('ambiguous duplicate is skipped instead of guessing', () => {
  const result = resolveEntitySpans('山田という製品名。担当者の山田に確認。', [{ text:'山田', type:'PERSON' }]);
  assert.deepEqual(result.spans, []); assert.equal(result.warnings[0].code, 'AMBIGUOUS_DUPLICATE');
});

test('repeated entities resolve in source order when all occurrences are returned', () => {
  const result = resolveEntitySpans('田中さん→田中さん', [{ text:'田中さん', type:'PERSON' },{ text:'田中さん', type:'PERSON' }], 100);
  assert.deepEqual(result.spans.map(({ start, end }) => [start, end]), [[100,104],[105,109]]);
});

test('standard mode rejects generic publication dates mislabeled as OTHER', () => {
  const result = resolveEntitySpans('出典（環境省、2012年3月）', [{ text:'2012年3月', type:'OTHER' }]);
  assert.deepEqual(result.spans, []); assert.equal(result.warnings[0].code, 'MODEL_NON_PII_REJECTED');
});

test('strict mode may keep contextually detected date-like quasi-identifiers', () => {
  const result = resolveEntitySpans('面談日は2026-09-02です。', [{ text:'2026-09-02', type:'OTHER' }], 0, { mode:'strict' });
  assert.equal(result.spans.length, 1);
});

test('same-type containment keeps the wider exact detected unit', () => {
  const merged = mergeSpans([{ start:5,end:10,type:'ADDRESS',source:'rule' },{ start:0,end:15,type:'ADDRESS',source:'model' }], 20);
  assert.deepEqual(merged.spans.map(({ start, end }) => [start,end]), [[0,15]]); assert.equal(merged.warnings.length, 0);
});

test('specific-type partial overlap is treated as conflict and not auto-expanded', () => {
  const merged = mergeSpans([{ start:0,end:8,type:'PERSON',source:'model' },{ start:5,end:12,type:'ADDRESS',source:'model' }], 20);
  assert.deepEqual(merged.spans, []); assert.equal(merged.warnings[0].code, 'SPAN_CONFLICT');
});
