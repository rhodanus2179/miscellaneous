import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parsePlainText, suggestedTitle } from '../js/markdown.js';

test('Markdownの主要ブロックを順番に抽出する', () => {
  const source = '# 見出し\n\n本文です。\n\n- 項目\n\n> 引用\n\n```js\nalert(1)\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |';
  const kinds = parseMarkdown(source).map((b) => b.kind);
  assert.deepEqual(kinds, ['heading','paragraph','list','quote','code','table']);
});

test('Markdownリンクは表示文字列だけを残す', () => {
  const blocks = parseMarkdown('[公式サイト](https://example.com)を確認。');
  assert.equal(blocks[0].text, '公式サイトを確認。');
});

test('raw HTMLを実行可能なDOMへ変換しない', () => {
  const blocks = parseMarkdown('<script>alert(1)</script>');
  assert.equal(blocks[0].text, '<script>alert(1)</script>');
});

test('プレーンテキストの段落順を維持する', () => {
  const blocks = parsePlainText('第一段落。\n\n第二段落。');
  assert.deepEqual(blocks.map((b) => b.text), ['第一段落。','第二段落。']);
});

test('見出しからタイトルを生成する', () => {
  assert.equal(suggestedTitle('# 文書タイトル\n本文', 'markdown'), '文書タイトル');
});
