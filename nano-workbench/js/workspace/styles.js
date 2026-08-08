import { listCustomStyles, saveCustomStyle, deleteCustomStyle } from '../storage.js';

export const BUILTIN_STYLES = [
  { id: 'default', name: 'Default', instruction: '', builtIn: true },
  { id: 'concise', name: 'Concise', instruction: '結論を先に述べ、重複や不要な前置きを避けて簡潔に回答してください。', builtIn: true },
  { id: 'formal', name: 'Formal', instruction: '落ち着いた専門的な文体を用い、口語的・過度にくだけた表現を避けてください。', builtIn: true },
  { id: 'technical', name: 'Technical', instruction: '技術的な前提、用語、条件、例外を明示し、曖昧な一般化を避けてください。', builtIn: true },
  { id: 'explanatory', name: 'Explanatory', instruction: '結論だけでなく理由と考え方が理解できるよう、段階的に説明してください。', builtIn: true },
];

export async function listStyles() {
  return [...BUILTIN_STYLES, ...(await listCustomStyles())];
}

export async function getStyle(styleId) {
  return (await listStyles()).find((x) => x.id === styleId) || BUILTIN_STYLES[0];
}

export async function resolveEffectiveStyle(conversation, project) {
  const id = conversation?.styleOverrideId || project?.defaultStyleId || 'default';
  return getStyle(id);
}

export async function createOrUpdateStyle({ id, name, instruction, createdAt }) {
  const cleanName = String(name || '').trim().slice(0, 60);
  const cleanInstruction = String(instruction || '').trim().slice(0, 3000);
  if (!cleanName) throw new Error('Style名を入力してください。');
  if (!cleanInstruction) throw new Error('Styleの指示を入力してください。');
  return saveCustomStyle({ id, name: cleanName, instruction: cleanInstruction, createdAt });
}

export { deleteCustomStyle };
