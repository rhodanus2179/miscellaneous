export const CLARIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['respond', 'ask_user'] },
    question: { type: 'string' },
    inputType: { type: 'string', enum: ['single_select', 'multi_select', 'free_text'] },
    options: { type: 'array', items: { type: 'string' }, maxItems: 4 },
  },
  required: ['action', 'question', 'inputType', 'options'],
  additionalProperties: false,
};

function sanitizeQuestion(value) {
  let text = String(value || '').trim();
  // Small local models sometimes repeat the UI choices inside the question field.
  // The UI owns option rendering, so keep only the actual question sentence.
  text = text.replace(/\s*(?:選択肢|options?)\s*[:：].*$/isu, '').trim();
  text = text.replace(/(?:\s+|\n)(?:1[.)．]|①)\s*.+$/su, '').trim();
  return text.slice(0, 220);
}

function sanitizeOption(value) {
  let text = String(value || '').trim();
  text = text.replace(/^(?:[-*•]\s*|\d{1,2}[.)．:：]\s*|[①②③④⑤⑥]\s*)/u, '').trim();
  text = text.replace(/\s*[（(]\s*(?:具体的に\s*[:：]?\s*)?(?:free[_\s-]?text|自由入力|自由記述)[^）)]*[）)]\s*$/iu, '').trim();
  if (/^その他(?:$|[（(：:])/u.test(text) || /^other(?:$|[\s(：:/])/i.test(text)) return 'その他';
  return text.slice(0, 120);
}

function unique(values) {
  return values.filter((value, index, array) => value && array.indexOf(value) === index);
}

export function normalizeClarificationDecision(value) {
  const action = value?.action === 'ask_user' ? 'ask_user' : 'respond';
  if (action === 'respond') return { action: 'respond', question: '', inputType: 'free_text', options: [] };

  const inputType = ['single_select', 'multi_select', 'free_text'].includes(value?.inputType) ? value.inputType : 'free_text';
  const question = sanitizeQuestion(value?.question);
  if (!question) return { action: 'respond', question: '', inputType: 'free_text', options: [] };

  if (inputType === 'free_text') {
    return { action, question, inputType, options: [] };
  }

  const cleaned = unique(Array.isArray(value?.options) ? value.options.map(sanitizeOption).filter(Boolean) : []);
  const substantive = cleaned.filter((option) => option !== 'その他').slice(0, 4);
  if (substantive.length < 2) {
    return { action: 'respond', question: '', inputType: 'free_text', options: [] };
  }

  // "Other" is a UI affordance, not something the model needs to author correctly.
  // Always append one canonical option so free text is consistently available.
  return { action, question, inputType, options: [...substantive, 'その他'] };
}
