# Nano Workbench

Chrome Built-in AI（Gemini Nano / Prompt API）を使う、端末内完結型のマルチモーダル対話ワークベンチです。

## v0.1.0

- Claude Webを参考にした3ペインUI
- 日本語／英語のPrompt APIチャット
- ストリーミング、停止、再生成、ユーザーメッセージ編集
- PNG / JPEG / WebPの選択・ドロップ・貼り付け
- 画像の縮小・サムネイル化・IndexedDB保存
- `contextWindow` / `contextUsage` の常時表示
- `measureContextUsage()`による送信前測定
- `contextoverflow`の検出
- Summarizer APIによる会話圧縮
- 会話・画像・設定・ログのIndexedDB保存
- 会話JSONのエクスポート／インポート
- PWA App Shell

## 対象

デスクトップ版Google ChromeのBuilt-in AI対応環境。モバイルChromeは対象外です。

Chrome公式のハードウェア要件やAPI提供状況は更新されるため、実行時の`LanguageModel.availability()`を正とします。

## Privacy

会話・画像はクラウドLLMへ送信しません。アプリコードの取得・更新と、Chromeが管理するモデルの初回取得・更新には通信が発生します。

## Development

本番ビルドはありません。静的ES ModulesとしてGitHub Pagesから直接配信します。

```text
nano-workbench/
  index.html
  styles.css
  sw.js
  js/
```

設計: [DESIGN.md](./DESIGN.md)
