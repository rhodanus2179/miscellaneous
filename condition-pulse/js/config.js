export const APP_VERSION = '0.1.1';
export const QUESTION_BANK_VERSION = '2026-07-28';

export const DOMAIN_LABELS = Object.freeze({
  overall: '全体感',
  recovery: '回復感',
  physical_energy: '身体の余力',
  cognitive_clarity: '頭の明瞭さ',
  emotional_tone: '気分',
  social_capacity: '対人余力',
  appetite_body: '食欲・身体感覚',
  tension_recovery: '緊張と切替'
});

export const TIME_BAND_LABELS = Object.freeze({
  morning: '朝',
  daytime: '昼',
  evening: '夜'
});

export const RESPONSE_SCALES = Object.freeze({
  five_comparative: ['かなり低い', 'やや低い', 'いつもどおり', 'やや良い', 'かなり良い'],
  five_positive: ['まったくない', '少し', 'どちらともいえない', 'かなり', 'とても'],
  five_agreement: ['まったくそうでない', 'あまりそうでない', 'どちらともいえない', 'ややそう', 'とてもそう'],
  five_intensity: ['まったくない', '少し', 'いつも程度', 'やや強い', 'かなり強い']
});

export const DEFAULT_SETTINGS = Object.freeze({
  locale: 'ja-JP',
  timeZone: 'Asia/Tokyo',
  timeBands: {
    morning: ['05:00', '11:00'],
    daytime: ['11:00', '17:00'],
    evening: ['17:00', '02:00']
  },
  remindersEnabled: false,
  reducedMotion: false,
  privacyMode: false,
  onboardingCompleted: false
});

export const CONTEXT_TAGS = ['仕事', '休日', '外出', '運動', '睡眠不足', '飲酒', '体調イベント', 'その他'];
