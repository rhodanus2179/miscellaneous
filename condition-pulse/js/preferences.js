export const QUESTION_PREFERENCE = Object.freeze({
  NORMAL: 'normal',
  LESS: 'less',
  HIDDEN: 'hidden'
});

const VALID = new Set(Object.values(QUESTION_PREFERENCE));

export function normalizeQuestionPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id, preference]) => typeof id === 'string' && id && VALID.has(preference))
  );
}

export function getQuestionPreference(preferences, questionId) {
  return normalizeQuestionPreferences(preferences)[questionId] ?? QUESTION_PREFERENCE.NORMAL;
}

export function setQuestionPreference(preferences, questionId, preference) {
  if (typeof questionId !== 'string' || !questionId) throw new TypeError('questionId is required');
  if (!VALID.has(preference)) throw new RangeError('Unsupported question preference');
  const next = normalizeQuestionPreferences(preferences);
  if (preference === QUESTION_PREFERENCE.NORMAL) delete next[questionId];
  else next[questionId] = preference;
  return next;
}

export function preferencePenalty(preference) {
  if (preference === QUESTION_PREFERENCE.HIDDEN) return Number.POSITIVE_INFINITY;
  if (preference === QUESTION_PREFERENCE.LESS) return 8;
  return 0;
}

export function summarizePreferences(preferences) {
  const normalized = normalizeQuestionPreferences(preferences);
  const values = Object.values(normalized);
  return {
    customized: values.length,
    less: values.filter(value => value === QUESTION_PREFERENCE.LESS).length,
    hidden: values.filter(value => value === QUESTION_PREFERENCE.HIDDEN).length
  };
}
