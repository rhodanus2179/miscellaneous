import { get } from '../storage.js';
import {
  memoriesForProject, saveMemory, deleteMemory, MEMORY_CATEGORY_LABELS, memoryTransformLabel,
} from './memories.js';
import { generateMemoryCandidate } from './memory-refinement.js';
import { $, $$, ws, escapeHtml, toast, activeProject, record } from './state.js';
import { markWorkspaceDirty } from './context.js';

let memoryActionState = null;
let refinementState = null;
let refinementAbortController = null;

function refinementModeLabel(mode) {
  return mode === 'summarize' ? '要約' : '整形';
}

async function projectById(projectId) {
  return projectId ? get('projects', projectId) : null;
}

async function persistMemory({ projectId, text, sourceMessageId = null, transform = 'manual', category = 'other', priority = 2, enabled = true, pinned = false }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('Memory本文が空です。');
  const saved = await saveMemory({
    projectId,
    category,
    text: body,
    sourceMessageId,
    transform,
    priority,
    enabled,
    pinned,
  });
  markWorkspaceDirty();
  await record('memory_created', { projectId, memoryId: saved.id, sourceMessageId, transform });
  await renderMemoryPanel();
  return saved;
}

export async function openMemoryDialog(memory = null, sourceMessageId = null, sourceText = '', transform = 'manual') {
  const project = await activeProject();
  if (!project) { toast('Memoryを保存するにはProjectを選択してください。', 'warning'); return; }
  const dialog = $('#memory-dialog');
  dialog.dataset.memoryId = memory?.id || '';
  dialog.dataset.sourceMessageId = sourceMessageId || memory?.sourceMessageId || '';
  dialog.dataset.transform = memory?.transform || transform || 'manual';
  $('#memory-category').value = memory?.category || 'premise';
  $('#memory-text').value = memory?.text || sourceText;
  $('#memory-priority').value = String(memory?.priority || 2);
  $('#memory-enabled').checked = memory?.enabled !== false;
  $('#memory-pinned').checked = !!memory?.pinned;
  if (!dialog.open) dialog.showModal();
}

async function saveMemoryDialog() {
  const project = await activeProject();
  if (!project) return;
  const dialog = $('#memory-dialog');
  const text = $('#memory-text').value.trim();
  if (!text) { toast('Memory本文を入力してください。', 'error'); return; }
  const existing = dialog.dataset.memoryId ? await get('projectMemories', dialog.dataset.memoryId) : null;
  const previousTransform = existing?.transform || dialog.dataset.transform || 'manual';
  const transform = existing && String(existing.text || '').trim() !== text ? 'manual' : previousTransform;
  const saved = await saveMemory({
    ...existing,
    id: existing?.id,
    projectId: existing?.projectId || project.id,
    category: $('#memory-category').value,
    text,
    sourceMessageId: dialog.dataset.sourceMessageId || existing?.sourceMessageId || null,
    transform,
    priority: Number($('#memory-priority').value),
    enabled: $('#memory-enabled').checked,
    pinned: $('#memory-pinned').checked,
  });
  dialog.close();
  markWorkspaceDirty();
  await record(existing ? 'memory_updated' : 'memory_created', {
    projectId: saved.projectId, memoryId: saved.id, sourceMessageId: saved.sourceMessageId || null, transform: saved.transform,
  });
  await renderMemoryPanel();
  toast('Project Memoryを保存しました。', 'success');
}

async function openSourceMessage(sourceMessageId) {
  const dialog = $('#memory-source-dialog');
  if (!dialog) return;
  const message = sourceMessageId ? await get('messages', sourceMessageId) : null;
  $('#memory-source-meta').textContent = message
    ? `${message.role === 'assistant' ? 'Nano' : 'You'} · ${new Date(message.createdAt).toLocaleString()}`
    : 'Source unavailable';
  $('#memory-source-text').textContent = message?.text?.trim() || '元メッセージは削除されているか、本文を取得できません。Memory本文自体は影響を受けません。';
  if (!dialog.open) dialog.showModal();
}

