# アセット差し替えガイド

> **このファイルは自動生成です。** `npm run assets:docs` で再生成してください。
> 元データは [`src/assets/assetManifest.ts`](../src/assets/assetManifest.ts) です。

現在 **76** 件のアセットがあり、うち **75** 件が仮素材（TODO_ASSET）です。

## 差し替え方法（コードの知識は不要です）

### 方法A: ファイルを上書きする（いちばん簡単）

1. 下の表から差し替えたい行を探します。
2. 「現在のファイル」の場所に、**同じファイル名で**新しい画像/音声を置きます。
   例: `public/assets/late/bg-private-road.png` を本物の私道写真に置き換える。
3. `src/assets/assetManifest.ts` の該当エントリで `status: 'placeholder'` を
   `status: 'final'` に変更します。サイズが変わった場合は推奨サイズの数値も直します。
4. `npm run assets:docs` を実行してこの表を更新します。

### 方法B: 別のファイル名・別の形式にする

1. 新しいファイルを `public/assets/<バンドル>/` に置きます（`.webp` や `.avif` も可）。
2. `src/assets/assetManifest.ts` の該当エントリの **`src` だけ** を書き換えます。

```ts
late: {
  background: {
    privateRoad: img({
      src: '/assets/late/private-road.webp', // ← ここだけ変更
      status: 'final',                       // ← 仮素材でなくなったら変更
      // ...
    }),
  },
},
```

**どちらの方法でも、ゲームのコード（ステージ・シーン・React）を触る必要はありません。**
ゲーム側は `late.background.privateRoad` という Asset ID しか知らないためです。

## 確認方法

```bash
npm run dev
```

- <http://localhost:5173/dev/assets> … 全アセットの一覧。市松模様の背景に表示されるので、
  透過の有無・切り抜き漏れ・アスペクト比がひと目で分かります。読み込みに失敗した
  アセットは赤く表示されます。
- <http://localhost:5173/dev> … 各ステージを単体で起動して実際の見た目を確認できます。

`npm test` でも、マニフェストの宣言サイズと実ファイルのサイズが一致するか検証されます。

## 用語

| 用語 | 意味 |
| --- | --- |
| Asset ID | ゲーム内部での論理名。ファイル名が変わっても ID は変わりません。 |
| TODO_ASSET | 仮素材。本物に差し替える対象です。 |
| spritesheet | コマを**横一列**に並べた1枚の画像。左端が1コマ目。 |
| 透過必須 | 背景が透明な PNG / WebP が必要（キャラクターなど）。 |

## 共通（UI・エフェクト・共通SE/BGM）

11 件（仮素材 10 件）

| Asset ID | 用途 | 現在のファイル | 実サイズ | 必要な仕様 | 状態 |
| --- | --- | --- | --- | --- | --- |
| `common.ui.logo` | タイトル画面のロゴ | `/assets/common/ui-logo.png` | 720x320 | 720x320 / 透過必須 | **TODO_ASSET** |
| `common.ui.fallback` | 読み込み失敗時に表示される代替テクスチャ（差し替え不要） | `/assets/common/ui-fallback.png` | 128x128 | 128x128 / 透過不要 | final |
| `common.fx.spark` | スコアポップやコンボ時のパーティクル | `/assets/common/fx-spark.png` | 24x24 | 24x24 / 透過必須 | **TODO_ASSET** |
| `common.fx.ring` | ニアミス／正解時に広がるリングエフェクト | `/assets/common/fx-ring.png` | 96x96 | 96x96 / 透過必須 | **TODO_ASSET** |
| `common.se.click` | UIボタンのタップ音 | `/assets/common/se-click.wav` | - | SE / 約0.08秒 | **TODO_ASSET** |
| `common.se.start` | ゲーム開始・ステージ開始の合図 | `/assets/common/se-start.wav` | - | SE / 約0.5秒 | **TODO_ASSET** |
| `common.se.countdown` | ステージ開始前の 3・2・1 カウント音 | `/assets/common/se-countdown.wav` | - | SE / 約0.2秒 | **TODO_ASSET** |
| `common.se.result` | リザルト画面のスコア確定音 | `/assets/common/se-result.wav` | - | SE / 約0.7秒 | **TODO_ASSET** |
| `common.se.success` | 汎用の成功音 | `/assets/common/se-success.wav` | - | SE / 約0.35秒 | **TODO_ASSET** |
| `common.se.error` | 汎用の失敗音 | `/assets/common/se-error.wav` | - | SE / 約0.3秒 | **TODO_ASSET** |
| `common.bgm.title` | タイトル／メニューのBGM | `/assets/common/bgm-title.wav` | - | BGM / 約4秒 / ループ | **TODO_ASSET** |

