import { SESSION_OPTIONS, SYSTEM_PROMPT } from './config.js';

let sessionContextProvider = null;
let promptTransformProvider = null;
let activeAdapter = null;

export function setSessionContextProvider(provider) { sessionContextProvider = provider || null; }
export function setPromptTransformProvider(provider) { promptTransformProvider = provider || null; }
export function getActiveLanguageModel() { return activeAdapter; }
export function markWorkspaceContextDirty() { activeAdapter?.markContextDirty(); }

export class AiError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'AiError';
    this.code = code;
  }
}

export function normalizeAiError(error) {
  const name = error?.name || '';
  if (name === 'NotSupportedError') return new AiError('MODALITY_UNSUPPORTED', 'この環境では指定した言語または画像入力を利用できません。', error);
  if (name === 'QuotaExceededError') return new AiError('CONTEXT_EXCEEDED', 'コンテキスト上限を超えました。会話を圧縮するか入力を短くしてください。', error);
  if (name === 'AbortError') return new AiError('USER_CANCELLED', '生成を停止しました。', error);
  return new AiError('UNKNOWN_AI_ERROR', error?.message || 'AI処理で不明なエラーが発生しました。', error);
}

export function promptMessage(text, attachments = []) {
  const actualText = text.trim() || '添付画像を確認してください。';
  if (!attachments.length) return actualText;
  return [{
    role: 'user',
    content: [
      { type: 'text', value: actualText },
      ...attachments.map((x) => ({ type: 'image', value: x.normalizedBlob })),
    ],
  }];
}

async function workspaceSystemSuffix() {
  if (!sessionContextProvider) return '';
  try {
    const value = await sessionContextProvider();
    return typeof value === 'string' ? value.trim() : '';
  } catch (error) {
    console.warn('Workspace context provider failed', error);
    return '';
  }
}

async function transformPrompt(message) {
  if (!promptTransformProvider) return message;
  try { return await promptTransformProvider(message); }
  catch (error) { console.warn('Prompt transform failed; using original prompt', error); return message; }
}

