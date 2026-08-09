import { WORKSPACE_LIMITS } from '../config.js';
import { listProjectMemories, saveProjectMemory, deleteProjectMemory, put } from '../storage.js';

export const MEMORY_CATEGORY_LABELS = {
  premise: '前提', decision: '決定事項', preference: 'ユーザーの希望', term: '用語・定義', other: 'その他',
};

export const MEMORY_TRANSFORM_LABELS = {
  raw: '原文',
  refine: '整形',
  summarize: '要約',
  manual: '手動編集',
  legacy: 'Legacy',
};

export function memoryTransform(memory) {
  return memory?.transform || 'legacy';
}

export function memoryTransformLabel(memory) {
  return MEMORY_TRANSFORM_LABELS[memoryTransform(memory)] || 'Memory';
}

export function selectMemories(memories, {
  maxItems = WORKSPACE_LIMITS.maxMemoryItems,
  maxChars = WORKSPACE_LIMITS.maxMemoryTextChars,
} = {}) {
  const sorted = [...memories]
    .filter((x) => x.enabled !== false && String(x.text || '').trim())
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.priority || 1) - (a.priority || 1) || (b.updatedAt || 0) - (a.updatedAt || 0));
  const selected = [];
  let chars = 0;
  for (const memory of sorted) {
    if (selected.length >= maxItems) break;
    const text = String(memory.text || '').trim();
    const cost = text.length + 20;
    if (chars + cost > maxChars) continue;
    selected.push(memory);
    chars += cost;
  }
  return { selected, totalEnabled: sorted.length, textChars: chars };
}

export function memoryBlock(memories) {
  if (!memories?.length) return '';
  const lines = memories.map((m) => `[${MEMORY_CATEGORY_LABELS[m.category] || 'その他'}] ${String(m.text || '').trim()}`);
  return `【Project Memory】\n以下はユーザーが明示的に保存した作業前提です。\n必要な範囲で利用し、現在のユーザー指示と矛盾する場合は現在の指示を優先してください。\n\n${lines.join('\n')}`;
}

export async function memoriesForProject(projectId) { return listProjectMemories(projectId); }

export async function saveMemory(memory) {
  const saved = await saveProjectMemory(memory);
  const next = { ...saved, transform: memory.transform || saved.transform || 'legacy' };
  await put('projectMemories', next);
  return next;
}

export { deleteProjectMemory as deleteMemory };
