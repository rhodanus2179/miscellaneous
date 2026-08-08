# Nano Workbench v0.1.0 設計書

- 対象プロダクト: `Nano Workbench`（仮称）
- 対象版: v0.1.0
- リポジトリ: `rhodanus2179/miscellaneous`
- 配置先: `nano-workbench/`
- 公開方式: GitHub Pagesによる静的配信
- 実装方式: HTML / CSS / Vanilla JavaScript ES Modules
- 本番ビルド: なし
- AI基盤: Chrome Prompt API（Gemini Nano）
- 主対象端末: 会社dynabook XZ/HYL（Windows 11、Core i7-1360P、RAM 32GB）
- 主対象ブラウザ: デスクトップ版Google Chrome 149以降
- データ処理: 端末内完結
- 作成日: 2026-08-06
- 状態: 実装前設計

---

## 1. 設計目的

Nano Workbenchは、Claude Webに近い分かりやすいチャット体験を、Chrome内蔵のGemini Nanoで端末内に実現するローカルAIワークベンチである。

本アプリの価値は、外観だけをClaude風にすることではない。クラウド型AIでは通常見えにくい次の状態を利用者へ明示する。

- Gemini Nanoの利用可否
- モデルのダウンロード状態
- 現在のコンテキストウィンドウ
- 現在のコンテキスト使用量
- 次の入力による使用量の見込み
- コンテキストのオーバーフロー
- セッションの圧縮・再構築状況
- 画像が現在のセッションへ保持されているか
- 生成時間、停止、失敗、再試行

したがって、本アプリは「Claudeの代替」を名乗らず、次の位置づけとする。

> 端末内で完結し、AIの制約と状態を観測しながら使える、マルチモーダル対話環境

---

## 2. 設計原則

優先順位は次のとおりとする。

1. 端末内完結と機密性
2. セッション状態の可視化
3. 会話・画像・設定の復元性
4. 生成停止、失敗復旧、圧縮の堅牢性
5. 日本語での使いやすさ
6. Claude Webに近い自然な操作感
7. 静的配信と保守の容易さ
8. 装飾や高度なArtifact機能

### 2.1 明示する制約

- UIが似ていても、Gemini Nanoの能力はクラウド版Claudeと同等ではない。
- コンテキストウィンドウは実行環境から取得し、固定値を前提にしない。
- Prompt APIが返す正式な値は、セッション全体の`contextWindow`と`contextUsage`である。
- System、履歴、画像、現在入力などの内訳はAPIから直接取得できない。内訳表示を行う場合は測定差分に基づく推定値として明示する。
- 画像理解はOCR専用エンジンではない。数値、固有名詞、細字は原画像との照合が必要である。
- モバイル版Chrome、iOS版Chromeはv0.1.0の実行対象外とする。

---

## 3. スコープ

### 3.1 v0.1.0で実装する機能

- 複数会話スレッド
- 新規作成、名称変更、削除、検索
- Gemini Nanoとの日本語チャット
- ストリーミング回答
- 生成停止
- 回答再生成
- ユーザーメッセージの編集と分岐再実行
- Markdown表示
- コードブロックのコピー
- 画像のファイル選択、ドラッグ＆ドロップ、貼り付け
- 複数画像を含む質問
- 画像サムネイル、拡大、削除
- IndexedDBへの会話・画像・設定保存
- セッション再構築
- コンテキスト使用量の常時表示
- 送信前のコンテキスト消費量測定
- `contextoverflow`検出
- 会話圧縮
- モデルダウンロード進捗
- ライト／ダーク／システムテーマ
- 会話のJSONエクスポート／インポート
- デバッグログのJSONエクスポート
- PWAとしてのインストール

### 3.2 v0.1.0では実装しない機能

- クラウドLLMへのフォールバック
- OpenAI、Anthropic、Google AI APIキーの保存
- インターネット検索
- RAG、ベクトル検索
- PDF、Word、Excel、EPUBの直接読込み
- 音声入力
- 画像生成
- プラグイン、MCP、関数呼出し
- 複数端末間同期
- ユーザーアカウント
- 共同編集
- HTML Artifactの実行プレビュー
- ClaudeのProjects相当の大規模資料管理

### 3.3 将来候補

- v0.2: Artifactペイン、HTML sandbox preview、差分表示
- v0.3: TXT／Markdown資料添付、簡易ローカルRAG
- v0.4: 音声入力、画像切り抜き、部分再解析
- v1.0: Chrome Extension版、選択中ページの取込み

---

## 4. 技術前提

### 4.1 Chrome Built-in AI

セッション作成時には次の入出力を宣言する。

```js
const sessionOptions = {
  expectedInputs: [
    { type: 'text', languages: ['ja', 'en'] },
    { type: 'image' },
  ],
  expectedOutputs: [
    { type: 'text', languages: ['ja', 'en'] },
  ],
};
```

`LanguageModel.availability(sessionOptions)`と`LanguageModel.create(sessionOptions)`には、同じモダリティ・言語条件を渡す。

