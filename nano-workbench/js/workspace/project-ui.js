import { WORKSPACE_LIMITS } from '../config.js';
import { put, listConversations } from '../storage.js';
import { formatDateTime } from '../utils.js';
import { newProject, updateProject, listProjects, deleteProject, moveConversationToProject } from './projects.js';
import { memoriesForProject } from './memories.js';
import { getStyle } from './styles.js';
import { $, ws, escapeHtml, toast, activeConversation, activeConversationId, activeProject, saveWorkspaceSelection, emit, record } from './state.js';
import { markWorkspaceDirty } from './context.js';

const NO_PROJECT_KEY = '__none__';
const projectKey = (projectId) => projectId || NO_PROJECT_KEY;
const projectIdFromKey = (key) => key === NO_PROJECT_KEY ? null : key;

function projectGroupHtml({ id: projectId, name }, conversations, query, activeConversationIdValue) {
  const key = projectKey(projectId);
  const items = conversations.filter((c) => (c.projectId ?? null) === (projectId ?? null))
    .filter((c) => !query || c.title.toLowerCase().includes(query));
  if (query && !items.length) return '';
  const collapsed = !query && ws.collapsedProjectKeys.has(key);
  const activeProject = (projectId ?? null) === (ws.activeProjectId ?? null);
  const chats = items.length
    ? items.map((c) => `<div class="project-chat-item ${c.id === activeConversationIdValue ? 'active' : ''}">
        <button class="project-chat-row" type="button" data-project-chat="${c.id}" data-chat-project="${projectId || ''}" title="${escapeHtml(c.title)}">
          <span class="project-chat-title">${escapeHtml(c.title)}</span>
          <span class="project-chat-time">${formatDateTime(c.updatedAt)}</span>
        </button>
        <button class="project-chat-menu" type="button" data-project-chat-menu="${c.id}" data-chat-project="${projectId || ''}" aria-label="会話メニュー">•••</button>
      </div>`).join('')
    : '<div class="project-empty-chat">チャットはありません</div>';
  return `<section class="project-group ${activeProject ? 'active' : ''}" data-project-group="${key}">
    <div class="project-group-head">
      <button class="project-toggle" type="button" data-project-toggle="${key}" aria-label="${collapsed ? '展開' : '折りたたみ'}">${collapsed ? '▸' : '▾'}</button>
      <button class="project-select" type="button" data-project-select="${projectId || ''}" title="${escapeHtml(name)}"><span>${escapeHtml(name)}</span></button>
      <small>${items.length}</small>
    </div>
    <div class="project-chat-list" ${collapsed ? 'hidden' : ''}>${chats}</div>
  </section>`;
}

export async function renderProjectList() {
  const root = $('#project-list');
  if (!root) return;
  const conversations = await listConversations();
  const query = ($('#conversation-search')?.value || '').trim().toLowerCase();
  const activeId = activeConversationId();
  const groups = [
    ...ws.projects.map((p) => ({ id: p.id, name: p.name })),
    { id: null, name: 'No Project' },
  ];
  root.innerHTML = groups.map((group) => projectGroupHtml(group, conversations, query, activeId)).join('') || '<div class="empty-small">該当する会話はありません。</div>';
  const name = ws.activeProjectId ? ws.projects.find((p) => p.id === ws.activeProjectId)?.name || 'Project' : 'No Project';
  if ($('#active-project-label')) $('#active-project-label').textContent = name;
  if ($('#composer-project')) $('#composer-project').textContent = name;
}

