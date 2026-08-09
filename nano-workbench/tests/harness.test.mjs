import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClarificationDecision } from '../js/harness/schemas.js';
import { isOtherOption } from '../js/harness/clarification.js';
import { buildTaskEnvelope, replacePromptText, extractPromptText } from '../js/harness/prompt-envelope.js';
import { slashMatches, exactSlashCommand } from '../js/harness/slash-commands.js';

test('respond decision is normalized to empty payload', () => {
  assert.deepEqual(normalizeClarificationDecision({ action: 'respond', question: 'x', inputType: 'single_select', options: ['a', 'b'] }), {
    action: 'respond', question: '', inputType: 'free_text', options: [],
  });
});

test('invalid selection decision safely falls back to respond', () => {
  assert.equal(normalizeClarificationDecision({ action: 'ask_user', question: 'Q?', inputType: 'single_select', options: ['one'] }).action, 'respond');
});

test('Other choices are recognized for free-text expansion', () => {
  assert.equal(isOtherOption('その他'), true);
  assert.equal(isOtherOption('その他（自由入力）'), true);
  assert.equal(isOtherOption('Other'), true);
  assert.equal(isOtherOption('実現可能性'), false);
});

test('task envelope contains skill, request and clarification', () => {
  const text = buildTaskEnvelope({
    skill: { name: 'Review', instructions: 'レビューする' },
    userText: 'この文書を見て',
    clarifications: [{ question: '観点は?', answer: ['明確さ', '負荷'], skipped: false }],
  });
  assert.match(text, /Review/);
  assert.match(text, /この文書を見て/);
  assert.match(text, /明確さ、負荷/);
});

test('multimodal prompt text can be replaced without losing image', () => {
  const blob = new Blob(['x'], { type: 'image/png' });
  const input = [{ role: 'user', content: [{ type: 'text', value: 'old' }, { type: 'image', value: blob }] }];
  const output = replacePromptText(input, 'new');
  assert.equal(extractPromptText(output), 'new');
  assert.equal(output[0].content[1].value, blob);
});

test('slash command autocomplete is client-side deterministic', () => {
  assert.deepEqual(slashMatches('/pro').map((x) => x.command), ['/project']);
  assert.equal(exactSlashCommand('/compact')?.label, '会話を圧縮');
  assert.equal(exactSlashCommand('/unknown'), null);
});
