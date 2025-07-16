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

3. **スキーマからデータモデルを生成します:**
   ```bash
   datamodel-codegen --input ../schema/userProfile.schema.json --input-file-type jsonschema --output src/models.py
   ```

4. **Discordボットを起動します:**
   ```bash
   python src/main.py
   ```

## 開発時の注意点

- 環境変数 `DISCORD_TOKEN` を設定してからDiscordボットを起動してください
- Webアプリケーションは通常 `http://localhost:3000` で起動します
- スキーマファイルを変更した場合は、両方のプロジェクトで型定義/モデルの再生成が必要です