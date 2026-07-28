import { APP_VERSION, CONTEXT_TAGS, DEFAULT_SETTINGS, DOMAIN_LABELS, QUESTION_BANK_VERSION, TIME_BAND_LABELS } from './config.js';
import { createRouter } from './router.js';
import { createCheckIn, buildResponse, getResponseLabels } from './checkin.js';
import { selectQuestions } from './question-selector.js';
import { aggregateByDomain, getSessionDomainValues, isWarmupComplete } from './scoring.js';
import { generateFeedback, hasSafetySignal, summarizeToday } from './feedback.js';
import { clearAllData, deleteSession, getSessions, getSettings, importDataAtomic, saveSession, saveSettings } from './storage.js';
import { exportCsv, exportJson } from './export.js';
import { mergeSessionsById, parseBackupText, previewImport } from './import.js';
import { getQuestionPreference, QUESTION_PREFERENCE, setQuestionPreference, summarizePreferences } from './preferences.js';
import { calculateReadiness, dailyObservationMessage } from './readiness.js';
import { detectPatterns } from './patterns.js';
import { setupUpdateManager } from './update-manager.js';
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
  storageError: null,
  pendingImport: null,
  importPreview: null,
  editingOriginal: null,
  updateWorker: null,
  updateManager: null,
  updateAfterCheckin: false
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

function updateBanner() {
  if (!state.updateWorker) return '';
  return `<div class="update-banner" role="status">
    <div><strong>新しいバージョンがあります</strong><span>入力中の内容を守ってから更新できます。</span></div>
    <div class="update-banner__actions"><button type="button" data-action="dismiss-update">あとで</button><button type="button" data-action="apply-update">更新</button></div>
  </div>`;
}

function renderShell(content, { route = 'home', focus = true, navVisible = true, close = false } = {}) {
  appRoot.innerHTML = `<div class="page ${navVisible ? '' : 'page--focus'}">${header({ close })}<main id="app-main" tabindex="-1">${content}</main></div>${updateBanner()}${navVisible ? nav(route) : ''}`;
  if (focus) requestAnimationFrame(() => document.querySelector('#app-main')?.focus({ preventScroll: true }));
  bindGlobalActions();
}

