# Nano Workbench v0.2.0 設計書 — Workspace & Harness

- 対象プロダクト: `Nano Workbench`
- 対象版: v0.2.0
- 上位文書: [`DESIGN.md`](./DESIGN.md)（v0.1.0）
- リポジトリ: `rhodanus2179/miscellaneous`
- 配置先: `nano-workbench/`
- 実装方式: HTML / CSS / Vanilla JavaScript ES Modules
- サーバ処理: なし
- AI基盤: Chrome Prompt API（Gemini Nano）
- 永続化: IndexedDB
- 実行対象: 静的配信（GitHub Pages / localhost）
- 将来配布: 単一HTMLへのパッケージングを妨げない構成
- 作成日: 2026-08-08
- 状態: 実装前設計

---

## 1. 設計目的

v0.1.0は、Gemini Nanoを利用する端末内完結型チャットとして、会話、画像、コンテキスト可視化、履歴保存、分岐、圧縮を実装した。

v0.2.0では、単純な会話アプリから一段進め、**長期的な作業文脈を整理し、再利用可能な指示と対話型ハーネスを持つローカルAIワークベンチ**へ拡張する。

中核は次の7機能とする。

1. Projects
2. Project Instructions
3. Project Memory
4. Styles
5. Skills v1
6. Ask User Harness
7. Slash Commands

v0.2.0のテーマは次のとおりである。

> Workspaceで文脈を整理し、Skillで仕事を定義し、必要なときだけAsk Userで人間から不足情報を補う。

---

## 2. v0.2.0で解決する課題

### 2.1 会話単位では長期作業を整理しにくい

v0.1.0では会話が最上位単位である。複数チャットが同じ案件・目的・前提を共有する場合、それぞれの会話で同じ説明を繰り返す必要がある。

v0.2.0ではProjectを導入し、次をProject単位で共有する。

- Project Instructions
- Project Memory
- 利用可能なSkills
- 既定Style
- 所属Conversation

### 2.2 Gemini Nanoの小さいコンテキストを有効利用したい

長い会話履歴や大量の恒常情報を毎回モデルへ渡す設計は採用しない。

Project Memoryは「保存されている情報」と「今回モデルに投入される情報」を分離する。

### 2.3 小型モデルに不足情報を推測させたくない

情報不足時に自由回答させるだけでは、推測による補完が起こりやすい。

Ask User Harnessでは、Ask User対応Skillを使用した場合だけ、モデルに「このまま回答するか、1問だけ質問するか」を構造化出力で判断させる。

### 2.4 再利用可能な作業手順をチャット本文から分離したい

Skillを導入し、議事録整理、文章レビュー等のタスク指示を再利用可能なデータとして保存する。

Skillはv0.2.0ではコード実行機構ではなく、**再利用可能なタスク定義＋任意のClarification Harness**とする。

---

## 3. 設計原則

優先順位は次のとおりとする。

1. v0.1.0の会話・画像・context管理を壊さない
2. Gemini Nanoへの投入情報を最小化する
3. 保存情報とモデル内contextを分離する
4. Ask Userは必要なタスクだけで起動する
5. AIの判断は構造化出力で受ける
6. プロジェクト・メモリ・Skillはユーザーが明示的に管理できる
7. サーバ、クラウドDB、APIキーを必要としない
8. 将来の単一HTML化を阻害しない

### 3.1 「自動化しすぎない」

v0.2.0では次を行わない。

- 全メッセージにPlannerを走らせる
- Skillをモデルに自動選択させる
- Project Memoryをモデルに自動保存させる
- すべてのMemoryを毎回投入する
- ユーザーの許可なく質問を無限に続ける

小型モデルの呼出し回数、応答速度、予測不能性を抑える。

---

## 4. スコープ

### 4.1 実装する機能

#### Workspace

- Project作成
- Project名称変更
- Project削除
- Project切替
- ConversationをProjectへ所属・移動
- Project Instructions編集
- Project Memory追加・編集・削除・有効化
- MessageからProject Memoryへ昇格

#### Style

- 組込みStyle
- Custom Style作成・編集・削除
- Project既定Style
- Conversation単位Style override

#### Skill v1

- 組込みSkill
- Custom Skill作成・編集・削除
- ProjectごとのSkill有効化
- ComposerからSkillを手動選択
- Skillは原則1リクエスト単位で使用
- Ask User対応可否をSkillごとに設定

#### Ask User Harness

- `respond` / `ask_user` の構造化判断
- single select
- multi select
- free text
- 1回につき1問
- 最大3問
- 質問をスキップして実行
- 回答後に最終プロンプトを1回だけMain Sessionへ送信

