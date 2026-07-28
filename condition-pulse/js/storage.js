import { DEFAULT_SETTINGS } from './config.js';
import { normalizeQuestionPreferences } from './preferences.js';

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

function mergeSettings(record) {
  const source = record?.value ?? {};
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...source,
    timeBands: {
      ...structuredClone(DEFAULT_SETTINGS.timeBands),
      ...(source.timeBands ?? {})
    },
    questionPreferences: normalizeQuestionPreferences(source.questionPreferences)
  };
}

export async function getSessions() {
  const sessions = await withStore(SESSION_STORE, 'readonly', store => requestToPromise(store.getAll()));
  return sessions.sort((a, b) => new Date(a.completedAt ?? a.startedAt) - new Date(b.completedAt ?? b.startedAt));
}

export async function saveSession(session) {
  await withStore(SESSION_STORE, 'readwrite', store => requestToPromise(store.put(session)));
  return session;
}

export async function deleteSession(sessionId) {
  await withStore(SESSION_STORE, 'readwrite', store => requestToPromise(store.delete(sessionId)));
}

export async function getSettings() {
  const record = await withStore(SETTINGS_STORE, 'readonly', store => requestToPromise(store.get('user')));
  return mergeSettings(record);
}

export async function saveSettings(settings) {
  await withStore(SETTINGS_STORE, 'readwrite', store => requestToPromise(store.put({ id: 'user', value: settings })));
  return settings;
}

export async function importDataAtomic({ sessions, settings, mode = 'merge' }) {
  if (!['merge', 'replace'].includes(mode)) throw new RangeError('Unsupported import mode');
  const db = await openDatabase();
  try {
    const transaction = db.transaction([SESSION_STORE, SETTINGS_STORE], 'readwrite');
    const sessionStore = transaction.objectStore(SESSION_STORE);
    const settingsStore = transaction.objectStore(SETTINGS_STORE);

    if (mode === 'replace') {
      sessionStore.clear();
      settingsStore.clear();
    }

    for (const session of sessions ?? []) {
      if (mode === 'replace') {
        sessionStore.put(session);
        continue;
      }
      const lookup = sessionStore.getKey(session.id);
      lookup.onsuccess = () => {
        if (lookup.result === undefined) sessionStore.add(session);
      };
    }
    if (settings) settingsStore.put({ id: 'user', value: settings });

    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Import transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function clearAllData({ includeSettings = true } = {}) {
  const db = await openDatabase();
  try {
    const stores = includeSettings ? [SESSION_STORE, SETTINGS_STORE] : [SESSION_STORE];
    const transaction = db.transaction(stores, 'readwrite');
    transaction.objectStore(SESSION_STORE).clear();
    if (includeSettings) transaction.objectStore(SETTINGS_STORE).clear();
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Clear transaction aborted'));
    });
  } finally {
    db.close();
  }
}
