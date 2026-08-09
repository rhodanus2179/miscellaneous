import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMemoryCandidate,
  buildMemoryRefinementPrompt,
} from '../js/workspace/memory-refinement.js';
import { memoryTransformLabel } from '../js/workspace/memories.js';

test('memory candidate normalizes category and trims text', () => {
  assert.deepEqual(normalizeMemoryCandidate({ category: 'decision', text: '  採用する。\r\n' }), {
    category: 'decision', text: '採用する。',
  });
  assert.deepEqual(normalizeMemoryCandidate({ category: 'unknown', text: 'X' }), {
    category: 'other', text: 'X',
  });
});

test('empty memory candidate is rejected', () => {
  assert.throws(() => normalizeMemoryCandidate({ category: 'other', text: '   ' }), /空/);
});

test('refine prompt preserves facts and uses parent only for reference resolution', () => {
  const prompt = buildMemoryRefinementPrompt({
    mode: 'refine',
    sourceText: 'それで進めます。',
    parentText: '製造業は工場単位にしますか？',
    projectName: '秋田県PF',
  });
  assert.match(prompt, /情報量はなるべく維持/);
  assert.match(prompt, /親メッセージは照応解決の補助/);
  assert.match(prompt, /製造業は工場単位/);
  assert.match(prompt, /それで進めます/);
  assert.match(prompt, /秋田県PF/);
});

test('summarize prompt explicitly requests a shorter memory', () => {
  const prompt = buildMemoryRefinementPrompt({ mode: 'summarize', sourceText: '長い説明' });
  assert.match(prompt, /短く要約/);
  assert.match(prompt, /元文より明確に短く/);
});

test('memory transform labels describe provenance', () => {
  assert.equal(memoryTransformLabel({ transform: 'raw' }), '原文');
  assert.equal(memoryTransformLabel({ transform: 'refine' }), '整形');
  assert.equal(memoryTransformLabel({ transform: 'summarize' }), '要約');
  assert.equal(memoryTransformLabel({}), 'Legacy');
});
