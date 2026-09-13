# 本番デプロイ（Apache + PHP）

本番サーバーで必要なのは **Apache / PHP 8.3+ / Composer / データベース** だけです。
**Node.js は本番サーバーに常駐しません。** フロントエンドは開発機か CI でビルドし、
できあがった静的ファイルを Apache が配信します。

```bash
# これらを本番で実行する必要はありません
node server.js   ✗
npm start        ✗
pm2              ✗
```

---

## 1. サーバーの準備

### 必要なもの

| ソフトウェア | バージョン                                                   |
| ------------ | ------------------------------------------------------------ |
| Apache       | 2.4                                                          |
| PHP          | 8.3 以上（8.2 でも動きます）                                 |
| PHP 拡張     | `pdo`, `pdo_mysql`（または `pdo_pgsql`）, `mbstring`, `json` |
| Composer     | 2.x                                                          |
| データベース | MySQL 8 / MariaDB 10.6+ / PostgreSQL 13+                     |

`intl` は任意です（あればニックネームの Unicode 正規化が有効になります）。

### 有効にする Apache モジュール

```bash
sudo a2enmod rewrite headers expires deflate
sudo systemctl restart apache2
```

---

## 2. ディレクトリ構成

```text
/var/www/komato-game/
├── frontend/
│   └── dist/              ← Vite のビルド成果物（Apache が配信）
│       ├── index.html
│       └── assets/
│
├── backend/
│   ├── public/            ← 公開されるのはここだけ
│   │   ├── index.php
│   │   └── .htaccess
│   ├── src/               ← 非公開
│   ├── vendor/            ← 非公開
│   ├── migrations/        ← 非公開
│   ├── bin/               ← 非公開
│   ├── var/               ← ログ。非公開・書き込み可
│   └── .env               ← 非公開。DB パスワードを含む
│
└── shared/
    └── game-rules/        ← v3.json。PHP が読む
```

> **重要**: `backend/src`, `backend/vendor`, `backend/.env`, `backend/migrations` は
> HTTP から絶対に取得できない場所に置いてください。上の構成では、ドキュメントルートを
> `backend/public` と `frontend/dist` に限定することで達成しています。

---

## 3. フロントエンドのビルド

開発機または CI で:

```bash
npm ci
npm run build
```

`dist/` ができます。これをサーバーの `/var/www/komato-game/frontend/dist/` に配置します。

```bash
rsync -av --delete dist/ user@server:/var/www/komato-game/frontend/dist/
```

`shared/game-rules/` もサーバーへコピーします（PHP が読みます）。

```bash
rsync -av shared/ user@server:/var/www/komato-game/shared/
```

### ビルド時の環境変数

リポジトリ直下の `.env`（または CI の環境変数）で指定します。**すべて任意です。**

| 変数                    | 既定          | 用途                                                     |
| ----------------------- | ------------- | -------------------------------------------------------- |
| `VITE_API_BASE_URL`     | 空            | 空のままにしてください。同一オリジンの `/api` を使います |
| `VITE_TITLE`            | `KOMATO RUSH` | タイトルの差し替え                                       |
| `VITE_DISABLED_STAGES`  | 空            | 例 `teacher` で該当ステージだけ本番から外す              |
| `VITE_MAINTENANCE`      | `0`           | `1` でメンテナンス画面                                   |
| `VITE_DIFFICULTY_SCALE` | `1`           | 全体の難易度倍率                                         |
| `VITE_ENABLE_DEV_TOOLS` | `0`           | `1` で本番ビルドにも `/dev` を含める（ステージング用）   |

> `VITE_API_BASE_URL` を空にしておくと、フロントエンドは `/api` を同一オリジンで呼ぶため
> **CORS の設定が一切不要**になります。トラブルの元を最初から作らない構成です。

---

## 4. バックエンドの設置

```bash
cd /var/www/komato-game/backend

# 本番では dev 依存を入れない
composer install --no-dev --optimize-autoloader

cp .env.example .env
$EDITOR .env          # DB_DSN / DB_USER / DB_PASSWORD を設定

mkdir -p var
chown -R www-data:www-data var
chmod 750 var
chmod 640 .env
```

データベースを作成してからマイグレーションを実行します。

