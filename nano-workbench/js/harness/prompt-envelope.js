export function clarificationLines(clarifications = []) {
  return clarifications.map((c) => {
    const answer = c.skipped ? '(回答せず実行)' : Array.isArray(c.answer) ? c.answer.join('、') : String(c.answer ?? '');
    return `- Q: ${c.question}\n  A: ${answer}`;
  }).join('\n');
}

export function buildTaskEnvelope({ skill, userText, clarifications = [], maxQuestionsReached = false }) {
  if (!skill) return userText;
  const clarify = clarifications.length ? clarificationLines(clarifications) : 'なし';
  const limitNote = maxQuestionsReached
    ? '\n\n確認質問の上限に達したため、現在得られている情報だけで最善の回答を作成してください。不足が残る場合は、その不足を回答内で明示してください。'
    : '';
  return `【Skill】\n${skill.name}\n\n【Skill instructions】\n${skill.instructions}\n\n【User request】\n${userText}\n\n【Clarifications】\n${clarify}\n\n【Execution instruction】\n上記の依頼と確認内容に基づいて回答してください。${limitNote}`;
}

export function replacePromptText(message, nextText) {
  if (typeof message === 'string') return nextText;
  if (!Array.isArray(message)) return message;
  let replaced = false;
  return message.map((entry) => {
    if (replaced || entry?.role !== 'user' || !Array.isArray(entry.content)) return entry;
    const content = entry.content.map((item) => {
      if (!replaced && item?.type === 'text') {
        replaced = true;
        return { ...item, value: nextText };
      }
      return item;
    });
    if (!replaced) { content.unshift({ type: 'text', value: nextText }); replaced = true; }
    return { ...entry, content };
  });
}

export function extractPromptText(message) {
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return '';
  for (const entry of message) {
    if (entry?.role !== 'user' || !Array.isArray(entry.content)) continue;
    const item = entry.content.find((x) => x?.type === 'text');
    if (item) return String(item.value || '');
  }
  return '';
}
