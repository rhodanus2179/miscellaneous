import { loadDefaultJapaneseParser } from 'budoux';
import type {
  ChunkKind,
  ChunkLengthPreset,
  PauseClass,
  ReadingChunk,
  TextBlock,
  WorkerSectionInput,
  WorkerSectionResult,
} from './types';

export const CHUNKING_VERSION = 'yp-chunk-1';

const PRESETS: Record<ChunkLengthPreset, { target: number; softMin: number; softMax: number; hardMax: number }> = {
  short: { target: 11, softMin: 6, softMax: 16, hardMax: 24 },
  standard: { target: 16, softMin: 8, softMax: 24, hardMax: 32 },
  long: { target: 23, softMin: 12, softMax: 32, hardMax: 44 },
};

const UNIT_TEST = /(?:%|％|t|kg|g|mg|km|cm|mm|m²|m³|m2|m3|L|mL|円|万円|億円|人|件|台|本|枚|日|月|年|時間|分|秒|℃|度)(?:\b|$)/iu;
const URL_PATTERN = /https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gu;
const URL_TEST = /^https?:\/\//iu;
const PARTICLE_ONLY = /^(?:[、，・\s]*(?:は|が|を|に|へ|で|と|の|も|や|か|から|まで|より|です|ます|である|だった|となる)[、，・\s]*)+$/u;
const OPEN_BRACKET_END = /[（([｛「『【〈《〔]$/u;
const CLOSE_BRACKET_START = /^[）)\]｝」』】〉》〕、。，．！？!?]/u;

let parser: ReturnType<typeof loadDefaultJapaneseParser> | undefined;

interface Range {
  start: number;
  end: number;
}

interface ProtectedRange extends Range {
  priority: number;
}

interface Candidate {
  position: number;
  mask: number;
}

const MASK_FALLBACK = 1;
const MASK_BUDOUX = 2;
const MASK_PUNCTUATION = 4;
const MASK_SENTENCE = 8;

export function normalizeForReading(text: string): string {
  return text
    .replace(/^\uFEFF/u, '')
    .replace(/\u0000/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/\u00A0/gu, ' ')
    .replace(/[\t\f\v ]{2,}/gu, ' ');
}

function segmenter(): Intl.Segmenter | undefined {
  return typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ja', { granularity: 'grapheme' })
    : undefined;
}

function graphemeBoundaries(text: string): number[] {
  const result = [0];
  const intl = segmenter();
  if (intl) {
    for (const part of intl.segment(text)) result.push(part.index + part.segment.length);
  } else {
    let offset = 0;
    for (const char of Array.from(text)) {
      offset += char.length;
      result.push(offset);
    }
  }
  if (result.at(-1) !== text.length) result.push(text.length);
  return result;
}

export function visibleCharacterCount(text: string): number {
  const compact = text.replace(/[\s\n]/gu, '');
  const intl = segmenter();
  if (!intl) return Array.from(compact).length;
  let count = 0;
  for (const _part of intl.segment(compact)) count += 1;
  return count;
}

function collectMatches(text: string, regex: RegExp, priority: number, output: ProtectedRange[]): void {
  for (const match of text.matchAll(regex)) {
    const value = match[0];
    const start = match.index ?? 0;
    if (value) output.push({ start, end: start + value.length, priority });
  }
}

