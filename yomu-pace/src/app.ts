import { importFile, importPaste } from './importers';
import { persistImport, type ImportProgress } from './import-service';
import { flattenChunks, ReaderController, type ReaderSnapshot } from './reader';
import {
  cleanupStagingDocuments,
  clearAllData,
  deleteDocument,
  getChunkPages,
  getDocument,
  getPosition,
  getSections,
  getSettings,
  listDocuments,
  savePosition,
  saveSession,
  saveSettings,
  updateDocument,
} from './storage';
import type {
  DocumentRecord,
  ImportPayload,
  ReaderMode,
  ReaderSettings,
  ReadingChunk,
  ReadingPositionRecord,
  SectionRecord,
} from './types';
import { DEFAULT_SETTINGS } from './types';

const APP_VERSION = '0.1.0';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ja-JP').format(value);
}

function formatDate(value?: string): string {
  if (!value) return '未読';
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function routeParts(): { path: string; params: URLSearchParams } {
  const raw = location.hash.replace(/^#/, '') || '/library';
  const [path = '/library', query = ''] = raw.split('?');
  return { path, params: new URLSearchParams(query) };
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

export class App {
  private readonly root: HTMLElement;
  private settings: ReaderSettings = { ...DEFAULT_SETTINGS };
  private cleanup: (() => void) | undefined;
  private routeSerial = 0;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    await cleanupStagingDocuments();
    this.settings = { ...DEFAULT_SETTINGS, ...(await getSettings()) };
    this.applyVisualSettings();
    window.addEventListener('hashchange', () => void this.route());
    if (!location.hash) location.hash = '#/library';
    await this.route();
  }

  offerUpdate(applyUpdate: () => void): void {
    const toast = element('div', 'toast');
    toast.append('新版を利用できます。読書位置を保存して更新します。 ');
    const button = element('button', 'button primary', '更新');
    button.addEventListener('click', applyUpdate);
    toast.append(button);
    document.body.append(toast);
  }

  private async route(): Promise<void> {
    this.cleanup?.();
    this.cleanup = undefined;
    const serial = ++this.routeSerial;
    const { path, params } = routeParts();
    try {
      if (path === '/library') await this.renderLibrary();
      else if (path === '/import') await this.renderImport();
      else if (path === '/settings') await this.renderSettings();
      else if (path.startsWith('/reader/')) await this.renderReader(decodeURIComponent(path.slice('/reader/'.length)), params);
      else if (path.startsWith('/document/')) await this.renderDocument(decodeURIComponent(path.slice('/document/'.length)));
      else location.hash = '#/library';
    } catch (error) {
      if (serial !== this.routeSerial) return;
      this.renderError(error instanceof Error ? error.message : String(error));
    }
  }

  private shell(): HTMLElement {
    this.root.setAttribute('aria-live', 'polite');
    this.root.innerHTML = '';
    const shell = element('div', 'app-shell');
    const header = element('header', 'topbar');
    const brand = element('a', 'brand');
    brand.href = '#/library';
    brand.append(element('span', 'brand-mark', '読'), element('span', '', 'Yomu Pace'));
    const actions = element('nav', 'topbar-actions');
    const importLink = element('a', 'button');
    importLink.href = '#/import';
    importLink.append(element('span', '', '＋'), element('span', 'button-label', '取り込む'));
    const settingsLink = element('a', 'button icon', '⚙');
    settingsLink.href = '#/settings';
    settingsLink.setAttribute('aria-label', '設定');
    actions.append(importLink, settingsLink);
    header.append(brand, actions);
    const main = element('main', 'main');
    main.id = 'app-main';
    shell.append(header, main);
    this.root.append(shell);
    return main;
  }

  private async renderLibrary(): Promise<void> {
    const main = this.shell();
    const documents = await listDocuments();
    const positions = new Map((await Promise.all(documents.map(async (document) => [document.id, await getPosition(document.id)] as const))));

    const hero = element('section', 'hero');
    const copy = element('div');
    copy.append(element('p', 'eyebrow', 'READ WITH RHYTHM'));
    copy.append(element('h1', '', '文章の流れを、見失わない。'));
    copy.append(element('p', 'lead', '日本語を意味のまとまりで区切り、前後関係を残したまま一定のテンポで読み進めます。文章は端末の外へ送信しません。'));
    const actions = element('div', 'hero-actions');
    const newButton = element('a', 'button primary', '文章を取り込む');
    newButton.href = '#/import';
    actions.append(newButton);
    hero.append(copy, actions);
    main.append(hero);

    const heading = element('div', 'section-heading');
    heading.append(element('h2', '', 'ライブラリ'), element('span', 'muted', `${documents.length}件`));
    main.append(heading);

    if (!documents.length) {
      const empty = element('section', 'empty-state');
      empty.append(element('h2', '', 'まだ文書がありません'));
      empty.append(element('p', 'muted', '文章を貼り付けるか、TXT・Markdown・DRMなしEPUBを選んでください。'));
      const link = element('a', 'button primary', '最初の文書を取り込む');
      link.href = '#/import';
      empty.append(link);
      main.append(empty);
      return;
    }

    const grid = element('section', 'library-grid');
    for (const documentRecord of documents) {
      const position = positions.get(documentRecord.id);
      const card = element('article', 'panel document-card');
      card.append(element('div', 'muted', documentRecord.sourceType.toUpperCase()));
      card.append(element('h3', '', documentRecord.title));
      if (documentRecord.author) card.append(element('p', 'muted', documentRecord.author));
      const progress = Math.round((position?.progress ?? 0) * 100);
      const track = element('div', 'progress-track');
      const bar = element('div', 'progress-bar');
      bar.style.width = `${progress}%`;
      track.append(bar);
      card.append(track);
      const meta = element('div', 'document-meta');
      meta.append(element('span', '', `${progress}%`), element('span', '', `${formatNumber(documentRecord.characterCount)}字`), element('span', '', formatDate(documentRecord.lastOpenedAt)));
      card.append(meta);
      const cardActions = element('div', 'card-actions');
      const read = element('a', 'button primary', progress ? '続きから' : '読む');
      read.href = `#/reader/${encodeURIComponent(documentRecord.id)}`;
      const detail = element('a', 'button', '詳細');
      detail.href = `#/document/${encodeURIComponent(documentRecord.id)}`;
      cardActions.append(read, detail);
      card.append(cardActions);
      grid.append(card);
    }
    main.append(grid);
  }

  private async renderImport(): Promise<void> {
    const main = this.shell();
    main.append(element('p', 'eyebrow', 'IMPORT'));
    main.append(element('h1', '', '文章を取り込む'));
    main.append(element('p', 'lead', '貼り付け、TXT、Markdown、DRMなしEPUBに対応しています。処理はすべてこの端末内で行われます。'));

    const layout = element('div', 'form-layout');
    const panel = element('section', 'panel form-panel');
    const form = element('form');
    const sourceField = element('fieldset', 'field');
    sourceField.append(element('legend', '', '入力方法'));
    const choices = element('div', 'choice-row');
    const pasteChoice = element('label', 'choice');
    const pasteRadio = element('input') as HTMLInputElement;
    pasteRadio.type = 'radio'; pasteRadio.name = 'source'; pasteRadio.value = 'paste'; pasteRadio.checked = true;
    pasteChoice.append(pasteRadio, '文章を貼り付ける');
    const fileChoice = element('label', 'choice');
    const fileRadio = element('input') as HTMLInputElement;
    fileRadio.type = 'radio'; fileRadio.name = 'source'; fileRadio.value = 'file';
    fileChoice.append(fileRadio, 'ファイルを選ぶ');
    choices.append(pasteChoice, fileChoice);
    sourceField.append(choices);

    const titleField = element('div', 'field');
    titleField.append(element('label', '', 'タイトル（省略可）'));
    const titleInput = element('input') as HTMLInputElement;
    titleInput.type = 'text'; titleInput.maxLength = 200;
    titleField.append(titleInput);
    const authorField = element('div', 'field');
    authorField.append(element('label', '', '著者・出典（省略可）'));
    const authorInput = element('input') as HTMLInputElement;
    authorInput.type = 'text'; authorInput.maxLength = 200;
    authorField.append(authorInput);

    const formatField = element('div', 'field');
    formatField.append(element('label', '', '貼り付け形式'));
    const formatSelect = element('select') as HTMLSelectElement;
    formatSelect.append(new Option('プレーンテキスト', 'text'), new Option('Markdown', 'markdown'));
    formatField.append(formatSelect);

    const textField = element('div', 'field');
    textField.append(element('label', '', '本文'));
    const textarea = element('textarea') as HTMLTextAreaElement;
    textarea.placeholder = 'ここに文章を貼り付けてください。';
    textField.append(textarea);

    const fileField = element('div', 'field');
    fileField.hidden = true;
    const drop = element('label', 'file-drop');
    drop.append(element('strong', '', 'TXT・Markdown・EPUBを選択'));
    drop.append(element('span', 'muted', 'TXT/Markdownは10 MB、EPUBは100 MBまで'));
    const fileInput = element('input') as HTMLInputElement;
    fileInput.type = 'file'; fileInput.accept = '.txt,.md,.markdown,.epub,text/plain,text/markdown,application/epub+zip';
    drop.append(fileInput);
    fileField.append(drop);

    const status = element('div', 'status-box');
    status.hidden = true;
    const progress = element('progress') as HTMLProgressElement;
    progress.max = 1; progress.value = 0; progress.style.width = '100%';
    const statusText = element('div', 'muted');
    status.append(progress, statusText);

    const submit = element('button', 'button primary', '取り込む') as HTMLButtonElement;
    submit.type = 'submit';
    const cancel = element('button', 'button', '中止') as HTMLButtonElement;
    cancel.type = 'button'; cancel.hidden = true;
    const actionRow = element('div', 'card-actions');
    actionRow.append(submit, cancel);

    form.append(sourceField, titleField, authorField, formatField, textField, fileField, status, actionRow);
    panel.append(form);
    const help = element('aside', 'panel form-panel');
    help.append(element('h2', '', '取込みのポイント'));
    const helpList = element('ul', 'help-list');
    ['日本語の文節候補と文字数を組み合わせて区切ります。', 'Markdownのコードと表では自動再生を止めます。', 'EPUBの画像・音声・スクリプトは読み込みません。', '固定レイアウト・暗号化本文には対応しません。'].forEach((text) => helpList.append(element('li', '', text)));
    help.append(helpList);
    layout.append(panel, help);
    main.append(layout);

    const toggleSource = (): void => {
      const useFile = fileRadio.checked;
      fileField.hidden = !useFile;
      textField.hidden = useFile;
      formatField.hidden = useFile;
    };
    pasteRadio.addEventListener('change', toggleSource);
    fileRadio.addEventListener('change', toggleSource);

    let abortController: AbortController | undefined;
    cancel.addEventListener('click', () => abortController?.abort());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      abortController = new AbortController();
      submit.disabled = true; cancel.hidden = false; status.hidden = false; status.classList.remove('error-box');
      try {
        let payload: ImportPayload;
        if (fileRadio.checked) {
          const file = fileInput.files?.[0];
          if (!file) throw new Error('ファイルを選択してください。');
          statusText.textContent = 'ファイルを読み込んでいます…';
          payload = await importFile(file);
        } else payload = importPaste(textarea.value, formatSelect.value === 'markdown' ? 'markdown' : 'text', titleInput.value, authorInput.value);
        if (titleInput.value.trim()) payload.title = titleInput.value.trim();
        if (authorInput.value.trim()) payload.author = authorInput.value.trim();
        const documentId = await persistImport(payload, this.settings, (value: ImportProgress) => {
          progress.max = Math.max(1, value.total);
          progress.value = value.completed;
          statusText.textContent = value.message;
        }, abortController.signal);
        location.hash = `#/reader/${encodeURIComponent(documentId)}`;
      } catch (error) {
        status.classList.add('error-box');
        statusText.textContent = error instanceof DOMException && error.name === 'AbortError' ? '取込みを中止しました。' : error instanceof Error ? error.message : String(error);
      } finally {
        submit.disabled = false; cancel.hidden = true; abortController = undefined;
      }
    });
    this.cleanup = () => abortController?.abort();
  }

  private async renderDocument(documentId: string): Promise<void> {
    const main = this.shell();
    const documentRecord = await getDocument(documentId);
    if (!documentRecord || documentRecord.status !== 'ready') throw new Error('文書が見つかりませんでした。');
    const sections = await getSections(documentId);
    const position = await getPosition(documentId);
    main.append(element('p', 'eyebrow', documentRecord.sourceType.toUpperCase()));
    main.append(element('h1', '', documentRecord.title));
    if (documentRecord.author) main.append(element('p', 'lead', documentRecord.author));
    const panel = element('section', 'panel form-panel');
    panel.append(element('p', '', `${formatNumber(documentRecord.characterCount)}字・${formatNumber(documentRecord.chunkCount)}チャンク・${documentRecord.sectionCount}セクション`));
    panel.append(element('p', 'muted', `取込み: ${formatDate(documentRecord.importedAt)} / 最終読書: ${formatDate(documentRecord.lastOpenedAt)}`));
    const actions = element('div', 'card-actions');
    const read = element('a', 'button primary', position ? '続きから読む' : '最初から読む');
    read.href = `#/reader/${encodeURIComponent(documentId)}`;
    const remove = element('button', 'button danger', '削除');
    remove.addEventListener('click', async () => {
      if (!confirm('この文書と読書位置を端末から削除しますか？')) return;
      await deleteDocument(documentId);
      location.hash = '#/library';
    });
    actions.append(read, remove); panel.append(actions); main.append(panel);
    const heading = element('div', 'section-heading'); heading.append(element('h2', '', 'セクション'));
    main.append(heading);
    const grid = element('section', 'library-grid');
    sections.forEach((section, index) => {
      const card = element('article', 'panel document-card');
      card.append(element('div', 'muted', `${index + 1}/${sections.length}`));
      card.append(element('h3', '', section.title ?? `第${index + 1}節`));
      card.append(element('p', 'muted', `${formatNumber(section.characterCount)}字・${formatNumber(section.chunkCount)}チャンク`));
      const link = element('a', 'button', 'ここから読む');
      link.href = `#/reader/${encodeURIComponent(documentId)}?section=${encodeURIComponent(section.id)}`;
      card.append(link); grid.append(card);
    });
    main.append(grid);
  }

  private async renderReader(documentId: string, params: URLSearchParams): Promise<void> {
    this.root.setAttribute('aria-live', 'off');
    this.root.innerHTML = '';
    const [documentRecord, sections, pages, savedPosition] = await Promise.all([
      getDocument(documentId), getSections(documentId), getChunkPages(documentId), getPosition(documentId),
    ]);
    if (!documentRecord || documentRecord.status !== 'ready') throw new Error('文書が見つかりませんでした。');
    const chunks = flattenChunks(sections, pages);
    if (!chunks.length) throw new Error('この文書には表示できるチャンクがありません。');
    const requestedSection = params.get('section');
    let initialIndex = 0;
    if (requestedSection) initialIndex = Math.max(0, chunks.findIndex((chunk) => chunk.sectionId === requestedSection));
    else if (savedPosition) {
      const byId = chunks.findIndex((chunk) => chunk.id === savedPosition.chunkId);
      initialIndex = byId >= 0 ? byId : Math.max(0, chunks.findIndex((chunk) => chunk.documentEnd >= savedPosition.documentOffset));
    }

    await updateDocument(documentId, { lastOpenedAt: new Date().toISOString() });
    const page = element('div', 'reader-page');
    const header = element('header', 'reader-header');
    const back = element('a', 'button icon', '←'); back.href = '#/library'; back.setAttribute('aria-label', 'ライブラリへ戻る');
    const title = element('div', 'reader-title', documentRecord.title);
    const chapter = element('select', 'control-select') as HTMLSelectElement;
    chapter.setAttribute('aria-label', 'セクションを選択');
    sections.forEach((section, index) => chapter.append(new Option(section.title ?? `第${index + 1}節`, section.id)));
    const settingsLink = element('a', 'button icon', '⚙'); settingsLink.href = '#/settings'; settingsLink.setAttribute('aria-label', '設定');
    header.append(back, title, chapter, settingsLink);

    const stage = element('main', 'reader-stage'); stage.id = 'app-main';
    const content = element('div', 'reader-content'); stage.append(content);
    const leftZone = element('button', 'tap-zone left') as HTMLButtonElement; leftZone.setAttribute('aria-label', '前のチャンク');
    const rightZone = element('button', 'tap-zone right') as HTMLButtonElement; rightZone.setAttribute('aria-label', '次のチャンク');
    stage.append(leftZone, rightZone);

    const controls = element('footer', 'reader-controls');
    const primary = element('div', 'primary-controls');
    const previous = element('button', 'button icon', '←') as HTMLButtonElement; previous.setAttribute('aria-label', '前のチャンク');
    const play = element('button', 'button primary play-button', '▶') as HTMLButtonElement; play.setAttribute('aria-label', '再生');
    const next = element('button', 'button icon', '→') as HTMLButtonElement; next.setAttribute('aria-label', '次のチャンク');
    primary.append(previous, play, next);
    const secondary = element('div', 'secondary-controls');
    const mode = element('select', 'control-select') as HTMLSelectElement;
    mode.append(new Option('コンテキスト', 'context'), new Option('ハイライト', 'highlight'), new Option('フォーカス', 'focus'));
    mode.value = this.settings.mode;
    const speed = element('div', 'speed-control');
    const speedLabel = element('span', '', '速度');
    const speedRange = element('input') as HTMLInputElement; speedRange.type = 'range'; speedRange.min = '200'; speedRange.max = '2000'; speedRange.step = '25'; speedRange.value = String(this.settings.charactersPerMinute);
    const speedOutput = element('output', 'range-output', `${this.settings.charactersPerMinute}字/分`);
    speed.append(speedLabel, speedRange, speedOutput);
    const stats = element('div', 'reader-stats');
    const progressText = element('span', '', '0%');
    const counterText = element('span', '', '0/0');
    stats.append(progressText, counterText);
    secondary.append(mode, speed, stats);
    const track = element('div', 'progress-track'); const bar = element('div', 'progress-bar'); track.append(bar);
    controls.append(primary, secondary, track);
    page.append(header, stage, controls); this.root.append(page);

    this.applyReaderVariables(content);
    const chunkIndex = new Map(chunks.map((chunk, index) => [chunk.id, index]));
    let saveTimer: number | undefined;
    let lastSnapshot: ReaderSnapshot | undefined;
    const initialOffset = chunks[initialIndex]?.documentStart ?? 0;

    const saveReaderPosition = (snapshot: ReaderSnapshot, immediate = false): void => {
      const current = snapshot.current;
      if (!current) return;
      const record: ReadingPositionRecord = {
        documentId,
        sectionId: current.sectionId,
        chunkOrderInSection: current.orderInSection,
        chunkId: current.id,
        documentOffset: current.documentStart,
        progress: snapshot.progress,
        mode: this.settings.mode,
        updatedAt: new Date().toISOString(),
      };
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
      if (immediate) void savePosition(record);
      else saveTimer = window.setTimeout(() => void savePosition(record), 700);
    };

    const renderSnapshot = (snapshot: ReaderSnapshot): void => {
      lastSnapshot = snapshot;
      const current = snapshot.current;
      if (!current) return;
      chapter.value = current.sectionId;
      play.textContent = snapshot.state === 'playing' ? 'Ⅱ' : '▶';
      play.setAttribute('aria-label', snapshot.state === 'playing' ? '一時停止' : '再生');
      progressText.textContent = `${Math.round(snapshot.progress * 100)}%`;
      counterText.textContent = `${snapshot.index + 1}/${snapshot.total}`;
      bar.style.width = `${snapshot.progress * 100}%`;
      content.innerHTML = '';

      if (snapshot.state === 'blocked') {
        const card = element('section', 'panel blocked-card');
        card.append(element('h2', '', current.kind === 'table' ? '表' : '固定表示'));
        card.append(element('pre', 'blocked-text', current.text));
        const skip = element('button', 'button primary', '次へ進む');
        skip.addEventListener('click', () => controller.skipBlocked());
        card.append(skip); content.append(card);
      } else if (this.settings.mode === 'focus') {
        const view = element('div', 'focus-view'); view.append(element('div', 'focus-current', current.text)); content.append(view);
      } else if (this.settings.mode === 'highlight') {
        const view = element('div', 'highlight-view');
        const sameBlock = chunks.filter((chunk) => chunk.blockId === current.blockId);
        sameBlock.forEach((chunk) => {
          const span = element('span', 'highlight-chunk', chunk.text);
          const index = chunkIndex.get(chunk.id) ?? 0;
          if (chunk.id === current.id) { span.classList.add('current'); span.setAttribute('aria-current', 'true'); }
          else if (index < snapshot.index) span.classList.add('past');
          view.append(span);
        });
        content.append(view);
        requestAnimationFrame(() => view.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' }));
      } else {
        const view = element('div', 'context-view');
        view.append(element('div', 'context-neighbor', snapshot.previous?.autoPlayable === false ? '' : snapshot.previous?.text ?? ''));
        view.append(element('div', 'context-current', current.text));
        view.append(element('div', 'context-neighbor', snapshot.next?.autoPlayable === false ? '' : snapshot.next?.text ?? ''));
        content.append(view);
      }
      saveReaderPosition(snapshot);
    };

    const controller = new ReaderController(chunks, this.settings, initialIndex, renderSnapshot);
    previous.addEventListener('click', () => controller.previous());
    next.addEventListener('click', () => controller.next());
    leftZone.addEventListener('click', () => controller.previous());
    rightZone.addEventListener('click', () => controller.next());
    play.addEventListener('click', () => controller.toggle());
    stage.addEventListener('click', (event) => { if (event.target === stage || event.target === content) controller.toggle(); });
    chapter.addEventListener('change', () => { location.hash = `#/reader/${encodeURIComponent(documentId)}?section=${encodeURIComponent(chapter.value)}`; });
    mode.addEventListener('change', () => {
      this.settings = { ...this.settings, mode: mode.value as ReaderMode };
      controller.setMode(this.settings.mode); void saveSettings(this.settings);
    });
    speedRange.addEventListener('input', () => {
      const value = Number(speedRange.value);
      speedOutput.textContent = `${value}字/分`;
      this.settings = { ...this.settings, charactersPerMinute: value };
      controller.setRate(value); void saveSettings(this.settings);
    });

    let touchStartX = 0;
    stage.addEventListener('touchstart', (event) => { touchStartX = event.changedTouches[0]?.clientX ?? 0; }, { passive: true });
    stage.addEventListener('touchend', (event) => {
      if (!this.settings.swipeEnabled) return;
      const difference = (event.changedTouches[0]?.clientX ?? 0) - touchStartX;
      if (Math.abs(difference) > 60) controller.goSentence(difference > 0 ? -1 : 1);
    }, { passive: true });

    const keyHandler = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return;
      if (event.code === 'Space') { event.preventDefault(); controller.toggle(); }
      else if (event.key === 'ArrowLeft' && event.shiftKey) { event.preventDefault(); controller.goSentence(-1); }
      else if (event.key === 'ArrowRight' && event.shiftKey) { event.preventDefault(); controller.goSentence(1); }
      else if (event.key === 'ArrowLeft' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); controller.goBlock(-1); }
      else if (event.key === 'ArrowRight' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); controller.goBlock(1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); controller.previous(); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); controller.next(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); speedRange.value = String(Math.min(2000, Number(speedRange.value) + 25)); speedRange.dispatchEvent(new Event('input')); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); speedRange.value = String(Math.max(200, Number(speedRange.value) - 25)); speedRange.dispatchEvent(new Event('input')); }
      else if (event.key.toLowerCase() === 'f') void document.documentElement.requestFullscreen?.();
      else if (event.key === 'Escape' && document.fullscreenElement) void document.exitFullscreen();
    };
    document.addEventListener('keydown', keyHandler);

    this.cleanup = () => {
      document.removeEventListener('keydown', keyHandler);
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
      const snapshot = lastSnapshot ?? controller.snapshot();
      saveReaderPosition(snapshot, true);
      controller.destroy();
      const current = snapshot.current;
      if (current && this.settings.sessionRetention !== 'none') {
        void saveSession({
          id: `session-${crypto.randomUUID()}`,
          documentId,
          startedAt: new Date(Date.now() - snapshot.elapsedMs).toISOString(),
          endedAt: new Date().toISOString(),
          startOffset: initialOffset,
          endOffset: current.documentEnd,
          activeMs: Math.round(snapshot.activeMs),
          elapsedMs: Math.round(snapshot.elapsedMs),
          backwardCount: snapshot.backwardCount,
          pauseCount: snapshot.pauseCount,
        });
      }
    };
  }

  private async renderSettings(): Promise<void> {
    const main = this.shell();
    main.append(element('p', 'eyebrow', 'SETTINGS'), element('h1', '', '読み方を整える'));
    const grid = element('div', 'settings-grid');

    const reading = element('section', 'panel settings-card');
    reading.append(element('h3', '', '読書'));
    const modeField = this.selectField('表示モード', [['コンテキスト', 'context'], ['ハイライト', 'highlight'], ['フォーカス', 'focus']], this.settings.mode, (value) => { this.settings = { ...this.settings, mode: value as ReaderMode }; });
    const lengthField = this.selectField('チャンク長', [['短め', 'short'], ['標準', 'standard'], ['長め', 'long']], this.settings.chunkLength, (value) => { this.settings = { ...this.settings, chunkLength: value as ReaderSettings['chunkLength'] }; });
    const pauseField = this.selectField('句読点の間', [['小さめ', 'small'], ['標準', 'standard'], ['大きめ', 'large']], this.settings.punctuationPause, (value) => { this.settings = { ...this.settings, punctuationPause: value as ReaderSettings['punctuationPause'] }; });
    reading.append(modeField, lengthField, pauseField);

    const appearance = element('section', 'panel settings-card');
    appearance.append(element('h3', '', '表示'));
    appearance.append(this.rangeField('文字サイズ', 20, 64, 1, this.settings.fontSizePx, 'px', (value) => { this.settings = { ...this.settings, fontSizePx: value }; }));
    appearance.append(this.rangeField('行間', 1.2, 2.2, 0.05, this.settings.lineHeight, '', (value) => { this.settings = { ...this.settings, lineHeight: value }; }));
    appearance.append(this.rangeField('表示幅', 24, 70, 1, this.settings.contentWidthCh, '字', (value) => { this.settings = { ...this.settings, contentWidthCh: value }; }));
    appearance.append(this.selectField('テーマ', [['端末設定', 'system'], ['ライト', 'light'], ['ダーク', 'dark']], this.settings.theme, (value) => { this.settings = { ...this.settings, theme: value as ReaderSettings['theme'] }; }));

    const privacy = element('section', 'panel settings-card');
    privacy.append(element('h3', '', '端末内データ'));
    privacy.append(element('p', 'muted', '文書、設定、読書位置はIndexedDBに保存され、外部へ送信されません。'));
    const clear = element('button', 'button danger', 'すべてのデータを削除');
    clear.addEventListener('click', async () => {
      if (!confirm('文書、読書位置、設定をすべて削除しますか？この操作は元に戻せません。')) return;
      await clearAllData(); this.settings = { ...DEFAULT_SETTINGS }; this.applyVisualSettings(); location.hash = '#/library';
    });
    privacy.append(clear, element('p', 'muted', `Yomu Pace v${APP_VERSION}`));
    grid.append(reading, appearance, privacy); main.append(grid);

    const saveAll = (): void => { this.applyVisualSettings(); void saveSettings(this.settings); };
    grid.addEventListener('input', saveAll); grid.addEventListener('change', saveAll);
  }

  private selectField(label: string, options: Array<[string, string]>, current: string, onChange: (value: string) => void): HTMLElement {
    const field = element('div', 'field'); field.append(element('label', '', label));
    const select = element('select') as HTMLSelectElement;
    options.forEach(([text, value]) => select.append(new Option(text, value)));
    select.value = current; select.addEventListener('change', () => onChange(select.value));
    field.append(select); return field;
  }

  private rangeField(label: string, min: number, max: number, step: number, current: number, suffix: string, onChange: (value: number) => void): HTMLElement {
    const field = element('div', 'field');
    const labelRow = element('label'); const output = element('span', 'range-output', `${current}${suffix}`); labelRow.append(label, ' ', output);
    const input = element('input') as HTMLInputElement; input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(current);
    input.addEventListener('input', () => { const value = Number(input.value); output.textContent = `${value}${suffix}`; onChange(value); });
    field.append(labelRow, input); return field;
  }

  private applyVisualSettings(): void {
    if (this.settings.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = this.settings.theme;
  }

  private applyReaderVariables(content: HTMLElement): void {
    content.style.setProperty('--reader-font-size', `${this.settings.fontSizePx}px`);
    content.style.setProperty('--reader-line-height', String(this.settings.lineHeight));
    content.style.setProperty('--content-width', String(this.settings.contentWidthCh));
  }

  private renderError(message: string): void {
    const main = this.shell();
    const panel = element('section', 'empty-state');
    panel.append(element('h1', '', '処理できませんでした'), element('p', 'error-box', message));
    const back = element('a', 'button', 'ライブラリへ戻る'); back.href = '#/library'; panel.append(back); main.append(panel);
  }
}
