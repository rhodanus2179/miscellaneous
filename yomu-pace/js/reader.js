import { durationForChunk } from './chunking.js';
import { getDocument, getPosition, saveDocument, savePosition, saveSession, saveSettings } from './storage.js';
import { app, h, button, navigate, toast, renderHeader, setBusy } from './ui.js';

function pauseScale(value) {
  return value === 'small' ? 0.6 : value === 'large' ? 1.5 : 1;
}

export async function readerScreen(documentId, settings) {
  renderHeader('Yomu Pace', true);
  setBusy('文書を開いています…');
  const doc = await getDocument(documentId);
  if (!doc) {
    toast('文書が見つかりませんでした。');
    navigate('#/library');
    return;
  }
  const storedPosition = await getPosition(documentId);
  let index = Math.min(storedPosition?.chunkIndex ?? 0, Math.max(0, doc.chunks.length - 1));
  let playing = false;
  let timer = null;
  let sessionStartedAt = Date.now();
  let activeMs = 0;
  let lastPlayStarted = null;
  let rewinds = 0;
  let pauses = 0;
  let touchStartX = null;
  let touchStartAt = 0;

  const screen = h('section', { class: 'reader-screen' });
  const stage = h('div', { class: 'reader-stage', tabindex: '0', 'aria-label': '読書領域' });
  const status = h('div', { class: 'reader-status' });
  const controls = h('div', { class: 'reader-controls' });
  const modeSelect = h('select', { 'aria-label': '表示モード' }, [
    h('option', { value: 'context', text: 'コンテキスト' }),
    h('option', { value: 'highlight', text: 'ハイライト' }),
    h('option', { value: 'focus', text: 'フォーカス' }),
  ]);
  modeSelect.value = settings.mode;
  const speed = h('input', { type: 'range', min: 200, max: 2000, step: 25, value: settings.charactersPerMinute, 'aria-label': '文字毎分' });
  const speedLabel = h('output', { text: `${settings.charactersPerMinute}字/分` });
  const playButton = button('▶ 再生', () => toggle(), 'button primary reader-play');

  function currentChunk() { return doc.chunks[index]; }
  function blockChunks(chunk) { return doc.chunks.filter((item) => item.blockId === chunk.blockId); }
  function setPlaying(value) {
    if (playing === value) return;
    playing = value;
    if (playing) lastPlayStarted = performance.now();
    else if (lastPlayStarted !== null) {
      activeMs += performance.now() - lastPlayStarted;
      lastPlayStarted = null;
      pauses += 1;
    }
    playButton.textContent = playing ? 'Ⅱ 一時停止' : '▶ 再生';
    clearTimeout(timer);
    if (playing) schedule();
  }
  function schedule() {
    clearTimeout(timer);
    const chunk = currentChunk();
    if (!chunk || !chunk.autoPlayable) {
      setPlaying(false);
      return;
    }
    const delay = durationForChunk(chunk, Number(speed.value), pauseScale(settings.punctuationPause));
    timer = setTimeout(() => {
      if (index >= doc.chunks.length - 1) {
        setPlaying(false);
        render();
        toast('最後まで読みました。');
        return;
      }
      index += 1;
      render();
      save(false);
      schedule();
    }, delay);
  }
  function toggle() { setPlaying(!playing); }
  function move(delta) {
    if (delta < 0) rewinds += 1;
    index = Math.max(0, Math.min(doc.chunks.length - 1, index + delta));
    render();
    save(false);
    if (playing) schedule();
  }
  function moveBy(groupKey, direction) {
    const current = currentChunk();
    if (!current) return;
    const currentValue = current[groupKey];
    let target = index + direction;
    while (target >= 0 && target < doc.chunks.length && doc.chunks[target]?.[groupKey] === currentValue) target += direction;
    index = Math.max(0, Math.min(doc.chunks.length - 1, target));
    if (direction < 0) rewinds += 1;
    render(); save(false); if (playing) schedule();
  }
  let saveTimer;
  function save(immediate = false) {
    clearTimeout(saveTimer);
    const perform = async () => {
      const progress = doc.chunks.length <= 1 ? (index > 0 ? 1 : 0) : index / (doc.chunks.length - 1);
      const updatedAt = new Date().toISOString();
      await savePosition({ documentId, chunkIndex: index, chunkId: currentChunk()?.id, progress, mode: settings.mode, updatedAt });
      doc.progress = progress;
      doc.lastOpenedAt = updatedAt;
      doc.updatedAt = updatedAt;
      await saveDocument(doc);
    };
    if (immediate) return perform();
    saveTimer = setTimeout(() => void perform(), 500);
    return Promise.resolve();
  }
  function render() {
    const chunk = currentChunk();
    if (!chunk) return;
    stage.className = `reader-stage mode-${settings.mode}`;
    stage.replaceChildren();
    if (settings.mode === 'context') {
      stage.append(
        h('div', { class: 'context-side previous', text: doc.chunks[index - 1]?.text ?? '' }),
        h('div', { class: 'context-current', text: chunk.text }),
        h('div', { class: 'context-side next', text: doc.chunks[index + 1]?.text ?? '' }),
      );
    } else if (settings.mode === 'highlight') {
      const paragraph = h('div', { class: 'highlight-paragraph' });
      for (const item of blockChunks(chunk)) {
        paragraph.append(h('span', { class: item.id === chunk.id ? 'active-chunk' : '', text: item.text, 'aria-current': item.id === chunk.id ? 'true' : undefined }));
      }
      stage.append(paragraph);
      requestAnimationFrame(() => paragraph.querySelector('.active-chunk')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    } else {
      stage.append(h('div', { class: 'focus-current', text: chunk.text }));
    }
    if (!chunk.autoPlayable) stage.append(h('p', { class: 'non-prose-note', text: 'コード・表などの非散文ブロックです。内容を確認して「次へ」を押してください。' }));
    const percentage = Math.round((index + 1) / doc.chunks.length * 100);
    status.replaceChildren(
      h('span', { text: `${index + 1} / ${doc.chunks.length}` }),
      h('span', { text: `${percentage}%` }),
      h('span', { text: speedLabel.textContent }),
    );
    document.documentElement.style.setProperty('--reader-scale', settings.fontScale);
  }

  modeSelect.addEventListener('change', async () => {
    settings.mode = modeSelect.value;
    await saveSettings(settings);
    render(); save(true);
  });
  speed.addEventListener('input', async () => {
    settings.charactersPerMinute = Number(speed.value);
    speedLabel.textContent = `${settings.charactersPerMinute}字/分`;
    await saveSettings(settings);
    render();
    if (playing) schedule();
  });
  controls.append(
    button('←', () => move(-1), 'button icon-button'),
    playButton,
    button('→', () => move(1), 'button icon-button'),
    modeSelect,
    h('label', { class: 'speed-control' }, [speed, speedLabel]),
    button('文書情報', () => navigate(`#/document/${documentId}`), 'button'),
  );
  screen.append(h('div', { class: 'reader-title', text: doc.title }), stage, status, controls);
  app.replaceChildren(screen);
  render();
  save(true);

  const keyHandler = (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.code === 'Space') { event.preventDefault(); toggle(); }
    else if (event.key === 'ArrowLeft' && event.shiftKey) moveBy('sentenceId', -1);
    else if (event.key === 'ArrowRight' && event.shiftKey) moveBy('sentenceId', 1);
    else if (event.key === 'ArrowLeft') move(-1);
    else if (event.key === 'ArrowRight') move(1);
    else if (event.key === 'ArrowUp') { speed.value = String(Math.min(2000, Number(speed.value) + 25)); speed.dispatchEvent(new Event('input')); }
    else if (event.key === 'ArrowDown') { speed.value = String(Math.max(200, Number(speed.value) - 25)); speed.dispatchEvent(new Event('input')); }
  };
  const visibilityHandler = () => { if (document.hidden) setPlaying(false); save(true); };
  const pointerDown = (event) => { touchStartX = event.clientX; touchStartAt = performance.now(); };
  const pointerUp = (event) => {
    if (touchStartX === null) return;
    const delta = event.clientX - touchStartX;
    const elapsed = performance.now() - touchStartAt;
    touchStartX = null;
    if (settings.swipeEnabled && Math.abs(delta) > 70) {
      moveBy('sentenceId', delta > 0 ? -1 : 1);
      return;
    }
    if (Math.abs(delta) < 12 && elapsed < 650) {
      const rect = stage.getBoundingClientRect();
      const position = (event.clientX - rect.left) / Math.max(1, rect.width);
      if (position < 0.3) move(-1);
      else if (position > 0.7) move(1);
      else toggle();
    }
  };
  document.addEventListener('keydown', keyHandler);
  document.addEventListener('visibilitychange', visibilityHandler);
  stage.addEventListener('pointerdown', pointerDown);
  stage.addEventListener('pointerup', pointerUp);
  return async () => {
    setPlaying(false); await save(true);
    document.removeEventListener('keydown', keyHandler);
    document.removeEventListener('visibilitychange', visibilityHandler);
    stage.removeEventListener('pointerdown', pointerDown);
    stage.removeEventListener('pointerup', pointerUp);
    const endedAt = Date.now();
    await saveSession({
      id: crypto.randomUUID(), documentId, startedAt: new Date(sessionStartedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
      activeMs: Math.round(activeMs), elapsedMs: endedAt - sessionStartedAt, startChunk: storedPosition?.chunkIndex ?? 0, endChunk: index,
      rewinds, pauses, mode: settings.mode,
    });
  };
}
