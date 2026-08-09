import { openDb, cancelStaleHarnessRuns, get } from '../storage.js';
import {
  setSessionContextProvider, setPromptTransformProvider,
  getActiveLanguageModel, markWorkspaceContextDirty,
} from '../ai.js';
import { buildTaskEnvelope, replacePromptText, extractPromptText } from '../harness/prompt-envelope.js';
import { memoriesForProject, selectMemories, memoryBlock } from './memories.js';
import { resolveEffectiveStyle } from './styles.js';
import { getSkill } from './skills.js';
import { $, ws, activeConversation, loadWorkspaceSelection, reloadWorkspaceData, emit, toast } from './state.js';

export async function buildSessionContext() {
  const conversation = await activeConversation();
  const project = conversation?.projectId ? await get('projects', conversation.projectId) : null;
  const style = await resolveEffectiveStyle(conversation, project);
  const allMemories = project ? await memoriesForProject(project.id) : [];
  const selection = selectMemories(allMemories);
  ws.sessionMemoryIds = new Set(selection.selected.map((x) => x.id));
  ws.sessionInputs = {
    projectId: project?.id || null,
    projectInstructions: !!project?.instructions?.trim(),
    styleId: style.id,
    styleName: style.name,
    memoryIncluded: selection.selected.length,
    memoryTotal: allMemories.filter((x) => x.enabled !== false).length,
    memoryChars: selection.textChars,
  };
  emit('nano:workspace-context-updated', ws.sessionInputs);

  const sections = [];
  if (project?.instructions?.trim()) sections.push(`【Project Instructions】\n${project.instructions.trim()}`);
  if (style?.instruction?.trim()) sections.push(`【Response Style: ${style.name}】\n${style.instruction.trim()}`);
  const memories = memoryBlock(selection.selected);
  if (memories) sections.push(memories);
  return sections.join('\n\n');
}

async function transformOutgoingPrompt(message) {
  const skill = ws.executionSkill || (ws.selectedSkillId ? await getSkill(ws.selectedSkillId) : null);
  if (!skill) return message;
  const userText = extractPromptText(message);
  const run = ws.activeHarness;
  const envelope = buildTaskEnvelope({
    skill,
    userText,
    clarifications: run?.clarifications || [],
    maxQuestionsReached: !!run?.maxQuestionsReached,
  });
  return replacePromptText(message, envelope);
}

export async function prepareWorkspace() {
  await openDb();
  await loadWorkspaceSelection();
  await reloadWorkspaceData();
  ws.staleHarnessCount = await cancelStaleHarnessRuns();
  setSessionContextProvider(buildSessionContext);
  setPromptTransformProvider(transformOutgoingPrompt);
}

export function markWorkspaceDirty() {
  ws.dirty = true;
  markWorkspaceContextDirty();
  renderDirtyState();
}

export function renderDirtyState() {
  const el = $('#workspace-dirty');
  if (el) el.hidden = !ws.dirty;
}

export function renderSessionInputs() {
  const root = $('#workspace-session-inputs');
  if (!root) return;
  const s = ws.sessionInputs;
  if (!s) { root.innerHTML = '<p>Session作成後にWorkspace入力を表示します。</p>'; return; }
  root.innerHTML = `<h3>Session inputs</h3><dl class="stat-list compact"><div><dt>Project Instructions</dt><dd>${s.projectInstructions ? 'included' : '—'}</dd></div><div><dt>Style</dt><dd>${s.styleName}</dd></div><div><dt>Project Memory</dt><dd>${s.memoryIncluded} / ${s.memoryTotal} included</dd></div><div><dt>Memory guard</dt><dd>${s.memoryChars.toLocaleString()} chars</dd></div></dl><p>Memoryの文字数はtoken内訳ではなく、過大投入を避けるためのアプリ側guardです。</p>`;
}

export async function rebuildWorkspaceSession() {
  try {
    const adapter = getActiveLanguageModel();
    if (adapter?.session) await adapter.rebuildContext();
    ws.dirty = false;
    renderDirtyState();
    renderSessionInputs();
    emit('nano:workspace-rebuilt');
    toast('Workspace設定を現在のAIセッションへ反映しました。', 'success');
  } catch (error) {
    toast(`Session再構築に失敗しました: ${error.message}`, 'error');
  }
}
