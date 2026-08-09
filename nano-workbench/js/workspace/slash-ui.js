import { slashMatches } from '../harness/slash-commands.js';
import { $, ws, escapeHtml, setInspectorTab, record } from './state.js';
import { interceptSend } from './harness-ui.js';

function renderSlashPopup() {
  const popup = $('#slash-popup');
  if (!popup) return;
  if (!ws.slashMatches.length) { popup.hidden = true; popup.innerHTML = ''; return; }
  popup.hidden = false;
  popup.innerHTML = ws.slashMatches.map((c, i) => `<button type="button" data-slash="${c.command}" class="${i === ws.slashIndex ? 'active' : ''}"><code>${c.command}</code><span>${escapeHtml(c.label)}</span></button>`).join('');
}

export async function executeSlash(command) {
  const input = $('#composer-input');
  if (input) input.value = '';
  ws.slashMatches = [];
  renderSlashPopup();
  await record('slash_command', { command });
  if (command === '/new') $('#new-chat')?.click();
  else if (command === '/project') $('#project-list .project-row')?.focus();
  else if (command === '/memory') setInspectorTab('memory');
  else if (command === '/skill') $('#skill-select')?.focus();
  else if (command === '/style') $('#style-select')?.focus();
  else if (command === '/context') setInspectorTab('context');
  else if (command === '/compact') $('#compact-button')?.click();
  else if (command === '/export') $('#export-conversation')?.click();
}

function handleSlashInput() {
  ws.slashMatches = slashMatches($('#composer-input')?.value || '');
  ws.slashIndex = 0;
  renderSlashPopup();
}

export function registerSlashEvents() {
  $('#composer-input')?.addEventListener('keydown', async (e) => {
    if (!$('#slash-popup')?.hidden) {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); ws.slashIndex = (ws.slashIndex + 1) % ws.slashMatches.length; renderSlashPopup(); return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault(); ws.slashIndex = (ws.slashIndex - 1 + ws.slashMatches.length) % ws.slashMatches.length; renderSlashPopup(); return;
      }
      if (e.key === 'Escape') {
        e.preventDefault(); ws.slashMatches = []; renderSlashPopup(); return;
      }
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const command = ws.slashMatches[ws.slashIndex];
        if (command) await executeSlash(command.command);
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) await interceptSend(e);
  }, true);
  $('#composer-input')?.addEventListener('input', handleSlashInput);
  $('#slash-popup')?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-slash]');
    if (button) executeSlash(button.dataset.slash);
  });
}
