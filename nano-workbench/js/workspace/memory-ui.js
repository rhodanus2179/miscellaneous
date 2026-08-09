import { get } from '../storage.js';
import { memoriesForProject, saveMemory, deleteMemory, MEMORY_CATEGORY_LABELS } from './memories.js';
import { $, $$, ws, escapeHtml, toast, activeProject, record } from './state.js';
import { markWorkspaceDirty } from './context.js';

export async function openMemoryDialog(memory = null, sourceMessageId = null, sourceText = '') {
  const project = await activeProject();
  if (!project) { toast('Memoryを保存するにはProjectを選択してください。', 'warning'); return; }
  const dialog = $('#memory-dialog');
  dialog.dataset.memoryId = memory?.id || '';
  dialog.dataset.sourceMessageId = sourceMessageId || memory?.sourceMessageId || '';
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
  const saved = await saveMemory({
    ...existing,
    id: existing?.id,
    projectId: project.id,
    category: $('#memory-category').value,
    text,
    sourceMessageId: dialog.dataset.sourceMessageId || null,
    priority: Number($('#memory-priority').value),
    enabled: $('#memory-enabled').checked,
    pinned: $('#memory-pinned').checked,
  });
  dialog.close();
  markWorkspaceDirty();
  await record(existing ? 'memory_updated' : 'memory_created', { projectId: project.id, memoryId: saved.id });
  await renderMemoryPanel();
  toast('Project Memoryを保存しました。', 'success');
}

export async function renderMemoryPanel() {
  const root = $('#memory-panel-content');
  if (!root) return;
  const project = await activeProject();
  if (!project) { root.innerHTML = '<div class="empty-small">Projectを選択するとMemoryを利用できます。</div>'; return; }
  const memories = await memoriesForProject(project.id);
  const rows = memories.map((m) => {
    const sessionState = !m.enabled ? 'Disabled' : ws.sessionMemoryIds.has(m.id) ? 'In current session' : 'Stored only';
    return `<article class="memory-card ${m.enabled ? '' : 'disabled'}" data-memory-id="${m.id}">
      <div class="memory-card-head"><span>${escapeHtml(MEMORY_CATEGORY_LABELS[m.category] || 'その他')}</span><span>Priority ${m.priority}${m.pinned ? ' · Pinned' : ''}</span></div>
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
  if (button.dataset.memoryAction === 'edit') return openMemoryDialog(memory);
  if (button.dataset.memoryAction === 'toggle') {
    await saveMemory({ ...memory, enabled: !memory.enabled });
    markWorkspaceDirty();
    await record('memory_updated', { projectId: memory.projectId, memoryId: memory.id });
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
  });
}

export function registerMemoryEvents() {
  $('#memory-panel-content')?.addEventListener('click', (e) => memoryPanelAction(e.target));
  $('#save-memory')?.addEventListener('click', saveMemoryDialog);
  $('#chat-messages')?.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-workspace-action="memory"]');
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    const message = await get('messages', button.dataset.messageId);
    if (message) await openMemoryDialog(null, message.id, message.text || '');
  }, true);
}