function dispatchRuntime(name, detail = {}) {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

export class LocalLanguageModel {
  constructor({ onDownloadProgress = () => {}, onOverflow = () => {} } = {}) {
    this.session = null;
    this.onDownloadProgress = onDownloadProgress;
    this.onOverflow = onOverflow;
    this.baseInitialPrompts = [];
    this.replayMessages = [];
    this.contextDirty = false;
    this.rebuilding = null;
    activeAdapter = this;
  }

  supported() { return 'LanguageModel' in self; }

  async availability() {
    if (!this.supported()) return 'unsupported';
    try { return await LanguageModel.availability(SESSION_OPTIONS); }
    catch (error) { throw normalizeAiError(error); }
  }

  async createBrowserSession(initialPrompts) {
    const suffix = await workspaceSystemSuffix();
    const system = suffix ? `${SYSTEM_PROMPT}\n\n${suffix}` : SYSTEM_PROMPT;
    const prompts = [{ role: 'system', content: system }, ...initialPrompts];
    const session = await LanguageModel.create({
      ...SESSION_OPTIONS,
      initialPrompts: prompts,
      monitor: (monitor) => monitor.addEventListener('downloadprogress', (event) => {
        this.onDownloadProgress(Number(event.loaded || 0));
      }),
    });
    session.addEventListener('contextoverflow', this.onOverflow);
    return session;
  }

  async createSession({ initialPrompts = [] } = {}) {
    if (!this.supported()) throw new AiError('MODEL_UNAVAILABLE', 'このChromeではPrompt APIを利用できません。');
    await this.destroy({ keepRecipe: false });
    this.baseInitialPrompts = [...initialPrompts];
    this.replayMessages = [];
    try {
      this.session = await this.createBrowserSession(this.baseInitialPrompts);
      this.contextDirty = false;
      dispatchRuntime('nano:session-created', this.snapshot());
      return this.snapshot();
    } catch (error) { throw normalizeAiError(error); }
  }

  snapshot() {
    if (!this.session) return { contextWindow: 0, contextUsage: 0, remaining: 0, percentage: 0 };
    const contextWindow = Number(this.session.contextWindow || 0);
    const contextUsage = Number(this.session.contextUsage || 0);
    return {
      contextWindow,
      contextUsage,
      remaining: Math.max(0, contextWindow - contextUsage),
      percentage: contextWindow ? contextUsage / contextWindow : 0,
    };
  }

  markContextDirty() {
    this.contextDirty = true;
    dispatchRuntime('nano:workspace-dirty', { dirty: true });
  }

  async ensureFreshContext() {
    if (!this.contextDirty || !this.session) return this.snapshot();
    return this.rebuildContext();
  }

  async rebuildContext() {
    if (!this.session) { this.contextDirty = false; return this.snapshot(); }
    if (this.rebuilding) return this.rebuilding;
    this.rebuilding = (async () => {
      try {
        try { this.session.destroy(); } catch { /* noop */ }
        this.session = await this.createBrowserSession(this.baseInitialPrompts);
        const replay = [...this.replayMessages];
        for (const messages of replay) await this.session.append(messages);
        this.contextDirty = false;
        const snapshot = this.snapshot();
        dispatchRuntime('nano:session-context-rebuilt', snapshot);
        return snapshot;
      } catch (error) {
        throw normalizeAiError(error);
      } finally { this.rebuilding = null; }
    })();
    return this.rebuilding;
  }

  async measure(message) {
    if (!this.session) throw new AiError('NO_SESSION', 'AIセッションが準備されていません。');
    try {
      await this.ensureFreshContext();
      const transformed = await transformPrompt(message);
      return Number(await this.session.measureContextUsage(transformed));
    } catch (error) { throw normalizeAiError(error); }
  }

  async append(messages) {
    if (!this.session) throw new AiError('NO_SESSION', 'AIセッションが準備されていません。');
    try {
      await this.session.append(messages);
      this.replayMessages.push(messages);
    } catch (error) { throw normalizeAiError(error); }
  }

  async stream(message, { signal, onText = () => {} } = {}) {
    if (!this.session) throw new AiError('NO_SESSION', 'AIセッションが準備されていません。');
    let full = '';
    try {
      await this.ensureFreshContext();
      const transformed = await transformPrompt(message);
      const stream = this.session.promptStreaming(transformed, { signal });
      for await (const chunkValue of stream) {
        const chunk = String(chunkValue ?? '');
        if (chunk.startsWith(full)) full = chunk;
        else if (!full.endsWith(chunk)) full += chunk;
        onText(full);
      }
      const replayUser = typeof transformed === 'string' ? [{ role: 'user', content: transformed }] : transformed;
      this.replayMessages.push(replayUser);
      this.replayMessages.push([{ role: 'assistant', content: full }]);
      dispatchRuntime('nano:main-prompt-finished', { ok: true });
      return full;
    } catch (error) {
      const normalized = normalizeAiError(error);
      dispatchRuntime('nano:main-prompt-finished', { ok: false, code: normalized.code });
      throw normalized;
    }
  }

  async structuredDecision(prompt, schema, { signal, retryStandalone = true } = {}) {
    if (!this.supported()) throw new AiError('MODEL_UNAVAILABLE', 'このChromeではPrompt APIを利用できません。');
    let temp = null;
    try {
      if (this.session) {
        await this.ensureFreshContext();
        temp = await this.session.clone({ signal });
      } else if (retryStandalone) {
        const suffix = await workspaceSystemSuffix();
        const system = suffix ? `${SYSTEM_PROMPT}\n\n${suffix}` : SYSTEM_PROMPT;
        temp = await LanguageModel.create({
          expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
          expectedOutputs: [{ type: 'text', languages: ['ja', 'en'] }],
          initialPrompts: [{ role: 'system', content: system }],
        });
      } else {
        throw new AiError('NO_SESSION', 'Planner用に複製できるAIセッションがありません。');
      }
      const raw = await temp.prompt(prompt, { responseConstraint: schema });
      return JSON.parse(raw);
    } catch (error) {
      if (error instanceof AiError) throw error;
      throw normalizeAiError(error);
    } finally {
      try { temp?.destroy?.(); } catch { /* noop */ }
    }
  }

  async destroy({ keepRecipe = false } = {}) {
    if (this.session) {
      try { this.session.destroy(); } catch { /* noop */ }
      this.session = null;
    }
    this.contextDirty = false;
    if (!keepRecipe) {
      this.baseInitialPrompts = [];
      this.replayMessages = [];
    }
  }
}

export async function summarizeConversation(text, onProgress = () => {}) {
  const source = text.length > 24000 ? `${text.slice(0, 12000)}\n\n[中間部を省略]\n\n${text.slice(-12000)}` : text;
  if ('Summarizer' in self) {
    const options = {
      type: 'key-points', format: 'markdown', length: 'long',
      expectedInputLanguages: ['ja', 'en'], outputLanguage: 'ja',
      expectedContextLanguages: ['ja'],
      sharedContext: '会話履歴を圧縮します。目的、確定事項、固有名詞、ユーザーの制約、未解決事項、画像参照、直近の作業状態を優先してください。',
      monitor: (monitor) => monitor.addEventListener('downloadprogress', (event) => onProgress(Number(event.loaded || 0))),
    };
    try {
      const availability = await Summarizer.availability(options);
      if (availability !== 'unavailable') {
        const summarizer = await Summarizer.create(options);
        try {
          return await summarizer.summarize(source, {
            context: '日本語の対話の継続に使う要約です。重要な決定と未解決事項を落とさないでください。',
          });
        } finally { summarizer.destroy?.(); }
      }
    } catch { /* Prompt API fallback below */ }
  }

  if (!('LanguageModel' in self)) throw new AiError('SUMMARIZER_UNAVAILABLE', '会話を圧縮できるBuilt-in AI APIがありません。');
  const textOptions = {
    expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['ja'] }],
  };
  const availability = await LanguageModel.availability(textOptions);
  if (availability === 'unavailable') throw new AiError('SUMMARIZER_UNAVAILABLE', '会話を圧縮できるモデルを利用できません。');
  const temp = await LanguageModel.create({
    ...textOptions,
    initialPrompts: [{ role: 'system', content: '会話履歴を短く圧縮する編集者です。目的、確定事項、固有名詞、ユーザーの制約、未解決事項、画像参照、直近の作業状態を保持し、日本語Markdownで要約してください。' }],
    monitor: (monitor) => monitor.addEventListener('downloadprogress', (event) => onProgress(Number(event.loaded || 0))),
  });
  try { return await temp.prompt(`次の会話履歴を継続用に要約してください。\n\n${source}`); }
  finally { temp.destroy?.(); }
}