### 4.2 対象環境

| 項目 | v0.1.0 |
|---|---|
| OS | Windows 11を主対象 |
| Chrome | 149以降を主対象 |
| CPU実行 | 対応 |
| GPU実行 | 利用可能ならChromeに委ねる |
| RAM | 16GB以上を前提 |
| ストレージ | Chromeプロファイル所在ボリュームに十分な空き容量 |
| 配信 | HTTPSのGitHub Pages |
| オフライン | アプリシェルとモデル取得後に対応 |
| iPhone／Android | 非対応表示のみ |

### 4.3 実行時通信

アプリ本体は、初回配信および更新確認を除き外部サービスへ通信しない。

Gemini Nanoのモデル取得・更新はChromeが管理する。アプリはモデルファイルを直接扱わない。

---

## 5. 画面構成

### 5.1 デスクトップ

```text
┌────────────────────────────────────────────────────────────────────┐
│ Nano Workbench     ● Local AI ready       Context 3,812 / 9,216   │
├────────────────┬────────────────────────────────┬──────────────────┤
│ Conversations  │ Chat                           │ Inspector        │
│                │                                │                  │
│ ＋ New chat    │ User                           │ Context          │
│ 検索           │ [image] [image]                │ █████░░ 41%      │
│                │ この2枚を比較してください       │                  │
│ 今日            │                                │ Attachments      │
│ 画像比較        │ Assistant                      │ image-01         │
│ 文案整理        │ 生成中のMarkdown…              │ image-02         │
│                │                                │                  │
│ 以前            │                                │ Session events   │
│ ...            │                                │                  │
├────────────────┴────────────────────────────────┴──────────────────┤
│ [＋] 添付プレビュー  メッセージを入力…          [■ Stop / Send]   │
│ 今回 +428（予測）  送信後 4,240 / 9,216  安全余裕 4,976           │
└────────────────────────────────────────────────────────────────────┘
```

### 5.2 左ペイン

- 新しい会話
- 会話検索
- 日付別の会話一覧
- ピン留め
- 名称変更
- 削除
- JSON入出力
- 設定

### 5.3 中央ペイン

- 会話本文
- ユーザー／AIメッセージ
- 画像サムネイル
- Markdown
- コードブロック
- コピー
- 編集
- 再生成
- 分岐点表示
- ストリーミングカーソル
- 停止・失敗・圧縮通知

### 5.4 右ペイン

タブで切り替える。

1. **Context**
   - 最大値
   - 現在値
   - 残量
   - 使用率
   - 次回入力の予測
   - 安全余裕
   - overflow履歴

2. **Attachments**
   - 現在の会話に保存された画像
   - 現セッションに投入済みか
   - 元サイズ／正規化後サイズ
   - 拡大表示
   - 再投入

3. **Debug**
   - availability
   - セッション生成時刻
   - prompt開始／終了
   - 実時間
   - contextUsage前後
   - エラー
   - compaction履歴

### 5.5 レスポンシブ

v0.1.0はデスクトップ専用だが、狭いウィンドウには対応する。

- 1,100px未満: 右ペインをドロワー化
- 800px未満: 左右ペインをドロワー化
- 600px未満: 非対応警告を表示し、閲覧のみ許可

---

## 6. 状態モデル

```text
App
├─ capabilityState
│  ├─ apiSupported
│  ├─ availability
│  ├─ downloadProgress
│  └─ modalities
├─ activeConversationId
├─ activeSession
├─ generationState
├─ contextState
├─ attachmentDrafts
├─ uiState
└─ settings
```

### 6.1 生成状態

```text
idle
  ├─ preparing
  ├─ measuring
  ├─ compacting
  ├─ generating
  ├─ stopping
  ├─ completed
  ├─ cancelled
  └─ failed
```

送信ボタンと停止ボタンは同じ領域を切り替える。二重送信は許可しない。

### 6.2 セッション方針

- ブラウザ内で同時に保持する`LanguageModel`セッションは原則1つ。
- 会話を切り替えると、現セッションを破棄して対象会話を再構築する。
- UI上の全履歴はIndexedDBに保持する。
- モデルのコンテキストと保存履歴を同一視しない。

---

## 7. 全体アーキテクチャ

```text
┌──────────────────────────────────────────────────────────────┐
│ UI Layer                                                     │
│ Sidebar / Chat / Composer / Inspector / Dialogs             │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ Application Layer                                           │
│ Conversation / Generation / Attachment / Compaction         │
└──────────────┬─────────────────────────────┬─────────────────┘
               │                             │
┌──────────────▼──────────────┐   ┌──────────▼─────────────────┐
│ AI Adapter                  │   │ Persistence               │
│ Prompt API / Summarizer     │   │ IndexedDB repositories   │
└──────────────┬──────────────┘   └──────────┬─────────────────┘
               │                             │
┌──────────────▼─────────────────────────────▼─────────────────┐
│ Domain                                                       │
│ Messages / Attachments / Context snapshots / Event logs     │
└──────────────────────────────────────────────────────────────┘
```

