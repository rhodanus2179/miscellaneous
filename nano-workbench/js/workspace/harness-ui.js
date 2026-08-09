import { WORKSPACE_LIMITS } from '../config.js';
import { get, saveHarnessRun, listHarnessRuns } from '../storage.js';
import { getActiveLanguageModel } from '../ai.js';
import { id, now } from '../utils.js';
import { getSkill } from './skills.js';
import { askPlanner, isOtherOption } from '../harness/clarification.js';
import { $, $$, ws, escapeHtml, toast, activeConversation, activeConversationId, record, emit } from './state.js';

let plannerAbortController = null;

function currentSkillForSend() {
  return ws.selectedSkillId ? ws.skills.find((x) => x.id === ws.selectedSkillId) : null;
}

function removeHarnessTransientUi({ keepPending = false } = {}) {
  $('#workspace-ask-card')?.remove();
  $('#workspace-harness-progress')?.remove();
  if (!keepPending) $('#workspace-harness-pending')?.remove();
}

function setHarnessComposerLocked(locked, run = null, { restoreText = false } = {}) {
  const composer = $('#composer');
  const input = $('#composer-input');
  const send = $('#send-button');
  const attach = $('#attach-button');
  const imageInput = $('#image-input');
  const skill = $('#skill-select');
  const style = $('#style-select');
  const slash = $('#slash-popup');

  composer?.classList.toggle('harness-active', locked);
  if (composer) composer.setAttribute('aria-busy', locked ? 'true' : 'false');

  if (input) {
    if (locked) {
      if (!input.dataset.harnessPlaceholder) input.dataset.harnessPlaceholder = input.placeholder || '';
      input.value = '';
      input.placeholder = 'Ask Userで確認中…';
    } else {
      input.placeholder = input.dataset.harnessPlaceholder || 'Nanoにメッセージを送る…（/ でコマンド）';
      delete input.dataset.harnessPlaceholder;
      if (restoreText && run?.originalUserText) input.value = run.originalUserText;
    }
    input.disabled = locked;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (send) send.disabled = locked;
  if (attach) attach.disabled = locked;
  if (imageInput) imageInput.disabled = locked;
  if (skill) skill.disabled = locked;
  if (style) style.disabled = locked;
  if (slash && locked) slash.hidden = true;
}

function renderPendingUserMessage(run, skill) {
  $('#workspace-harness-pending')?.remove();
  const root = $('#chat-messages');
  if (!root) return;
  const pending = document.createElement('section');
  pending.id = 'workspace-harness-pending';
  pending.className = 'harness-pending-request';
  pending.innerHTML = `<div class="harness-pending-bubble"><div class="harness-pending-text">${escapeHtml(run.originalUserText)}</div><div class="harness-pending-meta">送信済み · ${escapeHtml(skill.name)}で確認中</div></div>`;
  root.append(pending);
  pending.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderHarnessProgress(run, phase = 'initial') {
  $('#workspace-harness-progress')?.remove();
  const root = $('#chat-messages');
  if (!root || ws.activeHarness?.id !== run.id) return;
  const progress = document.createElement('section');
  progress.id = 'workspace-harness-progress';
  progress.className = 'harness-progress-card';
  const text = phase === 'after_answer'
    ? '回答を受け付けました。追加の確認が必要か判断しています…'
    : '送信を受け付けました。必要な確認事項を整理しています…';
  progress.innerHTML = `<div class="harness-progress-main"><span class="harness-spinner" aria-hidden="true"></span><div><strong>${escapeHtml(text)}</strong><small>Gemini NanoでAsk Userの判断を実行中です。このままお待ちください。</small></div></div><button type="button" data-harness-cancel>キャンセル</button>`;
  root.append(progress);
  progress.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export async function cancelHarness(reason = 'USER_CANCELLED') {
  const run = ws.activeHarness;
  if (!run || ['completed', 'cancelled', 'failed'].includes(run.status)) return;
  plannerAbortController?.abort();
  plannerAbortController = null;
  run.status = 'cancelled';
  run.errorCode = reason;
  const restoreDraft = reason === 'USER_CANCELLED' || reason === 'SKILL_CHANGED';
  setHarnessComposerLocked(false, run, { restoreText: restoreDraft });
  removeHarnessTransientUi();
  await saveHarnessRun(run).catch(() => {});
  await record('harness_cancelled', { skillId: run.skillId, errorName: reason });
  if (ws.activeHarness?.id === run.id) ws.activeHarness = null;
}

function setExecutionSkill(skill, clarifications = [], maxQuestionsReached = false) {
  ws.executionSkill = skill;
  if (ws.activeHarness) {
    ws.activeHarness.clarifications = clarifications;
    ws.activeHarness.maxQuestionsReached = maxQuestionsReached;
  }
  ws.selectedSkillId = null;
  emit('nano:workspace-controls-dirty');
}

async function createHarnessRun(skill, text) {
  const run = {
    id: id('harness'),
    conversationId: activeConversationId(),
    sourceMessageId: null,
    skillId: skill.id,
    status: 'planning',
    questionCount: 0,
    clarifications: [],
    originalUserText: text,
    createdAt: now(),
    updatedAt: now(),
    errorCode: null,
    maxQuestionsReached: false,
  };
  ws.activeHarness = run;
  setHarnessComposerLocked(true, run);
  renderPendingUserMessage(run, skill);
  renderHarnessProgress(run, 'initial');
  await saveHarnessRun(run);
  await record('harness_started', { skillId: skill.id });
  return run;
}

async function planHarness(run, skill, phase = 'initial') {
  if (ws.activeHarness?.id !== run.id) return;
  run.status = 'planning';
  renderHarnessProgress(run, phase);
  await saveHarnessRun(run);
  await record('harness_planner_started', { skillId: skill.id, questionCount: run.questionCount });
  const adapter = getActiveLanguageModel();
  if (!adapter) throw new Error('AI Adapterを利用できません。');
  plannerAbortController?.abort();
  plannerAbortController = new AbortController();
  const decision = await askPlanner(adapter, skill, run.originalUserText, run.clarifications, { signal: plannerAbortController.signal });
  plannerAbortController = null;
  if (ws.activeHarness?.id !== run.id || run.status === 'cancelled') return;
  if (decision.action === 'respond' || run.questionCount >= WORKSPACE_LIMITS.maxClarificationQuestions) {
    if (run.questionCount >= WORKSPACE_LIMITS.maxClarificationQuestions) run.maxQuestionsReached = true;
    return finalizeHarness(run, skill);
  }
  run.questionCount += 1;
  run.clarifications.push({
    question: decision.question,
    inputType: decision.inputType,
    options: decision.options,
    answer: null,
    skipped: false,
    createdAt: now(),
    answeredAt: null,
  });
  run.status = 'waiting_user';
  await saveHarnessRun(run);
  await record('harness_ask_user', { skillId: skill.id, questionCount: run.questionCount, inputType: decision.inputType });
  renderAskUserCard(run);
}

function choiceHtml(option, type, index) {
  const other = isOtherOption(option);
  const inputType = type === 'single_select' ? 'radio' : 'checkbox';
  const checked = type === 'single_select' && index === 0 ? 'checked' : '';
  return `<label class="ask-choice ${other ? 'ask-other-choice' : ''}"><span><input type="${inputType}" name="ask-choice" value="${escapeHtml(option)}" ${other ? 'data-ask-other-choice' : ''} ${checked}> ${escapeHtml(option)}</span>${other ? '<input type="text" data-ask-other-text placeholder="その他の内容を入力" hidden disabled>' : ''}</label>`;
}

function syncOtherInput(card) {
  const choice = card.querySelector('[data-ask-other-choice]');
  const input = card.querySelector('[data-ask-other-text]');
  if (!choice || !input) return;
  const active = !!choice.checked;
  input.hidden = !active;
  input.disabled = !active;
  if (active) input.focus({ preventScroll: true });
}

function renderAskUserCard(run) {
  $('#workspace-ask-card')?.remove();
  $('#workspace-harness-progress')?.remove();
  const turn = run.clarifications.at(-1);
  if (!turn) return;
  const card = document.createElement('section');
  card.id = 'workspace-ask-card';
  card.className = 'ask-user-card';
  let input = '';
  if (turn.inputType === 'free_text') input = '<textarea data-ask-free rows="3" placeholder="具体的な情報を入力"></textarea>';
  else input = turn.options.map((o, i) => choiceHtml(o, turn.inputType, i)).join('');
  card.innerHTML = `<div class="ask-user-kicker">Ask User · ${run.questionCount}/${WORKSPACE_LIMITS.maxClarificationQuestions}</div><h3>${escapeHtml(turn.question)}</h3><div class="ask-user-inputs">${input}</div><div class="ask-user-actions"><button type="button" data-ask-submit class="primary-button">回答</button><button type="button" data-ask-skip>回答せず実行</button><button type="button" data-ask-cancel>キャンセル</button></div>`;
  card.addEventListener('change', (event) => {
    if (event.target?.matches('input[name="ask-choice"]')) syncOtherInput(card);
  });
  $('#chat-messages')?.append(card);
  syncOtherInput(card);
  card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function otherTextValue() {
  return $('[data-ask-other-text]')?.value.trim() || '';
}

function answerFromChoices(turn) {
  const checked = $$('input[name="ask-choice"]:checked').map((x) => x.value);
  if (!checked.length) return { answer: turn.inputType === 'multi_select' ? [] : '', error: '回答を選択してください。' };
  const hasOther = checked.some(isOtherOption);
  const otherText = hasOther ? otherTextValue() : '';
  if (hasOther && !otherText) return { answer: turn.inputType === 'multi_select' ? [] : '', error: '「その他」の内容を入力してください。' };
  const resolved = checked.map((value) => isOtherOption(value) ? `${value}: ${otherText}` : value);
  return { answer: turn.inputType === 'single_select' ? resolved[0] : resolved, error: null };
}

async function answerHarness(skip = false) {
  const run = ws.activeHarness;
  if (!run || run.status !== 'waiting_user') return;
  const skill = await getSkill(run.skillId);
  const turn = run.clarifications.at(-1);
  if (!skill || !turn) return;
  if (skip) {
    turn.skipped = true;
    turn.answer = null;
    turn.answeredAt = now();
    run.status = 'ready';
    await saveHarnessRun(run);
    await record('harness_skipped', { skillId: run.skillId, questionCount: run.questionCount });
    return finalizeHarness(run, skill);
  }
  let answer;
  if (turn.inputType === 'free_text') {
    answer = $('[data-ask-free]')?.value.trim() || '';
    if (!answer) {
      toast('回答を入力してください。', 'warning');
      return;
    }
  } else {
    const result = answerFromChoices(turn);
    if (result.error) {
      toast(result.error, 'warning');
      return;
    }
    answer = result.answer;
  }
  turn.answer = answer;
  turn.answeredAt = now();
  run.status = 'planning';
  $('#workspace-ask-card')?.remove();
  renderHarnessProgress(run, 'after_answer');
  await saveHarnessRun(run);
  await record('harness_answered', { skillId: run.skillId, questionCount: run.questionCount });
  if (run.questionCount >= WORKSPACE_LIMITS.maxClarificationQuestions) {
    run.maxQuestionsReached = true;
    return finalizeHarness(run, skill);
  }
  try { await planHarness(run, skill, 'after_answer'); }
  catch (error) { await plannerFailure(run, skill, error); }
}

async function plannerFailure(run, skill, error) {
  if (ws.activeHarness?.id !== run.id || run.status === 'cancelled') return;
  run.status = 'failed';
  run.errorCode = error?.code || error?.name || 'PLANNER_FAILED';
  await saveHarnessRun(run).catch(() => {});
  await record('harness_failed', { skillId: skill.id, errorName: run.errorCode, errorMessage: error?.message });
  toast('確認判断に失敗したため、質問なしで実行します。', 'warning');
  run.status = 'ready';
  run.errorCode = null;
  ws.activeHarness = run;
  await finalizeHarness(run, skill);
}

async function finalizeHarness(run, skill) {
  if (ws.activeHarness?.id !== run.id) return;
  plannerAbortController?.abort();
  plannerAbortController = null;
  run.status = 'ready';
  await saveHarnessRun(run);
  removeHarnessTransientUi();
  setExecutionSkill(skill, run.clarifications, run.maxQuestionsReached);
  setHarnessComposerLocked(false, run, { restoreText: true });
  ws.bypassHarness = true;
  $('#send-button')?.click();
  ws.bypassHarness = false;
}

export async function interceptSend(event) {
  if (ws.bypassHarness) return;
  const skill = currentSkillForSend();
  if (!skill) return;
  const text = $('#composer-input')?.value.trim() || '';
  const hasImages = !!($('#attach-count')?.textContent || '').trim();
  if (hasImages && !skill.inputTypes.includes('image')) {
    event.preventDefault(); event.stopImmediatePropagation();
    toast(`Skill「${skill.name}」は画像入力に対応していません。`, 'warning');
    return;
  }
  if (text && !skill.inputTypes.includes('text')) {
    event.preventDefault(); event.stopImmediatePropagation();
    toast(`Skill「${skill.name}」はテキスト入力に対応していません。`, 'warning');
    return;
  }
  if (skill.clarificationMode !== 'auto' || !text) {
    setExecutionSkill(skill);
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  if (ws.activeHarness) {
    toast('確認処理中です。現在のAsk Userが完了するまでお待ちください。', 'warning');
    return;
  }
  const run = await createHarnessRun(skill, text);
  try { await planHarness(run, skill, 'initial'); }
  catch (error) { await plannerFailure(run, skill, error); }
}

async function finishHarness(event) {
  removeHarnessTransientUi();
  setHarnessComposerLocked(false);
  if (ws.activeHarness) {
    const conversation = await activeConversation();
    const leaf = conversation?.activeLeafId ? await get('messages', conversation.activeLeafId) : null;
    if (!ws.activeHarness.sourceMessageId && leaf?.role === 'assistant' && leaf.parentMessageId) ws.activeHarness.sourceMessageId = leaf.parentMessageId;
    ws.activeHarness.status = event.detail?.ok ? 'completed' : 'failed';
    ws.activeHarness.errorCode = event.detail?.ok ? null : (event.detail?.code || 'MAIN_PROMPT_FAILED');
    await saveHarnessRun(ws.activeHarness).catch(() => {});
    await record(event.detail?.ok ? 'harness_completed' : 'harness_failed', {
      skillId: ws.activeHarness.skillId,
      questionCount: ws.activeHarness.questionCount,
      errorName: ws.activeHarness.errorCode,
    });
  }
  ws.activeHarness = null;
  ws.executionSkill = null;
  ws.selectedSkillId = null;
  emit('nano:workspace-controls-dirty');
}

export function registerHarnessEvents() {
  window.addEventListener('nano:workspace-cancel-harness', (e) => cancelHarness(e.detail?.reason || 'CANCELLED'));
  $('#chat-messages')?.addEventListener('click', async (e) => {
    if (e.target.closest('[data-ask-submit]')) return answerHarness(false);
    if (e.target.closest('[data-ask-skip]')) return answerHarness(true);
    if (e.target.closest('[data-ask-cancel], [data-harness-cancel]')) {
      await cancelHarness('USER_CANCELLED');
      toast('確認をキャンセルしました。');
    }
  }, true);
  $('#send-button')?.addEventListener('click', interceptSend, true);
  window.addEventListener('nano:main-prompt-finished', finishHarness);
}

export async function reportReloadedHarnesses() {
  removeHarnessTransientUi();
  setHarnessComposerLocked(false);
  if (ws.staleHarnessCount) toast('前回の未完了の確認質問は中断されました。必要ならSkillを選び直して実行してください。', 'warning');
  const incomplete = (await listHarnessRuns()).filter((x) => x.errorCode === 'RELOAD_CANCELLED').length;
  if (incomplete) await record('harness_reload_cancelled', { count: incomplete });
}
