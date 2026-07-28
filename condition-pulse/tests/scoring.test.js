import test from 'node:test';
import assert from 'node:assert/strict';
import { getBaseline, isWarmupComplete, mad, median, normalizeResponse } from '../js/scoring.js';

const positive = { direction: 'higher_is_better' };
const negative = { direction: 'lower_is_better' };

test('normalization preserves positive direction and reverses negative direction', () => {
  assert.equal(normalizeResponse(positive, 4), 2);
  assert.equal(normalizeResponse(positive, 0), -2);
  assert.equal(normalizeResponse(negative, 4), -2);
  assert.equal(normalizeResponse(negative, 0), 2);
});

test('median and MAD are robust to an outlier', () => {
  const values = [0, 0, 1, 0, 20];
  assert.equal(median(values), 0);
  assert.equal(mad(values), 0);
});

test('baseline separates time bands and falls back when needed', () => {
  const questionMap = new Map([['q', { id: 'q', domain: 'cognitive_clarity' }]]);
  const sessions = [
    ['2026-07-20','morning',-1], ['2026-07-21','morning',0], ['2026-07-22','morning',1],
    ['2026-07-20','evening',2], ['2026-07-21','evening',2], ['2026-07-22','evening',1]
  ].map(([localDate,timeBand,value], index) => ({
    id: String(index), localDate, timeBand, completedAt: `${localDate}T12:00:00+09:00`,
    responses: [{ questionId: 'q', normalizedValue: value }]
  }));
  const morning = getBaseline(sessions, questionMap, 'cognitive_clarity', 'morning');
  assert.equal(morning.sampleCount, 3);
  assert.equal(morning.median, 0);
  assert.equal(morning.source, 'timeBand');
});

test('warmup needs seven days, ten sessions and three sessions in the band', () => {
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    localDate: `2026-07-${String(18 + Math.min(index, 6)).padStart(2,'0')}`,
    timeBand: index < 3 ? 'morning' : 'daytime',
    completedAt: `2026-07-${String(18 + Math.min(index, 6)).padStart(2,'0')}T12:00:00+09:00`
  }));
  assert.equal(isWarmupComplete(sessions, 'morning'), true);
  assert.equal(isWarmupComplete(sessions, 'evening'), false);
});