### 7.1 依存方向

```text
UI → Application → Domain
          │
          ├→ AI Adapter
          └→ Persistence
```

Prompt API固有のオブジェクトをUI・Domainへ漏らさない。

---

## 8. ディレクトリ構成

```text
nano-workbench/
├─ index.html
├─ styles.css
├─ manifest.webmanifest
├─ sw.js
├─ README.md
├─ DESIGN.md
├─ THIRD_PARTY_NOTICES.md
├─ icons/
│  ├─ icon-192.png
│  └─ icon-512.png
├─ js/
│  ├─ main.js
│  ├─ app.js
│  ├─ config.js
│  ├─ state.js
│  ├─ types.js
│  ├─ ui/
│  │  ├─ shell.js
│  │  ├─ sidebar.js
│  │  ├─ chat-view.js
│  │  ├─ message-view.js
│  │  ├─ composer.js
│  │  ├─ context-meter.js
│  │  ├─ attachment-view.js
│  │  ├─ inspector.js
│  │  ├─ dialogs.js
│  │  └─ toast.js
│  ├─ application/
│  │  ├─ conversation-controller.js
│  │  ├─ generation-controller.js
│  │  ├─ session-controller.js
│  │  ├─ compaction-controller.js
│  │  ├─ attachment-controller.js
│  │  └─ import-export.js
│  ├─ ai/
│  │  ├─ capability.js
│  │  ├─ language-model-adapter.js
│  │  ├─ summarizer-adapter.js
│  │  ├─ session-builder.js
│  │  ├─ prompt-builder.js
│  │  ├─ context-tracker.js
│  │  └─ ai-errors.js
│  ├─ attachments/
│  │  ├─ image-loader.js
│  │  ├─ image-normalizer.js
│  │  ├─ image-classifier.js
│  │  ├─ thumbnail.js
│  │  └─ object-url-registry.js
│  ├─ storage/
│  │  ├─ db.js
│  │  ├─ migrations.js
│  │  ├─ conversations.js
│  │  ├─ messages.js
│  │  ├─ attachments.js
│  │  ├─ summaries.js
│  │  ├─ settings.js
│  │  └─ logs.js
│  ├─ markdown/
│  │  ├─ renderer.js
│  │  ├─ code-blocks.js
│  │  └─ sanitizer.js
│  └─ utils/
│     ├─ async.js
│     ├─ ids.js
│     ├─ dates.js
│     ├─ bytes.js
│     ├─ text.js
│     └─ errors.js
├─ vendor/
│  ├─ marked/
│  └─ dompurify/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ fixtures/
│  └─ manual-checklist.md
└─ scripts/
   ├─ check-static-imports.mjs
   ├─ check-sw-assets.mjs
   └─ check-external-urls.mjs
```

### 8.1 ビルドを行わない理由

- GitHub Pagesへそのまま配置できる。
- Chrome Prompt APIの実機検証を単純化できる。
- npmビルド成果物とソースの不一致を避けられる。
- 会社PCでの導入手順を短くできる。

ファイルは分割する。単一HTML化はv0.1.0の要件に含めない。

---

## 9. データモデル

### 9.1 Conversation

```js
/**
 * @typedef {Object} Conversation
 * @property {string} id
 * @property {string} title
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {boolean} pinned
 * @property {'active'|'archived'} status
 * @property {string|null} compactSummaryId
 * @property {string[]} activeBranchMessageIds
 * @property {number} schemaVersion
 */
```

### 9.2 Message

```js
/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {string} conversationId
 * @property {'system'|'user'|'assistant'} role
 * @property {string} text
 * @property {string[]} attachmentIds
 * @property {string|null} parentMessageId
 * @property {number} createdAt
 * @property {'complete'|'streaming'|'cancelled'|'failed'} status
 * @property {string|null} errorCode
 * @property {number|null} contextUsageBefore
 * @property {number|null} contextUsageAfter
 * @property {number|null} measuredInputUsage
 * @property {number|null} elapsedMs
 */
```

### 9.3 Attachment

```js
/**
 * @typedef {Object} Attachment
 * @property {string} id
 * @property {string} conversationId
 * @property {string} messageId
 * @property {'image'} kind
 * @property {string} name
 * @property {string} mimeType
 * @property {number} width
 * @property {number} height
 * @property {number} byteSize
 * @property {Blob} normalizedBlob
 * @property {Blob} thumbnailBlob
 * @property {boolean} injectedInCurrentSession
 * @property {number} createdAt
 */
```

### 9.4 ContextSnapshot

```js
/**
 * @typedef {Object} ContextSnapshot
 * @property {number} timestamp
 * @property {number} contextWindow
 * @property {number} contextUsage
 * @property {number} remaining
 * @property {number} percentage
 * @property {number|null} measuredNextInput
 * @property {boolean} overflowObserved
 * @property {'api'|'estimated'} source
 */
```

### 9.5 CompactionSummary