### 制作上の注意

- `common.ui.logo` … 横長。上下に余白を持たせると小さい端末でも綺麗に収まります。
- `common.bgm.title` … 本番は 60〜90 秒のシームレスループ（.m4a と .ogg 推奨）に差し替え。

## ステージ1: 遅刻回避

17 件（仮素材 17 件）

| Asset ID | 用途 | 現在のファイル | 実サイズ | 必要な仕様 | 状態 |
| --- | --- | --- | --- | --- | --- |
| `late.background.privateRoad` | 私道の背景。縦方向にシームレスタイリングします | `/assets/late/bg-private-road.png` | 720x1280 | 720x1280 / 透過不要 | **TODO_ASSET** |
| `late.background.gate` | ゴール地点の校門 | `/assets/late/bg-gate.png` | 720x420 | 720x420 / 透過必須 | **TODO_ASSET** |
| `late.prop.roadside` | 道の左右に並ぶ塀・植え込み | `/assets/late/prop-roadside.png` | 96x200 | 96x200 / 透過必須 | **TODO_ASSET** |
| `late.player.run` | 主人公の走行アニメーション | `/assets/late/player-run.png` | 768x160 | 6 frames x 128x160 / 横一列 / 12fps / ループ / 透過必須 | **TODO_ASSET** |
| `late.player.hit` | 生徒に衝突した瞬間のリアクション | `/assets/late/player-hit.png` | 256x160 | 2 frames x 128x160 / 横一列 / 10fps / 単発 / 透過必須 | **TODO_ASSET** |
| `late.student.normal01` | 普通に歩く生徒A | `/assets/late/student-normal01.png` | 448x150 | 4 frames x 112x150 / 横一列 / 6fps / ループ / 透過必須 | **TODO_ASSET** |
| `late.student.normal02` | 普通に歩く生徒B（配色違い） | `/assets/late/student-normal02.png` | 448x150 | 4 frames x 112x150 / 横一列 / 6fps / ループ / 透過必須 | **TODO_ASSET** |
| `late.student.hurry` | 小走りする生徒 | `/assets/late/student-hurry.png` | 448x150 | 4 frames x 112x150 / 横一列 / 11fps / ループ / 透過必須 | **TODO_ASSET** |
| `late.student.wanderer` | 左右にふらふら動く生徒 | `/assets/late/student-wanderer.png` | 448x150 | 4 frames x 112x150 / 横一列 / 7fps / ループ / 透過必須 | **TODO_ASSET** |
| `late.student.swerve` | 突然進路変更する生徒（スマホを見ている等） | `/assets/late/student-swerve.png` | 448x150 | 4 frames x 112x150 / 横一列 / 8fps / ループ / 透過必須 | **TODO_ASSET** |
| `late.student.pair` | 横並びの二人組 | `/assets/late/student-pair.png` | 200x150 | 200x150 / 透過必須 | **TODO_ASSET** |
| `late.student.trio` | 横並びの三人組 | `/assets/late/student-trio.png` | 288x150 | 288x150 / 透過必須 | **TODO_ASSET** |
| `late.se.nearMiss` | ニアミス成立時のヒュッという音 | `/assets/late/se-near-miss.wav` | - | SE / 約0.25秒 | **TODO_ASSET** |
| `late.se.collision` | 生徒に衝突した音 | `/assets/late/se-collision.wav` | - | SE / 約0.4秒 | **TODO_ASSET** |
| `late.se.combo` | コンボが伸びたときの上昇音 | `/assets/late/se-combo.wav` | - | SE / 約0.3秒 | **TODO_ASSET** |
| `late.se.goal` | 校門に到達した歓声／チャイム | `/assets/late/se-goal.wav` | - | SE / 約0.9秒 | **TODO_ASSET** |
| `late.bgm.main` | 遅刻回避ステージのBGM（焦り感のある疾走曲） | `/assets/late/bgm-main.wav` | - | BGM / 約4秒 / ループ | **TODO_ASSET** |

