# Nano Redactor — 設計書

- Version: Design v0.1
- Date: 2026-09-04
- Target: `rhodanus2179/miscellaneous/nano-redactor/`
- Runtime: Static HTML + JavaScript / GitHub Pages / Chrome Built-in AI (Gemini Nano)

## 1. 目的

コピー＆ペーストした日本語文章から、個人情報に該当する部分だけを端末内で検出し、文頭から順に逐次マスキングする。

本アプリで最も重要な要件は、**マスキング対象以外の原文を1文字も変更しないこと**である。

LLMに文章全体を書き換えさせる方式は採用しない。Gemini Nanoは「どの原文部分をマスクすべきか」の判定だけを担当し、実際の置換はJavaScriptが原文に対して決定論的に行う。

## 2. 設計原則

### 2.1 原文不変性を最優先する

出力は常に次の形で生成する。

```text
output = original[0:a] + MASK + original[b:c] + MASK + original[d:]
```

つまり、マスク対象span以外は必ず元の文字列をそのままコピーする。

以下は行わない。

- 文章の要約
- 語尾の変更
- 表記ゆれの統一
- 全角・半角の変換
- 改行の整理
- 空白の削除・追加
- 誤字修正
- 句読点の変更
- 日付表記の変換

### 2.2 LLMに文字位置を数えさせない

Gemini Nanoに `start` / `end` の文字オフセットを生成させる設計は採用しない。

LLMは文字位置のカウントを誤る可能性があるため、Nanoには**原文に存在する完全一致文字列**を返させる。

例:

```json
{
  "entities": [
    {"text": "田中太郎", "type": "PERSON"},
    {"text": "090-1234-5678", "type": "PHONE"}
  ]
}
```

JavaScript側が `indexOf()` 等で原文中の位置を確定する。

LLMが原文に存在しない文字列を返した場合は、**類似文字列へ補正せず、その候補を破棄する**。

### 2.3 LLMは検出、JavaScriptは置換

責務を明確に分離する。

| 処理 | 担当 |
|---|---|
| メール・電話番号等の候補抽出 | JavaScript |
| 人名・住所・文脈依存の個人情報判定 | Gemini Nano |
| structured outputの形式保証 | Prompt API `responseConstraint` |
| 原文との完全一致検証 | JavaScript |
| spanの重複整理 | JavaScript |
| マスク文字列への置換 | JavaScript |
| 結果表示・コピー | JavaScript |

## 3. 想定ユースケース

主な用途は、社内文書やメール、議事メモ等を外部の生成AIや第三者へ渡す前の匿名化・仮名化補助とする。

例:

```text
株式会社ABCの田中太郎です。
東京都千代田区○○1-2-3に住んでいます。
電話番号は090-1234-5678です。
9月10日の会議には出席します。
```

標準出力:

```text
株式会社ABCの[氏名]です。
[住所]に住んでいます。
電話番号は[電話番号]です。
9月10日の会議には出席します。
```

`株式会社ABC`、文体、改行、会議日等は変更しない。

## 4. マスク対象

### 4.1 標準モード

「個人を直接識別する、または個人に直接ひも付く情報」を中心にマスクする。

| type | 表示 | 例 |
|---|---|---|
| `PERSON` | `[氏名]` | 田中太郎、田中さん |
| `ADDRESS` | `[住所]` | 個人宅住所、居住地の詳細 |
| `PHONE` | `[電話番号]` | 個人の電話番号 |
| `EMAIL` | `[メール]` | 個人のメールアドレス |
| `PERSON_ID` | `[個人ID]` | 社員番号、顧客番号等、個人にひも付く識別子 |
| `ACCOUNT` | `[アカウント]` | 個人ユーザー名、SNS ID等 |
| `DOB` | `[生年月日]` | 個人の生年月日 |
| `OTHER` | `[個人情報]` | 上記に分類しづらい直接識別情報 |

標準モードでは原則として以下を残す。

