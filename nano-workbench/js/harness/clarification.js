import { CLARIFICATION_SCHEMA, normalizeClarificationDecision } from './schemas.js';

export function isOtherOption(label = '') {
  const text = String(label).trim();
  return /^その他(?:$|[（(：:])/u.test(text) || /^other(?:$|[\s(：:/])/i.test(text);
}

export function plannerPrompt(skill, userText, clarifications = []) {
  const known = clarifications.length
    ? clarifications.map((c) => `Q: ${c.question}\nA: ${c.skipped ? '(skip)' : Array.isArray(c.answer) ? c.answer.join('、') : c.answer}`).join('\n\n')
    : 'なし';
  return `あなたは不足情報の確認要否だけを判断します。回答本文は作成しないでください。\n\nTask: ${skill.name}\n目的: ${skill.description}\n\nUser request:\n${userText}\n\n既存の確認回答:\n${known}\n\n次のいずれかを選んでください。\n- 十分な情報がある → respond\n- 結果が大きく変わる重要情報が1つ不足 → ask_user\n\n質問は1回に1つだけにしてください。抽象的な嗜好質問を避け、具体的な作業情報を聞いてください。選択式にできる場合は2〜4個の具体的な選択肢を作ってください。主要な選択肢だけでは網羅できず自由記入が有用な場合は、選択肢の最後を正確に「その他」としてください。Nano Workbenchは「その他」を選んだ利用者に自由入力欄を表示します。自由記述そのものが適切ならfree_textにしてください。`;
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
