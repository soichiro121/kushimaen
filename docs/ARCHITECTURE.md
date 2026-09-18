# アーキテクチャ

## 全体像

```text
Browser (スマートフォン)
   │
   │  静的ファイル（React + Phaser のバンドル）
   ▼
Vercel ──┬── /        →  dist/              Vite の本番ビルド
         │
         └── /api/*   →  api/*.ts           サーバーレス関数（TypeScript）
                             │
                             │  server/     ルーティング・検証・リポジトリ
                             │  shared/     スコア式（ゲームと共有）
                             ▼
                        Neon Postgres
                             （全クエリがパラメータ化）
```

常駐サーバーはありません。関数はリクエストのたびに起動し、終わったら消えます。
それが設計に効いてくる箇所は3つあります。

| 制約                           | 対応                                    |
| ------------------------------ | --------------------------------------- |
| ファイルシステムが揮発する     | ログは stdout（プラットフォームが収集） |
| プロセス間で状態を共有できない | レート制限のカウンタは DB に置く        |
| 接続を開いては捨てる           | Neon の**プール**エンドポイントを使う   |

## 設計上の中心的な判断

### 1. React と Phaser の責任を完全に分ける

|        | 担当                                                                     |
| ------ | ------------------------------------------------------------------------ |
| React  | タイトル、ニックネーム、ステージ説明、リザルト、ランキング、設定、エラー |
| Phaser | ゲーム内部のすべて（HUD を含む）                                         |

**ゲーム中に React の state を毎フレーム更新しません。** スコアや残り時間の表示は Phaser 側の
`Hud` が描画します。React の再レンダリングを 60fps で回すことは、スマートフォンでフレームを
落とす最短の方法だからです。React が状態を受け取るのはステージ終了時の一度だけです。

Phaser インスタンスは `GameLayer` が**セッション中ずっと保持**します。ステージごとに
生成・破棄するとテクスチャを毎回捨てることになり、遷移が詰まります。ステージ間では
シーンだけを差し替え、React 画面が前面にあるときはレイヤーを非表示にします。

### 2. 素材はすべて中央レジストリ経由（最優先要件）

```text
ゲームコード ──> Asset ID ──> assetManifest.ts ──> ファイル
                 "late.player.run"
```

ゲームコードにファイルパスは一切現れません。`src/assets/assetManifest.ts` が唯一ファイルを
知っている場所です。Asset ID はマニフェストの構造からテンプレートリテラル型で導出されるので、
`late.player.runn` のような打ち間違いはコンパイルエラーになります。

- 読み込み失敗はクラッシュではなく代替テクスチャ＋`Missing asset: <id>` のログになります。
- スプライトシートのアニメーションは `playAsset(sprite, id)` の一行で、コマ番号は書きません。
  フレーム数が変わっても呼び出し側は無変更です。
- 差し替え手順は [ASSETS.md](ASSETS.md)（マニフェストから自動生成）にあります。

### 3. スコアの計算式はゲームと API で「同じコード」

これがランキングの信頼性の根幹です。

```text
        shared/game-rules/v3.json      ← 定数の唯一の出所
                    │
                    ▼
        shared/core/scoring.ts         ← 計算式の唯一の実装
           ╱                 ╲
          ▼                   ▼
  ゲーム（画面の数字）    API（保存される数字）
          ╲                 ╱
           shared/core/validation.ts   ← 不正検証も1つ
```

以前はバックエンドが別言語だったため、式と検証をそれぞれ2回書いて**ゴールデン
フィクスチャ**で一致を担保していました。TypeScript に統一したことで実装は1つになり、
ずれる余地そのものが消えています。

`shared/core/` は**相対 import しか使いません**。Vite（エイリアスあり）とサーバーレス
関数のバンドラ（エイリアスなし）の両方から読まれるためです。`src/` 側の
`config/rules.ts` などは、この実体を再 export しているだけの薄いファイルです。

- フィクスチャ（`score-fixtures.json`）は今も残しています。役割は言語間のずれ検出から、
  **手計算した仕様として式そのものを固定する**ことに変わりました。
- スコアが再計算できるのは、各ステージが得点要素を**整数の "unit" メトリクス**に積算して
  いるからです（例: コンボは `comboUnits`、速度ボーナスは `speedUnits`）。その結果、
  スコアは `f(metrics, rules)` という純粋関数になり、サーバーはタイミングを知らなくても
  まったく同じ値を出せます。詳しくは [shared/game-rules/README.md](../shared/game-rules/README.md)。

### 4. サーバーがスコアの正本

クライアントが送る `totalScore` は**保存しません**。API が `metrics` から再計算します。
加えて次を検証します。

| 検査           | 内容                                       |
| -------------- | ------------------------------------------ |
| メトリクス上限 | ステージが物理的に出せる値を超えていないか |
| 相互整合性     | `comboUnits ≤ nearMissCount × 上限` など   |
| プレイ時間     | 短すぎ・長すぎ                             |
| run の状態     | 未知 / 期限切れ / 二重送信                 |
| configVersion  | バランス変更をまたいだ送信でないか         |

