import { APP_VERSION, CONTEXT_LEVELS, IMAGE_LIMITS } from './config.js';
import {
  openDb, put, get, del, getAll, getAllByIndex, createConversation, listConversations,
  listMessages, activeBranch, siblingsOf, saveMessage, removeConversation, getSettings,
  saveSettings, logEvent, purgeOldLogs, storageEstimate,
} from './storage.js';
import { LocalLanguageModel, AiError, promptMessage, summarizeConversation } from './ai.js';
import { normalizeImage, validateImage, totalNormalizedBytes } from './images.js';
import { renderMarkdown } from './markdown.js';
import {
  id, now, formatBytes, formatDuration, formatDateTime, debounce, downloadText,
  blobToDataUrl, dataUrlToBlob, chromeVersion,
} from './utils.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  settings: null,
  conversations: [],
  conversation: null,
  branch: [],
  drafts: [],
  generation: 'idle',
  abortController: null,
  generationStartedAt: null,
  elapsedTimer: null,
  capability: { supported: false, availability: 'checking', download: null },
  context: { contextWindow: 0, contextUsage: 0, remaining: 0, percentage: 0 },
  measuredNext: null,
  sessionConversationId: null,
  sessionLeafId: null,
  injectedIds: new Set(),
  objectUrls: new Map(),
  inspectorTab: 'context',
  query: '',
};

const ai = new LocalLanguageModel({
  onDownloadProgress: (progress) => {
    state.capability.download = progress;
    state.capability.availability = 'downloading';
    updateCapabilityUi();
    logEvent('model_download_progress', { progress }).catch(() => {});
  },
  onOverflow: () => {
    logEvent('context_overflow', contextLogData()).catch(() => {});
    addEventCard('コンテキスト上限に達したため、Chromeが古い会話ペアを除外しました。完全な履歴は端末内に保存されています。', 'warning');
    updateContext();
  },
});

function contextLogData() {
  return {
    conversationId: state.conversation?.id || null,
    contextWindow: state.context.contextWindow,
    contextUsageAfter: state.context.contextUsage,
  };
}

function toast(message, tone = 'info') {
  const root = $('#toasts');
  const item = document.createElement('div');
  item.className = `toast ${tone}`;
  item.textContent = message;
  root.append(item);
  setTimeout(() => item.remove(), 4200);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
}

async function refreshConversations() {
  state.conversations = await listConversations();
  renderSidebar();
}

async function setConversation(conversationId) {
  if (state.generation === 'generating') return;
  state.conversation = await get('conversations', conversationId);
  if (!state.conversation) return;
  state.branch = await activeBranch(state.conversation);
  state.measuredNext = null;
  state.drafts = [];
  revokeObjectUrls();
  renderAll();
  if (state.sessionConversationId !== conversationId) {
    await ai.destroy();
    state.sessionConversationId = null;
    state.sessionLeafId = null;
    state.injectedIds.clear();
    updateContext();
  }
}

function renderAll() {
  renderSidebar();
  renderChat();
  renderDrafts();
  renderInspector();
  updateContext();
  updateCapabilityUi();
}

function renderSidebar() {
  const list = $('#conversation-list');
  if (!list) return;
  const q = state.query.trim().toLowerCase();
  const filtered = state.conversations.filter((c) => !q || c.title.toLowerCase().includes(q));
  list.innerHTML = filtered.map((c) => `
    <div class="conversation-row ${c.id === state.conversation?.id ? 'active' : ''}" data-id="${c.id}">
      <button class="conversation-open" type="button" title="${escapeAttr(c.title)}">
        <span class="conversation-title">${escapeHtml(c.title)}</span>
        <span class="conversation-time">${formatDateTime(c.updatedAt)}</span>
      </button>
      <button class="icon-button conversation-menu" type="button" aria-label="会話メニュー">•••</button>
    </div>`).join('') || '<div class="empty-small">該当する会話はありません。</div>';
}