```sql
CREATE DATABASE komato_rush CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'komato'@'localhost' IDENTIFIED BY '安全なパスワード';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER, REFERENCES
  ON komato_rush.* TO 'komato'@'localhost';
FLUSH PRIVILEGES;
```

```bash
php bin/migrate.php
```

再実行しても安全です（適用済みのファイルは飛ばされます）。**本番のスキーマを手で変更しないで
ください。** 変更は必ず `backend/migrations/<driver>/` に新しい番号付きファイルを足します。

---

## 5. Apache の設定

`/etc/apache2/sites-available/komato-game.conf`:

```apache
<VirtualHost *:443>
    ServerName game.example.jp

    SSLEngine on
    SSLCertificateFile      /etc/letsencrypt/live/game.example.jp/fullchain.pem
    SSLCertificateKeyFile   /etc/letsencrypt/live/game.example.jp/privkey.pem

    # ---- フロントエンド（静的ファイル） --------------------------------
    DocumentRoot /var/www/komato-game/frontend/dist

    <Directory /var/www/komato-game/frontend/dist>
        Require all granted
        AllowOverride None
        Options -Indexes -MultiViews

        # SPA のフォールバック。存在しないパスは index.html を返す。
        # /dev や /dev/assets を直接開けるようにするためにも必要です。
        RewriteEngine On
        RewriteCond %{REQUEST_URI} !^/api/
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^ /index.html [L]
    </Directory>

    # ---- API（PHP） -----------------------------------------------------
    Alias /api /var/www/komato-game/backend/public/index.php

    <Directory /var/www/komato-game/backend/public>
        Require all granted
        AllowOverride All
        Options -Indexes -MultiViews

        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteRule ^ index.php [QSA,L]
    </Directory>

    # ---- 非公開ディレクトリの明示的な遮断（多重防御） --------------------
    <Directory /var/www/komato-game/backend/src>
        Require all denied
    </Directory>
    <Directory /var/www/komato-game/backend/vendor>
        Require all denied
    </Directory>
    <Directory /var/www/komato-game/backend/migrations>
        Require all denied
    </Directory>
    <Directory /var/www/komato-game/backend/var>
        Require all denied
    </Directory>
    <Directory /var/www/komato-game/shared>
        Require all denied
    </Directory>

    <FilesMatch "^\.">
        Require all denied
    </FilesMatch>

    # ---- キャッシュ -----------------------------------------------------
    <IfModule mod_expires.c>
        ExpiresActive On

        # ハッシュ付きのファイル名なので長期キャッシュして安全
        <LocationMatch "^/assets/.*-[A-Za-z0-9_-]{8,}\.(js|css)$">
            ExpiresDefault "access plus 1 year"
            Header set Cache-Control "public, immutable"
        </LocationMatch>

        # 画像と音声はファイル名が変わらないので短めに
        <LocationMatch "^/assets/(common|late|bread|teacher)/">
            ExpiresDefault "access plus 7 days"
        </LocationMatch>

        # index.html は必ず再検証。これを間違えると更新が届かなくなる
        <LocationMatch "^/(index\.html)?$">
            ExpiresActive Off
            Header set Cache-Control "no-cache, must-revalidate"
        </LocationMatch>
    </IfModule>

    <IfModule mod_deflate.c>
        AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml
    </IfModule>

    <IfModule mod_headers.c>
        Header always set X-Content-Type-Options "nosniff"
        Header always set Referrer-Policy "strict-origin-when-cross-origin"
        Header always set Strict-Transport-Security "max-age=31536000"
        Header always unset X-Powered-By
    </IfModule>

    ErrorLog  ${APACHE_LOG_DIR}/komato-error.log
    CustomLog ${APACHE_LOG_DIR}/komato-access.log combined
</VirtualHost>

# HTTP は HTTPS へ
<VirtualHost *:80>
    ServerName game.example.jp
    Redirect permanent / https://game.example.jp/
</VirtualHost>
```

```bash
sudo a2ensite komato-game
sudo apache2ctl configtest
sudo systemctl reload apache2
```

### サブディレクトリに置く場合

`https://example.jp/komato/` のように配置する場合:

