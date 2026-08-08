import { $, ws, reloadWorkspaceData, emit } from './state.js';
import { prepareWorkspace as prepareContext, renderSessionInputs, renderDirtyState, rebuildWorkspaceSession } from './context.js';
import { renderProjectList, syncConversationRows, renderProjectPanel, registerProjectEvents } from './project-ui.js';
import { renderMemoryPanel, augmentMessageActions, registerMemoryEvents } from './memory-ui.js';
import { renderComposerControls, renderSkillPanel, registerStyleSkillEvents } from './style-skill-ui.js';
import { registerHarnessEvents, reportReloadedHarnesses } from './harness-ui.js';
import { registerSlashEvents } from './slash-ui.js';

export async function prepareWorkspace() {
  await prepareContext();
}

async function renderWorkspaceSurface() {
  await renderProjectPanel();
  await renderMemoryPanel();
  await renderSkillPanel();
  await renderComposerControls();
  renderSessionInputs();
  renderDirtyState();
  augmentMessageActions();
}

function registerCrossModuleEvents() {
  window.addEventListener('nano:workspace-selection-changed', renderWorkspaceSurface);
  window.addEventListener('nano:workspace-controls-dirty', renderComposerControls);
  window.addEventListener('nano:workspace-context-updated', () => {
    renderSessionInputs();
    renderMemoryPanel();
  });
  window.addEventListener('nano:workspace-rebuilt', () => {
    renderMemoryPanel();
    renderComposerControls();
  });
  window.addEventListener('nano:session-context-rebuilt', () => {
    ws.dirty = false;
    renderDirtyState();
    renderSessionInputs();
    renderMemoryPanel();
  });

  $('#conversation-list')?.addEventListener('click', () => {
    emit('nano:workspace-cancel-harness', { reason: 'CONVERSATION_SWITCH' });
  }, true);

  const listObserver = new MutationObserver(() => syncConversationRows());
  if ($('#conversation-list')) listObserver.observe($('#conversation-list'), { childList: true, subtree: true });
  const chatObserver = new MutationObserver(() => augmentMessageActions());
  if ($('#chat-messages')) chatObserver.observe($('#chat-messages'), { childList: true, subtree: true });

  let sawGenerationBusy = false;
  const generationObserver = new MutationObserver(() => {
    const value = ($('#generation-state')?.textContent || '').trim();
    if (value) sawGenerationBusy = true;
    else if (sawGenerationBusy && ws.executionSkill && !ws.activeHarness) {
      sawGenerationBusy = false;
      ws.executionSkill = null;
      renderComposerControls();
    }
  });
  if ($('#generation-state')) generationObserver.observe($('#generation-state'), { childList: true, characterData: true, subtree: true });
}

export async function mountWorkspace() {
  await reloadWorkspaceData();
  renderProjectList();
  registerProjectEvents();
  registerMemoryEvents();
  registerStyleSkillEvents();
  registerHarnessEvents();
  registerSlashEvents();
  registerCrossModuleEvents();
  $('#rebuild-workspace')?.addEventListener('click', rebuildWorkspaceSession);
  syncConversationRows({ ensureActive: true });
  await renderWorkspaceSurface();
  await reportReloadedHarnesses();
}
