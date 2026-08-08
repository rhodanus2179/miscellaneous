import { WORKSPACE_LIMITS } from '../config.js';
import { put, listConversations } from '../storage.js';
import { newProject, updateProject, listProjects, deleteProject, moveConversationToProject } from './projects.js';
import { memoriesForProject } from './memories.js';
import { getStyle } from './styles.js';
import { $, $$, ws, escapeHtml, toast, activeConversation, activeProject, saveWorkspaceSelection, emit, record } from './state.js';
import { markWorkspaceDirty } from './context.js';

export function renderProjectList() {
  const root = $('#project-list');
  if (!root) return;
  root.innerHTML = [
    `<button class="project-row ${ws.activeProjectId == null ? 'active' : ''}" data-project-id=""><span class="project-dot">○</span><span>No Project</span><small id="project-count-none"></small></button>`,
    ...ws.projects.map((p) => `<button class="project-row ${p.id === ws.activeProjectId ? 'active' : ''}" data-project-id="${p.id}"><span class="project-dot">▸</span><span>${escapeHtml(p.name)}</span><small data-project-count="${p.id}"></small></button>`),
  ].join('');
  const name = ws.activeProjectId ? ws.projects.find((p) => p.id === ws.activeProjectId)?.name || 'Project' : 'No Project';
  if ($('#active-project-label')) $('#active-project-label').textContent = name;
  if ($('#composer-project')) $('#composer-project').textContent = name;
}

export function syncConversationRows({ ensureActive = false } = {}) {
  clearTimeout(ws.rowSyncTimer);
  ws.rowSyncTimer = setTimeout(async () => {
    const conversations = await listConversations();
    const projectIds = new Set(ws.projects.map((p) => p.id));
    for (const conversation of conversations) {
      if (conversation.projectId && !projectIds.has(conversation.projectId)) {
        conversation.projectId = null;
        conversation.updatedAt = Date.now();
        await put('conversations', conversation);
      }
    }
    const map = new Map(conversations.map((c) => [c.id, c]));
    const counts = new Map();
    for (const c of conversations) counts.set(c.projectId ?? '', (counts.get(c.projectId ?? '') || 0) + 1);
    if ($('#project-count-none')) $('#project-count-none').textContent = counts.get('') || 0;
    $$('[data-project-count]').forEach((n) => { n.textContent = counts.get(n.dataset.projectCount) || 0; });
    let firstVisible = null;
    let activeVisible = false;
    for (const row of $$('.conversation-row')) {
      const conv = map.get(row.dataset.id);
      const visible = !!conv && (conv.projectId ?? null) === (ws.activeProjectId ?? null);
      row.hidden = !visible;
      if (visible && !firstVisible) firstVisible = row;
      if (visible && row.classList.contains('active')) activeVisible = true;
    }
    if (ensureActive && !activeVisible) {
      if (firstVisible) firstVisible.querySelector('.conversation-open')?.click();
      else $('#new-chat')?.click();
    }
    emit('nano:workspace-selection-changed');
  }, 0);
}

export async function selectProject(projectId) {
  emit('nano:workspace-cancel-harness', { reason: 'PROJECT_SWITCH' });
  ws.activeProjectId = projectId || null;
  await saveWorkspaceSelection();
  renderProjectList();
  syncConversationRows({ ensureActive: true });
  await record('project_selected', { projectId: ws.activeProjectId });
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
      renderProjectList();
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
  $('#project-list')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-project-id]');
    if (row) selectProject(row.dataset.projectId || null);
  });
  $('#move-conversation')?.addEventListener('click', moveCurrentConversation);
  $('#conversation-list')?.addEventListener('click', async (e) => {
    if (!e.target.closest('.conversation-menu')) return;
    queueMicrotask(fillMoveConversationSelect);
  }, true);
}
