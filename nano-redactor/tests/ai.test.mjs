import test from 'node:test';
import assert from 'node:assert/strict';
import { NanoDetector } from '../js/ai.js';

test('download 100% transitions to completion rather than preparing 100%', async () => {
  const original = globalThis.LanguageModel; const phases = []; const monitorTarget = new EventTarget();
  globalThis.LanguageModel = {
    availability: async () => 'downloadable',
    create: async (options) => {
      options.monitor(monitorTarget); const event = new Event('downloadprogress'); Object.defineProperty(event, 'loaded', { value:1 }); monitorTarget.dispatchEvent(event);
      return { clone: async () => ({ prompt: async () => '{"entities":[]}', destroy() {} }), destroy() {} };
    },
  };
  try {
    const detector = new NanoDetector({ onStatus:(status) => phases.push(status) }); await detector.prepare({ knownAvailability:'downloadable' });
    assert.ok(phases.some((x) => x.phase === 'download-complete')); assert.ok(phases.some((x) => x.phase === 'available'));
    assert.equal(phases.some((x) => x.phase === 'downloading' && x.progress >= 1), false); detector.destroy();
  } finally { if (original === undefined) delete globalThis.LanguageModel; else globalThis.LanguageModel = original; }
});
