export const ENTITY_TYPES = Object.freeze([
  'PERSON', 'ADDRESS', 'PHONE', 'EMAIL',
  'PERSON_ID', 'ACCOUNT', 'DOB', 'OTHER',
]);

const ENTITY_TYPE_SET = new Set(ENTITY_TYPES);
const GENERIC_DATE = /^(?:18|19|20|21)\d{2}(?:(?:年(?:\d{1,2}月(?:\d{1,2}日)?)?)|(?:[./-]\d{1,2}(?:[./-]\d{1,2})?))?$/u;

function allOccurrences(text, needle) {
  const positions = [];
  if (!needle) return positions;
  let cursor = 0;
  while (cursor <= text.length - needle.length) {
    const index = text.indexOf(needle, cursor);
    if (index < 0) break;
    positions.push(index);
    cursor = index + Math.max(needle.length, 1);
  }
  return positions;
}

function safeEntity(entity) {
  return entity && typeof entity.text === 'string' && entity.text.length > 0 && ENTITY_TYPE_SET.has(entity.type);
}

function shouldRejectModelEntity(entity, mode) {
  if (mode !== 'standard') return false;
  return entity.type === 'OTHER' && GENERIC_DATE.test(entity.text.trim());
}

export function resolveEntitySpans(chunkText, entities, chunkStart = 0, { mode = 'standard' } = {}) {
  if (typeof chunkText !== 'string') throw new TypeError('chunkText must be a string');
  const groups = new Map();
  const warnings = [];
  const spans = [];
  const input = [];

  for (const entity of Array.isArray(entities) ? entities : []) {
    if (!safeEntity(entity)) continue;
    if (shouldRejectModelEntity(entity, mode)) {
      warnings.push({ code: 'MODEL_NON_PII_REJECTED', type: entity.type });
      continue;
    }
    input.push(entity);
  }

  for (const entity of input) {
    const list = groups.get(entity.text) || [];
    list.push(entity);
    groups.set(entity.text, list);
  }

  for (const [text, group] of groups) {
    const occurrences = allOccurrences(chunkText, text);
    if (occurrences.length === 0) {
      for (const entity of group) warnings.push({ code: 'MODEL_SPAN_NOT_FOUND', type: entity.type });
      continue;
    }
    if (occurrences.length > 1 && group.length !== occurrences.length) {
      warnings.push({ code: 'AMBIGUOUS_DUPLICATE', type: group[0]?.type || 'OTHER', sourceOccurrences: occurrences.length, modelOccurrences: group.length });
      continue;
    }
    const count = Math.min(occurrences.length, group.length);
    for (let i = 0; i < count; i += 1) {
      const entity = group[i];
      const localStart = occurrences[i];
      spans.push({ start: chunkStart + localStart, end: chunkStart + localStart + text.length, type: entity.type, source: 'model', text });
    }
    if (group.length > occurrences.length) {
      for (let i = occurrences.length; i < group.length; i += 1) warnings.push({ code: 'MODEL_SPAN_NOT_FOUND', type: group[i].type });
    }
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return { spans, warnings };
}

function isValidSpan(span, sourceLength) {
  return span && Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start && span.end <= sourceLength && ENTITY_TYPE_SET.has(span.type);
}
function sameRange(a, b) { return a.start === b.start && a.end === b.end; }
function contains(a, b) { return a.start <= b.start && a.end >= b.end; }
function overlaps(a, b) { return a.start < b.end && b.start < a.end; }
function chooseExactRange(a, b) {
  if (a.type === b.type) {
    if (a.source === 'model') return a;
    if (b.source === 'model') return b;
    return a;
  }
  if (a.type === 'OTHER') return b;
  if (b.type === 'OTHER') return a;
  return null;
}
function chooseContainment(a, b) {
  const outer = contains(a, b) ? a : b;
  const inner = outer === a ? b : a;
  if (outer.type === inner.type) return outer;
  if (outer.type === 'OTHER') return inner;
  if (inner.type === 'OTHER') return outer;
  return null;
}

export function mergeSpans(spans, sourceLength) {
  const valid = (Array.isArray(spans) ? spans : []).filter((span) => isValidSpan(span, sourceLength)).sort((a, b) => a.start - b.start || b.end - a.end);
  const warnings = [];
  const result = [];

  for (const span of valid) {
    let candidate = span;
    let consumed = false;
    for (let i = result.length - 1; i >= 0; i -= 1) {
      const existing = result[i];
      if (existing.end <= candidate.start) break;
      if (!overlaps(existing, candidate)) continue;
      let chosen = null;
      if (sameRange(existing, candidate)) chosen = chooseExactRange(existing, candidate);
      else if (contains(existing, candidate) || contains(candidate, existing)) chosen = chooseContainment(existing, candidate);
      if (chosen) {
        result.splice(i, 1);
        candidate = chosen;
        continue;
      }
      warnings.push({ code: 'SPAN_CONFLICT', leftType: existing.type, rightType: candidate.type, start: Math.min(existing.start, candidate.start), end: Math.max(existing.end, candidate.end) });
      result.splice(i, 1);
      consumed = true;
      break;
    }
    if (!consumed) result.push(candidate);
    result.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  return { spans: result, warnings };
}

export function validateNonOverlappingSpans(spans, sourceLength) {
  let previousEnd = 0;
  for (const span of spans) {
    if (!isValidSpan(span, sourceLength)) return false;
    if (span.start < previousEnd) return false;
    previousEnd = span.end;
  }
  return true;
}
