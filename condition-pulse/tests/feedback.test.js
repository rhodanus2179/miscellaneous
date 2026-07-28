import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFeedback, hasSafetySignal } from '../js/feedback.js';

const questions = [
  { id: 'overall', domain: 'overall', safetySensitive: false },
  { id: 'body', domain: 'appetite_body', safetySensitive: true }
];
const map = new Map(questions.map(question => [question.id, question]));

test('early feedback stays in learning mode', () => {
  const session = { localDate: '2026-07-28', timeBand: 'morning', completedAt: '2026-07-28T07:00:00+09:00', responses: [{ questionId: 'overall', normalizedValue: 0 }] };
  assert.match(generateFeedback(session, [], map), /学習中/);
});

test('safety signal only responds to a strong safety-sensitive answer', () => {
  assert.equal(hasSafetySignal({ responses: [{ questionId: 'body', normalizedValue: -2 }] }, map), true);
  assert.equal(hasSafetySignal({ responses: [{ questionId: 'body', normalizedValue: -1 }] }, map), false);
  assert.equal(hasSafetySignal({ responses: [{ questionId: 'overall', normalizedValue: -2 }] }, map), false);
});
