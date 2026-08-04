const DB_NAME = 'yomu-pace-static';
const DB_VERSION = 1;
let dbPromise;

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB operation failed'));
  });
}

export function openDatabase() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const documents = db.createObjectStore('documents', { keyPath: 'id' });
      documents.createIndex('updatedAt', 'updatedAt');
      db.createObjectStore('positions', { keyPath: 'documentId' });
      db.createObjectStore('settings', { keyPath: 'key' });
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('documentId', 'documentId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
  });
  return dbPromise;
}

async function store(name, mode = 'readonly') {
  const db = await openDatabase();
  return db.transaction(name, mode).objectStore(name);
}

export async function listDocuments() {
  const values = await requestPromise((await store('documents')).getAll());
  return values.sort((a, b) => String(b.lastOpenedAt ?? b.updatedAt).localeCompare(String(a.lastOpenedAt ?? a.updatedAt)));
}

export async function getDocument(id) {
  return requestPromise((await store('documents')).get(id));
}

export async function saveDocument(document) {
  await requestPromise((await store('documents', 'readwrite')).put(document));
  return document;
}

export async function deleteDocument(id) {
  const db = await openDatabase();
  const tx = db.transaction(['documents', 'positions', 'sessions'], 'readwrite');
  tx.objectStore('documents').delete(id);
  tx.objectStore('positions').delete(id);
  const sessionCursor = tx.objectStore('sessions').index('documentId').openCursor(IDBKeyRange.only(id));
  sessionCursor.onsuccess = () => {
    const cursor = sessionCursor.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error ?? new Error('文書を削除できませんでした。'));
    tx.onabort = () => reject(tx.error ?? new Error('文書の削除が中断されました。'));
  });
}

export async function getPosition(documentId) {
  return requestPromise((await store('positions')).get(documentId));
}

export async function savePosition(position) {
  await requestPromise((await store('positions', 'readwrite')).put(position));
}

export async function getSettings(defaults) {
  const record = await requestPromise((await store('settings')).get('reader'));
  return { ...defaults, ...(record?.value ?? {}) };
}

export async function saveSettings(value) {
  await requestPromise((await store('settings', 'readwrite')).put({ key: 'reader', value }));
}

export async function saveSession(session) {
  await requestPromise((await store('sessions', 'readwrite')).put(session));
}

export async function clearAllData() {
  const db = await openDatabase();
  const names = ['documents', 'positions', 'settings', 'sessions'];
  const tx = db.transaction(names, 'readwrite');
  names.forEach((name) => tx.objectStore(name).clear());
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error ?? new Error('データを削除できませんでした。'));
    tx.onabort = () => reject(tx.error ?? new Error('データ削除が中断されました。'));
  });
}
