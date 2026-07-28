import { DOMAIN_LABELS, TIME_BAND_LABELS } from './config.js';
import { analyzeSession, getSessionDomainValues } from './scoring.js';

const bandOrder = ['morning', 'daytime', 'evening'];

function previousTodaySession(session, sessions) {
  return sessions
    .filter(item => item.localDate === session.localDate && item.completedAt && new Date(item.completedAt) < new Date(session.completedAt))
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0] ?? null;
}

export function hasSafetySignal(session, questionMap) {
  return (session.responses ?? []).some(response => {
    const question = questionMap.get(response.questionId);
    return question?.safetySensitive && response.normalizedValue <= -2;
  });
}

export function generateFeedback(session, priorSessions, questionMap) {
  const analysis = analyzeSession(session, priorSessions, questionMap);
  const previous = previousTodaySession(session, priorSessions);
  const currentValues = getSessionDomainValues(session, questionMap);
  const previousValues = getSessionDomainValues(previous, questionMap);
  const currentOverall = currentValues.get('overall');
  const previousOverall = previousValues.get('overall');

  if (previous && Number.isFinite(currentOverall) && Number.isFinite(previousOverall)) {
    const previousLabel = TIME_BAND_LABELS[previous.timeBand] ?? '前回';
    if (currentOverall - previousOverall >= 1) return `${previousLabel}より、全体の余力が少し戻っています。`;
    if (currentOverall - previousOverall <= -1) return `${previousLabel}より、全体の余力が少し下がっています。無理に結論づけず、流れを見ていきましょう。`;
  }

  if (!analysis.warmup) return 'まだ平常値を学習中です。今の状態を記録しました。';

  const persistent = analysis.domains.find(item => item.persistence >= 2 && item.difference <= -0.5);
  if (persistent) return `ここ3回ほど、${DOMAIN_LABELS[persistent.domain]}が普段より低めです。`;

  const low = [...analysis.lowDomains].sort((a, b) => a.difference - b.difference)[0];
  if (low) return `普段の${TIME_BAND_LABELS[session.timeBand]}と比べて、${DOMAIN_LABELS[low.domain]}が少し低めです。`;

  const high = [...analysis.highDomains].sort((a, b) => b.difference - a.difference)[0];
  if (high) return `普段の${TIME_BAND_LABELS[session.timeBand]}と比べて、${DOMAIN_LABELS[high.domain]}に少し余力があります。`;

  return `今のところ、普段の${TIME_BAND_LABELS[session.timeBand]}の範囲内です。`;
}

export function summarizeToday(sessions, questionMap, localDate) {
  const today = sessions
    .filter(session => session.localDate === localDate && session.completedAt)
    .sort((a, b) => bandOrder.indexOf(a.timeBand) - bandOrder.indexOf(b.timeBand));

  if (!today.length) return '今日はまだ記録がありません。';
  if (today.length === 1) return `${TIME_BAND_LABELS[today[0].timeBand]}の状態を記録しました。次の観測で一日の流れが見え始めます。`;

  const first = getSessionDomainValues(today[0], questionMap).get('overall');
  const last = getSessionDomainValues(today.at(-1), questionMap).get('overall');
  if (Number.isFinite(first) && Number.isFinite(last)) {
    if (last - first >= 1) return `${TIME_BAND_LABELS[today[0].timeBand]}から、全体の余力が戻っています。`;
    if (last - first <= -1) return `${TIME_BAND_LABELS[today[0].timeBand]}より、今は余力が少し低めです。`;
  }
  return '今日は大きく崩れず、いつもの範囲で推移しています。';
}
