import { unzipSync, strFromU8 } from 'fflate';
import { marked } from 'marked';
import { normalizeForReading } from './chunking';
import type { BlockKind, ImportPayload, ImportedSection, SourceType, TextBlock } from './types';

const MAX_PASTE_CHARACTERS = 2_000_000;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_EPUB_BYTES = 100 * 1024 * 1024;
const MAX_EPUB_ENTRIES = 10_000;
const MAX_EPUB_EXPANDED = 300 * 1024 * 1024;
const MAX_EPUB_TEXT_ENTRY = 20 * 1024 * 1024;

interface RawBlock {
  kind: BlockKind;
  text: string;
  level?: number;
  autoPlayable?: boolean;
}

interface MarkdownToken {
  type: string;
  raw?: string;
  text?: string;
  lang?: string;
  tokens?: MarkdownToken[];
  items?: MarkdownToken[];
  header?: MarkdownToken[];
  rows?: MarkdownToken[][];
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function compactText(text: string): string {
  return text.replace(/\r\n?/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function finalizeSection(sectionId: string, title: string | undefined, rawBlocks: RawBlock[], sourceHref?: string): ImportedSection {
  const blocks: TextBlock[] = [];
  let sourceText = '';
  rawBlocks.forEach((raw, index) => {
    const text = compactText(raw.text);
    if (!text) return;
    if (sourceText) sourceText += '\n\n';
    const start = sourceText.length;
    sourceText += text;
    const block: TextBlock = {
      id: `${sectionId}-b${index}`,
      sectionId,
      order: blocks.length,
      kind: raw.kind,
      text,
      sourceStart: start,
      sourceEnd: sourceText.length,
      autoPlayable: raw.autoPlayable ?? !['code', 'table'].includes(raw.kind),
    };
    if (raw.level !== undefined) block.level = raw.level;
    blocks.push(block);
  });
  const section: ImportedSection = { id: sectionId, sourceText, blocks };
  if (title) section.title = title;
  if (sourceHref) section.sourceHref = sourceHref;
  return section;
}

function plainBlocks(source: string): RawBlock[] {
  const text = compactText(source);
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/u);
  const blocks: RawBlock[] = [];
  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n').filter(Boolean);
    if (lines.length > 1 && lines.every((line) => /^\s*(?:[-*+] |\d+[.)]\s)/u.test(line))) {
      for (const line of lines) blocks.push({ kind: 'list-item', text: line.replace(/^\s*(?:[-*+] |\d+[.)]\s)/u, '') });
      continue;
    }
    const trimmed = paragraph.trim();
    const kind: BlockKind = /^https?:\/\/\S+$/u.test(trimmed) ? 'url' : 'paragraph';
    blocks.push({ kind, text: trimmed, autoPlayable: kind !== 'url' });
  }
  return blocks;
}

function tokenText(token: MarkdownToken): string {
  if (token.type === 'image') return token.text ?? '';
  if (token.type === 'br') return '\n';
  if (token.tokens?.length) return token.tokens.map(tokenText).join('');
  return token.text ?? token.raw ?? '';
}

function safeHtmlText(html: string): string {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  documentNode.querySelectorAll('script,style,noscript,template,iframe,object,embed,svg,math').forEach((node) => node.remove());
  return documentNode.body.textContent ?? '';
}

function markdownRawBlocks(source: string): RawBlock[] {
  const tokens = marked.lexer(source) as unknown as MarkdownToken[];
  const output: RawBlock[] = [];

  const visit = (token: MarkdownToken, inheritedKind?: BlockKind): void => {
    switch (token.type) {
      case 'heading':
        output.push({ kind: 'heading', text: tokenText(token), level: Number((token as MarkdownToken & { depth?: number }).depth ?? 1) });
        break;
      case 'paragraph':
      case 'text':
        output.push({ kind: inheritedKind ?? 'paragraph', text: tokenText(token) });
        break;
      case 'blockquote':
        if (token.tokens?.length) token.tokens.forEach((child) => visit(child, 'quote'));
        else output.push({ kind: 'quote', text: tokenText(token) });
        break;
      case 'list':
        token.items?.forEach((item) => output.push({ kind: 'list-item', text: tokenText(item) }));
        break;
      case 'code':
        output.push({ kind: 'code', text: token.text ?? '', autoPlayable: false });
        break;
      case 'table': {
        const header = token.header?.map(tokenText).join('\t') ?? '';
        const rows = token.rows?.map((row) => row.map(tokenText).join('\t')).join('\n') ?? '';
        output.push({ kind: 'table', text: [header, rows].filter(Boolean).join('\n'), autoPlayable: false });
        break;
      }
      case 'hr':
        output.push({ kind: 'separator', text: '――――', autoPlayable: false });
        break;
      case 'html':
        output.push({ kind: inheritedKind ?? 'paragraph', text: safeHtmlText(token.raw ?? token.text ?? '') });
        break;
      case 'space':
        break;
      default:
        if (token.tokens?.length) token.tokens.forEach((child) => visit(child, inheritedKind));
        else if (token.text || token.raw) output.push({ kind: inheritedKind ?? 'paragraph', text: tokenText(token) });
    }
  };

  tokens.forEach((token) => visit(token));
  return output;
}

