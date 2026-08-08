export const APP_VERSION = '0.2.0';
export const DB_NAME = 'nano-workbench';
export const DB_VERSION = 2;
export const SYSTEM_PROMPT = `あなたは端末内で動作する対話アシスタントです。
ユーザーの言語に合わせ、根拠のない断定を避けてください。
画像内の細かい文字、数値、固有名詞には不確実性を明示してください。
Markdownで読みやすく回答してください。`;

export const SESSION_OPTIONS = {
  expectedInputs: [
    { type: 'text', languages: ['ja', 'en'] },
    { type: 'image' },
  ],
  expectedOutputs: [{ type: 'text', languages: ['ja', 'en'] }],
};

export const DEFAULT_SETTINGS = {
  theme: 'system',
  safetyMargin: 0.15,
  autoCompact: 'confirm',
  maxImages: 4,
  photoMaxEdge: 1600,
  screenshotMaxEdge: 2048,
  imageQuality: 0.86,
  textTimeoutMs: 6 * 60 * 1000,
  imageTimeoutMs: 10 * 60 * 1000,
  debug: false,
};

export const WORKSPACE_LIMITS = {
  projectInstructionsRecommendedChars: 1500,
  projectInstructionsHardChars: 4000,
  maxMemoryItems: 12,
  maxMemoryTextChars: 3000,
  maxClarificationQuestions: 3,
  initialContextWarningRatio: 0.35,
};

export const IMAGE_LIMITS = {
  maxOriginalBytes: 20 * 1024 * 1024,
  maxNormalizedTurnBytes: 16 * 1024 * 1024,
  supported: new Set(['image/png', 'image/jpeg', 'image/webp']),
};

export const CONTEXT_LEVELS = {
  notice: 0.60,
  warning: 0.80,
  critical: 0.90,
};