#### Slash Commands

- `/new`
- `/project`
- `/memory`
- `/skill`
- `/style`
- `/context`
- `/compact`
- `/export`

### 4.2 v0.2.0では実装しない機能

- Artifact
- Canvas型部分編集
- Project Sources（TXT / Markdown等の資料管理）
- RAG / embedding / vector search
- Skill自動選択
- Plannerによるタスク分解
- Reviewer / Critic
- Multi-agent
- JavaScriptを実行するSkill
- MCP / Tool calling
- Web検索
- Background Automation
- Project間Memory検索
- クラウド同期
- ユーザーアカウント

### 4.3 v0.1.0ロードマップとの差異

v0.1.0設計書ではv0.2候補としてArtifact等を記載していたが、本設計書をもってロードマップを更新する。

- v0.2: Workspace & Harness
- v0.3候補: Artifacts & Sources
- v0.4候補: Reviewer / Plan / advanced agent harness

---

## 5. 全体アーキテクチャ

```text
┌──────────────────────────────────────────────────────────────┐
│ UI                                                           │
│ Projects / Chats / Composer / Ask User / Inspector          │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ Workspace Layer                                              │
│ Project / Memory / Style / Skill                             │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ Harness Layer                                                │
│ Skill invocation / Clarification planner / Slash commands   │
└──────────────────────────────┬───────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│ Existing v0.1 Application Layer                             │
│ Conversation / Session / Generation / Compaction / Image    │
└──────────────────┬────────────────────────────┬──────────────┘
                   │                            │
┌──────────────────▼──────────────┐   ┌────────▼──────────────┐
│ Prompt API                     │   │ IndexedDB             │
│ Main / temporary clone         │   │ Workspace + v0.1 data│
└────────────────────────────────┘   └───────────────────────┘
```

### 5.1 重要な依存関係

```text
UI
 ↓
Workspace Controller
 ↓
Harness Controller
 ↓
Existing Generation Controller
 ↓
AI Adapter
```

Workspace・Harness層から`LanguageModel`を直接操作しない。

Ask User planner用cloneの作成・破棄もAI Adapter経由とする。

---

## 6. 画面構成

### 6.1 デスクトップ

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Nano Workbench   ● Local AI ready          Context 3,812 / 9,216      │
├──────────────────┬───────────────────────────────────┬─────────────────┤
│ Workspace        │ Chat                              │ Inspector       │
│                  │                                   │                 │
│ PROJECTS         │ User                              │ Context         │
│ ▾ 秋田県PF       │ 調査票の質問を改善して             │ Project         │
│   調査票レビュー │                                   │ Memory          │
│   議事録         │ ┌───────────────────────────────┐ │ Skills          │
│ ▸ 千葉県プラ     │ │ どの観点を優先しますか？      │ │ Debug           │
│ ○ No Project     │ │ ○回答負荷 ○明確さ ○網羅性    │ │                 │
│                  │ │                [回答] [Skip]  │ │                 │
│ ＋ Project       │ └───────────────────────────────┘ │                 │
│ ＋ Chat          │                                   │                 │
├──────────────────┴───────────────────────────────────┴─────────────────┤
│ Skill: Document Review    Style: Formal                               │
│ [＋] メッセージを入力…                              [Send / Stop]     │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.2 左ペイン

上段をProject、下段を現在ProjectのConversationとする。

#### Project表示

- 展開中Project
- Project名
- 所属Conversation数
- 右クリック / `…` メニュー
  - Rename
  - Edit instructions
  - Export（将来拡張を考慮、v0.2必須ではない）
  - Delete

#### No Project

Project未所属Conversationを表示する仮想Projectを設ける。

`projectId = null`として扱い、DBにProjectレコードは作成しない。

### 6.3 Composer上部

```text
[Skill: None ▼] [Style: Formal ▼] [Project: 秋田県PF]
```

- Skillは1回の送信に適用
- 送信完了後、原則`None`へ戻る
- StyleはConversation単位で保持
- ProjectはConversation所属先を示す

### 6.4 Inspector

タブを次のように拡張する。

1. Context
2. Attachments
3. Project
4. Memory
5. Skills
6. Debug

#### Projectタブ

- Project名
- Instructions
- Default Style
- 有効Skill
- Memory件数

#### Memoryタブ

- 有効Memory
- 無効Memory
- category filter
- Add
- Edit
- Enable / Disable
- Delete
- 今回sessionへ投入されたMemoryの表示

