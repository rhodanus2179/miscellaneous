import { APP_VERSION, CONTEXT_TAGS, DEFAULT_SETTINGS, DOMAIN_LABELS, QUESTION_BANK_VERSION, TIME_BAND_LABELS } from './config.js';
import { createRouter } from './router.js';
import { createCheckIn, buildResponse, getResponseLabels } from './checkin.js';
import { selectQuestions } from './question-selector.js';
import { aggregateByDomain, getSessionDomainValues, isWarmupComplete } from './scoring.js';
import { generateFeedback, hasSafetySignal, summarizeToday } from './feedback.js';
import { clearAllData, getSessions, getSettings, saveSession, saveSettings } from './storage.js';
import { exportCsv, exportJson } from './export.js';
import { formatDateJa, getNextBand, getObservationDate, getTimeBand } from './time-bands.js';

const appRoot = document.querySelector('#app');
const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  sessions: [],
  questions: [],
  questionMap: new Map(),
  active: null,
  activeQuestions: [],
  activeIndex: 0,
  questionShownAt: null,
  lastFeedback: '',
  lastSafetySignal: false,
  storageError: null
};

const fallbackQuestions = [
  { id: 'fallback_overall', version: 1, domain: 'overall', prompt: '今の調子は、普段のこの時間と比べてどうですか？', timeBands: ['morning','daytime','evening'], responseScale: 'five_comparative', direction: 'higher_is_better', cooldownHours: 0, active: true },
  { id: 'fallback_energy', version: 1, domain: 'physical_energy', prompt: '体に、まだ使える余力が残っていますか？', timeBands: ['morning','daytime','evening'], responseScale: 'five_agreement', direction: 'higher_is_better', cooldownHours: 0, active: true },
  { id: 'fallback_clarity', version: 1, domain: 'cognitive_clarity', prompt: '今、文章が頭に入りそうですか？', timeBands: ['morning','daytime','evening'], responseScale: 'five_agreement', direction: 'higher_is_better', cooldownHours: 0, active: true }
];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function header({ close = false } = {}) {
  return `
    <header class="app-header">
      <a class="brand" href="#/home" aria-label="Condition Pulse ホーム">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">Condition Pulse</span>
      </a>
      ${close ? '<button class="header-link" type="button" data-action="close-checkin">閉じる</button>' : '<a class="header-link" href="#/safety">安全案内</a>'}
    </header>`;
}

