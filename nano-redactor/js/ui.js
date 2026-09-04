export function createUi() {
  const refs = {
    modelDot: document.querySelector('[data-model-dot]'), modelStatus: document.querySelector('[data-model-status]'), privacyNote: document.querySelector('[data-privacy-note]'),
    input: document.querySelector('#sourceText'), output: document.querySelector('#resultText'), mode: document.querySelector('#modeSelect'), style: document.querySelector('#styleSelect'),
    start: document.querySelector('#startButton'), stop: document.querySelector('#stopButton'), clear: document.querySelector('#clearButton'), copy: document.querySelector('#copyButton'),
    progressWrap: document.querySelector('[data-progress-wrap]'), progressBar: document.querySelector('[data-progress-bar]'), progressText: document.querySelector('[data-progress-text]'),
    summary: document.querySelector('[data-summary]'), warning: document.querySelector('[data-warning]'),
  };
  function setModelStatus(text, tone = 'neutral') { refs.modelStatus.textContent = text; refs.modelDot.dataset.tone = tone; }
  function setBusy(busy) { refs.input.disabled = busy; refs.mode.disabled = busy; refs.style.disabled = busy; refs.start.hidden = busy; refs.stop.hidden = !busy; refs.clear.disabled = busy; }
  function setProgress(done, total) {
    const ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
    refs.progressWrap.hidden = false; refs.progressBar.style.width = `${Math.round(ratio * 100)}%`;
    refs.progressText.textContent = total > 0 ? `処理 ${done} / ${total} · ${Math.round(ratio * 100)}%` : '準備中';
  }
  function hideProgress() { refs.progressWrap.hidden = true; refs.progressBar.style.width = '0%'; refs.progressText.textContent = ''; }
  function setSummary(maskedCount, warningCount, extra = '') { const base = `${maskedCount}件マスク / ${warningCount}件要確認`; refs.summary.textContent = extra ? `${base} · ${extra}` : base; }
  function setWarning(text = '') { refs.warning.textContent = text; refs.warning.hidden = !text; }
  function clearAll() { refs.input.value = ''; refs.output.value = ''; refs.summary.textContent = '0件マスク / 0件要確認'; setWarning(''); hideProgress(); refs.input.focus(); }
  async function copyOutput() { const text = refs.output.value; if (!text) return false; await navigator.clipboard.writeText(text); return true; }
  return { refs, setModelStatus, setBusy, setProgress, hideProgress, setSummary, setWarning, clearAll, copyOutput };
}
