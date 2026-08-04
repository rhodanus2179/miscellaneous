import { describe, expect, it } from 'vitest';
import { durationForChunk, processSection, protectedRanges } from '../src/chunking';
import type { TextBlock, WorkerSectionInput } from '../src/types';

function input(text: string): WorkerSectionInput {
  const block: TextBlock = {
    id: 'block-1',
    sectionId: 'section-1',
    order: 0,
    kind: 'paragraph',
    text,
    sourceStart: 0,
    sourceEnd: text.length,
    autoPlayable: true,
  };
  return {
    documentId: 'document-1',
    sectionId: 'section-1',
    documentStart: 0,
    sourceText: text,
    blocks: [block],
    preset: 'standard',
  };
}

describe('日本語チャンク生成', () => {
  it('チャンクを連結すると原文に戻る', () => {
    const source = '循環型社会の形成に向けて、市町村による分別収集をさらに促進する必要がある。';
    const result = processSection(input(source));
    expect(result.chunks.map((chunk) => chunk.text).join('')).toBe(source);
  });

  it('句読点だけのチャンクを作らない', () => {
    const result = processSection(input('これは最初の文です。次に、二つ目の文を読みます。'));
    expect(result.chunks.every((chunk) => !/^[、。，．！？!?]+$/u.test(chunk.text))).toBe(true);
  });

  it('URLを途中で分割しない', () => {
    const url = 'https://example.com/path?q=123';
    const result = processSection(input(`詳しくは${url}を確認してください。`));
    expect(result.chunks.some((chunk) => chunk.text.includes(url))).toBe(true);
  });

  it('数値と単位を保護する', () => {
    const source = '処理能力は20m³で、年間95％の稼働率を想定する。';
    const ranges = protectedRanges(source).map((range) => source.slice(range.start, range.end));
    expect(ranges).toContain('20m³');
    expect(ranges).toContain('95％');
  });

  it('同じ入力から同じチャンクIDを生成する', () => {
    const source = '同じ文章は、同じ設定なら同じ結果になる。';
    const first = processSection(input(source));
    const second = processSection(input(source));
    expect(first.chunks.map((chunk) => chunk.id)).toEqual(second.chunks.map((chunk) => chunk.id));
  });

  it('文末休止を持つチャンクは長く表示する', () => {
    const result = processSection(input('短い文です。続きです。'));
    const sentence = result.chunks.find((chunk) => chunk.pauseClass === 'paragraph');
    expect(sentence).toBeDefined();
    if (!sentence) return;
    const withoutPause = { ...sentence, pauseClass: 'none' as const };
    expect(durationForChunk(sentence, 600)).toBeGreaterThan(durationForChunk(withoutPause, 600));
  });
});
