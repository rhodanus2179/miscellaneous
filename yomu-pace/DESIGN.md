# Yomu Pace v0.1.0 実装設計書

- 文書名: Yomu Pace v0.1.0 実装設計書
- 対象プロダクト: `Yomu Pace`（仮称）
- 対象版: v0.1.0
- リポジトリ: `rhodanus2179/miscellaneous`
- 配置先: `yomu-pace/`
- 上位文書: [`REQUIREMENTS.md`](./REQUIREMENTS.md)
- 実装方式: 静的Webアプリ / PWA
- 配信候補: GitHub Pages
- データ処理: 端末内完結
- 作成日: 2026-08-04

---

## 1. 文書の目的

本書は、Yomu Pace要件定義書を、実装可能なアーキテクチャ、モジュール構成、データ構造、処理手順、画面遷移、アルゴリズム、テスト方式へ具体化する。

v0.1.0では、日本語文章を自然な意味のまとまりで提示し、前後関係と読み戻しを維持しながら、利用者が一定のテンポで通読できることを優先する。

外部LLM API、Gemini Nano、kuromoji.jsは使用しない。文章本文、読書位置、読書履歴は端末内だけで処理・保存する。

---

## 2. 設計判断

| 項目 | v0.1.0の決定 |
|---|---|
| 名称 | 開発名として`Yomu Pace`を継続。後から名称変更可能とする |
| UI | Vanilla TypeScript。React、Vue等は使用しない |
| ビルド | Vite |
| 日本語分割 | BudouX＋独自規則＋動的計画法 |
| Markdown | Markedのlexerを使い、HTMLを直接描画しない |
| EPUB | fflateでZIPを検査・展開し、DOMParserでOPF/XHTMLを解析 |
| EPUB表示エンジン | epub.jsは使用せず、読書用テキスト抽出に限定 |
| 保存 | IndexedDB。Promiseラッパーに`idb`を使用 |
| 大規模処理 | チャンク生成をDedicated Workerで実行 |
| PWA | `vite-plugin-pwa`の`injectManifest`＋更新確認プロンプト |
| 単体テスト | Vitest |
| E2E | Playwright |
| 手動チャンク編集 | v0.1.0では行わず、確認・問題箇所コピーまで |
| 履歴保存期間 | 既定180日。保存しない・30日・180日・無期限から選択 |
| アプリ更新 | 自動リロードせず、読書位置保存後に利用者が適用 |

### 2.1 実行時依存

- `budoux`: 日本語フレーズ境界候補
- `fflate`: EPUB ZIPの検査・展開
- `marked`: Markdown tokenization
- `idb`: IndexedDBラッパー

CDNからは読み込まず、すべてビルド成果物に含める。依存バージョンは実装開始時点の安定版を確認し、`package-lock.json`へ固定する。

### 2.2 採用しないもの

- 外部LLM API
- Gemini Nano
- kuromoji.js
- epub.js
- DOMPurify
- UIフレームワーク
- クラウドDB
- 外部フォント
- アクセス解析SDK

DOMPurifyを使用しないのは、利用者由来HTMLを画面へ挿入しない設計とするためである。本文は必ずText Nodeまたは`textContent`として表示する。

---

## 3. 全体アーキテクチャ

```text
┌──────────────────────────────────────────────────────┐
│ UI / Hash Router                                    │
│ Library / Import / Reader / Detail / Settings       │
└──────────────┬──────────────────────┬────────────────┘
               │                      │
               ▼                      ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│ Application Services    │  │ Reader Runtime          │
│ Import / Document / PWA │  │ State machine/Scheduler │
└──────────────┬──────────┘  └─────────────┬───────────┘
               │                           │
               ▼                           ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│ Import Pipeline         │  │ Chunk Provider          │
│ Paste/TXT/MD/EPUB       │  │ Page cache/Prefetch     │
└──────────────┬──────────┘  └─────────────┬───────────┘
               └──────────────┬─────────────┘
                              ▼
                 ┌────────────────────────┐
                 │ IndexedDB Repositories │
                 └────────────┬───────────┘
                              ▼
                 ┌────────────────────────┐
                 │ Document Worker        │
                 │ BudouX/Chunk/Timing    │
                 └────────────────────────┘
```

### 3.1 レイヤー責務

- **UI層**: 描画、操作、進捗・エラー表示、アクセシビリティ
- **アプリケーション層**: 取込み、再開、削除、再チャンク化、更新適用
- **ドメイン層**: 文書・チャンク型、分割、時間計算、進捗、読書状態機械
- **インフラ層**: IndexedDB、File API、Worker、Service Worker、ZIP、Markdown/XML解析