#### Skillsタブ

- 組込みSkill
- Custom Skill
- Projectで有効 / 無効
- Ask User対応表示

---

## 7. データモデル

### 7.1 Project

```js
/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} instructions
 * @property {string|null} defaultStyleId
 * @property {string[]} enabledSkillIds
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {number} schemaVersion
 */
```

### 7.2 Conversation拡張

```js
/** v0.1 fields + */
{
  projectId: string | null,
  styleOverrideId: string | null
}
```

既存Conversationはmigration時に両方`null`とする。

### 7.3 ProjectMemory

```js
/**
 * @typedef {Object} ProjectMemory
 * @property {string} id
 * @property {string} projectId
 * @property {'premise'|'decision'|'preference'|'term'|'other'} category
 * @property {string} text
 * @property {string|null} sourceMessageId
 * @property {boolean} enabled
 * @property {boolean} pinned
 * @property {1|2|3} priority
 * @property {number} createdAt
 * @property {number} updatedAt
 */
```

`priority`は3を高、1を低とする。

### 7.4 Style

```js
/**
 * @typedef {Object} Style
 * @property {string} id
 * @property {string} name
 * @property {string} instruction
 * @property {boolean} builtIn
 * @property {number} createdAt
 * @property {number} updatedAt
 */
```

組込みStyleはJavaScript定数として保持し、Custom StyleのみDBへ保存する。

### 7.5 Skill

```js
/**
 * @typedef {Object} Skill
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} instructions
 * @property {('text'|'image')[]} inputTypes
 * @property {'none'|'auto'} clarificationMode
 * @property {boolean} builtIn
 * @property {number} createdAt
 * @property {number} updatedAt
 */
```

v0.2ではSkillに次を持たせない。

- JavaScript source
- network permission
- filesystem permission
- tool definition
- arbitrary executable code

### 7.6 HarnessRun

```js
/**
 * @typedef {Object} HarnessRun
 * @property {string} id
 * @property {string} conversationId
 * @property {string} sourceMessageId
 * @property {string} skillId
 * @property {'planning'|'waiting_user'|'ready'|'completed'|'cancelled'|'failed'} status
 * @property {number} questionCount
 * @property {ClarificationTurn[]} clarifications
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string|null} errorCode
 */
```

### 7.7 ClarificationTurn

```js
{
  question: string,
  inputType: 'single_select'|'multi_select'|'free_text',
  options: string[],
  answer: string|string[]|null,
  skipped: boolean,
  createdAt: number,
  answeredAt: number|null
}
```

Ask Userのカードは通常Messageとして保存せず、HarnessRunから会話内へ描画する。

これにより、モデル向け会話履歴とUI上の補助対話を分離する。

---

## 8. IndexedDB migration

### 8.1 DB_VERSION

```js
DB_VERSION = 2
```

### 8.2 新規Store

| Store | Key | Index |
|---|---|---|
| projects | `id` | `updatedAt` |
| projectMemories | `id` | `projectId`, `[projectId, enabled]`, `category` |
| customStyles | `id` | `updatedAt` |
| customSkills | `id` | `updatedAt` |
| harnessRuns | `id` | `conversationId`, `sourceMessageId`, `status` |

### 8.3 conversations Store変更

既存`conversations`へ次のindexを追加する。

```text
projectId
```

migrationでは既存Conversationをcursorで走査し、存在しない場合のみ次を追加する。

```js
conversation.projectId = null;
conversation.styleOverrideId = null;
```

### 8.4 onupgradeneededの再設計

v0.1のように毎回`createObjectStore()`する実装をやめる。

```js
if (oldVersion < 1) {
  createV1Stores();
}

if (oldVersion < 2) {
  migrateV1ToV2(db, transaction);
}
```

今後のv3以降のmigrationにも耐える形式へ変更する。

### 8.5 Project削除

Project削除時にConversationを削除しない。

transaction内で次を行う。

1. Project削除
2. Project Memory削除
3. 所属Conversationの`projectId = null`
4. Project既定値だけを削除

Conversation、Message、Attachmentは保持する。

---

## 9. Project設計

### 9.1 Project作成

必須値はnameのみ。

初期値:

```js
{
  description: '',
  instructions: '',
  defaultStyleId: 'default',
  enabledSkillIds: BUILTIN_SKILL_IDS
}
```

### 9.2 Conversation所属

Conversation作成時は現在選択中Projectへ所属する。

No Project選択中なら`projectId = null`。

既存Conversationはドラッグ＆ドロップまたはメニューからProject移動可能とする。

