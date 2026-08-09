import { listCustomSkills, saveCustomSkill, deleteCustomSkill } from '../storage.js';

export const BUILTIN_SKILLS = [
  {
    id: 'summarize', name: 'Summarize', builtIn: true,
    description: '文章や画像の内容を短く整理し、主要点・重要な数値・固有名詞を残す。',
    instructions: '入力内容を要約してください。目的、主要点、重要な数値・固有名詞、注意事項を優先し、原文にない事実を補わないでください。',
    inputTypes: ['text', 'image'], clarificationMode: 'none',
  },
  {
    id: 'document-review', name: 'Document Review', builtIn: true,
    description: '文書を目的に照らしてレビューし、問題点と改善案を提示する。目的や評価観点が結果を大きく左右する場合だけ確認質問を行う。',
    instructions: '文書をレビューし、まず重要度の高い問題を示し、その後に具体的な改善案を提示してください。誤解、論理の飛躍、冗長さ、回答負荷、構成を必要に応じて確認してください。',
    inputTypes: ['text', 'image'], clarificationMode: 'auto',
  },
  {
    id: 'meeting-notes', name: 'Meeting Notes', builtIn: true,
    description: '会議・打合せ記録から議題、決定事項、宿題、未解決事項を整理する。',
    instructions: '会議内容を、議題、主な発言・論点、決定事項、ToDo（担当・期限が分かれば含む）、未解決事項に分けて整理してください。不明な担当や期限は推測しないでください。',
    inputTypes: ['text'], clarificationMode: 'none',
  },
  {
    id: 'brainstorm', name: 'Brainstorm', builtIn: true,
    description: '目的と制約に沿って複数のアイデアを広げ、比較できる形にする。重要な目的や制約が不足している場合だけ確認質問を行う。',
    instructions: '目的と制約を尊重し、互いに異なる複数案を出してください。各案の長所、弱点、実行条件を簡潔に示し、単なる言い換えの案を増やさないでください。',
    inputTypes: ['text', 'image'], clarificationMode: 'auto',
  },
];

export const BUILTIN_SKILL_IDS = BUILTIN_SKILLS.map((x) => x.id);

export async function listSkills() { return [...BUILTIN_SKILLS, ...(await listCustomSkills())]; }
export async function getSkill(skillId) { return (await listSkills()).find((x) => x.id === skillId) || null; }

export async function createOrUpdateSkill({ id, name, description, instructions, inputTypes, clarificationMode, createdAt }) {
  const cleanName = String(name || '').trim().slice(0, 80);
  const cleanDescription = String(description || '').trim().slice(0, 800);
  const cleanInstructions = String(instructions || '').trim().slice(0, 5000);
  if (!cleanName) throw new Error('Skill名を入力してください。');
  if (!cleanInstructions) throw new Error('Skillの指示を入力してください。');
  const types = [...new Set((inputTypes || ['text']).filter((x) => x === 'text' || x === 'image'))];
  if (!types.length) types.push('text');
  return saveCustomSkill({
    id, name: cleanName, description: cleanDescription || cleanName,
    instructions: cleanInstructions, inputTypes: types,
    clarificationMode: clarificationMode === 'auto' ? 'auto' : 'none', createdAt,
  });
}

export { deleteCustomSkill };