### 3.2 原則

- ドメイン処理は純粋関数を中心とする
- UIからIndexedDBを直接操作しない
- 文書全体を読書中に常時メモリへ展開しない
- 利用者本文へ`innerHTML`を使用しない
- 取込み失敗で既存文書を壊さない
- 同じ入力・設定・`chunkingVersion`から同じチャンク列を生成する

---

## 4. ディレクトリ構成

```text
yomu-pace/
├─ index.html
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ vite.config.ts
├─ eslint.config.js
├─ manifest.webmanifest
├─ REQUIREMENTS.md
├─ DESIGN.md
├─ THIRD_PARTY_NOTICES.md
├─ public/
│  ├─ icons/
│  └─ samples/sample-ja.txt
├─ src/
│  ├─ main.ts
│  ├─ app.ts
│  ├─ styles/
│  ├─ core/
│  │  ├─ errors.ts
│  │  ├─ ids.ts
│  │  ├─ limits.ts
│  │  └─ types.ts
│  ├─ routing/
│  ├─ importers/
│  │  ├─ import-service.ts
│  │  ├─ paste-importer.ts
│  │  ├─ text-importer.ts
│  │  ├─ markdown-importer.ts
│  │  └─ epub/
│  │     ├─ epub-importer.ts
│  │     ├─ zip-inspector.ts
│  │     ├─ container-parser.ts
│  │     ├─ package-parser.ts
│  │     ├─ navigation-parser.ts
│  │     ├─ xhtml-extractor.ts
│  │     └─ epub-path.ts
│  ├─ chunking/
│  │  ├─ config.ts
│  │  ├─ normalize.ts
│  │  ├─ sentence-segmenter.ts
│  │  ├─ protected-spans.ts
│  │  ├─ budoux-segmenter.ts
│  │  ├─ candidate-builder.ts
│  │  ├─ chunk-optimizer.ts
│  │  ├─ fallback-splitter.ts
│  │  ├─ chunk-validator.ts
│  │  ├─ timing.ts
│  │  └─ version.ts
│  ├─ workers/
│  │  ├─ protocol.ts
│  │  ├─ document-worker.ts
│  │  └─ worker-client.ts
│  ├─ reader/
│  │  ├─ reader-controller.ts
│  │  ├─ reader-machine.ts
│  │  ├─ scheduler.ts
│  │  ├─ chunk-provider.ts
│  │  ├─ position-service.ts
│  │  └─ session-recorder.ts
│  ├─ storage/
│  │  ├─ db.ts
│  │  ├─ schema.ts
│  │  ├─ migrations.ts
│  │  ├─ document-repository.ts
│  │  ├─ content-repository.ts
│  │  ├─ position-repository.ts
│  │  ├─ session-repository.ts
│  │  └─ staging-cleaner.ts
│  ├─ pwa/
│  ├─ ui/
│  │  ├─ screens/
│  │  └─ reader/
│  └─ utils/
├─ sw.ts
├─ tests/
│  ├─ unit/
│  ├─ golden/
│  ├─ fixtures/
│  └─ e2e/
└─ scripts/
   ├─ update-golden.ts
   └─ verify-third-party.ts
```

---

## 5. ビルド・配信

### 5.1 Vite

- `base: './'`とし、GitHub Pagesのサブディレクトリでも相対URLで動作させる
- Workerは別アセットへ分離する
- production assetにはハッシュを付ける
- ビルド時にアプリ版と`chunkingVersion`を埋め込む
- production source mapは初期版では生成しない

### 5.2 Pages統合

既存の`miscellaneous`配下アプリを壊さないことを優先する。実装時に現行Pages公開方式を確認し、Yomu Paceの`dist`を公開先の`yomu-pace/`へ追加する。既存アプリのURLや公開方式を変更しない。

```bash
cd yomu-pace
npm ci
npm run build
```

