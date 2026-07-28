import { getSessionDomainValues } from './scoring.js';

const BAND_ORDER = ['morning', 'daytime', 'evening'];

function scheduledByDate(sessions, days, now) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days + 1);
  cutoff.setHours(0, 0, 0, 0);
  const grouped = new Map();
  for (const session of sessions ?? []) {
    if (!session?.completedAt || session.sessionType === 'ad_hoc') continue;
    if (new Date(session.completedAt) < cutoff) continue;
    const list = grouped.get(session.localDate) ?? [];
    list.push(session);
    grouped.set(session.localDate, list);
  }
  return grouped;
}

function overall(session, questionMap) {
  return getSessionDomainValues(session, questionMap).get('overall');
}

function classifyDay(sessions, questionMap) {
  const byBand = new Map(sessions.map(session => [session.timeBand, session]));
  const values = Object.fromEntries(BAND_ORDER.map(band => [band, overall(byBand.get(band), questionMap)]));
  const available = BAND_ORDER.filter(band => Number.isFinite(values[band]));
  const result = [];

  if (Number.isFinite(values.morning) && Number.isFinite(values.daytime)) {
    if (values.morning <= -0.5 && values.daytime - values.morning >= 1) result.push('morning_recovery');
    if (values.morning <= -0.5 && values.daytime <= -0.5) result.push('low_persistence');
  }
  if (Number.isFinite(values.daytime) && Number.isFinite(values.evening)) {
    if (values.evening - values.daytime <= -1) result.push('evening_drop');
    if (values.daytime <= -0.5 && values.evening <= -0.5) result.push('low_persistence');
  }
  if (available.length >= 2) {
    const numeric = available.map(band => values[band]);
    if (Math.max(...numeric) - Math.min(...numeric) <= 0.5) result.push('stable_day');
  }

  return [...new Set(result)];
}

const PATTERN_COPY = Object.freeze({
  morning_recovery: {
    title: '朝は低めでも、昼に戻る日があります',
    description: 'この14日間では、朝より昼の全体感が戻る日が比較的多く見られました。'
  },
  evening_drop: {
    title: '午後から夜に余力が下がる日があります',
    description: 'この14日間では、昼から夜にかけて全体感が下がる日が比較的多く見られました。'
  },
  stable_day: {
    title: '一日を通して安定する日が多めです',
    description: 'この14日間では、記録した時間帯の全体感が大きく動かない日が比較的多く見られました。'
  },
  low_persistence: {
    title: '低めの状態が次の時間帯まで続く日があります',
    description: 'この14日間では、低めの全体感が次の観測まで続く日が比較的多く見られました。'
  }
});

export function detectPatterns(sessions, questionMap, { days = 14, now = new Date() } = {}) {
  const grouped = scheduledByDate(sessions, days, now);
  const counts = new Map();
  let evaluableDays = 0;

  for (const daySessions of grouped.values()) {
    const usable = daySessions.filter(session => Number.isFinite(overall(session, questionMap)));
    if (usable.length < 2) continue;
    evaluableDays += 1;
    for (const pattern of classifyDay(usable, questionMap)) {
      counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
    }
  }

  if (evaluableDays < 4) return [];
  return [...counts.entries()]
    .map(([id, count]) => ({
      id,
      count,
      evaluableDays,
      ratio: count / evaluableDays,
      ...PATTERN_COPY[id]
    }))
    .filter(item => item.count >= 3 && item.ratio >= 0.6)
    .sort((a, b) => b.ratio - a.ratio || b.count - a.count || a.id.localeCompare(b.id));
}
