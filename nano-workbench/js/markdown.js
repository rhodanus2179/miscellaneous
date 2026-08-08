function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function safeUrl(raw) {
  try {
    const url = new URL(raw, location.href);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '#';
    return escapeHtml(url.href);
  } catch { return '#'; }
}

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  return s;
}

function table(lines, start) {
  if (start + 1 >= lines.length || !/^\s*\|?\s*:?-+/.test(lines[start + 1])) return null;
  const split = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
  const headers = split(lines[start]);
  const separators = split(lines[start + 1]);
  if (headers.length !== separators.length || !separators.every((x) => /^:?-{3,}:?$/.test(x))) return null;
  const rows = [];
  let i = start + 2;
  while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
    rows.push(split(lines[i])); i += 1;
  }
  const html = `<div class="table-wrap"><table><thead><tr>${headers.map((x) => `<th>${inline(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${headers.map((_, j) => `<td>${inline(r[j] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  return { html, next: i };
}

export function renderMarkdown(source = '') {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim().replace(/[^\w.+-]/g, '');
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i += 1; }
      if (i < lines.length) i += 1;
      const encoded = escapeHtml(code.join('\n'));
      out.push(`<div class="code-wrap"><button class="copy-code" type="button">Copy</button><pre><code data-lang="${escapeHtml(lang)}">${encoded}</code></pre></div>`);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const t = table(lines, i);
    if (t) { out.push(t.html); i = t.next; continue; }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) { const level = h[1].length; out.push(`<h${level}>${inline(h[2])}</h${level}>`); i += 1; continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i += 1; continue; }
    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      out.push(`<blockquote>${q.map(inline).join('<br>')}</blockquote>`); continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i += 1; }
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i += 1; }
      out.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`); continue;
    }
    const para = [line]; i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s+|^```|^>\s?|^\s*[-*+]\s+|^\s*\d+[.)]\s+/.test(lines[i])) {
      if (table(lines, i)) break;
      para.push(lines[i]); i += 1;
    }
    out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n');
}