function nav(active) {
  const items = [['home','ホーム'],['today','今日'],['trends','傾向'],['settings','設定']];
  return `<nav class="bottom-nav" aria-label="メインナビゲーション">${items.map(([route,label]) => `<a href="#/${route}" ${active === route ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

function renderShell(content, { route = 'home', focus = true, navVisible = true, close = false } = {}) {
  appRoot.innerHTML = `<div class="page ${navVisible ? '' : 'page--focus'}">${header({ close })}<main id="app-main" tabindex="-1">${content}</main></div>${navVisible ? nav(route) : ''}`;
  if (focus) requestAnimationFrame(() => document.querySelector('#app-main')?.focus({ preventScroll: true }));
  bindGlobalActions();
}

function bindGlobalActions() {
  document.querySelector('[data-action="close-checkin"]')?.addEventListener('click', () => {
    state.active = null;
    state.activeQuestions = [];
    router.go('home');
  });
}

function getTodaySessions(localDate = getObservationDate(new Date(), state.settings)) {
  return state.sessions.filter(session => session.localDate === localDate && session.completedAt);
}

function getScheduledSession(localDate, timeBand) {
  return state.sessions.find(session => session.localDate === localDate && session.timeBand === timeBand && session.sessionType === 'scheduled' && session.completedAt);
}

function overallGlyph(value) {
  if (!Number.isFinite(value)) return '·';
  if (value >= 1) return '↗';
  if (value <= -1) return '↘';
  return '—';
}

function flowMarkup(localDate) {
  const today = getTodaySessions(localDate);
  return `<div class="flow-line" aria-label="今日のチェックイン状況">
    ${['morning','daytime','evening'].map(band => {
      const session = today.find(item => item.timeBand === band);
      const value = session ? getSessionDomainValues(session, state.questionMap).get('overall') : null;
      return `<div class="flow-node ${session ? 'flow-node--done' : ''}">
        <div class="flow-node__dot" aria-hidden="true">${session ? overallGlyph(value) : '○'}</div>
        <div class="flow-node__label">${TIME_BAND_LABELS[band]}${session ? '・記録済み' : '・未記録'}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderOnboarding() {
  renderShell(`
    <section class="onboarding">
      <div class="onboarding__symbol" aria-hidden="true">⌁</div>
      <div>
        <p class="eyebrow">Your quiet baseline</p>
        <h1>一日の調子を、<br><span class="muted">数秒ずつ観測する。</span></h1>
        <p class="lead">朝・昼・夜に3問だけ答えます。他人の平均ではなく、あなた自身の「いつも」と比べて、調子の流れを見えるようにします。</p>
      </div>
      <div class="onboarding-grid">
        <div class="onboarding-point"><strong>3 QUESTIONS</strong><span>自由記述なし。選ぶだけです。</span></div>
        <div class="onboarding-point"><strong>ON DEVICE</strong><span>回答はこのブラウザ内に保存します。</span></div>
        <div class="onboarding-point"><strong>NOT MEDICAL</strong><span>診断や受診判断を行うものではありません。</span></div>
      </div>
      <div class="notice"><p class="summary-text small">ブラウザのデータ削除や端末変更で記録が失われる場合があります。必要に応じて設定から書き出せます。</p></div>
      <button class="primary-button" type="button" data-action="begin">はじめる</button>
    </section>`, { navVisible: false });
  document.querySelector('[data-action="begin"]')?.addEventListener('click', async () => {
    state.settings.onboardingCompleted = true;
    await persistSettings();
    router.go('home');
  });
}

function renderHome() {
  const now = new Date();
  const localDate = getObservationDate(now, state.settings);
  const timeBand = getTimeBand(now, state.settings);
  const existing = getScheduledSession(localDate, timeBand);
  const nextBand = getNextBand(timeBand);
  const summary = summarizeToday(state.sessions, state.questionMap, localDate);
  const warmup = isWarmupComplete(state.sessions, timeBand);
  const totalDays = new Set(state.sessions.map(session => session.localDate)).size;

  renderShell(`
    <section class="hero">
      <p class="hero__date">${formatDateJa(localDate)}</p>
      <p class="eyebrow">${TIME_BAND_LABELS[timeBand]}の観測点</p>
      <h1 class="hero__title">今の自分を、<span>小さく残す。</span></h1>
    </section>

    ${state.storageError ? `<div class="notice notice--safety"><p class="summary-text">保存領域を利用できません。プライベートブラウズ設定などを確認してください。</p></div>` : ''}

    <section class="check-card" aria-labelledby="check-title">
      <div class="check-card__meta"><span>${TIME_BAND_LABELS[timeBand]}</span><span>3問・約8秒</span></div>
      <h2 id="check-title" class="check-card__title">${existing ? 'この時間の記録は完了しています' : 'いまの調子を見てみる'}</h2>
      <p class="muted">${existing ? `次は${TIME_BAND_LABELS[nextBand]}に。また変化を見てみましょう。` : '考え込まず、いまの感覚に近いものを選びます。'}</p>
      ${existing
        ? '<button class="secondary-button" type="button" data-action="start-adhoc">今もう一度チェック</button>'
        : '<button class="primary-button" type="button" data-action="start">3問に答える</button>'}
    </section>

    <section class="section" aria-labelledby="today-heading">
      <div class="section-heading"><h2 id="today-heading">今日の流れ</h2><a href="#/today">詳しく見る</a></div>
      <div class="panel">${flowMarkup(localDate)}<p class="summary-text ${state.settings.privacyMode ? 'muted' : ''}" style="margin-top:1rem">${state.settings.privacyMode ? 'プライバシーモード中：要約を非表示にしています。' : escapeHtml(summary)}</p></div>
    </section>

    <section class="section">
      <div class="notice"><p class="summary-text"><strong>${warmup ? '平常値を観測しています' : '平常値を学習中です'}</strong><br><span class="muted small">${warmup ? '同じ時間帯の過去回答と比較できます。' : `${totalDays}日分を記録しました。7日・10回以上が目安です。`}</span></p></div>
    </section>`, { route: 'home' });

  document.querySelector('[data-action="start"]')?.addEventListener('click', () => startCheckIn(false));
  document.querySelector('[data-action="start-adhoc"]')?.addEventListener('click', () => startCheckIn(true));
}

function startCheckIn(adHoc) {
  const now = new Date();
  const timeBand = getTimeBand(now, state.settings);
  const localDate = getObservationDate(now, state.settings);
  state.activeQuestions = selectQuestions({
    questions: state.questions,
    timeBand,
    sessions: state.sessions,
    now,
    localDate,
    count: 3
  });
  if (state.activeQuestions.length < 3) state.activeQuestions = fallbackQuestions;
  state.active = createCheckIn({ questions: state.activeQuestions, settings: state.settings, sessionType: adHoc ? 'ad_hoc' : 'scheduled', now });
  state.activeIndex = 0;
  state.questionShownAt = new Date();
  router.go('checkin');
}

function renderCheckIn() {
  if (!state.active || !state.activeQuestions.length) {
    router.go('home');
    return;
  }
  const question = state.activeQuestions[state.activeIndex];
  const labels = getResponseLabels(question);
  const progress = state.activeQuestions.map((_, index) => `<span class="${index < state.activeIndex ? 'is-done' : index === state.activeIndex ? 'is-active' : ''}"></span>`).join('');

  renderShell(`
    <div class="question-shell">
      <div class="progress" aria-label="質問 ${state.activeIndex + 1} / ${state.activeQuestions.length}">${progress}</div>
      <p class="question-label">${DOMAIN_LABELS[question.domain] ?? 'コンディション'}</p>
      <h1 class="question-title" id="question-title">${escapeHtml(question.prompt)}</h1>
      <div class="answer-list" role="group" aria-labelledby="question-title">
        ${labels.map((label, index) => `<button class="answer-button" type="button" data-answer="${index}"><span>${index + 1}</span>${escapeHtml(label)}</button>`).join('')}
      </div>
    </div>`, { navVisible: false, close: true });

  document.querySelector('.answer-button')?.focus({ preventScroll: true });
  document.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => answerQuestion(Number(button.dataset.answer))));
}

async function answerQuestion(selectedIndex) {
  const question = state.activeQuestions[state.activeIndex];
  state.active.responses.push(buildResponse(question, selectedIndex, state.questionShownAt, new Date()));
  state.activeIndex += 1;
  if (state.activeIndex < state.activeQuestions.length) {
    state.questionShownAt = new Date();
    renderCheckIn();
    return;
  }

  state.active.completedAt = new Date().toISOString();
  const prior = [...state.sessions];
  state.lastFeedback = generateFeedback(state.active, prior, state.questionMap);
  state.lastSafetySignal = hasSafetySignal(state.active, state.questionMap);
  try {
    await saveSession(state.active);
    state.sessions.push(structuredClone(state.active));
    state.sessions.sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
    router.go('complete');
  } catch (error) {
    console.error('Session save failed without response details', error?.name);
    renderSaveError();
  }
}

function renderSaveError() {
  renderShell(`
    <div class="error-card">
      <h1>回答を保存できませんでした</h1>
      <p class="lead">もう一度試すか、ブラウザのデータ保存設定を確認してください。</p>
      <div class="button-row"><button class="primary-button" type="button" data-action="retry-save">もう一度保存</button><button class="secondary-button" type="button" data-action="discard">破棄して戻る</button></div>
    </div>`, { navVisible: false });
  document.querySelector('[data-action="retry-save"]')?.addEventListener('click', async () => {
    try {
      await saveSession(state.active);
      state.sessions.push(structuredClone(state.active));
      router.go('complete');
    } catch { renderSaveError(); }
  });
  document.querySelector('[data-action="discard"]')?.addEventListener('click', () => router.go('home'));
}

function renderComplete() {
  if (!state.active?.completedAt) {
    router.go('home');
    return;
  }
  renderShell(`
    <section class="complete-hero">
      <div class="complete-orbit" aria-hidden="true"><span>⌁</span></div>
      <p class="eyebrow" style="text-align:center">Recorded locally</p>
      <h1 style="text-align:center">記録しました</h1>
      <p class="feedback">${escapeHtml(state.lastFeedback)}</p>
    </section>
    ${state.lastSafetySignal ? `<section class="section"><div class="notice notice--safety"><p class="summary-text"><strong>いつもと明らかに違う強い症状がありますか？</strong><br><span class="small">このアプリだけで判断せず、公的な救急案内を確認してください。</span></p><a class="secondary-button" style="display:inline-grid;place-items:center;text-decoration:none;margin-top:.8rem" href="#/safety">安全案内を見る</a></div></section>` : ''}
    <section class="section" aria-labelledby="tag-heading">
      <div class="section-heading"><h2 id="tag-heading">きっかけを一つ残す</h2><span class="muted small">任意</span></div>
      <div class="tag-list">${CONTEXT_TAGS.map(tag => `<button class="tag-button" type="button" aria-pressed="${state.active.contextTag === tag}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}</div>
    </section>
    <div class="button-row"><a class="primary-button" style="display:grid;place-items:center;text-decoration:none" href="#/today">今日の流れを見る</a><a class="secondary-button" style="display:grid;place-items:center;text-decoration:none" href="#/home">ホームへ</a></div>`, { navVisible: false });

  document.querySelectorAll('[data-tag]').forEach(button => button.addEventListener('click', async () => {
    state.active.contextTag = button.dataset.tag;
    const index = state.sessions.findIndex(session => session.id === state.active.id);
    if (index >= 0) state.sessions[index].contextTag = state.active.contextTag;
    try { await saveSession(state.active); } catch { /* Tag failure does not invalidate the completed session. */ }
    document.querySelectorAll('[data-tag]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
}

function sessionCard(session) {
  if (!session) return `<article class="time-card"><div class="time-card__head"><h3>未記録</h3><span class="time-card__value">○</span></div><p class="muted small">回答がなくても、悪い値としては扱いません。</p></article>`;
  const values = getSessionDomainValues(session, state.questionMap);
  const overall = values.get('overall');
  const domains = [...values.keys()].filter(domain => domain !== 'overall');
  return `<article class="time-card time-card--done">
    <div class="time-card__head"><div><h3>${TIME_BAND_LABELS[session.timeBand]}${session.sessionType === 'ad_hoc' ? '・追加' : ''}</h3><span class="muted small">${new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date(session.completedAt))}</span></div><span class="time-card__value" aria-label="全体感 ${overallGlyph(overall)}">${overallGlyph(overall)}</span></div>
    <div class="domain-pills">${domains.map(domain => `<span class="domain-pill">${DOMAIN_LABELS[domain]}</span>`).join('')}</div>
    ${session.contextTag ? `<p class="small muted">きっかけ：${escapeHtml(session.contextTag)}</p>` : ''}
  </article>`;
}

function renderToday() {
  const localDate = getObservationDate(new Date(), state.settings);
  const sessions = getTodaySessions(localDate).sort((a,b) => new Date(a.completedAt) - new Date(b.completedAt));
  const scheduled = Object.fromEntries(['morning','daytime','evening'].map(band => [band, sessions.find(item => item.timeBand === band && item.sessionType === 'scheduled') ?? sessions.find(item => item.timeBand === band)]));
  renderShell(`
    <section class="hero"><p class="eyebrow">Daily trace</p><h1>今日の流れ</h1><p class="lead">${escapeHtml(summarizeToday(state.sessions, state.questionMap, localDate))}</p></section>
    <div class="time-grid">
      ${['morning','daytime','evening'].map(band => `<section><div class="section-heading"><h2>${TIME_BAND_LABELS[band]}</h2></div>${sessionCard(scheduled[band])}</section>`).join('')}
    </div>
    ${sessions.some(item => item.sessionType === 'ad_hoc') ? `<section class="section"><div class="section-heading"><h2>追加チェック</h2></div><div class="time-grid">${sessions.filter(item => item.sessionType === 'ad_hoc').map(sessionCard).join('')}</div></section>` : ''}
    <section class="section"><div class="notice"><p class="summary-text small">未回答の時間帯は空欄のままです。回答しなかったことを、状態の悪化とはみなしません。</p></div></section>`, { route: 'today' });
}

function trendDescription(item) {
  if (item.sampleCount < 2) return 'まだ観測が少ない領域です。';
  if (item.average >= .6) return 'この7日間は、余力のある回答がやや多めです。';
  if (item.average <= -.6) return 'この7日間は、低めの回答がやや多めです。';
  return 'この7日間は、大きく偏らず推移しています。';
}

function renderTrends() {
  const trends = aggregateByDomain(state.sessions, state.questionMap, 7).filter(item => item.domain !== 'overall');
  const warmup = isWarmupComplete(state.sessions);
  renderShell(`
    <section class="hero"><p class="eyebrow">Seven-day pattern</p><h1>7日間の傾向</h1><p class="lead">${warmup ? '数値そのものではなく、領域ごとの動きを表示します。' : '平常値を学習中です。今は記録の分布だけを静かに示します。'}</p></section>
    ${trends.length ? `<div class="trend-grid">${trends.map(item => {
      const width = Math.max(5, Math.min(95, ((item.average + 2) / 4) * 100));
      return `<article class="trend-card"><div class="time-card__head"><h2>${DOMAIN_LABELS[item.domain]}</h2><span class="muted small">${item.sampleCount}回</span></div><p class="small muted">${trendDescription(item)}</p><div class="trend-meter" aria-label="回答分布の位置"><span style="width:${width}%"></span></div></article>`;
    }).join('')}</div>` : '<div class="notice"><p class="summary-text">まだ傾向を表示できる記録がありません。</p></div>'}
    <section class="section"><div class="notice"><p class="summary-text small">ここで示す傾向は診断や健康度ではありません。短い自己回答が、一緒にどう動いたかを振り返るための表示です。</p></div></section>
    <section class="section"><div class="section-heading"><h2>最近の履歴</h2><a href="#/history">一覧を見る</a></div></section>`, { route: 'trends' });
}

function renderHistory() {
  const ordered = [...state.sessions].sort((a,b) => new Date(b.completedAt) - new Date(a.completedAt));
  renderShell(`
    <section class="hero"><p class="eyebrow">Local archive</p><h1>履歴</h1><p class="lead">この端末のブラウザ内に保存されている記録です。</p></section>
    <div class="history-list">${ordered.length ? ordered.slice(0,100).map(session => {
      const overall = getSessionDomainValues(session, state.questionMap).get('overall');
      return `<article class="history-item"><div class="history-item__head"><div><h3>${formatDateJa(session.localDate)}・${TIME_BAND_LABELS[session.timeBand]}</h3><span class="muted small">${new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date(session.completedAt))}${session.sessionType === 'ad_hoc' ? '・追加' : ''}</span></div><span class="time-card__value">${overallGlyph(overall)}</span></div>${session.contextTag ? `<p class="small muted">きっかけ：${escapeHtml(session.contextTag)}</p>` : ''}</article>`;
    }).join('') : '<div class="notice"><p class="summary-text">まだ記録はありません。</p></div>'}</div>`, { route: 'trends' });
}

function renderSettings() {
  const bands = state.settings.timeBands;
  renderShell(`
    <section class="hero"><p class="eyebrow">Local control</p><h1>設定</h1><p class="lead">時間帯と、この端末に保存したデータを管理します。</p></section>
    <section class="settings-group"><div class="section-heading"><h2>時間帯</h2></div><form class="panel" id="time-form">
      <div class="field"><label for="morning-start">朝の開始</label><input id="morning-start" name="morning" type="time" value="${bands.morning[0]}" required></div>
      <div class="field"><label for="daytime-start">昼の開始</label><input id="daytime-start" name="daytime" type="time" value="${bands.daytime[0]}" required></div>
      <div class="field"><label for="evening-start">夜の開始</label><input id="evening-start" name="evening" type="time" value="${bands.evening[0]}" required></div>
      <p class="muted small">朝の開始前は、前日の夜として記録します。</p><button class="secondary-button" type="submit">時間帯を保存</button>
    </form></section>
    <section class="settings-group"><div class="section-heading"><h2>表示</h2></div><div class="panel">
      <label class="toggle"><span><strong>要約をホームで隠す</strong><br><span class="muted small">共有端末での簡易的な配慮です。</span></span><input type="checkbox" data-setting="privacyMode" ${state.settings.privacyMode ? 'checked' : ''}></label>
      <label class="toggle"><span><strong>動きを少なくする</strong><br><span class="muted small">画面遷移の演出を抑えます。</span></span><input type="checkbox" data-setting="reducedMotion" ${state.settings.reducedMotion ? 'checked' : ''}></label>
    </div></section>
    <section class="settings-group"><div class="section-heading"><h2>データ</h2></div><div class="panel">
      <p class="muted small">書き出すファイルには、健康に関する私的な回答が含まれます。保存先と共有先に注意してください。</p>
      <div class="button-row"><button class="secondary-button" type="button" data-action="export-json">JSONバックアップ</button><button class="secondary-button" type="button" data-action="export-csv">CSVを書き出す</button></div>
      <button class="danger-button" type="button" data-action="delete-all">すべてのデータを削除</button>
    </div></section>
    <section class="settings-group"><div class="section-heading"><h2>このアプリについて</h2></div><div class="notice"><p class="summary-text small">Condition Pulse v${APP_VERSION}<br>質問バンク ${QUESTION_BANK_VERSION}<br><br>病気の診断、疾病リスクの算定、受診判断を行うものではありません。回答は外部へ送信しません。</p></div></section>`, { route: 'settings' });

  document.querySelector('#time-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const morning = data.get('morning');
    const daytime = data.get('daytime');
    const evening = data.get('evening');
    if (!(morning < daytime && daytime < evening)) {
      alert('朝、昼、夜の開始時刻を順番に設定してください。');
      return;
    }
    state.settings.timeBands = { morning: [morning, daytime], daytime: [daytime,evening], evening: [evening,morning] };
    await persistSettings();
    alert('時間帯を保存しました。');
  });
  document.querySelectorAll('[data-setting]').forEach(input => input.addEventListener('change', async () => {
    state.settings[input.dataset.setting] = input.checked;
    document.documentElement.classList.toggle('reduce-motion', state.settings.reducedMotion);
    await persistSettings();
  }));
  document.querySelector('[data-action="export-json"]')?.addEventListener('click', () => exportJson({ sessions: state.sessions, settings: state.settings, appVersion: APP_VERSION, questionBankVersion: QUESTION_BANK_VERSION }));
  document.querySelector('[data-action="export-csv"]')?.addEventListener('click', () => exportCsv({ sessions: state.sessions, questionMap: state.questionMap }));
  document.querySelector('[data-action="delete-all"]')?.addEventListener('click', async () => {
    if (!confirm('この端末に保存した回答、設定、平常値をすべて削除します。元に戻せません。')) return;
    if (!confirm('本当にすべて削除しますか？')) return;
    await clearAllData({ includeSettings: true });
    state.sessions = [];
    state.settings = structuredClone(DEFAULT_SETTINGS);
    state.active = null;
    router.go('home');
    renderOnboarding();
  });
}

function renderSafety() {
  renderShell(`
    <section class="hero"><p class="eyebrow">Public guidance</p><h1>安全案内</h1><p class="lead">急な強い症状や、いつもと明らかに違う症状がある場合は、このアプリの結果を待たずに行動してください。</p></section>
    <section class="panel"><h2>緊急時</h2><p class="muted">緊急性が高いと感じるときは119番へ。</p><a class="safety-number" href="tel:119">119</a></section>
    <section class="section panel"><h2>判断に迷うとき</h2><p class="muted small">#7119は、実施地域で利用できる救急相談です。地域によって利用可否や対応時間が異なります。</p><a class="safety-number" href="tel:%237119">#7119</a><div class="external-list"><a href="https://www.fdma.go.jp/mission/enrichment/appropriate/appropriate007.html" target="_blank" rel="noopener">消防庁 #7119案内<span>↗</span></a><a href="https://www.fdma.go.jp/mission/enrichment/appropriate/appropriate003.html" target="_blank" rel="noopener">全国版救急受診ガイド「Q助」<span>↗</span></a></div></section>
    <section class="section"><div class="notice"><p class="summary-text small">Condition Pulseは、症状の緊急度を判定しません。公的案内の内容を優先してください。</p></div></section>`, { navVisible: false });
}

async function persistSettings() {
  try { await saveSettings(state.settings); }
  catch (error) { state.storageError = error; }
}

function renderRoute(route) {
  if (!state.settings.onboardingCompleted && route !== 'safety') {
    renderOnboarding();
    return;
  }
  const renderers = {
    home: renderHome,
    checkin: renderCheckIn,
    complete: renderComplete,
    today: renderToday,
    trends: renderTrends,
    history: renderHistory,
    settings: renderSettings,
    safety: renderSafety
  };
  (renderers[route] ?? renderHome)();
}

const router = createRouter(renderRoute);

async function loadQuestions() {
  try {
    const response = await fetch('./data/questions.ja.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Question bank HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.questions) || data.questions.length < 60) throw new Error('Question bank is incomplete');
    return data.questions;
  } catch (error) {
    console.error('Question bank load failed', error?.message);
    return fallbackQuestions;
  }
}

async function initialize() {
  const [questions, settingsResult, sessionsResult] = await Promise.allSettled([loadQuestions(), getSettings(), getSessions()]);
  state.questions = questions.status === 'fulfilled' ? questions.value : fallbackQuestions;
  state.questionMap = new Map(state.questions.map(question => [question.id, question]));
  if (settingsResult.status === 'fulfilled') state.settings = settingsResult.value;
  else state.storageError = settingsResult.reason;
  if (sessionsResult.status === 'fulfilled') state.sessions = sessionsResult.value;
  else state.storageError = sessionsResult.reason;
  document.documentElement.classList.toggle('reduce-motion', state.settings.reducedMotion);
  router.start();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed', error?.message));
  }
}

initialize().catch(error => {
  console.error('Application initialization failed', error?.name);
  appRoot.innerHTML = '<div class="error-card"><h1>アプリを起動できませんでした</h1><p>ページを再読み込みしてください。</p></div>';
});
