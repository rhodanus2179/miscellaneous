function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function questionLastAskedAt(questionId, sessions) {
  let latest = null;
  for (const session of sessions) {
    if (!(session.questionIds ?? []).includes(questionId)) continue;
    const date = parseDate(session.completedAt ?? session.startedAt);
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest;
}

function domainLastAskedAt(domain, sessions, questionMap) {
  let latest = null;
  for (const session of sessions) {
    for (const response of session.responses ?? []) {
      if (questionMap.get(response.questionId)?.domain !== domain) continue;
      const date = parseDate(response.answeredAt ?? session.completedAt);
      if (date && (!latest || date > latest)) latest = date;
    }
  }
  return latest;
}

function recentDomainNeed(domain, sessions, questionMap) {
  const ordered = [...sessions].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  for (const session of ordered) {
    for (const response of session.responses ?? []) {
      if (questionMap.get(response.questionId)?.domain === domain) {
        return response.normalizedValue <= -1 ? 1 : 0;
      }
    }
  }
  return 0;
}

function hoursSince(date, now) {
  if (!date) return 999;
  return Math.max(0, (now - date) / 36e5);
}

export function validateQuestions(questions) {
  const required = ['id', 'version', 'domain', 'prompt', 'timeBands', 'responseScale', 'direction'];
  const seen = new Set();
  return questions.filter(question => {
    if (!required.every(key => question[key] !== undefined)) return false;
    if (seen.has(question.id)) return false;
    seen.add(question.id);
    return question.active !== false && Array.isArray(question.timeBands);
  });
}

export function selectQuestions({ questions, timeBand, sessions = [], now = new Date(), localDate = now.toISOString().slice(0, 10), count = 3 }) {
  const valid = validateQuestions(questions);
  const questionMap = new Map(valid.map(question => [question.id, question]));
  const anchors = valid.filter(question => question.domain === 'overall');
  const details = valid.filter(question => question.domain !== 'overall');
  const today = localDate;
  const sameDayDomains = new Set();
  sessions.filter(session => session.localDate === today).forEach(session => {
    (session.responses ?? []).forEach(response => {
      const domain = questionMap.get(response.questionId)?.domain;
      if (domain && domain !== 'overall') sameDayDomains.add(domain);
    });
  });

  const scoreQuestion = question => {
    const lastAsked = questionLastAskedAt(question.id, sessions);
    const domainLast = domainLastAskedAt(question.domain, sessions, questionMap);
    const cooldown = Number(question.cooldownHours ?? 36);
    const repeatPenalty = hoursSince(lastAsked, now) < cooldown ? 100 : Math.max(0, 4 - hoursSince(lastAsked, now) / 24);
    const timeBandFit = question.timeBands.includes(timeBand) ? 3 : 0;
    const coverageNeed = Math.min(4, hoursSince(domainLast, now) / 24);
    const followUpNeed = recentDomainNeed(question.domain, sessions, questionMap) * 2;
    const sameDayPenalty = sameDayDomains.has(question.domain) ? 2 : 0;
    const wordingBalance = question.direction === 'higher_is_better' ? 0.15 : 0;
    return timeBandFit + coverageNeed * 2 + followUpNeed - repeatPenalty * 4 - sameDayPenalty + wordingBalance;
  };

  const sortCandidates = candidates => [...candidates].sort((a, b) => {
    const difference = scoreQuestion(b) - scoreQuestion(a);
    return Math.abs(difference) > 0.0001 ? difference : a.id.localeCompare(b.id);
  });

  const selected = [];
  const anchorPool = sortCandidates(anchors.length ? anchors : valid);
  if (anchorPool[0]) selected.push(anchorPool[0]);

  const usedDomains = new Set(selected.map(question => question.domain));
  for (const question of sortCandidates(details)) {
    if (selected.length >= count) break;
    if (usedDomains.has(question.domain)) continue;
    selected.push(question);
    usedDomains.add(question.domain);
  }

  if (selected.length < count) {
    for (const question of sortCandidates(valid)) {
      if (selected.length >= count) break;
      if (!selected.some(item => item.id === question.id)) selected.push(question);
    }
  }

  return selected.slice(0, count);
}
