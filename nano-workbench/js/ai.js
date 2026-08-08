import { SESSION_OPTIONS, SYSTEM_PROMPT } from './config.js';

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

export class LocalLanguageModel {
  constructor({ onDownloadProgress = () => {}, onOverflow = () => {} } = {}) {
    this.session = null;
    this.onDownloadProgress = onDownloadProgress;
    this.onOverflow = onOverflow;
  }

  supported() { return 'LanguageModel' in self; }

  async availability() {
    if (!this.supported()) return 'unsupported';
    try { return await LanguageModel.availability(SESSION_OPTIONS); }
    catch (error) { throw normalizeAiError(error); }
  }

  async createSession({ initialPrompts = [] } = {}) {
    if (!this.supported()) throw new AiError('MODEL_UNAVAILABLE', 'このChromeではPrompt APIを利用できません。');
    await this.destroy();
    const prompts = [{ role: 'system', content: SYSTEM_PROMPT }, ...initialPrompts];
    try {
      this.session = await LanguageModel.create({
        ...SESSION_OPTIONS,
        initialPrompts: prompts,
        monitor: (monitor) => monitor.addEventListener('downloadprogress', (event) => {
          this.onDownloadProgress(Number(event.loaded || 0));
        }),
      });
      this.session.addEventListener('contextoverflow', this.onOverflow);
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

  async measure(message) {
    if (!this.session) throw new AiError('NO_SESSION', 'AIセッションが準備されていません。');
    try { return Number(await this.session.measureContextUsage(message)); }
    catch (error) { throw normalizeAiError(error); }
  }

  async append(messages) {
    if (!this.session) throw new AiError('NO_SESSION', 'AIセッションが準備されていません。');
    try { await this.session.append(messages); }
    catch (error) { throw normalizeAiError(error); }
  }

  async stream(message, { signal, onText = () => {} } = {}) {
    if (!this.session) throw new AiError('NO_SESSION', 'AIセッションが準備されていません。');
    let full = '';
    try {
      const stream = this.session.promptStreaming(message, { signal });
      for await (const chunkValue of stream) {
        const chunk = String(chunkValue ?? '');
        if (chunk.startsWith(full)) full = chunk;
        else if (!full.endsWith(chunk)) full += chunk;
        onText(full);
      }
      return full;
    } catch (error) { throw normalizeAiError(error); }
  }

  async destroy() {
    if (!this.session) return;
    try { this.session.destroy(); } catch { /* noop */ }
    this.session = null;
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
