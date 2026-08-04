import { loadDefaultJapaneseParser } from '../vendor/budoux/budoux.js';

export const CHUNKING_VERSION = 'yp-static-chunk-1';

export const CHUNK_PRESETS = {
  short: { target: 11, softMin: 6, softMax: 16, hardMax: 24 },
  standard: { target: 16, softMin: 8, softMax: 24, hardMax: 32 },
  long: { target: 23, softMin: 12, softMax: 32, hardMax: 44 },
};

const MASK_FALLBACK = 1;
const MASK_BUDOUX = 2;
const MASK_PUNCTUATION = 4;
const MASK_SENTENCE = 8;
const PARTICLE_ONLY = /^(?:[、，・\s]*(?:は|が|を|に|へ|で|と|の|も|や|か|から|まで|より|です|ます|である|だった|となる)[、，・\s]*)+$/u;
const OPEN_BRACKET_END = /[（([｛「『【〈《〔]$/u;
const CLOSE_BRACKET_START = /^[）)\]｝」』】〉》〕、。，．！？!?]/u;
const URL_RE = /https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gu;
const UNIT_RE = /\d+(?:[.,]\d+)?\s*(?:%|％|t|kg|g|mg|km|cm|mm|m²|m³|m2|m3|L|mL|円|万円|億円|人|件|台|本|枚|日|月|年|時間|分|秒|℃|度)(?![A-Za-z])/giu;

let parser;

export function normalizeForReading(text) {
  return text
    .replace(/^\uFEFF/u, '')
    .replace(/\u0000/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/\u00A0/gu, ' ')
    .replace(/[\t\f\v ]{2,}/gu, ' ');
}

export function visibleCharacterCount(text) {
  const compact = text.replace(/[\s\n]/gu, '');
  if (typeof Intl.Segmenter !== 'function') return Array.from(compact).length;
  return [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(compact)].length;
}

function graphemeBoundaries(text) {
  const result = [0];
  if (typeof Intl.Segmenter === 'function') {
    for (const part of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)) {
      result.push(part.index + part.segment.length);
    }
  } else {
    let offset = 0;
    for (const char of Array.from(text)) {
      offset += char.length;
      result.push(offset);
    }
  }
  if (result.at(-1) !== text.length) result.push(text.length);
  return [...new Set(result)];
}

function collectMatches(text, regex, priority, output) {
  regex.lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    if (match[0]) output.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, priority });
  }
}

