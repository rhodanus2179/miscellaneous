import { CHUNKING_VERSION, chunkBlocks } from './chunking.js';
import { parseMarkdown, parsePlainText, suggestedTitle } from './markdown.js';
import { clearAllData, deleteDocument, getDocument, getSettings, listDocuments, saveDocument, saveSettings } from './storage.js';
import { readerScreen } from './reader.js';
import { app, h, button, navigate, toast, setBusy, formatNumber, renderHeader } from './ui.js';

const APP_VERSION = '0.1.0';
const MAX_TEXT_LENGTH = 2_000_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_SETTINGS = {
  mode: 'context',
  charactersPerMinute: 600,
  chunkLength: 'standard',
  punctuationPause: 'standard',
  fontScale: 1,
  theme: 'system',
  swipeEnabled: true,
};

let settings = { ...DEFAULT_SETTINGS };
let readerCleanup = null;

async function libraryScreen() {
  renderHeader();
  setBusy('文書を読み込んでいます…');
  const documents = await listDocuments();
  const screen = h('section', { class: 'screen' });
  screen.append(
    h('div', { class: 'hero' }, [
      h('p', { class: 'eyebrow', text: 'LOCAL READING PACEMAKER' }),
      h('h1', { text: '読むリズムを、取り戻す。' }),
      h('p', { class: 'lead', text: '日本語を意味のまとまりに近い単位で提示し、前後関係を保ちながら通読を支援します。本文は端末の外へ送りません。' }),
      button('文章を取り込む', () => navigate('#/import'), 'button primary'),
    ]),
    h('div', { class: 'section-heading' }, [h('h2', { text: 'ライブラリ' }), h('span', { text: `${documents.length}件` })]),
  );
  if (!documents.length) {
    screen.append(h('div', { class: 'empty-card' }, [
      h('p', { text: 'まだ文書がありません。' }),
      h('p', { class: 'muted', text: '文章を貼り付けるか、TXT・Markdownファイルを開いてください。' }),
    ]));
  } else {
    const grid = h('div', { class: 'document-grid' });
    for (const doc of documents) {
      const progress = Math.round((doc.progress ?? 0) * 100);
      grid.append(h('article', { class: 'document-card' }, [
        h('div', { class: 'document-type', text: doc.sourceType.toUpperCase() }),
        h('h3', { text: doc.title }),
        h('p', { class: 'muted', text: `${formatNumber(doc.characterCount)}文字・${formatNumber(doc.chunkCount)}チャンク` }),
        h('div', { class: 'progress-track', role: 'progressbar', 'aria-valuenow': progress, 'aria-valuemin': 0, 'aria-valuemax': 100 }, [
          h('span', { class: 'progress-bar', style: `width:${progress}%` }),
        ]),
        h('div', { class: 'card-actions' }, [
          button(progress > 0 ? '続きを読む' : '読み始める', () => navigate(`#/reader/${doc.id}`), 'button small primary'),
          button('詳細', () => navigate(`#/document/${doc.id}`), 'button small'),
        ]),
      ]));
    }
    screen.append(grid);
  }
  app.replaceChildren(screen);
}

async function decodeFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('ファイルサイズが10MBを超えています。');
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2);
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      swapped[i - 2] = bytes[i + 1];
      swapped[i - 1] = bytes[i];
    }
    return new TextDecoder('utf-16le', { fatal: true }).decode(swapped);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function createDocument({ title, author, sourceText, sourceType, format, fileName }) {
  if (!sourceText.trim()) throw new Error('本文が空です。');
  if (sourceText.length > MAX_TEXT_LENGTH) throw new Error('本文が200万文字を超えています。');
  const id = crypto.randomUUID();
  const blocks = format === 'markdown' ? parseMarkdown(sourceText) : parsePlainText(sourceText);
  if (!blocks.length) throw new Error('読み取れる本文がありませんでした。');
  const chunks = await chunkBlocks(id, blocks, settings.chunkLength, ({ completed, total }) => {
    const progress = document.querySelector('#import-progress');
    if (progress) progress.textContent = `チャンク生成中 ${completed}/${total}`;
  });
  if (!chunks.length) throw new Error('チャンクを生成できませんでした。');
  const now = new Date().toISOString();
  const doc = {
    id,
    schemaVersion: 1,
    title: title.trim() || suggestedTitle(sourceText, format),
    author: author.trim() || undefined,
    sourceType,
    sourceFileName: fileName,
    sourceText,
    format,
    blocks,
    chunks,
    characterCount: [...sourceText].length,
    chunkCount: chunks.length,
    chunkingVersion: CHUNKING_VERSION,
    importedAt: now,
    updatedAt: now,
    progress: 0,
  };
  await saveDocument(doc);
  return doc;
}

