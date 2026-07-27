import { CONFIG } from '../config.js';

function cacheKey(key) {
  return `${CONFIG.cachePrefix}:cache:${key}`;
}

function readCache(key) {
  try {
    const value = localStorage.getItem(cacheKey(key));
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed || !('data' in parsed) || !parsed.fetchedAt) return null;
    return parsed;
  } catch (error) {
    console.debug(`Earth Pulse: cache read failed for ${key}.`, error);
    return null;
  }
}

function writeCache(key, data, fetchedAt) {
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify({ data, fetchedAt }));
  } catch (error) {
    console.debug(`Earth Pulse: cache write failed for ${key}.`, error);
  }
}

function friendlyError(error) {
  if (error?.name === 'AbortError') return 'Request timed out';
  if (error instanceof TypeError) return 'Network or CORS error';
  return 'Data request failed';
}

async function fetchAttempt(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJsonWithCache({
  url,
  key,
  timeoutMs = CONFIG.requestTimeoutMs,
  retries = CONFIG.requestRetries,
}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const data = await fetchAttempt(url, timeoutMs);
      const fetchedAt = new Date().toISOString();
      writeCache(key, data, fetchedAt);
      return {
        data,
        meta: {
          status: 'live',
          fetchedAt,
          fromCache: false,
          error: null,
        },
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const cached = readCache(key);
  if (cached) {
    return {
      data: cached.data,
      meta: {
        status: 'cache',
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        error: friendlyError(lastError),
      },
    };
  }

  console.warn(`Earth Pulse: ${key} unavailable.`, lastError);
  return {
    data: null,
    meta: {
      status: 'unavailable',
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      error: friendlyError(lastError),
    },
  };
}

export function toIsoUtc(value) {
  if (!value) return null;
  const text = String(value);
  const normalized = /(?:Z|[+-]\d\d:?\d\d)$/.test(text) ? text : `${text}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
