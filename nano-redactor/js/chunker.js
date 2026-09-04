function isHighSurrogate(code) {
  return code >= 0xD800 && code <= 0xDBFF;
}

function isLowSurrogate(code) {
  return code >= 0xDC00 && code <= 0xDFFF;
}

function safeBoundary(text, index) {
  if (index <= 0 || index >= text.length) return index;
  const prev = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  if (isHighSurrogate(prev) && isLowSurrogate(next)) return index - 1;
  return index;
}

function collectBoundaries(text, start, minEnd, hardEnd) {
  const candidates = [];
  const slice = text.slice(start, hardEnd);

  const patterns = [
    { regex: /\r?\n\r?\n/g, priority: 0 },
    { regex: /\r?\n/g, priority: 1 },
    { regex: /[。！？!?](?:[」』】）)\]]?)/g, priority: 2 },
    { regex: /[、,;；:：]\s*/g, priority: 3 },
    { regex: /\s+/g, priority: 4 },
  ];

  for (const { regex, priority } of patterns) {
    let match;
    while ((match = regex.exec(slice)) !== null) {
      const end = start + match.index + match[0].length;
      if (end >= minEnd && end <= hardEnd) candidates.push({ end, priority });
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }

  return candidates;
}

function chooseBoundary(text, start, targetEnd, hardEnd, minLength) {
  const minEnd = Math.min(hardEnd, start + minLength);
  const candidates = collectBoundaries(text, start, minEnd, hardEnd);

  if (candidates.length) {
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return Math.abs(a.end - targetEnd) - Math.abs(b.end - targetEnd);
    });
    return safeBoundary(text, candidates[0].end);
  }

  return safeBoundary(text, hardEnd);
}

/**
 * Split a source string into non-overlapping source ranges.
 * The source is never reconstructed; consumers must use source.slice(start, end).
 */
export function createChunks(source, {
  targetLength = 1600,
  maxLength = 2200,
  minLength = 500,
} = {}) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  if (!source.length) return [];
  if (!(targetLength > 0 && maxLength >= targetLength && minLength > 0)) {
    throw new RangeError('invalid chunk length options');
  }

  const chunks = [];
  let start = 0;

  while (start < source.length) {
    const remaining = source.length - start;
    let end;

    if (remaining <= maxLength) {
      end = source.length;
    } else {
      const targetEnd = Math.min(source.length, start + targetLength);
      const hardEnd = Math.min(source.length, start + maxLength);
      end = chooseBoundary(source, start, targetEnd, hardEnd, minLength);
      if (end <= start) end = safeBoundary(source, hardEnd);
      if (end <= start) end = hardEnd;
    }

    chunks.push({ start, end });
    start = end;
  }

  return chunks;
}
