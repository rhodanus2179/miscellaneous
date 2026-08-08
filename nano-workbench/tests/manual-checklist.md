# Nano Workbench v0.1.0 実機チェック

対象: Built-in AI対応のデスクトップ版Chrome

## 起動
- [ ] `LanguageModel.availability()`の状態が表示される
- [ ] 未取得モデルを「AIを準備」から取得できる
- [ ] ダウンロード進捗が表示される
- [ ] contextWindow / contextUsage が表示される

## Chat
- [ ] 日本語の回答がストリーミングされる
- [ ] Stopで部分回答を保持して停止する
- [ ] 回答再生成で旧回答がDBに残り、候補切替が出る
- [ ] ユーザーメッセージ編集で新しい分岐になる
- [ ] 再読込み後に会話が復元される

## Image
- [ ] PNG / JPEG / WebPを選択できる
- [ ] ドラッグ&ドロップできる
- [ ] クリップボード貼り付けできる
- [ ] 4枚まで添付できる
- [ ] 画像＋テキストで応答できる
- [ ] ImagesタブからStored only / Current sessionを確認できる
- [ ] 保存済み画像を再投入できる

## Context
- [ ] 入力後にmeasureContextUsage()の予測値が出る
- [ ] 80% / 90%付近で表示が変わる
- [ ] contextoverflow時に会話内イベントカードが出る
- [ ] 圧縮でSummarizer API（またはfallback）が動く
- [ ] 圧縮後も完全なUI履歴は残る

## Persistence / PWA
- [ ] 会話JSONをexport/importできる
- [ ] 画像もexport/import後に復元する
- [ ] Service Worker登録後にApp Shellがキャッシュされる
- [ ] GitHub Pagesのサブパスで静的importが404にならない

## 記録する実測値
- Chrome version:
- contextWindow:
- initial contextUsage:
- 日本語1,000字のmeasureContextUsage:
- 画像1枚のmeasureContextUsage:
- 画像4枚のmeasureContextUsage:
- Abort後の同一セッション再利用:
