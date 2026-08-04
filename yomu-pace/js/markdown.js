function cleanInline(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/[*_~]{1,2}([^*_~]+)[*_~]{1,2}/gu, '$1')
    .trim();
}

function makeBlock(kind, text, sourceStart, sourceEnd, extra = {}) {
  return {
    id: `b-${sourceStart}-${sourceEnd}-${kind}`,
    kind,
    text,
    sourceStart,
    sourceEnd,
    autoPlayable: !['code', 'table'].includes(kind),
    ...extra,
  };
}

export function parsePlainText(source) {
  const text = source.replace(/\r\n?/gu, '\n');
  const blocks = [];
  let offset = 0;
  for (const part of text.split(/\n{2,}/u)) {
    const start = text.indexOf(part, offset);
    const end = start + part.length;
    const cleaned = part.trim();
    if (cleaned) blocks.push(makeBlock('paragraph', cleaned, start, end));
    offset = Math.max(end, offset + part.length);
  }
  return blocks;
}

export function parseMarkdown(source) {
  const text = source.replace(/\r\n?/gu, '\n');
  const lines = text.split('\n');
  const starts = [];
  let cursor = 0;
  for (const line of lines) {
    starts.push(cursor);
    cursor += line.length + 1;
  }
  const blocks = [];
  let index = 0;
  let paragraph = [];
  let paragraphStart = 0;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const raw = paragraph.join(' ');
    const value = cleanInline(raw);
    if (value) blocks.push(makeBlock('paragraph', value, paragraphStart, starts[index] ?? text.length));
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const lineStart = starts[index] ?? 0;
    if (/^```/u.test(line.trim())) {
      flushParagraph();
      const fenceStart = lineStart;
      const content = [];
      index += 1;
      while (index < lines.length && !/^```/u.test((lines[index] ?? '').trim())) {
        content.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(makeBlock('code', content.join('\n'), fenceStart, starts[index] ?? text.length));
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      flushParagraph();
      blocks.push(makeBlock('heading', cleanInline(heading[2]), lineStart, lineStart + line.length, { level: heading[1].length }));
      index += 1;
      continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/u.test(line)) {
      flushParagraph();
      blocks.push(makeBlock('separator', '——', lineStart, lineStart + line.length));
      index += 1;
      continue;
    }
    const list = line.match(/^\s*(?:[-+*]|\d+[.)])\s+(.+)$/u);
    if (list) {
      flushParagraph();
      blocks.push(makeBlock('list', cleanInline(list[1]), lineStart, lineStart + line.length));
      index += 1;
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/u);
    if (quote) {
      flushParagraph();
      blocks.push(makeBlock('quote', cleanInline(quote[1]), lineStart, lineStart + line.length));
      index += 1;
      continue;
    }
    const next = lines[index + 1] ?? '';
    if (line.includes('|') && /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/u.test(next)) {
      flushParagraph();
      const rows = [line];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
        rows.push(lines[index] ?? '');
        index += 1;
      }
      const tableText = rows.map((row) => row.split('|').map((cell) => cleanInline(cell)).filter(Boolean).join('\t')).join('\n');
      blocks.push(makeBlock('table', tableText, lineStart, starts[index] ?? text.length));
      continue;
    }
    if (!paragraph.length) paragraphStart = lineStart;
    paragraph.push(line.trim());
    index += 1;
  }
  flushParagraph();
  return blocks;
}

export function suggestedTitle(source, format) {
  if (format === 'markdown') {
    const match = source.match(/^#{1,6}\s+(.+)$/mu);
    if (match) return cleanInline(match[1]).slice(0, 80);
  }
  const first = source.split(/\r?\n/u).find((line) => line.trim());
  return first?.trim().slice(0, 40) || `文書 ${new Date().toLocaleString('ja-JP')}`;
}