async function saveRawMemory(state) {
  const source = state?.sourceMessageId ? await get('messages', state.sourceMessageId) : null;
  if (!source?.text?.trim()) throw new Error('元メッセージ本文を取得できません。');
  await persistMemory({
    projectId: state.projectId,
    text: source.text,
    sourceMessageId: source.id,
    transform: 'raw',
    category: 'other',
  });
  toast('原文をProject Memoryに保存しました。', 'success');
}

async function openMemoryAction(message) {
  const project = await activeProject();
  if (!project) { toast('Memoryを保存するにはProjectを選択してください。', 'warning'); return; }
  if (($('#generation-state')?.textContent || '').trim()) {
    toast('AI処理中はMemory候補の生成を開始できません。処理完了後にもう一度お試しください。', 'warning');
    return;
  }
  if (!message?.text?.trim()) { toast('本文のないメッセージはMemory化できません。', 'warning'); return; }
  memoryActionState = {
    projectId: project.id,
    projectName: project.name,
    sourceMessageId: message.id,
  };
  const preview = message.text.trim();
  $('#memory-action-preview').textContent = preview.length > 700 ? `${preview.slice(0, 700)}…` : preview;
  const dialog = $('#memory-action-dialog');
  if (!dialog.open) dialog.showModal();
}

function setRefinementBusy(busy, label = '') {
  const dialog = $('#memory-refinement-dialog');
  dialog?.classList.toggle('busy', busy);
  $('#memory-refinement-busy').hidden = !busy;
  $('#memory-refinement-candidate').hidden = busy;
  $('#memory-refinement-error').hidden = true;
  if (busy) {
    $('#memory-refinement-busy-label').textContent = label || 'Memory候補を作成しています…';
  }
}

function showRefinementError(error) {
  $('#memory-refinement-busy').hidden = true;
  $('#memory-refinement-candidate').hidden = true;
  $('#memory-refinement-error').hidden = false;
  $('#memory-refinement-error-text').textContent = error?.message || 'Memory候補を生成できませんでした。';
}

function showRefinementCandidate(candidate) {
  if (!refinementState) return;
  $('#memory-refinement-busy').hidden = true;
  $('#memory-refinement-error').hidden = true;
  $('#memory-refinement-candidate').hidden = false;
  $('#memory-refinement-attempt').textContent = `${refinementModeLabel(refinementState.mode)} · ${refinementState.attempt}回目`;
  $('#memory-refinement-category').value = candidate.category;
  $('#memory-refinement-text').value = candidate.text;
  $('#memory-refinement-char-count').textContent = `${candidate.text.length.toLocaleString()}字`;
}

async function generateRefinement() {
  const state = refinementState;
  if (!state) return;
  const source = await get('messages', state.sourceMessageId);
  if (!source?.text?.trim()) { showRefinementError(new Error('元メッセージ本文を取得できません。')); return; }
  const parent = source.parentMessageId ? await get('messages', source.parentMessageId) : null;
  const project = await projectById(state.projectId);
  state.attempt += 1;
  state.candidate = null;
  refinementAbortController?.abort();
  refinementAbortController = new AbortController();
  setRefinementBusy(true, `${refinementModeLabel(state.mode)}したMemory候補を作成しています…`);
  const started = performance.now();
  await record('memory_refinement_started', {
    projectId: state.projectId, sourceMessageId: state.sourceMessageId, mode: state.mode, attempt: state.attempt, inputChars: source.text.length,
  });
  try {
    const candidate = await generateMemoryCandidate({
      mode: state.mode,
      sourceText: source.text,
      parentText: parent?.text || '',
      projectName: project?.name || state.projectName || '',
      signal: refinementAbortController.signal,
    });
    if (refinementState !== state) return;
    state.candidate = candidate;
    await record('memory_refinement_completed', {
      projectId: state.projectId,
      sourceMessageId: state.sourceMessageId,
      mode: state.mode,
      attempt: state.attempt,
      inputChars: source.text.length,
      outputChars: candidate.text.length,
      elapsedMs: Math.round(performance.now() - started),
    });
    showRefinementCandidate(candidate);
  } catch (error) {
    if (error?.name === 'AbortError' || refinementState !== state) return;
    await record('memory_refinement_failed', {
      projectId: state.projectId,
      sourceMessageId: state.sourceMessageId,
      mode: state.mode,
      attempt: state.attempt,
      elapsedMs: Math.round(performance.now() - started),
      errorName: error?.name || 'Error',
    });
    showRefinementError(error);
  } finally {
    refinementAbortController = null;
  }
}

