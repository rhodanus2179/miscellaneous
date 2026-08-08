export const SLASH_COMMANDS = [
  { command: '/new', label: '新しい会話' },
  { command: '/project', label: 'Projectを切替' },
  { command: '/memory', label: 'Project Memory' },
  { command: '/skill', label: 'Skillを選択' },
  { command: '/style', label: 'Styleを選択' },
  { command: '/context', label: 'Contextを表示' },
  { command: '/compact', label: '会話を圧縮' },
  { command: '/export', label: '会話を出力' },
];

export function slashMatches(text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q.startsWith('/') || q.includes(' ')) return [];
  return SLASH_COMMANDS.filter((x) => x.command.startsWith(q));
}

export function exactSlashCommand(text) {
  const q = String(text || '').trim().toLowerCase();
  return SLASH_COMMANDS.find((x) => x.command === q) || null;
}