function defaultTitle(source: string): string {
  const first = compactText(source).split('\n')[0]?.trim() ?? '';
  return first.slice(0, 40) || `無題 ${new Date().toLocaleString('ja-JP')}`;
}

export function importPaste(source: string, format: 'text' | 'markdown', title?: string, author?: string): ImportPayload {
  if (!source.trim()) throw new Error('本文を入力してください。');
  if (source.length > MAX_PASTE_CHARACTERS) throw new Error('貼り付け本文は200万文字以下にしてください。');
  const sectionId = id('sec');
  const raw = format === 'markdown' ? markdownRawBlocks(source) : plainBlocks(source);
  const section = finalizeSection(sectionId, undefined, raw);
  const payload: ImportPayload = {
    title: title?.trim() || defaultTitle(section.sourceText),
    sourceType: format === 'markdown' ? 'markdown' : 'paste',
    originalSource: source,
    warnings: [],
    sections: [section],
  };
  if (author?.trim()) payload.author = author.trim();
  return payload;
}

export function decodeTextBytes(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error('TXT・Markdownファイルは10 MB以下にしてください。');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('文字コードを判定できませんでした。UTF-8またはBOM付きUTF-16で保存してください。');
  }
}

function normalizeZipPath(path: string): string {
  const replaced = path.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (!replaced || replaced.startsWith('/') || /^[A-Za-z]:/u.test(replaced) || replaced.includes('\u0000')) throw new Error('EPUB内に不正なパスがあります。');
  const stack: string[] = [];
  for (const part of replaced.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!stack.length) throw new Error('EPUB内にルート外を参照するパスがあります。');
      stack.pop();
    } else stack.push(part);
  }
  return stack.join('/');
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index + 1);
}

function resolvePath(baseFile: string, relative: string): string {
  const withoutFragment = relative.split('#')[0] ?? '';
  return normalizeZipPath(`${dirname(baseFile)}${withoutFragment}`);
}

function decodeXml(bytes: Uint8Array | undefined, label: string): string {
  if (!bytes) throw new Error(`${label}が見つかりません。`);
  return strFromU8(bytes);
}

function parseXml(source: string, mime: DOMParserSupportedType): Document {
  const documentNode = new DOMParser().parseFromString(source, mime);
  if (documentNode.getElementsByTagName('parsererror').length) throw new Error('XMLを解析できませんでした。');
  return documentNode;
}

function byLocalName(documentNode: Document | Element, localName: string): Element[] {
  return Array.from(documentNode.getElementsByTagNameNS('*', localName));
}

function textByLocalName(documentNode: Document | Element, localName: string): string | undefined {
  return byLocalName(documentNode, localName)[0]?.textContent?.trim() || undefined;
}

function xhtmlRawBlocks(source: string): RawBlock[] {
  let documentNode: Document;
  try {
    documentNode = parseXml(source, 'application/xhtml+xml');
  } catch {
    documentNode = new DOMParser().parseFromString(source, 'text/html');
  }
  documentNode.querySelectorAll('script,style,noscript,template,iframe,object,embed,svg,math,audio,video,canvas,rt,rp').forEach((node) => node.remove());
  const selector = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table';
  const selected = Array.from(documentNode.querySelectorAll(selector));
  const output: RawBlock[] = [];
  for (const element of selected) {
    const parentSelected = element.parentElement?.closest(selector);
    if (parentSelected) continue;
    const tag = element.tagName.toLowerCase();
    let kind: BlockKind = 'paragraph';
    let autoPlayable = true;
    if (/^h[1-6]$/u.test(tag)) kind = 'heading';
    else if (tag === 'li') kind = 'list-item';
    else if (tag === 'blockquote') kind = 'quote';
    else if (tag === 'pre') { kind = 'code'; autoPlayable = false; }
    else if (tag === 'table') { kind = 'table'; autoPlayable = false; }
    const text = element.textContent?.replace(/[\t ]+/gu, ' ').trim() ?? '';
    if (!text) continue;
    const raw: RawBlock = { kind, text, autoPlayable };
    if (/^h[1-6]$/u.test(tag)) raw.level = Number(tag.slice(1));
    output.push(raw);
  }
  if (!output.length) {
    const fallback = documentNode.body?.textContent ?? documentNode.documentElement.textContent ?? '';
    if (fallback.trim()) output.push({ kind: 'paragraph', text: fallback });
  }
  return output;
}

function navigationTitles(files: Record<string, Uint8Array>, opfPath: string, manifest: Map<string, { href: string; mediaType: string; properties: string }>): Map<string, string> {
  const titles = new Map<string, string>();
  const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/u).includes('nav'));
  if (nav) {
    const navPath = resolvePath(opfPath, nav.href);
    const source = files[navPath];
    if (source) {
      const doc = new DOMParser().parseFromString(strFromU8(source), 'text/html');
      doc.querySelectorAll('nav a').forEach((anchor) => {
        const href = anchor.getAttribute('href');
        const title = anchor.textContent?.trim();
        if (href && title) titles.set(resolvePath(navPath, href), title);
      });
    }
  }
  return titles;
}