export function protectedRanges(text: string): Range[] {
  const ranges: ProtectedRange[] = [];
  collectMatches(text, /`[^`\n]+`/gu, 100, ranges);
  collectMatches(text, URL_PATTERN, 90, ranges);
  collectMatches(text, /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[A-Za-z]{2,}/gu, 85, ranges);
  collectMatches(text, /(?:令和|平成|昭和)?\s*\d{1,4}年\s*\d{1,2}月(?:\s*\d{1,2}日)?/gu, 80, ranges);
  collectMatches(text, /\d{1,2}:\d{2}(?:\s*[〜～-]\s*\d{1,2}:\d{2})?/gu, 80, ranges);
  collectMatches(text, /第\s*[一二三四五六七八九十百千万0-9]+\s*(?:条|項|号)/gu, 75, ranges);
  collectMatches(text, /\d+(?:[.,]\d+)?\s*(?:%|％|t|kg|g|mg|km|cm|mm|m²|m³|m2|m3|L|mL|円|万円|億円|人|件|台|本|枚|日|月|年|時間|分|秒|℃|度)/giu, 70, ranges);
  collectMatches(text, /[A-Za-z][A-Za-z0-9._/+:-]{2,}/gu, 60, ranges);

  ranges.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || b.priority - a.priority);
  const selected: ProtectedRange[] = [];
  for (const range of ranges) {
    if (!selected.some((item) => range.start < item.end && range.end > item.start)) selected.push(range);
  }
  return selected.sort((a, b) => a.start - b.start).map(({ start, end }) => ({ start, end }));
}

function isInsideProtected(position: number, ranges: Range[]): boolean {
  return ranges.some((range) => position > range.start && position < range.end);
}

function sentenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const protectedSpans = protectedRanges(text);
  let start = 0;
  let index = 0;
  const closers = new Set(['」', '』', '】', '〉', '》', '〕', ')', '）', ']', '｝']);

  while (index < text.length) {
    const char = text[index] ?? '';
    if ('。！？!?'.includes(char) && !isInsideProtected(index, protectedSpans)) {
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

function addCandidate(map: Map<number, number>, position: number, mask: number): void {
  map.set(position, (map.get(position) ?? 0) | mask);
}

function candidateBoundaries(text: string, protectedSpans: Range[]): Candidate[] {
  const map = new Map<number, number>();
  addCandidate(map, 0, MASK_SENTENCE);
  addCandidate(map, text.length, MASK_SENTENCE);

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
    .filter(([position]) => !isInsideProtected(position, protectedSpans))
    .map(([position, mask]) => ({ position, mask }))
    .sort((a, b) => a.position - b.position);
}

function boundaryReward(mask: number): number {
  if (mask & MASK_SENTENCE) return 8;
  if (mask & MASK_PUNCTUATION) return 5;
  if (mask & MASK_BUDOUX) return 3;
  return 0;
}

function segmentPenalty(text: string, length: number, preset: typeof PRESETS.standard, endMask: number): number {
  let cost = Math.pow((length - preset.target) / preset.target, 2) * 10;
  if (length < preset.softMin) cost += Math.pow(preset.softMin - length, 2) * 1.8;
  if (length > preset.softMax) cost += Math.pow(length - preset.softMax, 2) * 1.2;
  if (length > preset.hardMax) cost += 800 + Math.pow(length - preset.hardMax, 2) * 8;
  if (PARTICLE_ONLY.test(text)) cost += 140;
  if (CLOSE_BRACKET_START.test(text)) cost += 90;
  if (OPEN_BRACKET_END.test(text)) cost += 90;
  if (/^[、。，．！？!?]/u.test(text)) cost += 120;
  cost -= boundaryReward(endMask);
  return cost;
}

function optimizeSentence(text: string, presetName: ChunkLengthPreset): Array<{ start: number; end: number; fallback: boolean }> {
  if (!text) return [];
  const preset = PRESETS[presetName];
  const protectedSpans = protectedRanges(text);
  const candidates = candidateBoundaries(text, protectedSpans);
  const size = candidates.length;
  const dp = Array<number>(size).fill(Number.POSITIVE_INFINITY);
  const previous = Array<number>(size).fill(-1);
  dp[0] = 0;

  for (let endIndex = 1; endIndex < size; endIndex += 1) {
    const end = candidates[endIndex];
    if (!end) continue;
    for (let startIndex = endIndex - 1, examined = 0; startIndex >= 0 && examined < 80; startIndex -= 1, examined += 1) {
      const start = candidates[startIndex];
      const startCost = dp[startIndex];
      if (!start || startCost === undefined || !Number.isFinite(startCost)) continue;
      const part = text.slice(start.position, end.position);
      const length = visibleCharacterCount(part);
      if (length > preset.hardMax * 2.5 && startIndex < endIndex - 1) break;
      const cost = startCost + segmentPenalty(part, length, preset, end.mask);
      const currentCost = dp[endIndex] ?? Number.POSITIVE_INFINITY;
      if (cost < currentCost) {
        dp[endIndex] = cost;
        previous[endIndex] = startIndex;
      }
    }
  }

  const finalPrevious = previous[size - 1];
  if (finalPrevious === undefined || finalPrevious === -1) return [{ start: 0, end: text.length, fallback: true }];

  const result: Array<{ start: number; end: number; fallback: boolean }> = [];
  let cursor = size - 1;
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

function kindForBlock(block: TextBlock): ChunkKind {
  switch (block.kind) {
    case 'heading': return 'heading';
    case 'list-item': return 'list';
    case 'quote': return 'quote';
    case 'code': return 'code';
    case 'table': return 'table';
    case 'url': return 'url';
    default: return 'prose';
  }
}

function pauseFor(text: string, block: TextBlock, isLastInBlock: boolean): PauseClass {
  if (block.kind === 'heading') return 'section';
  if (isLastInBlock) return 'paragraph';
  if (/[。！？!?][」』】〉》〕)）\]｝]*$/u.test(text)) return 'sentence';
  if (/[、，,；;：:]$/u.test(text)) return 'comma';
  return 'none';
}

function fnvId(value: string): string {
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

export function durationForChunk(chunk: Pick<ReadingChunk, 'visibleCharacterCount' | 'text' | 'kind' | 'pauseClass' | 'flags'>, charactersPerMinute: number, pauseScale = 1): number {
  const baseMs = chunk.visibleCharacterCount / Math.max(1, charactersPerMinute) * 60_000;
  let factor = 1;
  const hasKanji = /[\p{Script=Han}]/u.test(chunk.text);
  if (hasKanji && chunk.flags.hasLatin && chunk.flags.hasNumber) factor += 0.08;
  if (chunk.flags.hasNumber && chunk.flags.hasUnit) factor += 0.12;
  if (/[A-Za-z]{5,}/u.test(chunk.text)) factor += 0.10;
  if (chunk.flags.hasBrackets) factor += 0.05;
  if (chunk.kind === 'heading') factor += 0.15;
  if (chunk.flags.usedFallbackSplit) factor += 0.05;
  if (chunk.flags.hasUrl) factor = 1.60;
  factor = Math.min(factor, 1.45 + (chunk.flags.hasUrl ? 0.15 : 0));

  const pauses: Record<PauseClass, number> = {
    none: 0,
    comma: 140,
    sentence: 300,
    paragraph: 500,
    section: 800,
  };
  return Math.round(Math.min(5_000, Math.max(280, baseMs * factor + pauses[chunk.pauseClass] * pauseScale)));
}

function createChunk(
  input: WorkerSectionInput,
  block: TextBlock,
  text: string,
  blockOffsetStart: number,
  blockOffsetEnd: number,
  sentenceId: string,
  order: number,
  fallback: boolean,
  isLastInBlock: boolean,
): ReadingChunk {
  const sourceStart = block.sourceStart + blockOffsetStart;
  const sourceEnd = block.sourceStart + blockOffsetEnd;
  const hasUrl = URL_TEST.test(text.trim());
  const flags = {
    hasNumber: /\d/u.test(text),
    hasUnit: UNIT_TEST.test(text.trim()),
    hasLatin: /[A-Za-z]/u.test(text),
    hasUrl,
    hasBrackets: /[（()）「」『』【】〈〉《》〔〕]/u.test(text),
    isProtectedSpan: protectedRanges(text).some((range) => range.start === 0 && range.end === text.length),
    usedFallbackSplit: fallback,
  };
  const partial: ReadingChunk = {
    id: '',
    documentId: input.documentId,
    sectionId: input.sectionId,
    blockId: block.id,
    sentenceId,
    orderInSection: order,
    text,
    sourceStart,
    sourceEnd,
    documentStart: input.documentStart + sourceStart,
    documentEnd: input.documentStart + sourceEnd,
    visibleCharacterCount: visibleCharacterCount(text),
    kind: kindForBlock(block),
    pauseClass: pauseFor(text, block, isLastInBlock),
    durationMsAtBaseRate: 0,
    autoPlayable: block.autoPlayable,
    flags,
  };
  partial.id = `ch-${fnvId(`${CHUNKING_VERSION}|${input.documentId}|${input.sectionId}|${sourceStart}|${sourceEnd}|${text}`)}`;
  partial.durationMsAtBaseRate = durationForChunk(partial, 600, 1);
  return partial;
}

export function processSection(input: WorkerSectionInput): WorkerSectionResult {
  const normalizedText = normalizeForReading(input.sourceText);
  const chunks: ReadingChunk[] = [];
  let order = 0;

  for (const block of input.blocks) {
    const text = normalizeForReading(block.text);
    if (!text) continue;
    if (!block.autoPlayable || block.kind === 'url') {
      chunks.push(createChunk(input, block, text, 0, text.length, `${block.id}:0`, order, false, true));
      order += 1;
      continue;
    }

    const ranges = sentenceRanges(text);
    ranges.forEach((sentence, sentenceIndex) => {
      const sentenceText = text.slice(sentence.start, sentence.end);
      const optimized = optimizeSentence(sentenceText, input.preset);
      optimized.forEach((part, partIndex) => {
        const chunkText = sentenceText.slice(part.start, part.end);
        const isLast = sentenceIndex === ranges.length - 1 && partIndex === optimized.length - 1;
        chunks.push(createChunk(
          input,
          block,
          chunkText,
          sentence.start + part.start,
          sentence.start + part.end,
          `${block.id}:${sentenceIndex}`,
          order,
          part.fallback,
          isLast,
        ));
        order += 1;
      });
    });
  }

  return { sectionId: input.sectionId, normalizedText, chunks };
}