```js
/**
 * @typedef {Object} CompactionSummary
 * @property {string} id
 * @property {string} conversationId
 * @property {string} summary
 * @property {string[]} coveredMessageIds
 * @property {number} createdAt
 * @property {number|null} measuredUsage
 * @property {'summarizer'|'fallback'} method
 */
```

---

## 10. IndexedDB設計

データベース名: `nano-workbench`

| Store | Key | Index |
|---|---|---|
| conversations | `id` | `updatedAt`, `pinned`, `status` |
| messages | `id` | `conversationId`, `[conversationId, createdAt]` |
| attachments | `id` | `conversationId`, `messageId` |
| summaries | `id` | `conversationId`, `createdAt` |
| settings | `key` | なし |
| logs | `id` | `conversationId`, `timestamp`, `eventType` |

### 10.1 トランザクション境界

ユーザー送信時は次を同一トランザクションで保存する。

- user message
- attachment metadata／Blob
- conversation.updatedAt

AI回答はストリーム中に毎チャンク保存せず、メモリ上で更新する。

- 2秒間隔のチェックポイント
- 完了、停止、失敗時に確定保存

### 10.2 容量管理

- `navigator.storage.estimate()`で使用量を表示する。
- 画像保存量の警告閾値を500MBとする。
- ユーザーが会話単位・画像単位で削除できる。
- 元画像は保存せず、正規化後画像のみ保存する。

---

## 11. Prompt APIアダプター

UIは次の抽象インターフェースだけを利用する。

```js
class LocalLanguageModel {
  async availability() {}
  async createSession(options) {}
  async measureInput(message) {}
  async stream(message, options) {}
  async append(message) {}
  getContextSnapshot() {}
  async destroy() {}
}
```

### 11.1 セッション生成

```js
const session = await LanguageModel.create({
  initialPrompts,
  expectedInputs: [
    { type: 'text', languages: ['ja', 'en'] },
    { type: 'image' },
  ],
  expectedOutputs: [
    { type: 'text', languages: ['ja', 'en'] },
  ],
  monitor(monitor) {
    monitor.addEventListener('downloadprogress', onDownloadProgress);
  },
});
```

### 11.2 システムプロンプト

初期プロンプトは短く保つ。

```text
あなたは端末内で動作する対話アシスタントです。
ユーザーの言語に合わせ、根拠のない断定を避けてください。
画像内の細かい文字、数値、固有名詞には不確実性を明示してください。
Markdownで読みやすく回答してください。
```

役割プリセットはシステムプロンプトを肥大化させず、必要な会話だけに短い追加指示として付与する。

### 11.3 ストリーミング

```js
const stream = session.promptStreaming(message, {
  signal: abortController.signal,
});

for await (const chunk of stream) {
  onChunk(chunk);
}
```

実装は、チャンクが累積文字列か差分文字列かをアダプター内で吸収する。UIは常に確定済み全文を受け取る。

### 11.4 停止

- 各promptに専用`AbortController`を作る。
- 停止時はメッセージを`cancelled`として保存する。
- 部分回答は保持する。
- 停止後もセッションが再利用可能か確認し、異常時は再構築する。

### 11.5 エラー正規化

| DOMException等 | アプリ内コード | 対応 |
|---|---|---|
| `NotSupportedError` | `MODALITY_UNSUPPORTED` | 画像を外す／環境案内 |
| `QuotaExceededError` | `CONTEXT_EXCEEDED` | 圧縮または入力短縮 |
| `AbortError` | `USER_CANCELLED` | 部分回答を保持 |
| availability=`unavailable` | `MODEL_UNAVAILABLE` | 要件案内 |
| download失敗 | `MODEL_DOWNLOAD_FAILED` | 再試行案内 |
| その他 | `UNKNOWN_AI_ERROR` | ログ保存、セッション再構築 |

---

## 12. コンテキスト表示設計

### 12.1 正式値

常時表示する正式値は次のみである。

```js
const contextWindow = session.contextWindow;
const contextUsage = session.contextUsage;
const remaining = contextWindow - contextUsage;
```

表示例:

```text
Context  3,812 / 9,216 tokens  41%
Remaining 5,404
```

単位表示はAPIの定義に合わせて`tokens`とする。整数へ丸める。

### 12.2 送信前測定

入力文と画像をPrompt APIへ渡す形へ組み立てた後、`measureContextUsage()`を呼ぶ。

```js
const measured = await session.measureContextUsage(message);
const projectedUsage = session.contextUsage + measured;
```

表示例:

```text
今回の入力: +428 tokens（測定値）
送信直前見込み: 4,240 / 9,216
```

画像を含む場合も、実際に送るマルチモーダルmessageを測定対象とする。

### 12.3 安全余裕

Prompt APIは将来の回答長を事前に保証しない。そのため「回答予約領域」という断定的表現は使わない。

代わりにアプリ独自の**安全余裕**を表示する。

