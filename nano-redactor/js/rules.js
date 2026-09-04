function pushUnique(out, seen, candidate) {
  const key = `${candidate.start}:${candidate.end}:${candidate.type}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(candidate);
}

function collectSimple(text, regex, type, kind, out, seen) {
  let match;
  while ((match = regex.exec(text)) !== null) {
    const value = match[0];
    if (!value) {
      regex.lastIndex += 1;
      continue;
    }
    pushUnique(out, seen, {
      text: value,
      type,
      kind,
      start: match.index,
      end: match.index + value.length,
      source: 'rule',
    });
  }
}

function collectCaptured(text, regex, groupIndex, type, kind, out, seen) {
  let match;
  while ((match = regex.exec(text)) !== null) {
    const value = match[groupIndex];
    if (!value) {
      if (match[0].length === 0) regex.lastIndex += 1;
      continue;
    }
    const offset = match[0].indexOf(value);
    const start = match.index + Math.max(0, offset);
    pushUnique(out, seen, {
      text: value,
      type,
      kind,
      start,
      end: start + value.length,
      source: 'rule',
    });
  }
}

/**
 * Format-based candidates. In standard mode these are hints for Nano, not
 * automatic proof that a value is personal information.
 */
export function extractRuleCandidates(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');

  const out = [];
  const seen = new Set();

  collectSimple(
    text,
    /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/giu,
    'EMAIL',
    'email',
    out,
    seen,
  );

  // Japanese domestic numbers and +81 notation. The leading/trailing guards
  // are captured outside the candidate so punctuation remains untouched.
  collectCaptured(
    text,
    /(?:^|[^0-9])((?:\+81[-\s]?(?:\(0\))?\d{1,4}|0\d{1,4})[-\s]?\d{1,4}[-\s]?\d{3,4})(?=$|[^0-9])/g,
    1,
    'PHONE',
    'phone',
    out,
    seen,
  );

  collectSimple(
    text,
    /〒?\s?\d{3}-\d{4}/g,
    'ADDRESS',
    'postcode',
    out,
    seen,
  );

  // Social-style handles only when they are clearly token-delimited. This is
  // deliberately conservative to avoid treating email local parts as handles.
  collectCaptured(
    text,
    /(?:^|[\s（(「『【])(@[A-Za-z0-9_]{2,32})\b/g,
    1,
    'ACCOUNT',
    'handle',
    out,
    seen,
  );

  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

export function ruleCandidatesToSpans(candidates, chunkStart = 0, {
  mode = 'standard',
  aiAvailable = true,
} = {}) {
  const shouldAutoMask = (candidate) => {
    if (mode === 'strict') return candidate.type === 'EMAIL' || candidate.type === 'PHONE';
    if (!aiAvailable) return candidate.type === 'EMAIL' || candidate.type === 'PHONE';
    return false;
  };

  return candidates
    .filter(shouldAutoMask)
    .map((candidate) => ({
      start: chunkStart + candidate.start,
      end: chunkStart + candidate.end,
      type: candidate.type,
      source: 'rule',
      text: candidate.text,
    }));
}