### 9.3 Project Instructions

Project Instructionsは恒常的な作業前提であり、SkillやStyleとは役割を分ける。

良い例:

```text
このProjectは秋田県内事業者向け調査に関する作業である。
行政・技術文書として誤解の少ない表現を優先する。
不明な固有情報は推測で補わない。
```

悪い例:

```text
毎回答を3000字で書き、必ず5案出し、絵文字を付ける。
```

後者はStyle / Skillに分離する。

### 9.4 Instructions長

UI上で推奨上限を表示する。

- 推奨: 1,500文字以内
- hard limit: 4,000文字

長文化した場合は警告するが、モデルのtoken数と文字数を同一視しない。

---

## 10. Project Memory設計

### 10.1 明示的Memory

Memoryはモデルが勝手に保存しない。

追加方法:

1. Inspectorから手入力
2. User messageの`Memory` action
3. Assistant messageの`Memory` action

### 10.2 Messageからの昇格

押下時にダイアログを表示する。

```text
Project Memoryに保存

Category
○ 前提
○ 決定事項
○ ユーザーの希望
○ 用語・定義
○ その他

Text
[編集可能な引用内容]

Priority  [1] [2] [3]
☑ Enabled

[保存]
```

元Message全文を自動保存せず、ユーザーが編集可能とする。

### 10.3 Memory投入選択

保存MemoryをすべてMain Sessionへ投入しない。

候補順序:

1. pinned
2. priority降順
3. updatedAt降順

v0.2初期値:

```js
MAX_MEMORY_ITEMS = 12
MAX_MEMORY_TEXT_CHARS = 3000
```

文字数はモデルtoken数の代理値ではなく、過大投入を避けるためのアプリ側guardとする。

### 10.4 Sessionへ投入されたMemoryの可視化

Memoryタブで状態を表示する。

- `In current session`
- `Stored only`
- `Disabled`

Project Memoryを変更した場合、現在Sessionには自動反映されない。

```text
Memoryが変更されました。
[Sessionを再構築して反映]
```

を表示する。

大量のSession再構築を避けるため、編集ごとの自動再構築は行わない。

---

## 11. Styles設計

### 11.1 Styleの責務

Styleは**回答の書き方だけ**を定義する。

- タスク手順 → Skill
- Project固有前提 → Project Instructions / Memory
- 文体・説明密度 → Style

### 11.2 組込みStyle

#### Default

追加指示なし。

#### Concise

```text
結論を先に述べ、重複や不要な前置きを避けて簡潔に回答してください。
```

#### Formal

```text
落ち着いた専門的な文体を用い、口語的・過度にくだけた表現を避けてください。
```

#### Technical

```text
技術的な前提、用語、条件、例外を明示し、曖昧な一般化を避けてください。
```

#### Explanatory

```text
結論だけでなく理由と考え方が理解できるよう、段階的に説明してください。
```

### 11.3 Style適用優先順位

```text
Conversation override
    ↓ なければ
Project default
    ↓ なければ
Default
```

### 11.4 Style変更

Styleはsystem-level behaviorとして扱う。

Conversation途中でStyleを変更した場合、Main Sessionを再構築する。

既存UI履歴は保持する。

---

## 12. Skills v1設計

### 12.1 Skillの責務

Skillは「何をするか」を定義する。

例:

- 要約
- 文章レビュー
- 議事録整理
- アイデア検討

### 12.2 組込みSkill案

#### Summarize

- clarificationMode: `none`
- text / image
- 目的、主要点、重要な数値・固有名詞を整理

#### Document Review

- clarificationMode: `auto`
- text / image
- 目的や評価観点が不足している場合だけAsk User

#### Meeting Notes

- clarificationMode: `none`
- text
- 議題、決定事項、宿題、未解決事項を整理

#### Brainstorm

- clarificationMode: `auto`
- text / image
- 目的・制約が不足している場合に質問可能

### 12.3 Skill選択

Composerで明示選択する。

```text
Skill: [Document Review ▼]
```

v0.2ではモデルによる自動Skill選択を行わない。

### 12.4 一回限り

Skill選択は原則として次の1送信だけに適用する。

応答完了・失敗・cancel後は`None`に戻す。

将来のsticky Skillはv0.2対象外。

### 12.5 Skill prompt injection

Skill instructionsをsystem promptへ永続注入しない。

最終的なUser Task Envelopeへ含める。

```text
【Task skill】
Document Review

【Skill instructions】
...

【User request】
...
```

これによりSkill切替時のSession再構築を不要にする。

