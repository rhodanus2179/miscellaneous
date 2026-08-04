import { openDB, type DBSchema } from 'idb';
import type {
  ChunkPageRecord,
  DocumentRecord,
  ReaderSettings,
  ReadingPositionRecord,
  SectionRecord,
} from './types';

interface SessionRecord {
  id: string;
  documentId: string;
  startedAt: string;
  endedAt: string;
  startOffset: number;
  endOffset: number;
  activeMs: number;
  elapsedMs: number;
  backwardCount: number;
  pauseCount: number;
}

interface SettingsRecord {
  key: string;
  value: ReaderSettings;
}

interface YomuPaceDB extends DBSchema {
  documents: {
    key: string;
    value: DocumentRecord;
    indexes: { 'by-status': string; 'by-updated': string };
  };
  sections: {
    key: string;
    value: SectionRecord;
    indexes: { 'by-document': string; 'by-document-order': [string, number] };
  };
  chunkPages: {
    key: string;
    value: ChunkPageRecord;
    indexes: { 'by-document': string; 'by-section-page': [string, string, number] };
  };
  positions: {
    key: string;
    value: ReadingPositionRecord;
    indexes: { 'by-updated': string };
  };
  sessions: {
    key: string;
    value: SessionRecord;
    indexes: { 'by-document': string; 'by-started': string };
  };
  settings: {
    key: string;
    value: SettingsRecord;
  };
}

const databasePromise = openDB<YomuPaceDB>('yomu-pace', 1, {
  upgrade(database) {
    const documents = database.createObjectStore('documents', { keyPath: 'id' });
    documents.createIndex('by-status', 'status');
    documents.createIndex('by-updated', 'updatedAt');

    const sections = database.createObjectStore('sections', { keyPath: 'id' });
    sections.createIndex('by-document', 'documentId');
    sections.createIndex('by-document-order', ['documentId', 'order']);

    const pages = database.createObjectStore('chunkPages', { keyPath: 'key' });
    pages.createIndex('by-document', 'documentId');
    pages.createIndex('by-section-page', ['documentId', 'sectionId', 'pageIndex']);

    const positions = database.createObjectStore('positions', { keyPath: 'documentId' });
    positions.createIndex('by-updated', 'updatedAt');

    const sessions = database.createObjectStore('sessions', { keyPath: 'id' });
    sessions.createIndex('by-document', 'documentId');
    sessions.createIndex('by-started', 'startedAt');

    database.createObjectStore('settings', { keyPath: 'key' });
  },
});

export async function listDocuments(): Promise<DocumentRecord[]> {
  const database = await databasePromise;
  const documents = await database.getAllFromIndex('documents', 'by-status', 'ready');
  return documents.sort((a, b) => (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt));
}

export async function getDocument(documentId: string): Promise<DocumentRecord | undefined> {
  return (await databasePromise).get('documents', documentId);
}

export async function getSections(documentId: string): Promise<SectionRecord[]> {
  const database = await databasePromise;
  const sections = await database.getAllFromIndex('sections', 'by-document', documentId);
  return sections.sort((a, b) => a.order - b.order);
}

export async function getChunkPages(documentId: string): Promise<ChunkPageRecord[]> {
  const database = await databasePromise;
  const pages = await database.getAllFromIndex('chunkPages', 'by-document', documentId);
  return pages.sort((a, b) => {
    if (a.sectionId === b.sectionId) return a.pageIndex - b.pageIndex;
    return a.firstChunkOrder - b.firstChunkOrder;
  });
}

export async function saveImportedDocument(
  document: DocumentRecord,
  sections: SectionRecord[],
  pages: ChunkPageRecord[],
): Promise<void> {
  const database = await databasePromise;
  const transaction = database.transaction(['documents', 'sections', 'chunkPages'], 'readwrite');
  await transaction.objectStore('documents').put({ ...document, status: 'staging' });
  for (const section of sections) await transaction.objectStore('sections').put(section);
  for (const page of pages) await transaction.objectStore('chunkPages').put(page);
  await transaction.objectStore('documents').put({ ...document, status: 'ready' });
  await transaction.done;
}

export async function updateDocument(documentId: string, patch: Partial<DocumentRecord>): Promise<void> {
  const database = await databasePromise;
  const current = await database.get('documents', documentId);
  if (!current) return;
  await database.put('documents', { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() });
}

export async function deleteDocument(documentId: string): Promise<void> {
  const database = await databasePromise;
  const transaction = database.transaction(['documents', 'sections', 'chunkPages', 'positions', 'sessions'], 'readwrite');
  const sectionKeys = await transaction.objectStore('sections').index('by-document').getAllKeys(documentId);
  const pageKeys = await transaction.objectStore('chunkPages').index('by-document').getAllKeys(documentId);
  const sessionKeys = await transaction.objectStore('sessions').index('by-document').getAllKeys(documentId);
  sectionKeys.forEach((key) => transaction.objectStore('sections').delete(key));
  pageKeys.forEach((key) => transaction.objectStore('chunkPages').delete(key));
  sessionKeys.forEach((key) => transaction.objectStore('sessions').delete(key));
  transaction.objectStore('positions').delete(documentId);
  transaction.objectStore('documents').delete(documentId);
  await transaction.done;
}

export async function getPosition(documentId: string): Promise<ReadingPositionRecord | undefined> {
  return (await databasePromise).get('positions', documentId);
}

export async function savePosition(position: ReadingPositionRecord): Promise<void> {
  await (await databasePromise).put('positions', position);
}

export async function getSettings(): Promise<ReaderSettings | undefined> {
  return (await databasePromise).get('settings', 'reader').then((record) => record?.value);
}

export async function saveSettings(settings: ReaderSettings): Promise<void> {
  await (await databasePromise).put('settings', { key: 'reader', value: settings });
}

export async function saveSession(session: SessionRecord): Promise<void> {
  await (await databasePromise).put('sessions', session);
}

export async function clearAllData(): Promise<void> {
  const database = await databasePromise;
  const transaction = database.transaction(['documents', 'sections', 'chunkPages', 'positions', 'sessions', 'settings'], 'readwrite');
  await Promise.all([
    transaction.objectStore('documents').clear(),
    transaction.objectStore('sections').clear(),
    transaction.objectStore('chunkPages').clear(),
    transaction.objectStore('positions').clear(),
    transaction.objectStore('sessions').clear(),
    transaction.objectStore('settings').clear(),
  ]);
  await transaction.done;
}

export async function cleanupStagingDocuments(): Promise<void> {
  const database = await databasePromise;
  const staging = await database.getAllFromIndex('documents', 'by-status', 'staging');
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const document of staging) {
    if (Date.parse(document.updatedAt) < cutoff) await deleteDocument(document.id);
  }
}
