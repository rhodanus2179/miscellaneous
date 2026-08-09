const TEXT_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
};

export const MEMORY_CATEGORIES = ['premise', 'decision', 'preference', 'term', 'other'];

export const MEMORY_REFINEMENT_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: MEMORY_CATEGORIES },
    text: { type: 'string' },
  },
  required: ['category', 'text'],
  additionalProperties: false,
};

export function normalizeMemoryCandidate(value) {
  const category = MEMORY_CATEGORIES.includes(value?.category) ? value.category : 'other';
  const text = String(value?.text || '').replace(/\r\n/g, '\n').trim().slice(0, 6000);
  if (!text) throw new Error('Memory候補が空でした。');
  return { category, text };
}

export function buildMemoryRefinementPrompt({ mode, sourceText, parentText = '', projectName = '' }) {
  const source = String(sourceText || '').trim();
  const parent = String(parentText || '').trim();
  const project = String(projectName || '').trim();
  const task = mode === 'summarize'
    ? `将来の会話で再利用するProject Memoryとして、必要な事実・決定・制約・固有名詞だけを短く要約してください。背景説明、例示、推論過程、挨拶は原則として除きます。元文より明確に短くしてください。`
    : `将来の会話で再利用するProject Memoryとして整えてください。情報量はなるべく維持し、挨拶・相づち・冗長な前置きを除き、「これ」「それ」「今回」などの照応を可能な範囲で自己完結する表現へ直してください。数値、日付、固有名詞、条件、否定、不確実性は落とさないでください。必要なら短い箇条書きにして構いません。`;
  return `あなたはProject Memory専用の編集者です。回答本文ではなく、保存候補だけをJSON Schemaに従って返してください。\n\n${task}\n\nCategoryは次から最も適切な1つを選びます。\n- premise: 前提・事実・条件\n- decision: 決定事項・採用方針\n- preference: ユーザーの希望・好み・作業上の要望\n- term: 用語・定義\n- other: その他\n\n重要なルール:\n- 元メッセージにない事実を追加しない。\n- 親メッセージは照応解決の補助にだけ使い、別の事実を勝手に混ぜない。\n- Memory単独で後から読んでも意味が通るようにする。\n- Markdown見出しや「要約:」のようなラベルは不要。\n\nProject: ${project || '(unnamed)'}\n\n直前のメッセージ（参考。なければ空）:\n${parent || '(なし)'}\n\nMemory化する元メッセージ:\n${source}`;
}

export async function generateMemoryCandidate({ mode, sourceText, parentText = '', projectName = '', signal, onProgress = () => {} }) {
  if (!['refine', 'summarize'].includes(mode)) throw new Error('未対応のMemory変換モードです。');
  if (!String(sourceText || '').trim()) throw new Error('Memory化できる本文がありません。');
  if (!('LanguageModel' in self)) throw new Error('このChromeではPrompt APIを利用できません。');

  const availability = await LanguageModel.availability(TEXT_OPTIONS);
  if (availability === 'unavailable') throw new Error('Memory候補を生成できるオンデバイスモデルを利用できません。');

  const session = await LanguageModel.create({
    ...TEXT_OPTIONS,
    initialPrompts: [{
      role: 'system',
      content: 'Project Memory候補だけを作る編集者です。元文にない内容を創作せず、指定されたJSON形式だけを返してください。',
    }],
    monitor: (monitor) => monitor.addEventListener('downloadprogress', (event) => onProgress(Number(event.loaded || 0))),
  });

  try {
    const raw = await session.prompt(
      buildMemoryRefinementPrompt({ mode, sourceText, parentText, projectName }),
      { responseConstraint: MEMORY_REFINEMENT_SCHEMA, signal },
    );
    return normalizeMemoryCandidate(JSON.parse(raw));
  } finally {
    try { session.destroy?.(); } catch { /* noop */ }
  }
}