### 5.3 npm scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "test:golden:update": "tsx scripts/update-golden.ts",
    "check": "npm run lint && npm run test && npm run build"
  }
}
```

---

## 6. ルーティング

GitHub Pagesでサーバー側fallbackを不要にするため、Hash Routerを使用する。

```text
#/library
#/import
#/reader/:documentId
#/document/:documentId
#/settings
```

存在しない文書IDを開いた場合はライブラリへ戻し、「文書が見つかりませんでした」と表示する。

---

## 7. データモデル

### 7.1 文書

```ts
interface DocumentRecord {
  id: string;
  schemaVersion: 1;
  status: 'staging' | 'ready' | 'failed';
  title: string;
  author?: string;
  sourceType: 'paste' | 'txt' | 'markdown' | 'epub';
  sourceFileName?: string;
  sourceMimeType?: string;
  importedAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  characterCount: number;
  sectionCount: number;
  chunkCount: number;
  chunkingVersion: string;
  importWarnings: ImportWarning[];
  currentSectionId?: string;
}
```

本文やチャンク列は`DocumentRecord`へ入れない。ライブラリ表示時に巨大本文を読み込まないためである。

### 7.2 セクション

```ts
interface SectionRecord {
  id: string;
  documentId: string;
  order: number;
  title?: string;
  sourceHref?: string;
  sourceText: string;
  normalizedText: string;
  characterCount: number;
  blockCount: number;
  chunkCount: number;
  documentStart: number;
  documentEnd: number;
}
```

EPUBは原則spine itemごと、その他は章または文書全体をセクションとする。

### 7.3 ブロック

```ts
interface TextBlock {
  id: string;
  sectionId: string;
  order: number;
  kind: 'heading' | 'paragraph' | 'list-item' | 'quote' | 'code' | 'table' | 'separator' | 'url';
  text: string;
  sourceStart: number;
  sourceEnd: number;
  level?: number;
  autoPlayable: boolean;
}
```

コードと表は`autoPlayable: false`とする。

### 7.4 チャンク

```ts
interface ReadingChunk {
  id: string;
  documentId: string;
  sectionId: string;
  blockId: string;
  sentenceId: string;
  orderInSection: number;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  documentStart: number;
  documentEnd: number;
  visibleCharacterCount: number;
  kind: 'prose' | 'heading' | 'list' | 'quote' | 'code' | 'table' | 'url';
  pauseClass: 'none' | 'comma' | 'sentence' | 'paragraph' | 'section';
  durationMsAtBaseRate: number;
  flags: {
    hasNumber: boolean;
    hasUnit: boolean;
    hasLatin: boolean;
    hasUrl: boolean;
    hasBrackets: boolean;
    isProtectedSpan: boolean;
    usedFallbackSplit: boolean;
  };
}
```

### 7.5 チャンクページ

最大256チャンクを1レコードにまとめる。

```ts
interface ChunkPageRecord {
  key: string;
  documentId: string;
  sectionId: string;
  pageIndex: number;
  firstChunkOrder: number;
  lastChunkOrder: number;
  chunks: ReadingChunk[];
}
```

### 7.6 読書位置

```ts
interface ReadingPositionRecord {
  documentId: string;
  sectionId: string;
  chunkOrderInSection: number;
  chunkId: string;
  documentOffset: number;
  progress: number;
  mode: 'context' | 'highlight' | 'focus';
  updatedAt: string;
}
```

チャンク仕様変更後に同じIDがなければ、`documentOffset`から最寄りチャンクを復元する。

### 7.7 設定

```ts
interface ReaderSettings {
  mode: 'context' | 'highlight' | 'focus';
  charactersPerMinute: number;
  chunkLength: 'short' | 'standard' | 'long';
  punctuationPause: 'small' | 'standard' | 'large';
  fontSizePx: number;
  lineHeight: number;
  contentWidthCh: number;
  theme: 'system' | 'light' | 'dark';
  reducedMotion: boolean;
  swipeEnabled: boolean;
  sessionRetention: 'none' | '30d' | '180d' | 'forever';
}
```

---

## 8. IndexedDB

- DB名: `yomu-pace`
- 初期version: `1`

| Store | Key | Index |
|---|---|---|
| `documents` | `id` | `status`, `lastOpenedAt`, `updatedAt` |
| `sections` | `id` | `documentId`, `[documentId, order]` |
| `chunkPages` | `key` | `[documentId, sectionId, pageIndex]`, `documentId` |
| `positions` | `documentId` | `updatedAt` |
| `sessions` | `id` | `documentId`, `startedAt` |
| `settings` | `key` | なし |
| `importJobs` | `id` | `documentId`, `status`, `updatedAt` |

### 8.1 ステージング保存

1. `documents`へ`status: staging`を作成
2. `importJobs`を作成
3. セクション単位で本文とチャンクページを保存
4. 件数と文字数を検証
5. 最終トランザクションで`status: ready`へ変更
6. `ready`だけライブラリに表示

失敗・キャンセル時は同じdocumentIdのステージングデータを削除する。起動時には24時間以上残った`staging`文書と孤立レコードを掃除する。

### 8.2 容量

取込み前に可能なら`navigator.storage.estimate()`で空き容量を確認する。`navigator.storage.persist()`は利用者操作を起点として試行できるが、永続化成功を完全な保存保証として表現しない。

---

## 9. 共通取込みフロー

```text
入力選択
 ↓
