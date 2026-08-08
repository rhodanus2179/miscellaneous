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
- [ ] 情報不足時にsingle_selectを表示できる
- [ ] multi_selectを表示できる
- [ ] free_textを表示できる
- [ ] 回答後にPlannerが再判断する
- [ ] 最大3問でFinal Promptへ進む
- [ ] 回答せず実行で即Final Promptへ進む
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
