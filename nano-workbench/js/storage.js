import { DB_NAME, DB_VERSION, DEFAULT_SETTINGS, APP_VERSION } from './config.js';
import { id, now } from './utils.js';

let dbPromise;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function ensureIndex(store, name, keyPath, options) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

function createV1Stores(db) {
  if (!db.objectStoreNames.contains('conversations')) {
    const conversations = db.createObjectStore('conversations', { keyPath: 'id' });
    conversations.createIndex('updatedAt', 'updatedAt');
    conversations.createIndex('pinned', 'pinned');
    conversations.createIndex('status', 'status');
  }
  if (!db.objectStoreNames.contains('messages')) {
    const messages = db.createObjectStore('messages', { keyPath: 'id' });
    messages.createIndex('conversationId', 'conversationId');
    messages.createIndex('conversationCreated', ['conversationId', 'createdAt']);
    messages.createIndex('parentMessageId', 'parentMessageId');
  }
  if (!db.objectStoreNames.contains('attachments')) {
    const attachments = db.createObjectStore('attachments', { keyPath: 'id' });
    attachments.createIndex('conversationId', 'conversationId');
    attachments.createIndex('messageId', 'messageId');
  }
  if (!db.objectStoreNames.contains('summaries')) {
    const summaries = db.createObjectStore('summaries', { keyPath: 'id' });
    summaries.createIndex('conversationId', 'conversationId');
  }
  if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
  if (!db.objectStoreNames.contains('logs')) {
    const logs = db.createObjectStore('logs', { keyPath: 'id' });
    logs.createIndex('conversationId', 'conversationId');
    logs.createIndex('timestamp', 'timestamp');
    logs.createIndex('eventType', 'eventType');
  }
}

function migrateV1ToV2(db, tx) {
  const conversations = tx.objectStore('conversations');
  ensureIndex(conversations, 'projectId', 'projectId');
  conversations.openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (!cursor) return;
    const value = cursor.value;
    let changed = false;
    if (!Object.prototype.hasOwnProperty.call(value, 'projectId')) { value.projectId = null; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(value, 'styleOverrideId')) { value.styleOverrideId = null; changed = true; }
    if (changed) cursor.update(value);
    cursor.continue();
  };

  if (!db.objectStoreNames.contains('projects')) {
    const s = db.createObjectStore('projects', { keyPath: 'id' });
    s.createIndex('updatedAt', 'updatedAt');
  }
  if (!db.objectStoreNames.contains('projectMemories')) {
    const s = db.createObjectStore('projectMemories', { keyPath: 'id' });
    s.createIndex('projectId', 'projectId');
    s.createIndex('projectEnabled', ['projectId', 'enabled']);
    s.createIndex('category', 'category');
  }
  if (!db.objectStoreNames.contains('customStyles')) {
    const s = db.createObjectStore('customStyles', { keyPath: 'id' });
    s.createIndex('updatedAt', 'updatedAt');
  }
  if (!db.objectStoreNames.contains('customSkills')) {
    const s = db.createObjectStore('customSkills', { keyPath: 'id' });
    s.createIndex('updatedAt', 'updatedAt');
  }
  if (!db.objectStoreNames.contains('harnessRuns')) {
    const s = db.createObjectStore('harnessRuns', { keyPath: 'id' });
    s.createIndex('conversationId', 'conversationId');
    s.createIndex('sourceMessageId', 'sourceMessageId');
    s.createIndex('status', 'status');
  }
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      const oldVersion = event.oldVersion || 0;
      if (oldVersion < 1) createV1Stores(db);
      if (oldVersion < 2) migrateV1ToV2(db, tx);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => console.warn('Nano Workbench DB upgrade is blocked by another tab.');
  });
  return dbPromise;
}

export function resetDbConnectionForTests() { dbPromise = undefined; }