- 既定値: contextWindowの15%
- ユーザー設定: 10%／15%／20%
- projectedUsageが85%を超える場合は警告
- projectedUsageが90%を超える場合は圧縮を提案
- 入力だけで残量を超える場合は送信しない

### 12.4 色と状態

| 使用率 | 状態 | 表示 |
|---:|---|---|
| 0–59% | normal | 通常 |
| 60–79% | notice | 「長い会話です」 |
| 80–89% | warning | 黄色、圧縮ボタン |
| 90%以上 | critical | 赤色、自動圧縮を推奨 |

色だけに依存せず、文字とアイコンを併用する。

### 12.5 内訳表示

Prompt APIは、現在の`contextUsage`をSystem／履歴／画像／回答などへ分解して返さない。

デバッグ画面で示せる内訳は次の方法による推定値とする。

- 空セッションとの差
- `measureContextUsage()`による各候補入力の個別測定
- セッション再構築直後のusage差分

表示には必ず`推定`ラベルを付ける。

```text
推定内訳
- Initial prompts: 約620
- Compacted history: 約1,100
- Recent turns: 約1,650
- Next input: 428

※合計はAPIの正式な内訳ではありません。
```

### 12.6 overflow

```js
session.addEventListener('contextoverflow', () => {
  recordOverflowEvent();
  showPersistentWarning();
});
```

overflow発生時は、単なるトーストで終わらせず、会話中にイベントカードを残す。

```text
コンテキスト上限に達したため、Chromeが古い会話ペアを除外しました。
完全な履歴は端末内に保存されています。
[セッションを圧縮して再構築]
```

---

## 13. 画像添付設計

### 13.1 入力方法

- 添付ボタン
- ドラッグ＆ドロップ
- クリップボード貼り付け

### 13.2 対応形式

初期対応:

- PNG
- JPEG
- WebP

ブラウザがデコードできても、HEIC、TIFF、SVGはv0.1.0では明示的に非対応とする。

### 13.3 制限

| 項目 | 既定値 |
|---|---:|
| 1ターンの最大枚数 | 4枚 |
| 1画像の元ファイル上限 | 20MB |
| 全画像の正規化後上限 | 16MB／ターン |
| 写真の長辺 | 1,600px |
| スクリーンショットの長辺 | 2,048px |
| JPEG/WebP品質 | 0.86 |

制限はコンテキスト測定結果と実機性能により調整する。

### 13.4 前処理

```text
File / Clipboard
  ↓
MIME・サイズ検証
  ↓
createImageBitmap()
  ↓
写真／スクリーンショットの簡易判定
  ↓
縮小・向き補正・色空間のブラウザ標準化
  ↓
Canvas → Blob
  ↓
サムネイル作成
  ↓
IndexedDB保存
  ↓
Prompt APIへBlob入力
```

- 拡大はしない。
- 透明背景が重要なPNGはPNGを維持する。
- 写真はWebPを優先し、非対応時はJPEGへフォールバックする。
- 元画像は既定で保存しない。

### 13.5 Gemini Nanoへの投入

```js
const content = [
  { type: 'text', value: userText || '添付画像を確認してください。' },
  ...attachments.map((attachment) => ({
    type: 'image',
    value: attachment.normalizedBlob,
  })),
];

const message = [{ role: 'user', content }];
```

### 13.6 画像の会話継続

同一`LanguageModel`セッションが存続する間は、モデル側の会話コンテキストに画像が残る可能性がある。ただし、アプリは永続保持を保証しない。

画面上で画像ごとに状態を表示する。

- `Current session`: 現在のセッションへ投入済み
- `Stored only`: IndexedDBにはあるが、現在のセッションには未投入
- `Replayed`: セッション再構築時に再投入済み
- `Summary only`: 画像の説明文だけで復元

### 13.7 再読込み後の復元

再読込み時は次の順で復元する。

1. compact summary
2. 直近のテキスト会話
3. 直近2ターン以内で参照中の画像のみ再投入
4. それ以前の画像はAI回答から作成した短い説明文で代替

画像再投入でコンテキストを圧迫する場合は、ユーザーへ選択を求める。

```text
この会話には6枚の画像があります。
現在のコンテキストへ戻す画像を選択してください。
```

### 13.8 画像回答の注意表示

画像を含む回答には、折りたたみ可能な注意を付ける。

> 画像理解による回答です。重要な数値、固有名詞、細かい文字は原画像と照合してください。

---

## 14. 会話履歴とセッション再構築

### 14.1 保存履歴とモデル履歴

- 保存履歴: 全メッセージを保持する。
- モデル履歴: コンテキストに収まる要約＋直近ターンだけを保持する。

### 14.2 再構築アルゴリズム

```text
Conversationを開く
  ↓
既存compact summaryを取得
  ↓
直近メッセージを新しい順に候補化
  ↓
initialPrompts候補をmeasure
  ↓
安全余裕内に収まるまで古い候補を除外
  ↓
LanguageModel.create(initialPrompts)
  ↓
必要な直近画像をappend
  ↓
context表示更新
```

### 14.3 initialPrompts

