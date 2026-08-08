import { DB_NAME, DB_VERSION, DEFAULT_SETTINGS, APP_VERSION } from './config.js';
import { id, now } from './utils.js';

let dbPromise;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const conversations = db.createObjectStore('conversations', { keyPath: 'id' });
      conversations.createIndex('updatedAt', 'updatedAt');
      conversations.createIndex('pinned', 'pinned');
      conversations.createIndex('status', 'status');

      const messages = db.createObjectStore('messages', { keyPath: 'id' });
      messages.createIndex('conversationId', 'conversationId');
      messages.createIndex('conversationCreated', ['conversationId', 'createdAt']);
      messages.createIndex('parentMessageId', 'parentMessageId');

      const attachments = db.createObjectStore('attachments', { keyPath: 'id' });
      attachments.createIndex('conversationId', 'conversationId');
      attachments.createIndex('messageId', 'messageId');

      const summaries = db.createObjectStore('summaries', { keyPath: 'id' });
      summaries.createIndex('conversationId', 'conversationId');

      db.createObjectStore('settings', { keyPath: 'key' });

      const logs = db.createObjectStore('logs', { keyPath: 'id' });
      logs.createIndex('conversationId', 'conversationId');
      logs.createIndex('timestamp', 'timestamp');
      logs.createIndex('eventType', 'eventType');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function store(name, mode = 'readonly') {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function put(name, value) {
  return request((await store(name, 'readwrite')).put(value));
}
export async function get(name, key) {
  return request((await store(name)).get(key));
}
export async function del(name, key) {
  return request((await store(name, 'readwrite')).delete(key));
}
export async function getAll(name) {
  return request((await store(name)).getAll());
}
export async function getAllByIndex(name, index, query) {
  return request((await store(name)).index(index).getAll(query));
}

export async function createConversation(title = '新しい会話') {
  const ts = now();
  const conversation = {
    id: id('conv'), title, createdAt: ts, updatedAt: ts, pinned: false,
    status: 'active', compactSummaryId: null, activeLeafId: null, schemaVersion: 1,
  };
  await put('conversations', conversation);
  return conversation;
}

export async function listConversations() {
  const items = await getAll('conversations');
  return items.filter((x) => x.status !== 'deleted').sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export async function listMessages(conversationId) {
  const items = await getAllByIndex('messages', 'conversationId', conversationId);
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function activeBranch(conversation) {
  if (!conversation?.activeLeafId) return [];
  const messages = await listMessages(conversation.id);
  const map = new Map(messages.map((m) => [m.id, m]));
  const branch = [];
  let cursor = map.get(conversation.activeLeafId);
  const guard = new Set();
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    branch.push(cursor);
    cursor = cursor.parentMessageId ? map.get(cursor.parentMessageId) : null;
  }
  return branch.reverse();
}

export async function siblingsOf(message) {
  const all = await listMessages(message.conversationId);
  return all.filter((m) => m.parentMessageId === message.parentMessageId && m.role === message.role)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveMessage(message) {
  await put('messages', message);
  const conversation = await get('conversations', message.conversationId);
  if (conversation) {
    conversation.activeLeafId = message.id;
    conversation.updatedAt = now();
    await put('conversations', conversation);
  }
  return message;
}

export async function removeConversation(conversationId) {
  const db = await openDb();
  const tx = db.transaction(['conversations', 'messages', 'attachments', 'summaries'], 'readwrite');
  tx.objectStore('conversations').delete(conversationId);
  for (const storeName of ['messages', 'attachments', 'summaries']) {
    const s = tx.objectStore(storeName);
    const idx = s.index('conversationId');
    const range = IDBKeyRange.only(conversationId);
    idx.openCursor(range).onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSettings() {
  const entry = await get('settings', 'app');
  return { ...DEFAULT_SETTINGS, ...(entry?.value || {}) };
}

export async function saveSettings(settings) {
  await put('settings', { key: 'app', value: settings });
}

export async function logEvent(eventType, data = {}) {
  try {
    await put('logs', {
      id: id('log'), timestamp: now(), eventType, appVersion: APP_VERSION, ...data,
    });
  } catch (error) {
    console.warn('Log persistence failed', error);
  }
}

export async function purgeOldLogs(days = 30) {
  const cutoff = now() - days * 86400000;
  const logs = await getAll('logs');
  await Promise.all(logs.filter((x) => x.timestamp < cutoff).map((x) => del('logs', x.id)));
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}
