import { get, listConversations, getWorkspaceState, saveWorkspaceState, logEvent } from '../storage.js';
import { listProjects } from './projects.js';
import { listStyles } from './styles.js';
import { listSkills } from './skills.js';

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

export const ws = {
  projects: [], styles: [], skills: [],
  activeProjectId: null,
  selectedSkillId: null,
  executionSkill: null,
  activeHarness: null,
  dirty: false,
  sessionMemoryIds: new Set(),
  sessionInputs: null,
  bypassHarness: false,
  slashMatches: [],
  slashIndex: 0,
  staleHarnessCount: 0,
  rowSyncTimer: null,
};

export function escapeHtml(text = '') {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function toast(message, tone = 'info') {
  const root = $('#toasts');
  if (!root) { console.log(message); return; }
  const item = document.createElement('div');
  item.className = `toast ${tone}`;
  item.textContent = message;
  root.append(item);
  setTimeout(() => item.remove(), 4200);
}

export function activeConversationId() { return $('.conversation-row.active')?.dataset.id || null; }
export async function activeConversation() {
  const idValue = activeConversationId();
  return idValue ? get('conversations', idValue) : null;
}
export async function activeProject() { return ws.activeProjectId ? get('projects', ws.activeProjectId) : null; }

export async function reloadWorkspaceData() {
  ws.projects = await listProjects();
  ws.styles = await listStyles();
  ws.skills = await listSkills();
  if (ws.activeProjectId && !ws.projects.some((p) => p.id === ws.activeProjectId)) ws.activeProjectId = null;
}

export async function loadWorkspaceSelection() {
  const saved = await getWorkspaceState();
  ws.activeProjectId = saved.activeProjectId ?? null;
}

export async function saveWorkspaceSelection() {
  await saveWorkspaceState({ activeProjectId: ws.activeProjectId });
}

export function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function setInspectorTab(tab) {
  $(`.inspector-tab[data-tab="${tab}"]`)?.click();
  document.querySelector('.inspector')?.classList.add('open');
}

export async function record(eventType, data = {}) {
  await logEvent(eventType, { conversationId: activeConversationId(), ...data });
}

export async function conversations() { return listConversations(); }