### 制作上の注意

- `late.background.privateRoad` … 【重要】上端と下端が繋がるように作ってください（縦ループ）。
- `late.player.run` … 横一列のスプライトシート。足元が frame 下端に来るように。

## ステージ2: 羽沢パン購入RTA

26 件（仮素材 26 件）

| Asset ID | 用途 | 現在のファイル | 実サイズ | 必要な仕様 | 状態 |
| --- | --- | --- | --- | --- | --- |
| `bread.background.shop` | 購買（羽沢）の店内背景 | `/assets/bread/bg-shop.png` | 720x1280 | 720x1280 / 透過不要 | **TODO_ASSET** |
| `bread.ui.tray` | パンが並ぶトレー／棚の板 | `/assets/bread/ui-tray.png` | 640x96 | 640x96 / 透過必須 | **TODO_ASSET** |
| `bread.ui.tag` | 注文表示パネルの背景 | `/assets/bread/ui-tag.png` | 640x160 | 640x160 / 透過必須 | **TODO_ASSET** |
| `bread.item.curry` | 商品画像: カレーパン | `/assets/bread/item-curry.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.curryHot` | 商品画像: 辛口カレーパン | `/assets/bread/item-curry-hot.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.melon` | 商品画像: メロンパン | `/assets/bread/item-melon.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.melonWhip` | 商品画像: ホイップメロンパン | `/assets/bread/item-melon-whip.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.an` | 商品画像: あんパン | `/assets/bread/item-an.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.anUguisu` | 商品画像: うぐいすあんパン | `/assets/bread/item-an-uguisu.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.cream` | 商品画像: クリームパン | `/assets/bread/item-cream.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.croissant` | 商品画像: クロワッサン | `/assets/bread/item-croissant.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.chocoCorone` | 商品画像: チョココロネ | `/assets/bread/item-choco-corone.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.chocoChip` | 商品画像: チョコチップパン | `/assets/bread/item-choco-chip.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.yakisoba` | 商品画像: 焼きそばパン | `/assets/bread/item-yakisoba.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.koppe` | 商品画像: コッペパン | `/assets/bread/item-koppe.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.katsuSand` | 商品画像: カツサンド | `/assets/bread/item-katsu-sand.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.tamagoSand` | 商品画像: たまごサンド | `/assets/bread/item-tamago-sand.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.hamCheese` | 商品画像: ハムチーズサンド | `/assets/bread/item-ham-cheese.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.pizza` | 商品画像: ピザパン | `/assets/bread/item-pizza.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.sugarTwist` | 商品画像: シュガーツイスト | `/assets/bread/item-sugar-twist.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.item.milkFrance` | 商品画像: ミルクフランス | `/assets/bread/item-milk-france.png` | 192x192 | 192x192 / 透過必須 | **TODO_ASSET** |
| `bread.se.correct` | 正解時のピンポン音 | `/assets/bread/se-correct.wav` | - | SE / 約0.3秒 | **TODO_ASSET** |
| `bread.se.wrong` | 誤答時のブブー音 | `/assets/bread/se-wrong.wav` | - | SE / 約0.35秒 | **TODO_ASSET** |
| `bread.se.order` | 新しい注文が出たときの通知音 | `/assets/bread/se-order.wav` | - | SE / 約0.25秒 | **TODO_ASSET** |
| `bread.se.combo` | 連続正解時の上昇音 | `/assets/bread/se-combo.wav` | - | SE / 約0.3秒 | **TODO_ASSET** |
| `bread.bgm.main` | パン購入RTAのBGM（急かすテンポの曲） | `/assets/bread/bgm-main.wav` | - | BGM / 約4秒 / ループ | **TODO_ASSET** |

