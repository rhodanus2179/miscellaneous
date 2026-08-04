# Yomu Pace v0.1.0 実装設計書（静的構成版）

- 対象プロダクト: `Yomu Pace`（仮称）
- 対象版: v0.1.0
- 上位文書: [`REQUIREMENTS_STATIC.md`](./REQUIREMENTS_STATIC.md)
- リポジトリ: `rhodanus2179/miscellaneous`
- 配置先: `yomu-pace/`
- 公開方式: GitHub Pagesからの静的配信
- 本番ビルド: なし
- 実装言語: HTML / CSS / JavaScript ES Modules
- 対応入力: 貼り付け、TXT、Markdown
- データ処理: 端末内完結
- 作成日: 2026-08-04
- 状態: 旧実装設計を置き換える再設計案

---

## 1. 設計目的

本書は、Yomu Paceを、mainブランチへ静的ファイルを配置するだけでGitHub Pagesから利用できるアプリとして設計し直す。

初期版の優先順位は次のとおりとする。

1. iPhoneを含む実機テストの容易さ
2. 日本語チャンク品質
3. 読み戻しやすさ
4. 端末内完結
5. コードの読みやすさと変更の容易さ
6. 高速化や対応形式の多さ

旧設計で採用したTypeScript、Vite、npmランタイム依存、Dedicated Worker、EPUB解析は、v0.1.0では採用しない。

---

## 2. 設計判断

| 項目 | v0.1.0の決定 |
|---|---|
| 本番コード | Vanilla JavaScript ES2022 |
| ビルド | 行わない |
| 配信 | mainの`yomu-pace/`をGitHub Pagesで直接配信 |
| ルーティング | Hash Router |
| 日本語分割 | Vendored BudouX＋独自規則＋動的計画法 |
| Markdown | 自作の限定的な行ベースパーサー |
| TXT | UTF-8必須、UTF-16 BOM付きは可能な範囲で対応 |
| EPUB | 非対応 |
| PDF | 将来対応 |
| Web Worker | 初期版では使わない |
| 長文処理 | 協調的バッチ処理＋定期yield |
| 保存 | ネイティブIndexedDBを薄いPromiseラッパーで使用 |
| PWA | 手書きService Worker＋manifest |
| 実行時外部通信 | なし |
| 実行時依存 | リポジトリ同梱のBudouXのみ |
| テスト | Node標準テストを中心とし、本番ビルドは生成しない |

### 2.1 なぜWeb Workerを外すか

チャンク生成は文またはブロックごとに分割できる。各バッチの間でイベントループへ制御を返せば、初期版の上限内ではUI応答性を保てる可能性が高い。

Workerを外すことで次が単純になる。

- モジュールパス
- iPhone Safariでの検証
- BudouXの二重読込み
- キャンセル処理
- エラー伝達
- Service Workerキャッシュ一覧
- file配置

性能測定で不足が確認された場合は、チャンクエンジンの純粋関数を後からWorkerへ移す。

### 2.2 なぜMarkdownライブラリを外すか

Yomu PaceはMarkdownをHTMLとして完全表示するアプリではない。見出し、段落、リスト、引用、コード、表の順序と本文を取得できればよい。

限定パーサーとすることで次を得る。

- ランタイム依存削減
- raw HTMLを実行しない明確な安全性
- ビルド不要
- 仕様範囲の説明可能性
- Markdown token仕様変更の影響回避

CommonMark完全準拠は目標にしない。

---

## 3. 全体アーキテクチャ

```text
┌────────────────────────────────────────────────────┐
│ index.html / App Shell                            │
│ Library / Import / Reader / Detail / Settings     │
└───────────────────┬────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────┐
│ Application Services                              │
│ ImportService / DocumentService / ReaderService   │
└──────────────┬───────────────────────┬─────────────┘
               │                       │
               ▼                       ▼
┌──────────────────────────┐  ┌──────────────────────┐
│ Import Pipeline          │  │ Reader Runtime       │
│ Paste / TXT / Markdown   │  │ State / Scheduler    │
└──────────────┬───────────┘  └──────────┬───────────┘
               │                         │
               ▼                         ▼
┌────────────────────────────────────────────────────┐
│ Chunk Engine                                      │
│ Normalize / Protect / BudouX / Optimize / Timing  │
└───────────────────┬────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────────────┐
│ Native IndexedDB Repositories                     │
└────────────────────────────────────────────────────┘
```