- 法人名
- 官公庁名
- 部署名
- 一般公開された代表電話・代表メール
- 会議日・締切等、個人に直接結びつかない日付
- 金額
- 製品名
- 地名一般

### 4.2 厳格モード（オプション）

外部共有前の保守的な処理向けに、準識別情報も広めにマスクする。

候補:

- 年齢
- 個人にひも付く詳細な勤務先・役職
- 個人にひも付く日時
- 個人にひも付く位置情報
- 個人用・法人用を問わない電話番号・メールアドレス

v0.1では標準モードをデフォルトとする。

## 5. システム構成

```text
┌────────────────────────────────────────────┐
│ Browser / GitHub Pages                     │
│                                            │
│  Input textarea                            │
│      │                                     │
│      ▼                                     │
│  Chunker ───────────────┐                  │
│      │                  │                  │
│      ▼                  ▼                  │
│  Rule candidates     Gemini Nano           │
│  (regex etc.)        Prompt API            │
│      │                  │                  │
│      └──────┬───────────┘                  │
│             ▼                              │
│       Span validator                       │
│             │                              │
│             ▼                              │
│       Span merger                          │
│             │                              │
│             ▼                              │
│  Deterministic redactor                    │
│             │                              │
│             ▼                              │
│       Incremental preview                  │
└────────────────────────────────────────────┘
```

入力本文をアプリのサーバーへ送信する処理は持たない。

## 6. Gemini Nano / Prompt API

### 6.1 利用API

Chrome Built-in AI の `LanguageModel` / Prompt APIを使用する。

セッション生成時の基本オプション例:

```js
const SESSION_OPTIONS = {
  expectedInputs: [
    { type: 'text', languages: ['ja', 'en'] }
  ],
  expectedOutputs: [
    { type: 'text', languages: ['ja', 'en'] }
  ]
};
```

`LanguageModel.availability()` と `LanguageModel.create()` には同一の言語・モダリティ条件を渡す。

### 6.2 Structured Output

`prompt()` の `responseConstraint` にJSON Schemaを渡す。

概念スキーマ:

```js
const ENTITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          type: {
            type: 'string',
            enum: [
              'PERSON', 'ADDRESS', 'PHONE', 'EMAIL',
              'PERSON_ID', 'ACCOUNT', 'DOB', 'OTHER'
            ]
          }
        },
        required: ['text', 'type']
      }
    }
  },
  required: ['entities']
};
```

### 6.3 システム指示の基本方針

モデルには以下を明示する。

1. 入力文章を書き換えない。
2. マスクすべき原文部分だけを抽出する。
3. `text` は原文から一字一句そのままコピーする。
4. 前後の句読点・助詞・敬称を必要以上に含めない。
5. entitiesは原文での出現順に返す。
6. 同一文中に複数回現れる場合は各出現を順に返す。
7. 法人・部署・一般的地名等は、個人情報でない限り返さない。
8. 判断できない情報を創作・補完しない。

## 7. ルールベース候補抽出

LLMだけに依存しない。

JavaScriptで、少なくとも以下を「候補」として抽出する。

- メールアドレス
- 日本の電話番号らしい文字列
- 郵便番号
- URL内のユーザー識別子候補（必要に応じて）

ただし、正規表現に一致したものを無条件で個人情報と断定しない。

例えば会社代表電話や `info@example.com` は標準モードでは残すべき場合があるため、候補情報をNanoへ渡し、文脈判定を補助する。

厳格モードでは、電話番号・メールアドレスを文脈にかかわらずマスクする設定を許容する。

## 8. 逐次処理

### 8.1 基本動作

文章全体を一度にモデルへ渡さず、上から順に小さな単位で処理する。

```text
入力
 ↓
chunk 1 を解析
 ↓
検証済みspanを反映
 ↓
画面上のchunk 1部分がマスクされる
 ↓
chunk 2 を解析
 ↓
……
```

これにより、ユーザーは処理進捗と結果を同時に確認できる。

### 8.2 Chunk生成

原文を `split().join()` で再構築しない。