### 制作上の注意

- `bread.item.curry` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.curryHot` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.melon` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.melonWhip` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.an` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.anUguisu` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.cream` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.croissant` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.chocoCorone` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.chocoChip` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.yakisoba` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.koppe` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.katsuSand` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.tamagoSand` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.hamCheese` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.pizza` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.sugarTwist` … 正方形・背景透過。中央に商品が収まるように。
- `bread.item.milkFrance` … 正方形・背景透過。中央に商品が収まるように。

## ステージ3: 放課後ステルス（見下ろし2D）

22 件（仮素材 22 件）

| Asset ID | 用途 | 現在のファイル | 実サイズ | 必要な仕様 | 状態 |
| --- | --- | --- | --- | --- | --- |
| `teacher.map.floorCorridor` | 廊下の床タイル（見下ろし・全面に敷き詰め） | `/assets/teacher/map-floor-corridor.png` | 128x128 | 128x128 / 透過不要 | **TODO_ASSET** |
| `teacher.map.floorClassroom` | 教室の床タイル（見下ろし） | `/assets/teacher/map-floor-classroom.png` | 128x128 | 128x128 / 透過不要 | **TODO_ASSET** |
| `teacher.map.floorRoom` | 職員室・図書室・ロッカー室などの床タイル（見下ろし） | `/assets/teacher/map-floor-room.png` | 128x128 | 128x128 / 透過不要 | **TODO_ASSET** |
| `teacher.map.floorStairs` | 階段の床タイル（見下ろし） | `/assets/teacher/map-floor-stairs.png` | 128x128 | 128x128 / 透過不要 | **TODO_ASSET** |
| `teacher.map.floorLobby` | 昇降口（ゴール地点）の床タイル（見下ろし） | `/assets/teacher/map-floor-lobby.png` | 128x128 | 128x128 / 透過不要 | **TODO_ASSET** |
| `teacher.map.wall` | 壁・立入禁止エリアのタイル。視線を遮る場所すべてに敷かれます | `/assets/teacher/map-wall.png` | 64x64 | 64x64 / 透過不要 | **TODO_ASSET** |
| `teacher.player.idle` | 主人公（見下ろし・停止中） | `/assets/teacher/player-idle.png` | 128x64 | 2 frames x 64x64 / 横一列 / 3fps / ループ / 透過必須 | **TODO_ASSET** |
| `teacher.player.walk` | 主人公（見下ろし・歩行） | `/assets/teacher/player-walk.png` | 256x64 | 4 frames x 64x64 / 横一列 / 10fps / ループ / 透過必須 | **TODO_ASSET** |
| `teacher.npc.walk` | 巡回中の先生（見下ろし・歩行） | `/assets/teacher/npc-walk.png` | 288x72 | 4 frames x 72x72 / 横一列 / 8fps / ループ / 透過必須 | **TODO_ASSET** |
| `teacher.npc.wait` | 立ち止まって見回している先生（見下ろし） | `/assets/teacher/npc-wait.png` | 72x72 | 72x72 / 透過必須 | **TODO_ASSET** |
| `teacher.npc.alert` | こちらに気づきかけている先生（見下ろし） | `/assets/teacher/npc-alert.png` | 72x72 | 72x72 / 透過必須 | **TODO_ASSET** |
| `teacher.objective.marker` | 次の目的地マーカー（床に置かれる） | `/assets/teacher/objective-marker.png` | 72x72 | 72x72 / 透過必須 | **TODO_ASSET** |
| `teacher.objective.exit` | 最後に戻る出口（昇降口）のマーカー | `/assets/teacher/objective-exit.png` | 72x72 | 72x72 / 透過必須 | **TODO_ASSET** |
| `teacher.fx.alert` | 発見されかけたときに先生の頭上に出る「!」 | `/assets/teacher/fx-alert.png` | 48x48 | 48x48 / 透過必須 | **TODO_ASSET** |
| `teacher.se.footstep` | 主人公の足音（小さめ） | `/assets/teacher/se-footstep.wav` | - | SE / 約0.18秒 | **TODO_ASSET** |
| `teacher.se.teacherFootstep` | 先生の足音。画面外の先生の位置を音で知らせる重要な手がかりです | `/assets/teacher/se-teacher-footstep.wav` | - | SE / 約0.26秒 | **TODO_ASSET** |
| `teacher.se.door` | 先生が部屋から廊下へ出るときのドア音（予兆） | `/assets/teacher/se-door.wav` | - | SE / 約0.4秒 | **TODO_ASSET** |
| `teacher.se.detect` | 視界に入って検知メーターが動き出した合図 | `/assets/teacher/se-detect.wav` | - | SE / 約0.3秒 | **TODO_ASSET** |
| `teacher.se.caught` | 先生に見つかった音（「おい」） | `/assets/teacher/se-caught.wav` | - | SE / 約0.6秒 | **TODO_ASSET** |
| `teacher.se.checkpoint` | 目的地に到達した音 | `/assets/teacher/se-checkpoint.wav` | - | SE / 約0.35秒 | **TODO_ASSET** |
| `teacher.se.clear` | 脱出成功（ステージクリア）の音 | `/assets/teacher/se-clear.wav` | - | SE / 約0.9秒 | **TODO_ASSET** |
| `teacher.bgm.main` | ステルスステージのBGM（緊張感のある静かな曲） | `/assets/teacher/bgm-main.wav` | - | BGM / 約4秒 / ループ | **TODO_ASSET** |

