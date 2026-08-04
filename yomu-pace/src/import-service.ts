import { CHUNKING_VERSION } from './chunking';
import { saveImportedDocument } from './storage';
import type {
  ChunkPageRecord,
  DocumentRecord,
  ImportPayload,
  ReaderSettings,
  SectionRecord,
} from './types';
import { processSectionInWorker } from './worker-client';

export interface ImportProgress {
  stage: 'extracting' | 'chunking' | 'saving' | 'finalizing';
  completed: number;
  total: number;
  message: string;
}

export async function persistImport(
  payload: ImportPayload,
  settings: ReaderSettings,
  onProgress: (progress: ImportProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  const documentId = `doc-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const sections: SectionRecord[] = [];
  const pages: ChunkPageRecord[] = [];
  let documentStart = 0;
  let chunkCount = 0;

  onProgress({ stage: 'extracting', completed: 0, total: payload.sections.length, message: '本文構造を確認しています…' });

  for (let index = 0; index < payload.sections.length; index += 1) {
    if (signal?.aborted) throw new DOMException('処理を中止しました。', 'AbortError');
    const imported = payload.sections[index];
    if (!imported) continue;
    onProgress({ stage: 'chunking', completed: index, total: payload.sections.length, message: `${index + 1}/${payload.sections.length} セクションを分割しています…` });
    const result = await processSectionInWorker({
      documentId,
      sectionId: imported.id,
      documentStart,
      sourceText: imported.sourceText,
      blocks: imported.blocks,
      preset: settings.chunkLength,
    }, signal);

    const section: SectionRecord = {
      id: imported.id,
      documentId,
      order: index,
      sourceText: imported.sourceText,
      normalizedText: result.normalizedText,
      characterCount: result.normalizedText.length,
      blockCount: imported.blocks.length,
      chunkCount: result.chunks.length,
      documentStart,
      documentEnd: documentStart + result.normalizedText.length,
      blocks: imported.blocks,
    };
    if (imported.title) section.title = imported.title;
    if (imported.sourceHref) section.sourceHref = imported.sourceHref;
    sections.push(section);

    for (let pageIndex = 0; pageIndex * 256 < result.chunks.length; pageIndex += 1) {
      const pageChunks = result.chunks.slice(pageIndex * 256, (pageIndex + 1) * 256);
      if (!pageChunks.length) continue;
      pages.push({
        key: `${documentId}:${imported.id}:${pageIndex}`,
        documentId,
        sectionId: imported.id,
        pageIndex,
        firstChunkOrder: pageChunks[0]?.orderInSection ?? 0,
        lastChunkOrder: pageChunks.at(-1)?.orderInSection ?? 0,
        chunks: pageChunks,
      });
    }
    chunkCount += result.chunks.length;
    documentStart = section.documentEnd + 2;
    onProgress({ stage: 'chunking', completed: index + 1, total: payload.sections.length, message: `${index + 1}/${payload.sections.length} セクションを処理しました` });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  if (!sections.length || !chunkCount) throw new Error('読むための本文チャンクを生成できませんでした。');

  const document: DocumentRecord = {
    id: documentId,
    schemaVersion: 1,
    status: 'staging',
    title: payload.title,
    sourceType: payload.sourceType,
    importedAt: now,
    updatedAt: now,
    characterCount: sections.reduce((total, section) => total + section.characterCount, 0),
    sectionCount: sections.length,
    chunkCount,
    chunkingVersion: CHUNKING_VERSION,
    importWarnings: payload.warnings,
  };
  if (payload.author) document.author = payload.author;
  if (payload.sourceFileName) document.sourceFileName = payload.sourceFileName;
  if (payload.sourceMimeType) document.sourceMimeType = payload.sourceMimeType;
  if (payload.originalSource) document.originalSource = payload.originalSource;
  if (sections[0]) document.currentSectionId = sections[0].id;

  onProgress({ stage: 'saving', completed: 0, total: 1, message: '端末に保存しています…' });
  await saveImportedDocument(document, sections, pages);
  onProgress({ stage: 'finalizing', completed: 1, total: 1, message: '取込みが完了しました' });
  return documentId;
}