function importEpub(bytes: Uint8Array, fileName: string): ImportPayload {
  if (bytes.byteLength > MAX_EPUB_BYTES) throw new Error('EPUBは100 MB以下にしてください。');
  let entryCount = 0;
  let expandedSize = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      entryCount += 1;
      if (entryCount > MAX_EPUB_ENTRIES) throw new Error('EPUB内のファイル数が上限を超えています。');
      const path = normalizeZipPath(file.name);
      expandedSize += file.originalSize;
      if (expandedSize > MAX_EPUB_EXPANDED) throw new Error('EPUBの展開後サイズが上限を超えています。');
      if (file.originalSize > MAX_EPUB_TEXT_ENTRY && /\.(?:xml|opf|ncx|xhtml|html|htm)$/iu.test(path)) throw new Error('EPUB内の単一テキストファイルが大きすぎます。');
      return path === 'mimetype' || path === 'META-INF/container.xml' || path === 'META-INF/encryption.xml' || /\.(?:xml|opf|ncx|xhtml|html|htm)$/iu.test(path);
    },
  });
  const normalizedFiles: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(files)) normalizedFiles[normalizeZipPath(name)] = data;

  const container = parseXml(decodeXml(normalizedFiles['META-INF/container.xml'], 'META-INF/container.xml'), 'application/xml');
  const rootfile = byLocalName(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!rootfile) throw new Error('EPUBのPackage Documentを特定できません。');
  const opfPath = normalizeZipPath(rootfile);
  const opf = parseXml(decodeXml(normalizedFiles[opfPath], 'Package Document'), 'application/xml');

  for (const meta of byLocalName(opf, 'meta')) {
    const property = meta.getAttribute('property');
    const value = (meta.textContent ?? meta.getAttribute('content') ?? '').trim();
    if (property === 'rendition:layout' && value === 'pre-paginated') throw new Error('固定レイアウトEPUBには対応していません。');
  }

  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  for (const item of byLocalName(opf, 'item')) {
    const itemId = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!itemId || !href) continue;
    manifest.set(itemId, {
      href,
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    });
  }

  const spineItems: Array<{ idref: string; path: string }> = [];
  for (const itemref of byLocalName(opf, 'itemref')) {
    if (itemref.getAttribute('linear') === 'no') continue;
    const idref = itemref.getAttribute('idref');
    const item = idref ? manifest.get(idref) : undefined;
    if (!idref || !item) continue;
    spineItems.push({ idref, path: resolvePath(opfPath, item.href) });
  }
  if (!spineItems.length) throw new Error('EPUBの本文読書順を取得できません。');

  const encryptionBytes = normalizedFiles['META-INF/encryption.xml'];
  if (encryptionBytes) {
    const encryptionText = strFromU8(encryptionBytes);
    const encryptedPaths = [...encryptionText.matchAll(/CipherReference[^>]+URI=["']([^"']+)["']/giu)].map((match) => normalizeZipPath(match[1] ?? ''));
    if (spineItems.some((item) => encryptedPaths.includes(item.path))) throw new Error('本文が暗号化されたEPUBには対応していません。');
  }

  const title = textByLocalName(opf, 'title') || fileName.replace(/\.epub$/iu, '');
  const author = textByLocalName(opf, 'creator');
  const navTitles = navigationTitles(normalizedFiles, opfPath, manifest);
  const sections: ImportedSection[] = [];

  spineItems.forEach((spine, index) => {
    const source = normalizedFiles[spine.path];
    if (!source) return;
    const rawBlocks = xhtmlRawBlocks(strFromU8(source));
    const heading = rawBlocks.find((block) => block.kind === 'heading')?.text;
    const sectionTitle = navTitles.get(spine.path) || heading || `第${index + 1}節`;
    sections.push(finalizeSection(id('sec'), sectionTitle, rawBlocks, spine.path));
  });
  if (!sections.length) throw new Error('EPUBから本文を抽出できませんでした。');

  const payload: ImportPayload = {
    title,
    sourceType: 'epub',
    sourceFileName: fileName,
    sourceMimeType: 'application/epub+zip',
    warnings: [],
    sections,
  };
  if (author) payload.author = author;
  return payload;
}

export async function importFile(file: File): Promise<ImportPayload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.epub')) return importEpub(bytes, file.name);
  const source = decodeTextBytes(bytes);
  const markdown = lower.endsWith('.md') || lower.endsWith('.markdown');
  const sectionId = id('sec');
  const section = finalizeSection(sectionId, undefined, markdown ? markdownRawBlocks(source) : plainBlocks(source));
  const sourceType: SourceType = markdown ? 'markdown' : 'txt';
  const payload: ImportPayload = {
    title: defaultTitle(section.sourceText) || file.name,
    sourceType,
    sourceFileName: file.name,
    sourceMimeType: file.type || 'text/plain',
    originalSource: source,
    warnings: [],
    sections: [section],
  };
  return payload;
}

export function normalizeImportedSection(section: ImportedSection): ImportedSection {
  const sourceText = normalizeForReading(section.sourceText);
  return { ...section, sourceText };
}