### 制作上の注意

- `teacher.map.floorCorridor` … 【重要】上下左右がシームレスに繋がること。柄が強すぎると先生が見づらくなります。
- `teacher.map.floorClassroom` … シームレスタイル。廊下と色味を変えて区別できるように。
- `teacher.map.floorRoom` … シームレスタイル。
- `teacher.map.floorStairs` … シームレスタイル。段が横方向に並ぶ柄を推奨。
- `teacher.map.floorLobby` … シームレスタイル。
- `teacher.map.wall` … 【重要】床よりはっきり暗く。「ここは通れない／見られない」が一目で分かること。
- `teacher.player.idle` … 真上から見た図。画像内では右（+X）を向き、ゲーム側で回転させます。
- `teacher.player.walk` … 真上から見た図。画像内では右（+X）を向くこと。
- `teacher.npc.walk` … 真上から見た図。右（+X）向き。先生の種類は色（tint）で描き分けます。
- `teacher.npc.wait` … 真上から見た図。右（+X）向き。
- `teacher.npc.alert` … 真上から見た図。歩行版と区別がつく配色に。
- `teacher.se.teacherFootstep` … 距離で音量、左右方向でパンを付けて再生されます。主人公の足音と聞き分けられること。

## ステージ3の校内マップを差し替える

ステージ3は**背景画像1枚**ではなく、床タイルを敷いた見下ろしマップです。
校舎の形そのものは画像ではなく**データ**なので、差し替えは2段階に分かれます。

### 見た目だけ変える

上の表の `teacher.map.*` を差し替えます。床と壁はマップ全面にタイリングされる
ので、**上下左右がシームレスに繋がる**画像にしてください。

### 校舎の形も変える

```text
src/config/stages/teacher/maps/
  komabaPlaceholder.ts   ← 今の仮マップ
  index.ts               ← ここに1行足して DEFAULT_MAP_ID を向ける
```