### 3.1 レイヤー責務

- UI: DOM描画、入力、操作、アクセシビリティ、状態表示
- Application: 取込み、保存、再開、削除、再チャンク化
- Domain: 文書型、チャンク処理、時間計算、Reader状態
- Infrastructure: IndexedDB、File API、Service Worker、BudouX

### 3.2 依存方向

```text
UI → Application → Domain
                   ↑
Infrastructure ────┘
```

DomainモジュールはDOM、IndexedDB、Service Workerへ依存しない。

---

## 4. ディレクトリ構成

```text
yomu-pace/
├─ index.html
├─ styles.css
├─ manifest.webmanifest
├─ sw.js
├─ README.md
├─ REQUIREMENTS_STATIC.md
├─ DESIGN_STATIC.md
├─ THIRD_PARTY_NOTICES.md
├─ icons/
│  ├─ icon-192.png
│  └─ icon-512.png
├─ js/
│  ├─ main.js
│  ├─ app.js
│  ├─ config.js
│  ├─ router.js
│  ├─ types.js                 # JSDoc typedef集
│  ├─ dom.js
│  ├─ import/
│  │  ├─ import-service.js
│  │  ├─ paste-importer.js
│  │  ├─ text-importer.js
│  │  └─ markdown-importer.js
│  ├─ chunking/
│  │  ├─ index.js
│  │  ├─ normalize.js
│  │  ├─ sentence.js
│  │  ├─ protected-ranges.js
│  │  ├─ candidates.js
│  │  ├─ optimizer.js
│  │  ├─ timing.js
│  │  └─ version.js
│  ├─ reader/
│  │  ├─ controller.js
│  │  ├─ scheduler.js
│  │  ├─ navigation.js
│  │  └─ session-recorder.js
│  ├─ storage/
│  │  ├─ db.js
│  │  ├─ documents.js
│  │  ├─ positions.js
│  │  ├─ settings.js
│  │  └─ sessions.js
│  ├─ screens/
│  │  ├─ library-screen.js
│  │  ├─ import-screen.js
│  │  ├─ reader-screen.js
│  │  ├─ document-screen.js
│  │  └─ settings-screen.js
│  └─ utils/
│     ├─ async.js
│     ├─ ids.js
│     ├─ text.js
│     └─ errors.js
├─ vendor/
│  └─ budoux/
│     ├─ module/
│     └─ LICENSE
├─ tests/
│  ├─ chunking.test.mjs
│  ├─ markdown.test.mjs
│  ├─ timing.test.mjs
│  ├─ fixtures/
│  └─ golden/
└─ scripts/
   ├─ check-static-imports.mjs
   ├─ check-sw-assets.mjs
   └─ check-external-urls.mjs
```

### 4.1 ファイル数について

単一HTMLにはせず、責務別のES Modulesへ分ける。GitHub Pagesは静的なJavaScript Modulesを配信できるため、バンドルは不要である。

### 4.2 JSDoc

型の意図はJSDocで残す。

```js
/**
 * @typedef {Object} ReadingChunk
 * @property {string} id
 * @property {string} text
 * @property {number} sourceStart
 * @property {number} sourceEnd
 * @property {'none'|'comma'|'sentence'|'paragraph'|'section'} pauseClass
 * @property {number} durationMsAtBaseRate
 */
```

TypeScriptの完全な代替ではないが、エディタ補完とレビュー性を確保する。

---

## 5. 本番依存

### 5.1 BudouX

BudouXのブラウザ向けES Moduleを`vendor/budoux/`へ同梱する。

```js
import { loadDefaultJapaneseParser } from '../../vendor/budoux/module/index.js';
```

方針:

- 実行時にunpkg等へ接続しない
- 公式配布物から必要なmodule subtreeを取得する
- Apache-2.0ライセンスを保持する
- バージョンを`THIRD_PARTY_NOTICES.md`に記録する
- 更新は独立PRで行う

### 5.2 その他

本番実行時の外部JavaScriptライブラリは追加しない。