---

## 13. Ask User Harness設計

### 13.1 起動条件

次をすべて満たす場合のみ起動する。

1. Skillが選択されている
2. `skill.clarificationMode === 'auto'`
3. text requestが存在する
4. Userが「Ask Userを使わない」を指定していない

通常チャットでは起動しない。

### 13.2 基本フロー

```text
UserがSkill付きで送信
        ↓
User messageをDBへ保存
status = pending_harness
        ↓
Main Sessionをclone
        ↓
Clarification Planner
        ↓
┌───────────────┬────────────────┐
│ respond       │ ask_user       │
└───────┬───────┴────────┬───────┘
        │                ↓
        │          Ask User card
        │                ↓
        │          User回答
        │                ↓
        │          Planner再実行
        │                ↓ max 3
        └───────────────→ Final Prompt
                              ↓
                         Main Session
                              ↓
                         Assistant response
```

### 13.3 Main Sessionを汚さない

PlannerにはMain Sessionのcloneを使用する。

PlannerのJSON出力、質問判断、内部指示はMain Session履歴へ追加しない。

Planner終了ごとにcloneを`destroy()`する。

### 13.4 Structured Output

Prompt APIの`responseConstraint`を使用する。

Schemaは複雑なconditionalを避ける。

```js
const CLARIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['respond', 'ask_user']
    },
    question: { type: 'string' },
    inputType: {
      type: 'string',
      enum: ['single_select', 'multi_select', 'free_text']
    },
    options: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 4
    }
  },
  required: ['action', 'question', 'inputType', 'options'],
  additionalProperties: false
};
```

`action = respond`の場合は次を規約とする。

```json
{
  "action": "respond",
  "question": "",
  "inputType": "free_text",
  "options": []
}
```

### 13.5 Planner prompt

Plannerへは次のみを渡す。

- 選択Skillのdescription
- clarification rubric
- User request
- 既に得たclarification Q&A

Skill instructions全文は原則渡さず、必要性判断に必要な短いdescriptionを優先する。

例:

```text
あなたは不足情報の確認要否だけを判断します。
回答本文は作成しないでください。

Task: 文書レビュー
目的: 文書をユーザーの目的に照らして改善する。

User request:
...

既存の確認回答:
...

次のいずれかを選んでください。
- 十分な情報がある → respond
- 結果が大きく変わる重要情報が1つ不足 → ask_user

質問は1回に1つだけ。
抽象的な嗜好質問を避け、具体的な作業情報を聞くこと。
```

### 13.6 質問形式

#### single_select

- options: 2〜4
- 1選択

#### multi_select

- options: 2〜4
- 複数選択可

#### free_text

- optionsは空
- textareaを表示

### 13.7 質問回数

```js
MAX_CLARIFICATION_QUESTIONS = 3
```

3問に達した場合、Plannerを再実行せずFinal Promptへ進む。

Final Promptへ次を付与する。

```text
確認質問の上限に達したため、現在得られている情報だけで最善の回答を作成してください。
不足が残る場合は、その不足を回答内で明示してください。
```

### 13.8 Skip

Ask User cardには`回答せず実行`を設ける。

Skip時はclarificationへ次を記録する。

```js
{
  answer: null,
  skipped: true
}
```

以後Plannerは走らせずFinal Promptへ進む。

### 13.9 Cancel

生成前にユーザーが会話切替・Project切替・Skill変更・編集を行った場合、該当HarnessRunを`cancelled`にする。

未回答カードを再利用しない。

---

## 14. Final Prompt Envelope

Ask Userを使わないSkillでも同じEnvelopeを使用する。

```text
【Skill】
{skill.name}

【Skill instructions】
{skill.instructions}

【User request】
{originalUserText}

【Clarifications】
- Q: ...
  A: ...

【Execution instruction】
上記の依頼と確認内容に基づいて回答してください。
```

画像はv0.1と同じmultimodal contentへ追加する。

Clarificationはテキスト化して同じuser turnへまとめる。

Main Sessionへは**元依頼＋確認回答を1回だけ**送信し、中間Planner会話は投入しない。

---

## 15. Project / Style / MemoryのPrompt Composition

Main Session作成時の優先順は次とする。

```text
1. Base SYSTEM_PROMPT
2. Effective Project Instructions
3. Effective Style instruction
4. Selected Project Memory block
5. Compacted conversation summary
6. Recent conversation turns
```

Skillはsession initial promptへ入れず、各requestのFinal Prompt Envelopeへ入れる。

### 15.1 Memory block