次の順に組み立てる。

1. system prompt
2. compact summaryがあれば、要約を示すuser／assistantペア
3. 直近の完全なuser／assistantペア

不完全なassistant回答は原則としてinitialPromptsへ含めない。ユーザーが明示的に保持した場合だけ「途中回答」としてテキスト注記を付ける。

---

## 15. コンパクション設計

### 15.1 発動条件

次のいずれかで提案する。

- 現在使用率が80%以上
- 次回入力後見込みが85%以上
- `contextoverflow`を検出
- ユーザーが手動実行

自動実行は、設定で有効な場合のみ行う。既定は「提案して確認」である。

### 15.2 手順

1. 全履歴から既存summaryで未包含の古い範囲を選ぶ。
2. Language Detector APIが利用可能なら言語を確認する。
3. Summarizer APIで日本語の要約を作る。
4. 重要な決定、固有名詞、未解決事項、画像参照を保持する補助プロンプトを付ける。
5. 要約を保存する。
6. 旧セッションを破棄する。
7. summary＋直近ターンで新セッションを作る。
8. 再構築前後のcontextUsageをログに記録する。

### 15.3 要約形式

```text
【会話の目的】
...

【確定事項】
- ...

【ユーザーの要望・制約】
- ...

【添付画像】
- image-01: ...

【未解決事項】
- ...

【直近の作業状態】
...
```

### 15.4 失敗時

Summarizer APIが利用できない場合:

- 既存summaryを維持
- 古い会話を一定ターンで切り出す
- Prompt APIへ短い要約を依頼するfallbackを1回だけ実行
- 失敗時は自動圧縮せず、ユーザーへ新規会話への分岐を提案する

全履歴は削除しない。

---

## 16. メッセージ編集・再生成・分岐

### 16.1 再生成

- 対象assistantメッセージ以降を別branchとして保存する。
- 元回答を上書きしない。
- UIでは回答候補を左右ボタンで切り替える。

### 16.2 ユーザーメッセージ編集

- 編集対象以降を新しいbranchへ分岐する。
- 画像の追加・削除を可能にする。
- 新branchに合わせてセッションを再構築する。

### 16.3 データ構造

`parentMessageId`と`activeBranchMessageIds`で会話木を表現する。

v0.1.0のUIでは複雑な木を描画せず、各分岐点に`1 / 2`の候補切替だけを表示する。

---

## 17. Markdown表示

### 17.1 対応

- 見出し
- 段落
- 強調
- 箇条書き
- 番号付きリスト
- 引用
- インラインコード
- コードブロック
- 表
- リンク
- 水平線

### 17.2 安全性

- `marked`をリポジトリへ同梱する。
- 出力HTMLをDOMPurifyでサニタイズする。
- raw HTMLは無効化または除去する。
- リンクは`rel="noopener noreferrer"`を付ける。
- 外部画像のMarkdown埋込みは既定で読み込まない。
- `javascript:`等の危険URLを除去する。

### 17.3 ストリーミング中

毎チャンクでMarkdown全文を再解析すると負荷が高い。

- 50ms単位で描画を間引く。
- 未閉鎖コードフェンスを検知する。
- 生成完了時に最終レンダリングする。
- スクロールが末尾付近の場合だけ自動追従する。

---

## 18. モデル準備画面

起動時に能力を判定する。

```text
LanguageModelがない
  → 非対応ブラウザ案内

availability = unavailable
  → ハードウェア／OS／空き容量案内

availability = downloadable
  → ユーザー操作でダウンロード開始

availability = downloading
  → 進捗表示

availability = available
  → セッション作成
```

### 18.1 ダウンロード画面

```text
Gemini Nanoを準備しています
██████████░░░░ 68%

モデルはChromeが管理します。
初回取得後、会話と画像は端末内で処理されます。
```

ダウンロード開始は明示的なボタン操作から行う。

### 18.2 診断導線

エラー時に次を表示する。

- Chromeバージョン
- `LanguageModel`の有無
- availability結果
- OS／メモリ要件の概要
- `chrome://on-device-internals`を開く手順
- 診断情報コピー

ブラウザ内部URLはWebページから直接開けない場合があるため、コピー可能な文字列として示す。

---

## 19. プライバシーとセキュリティ

### 19.1 基本方針

- 会話、画像、ログをサーバへ送信しない。
- 外部分析タグを入れない。
- CDNを利用しない。
- Service Workerは自オリジンの静的資産だけをキャッシュする。
- エクスポートはユーザー操作時だけ行う。

### 19.2 UI表示

ヘッダーに状態を常時表示する。

```text
● Local processing
```

ただし、モデルダウンロード中やアプリ更新時の通信まで「完全オフライン」と誤認させない。

設定画面に次を明記する。

- アプリデータはこのChromeプロファイルのIndexedDBに保存される。
- ブラウザデータ消去で失われる。
- 会社PCの管理ポリシーにより保存・機能が制限される可能性がある。
- GitHub Pagesから配信されるアプリコードの更新確認には通信が発生する。

