# ゆかりさん△

プリンセスコネクト！Re:Dive のクランバトル（クラバト）を、WebアプリとDiscordボットで支援するモノレポです。

Webとボットは同じSupabase上の凸データ・ボス状態を共有します。ログインはGoogle（Firebase Authentication）です。

## ディレクトリ構成

- `web-app-ts/`: TypeScript製Webアプリケーション（Express + EJS）
- `discord-bot-py/`: Python製Discordボット（nextbot）
- `schema/`: 共有データスキーマ（JSON Schema）
- `document/`: セットアップ・運用ドキュメント
- `deploy/nginx/`: 本番用nginx設定

## 役割分担

| 役割 | 使うもの |
| --- | --- |
| ログイン | Firebase Authentication（Google） |
| 管理者権限（admin） | Firestore の `userRoles` |
| アプリデータ（掲示板、クラン、クラバト設定、プロフィールなど） | Supabase |
| Webサーバー | Express（開発時は `http://localhost:3000`） |
| Discordボット | discord.py。既定の入力チャンネル名は `凸報告` |

## セットアップ手順

### Webアプリケーション

1. **Webアプリのディレクトリに移動します:**
   ```bash
   cd web-app-ts
   ```

2. **環境変数ファイルを用意します:**
   `web-app-ts/.env_sample` を `.env.local` にコピーし、値を埋めます。必須項目は次のとおりです。
   - `SESSION_SECRET`（32文字以上の乱数）
   - Firebase クライアント設定（`FIREBASE_API_KEY` など）
   - `FIREBASE_ADMIN_SDK_KEY`（admin判定用。サービスアカウントJSONへのパス）
   - `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / `SUPABASE_PUBLISHABLE_KEY`
   - `DISCORD_LINK_SECRET_KEY`
   - `YUKALINK_COMMON_KEY`（ボット側と同じ値）

3. **依存関係をインストールします:**
   ```bash
   npm install
   ```

4. **スキーマから型定義ファイルを生成します:**
   ```bash
   npm run generate-types
   ```

5. **開発サーバーを起動します:**
   ```bash
   npm run dev
   ```

ブラウザで `http://localhost:3000` を開きます。localhost では Googleログインの代わりに開発ログインも使えます。詳細は [`document/dev-login.md`](document/dev-login.md) を参照してください。

### Discordボット

1. **ボットのディレクトリに移動します:**
   ```bash
   cd discord-bot-py
   ```

2. **依存関係をインストールします:**
   ```bash
   pip install -r requirements.txt
   ```

3. **環境変数を設定します:**
   `src/nextbot/.env.local` に次を設定します。
   - `DISCORD_TOKEN`（または `DISCORD_BOT_TOKEN`）
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `YUKALINK_COMMON_KEY`（Web側と同じ値）

   入力チャンネル名を変える場合は `NEXTBOT_INPUT_CHANNEL` を設定します（未設定時は `凸報告`）。

4. **Discordボットを起動します:**
   ```bash
   python src/main.py
   ```

## 主な画面

| 画面 | URL | アクセス |
| --- | --- | --- |
| 情報 | `/`, `/info` | 誰でも |
| 掲示板 | `/board` | 閲覧は誰でも。投稿・編集はログイン後 |
| 設定 | `/settings` | ログインユーザー |
| クラン（凸管理） | `/clan` | Discordサーバー連携済み |
| クランデータ | `/clan-data` | Discordサーバー連携済み |
| クラン管理 | `/clan-management` | Discordサーバー連携済み（マスター／サブマスター／代理） |
| キャラ確認 | `/chara-check` | admin |
| クラン一覧 | `/clanlist` | admin |
| クラバト設定 | `/clanbattle-settings` | admin |

## 権限管理（admin ロール）

- ユーザーの権限は Firestore の `userRoles` コレクションのみで管理します
- プロフィール本体（表示名、Discord連携など）は Supabase の `setting_userprofile` に保存します
- admin 付与は Firebase Console で `userRoles/{uid}` ドキュメントを作成し、`role: "admin"` を設定してください
- 詳細は [`document/firebase-db-setup.md`](document/firebase-db-setup.md) を参照してください

## テスト

Webアプリ:

```bash
cd web-app-ts
npm test
```

Discordボット:

```bash
cd discord-bot-py
python -m unittest test.test_nextbot_attack
```

## 関連ドキュメント

- [`document/google-auth-setup.md`](document/google-auth-setup.md) — Googleログイン（Firebase Authentication）
- [`document/firebase-db-setup.md`](document/firebase-db-setup.md) — Firestore（adminロール）
- [`document/supabase-setup.md`](document/supabase-setup.md) — Supabase接続とテーブル
- [`document/dev-login.md`](document/dev-login.md) — localhost専用の開発ログイン
- [`document/pm2-deploy-setup.md`](document/pm2-deploy-setup.md) — Webアプリの本番PM2起動
- [`document/pm2-discord-bot-setup.md`](document/pm2-discord-bot-setup.md) — Discordボットの本番PM2起動
- [`document/https-nginx-setup.md`](document/https-nginx-setup.md) — nginx + HTTPS
- [`discord-bot-py/src/nextbot/bot.md`](discord-bot-py/src/nextbot/bot.md) — ボット仕様

## 開発時の注意点

- Webの環境変数は `web-app-ts/.env.local`、ボットは `discord-bot-py/src/nextbot/.env.local` に置きます。どちらもコミットしません
- Discord連携を動かすには、Webとボットで `YUKALINK_COMMON_KEY` を揃えてください
- アプリデータはSupabase、管理者判定だけFirestore、という分担です
- テーブル作成SQLは [`document/supabase_createtable.sql`](document/supabase_createtable.sql) にまとめています