1. ビルド時に `base` を設定する（`vite.config.ts` に `base: '/komato/'` を追加）。
2. `backend/.env` に `API_BASE_PATH="/komato"` を設定する。
3. Apache の `Alias` とフォールバックのパスを合わせる。

---

## 6. 動作確認

```bash
curl -s https://game.example.jp/api/health
# {"status":"ok","configVersion":1,"serverTime":"..."}

# 非公開ファイルが漏れていないこと（403 か 404 になるはず）
curl -sI https://game.example.jp/../backend/.env
curl -sI https://game.example.jp/api/../src/AppFactory.php
```

ブラウザで開き、`/dev` に**開発ツールが表示されない**ことも確認してください。本番ビルドでは
`GAME_CONFIG.devToolsAvailable` が false になるため、`/dev` も `/dev/assets` も通常の
ゲーム画面になります（SPA フォールバックにより 404 ではなく index.html が返ります）。
`?debug=1` を付けてもデバッグオーバーレイは出ません。

---

## 7. 定期メンテナンス

放置された run とレート制限のレコードを掃除します。スコアと完了した run は消えません。

```cron
0 * * * * www-data php /var/www/komato-game/backend/bin/housekeeping.php >/dev/null 2>&1
```

### ログ

`backend/var/app.log` に JSON Lines で出力されます。内容は内部エラーと、検証で弾かれた
送信の詳細です。クライアントには返されません。

```bash
tail -f /var/www/komato-game/backend/var/app.log | jq .
```

ログローテーション（`/etc/logrotate.d/komato`）:

```text
/var/www/komato-game/backend/var/app.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    create 640 www-data www-data
}
```

---

## 8. 更新のしかた

### フロントエンドだけ

```bash
npm ci && npm run build
rsync -av --delete dist/ user@server:/var/www/komato-game/frontend/dist/
```

`index.html` は `no-cache` なので、次のアクセスで新しいバンドルが読まれます。

### バックエンド

```bash
cd /var/www/komato-game/backend
git pull                                        # またはファイルを転送
composer install --no-dev --optimize-autoloader
php bin/migrate.php
```

### ゲームバランスを変えるとき

`shared/game-rules/v3.json` は**フロントとバックの両方**が読みます。片方だけ更新すると
スコアが食い違うので、必ず両方を同時に更新してください。

大きな変更は新しい `vN.json` を作り、`configVersion` を上げ、`backend/.env` の
`CONFIG_VERSION` とフロントエンドの読み込み先を合わせます。既存の run は古い
`config_version` を保持し、**ランキングは現在のバージョンのスコアだけを表示します**。
これがないと、リバランス前の（今より高く出る）スコアが永久に上位に居座ってしまいます。

古い世代のスコアは削除されず `scores.config_version` に残るので、必要なら後から
参照・集計できます。

---

## 9. 学校で配布するときのチェックリスト

URL / QR コードを配る前に確認してください。

- [ ] `https` で配信されている（音声とバイブレーションは安全なコンテキストが前提）
- [ ] `backend/.env` の `APP_ENV=production`（エラー詳細が返らなくなる）
- [ ] `.env` が HTTP から取得できない
- [ ] `php bin/migrate.php` が適用済み
- [ ] `/api/health` が 200 を返す
- [ ] `/dev` を開いても開発ツールではなく通常のゲームが表示される
- [ ] 実機（iPhone Safari と Android Chrome）で1プレイ通す
- [ ] 横向きにすると「縦向きでプレイしてください」が出る
- [ ] プレイ中にホームに戻して復帰したとき、タイマーが進まず「再開」が出る
- [ ] ランキングに名前が載る
- [ ] `RATE_LIMIT_PER_WINDOW` が十分大きい
      （学校の回線は NAT で1つの IP に見えることがあります。既定は 120/分）
- [ ] 校内 Wi-Fi が `/api` へのアクセスを遮断していない

### 負荷の目安

1プレイあたりのリクエストは 3 回だけです（health / runs / complete）。数百人が同時に遊んでも、
共有ホスティングの Apache + MySQL で十分処理できます。ボトルネックになるとすれば初回の
アセット配信なので、`mod_deflate` と `mod_expires` の設定を省略しないでください。
