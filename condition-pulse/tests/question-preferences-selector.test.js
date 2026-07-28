import test from 'node:test';
import assert from 'node:assert/strict';
import { selectQuestions } from '../js/question-selector.js';

const questions = [
  { id: 'anchor', version: 1, domain: 'overall', prompt: '全体', timeBands: ['morning'], responseScale: 'five_comparative', direction: 'higher_is_better' },
  { id: 'energy', version: 1, domain: 'physical_energy', prompt: '余力', timeBands: ['morning'], responseScale: 'five_agreement', direction: 'higher_is_better' },
  { id: 'clarity', version: 1, domain: 'cognitive_clarity', prompt: '明瞭', timeBands: ['morning'], responseScale: 'five_agreement', direction: 'higher_is_better' },
  { id: 'mood', version: 1, domain: 'emotional_tone', prompt: '気分', timeBands: ['morning'], responseScale: 'five_agreement', direction: 'higher_is_better' }
];

test('hidden detail question is excluded when alternatives exist', () => {
  const selected = selectQuestions({
    questions,
    timeBand: 'morning',
    preferences: { energy: 'hidden' },
    count: 3,
    now: new Date('2026-07-29T08:00:00Z'),
    localDate: '2026-07-29'
  });
  assert.equal(selected.some(question => question.id === 'energy'), false);
  assert.equal(selected.length, 3);
});

test('anchor remains available even if old settings marked it hidden', () => {
  const selected = selectQuestions({
    questions,
    timeBand: 'morning',
    preferences: { anchor: 'hidden' },
    count: 3,
    now: new Date('2026-07-29T08:00:00Z'),
    localDate: '2026-07-29'
  });
  assert.equal(selected[0].id, 'anchor');
});
