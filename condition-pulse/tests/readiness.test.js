import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReadiness, dailyObservationMessage } from '../js/readiness.js';

const make = (day, band) => ({ localDate: `2026-07-${String(day).padStart(2,'0')}`, timeBand: band, sessionType: 'scheduled', completedAt: `2026-07-${String(day).padStart(2,'0')}T08:00:00Z` });

test('two daily sessions are enough observation', () => {
  const sessions = [make(29, 'morning'), make(29, 'daytime')];
  assert.equal(dailyObservationMessage(sessions, '2026-07-29'), '今日は十分な観測ができています。');
});

test('readiness becomes comparable after 7 days and 10 sessions', () => {
  const sessions = [];
  for (let day = 1; day <= 7; day += 1) sessions.push(make(day, 'morning'));
  sessions.push(make(1, 'daytime'), make(2, 'daytime'), make(3, 'daytime'));
  assert.equal(calculateReadiness(sessions).level, 'comparable');
});