個々の問題には重み（0〜100）があり、合計が閾値を超えると不採用になります。1つの軽い齟齬
（古いクライアントなど）では正直なプレイヤーを弾かず、組み合わさると弾く、という設計です。

完全なチート防止ではありません。目的は **「DevTools で数値を書き換えて POST するだけで
1位になれる」状態をなくすこと**で、そのためには整合の取れた人間的なメトリクス一式を
偽造する必要がある、という水準まで引き上げています。

### 5. 乱数は必ずシード付き

`Math.random()` はゲームロジックから一切呼びません（ビルド時スクリプトを除く）。run の
シードはサーバーが発行し、ステージごとに `deriveSeed(runSeed, stageId)` で独立した系列を
作ります。これにより、

- 同じシードなら同じ障害物・同じ注文・同じ見回りパターンが再現され、
- ステージの並び替えや無効化が他のステージの生成物を変えず、
- 後からリプレイ・スコア検証・難易度分析ができます。

### 6. 時間は単調・一時停止に強い

`setInterval` はゲーム進行に使いません。`GameClock` が描画ループの delta を積算し、1フレーム
あたりの delta を上限でクランプします。その結果、

- バックグラウンドに移ってもタイマーが進まない（rAF が止まるため）、
- 明示的な pause/resume が正確、
- GC などによる長いフレームでタイマーが飛ばない。

---

## ディレクトリ構造

```text
.
├── index.html                  viewport / safe-area の設定を含む HTML シェル
├── vite.config.ts              ビルド設定、/api のプロキシ、LAN 公開
│
├── shared/                     ゲームと API が共有するコード（相対 import のみ）
│   ├── core/
│   │   ├── rules.ts            ★ 型付きルールセット
│   │   ├── scoring.ts          ★ スコア式（実装は1つだけ）
│   │   ├── validation.ts       ★ 不正検証（同上）
│   │   ├── nickname.ts         ニックネームの正規化
│   │   └── api.ts              HTTP の型定義
│   └── game-rules/
│       ├── v3.json             ★ スコア定数（ゲームと API の両方が読む）
│       ├── score-fixtures.json ★ 手計算したゴールデン値（式を固定）
│       └── README.md
│
├── src/
│   ├── main.tsx                エントリポイント
│   ├── app/
│   │   ├── Root.tsx            /dev ルートの切り替え（開発時のみ）
│   │   ├── App.tsx             画面遷移、pause/resume、向き制御、先読み
│   │   ├── GameLayer.tsx       Phaser ホストの保持と StageContext の生成
│   │   └── ErrorBoundary.tsx   白画面にしないための境界
│   │
│   ├── assets/                 ★ 素材システム
│   │   ├── assetTypes.ts       型定義と Asset ID の導出
│   │   ├── assetManifest.ts    ★ ファイルを知っている唯一の場所
│   │   ├── define.ts           img() / sheet() / sfx() / bgm()
│   │   └── assetRegistry.ts    ID → URL・メタデータ（Phaser 非依存）
│   │
│   ├── config/
│   │   ├── rules.ts            shared/core/rules.ts の再 export
│   │   ├── game.ts             タイトル、機能フラグ、難易度、メンテナンス
│   │   └── stages/             ステージごとのチューニング値
│   │       ├── late.ts
│   │       ├── bread.ts        パンのカタログ（データ駆動）
│   │       └── teacher.ts
│   │
│   ├── game/
│   │   ├── core/               ステージ共通の土台
│   │   │   ├── BaseStageScene.ts   ライフサイクル・HUD・終了処理
│   │   │   ├── GameHost.ts         Phaser インスタンスの管理
│   │   │   ├── AssetLoader.ts      レジストリ → Phaser、代替テクスチャ
│   │   │   ├── ScoreManager.ts     メトリクス集約 → スコア → UI イベント
│   │   │   ├── scoring.ts          shared/core/scoring.ts の再 export
│   │   │   ├── GameClock.ts        一時停止に強い時計
│   │   │   ├── DragController.ts   相対ドラッグ入力（1軸・ステージ1）
│   │   │   ├── DragVector.ts       相対ドラッグ入力（2軸・ステージ3）
│   │   │   ├── Hud.ts              Phaser 内 HUD
│   │   │   └── fx.ts               ポップ・シェイク・パーティクル
│   │   └── stages/
│   │       ├── index.ts        ★ ステージレジストリ
│   │       ├── late/           ステージ1
│   │       ├── bread/          ステージ2（problemGenerator は純粋関数）
│   │       └── teacher/        ステージ3（ステルス）
│   │           ├── TeacherScene.ts  描画と入力だけ
│   │           ├── map/             衝突・視線・巡回グラフ（Phaser 非依存）
│   │           └── sim/             巡回AI・視界・検知・ミッション（同上）
│   │
│   ├── components/             React UI（screens / ui / overlays / dev）
│   ├── services/               API・ランキング・run・音声・振動・保存
│   ├── stores/                 zustand（画面遷移・設定・デバッグ）
│   ├── utils/                  乱数・safe area・ニックネーム・カウントアップ
│   └── dev/                    /dev と /dev/assets（開発ビルドのみ）
│
├── public/assets/              ★ 差し替え対象のファイル群
│   ├── common/  late/  bread/  teacher/
│
├── scripts/                    ビルド時ツール（本番では動きません）
│   ├── generate-placeholders.mjs   仮素材の生成（決定論的）
│   ├── generate-asset-docs.ts      ASSETS.md の生成
│   └── lib/                        PNG/WAV エンコーダ
│
├── tests/                      Vitest
│   ├── *.test.ts               純粋ロジック（スコア・乱数・ステルスモデル等）
│   └── server/                 API を実 HTTP + 実 PostgreSQL(PGlite) で検証
│
├── api/                        ★ Vercel のルーティング規約。1行ずつの再 export
│   ├── health.ts
│   ├── leaderboard.ts
│   ├── runs/index.ts
│   ├── runs/[runId]/complete.ts
│   └── cron/housekeeping.ts    CRON_SECRET で保護
│
├── server/                     API の中身（ホストに依存しません）
│   ├── http/
│   │   ├── routes.ts           ★ ハンドラの実体。テストはここを直接呼びます
│   │   ├── route.ts            共通パイプライン（エラー・ヘッダ・CORS・制限・本文）
│   │   └── apiError.ts         唯一の投げてよい例外型
│   ├── service/                runService / leaderboardService
│   ├── repository/             SQL（すべてパラメータ化）
│   ├── validation/             リクエスト形状
│   ├── domain/                 Run とその状態
│   ├── db/                     Neon 接続・型・マイグレーション
│   ├── config/env.ts           環境変数（必須値が無ければ即エラー）
│   └── support/                Clock / Ids / Logger
│
└── docs/
```

