import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectQuestions, validateQuestions } from '../js/question-selector.js';

const bank = JSON.parse(await readFile(new URL('../data/questions.ja.json', import.meta.url), 'utf8')).questions;

test('question bank has at least 60 valid unique questions', () => {
  assert.ok(bank.length >= 60);
  assert.equal(validateQuestions(bank).length, bank.length);
  assert.equal(new Set(bank.map(question => question.id)).size, bank.length);
});

test('selection returns three questions with one anchor and distinct detail domains', () => {
  const selected = selectQuestions({ questions: bank, timeBand: 'daytime', sessions: [], now: new Date('2026-07-28T12:00:00+09:00'), localDate: '2026-07-28' });
  assert.equal(selected.length, 3);
  assert.equal(selected.filter(question => question.domain === 'overall').length, 1);
  assert.equal(new Set(selected.filter(question => question.domain !== 'overall').map(question => question.domain)).size, 2);
  assert.ok(selected.slice(1).every(question => question.timeBands.includes('daytime')));
});

test('recently asked questions are avoided while alternatives exist', () => {
  const first = selectQuestions({ questions: bank, timeBand: 'morning', sessions: [], now: new Date('2026-07-28T07:00:00+09:00'), localDate: '2026-07-28' });
  const session = {
    localDate: '2026-07-28', timeBand: 'morning', completedAt: '2026-07-28T07:00:10+09:00',
    questionIds: first.map(question => question.id),
    responses: first.map(question => ({ questionId: question.id, normalizedValue: 0, answeredAt: '2026-07-28T07:00:05+09:00' }))
  };
  const second = selectQuestions({ questions: bank, timeBand: 'morning', sessions: [session], now: new Date('2026-07-28T08:00:00+09:00'), localDate: '2026-07-28' });
  assert.equal(second.length, 3);
  assert.ok(second.every(question => !first.some(previous => previous.id === question.id)));
});
