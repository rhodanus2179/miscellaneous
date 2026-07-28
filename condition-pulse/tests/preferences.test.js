import test from 'node:test';
import assert from 'node:assert/strict';
import { getQuestionPreference, preferencePenalty, setQuestionPreference, summarizePreferences } from '../js/preferences.js';

test('question preferences default to normal', () => {
  assert.equal(getQuestionPreference({}, 'q1'), 'normal');
});

test('setting normal removes stored override', () => {
  const next = setQuestionPreference({ q1: 'less' }, 'q1', 'normal');
  assert.deepEqual(next, {});
});

test('hidden receives infinite selection penalty', () => {
  assert.equal(preferencePenalty('hidden'), Number.POSITIVE_INFINITY);
});

test('summary counts customized questions', () => {
  assert.deepEqual(summarizePreferences({ a: 'less', b: 'hidden' }), { customized: 2, less: 1, hidden: 1 });
});
