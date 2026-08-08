import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMemories, memoryBlock } from '../js/workspace/memories.js';
import { BUILTIN_STYLES } from '../js/workspace/styles.js';
import { BUILTIN_SKILLS } from '../js/workspace/skills.js';

test('memory selection respects pinned, priority and guards', () => {
  const memories = [
    { id: 'low', text: 'low', enabled: true, pinned: false, priority: 1, updatedAt: 3 },
    { id: 'high', text: 'high', enabled: true, pinned: false, priority: 3, updatedAt: 1 },
    { id: 'pin', text: 'pin', enabled: true, pinned: true, priority: 1, updatedAt: 2 },
    { id: 'off', text: 'off', enabled: false, pinned: true, priority: 3, updatedAt: 4 },
  ];
  const result = selectMemories(memories, { maxItems: 2, maxChars: 100 });
  assert.deepEqual(result.selected.map((x) => x.id), ['pin', 'high']);
  assert.equal(result.totalEnabled, 3);
});

test('memory block labels categories', () => {
  const text = memoryBlock([{ category: 'decision', text: 'A案を採用' }, { category: 'term', text: 'PFはPlatform' }]);
  assert.match(text, /\[決定事項\] A案を採用/);
  assert.match(text, /\[用語・定義\] PFはPlatform/);
});

test('built-in styles separate writing behavior', () => {
  const names = BUILTIN_STYLES.map((x) => x.name);
  assert.deepEqual(names, ['Default', 'Concise', 'Formal', 'Technical', 'Explanatory']);
  assert.equal(BUILTIN_STYLES[0].instruction, '');
});

test('built-in skills include Ask User and non-Ask variants', () => {
  assert.ok(BUILTIN_SKILLS.some((x) => x.clarificationMode === 'auto'));
  assert.ok(BUILTIN_SKILLS.some((x) => x.clarificationMode === 'none'));
  assert.ok(BUILTIN_SKILLS.every((x) => !('source' in x)));
});
