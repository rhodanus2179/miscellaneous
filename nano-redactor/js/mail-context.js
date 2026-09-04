const HEADER_LINE = /^(?:From|To|Cc|CC|差出人|宛先)\s*:\s*(.*)$/gmi;
const ADDRESS_ENTRY = /([^;<>,\n]+?)\s*<([^<>\s]+@[^<>\s]+)>/g;
const JAPANESE_NAME_CHARS = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}々ヶヵ]';
const JAPANESE_DISPLAY = new RegExp(`^${JAPANESE_NAME_CHARS}{1,12}[ \\u3000]+${JAPANESE_NAME_CHARS}{1,12}(?:\\s*\\([A-Za-z][A-Za-z .'-]{1,60}\\))?$`, 'u');
const LATIN_DISPLAY = /^[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3}$/;
const ORGANIZATION_HINT = /(株式会社|有限会社|合同会社|研究所|事務所|センター|協会|組合|チーム|部|課|係|大学|病院|県庁|市役所|町役場|村役場)/;
const NAME_CHAR = /[\p{L}\p{N}々ヶヵ]/u;
const SURNAME_SUFFIX = /^(?:さん|さま|様|氏|先生|の|から|へ|に|が|は|を|より|です)/u;

function cleanDisplay(value) {
  return String(value || '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
}

function looksLikePersonDisplay(display) {
  if (!display || ORGANIZATION_HINT.test(display)) return false;
  return JAPANESE_DISPLAY.test(display) || LATIN_DISPLAY.test(display);
}

function japaneseParts(display) {
  const baseName = display.replace(/\s*\([^)]*\)\s*$/u, '').trim();
  const tokens = baseName.split(/[ \u3000]+/u).filter(Boolean);
  if (tokens.length !== 2 || !new RegExp(`^${JAPANESE_NAME_CHARS}+$`, 'u').test(tokens.join(''))) {
    return { baseName: '', compactName: '', surname: '' };
  }
  return { baseName, compactName: tokens.join(''), surname: tokens[0] };
}

/** Extract named mail participants from From/To/Cc style header lines. */
export function extractMailParticipantContext(source) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  const byEmail = new Map();
  let header;
  HEADER_LINE.lastIndex = 0;
  while ((header = HEADER_LINE.exec(source)) !== null) {
    const payload = header[1] || '';
    ADDRESS_ENTRY.lastIndex = 0;
    let entry;
    while ((entry = ADDRESS_ENTRY.exec(payload)) !== null) {
      const display = cleanDisplay(entry[1]);
      const email = String(entry[2] || '').trim();
      if (!looksLikePersonDisplay(display) || !email) continue;
      const parts = japaneseParts(display);
      byEmail.set(email.toLowerCase(), { display, email, ...parts });
    }
  }
  return { participants: [...byEmail.values()] };
}

function allOccurrences(text, needle) {
  const out = [];
  if (!needle) return out;
  let cursor = 0;
  while (cursor <= text.length - needle.length) {
    const index = text.indexOf(needle, cursor);
    if (index < 0) break;
    out.push(index);
    cursor = index + Math.max(needle.length, 1);
  }
  return out;
}

function pushSpan(out, seen, start, end, type, text) {
  if (start < 0 || end <= start) return;
  const key = `${start}:${end}:${type}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ start, end, type, source: 'mail-context', text });
}

function addExactSpans(chunkText, chunkStart, value, type, out, seen) {
  if (!value) return;
  for (const localStart of allOccurrences(chunkText, value)) {
    pushSpan(out, seen, chunkStart + localStart, chunkStart + localStart + value.length, type, value);
  }
}

function addSurnameMentions(chunkText, chunkStart, surname, out, seen) {
  if (!surname) return;
  for (const localStart of allOccurrences(chunkText, surname)) {
    const before = localStart > 0 ? chunkText[localStart - 1] : '';
    if (before && NAME_CHAR.test(before)) continue;
    const afterIndex = localStart + surname.length;
    const after = chunkText.slice(afterIndex, afterIndex + 8);
    const lineStart = chunkText.lastIndexOf('\n', localStart - 1) + 1;
    const nextBreak = chunkText.indexOf('\n', afterIndex);
    const lineEnd = nextBreak < 0 ? chunkText.length : nextBreak;
    const line = chunkText.slice(lineStart, lineEnd).trim();
    if (!SURNAME_SUFFIX.test(after) && line !== surname) continue;
    pushSpan(out, seen, chunkStart + localStart, chunkStart + afterIndex, 'PERSON', surname);
  }
}

/** Apply participant knowledge to the current chunk without changing chunk order. */
export function mailParticipantContextToSpans(chunkText, chunkStart = 0, context = null) {
  if (typeof chunkText !== 'string') throw new TypeError('chunkText must be a string');
  const participants = Array.isArray(context?.participants) ? context.participants : [];
  const out = [];
  const seen = new Set();
  for (const participant of participants) {
    addExactSpans(chunkText, chunkStart, participant.display, 'PERSON', out, seen);
    addExactSpans(chunkText, chunkStart, participant.baseName, 'PERSON', out, seen);
    addExactSpans(chunkText, chunkStart, participant.compactName, 'PERSON', out, seen);
    addExactSpans(chunkText, chunkStart, participant.email, 'EMAIL', out, seen);
    addSurnameMentions(chunkText, chunkStart, participant.surname, out, seen);
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}
