import { DEFAULT_SETTINGS } from './config.js';

const DB_NAME = 'condition-pulse';
const DB_VERSION = 1;
const SESSION_STORE = 'sessions';
const SETTINGS_STORE = 'settings';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        const store = db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
        store.createIndex('localDate', 'localDate', { unique: false });
        store.createIndex('completedAt', 'completedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
  });
}

async function withStore(storeName, mode, action) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(storeName, mode);
    const result = await action(transaction.objectStore(storeName));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
    });
    return result;
  } finally {
    db.close();
  }
}

export async function getSessions() {
  const sessions = await withStore(SESSION_STORE, 'readonly', store => requestToPromise(store.getAll()));
  return sessions.sort((a, b) => new Date(a.completedAt ?? a.startedAt) - new Date(b.completedAt ?? b.startedAt));
}

export async function saveSession(session) {
  await withStore(SESSION_STORE, 'readwrite', store => requestToPromise(store.put(session)));
  return session;
}

export async function getSettings() {
  const record = await withStore(SETTINGS_STORE, 'readonly', store => requestToPromise(store.get('user')));
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...(record?.value ?? {}),
    timeBands: {
      ...structuredClone(DEFAULT_SETTINGS.timeBands),
      ...(record?.value?.timeBands ?? {})
    }
  };
}

export async function saveSettings(settings) {
  await withStore(SETTINGS_STORE, 'readwrite', store => requestToPromise(store.put({ id: 'user', value: settings })));
  return settings;
}

export async function clearAllData({ includeSettings = true } = {}) {
  await withStore(SESSION_STORE, 'readwrite', store => requestToPromise(store.clear()));
  if (includeSettings) await withStore(SETTINGS_STORE, 'readwrite', store => requestToPromise(store.clear()));
}
