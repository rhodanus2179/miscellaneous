export type SourceType = 'paste' | 'txt' | 'markdown' | 'epub';
export type BlockKind = 'heading' | 'paragraph' | 'list-item' | 'quote' | 'code' | 'table' | 'separator' | 'url';
export type ChunkKind = 'prose' | 'heading' | 'list' | 'quote' | 'code' | 'table' | 'url';
export type PauseClass = 'none' | 'comma' | 'sentence' | 'paragraph' | 'section';
export type ReaderMode = 'context' | 'highlight' | 'focus';
export type ChunkLengthPreset = 'short' | 'standard' | 'long';
export type PunctuationPause = 'small' | 'standard' | 'large';

export interface TextBlock {
  id: string;
  sectionId: string;
  order: number;
  kind: BlockKind;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  level?: number;
  autoPlayable: boolean;
}

export interface ReadingChunk {
  id: string;
  documentId: string;
  sectionId: string;
  blockId: string;
  sentenceId: string;
  orderInSection: number;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  documentStart: number;
  documentEnd: number;
  visibleCharacterCount: number;
  kind: ChunkKind;
  pauseClass: PauseClass;
  durationMsAtBaseRate: number;
  autoPlayable: boolean;
  flags: {
    hasNumber: boolean;
    hasUnit: boolean;
    hasLatin: boolean;
    hasUrl: boolean;
    hasBrackets: boolean;
    isProtectedSpan: boolean;
    usedFallbackSplit: boolean;
  };
}

export interface SectionRecord {
  id: string;
  documentId: string;
  order: number;
  title?: string;
  sourceHref?: string;
  sourceText: string;
  normalizedText: string;
  characterCount: number;
  blockCount: number;
  chunkCount: number;
  documentStart: number;
  documentEnd: number;
  blocks: TextBlock[];
}

export interface DocumentRecord {
  id: string;
  schemaVersion: 1;
  status: 'staging' | 'ready' | 'failed';
  title: string;
  author?: string;
  sourceType: SourceType;
  sourceFileName?: string;
  sourceMimeType?: string;
  importedAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  characterCount: number;
  sectionCount: number;
  chunkCount: number;
  chunkingVersion: string;
  importWarnings: string[];
  currentSectionId?: string;
  originalSource?: string;
}

export interface ChunkPageRecord {
  key: string;
  documentId: string;
  sectionId: string;
  pageIndex: number;
  firstChunkOrder: number;
  lastChunkOrder: number;
  chunks: ReadingChunk[];
}

export interface ReadingPositionRecord {
  documentId: string;
  sectionId: string;
  chunkOrderInSection: number;
  chunkId: string;
  documentOffset: number;
  progress: number;
  mode: ReaderMode;
  updatedAt: string;
}

export interface ReaderSettings {
  mode: ReaderMode;
  charactersPerMinute: number;
  chunkLength: ChunkLengthPreset;
  punctuationPause: PunctuationPause;
  fontSizePx: number;
  lineHeight: number;
  contentWidthCh: number;
  theme: 'system' | 'light' | 'dark';
  reducedMotion: boolean;
  swipeEnabled: boolean;
  sessionRetention: 'none' | '30d' | '180d' | 'forever';
}

export interface ImportedSection {
  id: string;
  title?: string;
  sourceHref?: string;
  sourceText: string;
  blocks: TextBlock[];
}

export interface ImportPayload {
  title: string;
  author?: string;
  sourceType: SourceType;
  sourceFileName?: string;
  sourceMimeType?: string;
  originalSource?: string;
  warnings: string[];
  sections: ImportedSection[];
}

export interface WorkerSectionInput {
  documentId: string;
  sectionId: string;
  documentStart: number;
  sourceText: string;
  blocks: TextBlock[];
  preset: ChunkLengthPreset;
}

export interface WorkerSectionResult {
  sectionId: string;
  normalizedText: string;
  chunks: ReadingChunk[];
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  mode: 'context',
  charactersPerMinute: 600,
  chunkLength: 'standard',
  punctuationPause: 'standard',
  fontSizePx: 34,
  lineHeight: 1.65,
  contentWidthCh: 42,
  theme: 'system',
  reducedMotion: false,
  swipeEnabled: true,
  sessionRetention: '180d',
};
