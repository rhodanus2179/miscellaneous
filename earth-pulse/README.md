# Earth Pulse

地球上と地球周辺で現在進行している現象を、一つの「惑星の鼓動」として観察する静的Webアプリです。

## v0.1の機能

- Globe.glによる3D地球儀
- 現在時刻に連動する昼夜境界
- USGSの過去24時間の地震と波紋表示
- NASA EONETの活動中自然イベント
- NOAA SWPCの太陽風・磁場・Kp指数
- CelesTrakのOMMデータとsatellite.jsによるISS位置・軌道計算
- API障害時のローカルキャッシュ利用
- レイヤーのON / FOCUS / OFF切替
- Ambientモード
- 独自のPlanetary State
- PC・タブレット・スマートフォン対応

## 起動方法

ES Modulesを使用するため、`file://` で直接開かずHTTP経由で配信してください。

```bash
cd earth-pulse
python -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開きます。GitHub Pagesでもそのまま配信できます。

## 操作

- ドラッグ: 地球を回転
- ホイール／ピンチ: ズーム
- イベント選択: 詳細表示
- 地球をダブルクリック: その地点へズーム
- レイヤーボタン: `ON → FOCUS → OFF`
- `A`: Ambientモード切替
- `Esc`: 詳細・About・Ambientモードを閉じる

## データ提供元

- [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/)
- [NASA EONET](https://eonet.gsfc.nasa.gov/)
- [NOAA Space Weather Prediction Center](https://www.swpc.noaa.gov/)
- [CelesTrak](https://celestrak.org/)
- ISS位置フォールバック: [Where The ISS At?](https://wheretheiss.at/)

## 使用ライブラリ

- [Globe.gl](https://globe.gl/)
- [Three.js](https://threejs.org/)
- [satellite.js](https://github.com/shashwatak/satellite-js)

CDNのバージョンは `index.html` および各JavaScriptモジュールで固定しています。

## 注意

Planetary Stateは、複数のデータを正規化して統合した視覚演出上の活動状態です。公式の危険度や災害評価ではなく、防災・安全判断には利用できません。

外部APIのCORS、仕様変更、停止などにより、一部レイヤーが利用できない場合があります。その場合も、取得済みキャッシュやブラウザ内計算を利用して可能な範囲で表示を継続します。
