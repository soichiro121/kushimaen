# KOMATO RUSH

駒場東邦をモチーフにした、スマートフォン向けミニゲーム集です。3つのゲームを連続でプレイして
合計スコアを競い、オンラインランキングに登録できます。

| ステージ           | 内容                                       | 目安   |
| ------------------ | ------------------------------------------ | ------ |
| 1. 遅刻回避        | 私道を走り、生徒をギリギリでかわして校門へ | 約35秒 |
| 2. 羽沢パン購入RTA | 注文されたパンを最速でタップ               | 約40秒 |
| 3. 放課後ステルス  | 先生の視界を避けて校内を回り、昇降口へ脱出 | 約45秒 |

- **フロントエンド**: Vite + React + TypeScript + Phaser 3（静的ファイルとして配信）
- **バックエンド**: TypeScript のサーバーレス関数（`api/`）+ Neon Postgres
- **ホスティング**: Vercel。ゲームと API が同一オリジンなので CORS がありません。

スコアの計算式と検証ロジックは `shared/core/` に**1つだけ**あり、ゲームと API が同じ
コードを呼びます。画面に出る数字とランキングに載る数字がずれることが原理的にありません。

---

## 必要なもの

### 開発（このリポジトリを触る人）

| ツール  | バージョン                    | 用途                |
| ------- | ----------------------------- | ------------------- |
| Node.js | **20.11 以上**（推奨 22 LTS） | ビルド・テスト・API |
| npm     | 10 以上                       | Node.js に同梱      |

それだけです。データベースサーバーも Docker も要りません。API のテストは
**PGlite**（WebAssembly 版の本物の PostgreSQL）に対して走ります。

### 本番

[Vercel](https://vercel.com) と [Neon](https://neon.tech)。どちらも無料枠で動きます。
手順は [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) にあります。

---

## 起動（最短手順）

```bash
npm install
npm run dev
```

<http://localhost:5173> が開きます。**この時点でバックエンドは不要です。** API に接続できない場合は
自動的に **LOCAL MODE** に切り替わり、ランキングは `localStorage` に保存されます。

### スマートフォンの実機で確認する

開発サーバーは LAN に公開されています。`npm run dev` の出力にある `Network:` の URL
（例 `http://192.168.1.23:5173/`）を、同じ Wi-Fi につないだスマートフォンで開いてください。

> Windows では初回に「Node.js のネットワークアクセスを許可しますか」というファイアウォールの
> 確認が出ます。**プライベートネットワーク**を許可してください。

本番ビルドを実機で確認する場合:

```bash
npm run build
npm run preview   # こちらも LAN に公開されます
```

### API も一緒に動かす

```bash
npm i -g vercel
vercel dev
```

ゲームと `/api/*` が同じポートで動きます。`.env` に Neon の `DATABASE_URL` を入れて
おいてください（開発用ブランチを指すのが安全です）。

フロントエンドのコードは常に同一オリジンの相対パス `/api/...` を使うので、URL の
ハードコードはどこにもありません。

---

## よく使うコマンド

| コマンド                      | 内容                                           |
| ----------------------------- | ---------------------------------------------- |
| `npm run dev`                 | 開発サーバー（HMR つき、LAN 公開）             |
| `npm run build`               | 本番ビルド → `dist/`                           |
| `npm run preview`             | 本番ビルドをローカル配信して確認               |
| `npm test`                    | ユニットテスト（Vitest）                       |
| `npm run typecheck`           | 型チェック（strict）                           |
| `npm run lint`                | ESLint                                         |
| `npm run verify`              | lint → typecheck → test → build をまとめて実行 |
| `npm run assets:placeholders` | 仮素材（画像・音声）を再生成                   |
| `npm run assets:docs`         | [docs/ASSETS.md](docs/ASSETS.md) を再生成      |
| `npm run balance`             | スコアバランスをシミュレートして分布を出力     |
| `vercel dev`                  | ゲームと API を同じポートで起動                |
| `npm run db:migrate`          | `DATABASE_URL` にマイグレーションを適用        |

`npm test` にはAPIのテストも含まれます（PGlite に対して実行されるので、データベース
サーバーは不要です）。

---

## 開発用ツール

開発ビルドでのみ有効です（本番では到達できません）。

| URL           | 内容                                                                    |
| ------------- | ----------------------------------------------------------------------- |
| `/dev`        | ステージ単体起動、ビルド情報                                            |
| `/dev/assets` | 全アセット一覧。差し替え後の確認に使います                              |
| `?debug=1`    | FPS・シード・スコア・先生の内部状態などのオーバーレイ、ステージスキップ |

本番ビルドでこれらを有効にしたい場合（ステージング等）は `VITE_ENABLE_DEV_TOOLS=1` を付けて
ビルドします。

---

## ドキュメント

| ファイル                                                   | 内容                                       |
| ---------------------------------------------------------- | ------------------------------------------ |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)               | 全体構成、ディレクトリ、ステージの追加方法 |
| [docs/ASSETS.md](docs/ASSETS.md)                           | **素材の差し替え手順**（自動生成）         |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)                 | 各ゲームのルールとスコア設計               |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                   | Vercel + Neon への本番デプロイ             |
| [shared/game-rules/README.md](shared/game-rules/README.md) | スコア定数の共有とバージョン管理           |

---

## 環境変数

すべて `.env.example` に説明があります。**`.env` は絶対にコミットしないでください**
（`.gitignore` 済み）。本番の値は Vercel の環境変数に入れます。

`DATABASE_URL` 以外は未設定でも動きます。API に繋がらなければ LOCAL MODE で、
ランキングは `localStorage` に保存されます。

---

## 現在の状態

- 3ステージすべて実装済み・実際にプレイ可能です。
- **画像と音声はすべて仮素材です。** 本物の素材に差し替える手順は
  [docs/ASSETS.md](docs/ASSETS.md) にあります。ゲームのコードを触る必要はありません。
