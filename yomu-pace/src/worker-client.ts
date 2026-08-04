import { processSection } from './chunking';
import type { WorkerSectionInput, WorkerSectionResult } from './types';

interface PendingJob {
  resolve: (result: WorkerSectionResult) => void;
  reject: (error: Error) => void;
}

let worker: Worker | undefined;
const pending = new Map<string, PendingJob>();

function getWorker(): Worker | undefined {
  if (typeof Worker !== 'function') return undefined;
  if (worker) return worker;
  worker = new Worker(new URL('./document-worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as { type: string; jobId: string; result?: WorkerSectionResult; error?: string };
    const job = pending.get(message.jobId);
    if (!job) return;
    pending.delete(message.jobId);
    if (message.type === 'section-result' && message.result) job.resolve(message.result);
    else if (message.type === 'cancelled') job.reject(new DOMException('処理を中止しました。', 'AbortError'));
    else job.reject(new Error(message.error ?? '文書処理に失敗しました。'));
  });
  worker.addEventListener('error', (event) => {
    for (const job of pending.values()) job.reject(new Error(event.message || 'Workerでエラーが発生しました。'));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  });
  return worker;
}

export async function processSectionInWorker(input: WorkerSectionInput, signal?: AbortSignal): Promise<WorkerSectionResult> {
  const currentWorker = getWorker();
  if (!currentWorker) return processSection(input);

  const jobId = crypto.randomUUID();
  return new Promise<WorkerSectionResult>((resolve, reject) => {
    const abort = (): void => {
      currentWorker.postMessage({ type: 'cancel', jobId });
      pending.delete(jobId);
      reject(new DOMException('処理を中止しました。', 'AbortError'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    pending.set(jobId, {
      resolve: (result) => {
        signal?.removeEventListener('abort', abort);
        resolve(result);
      },
      reject: (error) => {
        signal?.removeEventListener('abort', abort);
        reject(error);
      },
    });
    currentWorker.postMessage({ type: 'process-section', jobId, input });
  });
}
