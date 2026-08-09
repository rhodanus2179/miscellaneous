import { WORKSPACE_LIMITS } from '../config.js';
import { createProject, listProjects, saveProject, deleteProject, moveConversationToProject } from '../storage.js';
import { BUILTIN_SKILL_IDS } from './skills.js';

export async function newProject(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Project名を入力してください。');
  return createProject({ name: clean, defaultStyleId: 'default', enabledSkillIds: BUILTIN_SKILL_IDS });
}

export async function updateProject(project, patch) {
  const next = { ...project, ...patch };
  next.name = String(next.name || '').trim().slice(0, 100);
  next.description = String(next.description || '').slice(0, 1000);
  next.instructions = String(next.instructions || '');
  if (!next.name) throw new Error('Project名を入力してください。');
  if (next.instructions.length > WORKSPACE_LIMITS.projectInstructionsHardChars) {
    throw new Error(`Project Instructionsは${WORKSPACE_LIMITS.projectInstructionsHardChars.toLocaleString()}文字以内にしてください。`);
  }
  return saveProject(next);
}

export function projectActivityTime(project, conversations = []) {
  const own = conversations.filter((c) => (c.projectId ?? null) === project.id);
  const chatActivity = own.reduce((latest, c) => Math.max(latest, Number(c.updatedAt || c.createdAt || 0)), 0);
  return Math.max(chatActivity, Number(project.updatedAt || project.createdAt || 0));
}

export function sortProjectsByActivity(projects, conversations = []) {
  return [...projects].sort((a, b) => {
    const activityDelta = projectActivityTime(b, conversations) - projectActivityTime(a, conversations);
    if (activityDelta) return activityDelta;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
  });
}

export { listProjects, deleteProject, moveConversationToProject };