マップは軸平行な矩形だけで書きます（`bounds` / `areas` / `walls` /
`waypoints` / `edges` / `checkpoints` / `patrols` / `missions`）。
**ゲームのコードは特定のマップを知りません。** 詳細は
[GAME_DESIGN.md](./GAME_DESIGN.md) の「マップを差し替える」を参照してください。

`npm test` が、壁に埋まった目的地・壁を突っ切る巡回ルート・出口に到達しない
ミッションをすべて検出します。

## パンを追加する

ステージ2の商品はデータ駆動です。ゲームロジックの変更は不要です。

1. 画像を `public/assets/bread/item-<id>.png`（192x192・透過）に置く。
2. `src/assets/assetManifest.ts` の `bread.item` に1行追加する。
3. `src/config/stages/bread.ts` の `BREAD_ITEMS` に1行追加する。

```ts
{ id: 'shioPan', name: '塩パン', assetId: 'bread.item.shioPan',
  family: 'long', tags: ['パン'], difficulty: 2 },
```

`family` が同じ商品は「見分けにくい商品」として後半の問題に混ぜられます。

現在の商品は 18 種類です。

| id | 商品名 | Asset ID | family | 難易度 |
| --- | --- | --- | --- | --- |
| `curry` | カレーパン | `bread.item.curry` | curry | 1 |
| `curryHot` | 辛口カレーパン | `bread.item.curryHot` | curry | 3 |
| `melon` | メロンパン | `bread.item.melon` | melon | 1 |
| `melonWhip` | ホイップメロンパン | `bread.item.melonWhip` | melon | 3 |
| `an` | あんパン | `bread.item.an` | an | 1 |
| `anUguisu` | うぐいすあんパン | `bread.item.anUguisu` | an | 3 |
| `cream` | クリームパン | `bread.item.cream` | sweet | 2 |
| `croissant` | クロワッサン | `bread.item.croissant` | sweet | 1 |
| `chocoCorone` | チョココロネ | `bread.item.chocoCorone` | sweet | 2 |
| `chocoChip` | チョコチップパン | `bread.item.chocoChip` | sweet | 2 |
| `sugarTwist` | シュガーツイスト | `bread.item.sugarTwist` | sweet | 2 |
| `yakisoba` | 焼きそばパン | `bread.item.yakisoba` | long | 1 |
| `koppe` | コッペパン | `bread.item.koppe` | long | 2 |
| `milkFrance` | ミルクフランス | `bread.item.milkFrance` | long | 2 |
| `katsuSand` | カツサンド | `bread.item.katsuSand` | sandwich | 2 |
| `tamagoSand` | たまごサンド | `bread.item.tamagoSand` | sandwich | 2 |
| `hamCheese` | ハムチーズサンド | `bread.item.hamCheese` | sandwich | 3 |
| `pizza` | ピザパン | `bread.item.pizza` | savory | 1 |

## 本番用の書き出し設定

| 種類 | 推奨形式 | 備考 |
| --- | --- | --- |
| 背景 | WebP（または AVIF） | 品質80前後。巨大な元データをそのまま置かないこと。 |
| キャラクター・UI | WebP（透過）または PNG-8/24 | 透過が必要なものは必ずアルファ付きで。 |
| スプライトシート | PNG または WebP | コマを横一列に。余白サイズは全コマ共通に。 |
| SE | .m4a（AAC）+ .ogg | 44.1kHz / モノラルで十分。 |
| BGM | .m4a（AAC）+ .ogg | 60〜90秒のシームレスループ。128kbps 程度。 |

> 現在の仮素材は PNG と非圧縮 WAV です。WAV は本番では必ず圧縮形式に差し替えてください。

## 読み込みに失敗したとき

`src` の指すファイルが無い場合でもゲームは落ちません。代替テクスチャ（マゼンタの市松模様）が
表示され、コンソールに次のログが出ます。

```text
Missing asset: late.student.normal01 (/assets/late/student-normal01.png)
```

`?debug=1` を付けて起動すると、読み込みに失敗した Asset ID が画面にも一覧表示されます。
