const BASE_VALUES = [-2, -1, 0, 1, 2];

export function normalizeResponse(question, selectedIndex) {
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 4) {
    throw new RangeError('selectedIndex must be an integer from 0 to 4');
  }
  const raw = BASE_VALUES[selectedIndex];
  return question.direction === 'lower_is_better' ? -raw : raw;
}

export function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

export function mad(values, center = median(values)) {
  if (center === null) return null;
  return median(values.filter(Number.isFinite).map(value => Math.abs(value - center)));
}

export function uniqueDays(sessions) {
  return new Set(sessions.map(session => session.localDate)).size;
}

export function isWarmupComplete(sessions, timeBand = null) {
  const completed = sessions.filter(session => session.completedAt);
  const bandCount = timeBand ? completed.filter(session => session.timeBand === timeBand).length : completed.length;
  return uniqueDays(completed) >= 7 && completed.length >= 10 && bandCount >= 3;
}

export function getDomainValues(sessions, questionMap, { domain, timeBand = null, limit = 28 } = {}) {
  const values = [];
  const ordered = [...sessions].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  for (const session of ordered) {
    if (timeBand && session.timeBand !== timeBand) continue;
    for (const response of session.responses ?? []) {
      const question = questionMap.get(response.questionId);
      if (question?.domain === domain && Number.isFinite(response.normalizedValue)) {
        values.push(response.normalizedValue);
        if (values.length >= limit) return values;
      }
    }
  }
  return values;
}

export function getBaseline(sessions, questionMap, domain, timeBand) {
  let values = getDomainValues(sessions, questionMap, { domain, timeBand, limit: 28 });
  let source = 'timeBand';
  if (values.length < 3) {
    values = getDomainValues(sessions, questionMap, { domain, limit: 28 });
    source = 'all';
  }
  const center = median(values);
  return {
    domain,
    timeBand,
    sampleCount: values.length,
    median: center,
    mad: mad(values, center),
    source
  };
}

export function getSessionDomainValues(session, questionMap) {
  const grouped = new Map();
  for (const response of session?.responses ?? []) {
    const question = questionMap.get(response.questionId);
    if (!question) continue;
    const list = grouped.get(question.domain) ?? [];
    list.push(response.normalizedValue);
    grouped.set(question.domain, list);
  }
  return new Map([...grouped].map(([domain, values]) => [domain, median(values)]));
}

export function getPersistence(sessions, questionMap, domain, baselineMedian = 0, limit = 3) {
  const values = getDomainValues(sessions, questionMap, { domain, limit });
  let count = 0;
  for (const value of values) {
    if (value < baselineMedian - 0.5) count += 1;
    else break;
  }
  return count;
}

export function analyzeSession(session, priorSessions, questionMap) {
  const domainValues = getSessionDomainValues(session, questionMap);
  const warmup = isWarmupComplete(priorSessions, session.timeBand);
  const domains = [];

  for (const [domain, value] of domainValues.entries()) {
    const baseline = getBaseline(priorSessions, questionMap, domain, session.timeBand);
    const difference = baseline.median === null ? null : value - baseline.median;
    domains.push({
      domain,
      value,
      baseline,
      difference,
      persistence: baseline.median === null ? 0 : getPersistence(priorSessions, questionMap, domain, baseline.median)
    });
  }

  return {
    warmup,
    domains,
    lowDomains: domains.filter(item => item.difference !== null && item.difference <= -1),
    highDomains: domains.filter(item => item.difference !== null && item.difference >= 1)
  };
}

export function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

export function aggregateByDomain(sessions, questionMap, days = 7, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days + 1);
  cutoff.setHours(0, 0, 0, 0);
  const grouped = new Map();
  for (const session of sessions) {
    if (new Date(session.completedAt) < cutoff) continue;
    for (const [domain, value] of getSessionDomainValues(session, questionMap)) {
      const values = grouped.get(domain) ?? [];
      values.push(value);
      grouped.set(domain, values);
    }
  }
  return [...grouped].map(([domain, values]) => ({
    domain,
    sampleCount: values.length,
    average: average(values),
    median: median(values)
  }));
}