async function store(name, mode = 'readonly') {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function put(name, value) { return request((await store(name, 'readwrite')).put(value)); }
export async function get(name, key) { return request((await store(name)).get(key)); }
export async function del(name, key) { return request((await store(name, 'readwrite')).delete(key)); }
export async function getAll(name) { return request((await store(name)).getAll()); }
export async function getAllByIndex(name, index, query) { return request((await store(name)).index(index).getAll(query)); }

export async function getWorkspaceState() {
  const entry = await get('settings', 'workspace');
  return { activeProjectId: null, ...(entry?.value || {}) };
}

export async function saveWorkspaceState(value) {
  await put('settings', { key: 'workspace', value });
}

export async function createConversation(title = '新しい会話', projectId = undefined) {
  const ts = now();
  let resolvedProjectId = projectId;
  if (resolvedProjectId === undefined) {
    try { resolvedProjectId = (await getWorkspaceState()).activeProjectId ?? null; }
    catch { resolvedProjectId = null; }
  }
  const conversation = {
    id: id('conv'), title, createdAt: ts, updatedAt: ts, pinned: false,
    status: 'active', compactSummaryId: null, activeLeafId: null, schemaVersion: 2,
    projectId: resolvedProjectId ?? null, styleOverrideId: null,
  };
  await put('conversations', conversation);
  return conversation;
}

export async function listConversations() {
  const items = await getAll('conversations');
  return items.filter((x) => x.status !== 'deleted').sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export async function listConversationsByProject(projectId) {
  const items = await listConversations();
  return items.filter((x) => (x.projectId ?? null) === (projectId ?? null));
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
  const tx = db.transaction(['conversations', 'messages', 'attachments', 'summaries', 'harnessRuns'], 'readwrite');
  tx.objectStore('conversations').delete(conversationId);
  for (const storeName of ['messages', 'attachments', 'summaries', 'harnessRuns']) {
    const s = tx.objectStore(storeName);
    const idx = s.index('conversationId');
    const range = IDBKeyRange.only(conversationId);
    idx.openCursor(range).onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  }
  await transactionDone(tx);
}

export async function createProject({ name, description = '', instructions = '', defaultStyleId = 'default', enabledSkillIds = [] }) {
  const ts = now();
  const project = { id: id('proj'), name: name.trim().slice(0, 100), description, instructions, defaultStyleId, enabledSkillIds: [...enabledSkillIds], createdAt: ts, updatedAt: ts, schemaVersion: 1 };
  await put('projects', project);
  return project;
}

export async function listProjects() {
  const items = await getAll('projects');
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(project) {
  const next = { ...project, updatedAt: now() };
  await put('projects', next);
  return next;
}

export async function moveConversationToProject(conversationId, projectId) {
  const conversation = await get('conversations', conversationId);
  if (!conversation) return null;
  conversation.projectId = projectId ?? null;
  conversation.updatedAt = now();
  await put('conversations', conversation);
  return conversation;
}

export async function deleteProject(projectId) {
  const db = await openDb();
  const tx = db.transaction(['projects', 'projectMemories', 'conversations'], 'readwrite');
  tx.objectStore('projects').delete(projectId);

  const memoryIndex = tx.objectStore('projectMemories').index('projectId');
  memoryIndex.openCursor(IDBKeyRange.only(projectId)).onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) { cursor.delete(); cursor.continue(); }
  };

  tx.objectStore('conversations').openCursor().onsuccess = (event) => {
    const cursor = event.target.result;
    if (!cursor) return;
    const value = cursor.value;
    if (value.projectId === projectId) {
      value.projectId = null;
      value.updatedAt = now();
      cursor.update(value);
    }
    cursor.continue();
  };
  await transactionDone(tx);
}

export async function listProjectMemories(projectId) {
  if (!projectId) return [];
  const items = await getAllByIndex('projectMemories', 'projectId', projectId);
  return items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.priority || 1) - (a.priority || 1) || b.updatedAt - a.updatedAt);
}

export async function saveProjectMemory(memory) {
  const ts = now();
  const next = {
    id: memory.id || id('mem'), projectId: memory.projectId, category: memory.category || 'other',
    text: String(memory.text || '').trim(), sourceMessageId: memory.sourceMessageId || null,
    enabled: memory.enabled !== false, pinned: !!memory.pinned, priority: Math.min(3, Math.max(1, Number(memory.priority || 2))),
    createdAt: memory.createdAt || ts, updatedAt: ts,
  };
  await put('projectMemories', next);
  return next;
}

export async function deleteProjectMemory(memoryId) { await del('projectMemories', memoryId); }
export async function listCustomStyles() { return (await getAll('customStyles')).sort((a, b) => b.updatedAt - a.updatedAt); }
export async function saveCustomStyle(style) { const ts = now(); const next = { ...style, id: style.id || id('style'), builtIn: false, createdAt: style.createdAt || ts, updatedAt: ts }; await put('customStyles', next); return next; }
export async function deleteCustomStyle(styleId) { await del('customStyles', styleId); }
export async function listCustomSkills() { return (await getAll('customSkills')).sort((a, b) => b.updatedAt - a.updatedAt); }
export async function saveCustomSkill(skill) { const ts = now(); const next = { ...skill, id: skill.id || id('skill'), builtIn: false, createdAt: skill.createdAt || ts, updatedAt: ts }; await put('customSkills', next); return next; }
export async function deleteCustomSkill(skillId) { await del('customSkills', skillId); }
export async function listHarnessRuns(conversationId = null) { return conversationId ? getAllByIndex('harnessRuns', 'conversationId', conversationId) : getAll('harnessRuns'); }
export async function saveHarnessRun(run) { const next = { ...run, updatedAt: now() }; await put('harnessRuns', next); return next; }
export async function deleteHarnessRun(runId) { await del('harnessRuns', runId); }

export async function cancelStaleHarnessRuns() {
  const runs = await getAll('harnessRuns');
  const active = new Set(['planning', 'waiting_user', 'ready']);
  await Promise.all(runs.filter((x) => active.has(x.status)).map((x) => put('harnessRuns', { ...x, status: 'cancelled', updatedAt: now(), errorCode: 'RELOAD_CANCELLED' })));
  return runs.filter((x) => active.has(x.status)).length;
}

export async function getSettings() {
  const entry = await get('settings', 'app');
  return { ...DEFAULT_SETTINGS, ...(entry?.value || {}) };
}

export async function saveSettings(settings) { await put('settings', { key: 'app', value: settings }); }

export async function logEvent(eventType, data = {}) {
  try {
    await put('logs', { id: id('log'), timestamp: now(), eventType, appVersion: APP_VERSION, ...data });
  } catch (error) { console.warn('Log persistence failed', error); }
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