Chunkerは**原文上の範囲 `{start, end}` を管理するだけ**とし、本文そのものは常に元文字列から `slice()` する。

優先境界:

1. 空行
2. 改行
3. `。！？` 等の文末
4. 長すぎる場合のみ安全な近傍境界

目標chunk長は実装時に実機評価するが、初期値は約1,200〜2,000文字を想定する。

### 8.3 途中結果

処理済みspan集合を使い、その時点のプレビューを毎chunk再生成する。

未処理部分は原文のまま表示する。

## 9. Span解決と検証

### 9.1 完全一致のみ採用

モデル出力 `entity.text` は、そのchunk内に完全一致する場合だけ候補として採用する。

禁止:

- fuzzy matching
- Levenshtein距離による補正
- 表記揺れ推定による置換
- モデル出力を使った原文補正

原文に見つからなければ `MODEL_SPAN_NOT_FOUND` として記録し、文章には触れない。

### 9.2 同一文字列が複数回ある場合

モデルには全出現を文書順に列挙させ、JavaScriptは前回解決位置より後ろにある完全一致箇所を順に対応付ける。

曖昧性を解消できない場合は自動的な推測をせず、その候補を警告として残す。

### 9.3 重複span

重複候補は以下の原則で整理する。

- 完全一致: 1件に統合
- 内包関係: より適切な個人情報単位を採用
- 異なる種別の部分重複: 自動で範囲を広げず、競合として扱う

「安全そうだから周囲もまとめて消す」という処理は、非対象部分を変える可能性があるため行わない。

## 10. マスク方式

v0.1では以下を選択可能にする。

### A. 種別ラベル（デフォルト）

```text
[氏名]
[住所]
[電話番号]
[メール]
```

文章の意味構造をある程度残せるため、生成AIへ渡す前処理に向く。

### B. 連番ラベル

```text
[PERSON_01]
[PERSON_02]
[ADDRESS_01]
```

同一の**完全一致原文文字列**には同じラベルを割り当てられる。

異表記（例: `田中太郎` と `田中さん`）の同一人物判定はv0.1では行わない。誤った同一人物統合を避けるためである。

### C. 黒塗り表示

```text
████████
```

視覚確認用。コピー用途では種別ラベルを推奨する。

## 11. UI設計

### 11.1 1画面構成

複数ページに分けず、1画面で完結させる。

```text
┌─────────────────────────────────────────┐
│ Nano Redactor                           │
│ 端末内AIで個人情報だけをマスク           │
│ ● Gemini Nano 使用可能                  │
├─────────────────────────────────────────┤
│ 入力                                    │
│ ┌─────────────────────────────────────┐ │
│ │ 文章を貼り付け                       │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [標準 ▼] [種別ラベル ▼]                │
│                                         │
│ [ マスキング開始 ]   [ クリア ]         │
├─────────────────────────────────────────┤
│ 処理 12 / 34   ███████░░░ 35%           │
├─────────────────────────────────────────┤
│ 結果                                    │
│ ┌─────────────────────────────────────┐ │
│ │ 上から順に結果が反映される           │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 18件マスク / 1件要確認                  │
│                         [結果をコピー]   │
└─────────────────────────────────────────┘
```

### 11.2 モデル状態表示

状態を明確に分ける。

| 状態 | 表示例 |
|---|---|
| API非対応 | `このChromeでは端末内AIを利用できません` |
| モデル未取得 | `Gemini Nanoを準備できます` |
| ダウンロード中 | `モデルを準備中… 42%` |
| 100%到達後 | `モデル準備完了` |
| 利用可能 | `Gemini Nano 使用可能` |
| 処理中 | `個人情報を確認中… 12 / 34` |
| 完了 | `マスキング完了` |
| 中断 | `処理を停止しました` |

**100%到達後に `モデルを準備中…100%` を残さない。**

### 11.3 停止

処理中は「停止」ボタンを表示する。