async function startRefinement(mode) {
  if (!memoryActionState) return;
  const source = await get('messages', memoryActionState.sourceMessageId);
  if (!source?.text?.trim()) { toast('元メッセージ本文を取得できません。', 'error'); return; }
  const action = memoryActionState;
  $('#memory-action-dialog')?.close();
  refinementState = {
    ...action,
    mode,
    attempt: 0,
    candidate: null,
  };
  memoryActionState = null;
  const dialog = $('#memory-refinement-dialog');
  $('#memory-refinement-title').textContent = `Memoryを${refinementModeLabel(mode)}`;
  if (!dialog.open) dialog.showModal();
  await generateRefinement();
}

async function adoptRefinement() {
  const state = refinementState;
  if (!state) return;
  const text = $('#memory-refinement-text').value.trim();
  if (!text) { toast('Memory本文を入力してください。', 'warning'); return; }
  const saved = await persistMemory({
    projectId: state.projectId,
    text,
    sourceMessageId: state.sourceMessageId,
    transform: state.mode,
    category: $('#memory-refinement-category').value,
  });
  await record('memory_refinement_adopted', {
    projectId: state.projectId, memoryId: saved.id, sourceMessageId: state.sourceMessageId, mode: state.mode, attempt: state.attempt,
  });
  $('#memory-refinement-dialog')?.close();
  refinementState = null;
  toast(`${refinementModeLabel(state.mode)}した候補をProject Memoryに保存しました。`, 'success');
}

async function rawFromRefinement() {
  const state = refinementState;
  if (!state) return;
  try {
    await saveRawMemory(state);
    $('#memory-refinement-dialog')?.close();
    refinementState = null;
  } catch (error) { toast(error.message, 'error'); }
}

async function cancelRefinement() {
  const state = refinementState;
  refinementAbortController?.abort();
  refinementAbortController = null;
  if (state) {
    await record('memory_refinement_cancelled', {
      projectId: state.projectId, sourceMessageId: state.sourceMessageId, mode: state.mode, attempt: state.attempt,
    });
  }
  refinementState = null;
  if ($('#memory-refinement-dialog')?.open) $('#memory-refinement-dialog').close();
}

export async function renderMemoryPanel() {
  const root = $('#memory-panel-content');
  if (!root) return;
  const project = await activeProject();
  if (!project) { root.innerHTML = '<div class="empty-small">Projectを選択するとMemoryを利用できます。</div>'; return; }
  const memories = await memoriesForProject(project.id);
  const rows = memories.map((m) => {
    const sessionState = !m.enabled ? 'Disabled' : ws.sessionMemoryIds.has(m.id) ? 'In current session' : 'Stored only';
    const source = m.sourceMessageId ? `<button data-memory-action="source">Source</button>` : '';
    return `<article class="memory-card ${m.enabled ? '' : 'disabled'}" data-memory-id="${m.id}">
      <div class="memory-card-head"><span>${escapeHtml(MEMORY_CATEGORY_LABELS[m.category] || 'その他')}</span><span>Priority ${m.priority}${m.pinned ? ' · Pinned' : ''}</span></div>
      <div class="memory-origin"><span>${escapeHtml(memoryTransformLabel(m))}</span>${source}</div>
      <p>${escapeHtml(m.text)}</p>
      <div class="memory-actions"><span class="session-chip ${ws.sessionMemoryIds.has(m.id) ? 'injected' : ''}">${sessionState}</span><button data-memory-action="toggle">${m.enabled ? 'Disable' : 'Enable'}</button><button data-memory-action="edit">Edit</button><button data-memory-action="delete">Delete</button></div>
    </article>`;
  }).join('');
  root.innerHTML = `<button id="add-memory" class="wide-button" type="button">＋ Memoryを追加</button><div class="memory-list">${rows || '<div class="empty-small">Memoryはまだありません。</div>'}</div>`;
  $('#add-memory')?.addEventListener('click', () => openMemoryDialog());
}

