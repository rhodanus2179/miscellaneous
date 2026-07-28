import { APP_VERSION, QUESTION_BANK_VERSION, RESPONSE_SCALES } from './config.js';
import { normalizeResponse } from './scoring.js';
import { getObservationDate, getTimeBand } from './time-bands.js';

export function createCheckIn({ questions, settings, sessionType = 'scheduled', now = new Date() }) {
  return {
    id: crypto.randomUUID(),
    localDate: getObservationDate(now, settings),
    startedAt: now.toISOString(),
    completedAt: null,
    timeBand: getTimeBand(now, settings),
    sessionType,
    questionIds: questions.map(question => question.id),
    responses: [],
    contextTag: null,
    appVersion: APP_VERSION,
    questionBankVersion: QUESTION_BANK_VERSION
  };
}

export function buildResponse(question, selectedIndex, shownAt, answeredAt = new Date()) {
  return {
    questionId: question.id,
    questionVersion: question.version,
    selectedIndex,
    normalizedValue: normalizeResponse(question, selectedIndex),
    answeredAt: answeredAt.toISOString(),
    responseTimeMs: Math.max(0, answeredAt.getTime() - shownAt.getTime())
  };
}

export function getResponseLabels(question) {
  return RESPONSE_SCALES[question.responseScale] ?? RESPONSE_SCALES.five_agreement;
}