export function syncConversationRows({ ensureActive = false } = {}) {
  clearTimeout(ws.rowSyncTimer);
  ws.rowSyncTimer = setTimeout(async () => {
    let conversations = await listConversations();
    const projectIds = new Set(ws.projects.map((p) => p.id));
    let repaired = false;
    for (const conversation of conversations) {
      if (conversation.projectId && !projectIds.has(conversation.projectId)) {
        conversation.projectId = null;
        conversation.updatedAt = Date.now();
        await put('conversations', conversation);
        repaired = true;
      }
    }
    if (repaired) conversations = await listConversations();

    if (ws.pendingNewProjectId !== undefined) {
      const activeId = activeConversationId();
      const created = conversations.find((c) => c.id === activeId);
      if (created) {
        const target = ws.pendingNewProjectId ?? null;
        if ((created.projectId ?? null) !== target) {
          created.projectId = target;
          created.updatedAt = Date.now();
          await put('conversations', created);
          conversations = await listConversations();
        }
        ws.pendingNewProjectId = undefined;
      }
    }

    for (const row of document.querySelectorAll('#conversation-list .conversation-row')) row.hidden = false;

    if (ensureActive) {
      const activeId = activeConversationId();
      const active = conversations.find((c) => c.id === activeId);
      const matches = active && (active.projectId ?? null) === (ws.activeProjectId ?? null);
      if (!matches) {
        const first = conversations.find((c) => (c.projectId ?? null) === (ws.activeProjectId ?? null));
        if (first) document.querySelector(`#conversation-list .conversation-row[data-id="${first.id}"] .conversation-open`)?.click();
        else {
          ws.pendingNewProjectId = ws.activeProjectId ?? null;
          $('#new-chat')?.click();
        }
      }
    }
    await renderProjectList();
    emit('nano:workspace-selection-changed');
  }, 0);
}

export async function selectProject(projectId, { ensureActive = true } = {}) {
  emit('nano:workspace-cancel-harness', { reason: 'PROJECT_SWITCH' });
  ws.activeProjectId = projectId || null;
  ws.collapsedProjectKeys.delete(projectKey(ws.activeProjectId));
  await saveWorkspaceSelection();
  await renderProjectList();
  syncConversationRows({ ensureActive });
  await record('project_selected', { projectId: ws.activeProjectId });
}

async function openTreeConversation(conversationId, projectId) {
  if ((projectId ?? null) !== (ws.activeProjectId ?? null)) await selectProject(projectId, { ensureActive: false });
  document.querySelector(`#conversation-list .conversation-row[data-id="${conversationId}"] .conversation-open`)?.click();
  queueMicrotask(renderProjectList);
}

async function openTreeConversationMenu(conversationId, projectId) {
  if ((projectId ?? null) !== (ws.activeProjectId ?? null)) await selectProject(projectId, { ensureActive: false });
  document.querySelector(`#conversation-list .conversation-row[data-id="${conversationId}"] .conversation-menu`)?.click();
}

async function createProjectUi() {
  const name = prompt('Project名');
  if (!name?.trim()) return;
  try {
    const project = await newProject(name);
    ws.projects = await listProjects();
    await record('project_created', { projectId: project.id });
    await selectProject(project.id);
    toast('Projectを作成しました。', 'success');
  } catch (error) { toast(error.message, 'error'); }
}

