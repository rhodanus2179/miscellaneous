import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPatterns } from '../js/patterns.js';

const questionMap = new Map([['overall', { domain: 'overall' }]]);
function session(day, band, value) {
  return {
    id: `${day}-${band}`,
    localDate: `2026-07-${String(day).padStart(2,'0')}`,
    completedAt: `2026-07-${String(day).padStart(2,'0')}T12:00:00Z`,
    timeBand: band,
    sessionType: 'scheduled',
    responses: [{ questionId: 'overall', normalizedValue: value }]
  };
}

test('detects repeated morning recovery', () => {
  const sessions = [];
  for (let day = 20; day <= 24; day += 1) {
    sessions.push(session(day, 'morning', -1), session(day, 'daytime', 1));
  }
  const patterns = detectPatterns(sessions, questionMap, { now: new Date('2026-07-29T00:00:00Z') });
  assert.equal(patterns[0].id, 'morning_recovery');
  assert.equal(patterns[0].count, 5);
});

test('does not report a pattern with fewer than four evaluable days', () => {
  const sessions = [session(27, 'morning', -1), session(27, 'daytime', 1)];
  assert.deepEqual(detectPatterns(sessions, questionMap, { now: new Date('2026-07-29T00:00:00Z') }), []);
});
