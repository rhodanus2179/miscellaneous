import test from 'node:test';
import assert from 'node:assert/strict';
import { getObservationDate, getTimeBand, timeToMinutes } from '../js/time-bands.js';
import { DEFAULT_SETTINGS } from '../js/config.js';

function localDateAt(year, month, day, hour, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0);
}

test('timeToMinutes parses HH:MM', () => {
  assert.equal(timeToMinutes('05:30'), 330);
  assert.equal(timeToMinutes('17:00'), 1020);
});

test('default boundaries classify morning, daytime and evening', () => {
  assert.equal(getTimeBand(localDateAt(2026, 7, 28, 5), DEFAULT_SETTINGS), 'morning');
  assert.equal(getTimeBand(localDateAt(2026, 7, 28, 10, 59), DEFAULT_SETTINGS), 'morning');
  assert.equal(getTimeBand(localDateAt(2026, 7, 28, 11), DEFAULT_SETTINGS), 'daytime');
  assert.equal(getTimeBand(localDateAt(2026, 7, 28, 17), DEFAULT_SETTINGS), 'evening');
  assert.equal(getTimeBand(localDateAt(2026, 7, 28, 2), DEFAULT_SETTINGS), 'evening');
});

test('after midnight evening belongs to previous observation date', () => {
  assert.equal(getObservationDate(localDateAt(2026, 7, 28, 2), DEFAULT_SETTINGS), '2026-07-27');
  assert.equal(getObservationDate(localDateAt(2026, 7, 28, 5), DEFAULT_SETTINGS), '2026-07-28');
});
