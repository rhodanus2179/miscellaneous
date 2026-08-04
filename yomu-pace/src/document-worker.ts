/// <reference lib="webworker" />

import { processSection } from './chunking';
import type { WorkerSectionInput } from './types';

interface ProcessMessage {
  type: 'process-section';
  jobId: string;
  input: WorkerSectionInput;
}

interface CancelMessage {
  type: 'cancel';
  jobId: string;
}

type IncomingMessage = ProcessMessage | CancelMessage;

const cancelled = new Set<string>();

self.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled.add(message.jobId);
    return;
  }

  try {
    if (cancelled.has(message.jobId)) {
      self.postMessage({ type: 'cancelled', jobId: message.jobId });
      return;
    }
    const result = processSection(message.input);
    if (cancelled.has(message.jobId)) {
      self.postMessage({ type: 'cancelled', jobId: message.jobId });
      return;
    }
    self.postMessage({ type: 'section-result', jobId: message.jobId, result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      jobId: message.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cancelled.delete(message.jobId);
  }
});
