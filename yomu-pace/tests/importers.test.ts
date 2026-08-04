import { describe, expect, it } from 'vitest';
import { decodeTextBytes, importPaste } from '../src/importers';

describe('テキスト取込み', () => {
  it('UTF-8を復号する', () => {
    const source = '日本語の文章です。';
    const bytes = new TextEncoder().encode(source);
    expect(decodeTextBytes(bytes)).toBe(source);
  });

  it('空白だけの貼付けを拒否する', () => {
    expect(() => importPaste('   \n', 'text')).toThrow('本文を入力してください');
  });

  it('プレーンテキストの段落順を保持する', () => {
    const payload = importPaste('第一段落です。\n\n第二段落です。', 'text', '試験文書');
    expect(payload.sections).toHaveLength(1);
    expect(payload.sections[0]?.blocks.map((block) => block.text)).toEqual(['第一段落です。', '第二段落です。']);
    expect(payload.title).toBe('試験文書');
  });

  it('箇条書きを項目単位にする', () => {
    const payload = importPaste('- 一つ目\n- 二つ目', 'text');
    expect(payload.sections[0]?.blocks.map((block) => block.kind)).toEqual(['list-item', 'list-item']);
  });
});