### 19.3 HTML Artifact

v0.1.0ではHTML実行プレビューを実装しない。

将来実装する場合は、`iframe sandbox`に`allow-scripts`を付けず、外部通信をContent Security Policyで遮断する設計から開始する。

---

## 20. エラー・復旧設計

### 20.1 原則

- ユーザー入力を失わない。
- 部分回答を失わない。
- エラー後にセッションを再構築できる。
- 同じ失敗を無限再試行しない。

### 20.2 再試行

| エラー | 自動再試行 |
|---|---:|
| 一時的な生成失敗 | 1回 |
| セッション破損疑い | 再構築後1回 |
| QuotaExceeded | なし。圧縮を提案 |
| NotSupported | なし |
| Abort | なし |
| ダウンロード失敗 | ユーザー操作で再試行 |

### 20.3 タイムアウト

Prompt API自体の処理時間は端末性能と入力に依存する。

- テキスト: 警告3分、強制停止6分を既定
- 画像あり: 警告5分、強制停止10分を既定
- 強制停止値は設定で変更可能
- 警告後も処理継続を選べる

実時間を常時表示する。

---

## 21. ログ設計

### 21.1 保存イベント

- app_start
- capability_checked
- model_download_started／progress／completed／failed
- session_created／destroyed／rebuilt
- prompt_measured
- prompt_started／chunk／completed／cancelled／failed
- context_updated
- context_overflow
- compaction_started／completed／failed
- image_normalized／failed
- storage_error

### 21.2 ログ項目

```js
{
  id,
  timestamp,
  eventType,
  conversationId,
  messageId,
  elapsedMs,
  contextWindow,
  contextUsageBefore,
  contextUsageAfter,
  measuredInputUsage,
  imageCount,
  normalizedImageBytes,
  errorName,
  errorMessage,
  appVersion,
  chromeVersion,
}
```

### 21.3 保存方針

- 既定保持期間: 30日
- prompt本文と画像本体はログへ複製しない。
- エクスポート前にユーザーが内容を確認できる。
- 失敗・中止attemptも必ず保存する。

---

## 22. 設定

| 設定 | 既定値 |
|---|---|
| テーマ | system |
| 出力言語 | 自動（日本語優先） |
| 安全余裕 | 15% |
| 自動圧縮 | 確認して実行 |
| 画像最大枚数 | 4 |
| 写真長辺 | 1,600px |
| スクリーンショット長辺 | 2,048px |
| 元画像保存 | off |
| デバッグ表示 | off |
| ログ保持 | 30日 |
| テキストタイムアウト | 6分 |
| 画像タイムアウト | 10分 |

Prompt APIの`topK`や`temperature`は、通常Webアプリで安定利用できる前提にしない。v0.1.0の一般設定には出さない。

---

## 23. PWA・キャッシュ

### 23.1 Service Worker

- App Shellをcache-firstで配信
- HTMLはnetwork-first、失敗時cache
- バージョン変更時に旧cacheを削除
- IndexedDBには干渉しない
- Gemini NanoモデルはChrome管理のためcache対象外

### 23.2 更新

新Service Worker待機時に通知する。

```text
新しいバージョンがあります。
会話を保存して再読み込みしますか？
```

生成中は更新を適用しない。

---

## 24. アクセシビリティ

- 主要操作はキーボードだけで可能にする。
- `Ctrl+Enter`: 送信
- `Esc`: 生成停止またはダイアログ閉鎖
- `Ctrl+K`: 会話検索
- `Ctrl+Shift+N`: 新しい会話
- context meterへ`aria-valuenow`等を付ける。
- ストリーミング領域は過剰な読み上げを避け、完了時に通知する。
- ドロップ領域にはファイル選択の代替手段を必ず置く。
- フォーカスリングを消さない。
- 画像サムネイルにはファイル名と番号を代替テキストとして付ける。

---

## 25. 性能設計

### 25.1 UI

- 会話一覧を仮想化する必要はv0.1.0ではない。
- 1会話500メッセージを超えた場合は段階描画する。
- Object URLは画面から外れた時点で解放する。
- Markdown再描画を50ms以上の間隔へ間引く。

### 25.2 画像

- 正規化処理は`createImageBitmap()`を優先する。
- Canvas処理は1枚ずつ行う。
- 各画像処理の間でイベントループへ制御を返す。
- 画像投入前にcontext測定を行う。

### 25.3 セッション

- 非アクティブ会話のモデルセッションを保持しない。
- 画面を閉じる際に`destroy()`を呼ぶ。
- セッション再構築中は送信不可とする。

---

## 26. テスト設計

### 26.1 単体テスト

Node標準テストで、ブラウザAPIから分離できる純粋ロジックを検証する。

- message tree
- active branch
- context閾値判定
- compaction範囲選定
- prompt組立て
- import／export schema
- byte・時間表示
- image resize寸法計算
- error normalization

### 26.2 統合テスト

Prompt APIはモックアダプターを用意する。