```text
【Project Memory】
以下はユーザーが明示的に保存した作業前提です。
必要な範囲で利用し、現在のユーザー指示と矛盾する場合は現在の指示を優先してください。

[前提] ...
[決定事項] ...
[用語] ...
```

### 15.2 指示優先順位

アプリ側で次の優先順位を定義する。

```text
Current user request
> Skill task instruction
> Project Instructions
> Project Memory
> Style
> Base system behavior
```

これはモデルのセキュリティ優先順位ではなく、Nano Workbench内部のprompt compositionルールである。

---

## 16. Context Budget

### 16.1 基本方針

Project導入でinitial contextが肥大化しやすいため、v0.2ではsession作成時の使用量を監視する。

目標:

```text
initial contextUsage <= contextWindowの35%
```

35%はhard guaranteeではなくアプリ設計上の警告値とする。

### 16.2 超過時の削減順

1. priority 1 Memoryを除外
2. priority 2 Memoryの古いものを除外
3. Recent conversation turnsを減らす
4. compact summaryは可能な限り保持
5. Project Instructionsは自動削除しない

### 16.3 UI

Context Inspectorへ次を追加する。

```text
Session inputs
Project Instructions    included
Style                   Formal
Project Memory          8 / 14 included
Conversation summary    included
Recent turns            6
```

Memoryの厳密token内訳であるとは表示しない。

---

## 17. Slash Commands設計

### 17.1 原則

Slash CommandはGemini Nanoを呼ばない。

入力欄が `/` で始まった場合にClient-side command parserが処理する。

### 17.2 Commands

#### `/new`

現在Projectに新しいConversationを作成。

#### `/project`

Project selectorを開く。

#### `/memory`

Memory Inspectorを開く。

#### `/skill`

Skill selectorを開く。

#### `/style`

Style selectorを開く。

#### `/context`

Context Inspectorを開く。

#### `/compact`

既存v0.1 compactionを開始。

#### `/export`

現在Conversation exportを開始。

### 17.3 Autocomplete

`/`入力後に候補Popupを表示する。

```text
/new       新しい会話
/project   Projectを切替
/memory    Project Memory
/skill     Skillを選択
/style     Styleを選択
/context   Contextを表示
/compact   会話を圧縮
/export    会話を出力
```

上下キー、Enter、Escで操作可能とする。

---

## 18. UI状態モデル

```js
AppState {
  ...v0_1,
  activeProjectId,
  selectedSkillId,
  effectiveStyleId,
  workspaceDirty,
  activeHarnessRunId,
  slashCommandState
}
```

### 18.1 selectedSkillId

永続的な会話設定にはしない。

原則Composer上の一時state。

送信完了後にnullへ戻す。

### 18.2 workspaceDirty

Project Instructions / Memory / Style変更後、現在Sessionが未反映の場合true。

UIに次を表示する。

```text
Workspace settings changed
[Rebuild session]
```

---

## 19. Session再構築

次の場合に再構築する。

- Conversation切替
- Project変更
- Project Instructions変更を反映
- Memory変更を反映
- Style変更
- compaction完了
- session破損

Skill選択だけでは再構築しない。

### 19.1 Session Builder拡張

新しい責務:

```text
buildSessionContext(conversation)
├ resolveProject()
├ resolveStyle()
├ selectMemories()
├ loadCompactedSummary()
├ selectRecentTurns()
└ create LanguageModel session
```

---

## 20. Activity / Debug logging

v0.2では独立したActivity Trace UIは実装しないが、将来用にイベントを記録する。

追加eventType:

- project_created
- project_updated
- project_deleted
- conversation_moved
- memory_created
- memory_updated
- memory_deleted
- style_changed
- skill_selected
- harness_started
- harness_planner_started
- harness_ask_user
- harness_answered
- harness_skipped
- harness_completed
- harness_cancelled
- harness_failed
- slash_command

Planner prompt本文や回答本文はログへ複製しない。

---

## 21. エラー・復旧

### 21.1 Planner structured output失敗

1回だけ新しいcloneで再試行。

2回目も失敗した場合:

- HarnessRunをfailed
- Ask Userをスキップ
- Main Sessionで通常実行
- UIに小さな警告

```text
確認判断に失敗したため、質問なしで実行しました。
```

### 21.2 clone失敗

Main Sessionをplanner用途に直接使用しない。

cloneできなければAsk Userをスキップして通常生成する。

### 21.3 Project / Memory DB失敗

現在の会話生成を停止しない。

Workspace変更だけを失敗として表示し、v0.1 chat機能を継続可能にする。

