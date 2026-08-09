import { CLARIFICATION_SCHEMA, normalizeClarificationDecision } from './schemas.js';

export function isOtherOption(label = '') {
  const text = String(label).trim();
  return /^その他(?:$|[（(：:])/u.test(text) || /^other(?:$|[\s(：:/])/i.test(text);
}

export function plannerPrompt(skill, userText, clarifications = []) {
  const known = clarifications.length
    ? clarifications.map((c) => `Q: ${c.question}\nA: ${c.skipped ? '(skip)' : Array.isArray(c.answer) ? c.answer.join('、') : c.answer}`).join('\n\n')
    : 'なし';
  return `あなたは不足情報の確認要否だけを判断します。回答本文は作成しないでください。\n\nTask: ${skill.name}\n目的: ${skill.description}\n\nUser request:\n${userText}\n\n既存の確認回答:\n${known}\n\n次のいずれかを選んでください。\n- 十分な情報がある → respond\n- 結果が大きく変わる重要情報が1つ不足 → ask_user\n\n質問は1回に1つだけにしてください。抽象的な嗜好質問を避け、具体的な作業情報を聞いてください。\n\nask_userの場合は次を厳守してください。\n- questionには質問文だけを書く。選択肢、番号付きリスト、「選択肢:」、UI説明、free_textなどの内部語を絶対に含めない。\n- single_select / multi_selectの場合、optionsには短く相互に区別できる実質的な選択肢を3〜4個だけ入れる。番号や箇条書き記号を付けない。\n- optionsに「その他」「Other」「自由入力」を入れない。Nano Workbench側が常に末尾へ「その他」を追加し、選択時に自由入力欄を表示する。\n- 自由記述そのものが適切な場合だけfree_textにし、その場合optionsは空配列にする。\n\n良い例:\nquestion: 「どの利用環境を主に想定していますか？」\ninputType: single_select\noptions: [「仕事場」, 「自宅」, 「都市部の公共スペース」, 「自然環境」]\n`;
}

export async function askPlanner(adapter, skill, userText, clarifications = [], { signal } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const value = await adapter.structuredDecision(plannerPrompt(skill, userText, clarifications), CLARIFICATION_SCHEMA, { signal });
      return normalizeClarificationDecision(value);
    } catch (error) { lastError = error; }
  }
  throw lastError;
}
