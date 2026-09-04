import { NanoDetector, NanoError } from './ai.js';
import { createChunks } from './chunker.js';
import { extractRuleCandidates, ruleCandidatesToSpans } from './rules.js';
import { mergeSpans, resolveEntitySpans } from './spans.js';
import { createMaskState, redactText } from './redactor.js';
import { createUi } from './ui.js';

const ui = createUi();
let activeController = null;
let lastAvailability = 'unknown';

const detector = new NanoDetector({
  onStatus: ({ phase, progress }) => {
    if (phase === 'downloadable') ui.setModelStatus('Gemini Nanoを準備できます', 'warn');
    else if (phase === 'downloading') { const pct = Math.round(Math.max(0, Math.min(1, Number(progress || 0))) * 100); ui.setModelStatus(`モデルを準備中… ${pct}%`, 'warn'); }
    else if (phase === 'download-complete') ui.setModelStatus('モデル準備完了', 'good');
    else if (phase === 'available') { ui.setModelStatus('Gemini Nano 使用可能', 'good'); lastAvailability = 'available'; }
  },
});

async function refreshAvailability() {
  try {
    lastAvailability = await detector.availability();
    if (lastAvailability === 'unsupported') { ui.setModelStatus('このChromeでは端末内AIを利用できません', 'bad'); ui.refs.privacyNote.textContent = 'AIによる文脈判定は利用できません。形式ベース検出のみ利用できます。'; }
    else if (lastAvailability === 'unavailable') { ui.setModelStatus('Gemini Nanoをこの端末で利用できません', 'bad'); ui.refs.privacyNote.textContent = 'AIによる文脈判定は利用できません。形式ベース検出のみ利用できます。'; }
    else if (lastAvailability === 'downloadable') ui.setModelStatus('Gemini Nanoを準備できます', 'warn');
    else if (lastAvailability === 'downloading') ui.setModelStatus('Gemini Nanoを準備中', 'warn');
    else if (lastAvailability === 'available') ui.setModelStatus('Gemini Nano 使用可能', 'good');
    else ui.setModelStatus('端末内AIの状態を確認できません', 'warn');
  } catch { lastAvailability = 'unavailable'; ui.setModelStatus('端末内AIの状態確認に失敗しました', 'bad'); ui.refs.privacyNote.textContent = '形式ベース検出のみ利用できます。'; }
}

function abortError() { return new DOMException('Aborted', 'AbortError'); }
function countWarnings(warnings) { return Array.isArray(warnings) ? warnings.length : 0; }

async function runMasking() {
  const source = ui.refs.input.value;
  if (!source.length) { ui.setWarning('マスクする文章を貼り付けてください。'); ui.refs.input.focus(); return; }
  const mode = ui.refs.mode.value; const style = ui.refs.style.value; const chunks = createChunks(source); const maskState = createMaskState();
  let allSpans = []; const warnings = []; let aiAvailable = !['unsupported', 'unavailable'].includes(lastAvailability); let fallbackUsed = !aiAvailable;
  activeController = new AbortController(); const { signal } = activeController;
  ui.setBusy(true); ui.setWarning(''); ui.refs.output.value = source; ui.setSummary(0, 0); ui.setProgress(0, chunks.length);
  try {
    if (aiAvailable) {
      try { await detector.prepare({ signal, knownAvailability: lastAvailability }); }
      catch (error) { if (error?.code === 'PROMPT_ABORTED' || error?.name === 'AbortError') throw error; aiAvailable = false; fallbackUsed = true; warnings.push({ code: error?.code || 'MODEL_UNAVAILABLE' }); ui.setModelStatus('端末内AIを利用できません · 形式ベースで続行', 'warn'); }
    }
    for (let i = 0; i < chunks.length; i += 1) {
      if (signal.aborted) throw abortError();
      const chunk = chunks[i]; const chunkText = source.slice(chunk.start, chunk.end); const ruleCandidates = extractRuleCandidates(chunkText);
      let chunkSpans = ruleCandidatesToSpans(ruleCandidates, chunk.start, { mode, aiAvailable });
      if (aiAvailable) {
        try { const result = await detector.detect(chunkText, ruleCandidates, mode, { signal }); const resolved = resolveEntitySpans(chunkText, result.entities, chunk.start); chunkSpans.push(...resolved.spans); warnings.push(...resolved.warnings); }
        catch (error) { if (error?.code === 'PROMPT_ABORTED' || error?.name === 'AbortError') throw error; warnings.push({ code: error?.code || 'MODEL_UNAVAILABLE' }); chunkSpans = ruleCandidatesToSpans(ruleCandidates, chunk.start, { mode, aiAvailable: false }); fallbackUsed = true; }
      }
      const merged = mergeSpans([...allSpans, ...chunkSpans], source.length); allSpans = merged.spans; warnings.push(...merged.warnings);
      const preview = redactText(source, allSpans, { style, state: maskState }); ui.refs.output.value = preview.text;
      ui.setProgress(i + 1, chunks.length); ui.setSummary(allSpans.length, countWarnings(warnings), fallbackUsed ? '一部形式ベース' : '');
    }
    ui.setModelStatus('マスキング完了', 'good');
    ui.setWarning(fallbackUsed ? '一部または全部を形式ベースで処理しました。自動検出には見落としの可能性があります。外部共有前に結果を確認してください。' : '自動検出には見落としの可能性があります。外部共有前に結果を確認してください。');
  } catch (error) {
    const aborted = signal.aborted || error?.name === 'AbortError' || error?.code === 'PROMPT_ABORTED';
    if (aborted) { ui.setModelStatus('処理を停止しました', 'warn'); ui.setWarning('停止時点までに確定したマスク結果を残しています。'); }
    else { const code = error instanceof NanoError ? error.code : 'UNKNOWN'; warnings.push({ code }); ui.setModelStatus('処理中にエラーが発生しました', 'bad'); ui.setWarning('確定済みの結果は残しています。原文の未確定部分は変更していません。'); }
    ui.setSummary(allSpans.length, countWarnings(warnings), fallbackUsed ? '一部形式ベース' : '');
  } finally { activeController = null; ui.setBusy(false); }
}

ui.refs.start.addEventListener('click', runMasking);
ui.refs.stop.addEventListener('click', () => activeController?.abort());
ui.refs.clear.addEventListener('click', () => ui.clearAll());
ui.refs.copy.addEventListener('click', async () => {
  const original = ui.refs.copy.textContent;
  try { const copied = await ui.copyOutput(); if (!copied) return; ui.refs.copy.textContent = 'コピーしました'; }
  catch { ui.setWarning('クリップボードへコピーできませんでした。結果欄から手動でコピーしてください。'); }
  finally { setTimeout(() => { ui.refs.copy.textContent = original; }, 1200); }
});
window.addEventListener('beforeunload', () => detector.destroy());
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
refreshAvailability();
