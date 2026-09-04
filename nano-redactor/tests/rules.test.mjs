import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRuleCandidates, ruleCandidatesToSpans } from '../js/rules.js';

test('extracts email, Japanese phone and postcode without surrounding punctuation', () => {
  const candidates = extractRuleCandidates('連絡先は(foo@example.com)、電話090-1234-5678、〒100-0001です。');
  assert.ok(candidates.some((x) => x.type === 'EMAIL' && x.text === 'foo@example.com'));
  assert.ok(candidates.some((x) => x.type === 'PHONE' && x.text === '090-1234-5678'));
  assert.ok(candidates.some((x) => x.type === 'ADDRESS' && x.text === '〒100-0001'));
});

test('standard mode with AI does not auto-mask rule candidates', () => {
  const candidates = extractRuleCandidates('代表電話03-0000-0000 info@example.com');
  assert.deepEqual(ruleCandidatesToSpans(candidates, 0, { mode:'standard', aiAvailable:true }), []);
});

test('strict mode auto-masks phone and email but not postcode alone', () => {
  const candidates = extractRuleCandidates('090-1234-5678 a@example.com 100-0001');
  const spans = ruleCandidatesToSpans(candidates, 0, { mode:'strict', aiAvailable:true });
  assert.deepEqual(new Set(spans.map((x) => x.type)), new Set(['PHONE','EMAIL']));
});