### 21.4 Project削除中断

Project削除・Memory削除・Conversation unassignは1transactionで実行する。

部分削除を避ける。

---

## 22. Privacy / Security

### 22.1 変更なしの原則

- クラウドLLMなし
- analyticsなし
- CDNなし
- Project / Memory / Skill / StyleはIndexedDB
- Skillに任意JavaScriptを保存・実行しない

### 22.2 Custom Skillの安全性

Custom Skillは文字列データとしてのみ解釈する。

`<script>`等を入力してもDOMへHTMLとして挿入しない。

### 22.3 Project Memory

MemoryはAI生成を自動保存しないため、誤情報が長期的に無自覚に固定されるリスクを減らす。

ユーザー自身が内容を確認・編集して保存する。

---

## 23. 静的HTML・file://互換性

v0.2の新機能はすべて、次のブラウザ内機能のみを利用する。

- DOM
- IndexedDB
- Prompt API
- JSON
- File / Blob（既存画像機能）

サーバ処理は追加しない。

開発版はv0.1同様ES Modulesを維持する。

将来のsingle HTML packagingでは、モジュール依存をbuild時にinline可能な構造を維持する。

### 23.1 file://について

Prompt APIが`file://`で利用可能かはChrome実装環境に依存するため、公式に保証された配布方式とは扱わない。

単一HTML版を追加する場合は別途、次を実機確認する。

- IndexedDB永続性
- file path変更時のstorage挙動
- image attachment
- Prompt API structured output
- session clone

---

## 24. ディレクトリ変更案

v0.1のファイルを全面分割し直さず、Workspace / Harnessを追加する。

```text
nano-workbench/
├─ js/
│  ├─ app.js
│  ├─ ai.js
│  ├─ storage.js
│  ├─ config.js
│  ├─ workspace/
│  │  ├─ projects.js
│  │  ├─ memories.js
│  │  ├─ styles.js
│  │  └─ skills.js
│  ├─ harness/
│  │  ├─ controller.js
│  │  ├─ clarification.js
│  │  ├─ schemas.js
│  │  ├─ prompt-envelope.js
│  │  └─ slash-commands.js
│  └─ ui/
│     ├─ project-view.js
│     ├─ memory-view.js
│     ├─ skill-view.js
│     ├─ style-view.js
│     └─ ask-user-card.js
├─ tests/
│  ├─ workspace.test.mjs
│  └─ harness.test.mjs
└─ DESIGN_v0.2.md
```

既存`app.js`が大きいため、v0.2実装時に追加機能だけを新規moduleへ分離する。

v0.1機能を一度に全面リファクタしない。

---

## 25. テスト設計

### 25.1 Migration

- DB v1 → v2
- 既存Conversationが消えない
- `projectId = null`
- `styleOverrideId = null`
- v2新規Storeが存在
- 2回目起動でmigrationが再実行されない

### 25.2 Project

- create / rename / delete
- Conversation移動
- Project削除後もConversation保持
- No Projectへ戻る
- Project Instructions変更後dirty表示

### 25.3 Memory

- 手入力追加
- Messageから昇格
- category
- enable / disable
- priority / pinned順
- 12件・3000文字guard
- current session投入状態

### 25.4 Styles

- Project default
- Conversation override
- override解除
- Custom Style
- Style変更でsession rebuild

### 25.5 Skills

- built-in選択
- custom Skill
- Project enabledSkillIds
- one-shot reset
- text-only Skillで画像入力時の扱い

### 25.6 Ask User

- respond
- single_select
- multi_select
- free_text
- 3問上限
- Skip
- planner failure fallback
- clone failure fallback
- conversation switchによるcancel
- Final PromptにQ&Aが正しく含まれる
- Planner JSONがMain Sessionへ混入しない

### 25.7 Slash Commands

- autocomplete
- keyboard operation
- unknown command
- command実行後にモデルを呼ばない

### 25.8 Regression

- normal chat
- image chat
- streaming
- stop
- regenerate
- edit branch
- context meter
- compaction
- export/import

---

## 26. 実機テスト

Gemini Nano実機で次を記録する。

### Ask User latency

- 通常生成の開始まで
- planner clone作成時間
- structured output時間
- 質問回答後のplanner再実行時間

### Context

- Project Instructionsなし / あり
- Memory 0件 / 5件 / 12件
- Styleあり
- Skill Final Prompt

### Stability

- planner cloneを10回繰り返す
- clone destroy後のMain Session継続
- Stop中にProject切替
- Ask User待機中にreload