function importScreen() {
  renderHeader();
  const textarea = h('textarea', { id: 'source-text', rows: 14, placeholder: 'ここに日本語の文章を貼り付けます。' });
  const title = h('input', { id: 'document-title', type: 'text', placeholder: '未入力なら本文から生成' });
  const author = h('input', { id: 'document-author', type: 'text', placeholder: '任意' });
  const format = h('select', { id: 'input-format' }, [
    h('option', { value: 'plain', text: 'プレーンテキスト' }),
    h('option', { value: 'markdown', text: 'Markdown' }),
  ]);
  const fileInput = h('input', { id: 'file-input', type: 'file', accept: '.txt,.md,.markdown,text/plain,text/markdown' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      textarea.value = await decodeFile(file);
      title.value ||= file.name.replace(/\.(?:txt|md|markdown)$/iu, '');
      if (/\.(?:md|markdown)$/iu.test(file.name)) format.value = 'markdown';
      document.querySelector('#input-count').textContent = `${formatNumber([...textarea.value].length)}文字`;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'ファイルを読み込めませんでした。');
      fileInput.value = '';
    }
  });
  textarea.addEventListener('input', () => {
    document.querySelector('#input-count').textContent = `${formatNumber([...textarea.value].length)}文字`;
  });
  const submit = button('文書を登録', async () => {
    submit.disabled = true;
    try {
      document.querySelector('#import-progress').textContent = '本文を解析しています…';
      const file = fileInput.files?.[0];
      const doc = await createDocument({
        title: title.value,
        author: author.value,
        sourceText: textarea.value,
        sourceType: file ? (/\.(?:md|markdown)$/iu.test(file.name) ? 'markdown' : 'txt') : 'paste',
        format: format.value,
        fileName: file?.name,
      });
      toast('文書を保存しました。');
      navigate(`#/reader/${doc.id}`);
    } catch (error) {
      document.querySelector('#import-progress').textContent = '';
      toast(error instanceof Error ? error.message : '文書の登録に失敗しました。');
    } finally {
      submit.disabled = false;
    }
  }, 'button primary');
  const screen = h('section', { class: 'screen narrow' }, [
    h('p', { class: 'eyebrow', text: 'IMPORT' }),
    h('h1', { text: '文章を取り込む' }),
    h('div', { class: 'field-row' }, [
      h('label', {}, ['タイトル', title]),
      h('label', {}, ['著者・出典', author]),
    ]),
    h('div', { class: 'field-row' }, [
      h('label', {}, ['入力形式', format]),
      h('label', {}, ['TXT / Markdownファイル', fileInput]),
    ]),
    h('label', { class: 'source-label' }, ['本文', textarea]),
    h('div', { class: 'import-meta' }, [h('span', { id: 'input-count', text: '0文字' }), h('span', { id: 'import-progress', 'aria-live': 'polite' })]),
    h('p', { class: 'privacy-note', text: '本文はブラウザ内だけで処理され、外部へ送信されません。' }),
    submit,
  ]);
  app.replaceChildren(screen);
  textarea.focus();
}

async function documentScreen(documentId) {
  renderHeader();
  const doc = await getDocument(documentId);
  if (!doc) { navigate('#/library'); return; }
  const screen = h('section', { class: 'screen narrow' }, [
    h('p', { class: 'eyebrow', text: 'DOCUMENT' }),
    h('h1', { text: doc.title }),
    h('dl', { class: 'metadata' }, [
      h('div', {}, [h('dt', { text: '形式' }), h('dd', { text: doc.sourceType })]),
      h('div', {}, [h('dt', { text: '文字数' }), h('dd', { text: formatNumber(doc.characterCount) })]),
      h('div', {}, [h('dt', { text: 'チャンク' }), h('dd', { text: formatNumber(doc.chunkCount) })]),
      h('div', {}, [h('dt', { text: '取込み日' }), h('dd', { text: new Date(doc.importedAt).toLocaleString('ja-JP') })]),
    ]),
    h('div', { class: 'button-row' }, [
      button('読む', () => navigate(`#/reader/${doc.id}`), 'button primary'),
      button('原文を見る', () => {
        const dialog = h('dialog', { class: 'source-dialog' }, [
          h('h2', { text: doc.title }), h('pre', { text: doc.sourceText }), button('閉じる', () => dialog.close()),
        ]);
        document.body.append(dialog); dialog.showModal(); dialog.addEventListener('close', () => dialog.remove());
      }),
      button('削除', async () => {
        if (!confirm('この文書を削除しますか？')) return;
        await deleteDocument(doc.id); toast('文書を削除しました。'); navigate('#/library');
      }, 'button danger'),
    ]),
    h('details', { class: 'chunk-inspector' }, [
      h('summary', { text: 'チャンク境界を確認' }),
      h('ol', {}, doc.chunks.slice(0, 500).map((chunk) => h('li', {}, [
        h('span', { text: chunk.text }), h('small', { text: `${chunk.visibleCharacterCount}字・${chunk.pauseClass}` }),
      ]))),
      doc.chunks.length > 500 ? h('p', { class: 'muted', text: '最初の500件を表示しています。' }) : null,
    ]),
  ]);
  app.replaceChildren(screen);
}