export function protectedRanges(text) {
  const ranges = [];
  collectMatches(text, /`[^`\n]+`/gu, 100, ranges);
  collectMatches(text, URL_RE, 95, ranges);
  collectMatches(text, /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[A-Za-z]{2,}/gu, 90, ranges);
  collectMatches(text, /(?:令和|平成|昭和)?\s*\d{1,4}年\s*\d{1,2}月(?:\s*\d{1,2}日)?/gu, 85, ranges);
  collectMatches(text, /\d{1,2}:\d{2}(?:\s*[〜～-]\s*\d{1,2}:\d{2})?/gu, 85, ranges);
  collectMatches(text, /第\s*[一二三四五六七八九十百千万0-9]+\s*(?:条|項|号)/gu, 80, ranges);
  collectMatches(text, UNIT_RE, 75, ranges);
  collectMatches(text, /[A-Za-z][A-Za-z0-9._/+:-]{2,}/gu, 65, ranges);
  ranges.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || b.priority - a.priority);
  const selected = [];
  for (const range of ranges) {
    if (!selected.some((item) => range.start < item.end && range.end > item.start)) selected.push(range);
  }
  return selected.sort((a, b) => a.start - b.start).map(({ start, end }) => ({ start, end }));
}

function isInside(position, ranges) {
  return ranges.some((range) => position > range.start && position < range.end);
}

export function sentenceRanges(text) {
  const ranges = [];
  const protectedSpans = protectedRanges(text);
  const closers = new Set(['」', '』', '】', '〉', '》', '〕', ')', '）', ']', '｝']);
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    if ('。！？!?'.includes(char) && !isInside(index, protectedSpans)) {
      let end = index + char.length;
      while (end < text.length && closers.has(text[end] ?? '')) end += (text[end] ?? '').length;
      ranges.push({ start, end });
      start = end;
      index = end;
      continue;
    }
    index += char.length || 1;
  }
  if (start < text.length) ranges.push({ start, end: text.length });
  return ranges.filter((range) => range.end > range.start);
}

function addCandidate(map, position, mask) {
  map.set(position, (map.get(position) ?? 0) | mask);
}

function candidateBoundaries(text, protectedSpans) {
  const map = new Map([[0, MASK_SENTENCE], [text.length, MASK_SENTENCE]]);
  for (const boundary of graphemeBoundaries(text)) addCandidate(map, boundary, MASK_FALLBACK);
  parser ??= loadDefaultJapaneseParser();
  const phrases = parser.parse(text);
  if (phrases.join('') === text) {
    let offset = 0;
    for (const phrase of phrases) {
      offset += phrase.length;
      addCandidate(map, offset, MASK_BUDOUX);
    }
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if ('、，,；;：:・/／'.includes(char)) addCandidate(map, index + char.length, MASK_PUNCTUATION);
  }
  return [...map.entries()]
    .filter(([position]) => !isInside(position, protectedSpans))
    .map(([position, mask]) => ({ position, mask }))
    .sort((a, b) => a.position - b.position);
}

function boundaryReward(mask) {
  if (mask & MASK_SENTENCE) return 8;
  if (mask & MASK_PUNCTUATION) return 5;
  if (mask & MASK_BUDOUX) return 3;
  return 0;
}

function segmentPenalty(text, length, preset, endMask) {
  let cost = ((length - preset.target) / preset.target) ** 2 * 10;
  if (length < preset.softMin) cost += (preset.softMin - length) ** 2 * 1.8;
  if (length > preset.softMax) cost += (length - preset.softMax) ** 2 * 1.2;
  if (length > preset.hardMax) cost += 800 + (length - preset.hardMax) ** 2 * 8;
  if (PARTICLE_ONLY.test(text)) cost += 140;
  if (CLOSE_BRACKET_START.test(text)) cost += 90;
  if (OPEN_BRACKET_END.test(text)) cost += 90;
  if (/^[、。，．！？!?]/u.test(text)) cost += 120;
  return cost - boundaryReward(endMask);
}

function optimizeSentence(text, presetName) {
  if (!text) return [];
  const preset = CHUNK_PRESETS[presetName] ?? CHUNK_PRESETS.standard;
  const protectedSpans = protectedRanges(text);
  const candidates = candidateBoundaries(text, protectedSpans);
  const dp = Array(candidates.length).fill(Number.POSITIVE_INFINITY);
  const previous = Array(candidates.length).fill(-1);
  dp[0] = 0;
  for (let endIndex = 1; endIndex < candidates.length; endIndex += 1) {
    const end = candidates[endIndex];
    if (!end) continue;
    for (let startIndex = endIndex - 1, examined = 0; startIndex >= 0 && examined < 80; startIndex -= 1, examined += 1) {
      const start = candidates[startIndex];
      const previousCost = dp[startIndex];
      if (!start || !Number.isFinite(previousCost)) continue;
      const part = text.slice(start.position, end.position);
      const length = visibleCharacterCount(part);
      if (length > preset.hardMax * 2.5 && startIndex < endIndex - 1) break;
      const cost = previousCost + segmentPenalty(part, length, preset, end.mask);
      if (cost < dp[endIndex]) {
        dp[endIndex] = cost;
        previous[endIndex] = startIndex;
      }
    }
  }
  const lastPrevious = previous[candidates.length - 1];
  if (lastPrevious === undefined || lastPrevious < 0) return [{ start: 0, end: text.length, fallback: true }];
  const result = [];
  let cursor = candidates.length - 1;
  while (cursor > 0) {
    const before = previous[cursor];
    if (before === undefined || before < 0) return [{ start: 0, end: text.length, fallback: true }];
    const start = candidates[before];
    const end = candidates[cursor];
    if (!start || !end) return [{ start: 0, end: text.length, fallback: true }];
    const fallback = Boolean((end.mask & MASK_FALLBACK) && !(end.mask & (MASK_BUDOUX | MASK_PUNCTUATION | MASK_SENTENCE)));
    result.push({ start: start.position, end: end.position, fallback });
    cursor = before;
  }
  return result.reverse();
}

function fnvId(value) {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= code + index;
    hashB = Math.imul(hashB, 0x85ebca6b);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, '0')}${(hashB >>> 0).toString(16).padStart(8, '0')}`;
}

