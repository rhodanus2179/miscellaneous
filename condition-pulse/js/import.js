import { DEFAULT_SETTINGS } from './config.js';
import { normalizeQuestionPreferences } from './preferences.js';

const FORMAT = 'condition-pulse-backup';
const SUPPORTED_SCHEMA = new Set([1, 2]);
const VALID_BANDS = new Set(['morning', 'daytime', 'evening']);
const VALID_TYPES = new Set(['scheduled', 'ad_hoc']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateResponse(response) {
  return isPlainObject(response)
    && typeof response.questionId === 'string'
    && response.questionId.length > 0
    && Number.isInteger(response.selectedIndex)
    && response.selectedIndex >= 0
    && response.selectedIndex <= 4
    && Number.isFinite(response.normalizedValue)
    && response.normalizedValue >= -2
    && response.normalizedValue <= 2;
}

function validateSession(session) {
  if (!isPlainObject(session)) return false;
  if (typeof session.id !== 'string' || !session.id) return false;
  if (typeof session.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(session.localDate)) return false;
  if (!VALID_BANDS.has(session.timeBand)) return false;
  if (!VALID_TYPES.has(session.sessionType)) return false;
  if (!isIsoDate(session.startedAt) || !isIsoDate(session.completedAt)) return false;
  if (!Array.isArray(session.responses) || !session.responses.length) return false;
  return session.responses.every(validateResponse);
}

function sanitizeSettings(settings) {
  const source = isPlainObject(settings) ? settings : {};
  const timeBands = isPlainObject(source.timeBands) ? source.timeBands : {};
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const band = (name, fallback) => {
    const candidate = timeBands[name];
    return Array.isArray(candidate) && candidate.length === 2 && candidate.every(validTime)
      ? [...candidate]
      : [...fallback];
  };
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...source,
    timeBands: {
      morning: band('morning', DEFAULT_SETTINGS.timeBands.morning),
      daytime: band('daytime', DEFAULT_SETTINGS.timeBands.daytime),
      evening: band('evening', DEFAULT_SETTINGS.timeBands.evening)
    },
    questionPreferences: normalizeQuestionPreferences(source.questionPreferences)
  };
}

export function parseBackupText(text) {
  if (typeof text !== 'string') throw new TypeError('Backup text must be a string');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('JSONを解析できませんでした。');
  }
  return validateBackupPayload(raw);
}

export function validateBackupPayload(raw) {
  if (!isPlainObject(raw)) throw new Error('バックアップのルート形式が正しくありません。');
  const schemaVersion = raw.format === FORMAT
    ? Number(raw.schemaVersion)
    : (Array.isArray(raw.sessions) && isPlainObject(raw.settings) && raw.exportedAt ? 1 : NaN);
  if (!SUPPORTED_SCHEMA.has(schemaVersion)) throw new Error('対応していないバックアップ形式です。');
  if (schemaVersion === 2 && raw.format !== FORMAT) throw new Error('バックアップ識別子が正しくありません。');
  if (!Array.isArray(raw.sessions)) throw new Error('セッション一覧がありません。');
  const invalidCount = raw.sessions.filter(session => !validateSession(session)).length;
  if (invalidCount) throw new Error(`形式が正しくない記録が${invalidCount}件あります。`);
  const ids = new Set();
  for (const session of raw.sessions) {
    if (ids.has(session.id)) throw new Error('バックアップ内に重複した記録IDがあります。');
    ids.add(session.id);
  }
  return {
    format: FORMAT,
    schemaVersion,
    exportedAt: isIsoDate(raw.exportedAt) ? raw.exportedAt : new Date().toISOString(),
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '0.1.x',
    questionBankVersion: typeof raw.questionBankVersion === 'string' ? raw.questionBankVersion : null,
    settings: sanitizeSettings(raw.settings),
    sessions: raw.sessions.map(session => structuredClone(session))
  };
}

export function mergeSessionsById(currentSessions, incomingSessions) {
  const merged = new Map();
  for (const session of currentSessions ?? []) merged.set(session.id, structuredClone(session));
  let added = 0;
  let duplicates = 0;
  for (const session of incomingSessions ?? []) {
    if (merged.has(session.id)) {
      duplicates += 1;
      continue;
    }
    merged.set(session.id, structuredClone(session));
    added += 1;
  }
  const sessions = [...merged.values()].sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
  return { sessions, added, duplicates };
}

export function previewImport(currentSessions, backup) {
  const current = currentSessions ?? [];
  const incoming = backup.sessions ?? [];
  const currentIds = new Set(current.map(session => session.id));
  const duplicates = incoming.filter(session => currentIds.has(session.id)).length;
  const dates = incoming.map(session => session.localDate).sort();
  return {
    incomingCount: incoming.length,
    currentCount: current.length,
    duplicates,
    additions: incoming.length - duplicates,
    earliestDate: dates[0] ?? null,
    latestDate: dates.at(-1) ?? null,
    schemaVersion: backup.schemaVersion,
    exportedAt: backup.exportedAt
  };
}
