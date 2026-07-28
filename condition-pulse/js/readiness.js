const BANDS = ['morning', 'daytime', 'evening'];

export function calculateReadiness(sessions) {
  const completed = (sessions ?? []).filter(session => session?.completedAt);
  const uniqueDays = new Set(completed.map(session => session.localDate)).size;
  const bandCounts = Object.fromEntries(BANDS.map(band => [
    band,
    completed.filter(session => session.timeBand === band && session.sessionType !== 'ad_hoc').length
  ]));
  const coveredBands = BANDS.filter(band => bandCounts[band] >= 3).length;

  let level = 'starting';
  let title = '観測を始めたところです';
  let description = 'まずは無理のない時間帯から、数回記録してみましょう。';

  if (uniqueDays >= 3 && completed.length >= 5) {
    level = 'emerging';
    title = '傾向が見え始めています';
    description = '記録が増えると、同じ時間帯どうしを比べやすくなります。';
  }
  if (uniqueDays >= 7 && completed.length >= 10 && coveredBands >= 1) {
    level = 'comparable';
    const readyBand = BANDS.find(band => bandCounts[band] >= 3);
    const labels = { morning: '朝', daytime: '昼', evening: '夜' };
    title = `${labels[readyBand]}の時間帯比較に使える記録があります`;
    description = '本人の過去の同じ時間帯と、静かに比較できる段階です。';
  }
  if (uniqueDays >= 14 && completed.length >= 24 && coveredBands === 3) {
    level = 'established';
    title = '朝・昼・夜の基準が比較的そろっています';
    description = '一日の流れや、繰り返す変化の型を振り返りやすくなりました。';
  }

  return {
    level,
    title,
    description,
    uniqueDays,
    totalSessions: completed.length,
    bandCounts,
    coveredBands
  };
}

export function dailyObservationMessage(sessions, localDate) {
  const count = (sessions ?? []).filter(session =>
    session?.completedAt && session.localDate === localDate && session.sessionType === 'scheduled'
  ).length;
  if (count >= 3) return '今日は朝・昼・夜の流れを記録できました。';
  if (count >= 2) return '今日は十分な観測ができています。';
  if (count === 1) return '次の時間帯を記録すると、一日の流れが見え始めます。';
  return '今日はまだ記録がありません。';
}