function pauseFor(text, block, isLast) {
  if (block.kind === 'heading') return 'section';
  if (isLast) return 'paragraph';
  if (/[。！？!?][」』】〉》〕)）\]｝]*$/u.test(text)) return 'sentence';
  if (/[、，,；;：:]$/u.test(text)) return 'comma';
  return 'none';
}

export function durationForChunk(chunk, cpm = 600, pauseScale = 1) {
  const baseMs = chunk.visibleCharacterCount / Math.max(1, cpm) * 60_000;
  let factor = 1;
  const hasKanji = /\p{Script=Han}/u.test(chunk.text);
  if (hasKanji && chunk.flags.hasLatin && chunk.flags.hasNumber) factor += 0.08;
  if (chunk.flags.hasNumber && chunk.flags.hasUnit) factor += 0.12;
  if (/[A-Za-z]{5,}/u.test(chunk.text)) factor += 0.10;
  if (chunk.flags.hasBrackets) factor += 0.05;
  if (chunk.kind === 'heading') factor += 0.15;
  if (chunk.flags.usedFallbackSplit) factor += 0.05;
  if (chunk.flags.hasUrl) factor = 1.60;
  factor = Math.min(factor, chunk.flags.hasUrl ? 1.60 : 1.45);
  const pauses = { none: 0, comma: 140, sentence: 300, paragraph: 500, section: 800 };
  return Math.round(Math.min(5_000, Math.max(280, baseMs * factor + pauses[chunk.pauseClass] * pauseScale)));
}

function createChunk(documentId, block, text, localStart, localEnd, sentenceId, order, fallback, isLast) {
  const hasUrl = /^https?:\/\//iu.test(text.trim()) || URL_RE.test(text);
  URL_RE.lastIndex = 0;
  UNIT_RE.lastIndex = 0;
  const flags = {
    hasNumber: /\d/u.test(text),
    hasUnit: UNIT_RE.test(text),
    hasLatin: /[A-Za-z]/u.test(text),
    hasUrl,
    hasBrackets: /[（()）「」『』【】〈〉《》〔〕]/u.test(text),
    usedFallbackSplit: fallback,
  };
  const sourceStart = block.sourceStart + localStart;
  const sourceEnd = block.sourceStart + localEnd;
  const chunk = {
    id: `ch-${fnvId(`${CHUNKING_VERSION}|${documentId}|${block.id}|${sourceStart}|${sourceEnd}|${text}`)}`,
    documentId,
    blockId: block.id,
    sentenceId,
    order,
    text,
    sourceStart,
    sourceEnd,
    visibleCharacterCount: visibleCharacterCount(text),
    kind: block.kind,
    autoPlayable: block.autoPlayable !== false,
    pauseClass: pauseFor(text, block, isLast),
    flags,
  };
  chunk.durationMsAtBaseRate = durationForChunk(chunk, 600, 1);
  return chunk;
}

export function chunkBlock(documentId, block, preset = 'standard') {
  const text = normalizeForReading(block.text);
  if (!text) return [];
  if (block.autoPlayable === false || block.kind === 'code' || block.kind === 'table') {
    return [createChunk(documentId, block, text, 0, text.length, `${block.id}:0`, 0, false, true)];
  }
  const output = [];
  const ranges = sentenceRanges(text);
  ranges.forEach((sentence, sentenceIndex) => {
    const sentenceText = text.slice(sentence.start, sentence.end);
    const parts = optimizeSentence(sentenceText, preset);
    parts.forEach((part, partIndex) => {
      output.push(createChunk(
        documentId,
        block,
        sentenceText.slice(part.start, part.end),
        sentence.start + part.start,
        sentence.start + part.end,
        `${block.id}:${sentenceIndex}`,
        output.length,
        part.fallback,
        sentenceIndex === ranges.length - 1 && partIndex === parts.length - 1,
      ));
    });
  });
  return output;
}

export async function chunkBlocks(documentId, blocks, preset = 'standard', onProgress = () => {}, signal) {
  const chunks = [];
  for (let index = 0; index < blocks.length; index += 1) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const blockChunks = chunkBlock(documentId, blocks[index], preset);
    for (const chunk of blockChunks) {
      chunk.order = chunks.length;
      chunks.push(chunk);
    }
    onProgress({ completed: index + 1, total: blocks.length });
    if ((index + 1) % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return chunks;
}