function escapeHtml(text = '') {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function escapeAttr(text = '') { return escapeHtml(text).replace(/`/g, '&#96;'); }

async function messageAttachments(messageId) {
  return await getAllByIndex('attachments', 'messageId', messageId);
}

async function attachmentThumbHtml(att) {
  const url = objectUrl(att.id, att.thumbnailBlob || att.normalizedBlob);
  return `<button class="message-image" type="button" data-attachment-id="${att.id}" title="${escapeAttr(att.name)}"><img src="${url}" alt="${escapeAttr(att.name)}"></button>`;
}

async function renderChat() {
  const chat = $('#chat-messages');
  if (!state.conversation) {
    chat.innerHTML = '<div class="welcome"><h2>Nano Workbench</h2><p>新しい会話を作成してください。</p></div>';
    return;
  }
  state.branch = await activeBranch(state.conversation);
  if (!state.branch.length) {
    chat.innerHTML = `<div class="welcome"><div class="local-mark">LOCAL</div><h2>何を一緒に考えますか？</h2><p>会話と添付画像はこのChromeプロファイル内に保存されます。</p><div class="starter-grid"><button data-starter="この文章を簡潔に整理してください。">文章を整理</button><button data-starter="添付画像の内容と注意点を説明してください。">画像を読む</button><button data-starter="このアイデアの長所・短所・改善案を考えてください。">アイデアを検討</button></div></div>`;
    return;
  }

  const all = await listMessages(state.conversation.id);
  const parts = [];
  for (const message of state.branch) {
    const attachments = await messageAttachments(message.id);
    const images = (await Promise.all(attachments.map(attachmentThumbHtml))).join('');
    const siblings = all.filter((m) => m.parentMessageId === message.parentMessageId && m.role === message.role).sort((a, b) => a.createdAt - b.createdAt);
    const variantIndex = siblings.findIndex((m) => m.id === message.id);
    const variants = siblings.length > 1 ? `<span class="variants"><button data-variant="prev" data-message-id="${message.id}" ${variantIndex === 0 ? 'disabled' : ''}>‹</button><span>${variantIndex + 1} / ${siblings.length}</span><button data-variant="next" data-message-id="${message.id}" ${variantIndex === siblings.length - 1 ? 'disabled' : ''}>›</button></span>` : '';
    const body = message.role === 'assistant' ? renderMarkdown(message.text || '') : `<div class="user-text">${escapeHtml(message.text || '').replace(/\n/g, '<br>')}</div>`;
    parts.push(`<article class="message ${message.role} ${message.status}" data-message-id="${message.id}">
      <div class="message-head"><span>${message.role === 'assistant' ? 'Nano' : 'You'}</span><span class="message-meta">${message.status !== 'complete' ? escapeHtml(message.status) : ''}</span></div>
      ${images ? `<div class="message-images">${images}</div>` : ''}
      <div class="message-body">${body}${message.status === 'streaming' ? '<span class="stream-cursor">▋</span>' : ''}</div>
      <div class="message-actions">
        ${message.role === 'assistant' ? `<button data-action="copy" data-message-id="${message.id}">コピー</button><button data-action="regenerate" data-message-id="${message.id}">再生成</button>` : `<button data-action="edit" data-message-id="${message.id}">編集</button>`}
        ${variants}
        ${message.elapsedMs ? `<span>${formatDuration(message.elapsedMs)}</span>` : ''}
      </div>
    </article>`);
  }
  chat.innerHTML = parts.join('');
  wireCodeCopy(chat);
  requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
}

function wireCodeCopy(root) {
  root.querySelectorAll('.copy-code').forEach((button) => {
    button.addEventListener('click', () => {
      const code = button.nextElementSibling?.textContent || '';
      navigator.clipboard.writeText(code).then(() => toast('コードをコピーしました。'));
    });
  });
}

function renderDrafts() {
  const root = $('#draft-attachments');
  root.innerHTML = state.drafts.map((att) => {
    const url = objectUrl(`draft-${att.id}`, att.thumbnailBlob || att.normalizedBlob);
    return `<div class="draft-attachment"><img src="${url}" alt="${escapeAttr(att.name)}"><span>${escapeHtml(att.name)}</span><button type="button" data-remove-draft="${att.id}" aria-label="削除">×</button></div>`;
  }).join('');
  $('#attach-count').textContent = state.drafts.length ? `${state.drafts.length}枚` : '';
}

function objectUrl(key, blob) {
  if (!blob) return '';
  if (!state.objectUrls.has(key)) state.objectUrls.set(key, URL.createObjectURL(blob));
  return state.objectUrls.get(key);
}
function revokeObjectUrls() {
  for (const url of state.objectUrls.values()) URL.revokeObjectURL(url);
  state.objectUrls.clear();
}

function contextClass(ratio) {
  if (ratio >= CONTEXT_LEVELS.critical) return 'critical';
  if (ratio >= CONTEXT_LEVELS.warning) return 'warning';
  if (ratio >= CONTEXT_LEVELS.notice) return 'notice';
  return 'normal';
}

function updateContext() {
  state.context = ai.snapshot();
  const { contextWindow, contextUsage, remaining, percentage } = state.context;
  const label = contextWindow ? `${Math.round(contextUsage).toLocaleString()} / ${Math.round(contextWindow).toLocaleString()}` : '— / —';
  $('#header-context').textContent = label;
  $('#context-percent').textContent = contextWindow ? `${Math.round(percentage * 100)}%` : '—';
  $('#context-usage').textContent = contextWindow ? `${Math.round(contextUsage).toLocaleString()} tokens` : '—';
  $('#context-window').textContent = contextWindow ? `${Math.round(contextWindow).toLocaleString()} tokens` : '—';
  $('#context-remaining').textContent = contextWindow ? `${Math.round(remaining).toLocaleString()} tokens` : '—';
  const meter = $('#context-meter');
  meter.max = Math.max(1, contextWindow);
  meter.value = contextUsage;
  meter.className = contextClass(percentage);
  meter.setAttribute('aria-valuenow', String(contextUsage));
  meter.setAttribute('aria-valuemax', String(contextWindow || 1));
  const projected = state.measuredNext != null && contextWindow ? contextUsage + state.measuredNext : null;
  $('#measured-next').textContent = state.measuredNext != null ? `+${Math.round(state.measuredNext).toLocaleString()} tokens` : '—';
  $('#projected-context').textContent = projected != null ? `${Math.round(projected).toLocaleString()} / ${Math.round(contextWindow).toLocaleString()}` : '—';
  const footer = $('#composer-context');
  if (!contextWindow) footer.textContent = 'AIを準備するとコンテキスト使用量を表示します。';
  else if (state.measuredNext == null) footer.textContent = `Context ${label} tokens`;
  else footer.textContent = `今回 +${Math.round(state.measuredNext).toLocaleString()} → ${Math.round(projected).toLocaleString()} / ${Math.round(contextWindow).toLocaleString()} tokens`;
  renderContextHint(projected ? projected / contextWindow : percentage);
}

function renderContextHint(ratio) {
  const hint = $('#context-hint');
  if (!state.context.contextWindow) { hint.textContent = '実行環境から取得した正式値を表示します。'; return; }
  if (ratio >= 0.9) hint.textContent = '上限が近いです。送信前に会話の圧縮を推奨します。';
  else if (ratio >= 0.8) hint.textContent = '長い会話です。必要なら圧縮できます。';
  else hint.textContent = 'Chrome Prompt APIが返す正式なセッション使用量です。';
}

function updateCapabilityUi() {
  const badge = $('#ai-status');
  const prepare = $('#prepare-ai');
  const av = state.capability.availability;
  let label = '確認中';
  let tone = 'muted';
  if (av === 'available') { label = state.sessionConversationId ? 'Local AI ready' : 'モデル利用可'; tone = 'ready'; }
  else if (av === 'downloadable') { label = 'モデル未取得'; tone = 'warn'; }
  else if (av === 'downloading') { label = `Downloading ${Math.round((state.capability.download || 0) * 100)}%`; tone = 'warn'; }
  else if (av === 'unavailable' || av === 'unsupported') { label = '利用不可'; tone = 'error'; }
  badge.textContent = `● ${label}`;
  badge.dataset.tone = tone;
  prepare.hidden = av === 'unsupported' || av === 'unavailable';
  prepare.textContent = state.sessionConversationId ? 'AI準備済み' : (av === 'downloading' ? '準備中…' : 'AIを準備');
  prepare.disabled = state.generation !== 'idle' || !!state.sessionConversationId;
  $('#capability-value').textContent = av;
  $('#download-value').textContent = state.capability.download == null ? '—' : `${Math.round(state.capability.download * 100)}%`;
}

async function checkCapability() {
  state.capability.supported = ai.supported();
  if (!state.capability.supported) {
    state.capability.availability = 'unsupported';
  } else {
    try { state.capability.availability = await ai.availability(); }
    catch (error) { state.capability.availability = 'unavailable'; console.error(error); }
  }
  await logEvent('capability_checked', { availability: state.capability.availability, chromeVersion: chromeVersion() });
  updateCapabilityUi();
}

async function branchForLeaf(conversationId, leafId) {
  if (!leafId) return [];
  const all = await listMessages(conversationId);
  const map = new Map(all.map((m) => [m.id, m]));
  const out = [];
  let cursor = map.get(leafId);
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id); out.push(cursor);
    cursor = cursor.parentMessageId ? map.get(cursor.parentMessageId) : null;
  }
  return out.reverse();
}

async function loadAttachments(ids = []) {
  return (await Promise.all(ids.map((x) => get('attachments', x)))).filter(Boolean);
}

async function buildReplay(conversation, leafId) {
  const branch = await branchForLeaf(conversation.id, leafId);
  const summary = conversation.compactSummaryId ? await get('summaries', conversation.compactSummaryId) : null;
  const complete = branch.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.status === 'complete'));
  const recent = complete.slice(-12);
  const imageUserIds = recent.filter((m) => m.role === 'user' && m.attachmentIds?.length).slice(-2).map((m) => m.id);
  const initial = summary ? [
    { role: 'user', content: '以前の会話の要約です。これを前提として会話を継続してください。' },
    { role: 'assistant', content: summary.summary },
  ] : [];
  const replay = [];
  for (const m of recent) {
    if (m.role === 'user' && m.attachmentIds?.length && imageUserIds.includes(m.id)) {
      const atts = await loadAttachments(m.attachmentIds);
      replay.push({ message: [{ role: 'user', content: [
        { type: 'text', value: m.text || '添付画像を確認してください。' },
        ...atts.map((a) => ({ type: 'image', value: a.normalizedBlob })),
      ] }], attachmentIds: atts.map((a) => a.id) });
    } else {
      const note = m.role === 'user' && m.attachmentIds?.length ? '\n[この過去メッセージには保存済み画像がありますが、現在のセッションには再投入していません。]' : '';
      replay.push({ message: [{ role: m.role, content: `${m.text || ''}${note}` }], attachmentIds: [] });
    }
  }
  return { initial, replay };
}

async function ensureSessionForLeaf(conversationId, leafId = null, force = false) {
  if (!force && ai.session && state.sessionConversationId === conversationId && state.sessionLeafId === leafId) return;
  const conversation = await get('conversations', conversationId);
  if (!conversation) throw new Error('会話が見つかりません。');
  setGenerationState('preparing');
  state.injectedIds.clear();
  const { initial, replay } = await buildReplay(conversation, leafId);
  await ai.createSession({ initialPrompts: initial });
  state.sessionConversationId = conversationId;
  state.sessionLeafId = null;
  await logEvent('session_created', { conversationId, chromeVersion: chromeVersion(), ...contextLogData() });
  for (const item of replay) {
    try {
      await ai.append(item.message);
      item.attachmentIds.forEach((x) => state.injectedIds.add(x));
    } catch (error) {
      if (error.code === 'CONTEXT_EXCEEDED') break;
      throw error;
    }
  }
  state.sessionLeafId = leafId;
  state.capability.availability = 'available';
  updateContext();
  setGenerationState('idle');
  renderInspector();
}

function setGenerationState(value) {
  state.generation = value;
  const send = $('#send-button');
  const stop = $('#stop-button');
  const busy = !['idle', 'completed', 'cancelled', 'failed'].includes(value);
  send.hidden = value === 'generating' || value === 'stopping';
  stop.hidden = !(value === 'generating' || value === 'stopping');
  send.disabled = busy && value !== 'generating';
  $('#attach-button').disabled = busy;
  $('#composer-input').disabled = busy && value !== 'generating';
  $('#generation-state').textContent = value === 'idle' ? '' : value;
  updateCapabilityUi();
}

function startElapsed() {
  state.generationStartedAt = performance.now();
  clearInterval(state.elapsedTimer);
  state.elapsedTimer = setInterval(() => {
    $('#generation-elapsed').textContent = formatDuration(performance.now() - state.generationStartedAt);
  }, 500);
}
function stopElapsed() {
  clearInterval(state.elapsedTimer); state.elapsedTimer = null;
  $('#generation-elapsed').textContent = '';
}

async function measureDraft() {
  state.measuredNext = null;
  if (!ai.session || !state.conversation || state.generation !== 'idle') { updateContext(); return; }
  if (state.sessionConversationId !== state.conversation.id || state.sessionLeafId !== state.conversation.activeLeafId) { updateContext(); return; }
  const text = $('#composer-input').value;
  if (!text.trim() && !state.drafts.length) { updateContext(); return; }
  try {
    state.measuredNext = await ai.measure(promptMessage(text, state.drafts));
    await logEvent('prompt_measured', { conversationId: state.conversation.id, measuredInputUsage: state.measuredNext, ...contextLogData() });
  } catch { state.measuredNext = null; }
  updateContext();
}
const scheduleMeasure = debounce(measureDraft, 350);

async function persistDraftAttachments(messageId) {
  const saved = [];
  for (const draft of state.drafts) {
    const attachment = { ...draft, conversationId: state.conversation.id, messageId };
    await put('attachments', attachment);
    saved.push(attachment);
  }
  return saved;
}

async function sendMessage({ textOverride = null, attachmentIds = null, parentOverride = undefined, existingUserId = null } = {}) {
  if (!state.conversation || state.generation !== 'idle') return;
  const input = $('#composer-input');
  const existingUser = existingUserId ? await get('messages', existingUserId) : null;
  const text = textOverride ?? existingUser?.text ?? input.value.trim();
  const effectiveAttachmentIds = attachmentIds ?? existingUser?.attachmentIds ?? null;
  let attachments = effectiveAttachmentIds ? await loadAttachments(effectiveAttachmentIds) : [...state.drafts];
  if (!text && !attachments.length) return;
  const parentId = existingUser ? existingUser.parentMessageId : (parentOverride !== undefined ? parentOverride : state.conversation.activeLeafId);

  try {
    await ensureSessionForLeaf(state.conversation.id, parentId);
    setGenerationState('measuring');
    const messagePayload = promptMessage(text, attachments);
    const measured = await ai.measure(messagePayload);
    state.measuredNext = measured;
    updateContext();
    if (state.context.contextWindow && state.context.contextUsage + measured > state.context.contextWindow) {
      throw new AiError('CONTEXT_EXCEEDED', 'この入力は現在のコンテキストに収まりません。会話を圧縮してから再送してください。');
    }
    if (state.context.contextWindow && (state.context.contextUsage + measured) / state.context.contextWindow >= (1 - state.settings.safetyMargin)) {
      toast('設定した安全余裕を下回る見込みです。次のターン前に圧縮を推奨します。', 'warning');
    }

    let userMessage = existingUser;
    if (!userMessage) {
      const userId = id('msg');
      if (!effectiveAttachmentIds) attachments = await persistDraftAttachments(userId);
      userMessage = {
        id: userId, conversationId: state.conversation.id, role: 'user', text,
        attachmentIds: attachments.map((x) => x.id), parentMessageId: parentId || null,
        createdAt: now(), status: 'complete', errorCode: null,
        contextUsageBefore: state.context.contextUsage, contextUsageAfter: null,
        measuredInputUsage: measured, elapsedMs: null,
      };
      await saveMessage(userMessage);

      if (state.conversation.title === '新しい会話') {
        state.conversation = await get('conversations', state.conversation.id);
        state.conversation.title = (text || attachments[0]?.name || '画像の会話').replace(/\s+/g, ' ').slice(0, 38);
        await put('conversations', state.conversation);
      }
    }

    const assistant = {
      id: id('msg'), conversationId: state.conversation.id, role: 'assistant', text: '', attachmentIds: [],
      parentMessageId: userMessage.id, createdAt: now() + 1, status: 'streaming', errorCode: null,
      contextUsageBefore: state.context.contextUsage, contextUsageAfter: null,
      measuredInputUsage: null, elapsedMs: null,
    };
    await saveMessage(assistant);
    state.conversation = await get('conversations', state.conversation.id);
    if (!existingUser) input.value = '';
    if (!existingUser) state.drafts = [];
    state.measuredNext = null;
    renderDrafts();
    await renderChat();
    await refreshConversations();

    setGenerationState('generating');
    state.abortController = new AbortController();
    const timeoutMs = attachments.length ? state.settings.imageTimeoutMs : state.settings.textTimeoutMs;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      state.abortController?.abort();
    }, timeoutMs);
    startElapsed();
    const started = performance.now();
    await logEvent('prompt_started', { conversationId: state.conversation.id, messageId: assistant.id, measuredInputUsage: measured, imageCount: attachments.length, normalizedImageBytes: totalNormalizedBytes(attachments), ...contextLogData() });

    let checkpoint = 0;
    try {
      const finalText = await ai.stream(messagePayload, {
        signal: state.abortController.signal,
        onText: async (full) => {
          assistant.text = full;
          const node = document.querySelector(`[data-message-id="${assistant.id}"] .message-body`);
          if (node) node.innerHTML = `${renderMarkdown(full)}<span class="stream-cursor">▋</span>`;
          if (performance.now() - checkpoint > 2000) {
            checkpoint = performance.now();
            await put('messages', { ...assistant });
          }
        },
      });
      assistant.text = finalText;
      assistant.status = 'complete';
      assistant.elapsedMs = Math.round(performance.now() - started);
      updateContext();
      assistant.contextUsageAfter = state.context.contextUsage;
      await put('messages', assistant);
      state.sessionLeafId = assistant.id;
      attachments.forEach((x) => state.injectedIds.add(x.id));
      await logEvent('prompt_completed', { conversationId: state.conversation.id, messageId: assistant.id, elapsedMs: assistant.elapsedMs, contextUsageBefore: assistant.contextUsageBefore, contextUsageAfter: assistant.contextUsageAfter, imageCount: attachments.length });
      setGenerationState('idle');
    } catch (error) {
      let normalized = error instanceof AiError ? error : new AiError('UNKNOWN_AI_ERROR', error.message, error);
      if (timedOut && normalized.code === 'USER_CANCELLED') normalized = new AiError('TIMEOUT', `生成が${Math.round(timeoutMs / 60000)}分の上限に達したため停止しました。`, error);
      assistant.status = normalized.code === 'USER_CANCELLED' ? 'cancelled' : 'failed';
      assistant.errorCode = normalized.code;
      assistant.elapsedMs = Math.round(performance.now() - started);
      updateContext();
      assistant.contextUsageAfter = state.context.contextUsage;
      await put('messages', assistant);
      state.sessionLeafId = null;
      await logEvent(normalized.code === 'USER_CANCELLED' ? 'prompt_cancelled' : 'prompt_failed', { conversationId: state.conversation.id, messageId: assistant.id, elapsedMs: assistant.elapsedMs, errorName: normalized.code, errorMessage: normalized.message, ...contextLogData() });
      if (normalized.code !== 'USER_CANCELLED') toast(normalized.message, 'error');
      setGenerationState('idle');
    } finally {
      clearTimeout(timeoutId);
      stopElapsed();
      state.abortController = null;
      state.conversation = await get('conversations', state.conversation.id);
      await renderChat();
      renderInspector();
      updateContext();
      scheduleMeasure();
    }
  } catch (error) {
    setGenerationState('idle');
    const message = error instanceof AiError ? error.message : error.message || '送信に失敗しました。';
    toast(message, 'error');
    await logEvent('prompt_failed', { conversationId: state.conversation?.id, errorName: error.code || error.name, errorMessage: message });
  }
}

async function addFiles(files) {
  for (const file of files) {
    try {
      validateImage(file, state.settings, state.drafts.length);
      const normalized = await normalizeImage(file, state.settings);
      if (totalNormalizedBytes([...state.drafts, normalized]) > IMAGE_LIMITS.maxNormalizedTurnBytes) throw new Error('正規化後の画像合計が16MBを超えます。');
      state.drafts.push(normalized);
      await logEvent('image_normalized', { conversationId: state.conversation?.id, normalizedImageBytes: normalized.byteSize });
    } catch (error) {
      toast(`${file.name || '画像'}: ${error.message}`, 'error');
      await logEvent('image_normalize_failed', { conversationId: state.conversation?.id, errorMessage: error.message });
    }
  }
  renderDrafts();
  scheduleMeasure();
}

async function compactConversation() {
  if (!state.conversation || state.generation !== 'idle') return;
  const branch = await activeBranch(state.conversation);
  const existingSummary = state.conversation.compactSummaryId ? await get('summaries', state.conversation.compactSummaryId) : null;
  const covered = new Set(existingSummary?.coveredMessageIds || []);
  const old = branch.slice(0, Math.max(0, branch.length - 6)).filter((m) => m.status === 'complete' && !covered.has(m.id));
  if (old.length < 4 && !existingSummary) { toast('まだ圧縮が必要なほど履歴がありません。'); return; }
  if (!old.length && existingSummary) { toast('新たに圧縮する古い履歴はありません。'); return; }
  setGenerationState('compacting');
  try {
    const transcript = `${existingSummary ? `【既存の圧縮要約】\n${existingSummary.summary}\n\n【追加履歴】\n` : ''}${old.map((m) => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.text}${m.attachmentIds?.length ? ` [画像${m.attachmentIds.length}枚]` : ''}`).join('\n\n')}`;
    await logEvent('compaction_started', { conversationId: state.conversation.id, contextUsageBefore: state.context.contextUsage });
    await ai.destroy(); state.sessionConversationId = null; state.sessionLeafId = null; state.injectedIds.clear();
    const summaryText = await summarizeConversation(transcript, (p) => {
      state.capability.download = p; updateCapabilityUi();
    });
    const summary = { id: id('sum'), conversationId: state.conversation.id, summary: summaryText, coveredMessageIds: [...(existingSummary?.coveredMessageIds || []), ...old.map((m) => m.id)], createdAt: now(), measuredUsage: null, method: 'summarizer' };
    await put('summaries', summary);
    state.conversation.compactSummaryId = summary.id;
    await put('conversations', state.conversation);
    await ensureSessionForLeaf(state.conversation.id, state.conversation.activeLeafId, true);
    await logEvent('compaction_completed', { conversationId: state.conversation.id, contextUsageAfter: state.context.contextUsage });
    addEventCard('古い会話を要約し、Gemini Nanoセッションを再構築しました。完全な履歴は端末内に残っています。', 'success');
    toast('会話を圧縮しました。', 'success');
  } catch (error) {
    toast(`圧縮に失敗しました: ${error.message}`, 'error');
    await logEvent('compaction_failed', { conversationId: state.conversation.id, errorMessage: error.message });
  } finally { setGenerationState('idle'); renderInspector(); updateContext(); }
}

function addEventCard(message, tone = 'info') {
  const chat = $('#chat-messages');
  const card = document.createElement('div');
  card.className = `event-card ${tone}`;
  card.innerHTML = `<span>${escapeHtml(message)}</span>${tone === 'warning' ? '<button type="button" data-compact-now>圧縮して再構築</button>' : ''}`;
  chat.append(card);
  chat.scrollTop = chat.scrollHeight;
}

async function renderInspector() {
  const debugTab = document.querySelector('.inspector-tab[data-tab="debug"]');
  if (debugTab) debugTab.hidden = !state.settings.debug;
  if (!state.settings.debug && state.inspectorTab === 'debug') state.inspectorTab = 'context';
  $$('.inspector-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.inspectorTab));
  $$('.inspector-panel').forEach((p) => p.hidden = p.dataset.panel !== state.inspectorTab);
  if (state.inspectorTab === 'attachments') await renderAttachmentsInspector();
  if (state.inspectorTab === 'debug') await renderDebug();
}

async function renderAttachmentsInspector() {
  const root = $('#attachment-list');
  if (!state.conversation) { root.innerHTML = ''; return; }
  const atts = await getAllByIndex('attachments', 'conversationId', state.conversation.id);
  root.innerHTML = (await Promise.all(atts.sort((a, b) => b.createdAt - a.createdAt).map(async (a) => {
    const url = objectUrl(`inspect-${a.id}`, a.thumbnailBlob || a.normalizedBlob);
    const injected = state.injectedIds.has(a.id);
    return `<div class="attachment-card"><button class="attachment-preview" data-attachment-id="${a.id}"><img src="${url}" alt="${escapeAttr(a.name)}"></button><div><strong>${escapeHtml(a.name)}</strong><span>${a.width}×${a.height} · ${formatBytes(a.byteSize)}</span><span class="session-chip ${injected ? 'injected' : ''}">${injected ? 'Current session' : 'Stored only'}</span>${!injected ? `<button class="small-button" data-reinject="${a.id}">再投入</button>` : ''}</div></div>`;
  }))).join('') || '<div class="empty-small">保存済み画像はありません。</div>';
}

async function renderDebug() {
  const logs = (await getAll('logs')).filter((x) => !state.conversation || x.conversationId === state.conversation.id).sort((a, b) => b.timestamp - a.timestamp).slice(0, 80);
  $('#debug-info').innerHTML = `<dl class="debug-grid"><dt>App</dt><dd>${APP_VERSION}</dd><dt>Chrome</dt><dd>${escapeHtml(chromeVersion())}</dd><dt>LanguageModel</dt><dd>${ai.supported() ? 'yes' : 'no'}</dd><dt>Availability</dt><dd>${escapeHtml(state.capability.availability)}</dd><dt>Session</dt><dd>${state.sessionConversationId ? 'active' : 'none'}</dd></dl>`;
  $('#debug-log').innerHTML = logs.map((x) => `<div class="log-row"><time>${new Date(x.timestamp).toLocaleTimeString('ja-JP')}</time><strong>${escapeHtml(x.eventType)}</strong><span>${escapeHtml(x.errorMessage || '')}</span></div>`).join('');
}

async function reinjectAttachment(idValue) {
  const att = await get('attachments', idValue);
  if (!att || !ai.session) { toast('先にAIセッションを準備してください。'); return; }
  try {
    await ai.append([{ role: 'user', content: [
      { type: 'text', value: `保存済み画像「${att.name}」を今後の会話で参照できるよう再投入します。` },
      { type: 'image', value: att.normalizedBlob },
    ] }]);
    state.injectedIds.add(att.id);
    updateContext(); renderAttachmentsInspector();
    toast('画像を現在のセッションへ再投入しました。', 'success');
  } catch (error) { toast(error.message, 'error'); }
}

async function openImage(idValue) {
  const att = await get('attachments', idValue);
  if (!att) return;
  const url = objectUrl(`full-${att.id}`, att.normalizedBlob);
  $('#image-dialog-img').src = url;
  $('#image-dialog-title').textContent = `${att.name} · ${att.width}×${att.height} · ${formatBytes(att.byteSize)}`;
  $('#image-dialog').showModal();
}

async function switchVariant(messageId, direction) {
  const message = await get('messages', messageId);
  if (!message) return;
  const siblings = await siblingsOf(message);
  const index = siblings.findIndex((m) => m.id === messageId);
  const next = siblings[index + (direction === 'next' ? 1 : -1)];
  if (!next) return;
  const all = await listMessages(message.conversationId);
  let leaf = next;
  while (true) {
    const children = all.filter((m) => m.parentMessageId === leaf.id).sort((a, b) => b.createdAt - a.createdAt);
    if (!children.length) break;
    leaf = children[0];
  }
  state.conversation.activeLeafId = leaf.id;
  await put('conversations', state.conversation);
  state.sessionLeafId = null;
  await renderChat();
  renderInspector();
}

async function regenerate(messageId) {
  const assistant = await get('messages', messageId);
  if (!assistant?.parentMessageId) return;
  const user = await get('messages', assistant.parentMessageId);
  if (!user) return;
  state.conversation.activeLeafId = user.id;
  await put('conversations', state.conversation);
  await sendMessage({ existingUserId: user.id });
}

async function editMessage(messageId) {
  const original = await get('messages', messageId);
  if (!original || original.role !== 'user') return;
  const edited = window.prompt('メッセージを編集', original.text);
  if (edited == null || (!edited.trim() && !original.attachmentIds?.length)) return;
  state.conversation.activeLeafId = original.parentMessageId || null;
  await put('conversations', state.conversation);
  await sendMessage({ textOverride: edited.trim(), attachmentIds: original.attachmentIds, parentOverride: original.parentMessageId });
}

async function exportConversation() {
  if (!state.conversation) return;
  const messages = await listMessages(state.conversation.id);
  const attachments = await getAllByIndex('attachments', 'conversationId', state.conversation.id);
  const summaries = await getAllByIndex('summaries', 'conversationId', state.conversation.id);
  const encoded = [];
  for (const a of attachments) encoded.push({ ...a, normalizedBlob: await blobToDataUrl(a.normalizedBlob), thumbnailBlob: await blobToDataUrl(a.thumbnailBlob) });
  const payload = { format: 'nano-workbench-conversation', version: 1, exportedAt: new Date().toISOString(), conversation: state.conversation, messages, attachments: encoded, summaries };
  downloadText(`nano-workbench-${state.conversation.title.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.json`, JSON.stringify(payload, null, 2));
}

async function importConversationFile(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.format !== 'nano-workbench-conversation' || payload.version !== 1) throw new Error('対応していないエクスポート形式です。');
    const importedMessages = Array.isArray(payload.messages) ? payload.messages : [];
    const importedAttachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const importedSummaries = Array.isArray(payload.summaries) ? payload.summaries : [];
    const newId = id('conv');
    const msgMap = new Map(importedMessages.map((m) => [m.id, id('msg')]));
    const attMap = new Map(importedAttachments.map((a) => [a.id, id('att')]));
    const sumMap = new Map(importedSummaries.map((s) => [s.id, id('sum')]));
    const conv = { ...payload.conversation, id: newId, title: `${payload.conversation.title} (import)`, createdAt: now(), updatedAt: now(), activeLeafId: payload.conversation.activeLeafId ? msgMap.get(payload.conversation.activeLeafId) : null, compactSummaryId: payload.conversation.compactSummaryId ? sumMap.get(payload.conversation.compactSummaryId) : null };
    await put('conversations', conv);
    for (const m of importedMessages) await put('messages', { ...m, id: msgMap.get(m.id), conversationId: newId, parentMessageId: m.parentMessageId ? msgMap.get(m.parentMessageId) : null, attachmentIds: (m.attachmentIds || []).map((x) => attMap.get(x)).filter(Boolean) });
    for (const a of importedAttachments) await put('attachments', { ...a, id: attMap.get(a.id), conversationId: newId, messageId: msgMap.get(a.messageId), normalizedBlob: dataUrlToBlob(a.normalizedBlob), thumbnailBlob: dataUrlToBlob(a.thumbnailBlob), injectedInCurrentSession: false, sessionState: 'stored-only' });
    for (const s of importedSummaries) await put('summaries', { ...s, id: sumMap.get(s.id), conversationId: newId, coveredMessageIds: (s.coveredMessageIds || []).map((x) => msgMap.get(x)).filter(Boolean) });
    await refreshConversations(); await setConversation(newId); toast('会話をインポートしました。', 'success');
  } catch (error) { toast(`インポート失敗: ${error.message}`, 'error'); }
}

async function exportLogs() {
  const logs = await getAll('logs');
  downloadText(`nano-workbench-logs-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(logs, null, 2));
}

function openSettings() {
  $('#setting-theme').value = state.settings.theme;
  $('#setting-margin').value = String(state.settings.safetyMargin);
  $('#setting-debug').checked = state.settings.debug;
  $('#settings-dialog').showModal();
}

async function saveSettingsFromDialog() {
  state.settings = { ...state.settings, theme: $('#setting-theme').value, safetyMargin: Number($('#setting-margin').value), debug: $('#setting-debug').checked };
  await saveSettings(state.settings); applyTheme(); $('#settings-dialog').close(); renderInspector();
}

async function deleteCurrentConversation() {
  if (!state.conversation || !confirm(`「${state.conversation.title}」を削除しますか？`)) return;
  const idValue = state.conversation.id;
  await removeConversation(idValue);
  await ai.destroy(); state.sessionConversationId = null; state.sessionLeafId = null;
  await refreshConversations();
  if (!state.conversations.length) state.conversations = [await createConversation()];
  await setConversation(state.conversations[0].id);
}

async function renameConversation() {
  if (!state.conversation) return;
  const title = prompt('会話名', state.conversation.title);
  if (!title?.trim()) return;
  state.conversation.title = title.trim().slice(0, 80); state.conversation.updatedAt = now();
  await put('conversations', state.conversation); await refreshConversations(); renderAll();
}

async function prepareAi() {
  if (!state.conversation) return;
  try {
    await ensureSessionForLeaf(state.conversation.id, state.conversation.activeLeafId, true);
    toast('Gemini Nanoを準備しました。', 'success');
  } catch (error) { setGenerationState('idle'); toast(error.message, 'error'); }
}

async function updateStorageUi() {
  const estimate = await storageEstimate();
  $('#storage-value').textContent = estimate ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}` : '—';
}

function registerEvents() {
  $('#new-chat').addEventListener('click', async () => { const c = await createConversation(); await refreshConversations(); await setConversation(c.id); $('#composer-input').focus(); });
  $('#conversation-search').addEventListener('input', (e) => { state.query = e.target.value; renderSidebar(); });
  $('#conversation-list').addEventListener('click', async (e) => {
    const row = e.target.closest('.conversation-row'); if (!row) return;
    if (e.target.closest('.conversation-menu')) { await setConversation(row.dataset.id); $('#conversation-actions').showModal(); return; }
    await setConversation(row.dataset.id);
  });
  $('#prepare-ai').addEventListener('click', prepareAi);
  $('#send-button').addEventListener('click', () => sendMessage());
  $('#stop-button').addEventListener('click', () => { state.generation = 'stopping'; updateCapabilityUi(); state.abortController?.abort(); });
  $('#composer-input').addEventListener('input', scheduleMeasure);
  $('#composer-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendMessage(); } });
  $('#attach-button').addEventListener('click', () => $('#image-input').click());
  $('#image-input').addEventListener('change', async (e) => { await addFiles([...e.target.files]); e.target.value = ''; });
  $('#draft-attachments').addEventListener('click', (e) => { const idValue = e.target.closest('[data-remove-draft]')?.dataset.removeDraft; if (idValue) { state.drafts = state.drafts.filter((x) => x.id !== idValue); renderDrafts(); scheduleMeasure(); } });

  const composer = $('#composer');
  composer.addEventListener('dragover', (e) => { e.preventDefault(); composer.classList.add('dragging'); });
  composer.addEventListener('dragleave', () => composer.classList.remove('dragging'));
  composer.addEventListener('drop', async (e) => { e.preventDefault(); composer.classList.remove('dragging'); await addFiles([...e.dataTransfer.files].filter((x) => x.type.startsWith('image/'))); });
  document.addEventListener('paste', async (e) => {
    if (!$('#composer-input').matches(':focus')) return;
    const files = [...e.clipboardData.items].filter((x) => x.kind === 'file' && x.type.startsWith('image/')).map((x) => x.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); await addFiles(files); }
  });

  $('#chat-messages').addEventListener('click', async (e) => {
    const starter = e.target.closest('[data-starter]'); if (starter) { $('#composer-input').value = starter.dataset.starter; scheduleMeasure(); $('#composer-input').focus(); return; }
    const image = e.target.closest('[data-attachment-id]'); if (image) { await openImage(image.dataset.attachmentId); return; }
    const action = e.target.closest('[data-action]');
    if (action) {
      const m = await get('messages', action.dataset.messageId); if (!m) return;
      if (action.dataset.action === 'copy') { await navigator.clipboard.writeText(m.text); toast('回答をコピーしました。'); }
      if (action.dataset.action === 'regenerate') await regenerate(m.id);
      if (action.dataset.action === 'edit') await editMessage(m.id);
      return;
    }
    const variant = e.target.closest('[data-variant]'); if (variant) await switchVariant(variant.dataset.messageId, variant.dataset.variant);
    const compact = e.target.closest('[data-compact-now]'); if (compact) compactConversation();
  });

  $$('.inspector-tab').forEach((b) => b.addEventListener('click', () => { state.inspectorTab = b.dataset.tab; renderInspector(); }));
  $('#attachment-list').addEventListener('click', async (e) => { const re = e.target.closest('[data-reinject]'); if (re) await reinjectAttachment(re.dataset.reinject); const prev = e.target.closest('[data-attachment-id]'); if (prev) await openImage(prev.dataset.attachmentId); });
  $('#compact-button').addEventListener('click', compactConversation);
  $('#inspector-toggle').addEventListener('click', () => document.querySelector('.inspector').classList.toggle('open'));
  $('#settings-button').addEventListener('click', openSettings);
  $('#save-settings').addEventListener('click', saveSettingsFromDialog);
  $('#export-conversation').addEventListener('click', exportConversation);
  $('#import-conversation').addEventListener('click', () => $('#import-input').click());
  $('#import-input').addEventListener('change', async (e) => { if (e.target.files[0]) await importConversationFile(e.target.files[0]); e.target.value = ''; });
  $('#export-logs').addEventListener('click', exportLogs);
  $('#pin-conversation').addEventListener('click', async () => { if (!state.conversation) return; state.conversation.pinned = !state.conversation.pinned; state.conversation.updatedAt = now(); await put('conversations', state.conversation); $('#conversation-actions').close(); await refreshConversations(); });
  $('#rename-conversation').addEventListener('click', async () => { $('#conversation-actions').close(); await renameConversation(); });
  $('#delete-conversation').addEventListener('click', async () => { $('#conversation-actions').close(); await deleteCurrentConversation(); });
  $('#image-dialog-close').addEventListener('click', () => $('#image-dialog').close());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.generation === 'generating') state.abortController?.abort();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); $('#new-chat').click(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#conversation-search').focus(); }
  });
  window.addEventListener('beforeunload', () => { ai.destroy(); revokeObjectUrls(); });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try { await navigator.serviceWorker.register('./sw.js'); }
  catch (error) { console.warn('Service worker registration failed', error); }
}

export async function startApp() {
  await openDb();
  state.settings = await getSettings();
  applyTheme();
  await purgeOldLogs(30);
  await logEvent('app_start', { chromeVersion: chromeVersion() });
  state.conversations = await listConversations();
  if (!state.conversations.length) state.conversations = [await createConversation()];
  state.conversation = state.conversations[0];
  state.branch = await activeBranch(state.conversation);
  registerEvents();
  renderAll();
  updateStorageUi();
  checkCapability();
  registerServiceWorker();
  $('#app-version').textContent = `v${APP_VERSION}`;
}