- IndexedDB: ブラウザ標準API
- Markdown: 自作限定パーサー
- PWA: ブラウザ標準API
- Router: 自作Hash Router
- テスト: 本番コードへ含めない

---

## 6. 配信方式

### 6.1 公開物

`yomu-pace/`配下のファイルがそのまま公開物である。

```text
Git commit
   ↓
mainへmerge
   ↓
GitHub Pagesが静的配信
   ↓
iPhone SafariでURLを開く
```

ビルド、artifact展開、distコピーを挟まない。

### 6.2 URL

```text
https://rhodanus2179.github.io/miscellaneous/yomu-pace/
```

`index.html`内の参照はすべて`./`起点の相対パスとする。

### 6.3 ルーティング

Hash Routerを使う。

```text
#/library
#/import
#/reader/<documentId>
#/document/<documentId>
#/settings
```

GitHub Pages側のSPA fallbackは不要である。

### 6.4 ルートアプリ一覧

実装完了後、リポジトリルートの`index.html`へYomu Paceカードを追加する。設計PRでは追加しない。

---

## 7. HTML構成

`index.html`はApp Shellだけを持つ。

```html
<body>
  <header id="app-header"></header>
  <main id="app" tabindex="-1"></main>
  <div id="toast-region" aria-live="polite"></div>
  <script type="module" src="./js/main.js"></script>
</body>
```

原文をHTML文字列として挿入しない。

### 7.1 CSP

GitHub PagesではHTTPヘッダーを自由に設定できないため、`meta` CSPを使用する。

初期方針:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'none';
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
```

インラインstyleを減らせる場合は`unsafe-inline`も除去する。

---

## 8. データモデル

### 8.1 DocumentMetadata

```js
{
  id,
  schemaVersion: 1,
  status: 'staging' | 'ready' | 'failed',
  title,
  author,
  sourceType: 'paste' | 'txt' | 'markdown',
  sourceFileName,
  importedAt,
  updatedAt,
  lastOpenedAt,
  characterCount,
  blockCount,
  chunkCount,
  chunkingVersion,
  warnings
}
```

### 8.2 DocumentContent

```js
{
  documentId,
  sourceText,
  normalizedText,
  blocks,
  chunks
}
```

初期版では1文書を1つのcontent recordとして保存する。2,000,000文字上限内で実機確認し、容量や読込み速度に問題があれば後からページ分割する。

### 8.3 TextBlock

```js
{
  id,
  order,
  kind: 'heading' | 'paragraph' | 'list-item' | 'quote' | 'code' | 'table' | 'separator',
  text,
  sourceStart,
  sourceEnd,
  level,
  autoPlayable
}
```

### 8.4 ReadingChunk

```js
{
  id,
  order,
  blockId,
  sentenceId,
  text,
  sourceStart,
  sourceEnd,
  visibleCharacterCount,
  kind,
  pauseClass,
  durationMsAtBaseRate,
  autoPlayable,
  flags: {
    hasNumber,
    hasUnit,
    hasLatin,
    hasUrl,
    hasBrackets,
    usedFallbackSplit
  }
}
```

### 8.5 ReadingPosition

```js
{
  documentId,
  chunkOrder,
  chunkId,
  sourceOffset,
  progress,
  mode,
  updatedAt
}
```

チャンク仕様変更後にIDが見つからない場合は`sourceOffset`から最寄り位置を復元する。

### 8.6 ReaderSettings

```js
{
  mode: 'context' | 'highlight' | 'focus',
  charactersPerMinute: 600,
  chunkLength: 'short' | 'standard' | 'long',
  punctuationPause: 'small' | 'standard' | 'large',
  fontSizePx: 28,
  lineHeight: 1.7,
  contentWidthCh: 42,
  theme: 'system' | 'light' | 'dark',
  reducedMotion: false,
  swipeEnabled: true,
  sessionRetention: '180d'
}
```

---

## 9. IndexedDB

- DB名: `yomu-pace`
- version: `1`

| Store | Key | Index |
|---|---|---|
| `documents` | `id` | `status`, `lastOpenedAt`, `updatedAt` |
| `contents` | `documentId` | なし |
| `positions` | `documentId` | `updatedAt` |
| `settings` | `key` | なし |
| `sessions` | `id` | `documentId`, `startedAt` |

### 9.1 薄いPromiseラッパー

`storage/db.js`に次だけを実装する。

- `openDatabase()`
- `requestToPromise(request)`
- `transactionDone(transaction)`
- `withStore(storeName, mode, callback)`

ライブラリ相当の大きな抽象化は作らない。

### 9.2 ステージング

取込み手順:

1. `documents`へ`status: staging`
2. contentを生成
3. `contents`へ保存
4. 件数・文字数・連結整合性を検証
5. `documents`を`ready`へ変更

ライブラリには`ready`だけを表示する。

失敗時は同一documentIdを削除する。起動時に24時間以上残ったstagingを掃除する。

### 9.3 更新移行

DB schema変更時はversionを上げ、既存データを削除せず移行する。移行失敗時はアプリを通常起動せず、バックアップ案内とエラーを表示する。

---

## 10. 取込みパイプライン

```text
入力
 ↓
