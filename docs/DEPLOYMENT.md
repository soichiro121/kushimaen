# 本番デプロイ（Vercel + Neon）

フロントエンドとAPIを **Vercel** に、データベースを **Neon**（サーバーレス Postgres）に
置きます。管理するサーバーはありません。

```text
        ブラウザ
           │
           ▼
   ┌───────────────────────────┐
   │ Vercel                    │
   │  /            静的ファイル  │  ← dist/ （Viteのビルド成果物）
   │  /api/*       関数         │  ← api/ （TypeScript）
   └───────────┬───────────────┘
               │ TLS
               ▼
        Neon Postgres
```

---

## 1. Neon でデータベースを作る

1. <https://neon.tech> でプロジェクトを作成します（無料枠で足ります）。
2. リージョンは利用者に近いところを選びます（日本なら `ap-southeast-1` など）。
3. 接続文字列をコピーします。**必ず「Pooled connection」の方**を使ってください。

```text
postgresql://user:password@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
                                  ^^^^^^^ これが入っていること
```

> **なぜプール接続なのか**: サーバーレス関数は呼び出しのたびに接続を開いて捨てます。
> 非プール接続だとすぐ上限に達して、混み合った瞬間にAPIが落ちます。

---

## 2. スキーマを作る

マイグレーションはローカルから流します。**本番DBを手作業で変更しないでください。**

```bash
cp .env.example .env
# .env の DATABASE_URL に Neon の接続文字列を貼る
npm run db:migrate
```

```text
[db:migrate] applied 001_initial_schema.sql
```

スキーマを変えるときは `server/db/migrations/` に連番のファイルを足して、もう一度これを
実行します。適用済みのファイルは `schema_migrations` テーブルに記録されるので、二度
流れることはありません。

---

## 3. Vercel にデプロイする

### 3-1. プロジェクトを作る

<https://vercel.com/new> でこのGitHubリポジトリを import します。`vercel.json` があるので
ビルド設定は自動で入ります。触る必要はありません。

| 項目             | 値（自動）      |
| ---------------- | --------------- |
| Framework Preset | Vite            |
| Build Command    | `npm run build` |
| Output Directory | `dist`          |

### 3-2. 環境変数を入れる

Project Settings → Environment Variables で設定します。**`.env` をコミットしてはいけません。**

| キー                        | 値                           | 必須     |
| --------------------------- | ---------------------------- | -------- |
| `DATABASE_URL`              | Neon のプール接続文字列      | **はい** |
| `CRON_SECRET`               | 下のコマンドで生成した文字列 | **はい** |
| `APP_TIMEZONE`              | `Asia/Tokyo`                 | 推奨     |
| `RATE_LIMIT_PER_WINDOW`     | `120`                        | 任意     |
| `RATE_LIMIT_WINDOW_SECONDS` | `60`                         | 任意     |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`CRON_SECRET` は掃除用エンドポイントの合言葉です。**未設定だとそのエンドポイントは
404を返します**（開いたままにするより閉じる方に倒してあります）。

`VITE_*` は**ビルド時**に読まれます。あとから変えた場合は再デプロイが必要です。
通常は `VITE_API_BASE_URL` を空のままにしてください。ゲームとAPIが同一オリジンになり、
CORSの面が消えます。

### 3-3. デプロイ

`main` に push すれば自動でデプロイされます。

---

## 4. 動作確認

```bash
curl -s https://<あなたのドメイン>/api/health
# {"status":"ok","configVersion":3,"serverTime":"..."}
```

`configVersion` が `shared/game-rules/` の現行バージョンと一致していることを確認します。
ずれていると、クライアントは `config_version_mismatch` で弾かれます。

ブラウザで開いて1プレイし、ランキングに載ることを確認してください。API に到達できない
場合、ゲームは黙って **LOCAL MODE** に落ちて localStorage にスコアを貯めます。つまり
「遊べているのにランキングが共有されない」状態があり得るので、必ず実際に順位が
出ることまで見てください。

---

## 5. 定期メンテナンス

`vercel.json` に cron が入っています。毎日 04:00 UTC に `/api/cron/housekeeping` が
呼ばれ、放置された run と古いレート制限の窓を削除します。

**完了した run とスコアには触れません。** それがランキングそのものです。

手で実行する場合:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<あなたのドメイン>/api/cron/housekeeping
```

> Vercel の Hobby プランは cron の頻度に制限があります。テーブルが増えて困る規模では
> ないので、日次で十分です。

---

## 6. 更新のしかた

### コードだけ

`main` に push すれば終わりです。

### スコアのバランスを変えた

既存のスコアが動くような変更は、**必ず新しい `vN.json` を作って `configVersion` を
上げてください。** ランキングは現行バージョンのスコアだけを表示します。上げずに変えると
旧スコアと新スコアが同じ表に並び、比較できなくなります。

1. `shared/game-rules/v(N+1).json` を作り、中の `configVersion` を上げる
2. `shared/core/rules.ts` の import を差し替える
3. `shared/game-rules/score-fixtures.json` の期待値を更新する
4. `npm test` を通す
5. push する

### スキーマを変えた

`server/db/migrations/` にファイルを足し、`npm run db:migrate` を流してから push します。

---

## 7. セキュリティ上の取り決め

| 項目                | どうなっているか                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| スコアの改ざん      | クライアントの `totalScore` は**保存しません**。`shared/core/scoring.ts` で毎回計算し直します          |
| SQLインジェクション | 全クエリがパラメータ化。SQL文字列にユーザー入力を連結している箇所はありません                          |
| XSS                 | ニックネームは制御文字・不可視文字を除去。描画は React なのでエスケープは構造的に保証されます          |
| CORS                | 同一オリジン運用なのでヘッダ自体を出しません。必要な場合も許可リストのオリジンのみ（`*` は使いません） |
| レート制限          | DB共有の固定窓。`/api/health` だけ除外（LOCAL MODE 誤判定を防ぐため）                                  |
| ボディサイズ        | `MAX_BODY_BYTES`（既定32KB）超は 413                                                                   |
| 二重送信            | `UPDATE ... WHERE status='open'` で1行だけが成立。DBレベルの保証です                                   |
| エラー情報の漏洩    | 想定外の例外は一律 500。例外メッセージもスタックも本文には出しません（ログには出ます）                 |
| 秘密情報            | `.env` は `.gitignore` 済み。本番の値は Vercel の環境変数に入れます                                    |

---

## 8. ローカルで動かす

### ゲームだけ（APIなし）

```bash
npm run dev
```

APIに繋がらないので LOCAL MODE で動きます。ゲームプレイの確認はこれで十分です。

### APIも含めて

```bash
npm i -g vercel
vercel dev
```

ゲームと `/api/*` が同じポートで動きます。`.env` の `DATABASE_URL` を見るので、Neon の
開発用ブランチを指しておくと安全です。

### テスト

```bash
npm test
```

APIのテストは **PGlite**（WebAssembly版の本物のPostgreSQL）に対して走ります。
データベースサーバーもDockerも要りません。

---

## 9. 別のホストに移すには

API は素の Web ハンドラ（`Request` を受けて `Response` を返す関数）です。Vercel 固有の
ものは `api/` 以下の1行ファイルと `vercel.json` だけで、中身は `server/` にあります。
別のホストへ移す場合は、そのホストの入口から `server/http/routes.ts` の関数を呼ぶだけです。
