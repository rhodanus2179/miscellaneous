import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSessionsById, parseBackupText, previewImport } from '../js/import.js';

const session = id => ({
  id,
  localDate: '2026-07-29',
  startedAt: '2026-07-29T00:00:00.000Z',
  completedAt: '2026-07-29T00:00:10.000Z',
  timeBand: 'morning',
  sessionType: 'scheduled',
  responses: [{ questionId: 'q1', selectedIndex: 2, normalizedValue: 0 }]
});

test('v0.1 backup is accepted', () => {
  const backup = parseBackupText(JSON.stringify({
    exportedAt: '2026-07-29T00:00:00.000Z',
    appVersion: '0.1.2',
    settings: {},
    sessions: [session('a')]
  }));
  assert.equal(backup.schemaVersion, 1);
  assert.equal(backup.sessions.length, 1);
});

test('invalid sessions reject entire backup', () => {
  assert.throws(() => parseBackupText(JSON.stringify({
    exportedAt: '2026-07-29T00:00:00.000Z',
    settings: {},
    sessions: [{ id: 'broken' }]
  })), /形式が正しくない/);
});

test('merge keeps current duplicate and adds new sessions', () => {
  const result = mergeSessionsById([session('a')], [session('a'), session('b')]);
  assert.equal(result.added, 1);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.sessions.map(item => item.id), ['a', 'b']);
});

test('preview counts additions and duplicates', () => {
  const backup = { schemaVersion: 2, exportedAt: '2026-07-29T00:00:00.000Z', sessions: [session('a'), session('b')] };
  const preview = previewImport([session('a')], backup);
  assert.equal(preview.duplicates, 1);
  assert.equal(preview.additions, 1);
});
