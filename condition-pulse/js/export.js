import { DOMAIN_LABELS } from './config.js';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJson({ sessions, settings, appVersion, questionBankVersion }) {
  const payload = {
    exportedAt: new Date().toISOString(),
    appVersion,
    questionBankVersion,
    settings,
    sessions
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `condition-pulse-${new Date().toISOString().slice(0, 10)}.json`);
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportCsv({ sessions, questionMap }) {
  const rows = [['session_id', 'local_date', 'time_band', 'session_type', 'completed_at', 'domain', 'domain_label', 'question_id', 'selected_index', 'normalized_value', 'response_time_ms', 'context_tag']];
  for (const session of sessions) {
    for (const response of session.responses ?? []) {
      const question = questionMap.get(response.questionId);
      rows.push([
        session.id, session.localDate, session.timeBand, session.sessionType, session.completedAt,
        question?.domain ?? '', DOMAIN_LABELS[question?.domain] ?? '', response.questionId,
        response.selectedIndex, response.normalizedValue, response.responseTimeMs, session.contextTag ?? ''
      ]);
    }
  }
  const csv = '\uFEFF' + rows.map(row => row.map(csvEscape).join(',')).join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `condition-pulse-${new Date().toISOString().slice(0, 10)}.csv`);
}