async function memoryPanelAction(target) {
  const button = target.closest('[data-memory-action]');
  if (!button) return;
  const card = button.closest('[data-memory-id]');
  const memory = await get('projectMemories', card.dataset.memoryId);
  if (!memory) return;
  if (button.dataset.memoryAction === 'source') return openSourceMessage(memory.sourceMessageId);
  if (button.dataset.memoryAction === 'edit') return openMemoryDialog(memory);
  if (button.dataset.memoryAction === 'toggle') {
    await saveMemory({ ...memory, enabled: !memory.enabled });
    markWorkspaceDirty();
    await record('memory_updated', { projectId: memory.projectId, memoryId: memory.id, transform: memory.transform || 'legacy' });
    await renderMemoryPanel();
    return;
  }
  if (button.dataset.memoryAction === 'delete' && confirm('このMemoryを削除しますか？')) {
    await deleteMemory(memory.id);
    markWorkspaceDirty();
    await record('memory_deleted', { projectId: memory.projectId, memoryId: memory.id });
    await renderMemoryPanel();
  }
}

export function augmentMessageActions() {
  const projectAvailable = !!ws.activeProjectId;
  $$('.message[data-message-id]').forEach((article) => {
    const actions = article.querySelector('.message-actions');
    if (!actions) return;
    let button = actions.querySelector('[data-workspace-action="memory"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.workspaceAction = 'memory';
      button.dataset.messageId = article.dataset.messageId;
      button.textContent = 'Memory';
      actions.prepend(button);
    }
    button.hidden = !projectAvailable;
    button.disabled = article.classList.contains('streaming');
  });
}

export function registerMemoryEvents() {
  $('#memory-panel-content')?.addEventListener('click', (e) => memoryPanelAction(e.target));
  $('#save-memory')?.addEventListener('click', saveMemoryDialog);

  $('#memory-action-raw')?.addEventListener('click', async () => {
    try {
      await saveRawMemory(memoryActionState);
      $('#memory-action-dialog')?.close();
      memoryActionState = null;
    } catch (error) { toast(error.message, 'error'); }
  });
  $('#memory-action-refine')?.addEventListener('click', () => startRefinement('refine'));
  $('#memory-action-summarize')?.addEventListener('click', () => startRefinement('summarize'));
  $('#memory-action-manual')?.addEventListener('click', async () => {
    const state = memoryActionState;
    if (!state) return;
    const message = await get('messages', state.sourceMessageId);
    $('#memory-action-dialog')?.close();
    memoryActionState = null;
    if (message) await openMemoryDialog(null, message.id, message.text || '', 'manual');
  });

  $('#memory-refinement-adopt')?.addEventListener('click', adoptRefinement);
  $('#memory-refinement-regenerate')?.addEventListener('click', generateRefinement);
  $$('#memory-refinement-raw').forEach((button) => button.addEventListener('click', rawFromRefinement));
  $('#memory-refinement-retry')?.addEventListener('click', generateRefinement);
  $$('#memory-refinement-cancel').forEach((button) => button.addEventListener('click', cancelRefinement));
  $('#memory-refinement-source')?.addEventListener('click', () => refinementState && openSourceMessage(refinementState.sourceMessageId));
  $('#memory-refinement-text')?.addEventListener('input', (e) => {
    $('#memory-refinement-char-count').textContent = `${e.target.value.length.toLocaleString()}字`;
  });
  $('#memory-refinement-dialog .dialog-close')?.addEventListener('click', (e) => {
    e.preventDefault();
    cancelRefinement();
  });
  $('#memory-refinement-dialog')?.addEventListener('cancel', (e) => {
    e.preventDefault();
    cancelRefinement();
  });

  $('#chat-messages')?.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-workspace-action="memory"]');
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    const message = await get('messages', button.dataset.messageId);
    if (message) await openMemoryAction(message);
  }, true);
}
