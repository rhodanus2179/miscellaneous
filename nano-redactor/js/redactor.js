import { validateNonOverlappingSpans } from './spans.js';

const LABELS = Object.freeze({
  PERSON: '氏名',
  ADDRESS: '住所',
  PHONE: '電話番号',
  EMAIL: 'メール',
  PERSON_ID: '個人ID',
  ACCOUNT: 'アカウント',
  DOB: '生年月日',
  OTHER: '個人情報',
});

export function createMaskState() {
  return {
    serialByKey: new Map(),
    nextByType: new Map(),
  };
}

function typeLabel(type) {
  return LABELS[type] || LABELS.OTHER;
}

function serialLabel(type, originalText, state) {
  const key = `${type}\u0000${originalText}`;
  if (state.serialByKey.has(key)) return state.serialByKey.get(key);

  const next = (state.nextByType.get(type) || 0) + 1;
  state.nextByType.set(type, next);
  const label = `[${type}_${String(next).padStart(2, '0')}]`;
  state.serialByKey.set(key, label);
  return label;
}

function blockLabel(originalText) {
  const visualLength = Math.max(1, Array.from(originalText).length);
  return '█'.repeat(visualLength);
}

function maskFor(span, source, style, state) {
  const originalText = source.slice(span.start, span.end);
  if (style === 'serial') return serialLabel(span.type, originalText, state);
  if (style === 'block') return blockLabel(originalText);
  return `[${typeLabel(span.type)}]`;
}

/**
 * Deterministically redacts only validated spans. Every non-span segment is
 * copied from the original source with slice(), preserving whitespace,
 * newlines, punctuation and Unicode exactly.
 */
export function redactText(source, spans, {
  style = 'labels',
  state = createMaskState(),
} = {}) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  const ordered = [...(Array.isArray(spans) ? spans : [])].sort((a, b) => a.start - b.start || a.end - b.end);
  if (!validateNonOverlappingSpans(ordered, source.length)) {
    throw new RangeError('spans must be valid and non-overlapping');
  }

  let cursor = 0;
  let output = '';
  const replacements = [];

  for (const span of ordered) {
    output += source.slice(cursor, span.start);
    const replacement = maskFor(span, source, style, state);
    output += replacement;
    replacements.push({
      start: span.start,
      end: span.end,
      type: span.type,
      replacement,
    });
    cursor = span.end;
  }

  output += source.slice(cursor);
  return { text: output, replacements, state };
}

export function getLabelForType(type) {
  return `[${typeLabel(type)}]`;
}