形式・サイズ検証
 ↓
原文取得
 ↓
TextBlock生成
 ↓
チャンク生成（協調バッチ）
 ↓
整合性検証
 ↓
IndexedDB保存
 ↓
ready化
```

進捗:

```js
'reading' | 'parsing' | 'chunking' | 'saving' | 'finalizing'
```

AbortControllerを使い、各段階で`signal.aborted`を確認する。

---

## 11. TXT取込み

### 11.1 デコード順

1. UTF-8 BOM
2. UTF-16LE BOM
3. UTF-16BE BOM
4. BOMなしUTF-8をfatal decode
5. 失敗時は非対応文字コード

置換文字を大量に含む状態で自動保存しない。

### 11.2 原文と解析用本文

- `sourceText`: デコード後の文字列を保持
- `normalizedText`: 改行、BOM、NUL、NBSP、連続空白を解析用に整形

NFKCによる全文変換は行わない。

### 11.3 TextBlock

空行2個以上を段落境界とする。単一改行は原則として同一段落内の空白として扱う設定を用意してもよいが、初期版は改行を保持する。

---

## 12. Markdown取込み

### 12.1 対応範囲

行を上から順に状態機械で処理する。

状態:

```js
'normal' | 'fenced-code' | 'table'
```

判定順:

1. fenced code開始・終了
2. ATX見出し
3. 水平線
4. 引用
5. 箇条書き
6. 番号付きリスト
7. table header＋delimiter
8. 空行
9. 段落継続

### 12.2 インライン処理

HTML化せず、表示文字列だけを抽出する。

- `[表示](URL)` → `表示`
- `![alt](URL)` → `alt`
- `` `code` `` → `code`かつ保護範囲
- `**strong**` → `strong`
- `*em*` → `em`
- raw HTML → 通常文字列または除外

複雑な入れ子は完全対応しない。原文を失わず、安全にプレーンテキスト化することを優先する。

### 12.3 非散文

- fenced code block: `kind: code`, `autoPlayable: false`
- table: `kind: table`, `autoPlayable: false`

Readerは非散文で自動停止し、全文固定表示と「次へ」を提供する。

---

## 13. チャンクエンジン

### 13.1 パイプライン

```text
TextBlock
 ↓ normalize
 ↓ sentence ranges
 ↓ protected ranges
 ↓ BudouX phrases
 ↓ candidate boundaries
 ↓ dynamic programming
 ↓ fallback split
 ↓ validation
 ↓ timing