### Reload

未回答HarnessRunがある状態でreloadした場合、次を表示する。

```text
前回の確認質問は中断されました。
[最初から実行]
```

自動再開はv0.2では行わない。

---

## 27. 受入基準

### Workspace

- Projectを作成できる
- ConversationをProjectへ所属させられる
- Project削除時にConversationが失われない
- Project Instructionsを保存できる

### Memory

- MessageをMemoryへ昇格できる
- Memoryを編集・有効化・無効化できる
- Current Sessionへ投入されたMemoryを確認できる
- Memory変更をsession rebuildで反映できる

### Styles

- built-in Styleを切替できる
- Custom Styleを作成できる
- Project default / Conversation overrideが機能する

### Skills

- Skillを手動選択できる
- Projectごとに利用Skillを制御できる
- 1回の実行後に選択が解除される

### Ask User

- 情報が十分なら質問せず回答へ進む
- 不足時に1問だけ表示される
- single / multi / free textが動く
- 最大3問で終了する
- Skipで即実行できる
- Plannerが失敗しても通常回答へfallbackする
- Planner内部JSONが通常会話に表示・蓄積されない

### Slash Commands

- 8個のcommandが動作する
- command処理だけではGemini Nanoを呼ばない

### Regression

- v0.1のテキストチャット、画像、context、stop、branch、compactionが継続動作する

### Architecture

- サーバ処理を必要としない
- 外部CDNを追加しない
- Custom Skillから任意JavaScriptを実行できない

---

## 28. 実装順序

### Phase 1 — DB / Workspace foundation

1. DB v2 migration
2. Project CRUD
3. Conversation projectId
4. Project sidebar
5. Project Instructions

### Phase 2 — Memory / Style

1. Project Memory Store
2. Message → Memory
3. Memory Inspector
4. Memory selection
5. built-in / custom Style
6. Session Builder拡張

### Phase 3 — Skill v1

1. built-in Skill definitions
2. Custom Skill CRUD
3. Project enabledSkillIds
4. Composer Skill selector
5. Final Prompt Envelope

### Phase 4 — Ask User Harness

1. structured output schema
2. session clone adapter
3. HarnessRun Store
4. Planner
5. Ask User card
6. max 3 / Skip / cancel
7. fallback handling

### Phase 5 — Slash Commands / quality

1. Slash command parser
2. autocomplete UI
3. regression test
4. Actions update
5. manual test checklist

---

## 29. 実装時に固定しない事項

次は実機結果を見て調整する。

- Memory最大件数12
- Memory 3000文字guard
- initial context 35%警告
- Planner prompt長
- Ask Userの平均応答時間
- 3問上限

これらは`config.js`の定数として管理する。

---

## 30. 参考仕様

Chrome Prompt APIの現行仕様でv0.2に直接利用する機能:

- `responseConstraint`によるJSON Schema structured output
- `session.clone()`
- `session.destroy()`
- `contextWindow`
- `contextUsage`
- `measureContextUsage()`
- multimodal image input

参考:

- https://developer.chrome.com/docs/ai/prompt-api
- https://developer.chrome.com/docs/ai/structured-output-for-prompt-api
- https://developer.chrome.com/docs/ai/session-management
- https://developer.chrome.com/docs/ai/session-compacting
- https://developer.chrome.com/docs/ai/built-in-ai-dos-donts

---

## 31. 設計結論

Nano Workbench v0.2.0では、機能を増やすこと自体ではなく、**Gemini Nanoへ何を、いつ、どれだけ渡すかを制御するWorkspace / Harness層**を追加する。

中核判断は次のとおりである。

1. Projectは長期作業の整理単位とする。
2. Project Memoryはユーザーが明示的に保存する。
3. Styleは「どう書くか」、Skillは「何をするか」と分離する。
4. Skillはv0.2では実行コードを持たない。
5. Ask UserはAsk User対応Skillを使った場合だけ起動する。
6. PlannerはMain Sessionのcloneで動かし、内部JSONを会話履歴へ混入させない。
7. 確認Q&Aは最終的に1つのUser Task EnvelopeへまとめてMain Sessionへ渡す。
8. 質問は1回1問、最大3問、Skip可能とする。
9. Project / Memory追加でcontextを浪費しないよう投入量を明示的に制御する。
10. v0.1のチャット・画像・context管理を基盤として保持する。

この範囲なら、サーバやクラウドAPIを追加せず、静的HTMLアプリのまま「単なるローカルチャット」から「作業を構造化できるローカルAIワークベンチ」へ発展できる。