`AbortController` を使って現在のPrompt API呼び出しを停止し、それまでに確定した結果は残す。

## 12. モデル非対応時

Prompt APIが利用できない環境では、アプリ全体を壊さない。

### 方針

- Chrome Built-in AI非対応であることを明示する。
- ルールベース候補検出は利用可能にする。
- ただし「完全な個人情報検出」と誤認させない。

表示例:

```text
AIによる文脈判定は利用できません。
メールアドレス・電話番号等の形式ベース検出のみ利用できます。
```

## 13. プライバシー設計

このアプリ自身は、入力文章を外部サーバーへ送信しない。

### v0.1の原則

- 外部APIなし
- 外部LLMなし
- analyticsなし
- CDNなし
- フォント等の外部リソースなし
- 入力本文を `localStorage` に保存しない
- 入力本文を IndexedDB に保存しない
- ページ更新で本文は消える
- セッション内の対応表もメモリのみ
- Service Workerを導入する場合もアプリ静的ファイルだけをcacheし、本文は保存しない

Gemini Nanoのモデル自体はChromeによって必要に応じて取得される。

UIには「アプリは文章を外部送信しない」ことと、「初回のモデル取得にはネットワークが必要な場合がある」ことを区別して表示する。

## 14. セキュリティ

- ユーザー本文はDOMへ `innerHTML` で挿入しない。
- プレビューは `textContent` または安全なText Nodeで構成する。
- clipboard出力は生成済みのplain textのみ。
- URL query / hashへ本文を入れない。
- consoleへ本文やモデルpromptを出力しない。
- エラーログには本文を含めない。
- 外部依存を極力持たない。

## 15. 完全匿名化についての注意表示

生成AIによる検出にはfalse negative / false positiveがあり得る。

そのため完了時に簡潔に次を表示する。

```text
自動検出には見落としの可能性があります。
外部共有前に結果を確認してください。
```

ただし警告を過度に大きくして通常利用を妨げない。

## 16. エラー設計

想定エラーコード:

| code | 意味 |
|---|---|
| `API_UNSUPPORTED` | Prompt API非対応 |
| `MODEL_UNAVAILABLE` | モデル利用不可 |
| `MODEL_DOWNLOAD_FAILED` | モデル取得失敗 |
| `MODEL_NOT_SUPPORTED` | 言語等の非対応 |
| `PROMPT_ABORTED` | ユーザー停止 |
| `CONTEXT_EXCEEDED` | context上限 |
| `INVALID_MODEL_OUTPUT` | JSON/Schema上の異常 |
| `MODEL_SPAN_NOT_FOUND` | モデル文字列が原文に存在しない |
| `SPAN_CONFLICT` | 検出spanが競合 |

エラー時にも原文を書き換えない。

## 17. 想定ファイル構成

実装時は以下を基本とする。

```text
nano-redactor/
├─ index.html
├─ styles.css
├─ README.md
├─ DESIGN.md
├─ manifest.webmanifest
├─ sw.js
├─ js/
│  ├─ main.js
│  ├─ ai.js          # Prompt API adapter
│  ├─ chunker.js     # 原文range分割
│  ├─ rules.js       # regex候補抽出
│  ├─ spans.js       # exact match / merge / validation
│  ├─ redactor.js    # 決定論的置換
│  └─ ui.js
└─ tests/
   ├─ spans.test.mjs
   ├─ redactor.test.mjs
   └─ rules.test.mjs
```

ビルド工程は原則不要とし、GitHub Pagesでそのまま配信できる静的構成にする。

## 18. テスト方針

### 18.1 最重要: 原文不変性テスト

任意の入力とspanについて、**span外の文字列が原文と完全一致すること**を自動テストする。

対象には以下を含める。

- 日本語
- CRLF / LF
- タブ
- 連続空白
- 絵文字
- サロゲートペア
- 半角・全角混在
- Markdown
- URL
- 箇条書き

### 18.2 Hallucination耐性

モデルmockが原文にない文字列を返した場合:

```json
{"text":"山田太郎","type":"PERSON"}
```

原文に `山田太郎` がなければ、出力は一切変更しない。

### 18.3 非個人情報を残すテスト

例:

```text
株式会社ABCは9月10日に新製品を発売する。
代表電話は03-0000-0000である。
```

標準モードで公開法人情報と判断した場合、文章をそのまま残せることを確認する。

### 18.4 典型的個人情報

- 日本人氏名
- 敬称付き氏名
- 日本住所
- 電話番号
- メール
- 社員番号
- SNSアカウント
- 生年月日

### 18.5 境界・競合

- 同じ氏名が複数回出現
- 同じ文字列が人名と非人名の両方で出現
- address内に郵便番号を含む
- email候補とURL候補の重複
- chunk境界付近のentity

### 18.6 モデル状態UI

特に以下を回帰テスト対象にする。

- download 99%
- download 100%
- create完了
- unavailable
- user abort

100%時点で「準備中」を残さない。

## 19. 受入基準（v0.1）

以下をすべて満たしたらv0.1実装完了とする。

1. GitHub Pages上の静的アプリとして起動する。
2. Chrome Built-in AIの利用可否を判定できる。
3. Gemini Nanoを必要に応じて準備できる。
4. 日本語文章を貼り付けて処理できる。
5. 文頭から順に逐次処理される。
6. 氏名・住所・電話・メール等を構造化出力で検出できる。
7. LLM出力は原文完全一致検証を通らない限り置換されない。
8. マスク対象span以外の原文がbyte/文字列レベルで保持される。
9. 結果をplain textでコピーできる。
10. 入力本文を永続保存しない。
11. 外部API・analytics・CDNを使用しない。
12. モデル準備100%後に適切な完了表示へ遷移する。
13. Prompt API非対応でも説明付きで安全にフォールバックする。
14. 自動テストで原文不変性を検証できる。

## 20. 実装順序

### Phase 1: 決定論的コア

Gemini Nanoより先に以下を完成させる。

- chunker
- span validator
- span merger
- redactor
- 原文不変性テスト

### Phase 2: Rule detector

- email
- phone
- postcode等の候補抽出

### Phase 3: Gemini Nano adapter

- availability
- model download progress
- session lifecycle
- responseConstraint
- AbortController
- error normalization

`nano-workbench` の既存Prompt API実装から、現在のAPIに適合するセッション管理・ダウンロード進捗処理の考え方を再利用できる。

### Phase 4: UI

- paste
- start / stop
- incremental preview
- copy
- clear
- mode / mask style

### Phase 5: 実機検証

- GitHub Pages
- Windows Chrome
- 長文
- モデル初回ダウンロード
- オフライン再利用

## 21. v0.1で意図的にやらないこと

- 外部クラウドAIへのfallback
- 入力文章のクラウド保存
- Word/PDFファイル直接読み込み
- OCR
- 文章校正
- 自動要約
- マスク解除用の永続対応表
- 異表記を含む人物同一性推定
- 高度な組織内権限管理

まず「貼る → 個人情報だけ消す → コピーする」を高い信頼性で実現する。

## 22. 将来拡張候補

- Word / PDFからのテキスト入力
- 手動追加マスク
- マスク候補のレビューUI
- 同一人物の安全な仮名化
- ユーザー定義辞書（社内人物名等）
- マスク対象カテゴリの詳細設定
- JSONでの検出結果export
- Chrome Extension化によるWebページ選択範囲の直接マスク

## 23. 参考情報

- Chrome Prompt API: https://developer.chrome.com/docs/ai/prompt-api
- Chrome Built-in AI: https://developer.chrome.com/docs/ai

2026-09-04時点のChrome公式ドキュメントでは、Prompt APIはGemini Nanoを使用し、日本語を含む複数言語、JSON Schemaによるstructured output、モデルdownload progress、AbortSignal等を扱える。モデル利用条件やAPI仕様はChrome更新で変わり得るため、実装時には公式仕様を再確認する。
