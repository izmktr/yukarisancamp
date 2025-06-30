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