---

## リクエストの流れ（スコア送信）

```text
POST /api/runs/{runId}/complete
        │
        ▼
ErrorMiddleware          例外を JSON に。内部エラーは詳細を隠す
        ▼
SecurityHeadersMiddleware  nosniff / DENY / CSP
        ▼
CorsMiddleware           許可リスト方式。本番は同一オリジンなので出番なし
        ▼
JsonBodyMiddleware       サイズ上限つきの JSON 解析
        ▼
RateLimitMiddleware      IP（ハッシュ化）ごとの固定ウィンドウ
        ▼
RoutingMiddleware
        ▼
RunController            run id の形式だけ確認して委譲
        ▼
SubmissionRequestValidator   型と件数（422）
        ▼
RunService               run の状態・期限・configVersion・二重送信
        ▼
StageResultValidator     メトリクス上限・整合性・プレイ時間
        ▼
ScoreCalculator          ★ サーバー側で再計算
        ▼
Repository（1トランザクション）  runs / stage_results / scores
        ▼
JSON レスポンス
```

---

## 4つ目のミニゲームを追加する

既存の3ステージには**一切触りません**。

1. `src/game/stages/<id>/` を作り、`StageModule` を満たすモジュールを書く
   （`index.ts` にメタデータ、`<Name>Scene.ts` に `BaseStageScene` の派生）。
2. `src/config/stages/<id>.ts` にチューニング値を書く。
3. `shared/game-rules/v3.json` の `stageOrder` に id を足し、`stages.<id>` に
   `scoring` / `limits` / `rank` を書く。
4. `shared/core/scoring.ts` に
   同じ式を足し、`score-fixtures.json` にゴールデン値を足す。
5. `src/game/stages/index.ts` の `STAGE_MODULES` に1行足す。
6. 素材を `assetManifest.ts` の新しいバンドルに足す。

アプリシェル、リザルト画面、送信処理、ランキング、開発ツールは自動的に対応します。
画面はすべて `stageOrder` のインデックスとモジュールのメタデータから描画されるためです。

`tests/config.test.ts` が「ルールセットにあるステージはすべて登録済み」「ランク閾値は
到達可能」などを検証するので、抜けがあればテストが落ちます。

---

## パフォーマンス方針

- ゲーム中の React 再レンダリングをゼロにする（HUD は Phaser 側）。
- ステージ1の障害物はプールして、プレイ中にオブジェクトを確保しない。
- 各ステージの Phaser コードは動的 import で別チャンクにし、必要になるまで落とさない。
- 初回ロードは `common` + ステージ1 のみ。ステージ2・3 はタイトル表示後に
  バックグラウンドで温める。
- テキストのみ devicePixelRatio で描画（最大2倍）。スプライトは CSS ピクセル解像度で
  描き、素材側を表示サイズより大きく作ることで綺麗さと速度を両立する。
- 画面はすべて相対レイアウト。固定ピクセル配置に依存しないので、アスペクト比が変わっても
  破綻しません。
