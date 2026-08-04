import { durationForChunk } from './chunking';
import type {
  ChunkPageRecord,
  ReaderMode,
  ReaderSettings,
  ReadingChunk,
  SectionRecord,
} from './types';

export type ReaderState = 'paused' | 'playing' | 'blocked' | 'completed' | 'error';

export interface ReaderSnapshot {
  state: ReaderState;
  index: number;
  total: number;
  progress: number;
  current?: ReadingChunk;
  previous?: ReadingChunk;
  next?: ReadingChunk;
  activeMs: number;
  elapsedMs: number;
  backwardCount: number;
  pauseCount: number;
}

export function flattenChunks(sections: SectionRecord[], pages: ChunkPageRecord[]): ReadingChunk[] {
  const sectionOrder = new Map(sections.map((section) => [section.id, section.order]));
  return pages
    .flatMap((page) => page.chunks)
    .sort((a, b) => {
      const sectionDifference = (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0);
      return sectionDifference || a.orderInSection - b.orderInSection;
    });
}

function pauseScale(settings: ReaderSettings): number {
  if (settings.punctuationPause === 'small') return 0.6;
  if (settings.punctuationPause === 'large') return 1.5;
  return 1;
}

export class ReaderController {
  private readonly chunks: ReadingChunk[];
  private readonly onChange: (snapshot: ReaderSnapshot) => void;
  private index: number;
  private state: ReaderState = 'paused';
  private settings: ReaderSettings;
  private timer: number | undefined;
  private deadline = 0;
  private startedAt = performance.now();
  private activeStartedAt: number | undefined;
  private accumulatedActiveMs = 0;
  private backwardCount = 0;
  private pauseCount = 0;

  constructor(chunks: ReadingChunk[], settings: ReaderSettings, initialIndex: number, onChange: (snapshot: ReaderSnapshot) => void) {
    this.chunks = chunks;
    this.settings = settings;
    this.index = Math.max(0, Math.min(initialIndex, Math.max(0, chunks.length - 1)));
    this.onChange = onChange;
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.emit();
  }

  get currentIndex(): number { return this.index; }
  get currentChunk(): ReadingChunk | undefined { return this.chunks[this.index]; }
  get currentState(): ReaderState { return this.state; }

  play(): void {
    const current = this.currentChunk;
    if (!current || this.state === 'completed') return;
    if (!current.autoPlayable) {
      this.state = 'blocked';
      this.emit();
      return;
    }
    if (this.state === 'playing') return;
    this.state = 'playing';
    this.activeStartedAt = performance.now();
    this.scheduleCurrent();
    this.emit();
  }

  pause(count = true): void {
    if (this.state === 'playing') {
      this.commitActiveTime();
      if (count) this.pauseCount += 1;
    }
    this.clearTimer();
    if (this.state !== 'completed') this.state = this.currentChunk?.autoPlayable === false ? 'blocked' : 'paused';
    this.emit();
  }

  toggle(): void {
    if (this.state === 'playing') this.pause();
    else this.play();
  }

  next(): void {
    this.moveTo(this.index + 1, false);
  }

  previous(): void {
    this.moveTo(this.index - 1, true);
  }

  skipBlocked(): void {
    if (this.state !== 'blocked') return;
    this.moveTo(this.index + 1, false);
  }

  goSentence(direction: -1 | 1): void {
    const current = this.currentChunk;
    if (!current) return;
    let target = this.index + direction;
    while (target >= 0 && target < this.chunks.length && this.chunks[target]?.sentenceId === current.sentenceId) target += direction;
    this.moveTo(target, direction < 0);
  }

  goBlock(direction: -1 | 1): void {
    const current = this.currentChunk;
    if (!current) return;
    let target = this.index + direction;
    while (target >= 0 && target < this.chunks.length && this.chunks[target]?.blockId === current.blockId) target += direction;
    this.moveTo(target, direction < 0);
  }

  setRate(charactersPerMinute: number): void {
    this.settings = { ...this.settings, charactersPerMinute };
    this.emit();
  }

  setMode(mode: ReaderMode): void {
    this.settings = { ...this.settings, mode };
    this.emit();
  }

  setSettings(settings: ReaderSettings): void {
    this.settings = settings;
    this.emit();
  }

  destroy(): void {
    this.commitActiveTime();
    this.clearTimer();
    document.removeEventListener('visibilitychange', this.handleVisibility);
  }

  snapshot(): ReaderSnapshot {
    const activeMs = this.accumulatedActiveMs + (this.activeStartedAt === undefined ? 0 : performance.now() - this.activeStartedAt);
    const snapshot: ReaderSnapshot = {
      state: this.state,
      index: this.index,
      total: this.chunks.length,
      progress: this.chunks.length ? (this.index + 1) / this.chunks.length : 0,
      activeMs,
      elapsedMs: performance.now() - this.startedAt,
      backwardCount: this.backwardCount,
      pauseCount: this.pauseCount,
    };
    const current = this.chunks[this.index];
    const previous = this.chunks[this.index - 1];
    const next = this.chunks[this.index + 1];
    if (current) snapshot.current = current;
    if (previous) snapshot.previous = previous;
    if (next) snapshot.next = next;
    return snapshot;
  }

  private moveTo(target: number, backward: boolean): void {
    const wasPlaying = this.state === 'playing';
    this.commitActiveTime();
    this.clearTimer();
    if (backward) this.backwardCount += 1;
    if (target < 0) target = 0;
    if (target >= this.chunks.length) {
      this.index = Math.max(0, this.chunks.length - 1);
      this.state = 'completed';
      this.emit();
      return;
    }
    this.index = target;
    const current = this.currentChunk;
    if (!current?.autoPlayable) this.state = 'blocked';
    else this.state = wasPlaying ? 'playing' : 'paused';
    if (this.state === 'playing') {
      this.activeStartedAt = performance.now();
      this.scheduleCurrent();
    }
    this.emit();
  }

  private scheduleCurrent(): void {
    const current = this.currentChunk;
    if (!current || !current.autoPlayable) {
      this.state = 'blocked';
      this.emit();
      return;
    }
    const delay = durationForChunk(current, this.settings.charactersPerMinute, pauseScale(this.settings));
    this.deadline = performance.now() + delay;
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      const remaining = this.deadline - performance.now();
      if (remaining > 20) {
        this.timer = window.setTimeout(() => this.advanceFromTimer(), remaining);
      } else this.advanceFromTimer();
    }, delay);
  }

  private advanceFromTimer(): void {
    if (this.state !== 'playing') return;
    this.moveTo(this.index + 1, false);
  }

  private commitActiveTime(): void {
    if (this.activeStartedAt !== undefined) {
      this.accumulatedActiveMs += performance.now() - this.activeStartedAt;
      this.activeStartedAt = undefined;
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private emit(): void {
    this.onChange(this.snapshot());
  }

  private readonly handleVisibility = (): void => {
    if (document.hidden && this.state === 'playing') this.pause(false);
  };
}
