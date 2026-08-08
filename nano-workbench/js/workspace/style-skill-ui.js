import { get, put } from '../storage.js';
import { listStyles, getStyle, resolveEffectiveStyle, createOrUpdateStyle, deleteCustomStyle } from './styles.js';
import { listSkills, getSkill, createOrUpdateSkill, deleteCustomSkill } from './skills.js';
import { updateProject, listProjects } from './projects.js';
import { $, ws, escapeHtml, toast, activeConversation, activeProject, record, emit } from './state.js';
import { markWorkspaceDirty, rebuildWorkspaceSession } from './context.js';

export async function renderComposerControls() {
  const conversation = await activeConversation();
  const project = conversation?.projectId ? await get('projects', conversation.projectId) : await activeProject();
  const effective = await resolveEffectiveStyle(conversation, project);
  const styleSelect = $('#style-select');
  if (styleSelect) {
    const projectDefault = project ? (await getStyle(project.defaultStyleId || 'default')).name : 'Default';
    styleSelect.innerHTML = `<option value="">Project default (${escapeHtml(projectDefault)})</option>${ws.styles.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}<option value="__manage__">Manage styles…</option>`;
    styleSelect.value = conversation?.styleOverrideId || '';
    if ($('#effective-style-label')) $('#effective-style-label').textContent = effective.name;
  }
  const enabledIds = project ? new Set(project.enabledSkillIds || []) : null;
  const available = ws.skills.filter((s) => !enabledIds || enabledIds.has(s.id));
  const skillSelect = $('#skill-select');
  if (skillSelect) {
    skillSelect.innerHTML = `<option value="">None</option>${available.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}${s.clarificationMode === 'auto' ? ' · Ask' : ''}</option>`).join('')}<option value="__manage__">Manage skills…</option>`;
    if (!available.some((x) => x.id === ws.selectedSkillId)) ws.selectedSkillId = null;
    skillSelect.value = ws.selectedSkillId || '';
  }
  if ($('#composer-project')) $('#composer-project').textContent = project?.name || 'No Project';
}

async function changeStyle(value) {
  if (value === '__manage__') {
    await openStyleManager();
    await renderComposerControls();
    return;
  }
  const conversation = await activeConversation();
  if (!conversation) return;
  conversation.styleOverrideId = value || null;
  conversation.updatedAt = Date.now();
  await put('conversations', conversation);
  await record('style_changed', { styleId: value || null });
  markWorkspaceDirty();
  await rebuildWorkspaceSession();
  await renderComposerControls();
}

async function openStyleManager(style = null) {
  const dialog = $('#style-dialog');
  const custom = ws.styles.filter((x) => !x.builtIn);
  $('#custom-style-list').innerHTML = custom.map((x) => `<button type="button" data-style-edit="${x.id}"><span>${escapeHtml(x.name)}</span><small>Edit</small></button>`).join('') || '<div class="empty-small">Custom Styleはまだありません。</div>';
  dialog.dataset.styleId = style?.builtIn ? '' : (style?.id || '');
  $('#style-name').value = style?.builtIn ? '' : (style?.name || '');
  $('#style-instruction').value = style?.builtIn ? '' : (style?.instruction || '');
  $('#style-delete').hidden = !style || style.builtIn;
  if (!dialog.open) dialog.showModal();
}

async function saveStyleDialog() {
  try {
    const idValue = $('#style-dialog').dataset.styleId || null;
    const old = idValue ? await get('customStyles', idValue) : null;
    await createOrUpdateStyle({ id: idValue, name: $('#style-name').value, instruction: $('#style-instruction').value, createdAt: old?.createdAt });
    ws.styles = await listStyles();
    $('#style-dialog').close();
    await renderComposerControls();
    emit('nano:workspace-selection-changed');
    toast('Styleを保存しました。', 'success');
  } catch (error) { toast(error.message, 'error'); }
}

export async function renderSkillPanel() {
  const root = $('#skill-panel-content');
  if (!root) return;
  const project = await activeProject();
  const enabled = new Set(project?.enabledSkillIds || ws.skills.map((x) => x.id));
  root.innerHTML = `<button id="add-skill" class="wide-button" type="button">＋ Custom Skill</button><div class="skill-list">${ws.skills.map((s) => `<article class="skill-card" data-skill-id="${s.id}"><div><strong>${escapeHtml(s.name)}</strong><span>${s.builtIn ? 'Built-in' : 'Custom'}${s.clarificationMode === 'auto' ? ' · Ask User' : ''}</span></div><p>${escapeHtml(s.description)}</p><div class="skill-card-actions">${project ? `<label><input type="checkbox" data-skill-enable ${enabled.has(s.id) ? 'checked' : ''}> Projectで有効</label>` : '<span>All skills available in No Project</span>'}${!s.builtIn ? '<button data-skill-edit>Edit</button><button data-skill-delete>Delete</button>' : ''}</div></article>`).join('')}</div>`;
  $('#add-skill')?.addEventListener('click', () => openSkillDialog());
}

async function openSkillDialog(skill = null) {
  const dialog = $('#skill-dialog');
  dialog.dataset.skillId = skill?.builtIn ? '' : (skill?.id || '');
  $('#skill-name').value = skill?.builtIn ? '' : (skill?.name || '');
  $('#skill-description').value = skill?.builtIn ? '' : (skill?.description || '');
  $('#skill-instructions').value = skill?.builtIn ? '' : (skill?.instructions || '');
  $('#skill-text').checked = skill ? skill.inputTypes.includes('text') : true;
  $('#skill-image').checked = skill ? skill.inputTypes.includes('image') : false;
  $('#skill-clarification').value = skill?.clarificationMode || 'none';
  $('#skill-dialog-delete').hidden = !skill || skill.builtIn;
  if (!dialog.open) dialog.showModal();
}

async function saveSkillDialog() {
  try {
    const idValue = $('#skill-dialog').dataset.skillId || null;
    const old = idValue ? await get('customSkills', idValue) : null;
    const skill = await createOrUpdateSkill({
      id: idValue,
      name: $('#skill-name').value,
      description: $('#skill-description').value,
      instructions: $('#skill-instructions').value,
      inputTypes: [$('#skill-text').checked ? 'text' : null, $('#skill-image').checked ? 'image' : null].filter(Boolean),
      clarificationMode: $('#skill-clarification').value,
      createdAt: old?.createdAt,
    });
    ws.skills = await listSkills();
    const project = await activeProject();
    if (project && !(project.enabledSkillIds || []).includes(skill.id)) {
      await updateProject(project, { enabledSkillIds: [...(project.enabledSkillIds || []), skill.id] });
      ws.projects = await listProjects();
    }
    $('#skill-dialog').close();
    await renderSkillPanel();
    await renderComposerControls();
    toast('Skillを保存しました。', 'success');
  } catch (error) { toast(error.message, 'error'); }
}

async function skillPanelAction(target) {
  const card = target.closest('[data-skill-id]');
  if (!card) return;
  const skill = await getSkill(card.dataset.skillId);
  if (!skill) return;
  if (target.closest('[data-skill-edit]')) return openSkillDialog(skill);
  if (target.closest('[data-skill-delete]')) {
    if (!skill.builtIn && confirm(`Skill「${skill.name}」を削除しますか？`)) {
      await deleteCustomSkill(skill.id);
      ws.skills = await listSkills();
      if (ws.selectedSkillId === skill.id) ws.selectedSkillId = null;
      await renderSkillPanel();
      await renderComposerControls();
    }
    return;
  }
  const enable = target.closest('[data-skill-enable]');
  if (enable) {
    const project = await activeProject();
    if (!project) return;
    const ids = new Set(project.enabledSkillIds || []);
    if (enable.checked) ids.add(skill.id); else ids.delete(skill.id);
    await updateProject(project, { enabledSkillIds: [...ids] });
    ws.projects = await listProjects();
    await renderSkillPanel();
    await renderComposerControls();
  }
}

export function registerStyleSkillEvents() {
  $('#save-style')?.addEventListener('click', saveStyleDialog);
  $('#custom-style-list')?.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-style-edit]');
    if (!button) return;
    await openStyleManager(await getStyle(button.dataset.styleEdit));
  });
  $('#style-delete')?.addEventListener('click', async () => {
    const idValue = $('#style-dialog').dataset.styleId;
    if (!idValue || !confirm('このCustom Styleを削除しますか？')) return;
    await deleteCustomStyle(idValue);
    ws.styles = await listStyles();
    $('#style-dialog').close();
    await renderComposerControls();
    emit('nano:workspace-selection-changed');
  });
  $('#save-skill')?.addEventListener('click', saveSkillDialog);
  $('#skill-dialog-delete')?.addEventListener('click', async () => {
    const idValue = $('#skill-dialog').dataset.skillId;
    if (!idValue || !confirm('このCustom Skillを削除しますか？')) return;
    await deleteCustomSkill(idValue);
    ws.skills = await listSkills();
    $('#skill-dialog').close();
    await renderSkillPanel();
    await renderComposerControls();
  });
  $('#skill-panel-content')?.addEventListener('click', (e) => skillPanelAction(e.target));
  $('#skill-select')?.addEventListener('change', async (e) => {
    emit('nano:workspace-cancel-harness', { reason: 'SKILL_CHANGED' });
    if (e.target.value === '__manage__') {
      e.target.value = ws.selectedSkillId || '';
      await openSkillDialog();
      return;
    }
    ws.selectedSkillId = e.target.value || null;
    await record('skill_selected', { skillId: ws.selectedSkillId });
  });
  $('#style-select')?.addEventListener('change', (e) => changeStyle(e.target.value));
}