```

### 13.2 正規化

解析用に限定する。

- CRLF / CR → LF
- 先頭BOM除去
- NUL除去
- NBSP → space
- 散文内の連続水平空白縮約

原文位置対応が崩れる変換を追加する場合は、offset mapを導入するまでは採用しない。

### 13.3 文境界

文末候補:

- `。`
- `！` / `!`
- `？` / `?`
- 段落末
- 見出し末

ただし、URL、メール、インラインコード等の保護範囲内にある記号は文末として扱わない。

文末直後の閉じ括弧・引用符は同じ文へ含める。

### 13.4 保護範囲

優先順:

1. インラインコード
2. URL
3. メール
4. 日付・時刻・期間
5. 数字＋単位
6. 法令条項
7. 英字略称・製品番号

重複時は開始が早く、長く、優先度が高い範囲を採用する。

URLパターンは日本語本文を巻き込まないASCII中心の範囲とし、末尾句読点を除外する。

### 13.5 BudouX

アプリ起動後、初回チャンク生成時に日本語parserを1回生成し再利用する。

```js
const parser = loadDefaultJapaneseParser();
const phrases = parser.parse(sentence);
```

必須検証:

```js
phrases.join('') === sentence
```

不一致時はBudouX境界を使わずfallback候補だけで処理する。

BudouX境界は強い候補であり、必須境界ではない。

### 13.6 候補境界

- 文頭・文末
- BudouXフレーズ末
- 読点・セミコロン・コロン後
- 空白・中点・スラッシュ後
- 書記素クラスタ境界

保護範囲内部の候補は除外する。

### 13.7 動的計画法

貪欲結合では文末に短片が残るため、文全体のコストを最小化する。

```text
cost =
  lengthDeviation
  + tooShortPenalty
  + tooLongPenalty
  + particleOnlyPenalty
  + bracketPenalty
  + protectedPenalty
  + fallbackPenalty
  - preferredBoundaryReward