- ストリーミング
- 停止
- context更新
- overflowイベント
- QuotaExceeded
- session rebuild
- image unsupported
- download progress

### 26.3 実機テスト

会社dynabookで次を記録する。

- Chromeバージョン
- `contextWindow`
- 初期`contextUsage`
- 日本語1,000字入力の測定値
- 画像1枚／4枚の測定値
- 初回応答時間
- 生成速度の体感
- 3、10、30ターン後のusage
- compaction前後
- 停止後の再利用可否
- 画像付き会話の再読込み復元

### 26.4 GitHub Pagesテスト

- ルート相対パスを使わない。
- `./`基準で全資産を参照する。
- 大文字小文字の不一致を検査する。
- Service Workerのscopeが`/miscellaneous/nano-workbench/`に収まることを確認する。
- 404にならない静的import検査をActionsで行う。

---

## 27. 受入基準

### 27.1 起動

- 対応Chromeでavailabilityを判定できる。
- モデル未取得時に進捗を表示できる。
- 非対応環境で原因と対処を表示できる。

### 27.2 チャット

- 日本語メッセージを送信できる。
- 回答がストリーミング表示される。
- 生成を停止できる。
- 停止した部分回答が残る。
- 再生成と編集分岐が機能する。

### 27.3 画像

- 選択、ドロップ、貼り付けの3方式で画像を添付できる。
- 画像が自動縮小される。
- 最大4枚をテキストと同時に送れる。
- 再読込み後もサムネイルを復元できる。
- 画像非対応時は添付UIを無効化できる。

### 27.4 コンテキスト

- `contextWindow`と`contextUsage`を常時表示できる。
- 送信前に`measureContextUsage()`結果を表示できる。
- 使用率に応じて状態を変えられる。
- overflowを検出し、履歴に通知を残せる。
- 圧縮後にセッションを再構築できる。
- 内訳推定を正式値と誤認させない。

### 27.5 保存

- 会話を閉じても復元できる。
- 画像付き会話を復元できる。
- JSONエクスポート／インポートができる。
- ブラウザデータ削除による消失リスクを表示する。

### 27.6 プライバシー

- 外部分析・クラウドAI通信を行わない。
- 外部CDNを利用しない。
- Markdownから任意スクリプトを実行できない。

---

## 28. 実装順序

### Phase 1: 骨格

- App Shell
- 3ペインUI
- IndexedDB
- 会話CRUD
- モックAI

### Phase 2: Gemini Nano

- capability判定
- モデルダウンロード
- session生成
- text streaming
- stop／error
- context meter

### Phase 3: 画像

- file／drop／paste
- normalize／thumbnail
- multimodal prompt
- attachment保存
- 画像インスペクター

### Phase 4: 長期会話

- session rebuild
- measure preflight
- overflow handling
- Summarizer compaction
- branch／regenerate

### Phase 5: 品質

- Markdown sanitize
- PWA
- import／export
- debug log
- keyboard／accessibility
- GitHub Pages検査

---

## 29. 実装時に実機確認する未確定事項

1. 対象Chrome実機で返される`contextWindow`の値
2. 画像1枚当たりの`measureContextUsage()`の傾向
3. `promptStreaming()`のchunkが差分か累積か
4. Abort後の同一セッション再利用の安定性
5. 画像を含むinitial prompts／appendによる再構築の実機挙動
6. CPU実行時の画像4枚処理時間
7. Summarizer APIの日本語要約品質
8. Service Worker更新後のモデル再利用への影響

これらは設計で固定せず、adapterと設定値で吸収する。

---

## 30. 参考資料

- Chrome Prompt API  
  https://developer.chrome.com/docs/ai/prompt-api
- Chrome Built-in AI: Get started  
  https://developer.chrome.com/docs/ai/get-started
- Session management with the Prompt API  
  https://developer.chrome.com/docs/ai/session-management
- Session compacting with the Prompt API  
  https://developer.chrome.com/docs/ai/session-compacting
- Summarizer API  
  https://developer.chrome.com/docs/ai/summarizer-api
- Debug the built-in model  
  https://developer.chrome.com/docs/ai/debug-built-in-model
- Prompt API proposal  
  https://github.com/webmachinelearning/prompt-api

---

## 31. 設計結論

Nano Workbench v0.1.0は、Claude Web風の見た目を再現するだけのチャットではなく、Gemini Nanoの状態を観測し、画像付きの会話を端末内で管理するための道具として実装する。

中核は次の5点である。

1. `LanguageModel`を薄いadapterへ隔離する。
2. 全履歴とモデル内コンテキストを分離する。
3. `contextWindow`と`contextUsage`を常時、正式値として表示する。
4. 画像を正規化・保存し、現在のセッションへの投入状態を明示する。
5. overflow後に黙って履歴が失われたように見せず、圧縮・再構築をユーザーへ可視化する。

この構成なら、Gemini Nanoのモデル更新やPrompt APIの仕様変更があっても、AI adapterとセッション構築部分を中心に追従できる。