サイズ・形式検証
 ↓
本文／構造抽出
 ↓
TextBlock列生成
 ↓
Workerでチャンク生成
 ↓
ステージング保存
 ↓
整合性検証
 ↓
ready化
```

進捗段階:

```ts
type ImportStage = 'reading' | 'validating' | 'extracting' | 'chunking' | 'saving' | 'finalizing';
```

キャンセル時はFile読込み、fflate、Workerを可能な範囲で停止し、ステージングデータを削除する。

---

## 10. 貼付け・TXT

### 10.1 貼付け

- 本文をそのまま`sourceText`に保持
- 空白だけは登録不可
- 2,000,000文字上限
- 「プレーンテキスト」「Markdown」を利用者が選択
- 初期値はプレーンテキスト

### 10.2 文字コード

1. UTF-8 BOM
2. UTF-16LE BOM
3. UTF-16BE BOM
4. BOMなしUTF-8を`TextDecoder(..., { fatal: true })`で試行
5. 失敗時は非対応文字コードとして終了

Shift_JISを置換文字付きで保存しない。

### 10.3 改行

- CRLF / CRを解析用にはLFへ変換
- 3個以上の空行は解析用には2個へ縮約
- デコード後原文は`sourceText`に保持
- 解析用は`normalizedText`に保持

---

## 11. Markdown

MarkdownをHTMLへ変換して挿入せず、`marked.lexer()`のtoken treeを`TextBlock[]`へ変換する。

| token | 処理 |
|---|---|
| heading | 見出しブロック、level保持 |
| paragraph | inline表示文字列を連結 |
| list_item | 項目単位ブロック |
| blockquote | quoteブロック |
| code | 非散文ブロック |
| table | タブ・改行で保持し固定表示 |
| link | 表示文字列を使用 |
| image | altがあれば使用 |
| codespan | 分割禁止スパン |
| html | detached DOMParserで安全なテキストだけ抽出 |

生HTMLでは`script`, `style`, `noscript`, `template`, `iframe`, `object`, `embed`, `svg`, `math`を内容ごと除外する。解析DocumentのNodeを現在Documentへ移植しない。

---

## 12. EPUB

### 12.1 方針

EPUBをZIPコンテナとして直接解析する。必要なのは章順と読書用テキストであり、完全なEPUBレンダリングではない。

```text
ArrayBuffer
 ↓ ZIP検査
 ↓ 必要なXML/XHTMLだけ展開
 ↓ META-INF/container.xml
 ↓ OPF manifest/spine/metadata
 ↓ 暗号化・固定レイアウト判定
 ↓ spine順にXHTML抽出
 ↓ nav/NCXから目次
 ↓ Section/TextBlock生成