function bindGlobalActions() {
  document.querySelector('[data-action="close-checkin"]')?.addEventListener('click', () => {
    state.active = null;
    state.activeQuestions = [];
    state.editingOriginal = null;
    router.go('home');
  });
  document.querySelector('[data-action="dismiss-update"]')?.addEventListener('click', () => {
    state.updateWorker = null;
    renderRoute(router.current());
  });
  document.querySelector('[data-action="apply-update"]')?.addEventListener('click', () => {
    if (state.active && !state.active.completedAt) {
      state.updateAfterCheckin = true;
      alert('回答を保存した後に更新します。');
      return;
    }
    state.updateManager?.applyUpdate(state.updateWorker);
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
      <div class="notice"><p class="summary-text small">ブラウザのデータ削除や端末変更で記録が失われる場合があります。設定からバックアップできます。</p></div>
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
  const readiness = calculateReadiness(state.sessions);
  const patterns = detectPatterns(state.sessions, state.questionMap);
  const dailyMessage = dailyObservationMessage(state.sessions, localDate);

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
      <div class="panel">${flowMarkup(localDate)}<p class="summary-text ${state.settings.privacyMode ? 'muted' : ''}" style="margin-top:1rem">${state.settings.privacyMode ? 'プライバシーモード中：要約を非表示にしています。' : escapeHtml(summary)}</p><p class="small muted">${escapeHtml(dailyMessage)}</p></div>
    </section>

    <section class="section"><div class="notice readiness-card"><p class="eyebrow">観測のようす</p><p class="summary-text"><strong>${escapeHtml(readiness.title)}</strong><br><span class="muted small">${escapeHtml(readiness.description)}</span></p></div></section>

    ${patterns[0] ? `<section class="section"><div class="section-heading"><h2>最近の変化の型</h2><a href="#/trends">詳しく見る</a></div><div class="pattern-card"><strong>${escapeHtml(patterns[0].title)}</strong><p class="small muted">${escapeHtml(patterns[0].description)}</p><span class="pattern-card__meta">${patterns[0].evaluableDays}日中${patterns[0].count}日</span></div></section>` : ''}
  `, { route: 'home' });

  document.querySelector('[data-action="start"]')?.addEventListener('click', () => startCheckIn(false));
  document.querySelector('[data-action="start-adhoc"]')?.addEventListener('click', () => startCheckIn(true));
}

function startCheckIn(adHoc, existing = null) {
  const now = new Date();
  const timeBand = existing?.timeBand ?? getTimeBand(now, state.settings);
  const localDate = existing?.localDate ?? getObservationDate(now, state.settings);
  state.activeQuestions = existing
    ? (existing.questionIds ?? []).map(id => state.questionMap.get(id)).filter(Boolean)
    : selectQuestions({
        questions: state.questions,
        timeBand,
        sessions: state.sessions,
        now,
        localDate,
        count: 3,
        preferences: state.settings.questionPreferences
      });
  if (state.activeQuestions.length < 3) state.activeQuestions = fallbackQuestions;
  state.editingOriginal = existing ? structuredClone(existing) : null;
  state.active = createCheckIn({
    questions: state.activeQuestions,
    settings: state.settings,
    sessionType: adHoc ? 'ad_hoc' : 'scheduled',
    now,
    existing
  });
  state.activeIndex = 0;
  state.questionShownAt = new Date();
  router.go('checkin');
}

function questionOptionsDialog(question) {
  const preference = getQuestionPreference(state.settings.questionPreferences, question.id);
  const hiddenDisabled = question.domain === 'overall';
  return `<dialog class="question-dialog" id="question-dialog">
    <form method="dialog">
      <p class="eyebrow">この質問について</p>
      <h2>${escapeHtml(question.prompt)}</h2>
      <p class="small muted">設定は次回以降の質問選択に反映します。</p>
      <div class="choice-stack">
        <button value="normal" data-preference="normal" class="${preference === 'normal' ? 'is-selected' : ''}">通常どおり表示</button>
        <button value="less" data-preference="less" class="${preference === 'less' ? 'is-selected' : ''}">出現頻度を減らす</button>
        <button value="hidden" data-preference="hidden" ${hiddenDisabled ? 'disabled' : ''} class="${preference === 'hidden' ? 'is-selected' : ''}">今後表示しない</button>
      </div>
      ${hiddenDisabled ? '<p class="small muted">全体感の質問はチェックインの基準になるため、完全には非表示にできません。</p>' : ''}
      <button class="text-button" value="cancel">閉じる</button>
    </form>
  </dialog>`;
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
      <div class="question-tools">
        ${state.activeIndex > 0 ? '<button class="text-button" type="button" data-action="previous-question">一つ前へ</button>' : '<span></span>'}
        <button class="text-button" type="button" data-action="question-options">この質問について</button>
      </div>
    </div>
    ${questionOptionsDialog(question)}
  `, { navVisible: false, close: true });

  document.querySelector('.answer-button')?.focus({ preventScroll: true });
  document.querySelectorAll('[data-answer]').forEach(button => button.addEventListener('click', () => answerQuestion(Number(button.dataset.answer))));
  document.querySelector('[data-action="previous-question"]')?.addEventListener('click', previousQuestion);
  document.querySelector('[data-action="question-options"]')?.addEventListener('click', () => document.querySelector('#question-dialog')?.showModal());
  document.querySelectorAll('[data-preference]').forEach(button => button.addEventListener('click', async event => {
    event.preventDefault();
    state.settings.questionPreferences = setQuestionPreference(
      state.settings.questionPreferences,
      question.id,
      button.dataset.preference
    );
    await persistSettings();
    document.querySelector('#question-dialog')?.close();
  }));
}

function previousQuestion() {
  if (state.activeIndex <= 0) return;
  state.activeIndex -= 1;
  state.active.responses = state.active.responses.slice(0, state.activeIndex);
  state.questionShownAt = new Date();
  renderCheckIn();
}

async function answerQuestion(selectedIndex) {
  const question = state.activeQuestions[state.activeIndex];
  state.active.responses[state.activeIndex] = buildResponse(question, selectedIndex, state.questionShownAt, new Date());
  state.active.responses = state.active.responses.slice(0, state.activeIndex + 1);
  state.activeIndex += 1;
  if (state.activeIndex < state.activeQuestions.length) {
    state.questionShownAt = new Date();
    renderCheckIn();
    return;
  }

  state.active.completedAt = new Date().toISOString();
  if (state.editingOriginal) {
    state.active.revision = Number(state.editingOriginal.revision ?? 0) + 1;
    state.active.editedAt = state.active.completedAt;
  }
  const prior = state.sessions.filter(session => session.id !== state.active.id);
  state.lastFeedback = generateFeedback(state.active, prior, state.questionMap);
  state.lastSafetySignal = hasSafetySignal(state.active, state.questionMap);
  try {
    await saveSession(state.active);
    const index = state.sessions.findIndex(session => session.id === state.active.id);
    if (index >= 0) state.sessions[index] = structuredClone(state.active);
    else state.sessions.push(structuredClone(state.active));
    state.sessions.sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
    state.editingOriginal = null;
    router.go('complete');
    if (state.updateAfterCheckin) {
      state.updateAfterCheckin = false;
      setTimeout(() => state.updateManager?.applyUpdate(state.updateWorker), 400);
    }
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
      const index = state.sessions.findIndex(session => session.id === state.active.id);
      if (index >= 0) state.sessions[index] = structuredClone(state.active);
      else state.sessions.push(structuredClone(state.active));
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
    ${state.lastSafetySignal ? `<section class="section"><div class="notice notice--safety"><p class="summary-text"><strong>いつもと明らかに違う強い症状がありますか？</strong><br><span class="small">このアプリだけで判断せず、公的な救急案内を確認してください。</span></p><a class="secondary-button inline-action" href="#/safety">安全案内を見る</a></div></section>` : ''}
    <section class="section" aria-labelledby="tag-heading">
      <div class="section-heading"><h2 id="tag-heading">きっかけを一つ残す</h2><span class="muted small">任意</span></div>
      <div class="tag-list">${CONTEXT_TAGS.map(tag => `<button class="tag-button" type="button" aria-pressed="${state.active.contextTag === tag}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}</div>
    </section>
    <section class="section compact-actions">
      <button class="secondary-button" type="button" data-action="edit-session">回答を修正</button>
      <button class="text-button danger-text" type="button" data-action="delete-session">この記録を取り消す</button>
    </section>
    <div class="button-row"><a class="primary-button link-button" href="#/today">今日の流れを見る</a><a class="secondary-button link-button" href="#/home">ホームへ</a></div>
  `, { navVisible: false });

  document.querySelectorAll('[data-tag]').forEach(button => button.addEventListener('click', async () => {
    state.active.contextTag = button.dataset.tag;
    const index = state.sessions.findIndex(session => session.id === state.active.id);
    if (index >= 0) state.sessions[index].contextTag = state.active.contextTag;
    try { await saveSession(state.active); } catch { /* Tag failure does not invalidate the completed session. */ }
    document.querySelectorAll('[data-tag]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  document.querySelector('[data-action="edit-session"]')?.addEventListener('click', () => startCheckIn(false, state.active));
  document.querySelector('[data-action="delete-session"]')?.addEventListener('click', async () => {
    if (!confirm('この記録を取り消しますか？元に戻せません。')) return;
    await deleteSession(state.active.id);
    state.sessions = state.sessions.filter(session => session.id !== state.active.id);
    state.active = null;
    router.go('home');
  });
}

function sessionCard(session) {
  if (!session) return `<article class="time-card"><div class="time-card__head"><h3>未記録</h3><span class="time-card__value">○</span></div><p class="muted small">回答がなくても、悪い値としては扱いません。</p></article>`;
  const values = getSessionDomainValues(session, state.questionMap);
  const overall = values.get('overall');
  const domains = [...values.keys()].filter(domain => domain !== 'overall');
  return `<article class="time-card time-card--done">
    <div class="time-card__head"><div><h3>${TIME_BAND_LABELS[session.timeBand]}${session.sessionType === 'ad_hoc' ? '・追加' : ''}</h3><span class="muted small">${new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date(session.completedAt))}${session.editedAt ? '・修正済み' : ''}</span></div><span class="time-card__value" aria-label="全体感 ${overallGlyph(overall)}">${overallGlyph(overall)}</span></div>
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
    <section class="section"><div class="notice"><p class="summary-text small">${escapeHtml(dailyObservationMessage(state.sessions, localDate))}<br>未回答の時間帯は空欄のままで、状態の悪化とはみなしません。</p></div></section>`, { route: 'today' });
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
  const patterns = detectPatterns(state.sessions, state.questionMap);
  renderShell(`
    <section class="hero"><p class="eyebrow">Seven-day pattern</p><h1>7日間の傾向</h1><p class="lead">${warmup ? '数値そのものではなく、領域ごとの動きを表示します。' : '平常値を学習中です。今は記録の分布だけを静かに示します。'}</p></section>
    ${patterns.length ? `<section class="section"><div class="section-heading"><h2>14日間の変化の型</h2></div><div class="pattern-list">${patterns.map(pattern => `<article class="pattern-card"><strong>${escapeHtml(pattern.title)}</strong><p class="small muted">${escapeHtml(pattern.description)}</p><span class="pattern-card__meta">${pattern.evaluableDays}日中${pattern.count}日</span></article>`).join('')}</div></section>` : '<div class="notice"><p class="summary-text">変化の型を示すには、同じ日に2回以上記録した日がもう少し必要です。</p></div>'}
    ${trends.length ? `<div class="trend-grid">${trends.map(item => {
      const width = Math.max(5, Math.min(95, ((item.average + 2) / 4) * 100));
      return `<article class="trend-card"><div class="time-card__head"><h2>${DOMAIN_LABELS[item.domain]}</h2><span class="muted small">${item.sampleCount}回</span></div><p class="small muted">${trendDescription(item)}</p><div class="trend-meter" aria-label="回答分布の位置"><span style="width:${width}%"></span></div></article>`;
    }).join('')}</div>` : '<div class="notice"><p class="summary-text">まだ傾向を表示できる記録がありません。</p></div>'}
    <section class="section"><div class="notice"><p class="summary-text small">ここで示す傾向や変化の型は、診断、健康度、原因の推定ではありません。</p></div></section>
    <section class="section"><div class="section-heading"><h2>最近の履歴</h2><a href="#/history">一覧を見る</a></div></section>`, { route: 'trends' });
}

function renderHistory() {
  const ordered = [...state.sessions].sort((a,b) => new Date(b.completedAt) - new Date(a.completedAt));
  renderShell(`
    <section class="hero"><p class="eyebrow">Local archive</p><h1>履歴</h1><p class="lead">この端末のブラウザ内に保存されている記録です。</p></section>
    <div class="history-list">${ordered.length ? ordered.slice(0,100).map(session => {
      const overall = getSessionDomainValues(session, state.questionMap).get('overall');
      return `<article class="history-item"><div class="history-item__head"><div><h3>${formatDateJa(session.localDate)}・${TIME_BAND_LABELS[session.timeBand]}</h3><span class="muted small">${new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date(session.completedAt))}${session.sessionType === 'ad_hoc' ? '・追加' : ''}${session.editedAt ? '・修正済み' : ''}</span></div><span class="time-card__value">${overallGlyph(overall)}</span></div>${session.contextTag ? `<p class="small muted">きっかけ：${escapeHtml(session.contextTag)}</p>` : ''}</article>`;
    }).join('') : '<div class="notice"><p class="summary-text">まだ記録はありません。</p></div>'}</div>`, { route: 'trends' });
}

function customizedQuestionMarkup() {
  const entries = Object.entries(state.settings.questionPreferences ?? {});
  if (!entries.length) return '<p class="muted small">調整した質問はありません。質問画面の「この質問について」から設定できます。</p>';
  return `<div class="preference-list">${entries.map(([id, preference]) => {
    const question = state.questionMap.get(id);
    const label = preference === QUESTION_PREFERENCE.HIDDEN ? '表示しない' : '頻度を減らす';
    return `<div class="preference-item"><span>${escapeHtml(question?.prompt ?? id)}<small>${label}</small></span><button type="button" data-reset-question="${escapeHtml(id)}">元に戻す</button></div>`;
  }).join('')}</div>`;
}

function renderSettings() {
  const bands = state.settings.timeBands;
  const preferenceSummary = summarizePreferences(state.settings.questionPreferences);
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
    <section class="settings-group"><div class="section-heading"><h2>質問の表示設定</h2><span class="muted small">${preferenceSummary.customized}件調整</span></div><div class="panel">
      ${customizedQuestionMarkup()}
      ${preferenceSummary.customized ? '<button class="text-button" type="button" data-action="reset-question-preferences">すべて通常に戻す</button>' : ''}
    </div></section>
    <section class="settings-group"><div class="section-heading"><h2>データ</h2></div><div class="panel">
      <p class="muted small">バックアップには健康に関する私的な回答が含まれます。ファイルは外部サーバーへ送信しません。</p>
      <div class="button-row"><button class="secondary-button" type="button" data-action="export-json">JSONバックアップ</button><button class="secondary-button" type="button" data-action="import-json">JSONを読み込む</button><button class="secondary-button" type="button" data-action="export-csv">CSVを書き出す</button></div>
      <input class="visually-hidden" id="import-file" type="file" accept="application/json,.json">
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
  document.querySelectorAll('[data-reset-question]').forEach(button => button.addEventListener('click', async () => {
    state.settings.questionPreferences = setQuestionPreference(state.settings.questionPreferences, button.dataset.resetQuestion, QUESTION_PREFERENCE.NORMAL);
    await persistSettings();
    renderSettings();
  }));
  document.querySelector('[data-action="reset-question-preferences"]')?.addEventListener('click', async () => {
    if (!confirm('すべての質問設定を通常に戻しますか？')) return;
    state.settings.questionPreferences = {};
    await persistSettings();
    renderSettings();
  });
  document.querySelector('[data-action="export-json"]')?.addEventListener('click', () => exportJson({ sessions: state.sessions, settings: state.settings, appVersion: APP_VERSION, questionBankVersion: QUESTION_BANK_VERSION }));
  document.querySelector('[data-action="export-csv"]')?.addEventListener('click', () => exportCsv({ sessions: state.sessions, questionMap: state.questionMap }));
  document.querySelector('[data-action="import-json"]')?.addEventListener('click', () => document.querySelector('#import-file')?.click());
  document.querySelector('#import-file')?.addEventListener('change', handleImportFile);
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

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const backup = parseBackupText(await file.text());
    state.pendingImport = backup;
    state.importPreview = previewImport(state.sessions, backup);
    router.go('import');
  } catch (error) {
    alert(error?.message ?? 'バックアップを読み込めませんでした。');
  }
}

function renderImport() {
  if (!state.pendingImport || !state.importPreview) {
    router.go('settings');
    return;
  }
  const preview = state.importPreview;
  renderShell(`
    <section class="hero"><p class="eyebrow">Local restore</p><h1>バックアップを確認</h1><p class="lead">内容を確認してから、この端末へ反映します。</p></section>
    <section class="panel import-summary">
      <dl>
        <div><dt>記録</dt><dd>${preview.incomingCount}件</dd></div>
        <div><dt>期間</dt><dd>${preview.earliestDate ?? '—'}〜${preview.latestDate ?? '—'}</dd></div>
        <div><dt>既存との重複</dt><dd>${preview.duplicates}件</dd></div>
        <div><dt>バックアップ形式</dt><dd>v${preview.schemaVersion}</dd></div>
      </dl>
    </section>
    <section class="section"><div class="notice"><p class="summary-text small"><strong>追加・統合</strong>は現在の記録を残し、未登録の記録だけを追加します。設定は現在のものを維持します。</p></div></section>
    <button class="primary-button" type="button" data-action="merge-import">追加・統合する（${preview.additions}件）</button>
    <section class="section"><div class="notice notice--safety"><p class="summary-text small"><strong>置き換え</strong>は現在の記録と設定を、バックアップの内容で置き換えます。実行前に現在のJSONを自動で書き出します。</p></div></section>
    <button class="danger-button full-button" type="button" data-action="replace-import">現在のデータを置き換える</button>
    <button class="text-button full-button" type="button" data-action="cancel-import">キャンセル</button>
  `, { navVisible: false });

  document.querySelector('[data-action="merge-import"]')?.addEventListener('click', () => performImport('merge'));
  document.querySelector('[data-action="replace-import"]')?.addEventListener('click', async () => {
    if (!confirm('現在のデータをバックアップ内容で置き換えますか？')) return;
    if (!confirm('この操作は元に戻せません。続けますか？')) return;
    exportJson({ sessions: state.sessions, settings: state.settings, appVersion: APP_VERSION, questionBankVersion: QUESTION_BANK_VERSION });
    await performImport('replace');
  });
  document.querySelector('[data-action="cancel-import"]')?.addEventListener('click', () => {
    state.pendingImport = null;
    state.importPreview = null;
    router.go('settings');
  });
}

async function performImport(mode) {
  try {
    if (mode === 'merge') {
      const merged = mergeSessionsById(state.sessions, state.pendingImport.sessions);
      await importDataAtomic({ sessions: state.pendingImport.sessions, settings: null, mode: 'merge' });
      state.sessions = merged.sessions;
      alert(`${merged.added}件の記録を追加しました。`);
    } else {
      await importDataAtomic({ sessions: state.pendingImport.sessions, settings: state.pendingImport.settings, mode: 'replace' });
      state.sessions = state.pendingImport.sessions;
      state.settings = state.pendingImport.settings;
      alert('バックアップから復元しました。');
    }
    state.pendingImport = null;
    state.importPreview = null;
    router.go('settings');
  } catch (error) {
    console.error('Import failed', error?.name);
    alert('復元できませんでした。現在のデータは変更されていない可能性があります。');
  }
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
  if (!state.settings.onboardingCompleted && route !== 'safety' && route !== 'import') {
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
    import: renderImport,
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

  try {
    state.updateManager = await setupUpdateManager({
      onUpdateAvailable(worker) {
        state.updateWorker = worker;
        renderRoute(router.current());
      },
      onControllerChange() {
        location.reload();
      }
    });
  } catch (error) {
    console.warn('Service worker registration failed', error?.message);
  }
}

initialize().catch(error => {
  console.error('Application initialization failed', error?.name);
  appRoot.innerHTML = '<div class="error-card"><h1>アプリを起動できませんでした</h1><p>ページを再読み込みしてください。</p></div>';
});
