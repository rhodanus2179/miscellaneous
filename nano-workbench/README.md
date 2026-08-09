# Nano Workbench

Chrome Built-in AI（Gemini Nano / Prompt API）を使う、端末内完結型のマルチモーダルAIワークベンチです。

## v0.2.0 — Workspace & Harness

v0.1のローカルチャット基盤に、長期作業の整理と再利用可能な指示、必要な場合だけユーザーへ確認する対話ハーネスを追加します。

- Projects / No Project
- Project Instructions
- 明示的Project Memory（category / priority / pinned / enabled）
- Project Memoryの投入guard（既定12件・3000文字）
- Built-in / Custom Styles
- Built-in / Custom Skills v1（任意コード実行なし）
- ProjectごとのSkill有効化
- one-shot Skill適用
- Ask User Harness（structured output + session clone）
- single select / multi select / free text
- 最大3問 / Skip / Cancel / fallback
- Slash Commands（`/new` `/project` `/memory` `/skill` `/style` `/context` `/compact` `/export`）
- DB v1 → v2 migration
- Workspace変更時のsession rebuild

設計: [DESIGN_v0.2.md](./DESIGN_v0.2.md)

## v0.1.0 基盤

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

設計: [DESIGN.md](./DESIGN.md)

## 対象

デスクトップ版Google ChromeのBuilt-in AI対応環境。モバイルChromeは対象外です。

Chrome公式のハードウェア要件やAPI提供状況は更新されるため、実行時の`LanguageModel.availability()`を正とします。

## Privacy

会話、画像、Project、Memory、Custom Style、Custom SkillはクラウドLLMへ送信しません。アプリコードの取得・更新と、Chromeが管理するモデルの初回取得・更新には通信が発生します。

Custom Skillは文字列のタスク定義としてのみ保存し、JavaScriptやOSコマンドを実行しません。

## Development

本番ビルドはありません。開発版は静的ES ModulesとしてGitHub Pages / localhostから直接配信します。

```text
nano-workbench/
  index.html
  styles.css
  styles-v02.css
  sw.js
  js/
    workspace/
    harness/
```

将来、配布用に単一HTMLへbundle / inlineする構成を妨げないよう、サーバ処理・外部CDN・クラウドAPI依存を追加していません。