```

長さ偏差:

```text
((length - target) / target)² × 10
```

強いペナルティ:

- 助詞・助動詞だけ
- 句読点だけ
- 閉じ括弧から始まる
- 開き括弧で終わる
- hardMax超過

境界優先度:

1. 文末
2. 読点等
3. BudouX境界
4. 空白等
5. fallback

計算量は候補数に対して最大遡及数を制限し、概ね`O(nk)`とする。

### 13.8 fallback

優先順:

1. 句読点
2. 空白
3. 中点
4. スラッシュ
5. ハイフン
6. 閉じ括弧後
7. 書記素クラスタ境界

`Intl.Segmenter('ja', { granularity: 'grapheme' })`を使用し、利用不可時は`Array.from()`へfallbackする。

### 13.9 ID

暗号学的ハッシュは不要である。安定した軽量ハッシュで生成する。

```text
chunkId = hash(
  chunkingVersion,
  documentId,
  sourceStart,
  sourceEnd,
  text
)
```

`chunkingVersion`初期値は`yp-static-chunk-1`。

---

## 14. 協調的バッチ処理

### 14.1 基本

チャンク生成ループは、一定時間または一定文数ごとにブラウザへ制御を返す。

```js
async function yieldToBrowser() {
  if (globalThis.scheduler?.yield) {
    await globalThis.scheduler.yield();
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}
```

### 14.2 バッチ条件

いずれかを満たしたらyieldする。

- 20文処理
- 16ms以上経過
- 進捗1%以上増加

実機測定後に調整する。

### 14.3 キャンセル

各文処理前とyield後に`AbortSignal`を確認する。

キャンセル時:

- stagingデータを削除
- parserインスタンスは再利用
- ライブラリに失敗文書を表示しない
- 「取込みを中止しました」と表示

### 14.4 将来Worker化

`chunking/index.js`の公開関数はDOMやIndexedDBへ依存させない。将来は同じ関数群をWorkerからimportできるようにする。

---

## 15. 表示時間

```text
baseMs = visibleCharacters / CPM × 60,000
contentMs = baseMs × factor
finalMs = clamp(contentMs + pauseMs, 280, 5,000)
```

### 15.1 補正

| 条件 | 初期補正 |
|---|---:|
| 漢字・英字・数字混在 | +0.08 |
| 数字＋単位 | +0.12 |
| 5文字以上の英字列 | +0.10 |
| 括弧・引用 | +0.05 |
| 見出し | +0.15 |
| URL | 1.60固定 |
| fallback | +0.05 |

通常係数は最大1.45。

### 15.2 休止

| 種別 | 標準 |
|---|---:|
| none | 0ms |
| comma | 140ms |
| sentence | 300ms |
| paragraph | 500ms |
| section | 800ms |

smallは0.6倍、largeは1.5倍。

速度変更は次チャンクから反映し、現在表示中のチャンクを突然短縮しない。

---

## 16. Reader Runtime

### 16.1 状態

```js
'idle' | 'loading' | 'paused' | 'playing' | 'blocked' | 'completed' | 'error'
```

### 16.2 スケジューラ

`setInterval`は使わない。

- `performance.now()`で開始時刻を記録
- `setTimeout()`で1チャンクずつ進む
- 遅延しても複数チャンクを飛ばして追いつかない
- hidden時は停止
- 復帰時はpaused

### 16.3 移動

- 前後チャンク
- sentenceId単位
- blockId単位
- 先頭・末尾

移動時は自動再生を一度停止し、操作後に利用者が再開する方式を既定とする。モード切替だけは再生状態を維持してよい。

### 16.4 非散文

codeまたはtableへ到達したら`blocked`へ移行する。

画面:

- 全文固定表示
- 次へ
- 前へ
- 自動再生を再開

---

## 17. 表示モード

### 17.1 コンテキスト

```text
前チャンク（弱）
現在チャンク（強）
次チャンク（弱）
```

非散文境界を越えてプレビューしない。

### 17.2 ハイライト

現在ブロックをチャンクごとの`span`として構築する。本文は`textContent`で作る。

- 現在: `aria-current="true"`
- 読了済み: 視覚的に弱める
- 未読: 通常
- 現在が画面外へ出たときだけスクロール

### 17.3 フォーカス

現在チャンクだけを中央表示する。

タップ領域:

- 左25%: 前
- 中央50%: 再生停止
- 右25%: 次

操作部と重なる場合はボタン側を優先する。

---

## 18. 画面設計

### 18.1 ライブラリ

表示:

- タイトル
- 種別
- 進捗
- 文字数
- 最終読書日時

操作:

- 続きを読む
- 詳細
- 取込み
- 設定

### 18.2 取込み

タブ:

- 貼り付け
- ファイル

表示:

- タイトル
- 著者
- 本文またはファイル
- 形式
- 文字数・サイズ
- 取込み進捗
- キャンセル

### 18.3 Reader

- 文書タイトル
- 現在表示
- 再生停止
- 前後移動
- 速度
- 進捗
- モード切替
- 設定
- ライブラリへ戻る

読書に集中するため、操作部は一定時間で弱く表示してよいが、完全に発見不能にしない。

### 18.4 文書詳細

- メタデータ
- 進捗
- 原文表示
- チャンク確認
- 再チャンク化
- 削除

### 18.5 設定

- 表示モード
- 速度
- チャンク長
- 句読点休止
- 文字サイズ
- 行間
- 表示幅
- テーマ
- スワイプ
- 履歴保存
- データ全削除
- アプリ版

---

## 19. 入力操作

### 19.1 キーボード

| キー | 操作 |
|---|---|
| Space | 再生・停止 |
| ← / → | 前後チャンク |
| Shift＋← / → | 前後文 |
| Ctrl/⌘＋← / → | 前後段落 |
| ↓ / ↑ | 速度変更 |
| F | 全画面 |
| Esc | ダイアログ・全画面を閉じる |

input、textarea、select、buttonへフォーカス中はグローバルキーを奪わない。

### 19.2 タッチ

- タップ
- スワイプ
- 長押しは使用しない

スワイプの閾値は距離と速度の双方で判定し、縦スクロールを誤認しない。

---

## 20. Service Worker

### 20.1 方針

手書きの`sw.js`を使用する。

```js
const CACHE_VERSION = 'yomu-pace-static-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/main.js',
  // 必要な全静的資産
];
```

### 20.2 キャッシュ戦略

- App Shell: cache first
- navigation: network first、失敗時index
- 外部origin:取得しない
- 利用者ファイル: Cache Storageへ保存しない
- 本文: IndexedDBのみ

### 20.3 更新

- install時に新キャッシュ作成
- activate時に旧version削除
- 新Service Worker待機時に更新通知
- 利用者が更新を選んだら読書位置を保存
- `skipWaiting`は利用者操作後に実行

### 20.4 スコープ

```js
navigator.serviceWorker.register('./sw.js', { scope: './' });
```

`miscellaneous`配下の他アプリを制御しない。

---

## 21. manifest

最低項目:

```json
{
  "name": "Yomu Pace",
  "short_name": "Yomu Pace",
  "start_url": "./#/library",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f5f2ea",
  "theme_color": "#18392f",
  "icons": []
}
```

iPhone Safariではホーム画面追加を手動案内する。

---

## 22. セキュリティ

### 22.1 DOM

禁止:

```js
container.innerHTML = userText;
```

使用:

```js
container.textContent = userText;
```

MarkdownもTextBlockへ変換し、HTMLを画面へ渡さない。

### 22.2 ネットワーク

- `connect-src 'none'`
- fetchをアプリ機能に使用しない
- BudouXをローカル配信
- 外部画像を読込まない
- 外部リンクは表示文字列だけを扱う

### 22.3 ファイル

- 拡張子とMIMEを参考にするが、本文として安全にデコードする
- 実行可能ファイルを実行しない
- ファイル名は表示時にtextContent
- サイズ上限を読込み前に確認

### 22.4 ログ

診断情報:

- アプリ版
- ブラウザ機能可否
- エラー種別
- 処理時間
- 文字数・チャンク数

本文、タイトル、ファイル名は既定で含めない。

---

## 23. アクセシビリティ

- Semantic HTML
- 見出し順を維持
- ダイアログのフォーカストラップ
- フォーカス復帰
- 44px相当以上のタップ領域
- 200%ズーム対応
- `prefers-reduced-motion`
- `prefers-color-scheme`
- 色以外の状態表現
- ARIA liveは通知だけに限定
- 自動再生中の本文をスクリーンリーダーへ逐次読み上げない
- 通常本文表示を提供

---

## 24. エラー設計

分類:

```js
'unsupported-file'
'file-too-large'
'unsupported-encoding'
'empty-document'
'chunking-failed'
'storage-unavailable'
'storage-quota'
'document-not-found'
'service-worker-failed'
```

表示原則:

1. 何が起きたか
2. 既存データへの影響
3. 次にできること

例:

```text
このファイルの文字コードを読み取れませんでした。
文書は保存されていません。UTF-8形式へ変換して再度お試しください。
```

---

## 25. テスト設計

### 25.1 本番ビルドなし

CIは公開物を変換しない。リポジトリ内の静的ファイルをそのまま検証する。

### 25.2 Node標準テスト

テスト対象モジュールはDOM非依存のES Modulesとする。

```bash
node --test tests/*.test.mjs
```

必要ならルートまたは`yomu-pace/`に最小の`package.json`を置き、`type: module`だけを指定する。npm依存は持たない。

### 25.3 構文チェック

```bash
find js -name '*.js' -print0 | xargs -0 -n1 node --check
node --check sw.js
```

### 25.4 単体テスト

- normalize
- sentence ranges
- protected ranges
- URL内`?`
- BudouX再結合
- optimizer
- fallback
- timing
- Markdown block parser
- inline text extraction
- Reader navigation

### 25.5 ゴールデンテスト

JSON形式:

```json
{
  "name": "url-query",
  "input": "詳しくはhttps://example.com/path?q=123を確認してください。",
  "expectedChunks": []
}
```

差分は自動更新せずレビューする。

### 25.6 静的参照検証

`scripts/check-static-imports.mjs`で次を確認する。

- import先が存在する
- index.html参照先が存在する
- manifest iconsが存在する
- sw.jsのApp Shellが存在する
- `http://`、`https://`の実行時参照がない
- `/`始まりのパスがない

### 25.7 GitHub Actions

```yaml
- checkout
- setup-node
- node --test
- node --check
- node scripts/check-static-imports.mjs
- node scripts/check-sw-assets.mjs
- node scripts/check-external-urls.mjs
```

npm install、build、artifact uploadは行わない。

### 25.8 実機テスト

必須:

- Windows 11 Chrome
- Windows 11 Edge
- iPhone Safari

確認:

- GitHub Pages URLから起動
- 貼り付け
- TXT
- Markdown
- 3モード
- タッチ操作
- background復帰
- IndexedDB保存
- Service Worker更新
- ホーム画面追加
- オフライン起動
- 10万文字処理

---

## 26. バージョン管理

定数:

```js
export const APP_VERSION = '0.1.0';
export const DATA_SCHEMA_VERSION = 1;
export const CHUNKING_VERSION = 'yp-static-chunk-1';
export const CACHE_VERSION = 'yomu-pace-static-v1';
```

変更規則:

- UI修正: APP_VERSION
- DB構造: DATA_SCHEMA_VERSION
- 分割結果が変わる修正: CHUNKING_VERSION
- App Shell変更: CACHE_VERSION

再チャンク化時は現在の`sourceOffset`を保持して位置復元する。

---

## 27. 旧実装からの扱い

旧PR #8のTypeScript/Vite実装はmainへマージしない。

再利用するもの:

- チャンク生成の考え方
- URL保護バグのテスト
- 3表示モードのUI要件
- IndexedDBのデータ項目
- Readerスケジューラの考え方
- セキュリティ方針

再利用しないもの:

- TypeScriptファイル
- Vite設定
- package依存構成
- dist生成
- Worker実装
- EPUB importer
- fflate、Marked、idb依存

コードを機械的にトランスパイルするのではなく、モジュール単位で簡潔に書き直す。

---

## 28. 実装フェーズ

### Phase 1: 静的基盤

- App Shell
- Hash Router
- CSS design tokens
- native IndexedDB wrapper
- GitHub Pages直起動
- Service Workerなしで基本起動

完了条件:

- main相当の静的配置からPC・iPhoneで起動

### Phase 2: 貼り付け・TXT

- 取込み画面
- TextBlock生成
- ライブラリ
- 保存・削除

完了条件:

- 貼り付けとUTF-8 TXTを保存・再開可能

### Phase 3: チャンクエンジン

- BudouX vendoring
- 保護範囲
- 文分割
- DP optimizer
- 協調バッチ
- 単体・ゴールデンテスト

完了条件:

- URL、数値単位等の受入基準を満たす

### Phase 4: Reader

- 3表示モード
- スケジューラ
- 操作
- 位置保存
- 非散文停止

完了条件:

- PC・iPhoneで連続読書可能

### Phase 5: Markdown

- 限定パーサー
- code/table
- raw HTML安全処理

完了条件:

- 対応記法を順序保持して取り込める

### Phase 6: PWA・仕上げ

- manifest
- Service Worker
- 更新通知
- オフライン
- アクセシビリティ
- ルート一覧カード

完了条件:

- iPhoneホーム画面追加とオフライン再起動を確認

---

## 29. 実装前に固定する値

以下は実装開始時に定数として置き、実機テストで調整する。

- 最大文字数: 2,000,000
- 最大ファイル: 10MB
- 初期速度: 600文字/分
- yield間隔: 20文または16ms
- チャンクプリセット
- timing補正
- session保存期間: 180日
- staging掃除期限: 24時間

値変更はコードに散在させず`js/config.js`へ集約する。

---

## 30. 未決事項

実装開始を妨げない範囲で次を残す。

- 正式名称
- アイコン
- 配色の最終調整
- raw HTMLを表示文字列として残すか完全除外するか
- 単一改行を段落内改行として残すか空白化するか
- チャンク確認画面の詳細度
- セッション履歴を初期UIに表示するかデータだけ保存するか

技術構成、入力形式、公開方式については未決としない。

---

## 31. 完了判定

設計どおりのv0.1.0は次を満たす。

1. 本番ビルド工程がない
2. mainの静的ファイルが直接公開される
3. iPhone側に開発環境が不要
4. EPUB関連コード・依存がない
5. 実行時外部通信がない
6. BudouX以外の本番依存がない
7. 長文解析中もキャンセル操作が可能
8. 3表示モードと読み戻しが機能する
9. URL内の疑問符を誤って文分割しない
10. CIが公開ファイルそのものを検証する

---

## 32. 参考技術条件

- BudouXはブラウザからES Moduleとして直接利用できる
- JavaScript Modulesは`file://`ではなくHTTP/HTTPS配信を前提とする
- GitHub Pagesは静的な`.js`/`.mjs`を配信できる
- Service WorkerはHTTPSまたはlocalhostのsecure contextで動作する
- GitHub PagesのHTTPSはiPhone実機テストとPWAに適する

実装では外部CDNのコード例をそのまま採用せず、BudouXをリポジトリへ同梱する。