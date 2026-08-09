# Nano Workbench v0.2.0 実機チェック — Workspace & Harness

対象: Built-in AI対応のデスクトップ版Chrome

## Migration / Regression
- [ ] v0.1データを保持したまま起動できる
- [ ] 既存ConversationがNo Projectとして表示される
- [ ] 既存のテキスト応答が動く
- [ ] 既存の画像解説が動く
- [ ] Stop / 再生成 / 編集分岐 / compactionが動く

## Projects
- [ ] Projectを作成できる
- [ ] 新しいConversationが現在Projectへ所属する
- [ ] Conversationを別Project / No Projectへ移動できる
- [ ] Project名・Description・Instructionsを保存できる
- [ ] Project削除後も所属ConversationがNo Projectに残る
- [ ] Projectの折りたたみ / 展開が動く
- [ ] 所属Chatを更新すると、そのProjectが活動順で上へ移動する
- [ ] Instructions変更後にWorkspace changedが表示される
- [ ] Rebuild sessionで変更が反映される

## Project Memory
- [ ] InspectorからMemoryを追加できる
- [ ] User / Assistant messageのMemoryボタンから昇格できる
- [ ] category / priority / pinned / enabledを保存できる
- [ ] Enable / Disable / Edit / Deleteが動く
- [ ] Contextタブに投入Memory件数が表示される
- [ ] 12件 / 3000文字guardが機能する
- [ ] Memory変更後のRebuildで回答へ反映される

## Styles
- [ ] Project default Styleを設定できる
- [ ] Conversation overrideを設定できる
- [ ] Defaultへ戻せる
- [ ] Custom Styleを作成・編集・削除できる
- [ ] Style変更後にsessionが再構築される

## Skills
- [ ] Built-in Skillを選択できる
- [ ] Skillが1回の送信だけに適用される
- [ ] Custom Skillを作成・編集・削除できる
- [ ] ProjectごとにSkillをEnable / Disableできる
- [ ] text-only Skillで画像を送ろうとすると警告される

## Ask User Harness
- [ ] Document Reviewで情報十分な依頼は質問せず実行する
- [ ] Ask User送信直後に入力欄が空になり、送信・編集がロックされる
- [ ] Ask User送信直後に仮のUserメッセージが「送信済み」としてチャット欄へ出る
- [ ] 最初の質問待ちに「必要な確認事項を整理しています…」が表示される
- [ ] 情報不足時にsingle_selectを表示できる
- [ ] multi_selectを表示できる
- [ ] free_textを表示できる
- [ ] 「その他」を選ぶと自由入力欄が表示される
- [ ] 回答直後に「回答を受け付けました。追加の確認が必要か判断しています…」が表示される
- [ ] 回答後にPlannerが再判断する
- [ ] 2問目 / 3問目の生成中も進行中表示が途切れない
- [ ] 3問目回答後はcomposerがロックされたまま「Nanoが回答を生成しています…」になる
- [ ] 3問目回答後から正式なUser/Assistantメッセージ表示まで「確認が完了しました。回答を生成しています…」が表示される
- [ ] Final Promptへの引き渡し中に元のUserテキストが編集可能なdraftとして再表示されない
- [ ] 最大3問でFinal Promptへ進む
- [ ] 回答せず実行で即Final Promptへ進む
- [ ] Planner待機中のキャンセルで処理を中断でき、元の入力が復元される
- [ ] キャンセルできる
- [ ] Planner失敗時に質問なしで通常実行へfallbackする
- [ ] Ask User中にProject / Conversation / Skillを変えるとcancelされる
- [ ] Planner JSONが会話履歴へ表示されない
- [ ] Main response完了・停止・失敗後にSkillがNoneへ戻る

## Slash Commands
- [ ] `/`で候補が表示される
- [ ] ↑↓ / Enter / Escで操作できる
- [ ] `/new`
- [ ] `/project`
- [ ] `/memory`
- [ ] `/skill`
- [ ] `/style`
- [ ] `/context`
- [ ] `/compact`
- [ ] `/export`
- [ ] command実行だけではGemini Nanoを呼ばない

## Runtime / Context
- [ ] Project Instructionsなし / ありのinitial contextUsageを記録
- [ ] Memory 0 / 5 / 12件のinitial contextUsageを記録
- [ ] Styleありのcontext増加を記録
- [ ] Ask User planner cloneの所要時間を記録
- [ ] planner cloneを10回繰り返してMain Sessionが継続する
- [ ] Ask User待機中にreloadすると中断通知が出る

## 記録
- Chrome version:
- contextWindow:
- Project Instructions追加前 / 後:
- Memory 5件:
- Memory 12件:
- Planner clone平均:
- Structured output平均:
- clone 10回後のMain Session:
