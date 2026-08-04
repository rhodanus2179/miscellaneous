# Yomu Pace v0.1.0

日本語文章を意味のまとまりに近いチャンクで提示し、前後関係と読み戻しを保ちながら一定のテンポで通読するための、端末内完結型Webアプリです。

## 対応

- 文章貼り付け
- UTF-8 TXT（BOMあり・なし）
- BOM付きUTF-16LE / UTF-16BE
- Markdown（見出し、段落、リスト、引用、コード、単純な表）
- コンテキスト／ハイライト／フォーカスの3表示モード
- IndexedDB保存
- PWA・オフライン基本動作

EPUB、PDF、OCR、URL本文取得にはv0.1.0では対応しません。

## 公開

ビルドは不要です。`yomu-pace/`配下がそのまま公開物です。

- GitHub Pages: `https://rhodanus2179.github.io/miscellaneous/yomu-pace/`
- ローカル確認: 任意の静的HTTPサーバーでこのディレクトリを配信

## 開発者向け確認

Node.js標準機能だけでチェックできます。

```bash
node scripts/check-static.mjs
node --test tests/*.test.mjs
```