```

### 12.2 ZIP検査

- 圧縮サイズ100 MB以下
- entry数10,000以下
- 宣言展開サイズ合計300 MB以下
- 単一テキストentry 20 MB以下
- NUL、絶対パス、ルート外`..`を拒否
- 正規化後の重複パスを警告

展開対象は`mimetype`, `META-INF/*.xml`, `.opf`, `.ncx`, `.xhtml`, `.html`, `.htm`等の必要なテキストに限定し、画像・音声・動画・フォント・CSS・JavaScriptは展開しない。

### 12.3 container.xml / OPF

- `META-INF/container.xml`必須
- 最初のrootfileを既定renditionとして使用
- OPFからtitle, creator, language, manifest, spine, nav, NCX, rendition layoutを取得
- spineの`linear="no"`は本文読書順から除外

### 12.4 固定レイアウト

`rendition:layout=pre-paginated`等を検出した場合、警告して取込みを中止する。

### 12.5 暗号化

`encryption.xml`を調べる。

- spine本文が暗号化対象: 中止
- フォントだけ: フォントを使わないため継続可
- 判定不能: 中止し暗号化・DRMの可能性を案内

DRM解除は実装しない。

### 12.6 XHTML

`application/xhtml+xml`でDOMParserし、parsererror時だけ`text/html`を試す。

除外: `script`, `style`, `noscript`, `template`, `iframe`, `object`, `embed`, `svg`, `math`, `audio`, `video`, `canvas`。

抽出: `h1`〜`h6`, `p`, `li`, `blockquote`, `pre`, `table`, 意味のある`div`/`section`。

`ruby`は親文字を保持し、`rt`と`rp`は除外する。

### 12.7 目次

優先順:

1. EPUB 3 Navigation Document
2. EPUB 2 NCX
3. spine item先頭見出し

章名を正規表現で推測しない。

---

## 13. 日本語チャンク生成

```text
TextBlock
 ↓ 解析用正規化
 ↓ 文境界
 ↓ 保護スパン
 ↓ BudouXフレーズ列
 ↓ 境界候補
 ↓ 動的計画法で再構成
 ↓ 長大フレーズfallback
 ↓ 整合性検証
 ↓ 表示時間付与
```

### 13.1 正規化

NFKCは使用しない。解析用に行うのは、改行統一、BOM/NUL除去、NBSP変換、散文内の連続水平空白縮約に限定する。

チャンク連結結果は解析用本文と一致しなければならない。

### 13.2 文境界

文末候補は`。！？!?`、段落末、見出し末。文末記号直後の閉じ括弧・引用符は同じ文へ含める。読点は文境界ではなく、強いチャンク境界候補とする。

### 13.3 保護スパン

優先順位:

1. インラインコード
2. URL
3. メール
4. 日付・時刻・期間
5. 数字＋単位
6. 条項番号
7. 英字略称・製品番号
8. 括弧と隣接短文字

重複時は開始位置が早く、より長く、優先度が高いものを採用する。

初期例:

```ts
const URL_PATTERN = /https?:\/\/[^\s<>()]+/gu;
const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[A-Za-z]{2,}/gu;
const DATE_PATTERN = /(?:令和|平成|昭和)?\s*\d{1,4}年\s*\d{1,2}月(?:\s*\d{1,2}日)?/gu;
const TIME_PATTERN = /\d{1,2}:\d{2}(?:\s*[〜～-]\s*\d{1,2}:\d{2})?/gu;
const ARTICLE_PATTERN = /第\s*[一二三四五六七八九十百千万0-9]+\s*(?:条|項|号)/gu;
```

数字＋単位は別途、%、t、kg、m²、m³、L、円、人、件、日、年等を定数化する。

### 13.4 BudouX

- Worker起動時に日本語parserを1回生成
- 文単位でparse
- 出力連結が入力文と一致することを検証
- 不一致文だけfallback処理
- BudouX境界は強い候補だが必須境界ではない

### 13.5 プリセット

| 設定 | target | softMin | softMax | hardMax |
|---|---:|---:|---:|---:|
| short | 11 | 6 | 16 | 24 |
| standard | 16 | 8 | 24 | 32 |
| long | 23 | 12 | 32 | 44 |

完全保護スパン、見出し、短文は例外とする。

### 13.6 動的計画法

貪欲結合では文末に短片が残りやすいため、1文内の候補境界を動的計画法で最適化する。

```text
cost =
  lengthDeviation
  + tooShortPenalty
  + tooLongPenalty
  + orphanPenalty
  + bracketPenalty
  + protectedSplitPenalty
  + fallbackPenalty
  - preferredBoundaryReward
```

長さ偏差:

```text
((length - target) / target)² × 10
```

境界優先度:

1. 文末・段落末
2. 読点・セミコロン
3. BudouX境界
4. 空白・中点・スラッシュ
5. fallback文字境界

形態素解析を使わないため、`は`, `が`, `を`, `に`, `の`, `です`, `ます`, `である`等だけからなる短いチャンクに表層規則で強いペナルティを与える。

最大結合候補`k=8`とし、計算量を`O(nk)`に制限する。

### 13.7 fallback

長大フレーズの分割優先順:

1. 句読点
2. 空白
3. 中点
4. スラッシュ
5. ハイフン
6. 閉じ括弧後
7. 書記素クラスタ境界

書記素クラスタは`Intl.Segmenter('ja', { granularity: 'grapheme' })`を優先し、なければ`Array.from()`を使う。サロゲートペア、結合文字、絵文字列の途中で切らない。

### 13.8 IDとversion

```text
chunkId = SHA-256先頭24文字(
  chunkingVersion + documentId + sectionId + sourceStart + sourceEnd + text
)
```

初期`chunkingVersion`は`yp-chunk-1`。正規化、保護規則、BudouX主要版、コスト、fallback規則の変更時に更新する。

---

## 14. 表示時間

```text
baseMs = visibleCharacters / CPM × 60,000
contentMs = baseMs × contentFactor
finalMs = clamp(contentMs + pauseMs, 280, 5,000)
```

`visibleCharacters`は書記素クラスタ数から空白・改行を除いた数。句読点は含む。

内容補正:

| 条件 | 補正 |
|---|---:|
| 漢字・英字・数字混在 | +0.08 |
| 数字＋単位 | +0.12 |
| 5文字以上の英字列 | +0.10 |
| 括弧・引用 | +0.05 |
| 見出し | +0.15 |
| URL | 専用係数1.60 |
| fallback | +0.05 |

通常係数は最大1.45。

標準休止:

| pauseClass | ms |
|---|---:|
| none | 0 |
| comma | 140 |
| sentence | 300 |
| paragraph | 500 |
| section | 800 |

smallは0.6倍、largeは1.5倍。速度変更は現在チャンクを短縮せず、次チャンクから反映する。

---

## 15. Worker

Workerへ移す処理:

- 正規化
- 文分割
- 保護スパン
- BudouX
- 動的計画法
- fallback
- timing
- 検証

Markdown/EPUBのDOMParser処理はメインスレッドでセクション単位に行い、セクション間でイベントループへ制御を返す。

```ts
type WorkerRequest =
  | { type: 'initialize'; config: ChunkingConfig }
  | { type: 'process-section'; jobId: string; section: WorkerSectionInput }
  | { type: 'cancel'; jobId: string };

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'progress'; jobId: string; completed: number; total: number }
  | { type: 'section-result'; jobId: string; result: WorkerSectionResult }
  | { type: 'cancelled'; jobId: string }
  | { type: 'error'; jobId: string; error: SerializableError };
```

1セクション完了ごとに返し、全チャンクをWorker内に保持しない。遅れて届いた旧jobIdの結果は破棄する。

---

## 16. Reader Runtime

状態:

```ts
type ReaderState = 'loading' | 'paused' | 'playing' | 'blocked' | 'completed' | 'error';
```

`setInterval`は使わず、`performance.now()`と`setTimeout`で次の絶対期限を管理する。遅延しても複数チャンクを飛ばして追いつかない。

`visibilitychange`でhiddenになったら自動停止し、復帰時に自動再開しない。

Chunk Providerは現在・前・次の3ページを基本的にメモリへ保持し、ページ端で先読みする。

位置保存契機:

- 移動後1秒debounce
- 一時停止
- モード変更
- 章移動
- hidden
- pagehide
- 読了

コード・表では自動再生を停止し、「読む」「スキップ」「閉じる」を表示する。

---

## 17. 表示モード

### 17.1 コンテキスト（既定）

- 前チャンクを薄く小さく表示
- 現在チャンクを主表示
- 次チャンクを薄く小さく表示
- 非散文境界を越えてプレビューしない

### 17.2 ハイライト

- 現在ブロック全体を表示
- 各チャンクを`span`＋Text Nodeで生成
- 現在へ`aria-current="true"`
- 現在が画面外に出る時だけスクロール

### 17.3 フォーカス

- 現在チャンクだけを中央表示
- 左タップ: 前、右: 次、中央: 再生停止
- 初回だけ前後文脈が見えない旨を案内

モード切替では位置、速度、再生状態を維持する。描画中だけ停止し、完了後に再開する。

---

## 18. 操作

| キー | 操作 |
|---|---|
| Space | 再生・停止 |
| ← / → | 前後チャンク |
| Shift＋← / → | 前後文 |
| Ctrl/⌘＋← / → | 前後段落 |
| ↓ / ↑ | 25文字/分単位で速度変更 |
| F | 全画面 |
| Esc | 全画面・ダイアログを閉じる |

入力欄や操作部へフォーカス中はグローバルキーを奪わない。

タッチ:

- 中央タップ: 再生停止
- 左右タップ: 前後チャンク
- 左右スワイプ: 文単位移動

ボタン、スライダー、スクロール要素から始まったジェスチャーは読書操作にしない。

---

## 19. UI・アクセシビリティ

- 文章を主役とし、速度を成績化しない
- スマートフォン縦持ちを基準
- 本文幅: `min(72ch, calc(100vw - 32px))`
- フォーカス幅: `min(28ch, calc(100vw - 40px))`
- 既定本文20px、調整16〜40px
- 既定行間1.75、調整1.4〜2.2
- system UI、日本語OSフォントを使用
- 外部Webフォントなし
- タップ領域44×44 CSS px相当
- 200％ズームで主要機能欠落なし
- 色だけで状態を示さない
- focus ringを消さない

チャンク切替ごとにARIA live更新しない。スクリーンリーダー向けには自動再生を止めた通常本文表示を提供する。

`prefers-reduced-motion`時はフェード、smooth scroll、ツールバー移動を無効化する。

---

## 20. エラー

```ts
type ErrorCode =
  | 'UNSUPPORTED_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_ENCODING'
  | 'INVALID_EPUB'
  | 'EPUB_FIXED_LAYOUT'
  | 'EPUB_ENCRYPTED'
  | 'EPUB_ZIP_BOMB_RISK'
  | 'TEXT_TOO_LARGE'
  | 'CHUNKING_FAILED'
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_QUOTA'
  | 'IMPORT_CANCELLED'
  | 'DOCUMENT_NOT_FOUND'
  | 'UNKNOWN';
```

表示には、何が起きたか、既存データへの影響、次にできることを含める。

consoleや診断ログへ本文、タイトル、ファイル名を出さない。記録可能なのはerror code、stage、所要時間、ファイルサイズ、件数、機能対応状況までとする。

---

## 21. セキュリティ

CSP meta:

```text
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
worker-src 'self' blob:;
object-src 'none';
base-uri 'none';
form-action 'self';
```

- inline script/styleを使わない
- 本文へ`innerHTML`を使わない
- EPUB内URLをfetchしない
- EPUB CSS/JSを適用しない
- 外部画像を表示しない
- ZIP宣言サイズと実展開サイズを検証
- 絶対パス、`../`、NULを拒否

---

## 22. PWA

`vite-plugin-pwa`の`injectManifest`で`sw.ts`をビルドする。

precache:

- HTML
- JS
- CSS
- アイコン
- BudouXモデルを含むアセット

利用者文書はCache Storageへ入れずIndexedDBだけに保存する。

更新:

1. waiting worker検出
2. 非モーダル通知
3. 利用者が更新を選択
4. 位置保存
5. `SKIP_WAITING`
6. `controllerchange`後に一度reload

自動再生中に強制reloadしない。

---

## 23. 読書履歴

最初の移動または再生時にセッション開始。画面終了、10分無操作、pagehide、読了で終了する。

保存期間:

- 保存しない
- 30日
- 180日（既定）
- 無期限

記録するのは開始終了位置、読了文字数、active playback、総経過、戻る回数、停止回数、平均設定CPM、使用モード。能力や失敗として評価しない。

---

## 24. チャンク品質確認

v0.1.0は編集せず、次を表示する。

- 前後3チャンク
- 文字数
- sourceStart/sourceEnd
- 境界種別
- 保護スパン
- fallback
- 表示時間

操作:

- 問題箇所をコピー
- 別プリセットで再チャンク
- ゴールデンテスト候補JSONをローカル保存

コピーには対象前後だけを含め、文書全体を含めない。

---

## 25. 再チャンク化

旧位置の`documentOffset`を保持し、新チャンクの

```text
chunk.documentStart <= oldOffset < chunk.documentEnd
```

を満たす位置へ移行する。

新チャンク列は別の一時キー空間へ保存し、全セクション完了後に参照を切り替える。失敗時は旧列を保持する。

---

## 26. 性能

- 10万文字TXT/Markdown: 近年スマートフォンで5秒以内を目標
- 100万文字: 進捗表示、UIをブロックしない
- 読書中: 目立つフレーム落ちなし
- ライブラリ: 本文を読み込まない
- EPUB画像を展開しない
- セクション単位で解析・保存
- 読書中は3チャンクページを基本

章のDOM抽出間ではイベントループへ制御を返す。`requestIdleCallback`はSafari前提にせず補助的にだけ使う。

---

## 27. テスト

### 27.1 単体

- TXT文字コード
- Markdown token変換
- EPUBパス、container、OPF、XHTML
- 正規化、文境界、保護スパン
- BudouX再結合
- 動的計画法
- fallback
- timing
- 位置移行
- 履歴保持期限

チャンク処理はDOM/IndexedDBなしでテスト可能にする。

### 27.2 ゴールデン

ケース:

- 一般記事
- 行政文書
- 法令・条項
- 数字・単位
- 日付・時刻
- 英字略称
- URL・メール
- 括弧・引用
- 会話文
- 長い無句読点文
- Markdown
- EPUB由来改行
- 絵文字・結合文字
- 古典的表記

期待値更新は専用scriptで行い、PR差分を人が確認する。

### 27.3 E2E

Playwright:

- Chromium desktop
- WebKit desktop
- mobile Chromium emulation
- mobile WebKit emulation

シナリオ:

1. 貼付け→取込み→読書→再起動→復元
2. TXT取込み
3. Markdownコードブロック停止
4. EPUB spine順
5. 3モード切替
6. キーボード
7. オフライン
8. SW更新
9. キャンセル後に壊れた文書なし
10. 再チャンク位置移行

### 27.4 セキュリティfixture

- script入りMarkdown/EPUB
- event handler属性
- 外部画像URL
- `../` ZIP entry
- ZIP bomb風サイズ
- 暗号化spine
- 固定レイアウト

外部ネットワークリクエストが発生しないことを確認する。

---

## 28. GitHub Actions

`yomu-pace/**`変更時に次を実行する。

1. `npm ci`
2. lint
3. typecheck
4. unit/golden
5. production build
6. Playwright Chromium smoke
7. build artifact保存

WebKitは実行時間を見てPR毎またはmain/手動へ分ける。

---

## 29. 実装段階

### Phase 1 基盤

Vite、TypeScript、Router、CSS、IndexedDB、ライブラリ、設定、PWA skeleton。

### Phase 2 TXT/貼付け＋チャンク

Worker、BudouX、保護スパン、DP、timing、ゴールデンテスト。

### Phase 3 Reader

状態機械、Scheduler、前後移動、3モード、履歴、品質確認、アクセシビリティ。

### Phase 4 Markdown

Marked lexer、構造変換、コード・表固定表示、生HTMLテキスト抽出。

### Phase 5 EPUB

fflate、ZIP検査、OCF/OPF/spine、XHTML、nav/NCX、暗号化・固定レイアウト判定。

### Phase 6 品質・配信

Playwright、PWA更新、実機調整、Pages統合、第三者ライセンス。

---

## 30. 受入テスト

- **AT-01** 貼付け、タイトル生成、取込み、読書
- **AT-02** UTF-8 TXT、段落保持、再起動後読書
- **AT-03** Shift_JISを文字化け保存せず拒否
- **AT-04** Markdown構造保持、コード・表で停止、script不実行
- **AT-05** EPUB 2/3をspine順、目次移動
- **AT-06** 固定レイアウト、暗号化、ZIP bombを拒否、外部通信なし
- **AT-07** URL、20m3、第6条、括弧、句読点の分割品質
- **AT-08** 再生停止、前後、文段落移動、速度、モード切替
- **AT-09** 読書位置復元
- **AT-10** バックグラウンドで停止し、復帰時に進まない
- **AT-11** オフライン起動・読書・ローカル取込み
- **AT-12** 更新通知、位置保存、強制reloadなし

---

## 31. 将来のPDF対応

Importerは次の契約を共通化する。

```ts
interface DocumentImporter {
  supports(input: ImportInput): boolean;
  inspect(input: ImportInput, signal: AbortSignal): Promise<ImportPreview>;
  extract(input: ImportInput, signal: AbortSignal): AsyncIterable<ExtractedSection>;
}
```

将来のPDF importerも`SectionRecord`と`TextBlock`を返し、チャンク・Reader・保存を再利用する。

PDF位置情報候補:

```ts
interface PdfSourceLocation {
  pageNumber: number;
  itemStart?: number;
  itemEnd?: number;
  boundingBoxes?: Array<{ x: number; y: number; width: number; height: number }>;
}
```

v0.1.0ではPDF用実装を先行追加しない。

---

## 32. 既知の制約

- BudouXは係り受け解析器ではなく、全ての意味境界を保証しない
- 形態素解析なしでは助詞・助動詞判定は限定的
- EPUB CSS上の視覚読順を完全再現しない
- EPUB脚注、縦書き、複雑な注釈は完全対応しない
- 大容量EPUBは端末性能に左右される
- iOSストレージはOS判断で削除される可能性がある
- GitHub PagesのCSPはmetaで可能な範囲に限られる
- 速度上昇は理解度向上を意味しない

---

## 33. 実装開始時の確認

1. `miscellaneous`の現行Pages公開方式
2. Node採用LTS
3. 依存の安定版、ライセンス、脆弱性
4. BudouXのWorker初期化時間とバンドルサイズ
5. fflate filter/streaming API
6. Marked token型
7. iOS SafariのIndexedDB/PWA/Worker
8. テストEPUBの再配布可否

---

## 34. 完了定義

- 要件定義のMustを満たす
- AT-01〜AT-12を満たす
- unit/golden/E2E必須テスト成功
- iPhone Safari、Windows 11 Chrome/Edgeで実機確認
- 外部LLM、Gemini Nano、kuromoji.jsを含まない
- 本文を外部送信しない
- TXT、Markdown、DRMなしリフロー型EPUBをオフライン取込み可能
- 3モード、読み戻し、位置復元が機能
- THIRD_PARTY_NOTICES整備
- 既存`miscellaneous`アプリを破壊しない