function settingsScreen() {
  renderHeader();
  const cpm = h('input', { type: 'number', min: 200, max: 2000, step: 25, value: settings.charactersPerMinute });
  const chunkLength = h('select', {}, [
    h('option', { value: 'short', text: '短め' }), h('option', { value: 'standard', text: '標準' }), h('option', { value: 'long', text: '長め' }),
  ]); chunkLength.value = settings.chunkLength;
  const punctuation = h('select', {}, [
    h('option', { value: 'small', text: '短い' }), h('option', { value: 'standard', text: '標準' }), h('option', { value: 'large', text: '長い' }),
  ]); punctuation.value = settings.punctuationPause;
  const fontScale = h('input', { type: 'range', min: 0.75, max: 1.6, step: 0.05, value: settings.fontScale });
  const theme = h('select', {}, [
    h('option', { value: 'system', text: '端末設定' }), h('option', { value: 'light', text: 'ライト' }), h('option', { value: 'dark', text: 'ダーク' }),
  ]); theme.value = settings.theme;
  const swipe = h('input', { type: 'checkbox' }); swipe.checked = settings.swipeEnabled;
  const save = button('設定を保存', async () => {
    settings = {
      ...settings,
      charactersPerMinute: Math.max(200, Math.min(2000, Number(cpm.value) || 600)),
      chunkLength: chunkLength.value,
      punctuationPause: punctuation.value,
      fontScale: Number(fontScale.value),
      theme: theme.value,
      swipeEnabled: swipe.checked,
    };
    await saveSettings(settings); applyTheme(); toast('設定を保存しました。');
  }, 'button primary');
  app.replaceChildren(h('section', { class: 'screen narrow' }, [
    h('p', { class: 'eyebrow', text: 'SETTINGS' }), h('h1', { text: '設定' }),
    h('label', {}, ['速度（字/分）', cpm]),
    h('label', {}, ['チャンク長', chunkLength]),
    h('label', {}, ['句読点の間', punctuation]),
    h('label', {}, ['文字サイズ', fontScale]),
    h('label', {}, ['テーマ', theme]),
    h('label', { class: 'checkbox-label' }, [swipe, '左右スワイプで文移動']),
    save,
    h('hr'),
    h('h2', { text: 'データ管理' }),
    h('p', { class: 'muted', text: '本文・読書位置・設定は、このブラウザのIndexedDBだけに保存されます。' }),
    button('すべてのデータを削除', async () => {
      if (!confirm('すべての文書・設定・履歴を削除しますか？')) return;
      await clearAllData(); settings = { ...DEFAULT_SETTINGS }; applyTheme(); toast('データを削除しました。'); navigate('#/library');
    }, 'button danger'),
    h('p', { class: 'version', text: `Yomu Pace v${APP_VERSION}` }),
  ]));
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
}

export async function renderRoute() {
  if (readerCleanup) { await readerCleanup(); readerCleanup = null; }
  const raw = location.hash || '#/library';
  const [route, id] = raw.replace(/^#\//u, '').split('/');
  try {
    if (route === 'import') importScreen();
    else if (route === 'reader' && id) readerCleanup = await readerScreen(id, settings);
    else if (route === 'document' && id) await documentScreen(id);
    else if (route === 'settings') settingsScreen();
    else await libraryScreen();
  } catch (error) {
    console.error(error);
    renderHeader();
    app.replaceChildren(h('section', { class: 'screen narrow error-card' }, [
      h('h1', { text: '画面を表示できませんでした' }),
      h('p', { text: error instanceof Error ? error.message : '不明なエラーです。' }),
      button('ライブラリへ', () => navigate('#/library')),
    ]));
  }
  app.focus({ preventScroll: true });
}

export async function initializeApp() {
  settings = await getSettings(DEFAULT_SETTINGS);
  applyTheme();
  window.addEventListener('hashchange', () => void renderRoute());
  await renderRoute();
}
