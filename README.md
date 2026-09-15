# ytest モノレポプロジェクト

このプロジェクトは、Python製のDiscordボットとTypeScript製のWebアプリケーションを含むモノレポです。

## ディレクトリ構成

- `discord-bot-py/`: Python製Discordボット
- `web-app-ts/`: TypeScript製Webアプリケーション
- `schema/`: 共有データスキーマ
- `.github/workflows/`: CI/CDのためのGitHub Actionsワークフロー

## セットアップ手順

### Webアプリケーション

1. **Webアプリのディレクトリに移動します:**
   ```bash
   cd web-app-ts
   ```

2. **依存関係をインストールします:**
   ```bash
   npm install
   ```

3. **スキーマから型定義ファイルを生成します:**
   ```bash
   npm run generate-types
   ```

4. **開発サーバーを起動します:**
   ```bash
   npm run dev
   ```

### Discordボット

1. **ボットのディレクトリに移動します:**
   ```bash
   cd discord-bot-py
   ```

2. **依存関係をインストールします:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Discordボットを起動します:**
   ```bash
   python src/main.py
   ```

`src/nextbot/.env.local` に `DISCORD_TOKEN`（または `DISCORD_BOT_TOKEN`）、`SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`YUKALINK_COMMON_KEY` を設定してください。

## 開発時の注意点

- 環境変数は `discord-bot-py/src/nextbot/.env.local` に設定してからDiscordボットを起動してください
- Webアプリケーションは通常 `http://localhost:3000` で起動します

## 権限管理（admin ロール）

- ユーザーの権限は Firestore の `userRoles` コレクションのみで管理します
- `userProfiles` には権限フィールドを持たせません
- admin 付与は Firebase Console で `userRoles/{uid}` ドキュメントを作成し、`role: "admin"` を設定してください
- 詳細は [`document/firebase-db-setup.md`](document/firebase-db-setup.md) を参照してください