export async function renderProjectPanel() {
  const root = $('#project-panel-content');
  if (!root) return;
  const project = await activeProject();
  if (!project) {
    root.innerHTML = '<div class="empty-small">No ProjectではProject InstructionsとProject Memoryは使用しません。</div>';
    return;
  }
  const style = await getStyle(project.defaultStyleId || 'default');
  const memories = await memoriesForProject(project.id);
  root.innerHTML = `
    <label class="field-stack"><span>Project name</span><input id="project-name-field" value="${escapeHtml(project.name)}" maxlength="100"></label>
    <label class="field-stack"><span>Description</span><textarea id="project-description-field" rows="2" maxlength="1000">${escapeHtml(project.description || '')}</textarea></label>
    <label class="field-stack"><span>Instructions <small id="instruction-count">${(project.instructions || '').length} / ${WORKSPACE_LIMITS.projectInstructionsHardChars}</small></span><textarea id="project-instructions-field" rows="7" maxlength="${WORKSPACE_LIMITS.projectInstructionsHardChars}">${escapeHtml(project.instructions || '')}</textarea></label>
    <label class="field-stack"><span>Default style</span><select id="project-default-style">${ws.styles.map((s) => `<option value="${s.id}" ${s.id === style.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select></label>
    <div class="workspace-stat">Memory <strong>${memories.length}</strong><span>Enabled skills <strong>${(project.enabledSkillIds || []).length}</strong></span></div>
    <button id="save-project-settings" class="wide-button" type="button">Project設定を保存</button>
    <button id="delete-project" class="wide-button danger-button" type="button">Projectを削除（会話は保持）</button>`;
  $('#project-instructions-field')?.addEventListener('input', (e) => {
    const n = e.target.value.length;
    $('#instruction-count').textContent = `${n} / ${WORKSPACE_LIMITS.projectInstructionsHardChars}`;
    $('#instruction-count').classList.toggle('warning-text', n > WORKSPACE_LIMITS.projectInstructionsRecommendedChars);
  });
  $('#save-project-settings')?.addEventListener('click', async () => {
    try {
      const updated = await updateProject(project, {
        name: $('#project-name-field').value,
        description: $('#project-description-field').value,
        instructions: $('#project-instructions-field').value,
        defaultStyleId: $('#project-default-style').value,
      });
      ws.projects = await listProjects();
      await renderProjectList();
      markWorkspaceDirty();
      await record('project_updated', { projectId: updated.id });
      toast('Project設定を保存しました。', 'success');
      emit('nano:workspace-controls-dirty');
    } catch (error) { toast(error.message, 'error'); }
  });
  $('#delete-project')?.addEventListener('click', async () => {
    if (!confirm(`「${project.name}」を削除しますか？所属会話はNo Projectへ移動します。`)) return;
    emit('nano:workspace-cancel-harness', { reason: 'PROJECT_DELETE' });
    await deleteProject(project.id);
    await record('project_deleted', { projectId: project.id });
    ws.projects = await listProjects();
    await selectProject(null);
    toast('Projectを削除しました。会話は保持されています。', 'success');
  });
}

export async function fillMoveConversationSelect() {
  const conversation = await activeConversation();
  const select = $('#move-conversation-project');
  if (!select || !conversation) return;
  select.innerHTML = `<option value="">No Project</option>${ws.projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}`;
  select.value = conversation.projectId || '';
}

export async function moveCurrentConversation() {
  const conversation = await activeConversation();
  if (!conversation) return;
  const value = $('#move-conversation-project')?.value || null;
  await moveConversationToProject(conversation.id, value);
  await record('conversation_moved', { conversationId: conversation.id, projectId: value });
  $('#conversation-actions')?.close();
  if ((value ?? null) !== (ws.activeProjectId ?? null)) await selectProject(value);
  else syncConversationRows({ ensureActive: true });
  markWorkspaceDirty();
}

export function registerProjectEvents() {
  $('#new-project')?.addEventListener('click', createProjectUi);
  $('#new-chat')?.addEventListener('click', () => { ws.pendingNewProjectId = ws.activeProjectId ?? null; }, true);
  $('#conversation-search')?.addEventListener('input', () => renderProjectList());
  $('#project-list')?.addEventListener('click', async (e) => {
    const toggle = e.target.closest('[data-project-toggle]');
    if (toggle) {
      const key = toggle.dataset.projectToggle;
      if (ws.collapsedProjectKeys.has(key)) ws.collapsedProjectKeys.delete(key);
      else ws.collapsedProjectKeys.add(key);
      await renderProjectList();
      return;
    }
    const chatMenu = e.target.closest('[data-project-chat-menu]');
    if (chatMenu) {
      await openTreeConversationMenu(chatMenu.dataset.projectChatMenu, chatMenu.dataset.chatProject || null);
      return;
    }
    const chat = e.target.closest('[data-project-chat]');
    if (chat) {
      await openTreeConversation(chat.dataset.projectChat, chat.dataset.chatProject || null);
      return;
    }
    const project = e.target.closest('[data-project-select]');
    if (project) await selectProject(project.dataset.projectSelect || null);
  });
  $('#move-conversation')?.addEventListener('click', moveCurrentConversation);
  $('#conversation-list')?.addEventListener('click', async (e) => {
    if (!e.target.closest('.conversation-menu')) return;
    queueMicrotask(fillMoveConversationSelect);
  }, true);
}
