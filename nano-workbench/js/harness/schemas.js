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

export function normalizeClarificationDecision(value) {
  const action = value?.action === 'ask_user' ? 'ask_user' : 'respond';
  if (action === 'respond') return { action: 'respond', question: '', inputType: 'free_text', options: [] };
  const inputType = ['single_select', 'multi_select', 'free_text'].includes(value?.inputType) ? value.inputType : 'free_text';
  const question = String(value?.question || '').trim().slice(0, 300);
  let options = Array.isArray(value?.options) ? value.options.map((x) => String(x).trim()).filter(Boolean).slice(0, 4) : [];
  if (inputType === 'free_text') options = [];
  if ((inputType === 'single_select' || inputType === 'multi_select') && options.length < 2) {
    return { action: 'respond', question: '', inputType: 'free_text', options: [] };
  }
  if (!question) return { action: 'respond', question: '', inputType: 'free_text', options: [] };
  return { action, question, inputType, options };
}
