# Yomu Pace

日本語文章を意味のまとまりで区切り、前後関係を保ちながら一定のテンポで読める、端末内完結型の読書支援アプリです。

## v0.1.0の機能

- 文章の貼り付け
- UTF-8 / BOM付きUTF-16のTXT読込み
- Markdown読込み
- DRMなし・リフロー型EPUB 2/3の本文抽出
- BudouXと規則ベース処理による日本語チャンク生成
- コンテキスト・ハイライト・フォーカスの3表示モード
- 可変速度、句読点休止、前後チャンク・文・ブロック移動
- IndexedDBへの文書・設定・読書位置保存
- PWA、オフライン基本動作

外部LLM API、Gemini Nano、kuromoji.js、クラウド保存は使用しません。

## 開発

```bash
npm install
npm run dev
```

検証:

```bash
npm run check
```

ビルド:

```bash
npm run build
```

成果物は `dist/` に生成されます。Viteの `base` は相対パスに設定しているため、GitHub Pagesのサブディレクトリ配信を想定しています。

## 対応外

- PDF、OCR
- URLからの記事取得
- DRM付き・固定レイアウトEPUB
- 縦書き
- クラウド同期
- 要約、翻訳、理解度テスト生成

PDFは将来、PDF.jsによる端末内テキスト抽出として追加する計画です。

## 文書

- [要件定義](./REQUIREMENTS.md)
- [実装設計](./DESIGN.md)
- [第三者ライセンス](./THIRD_PARTY_NOTICES.md)
