# Supabase接続設定手順（web-app-ts）

このドキュメントは、web-app-ts の「クラバト設定」と「設定画面プロフィール」の読み込み・保存を Supabase に向けるために必要なサーバ設定をまとめたものです。

## 1. 必須環境変数

web-app-ts/.env.local に以下を設定します。

```env
SUPABASE_URL=
SUPABASE_SECRET_KEY=

# 既存で利用中（今回の保存APIでは未使用）
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_JWKS_URL=
```

補足:
- テーブル名は `setting_clanbattle`、`setting_userprofile`、`setting_user_owned_character` の固定です。
- APIはサーバ側で `SUPABASE_SECRET_KEY` を使って Supabase REST API に `upsert` します。
- テーブル作成SQLは `document/supabase_createtable.sql` に集約しています。

## 2. 値の取得場所

Supabaseダッシュボードから取得します。

- `SUPABASE_URL`
  - Project Settings > API > Project URL
- `SUPABASE_SECRET_KEY`
  - Project Settings > API > Project API keys > secret
- `SUPABASE_PUBLISHABLE_KEY`
  - Project Settings > API > Project API keys > publishable
- `SUPABASE_JWKS_URL`
  - Project Settings > API > JWT Settings > JWKS URL

## 3. クラバト保存テーブル要件

保存API（`POST /api/clanbattle-settings/save`）が期待するテーブル要件は以下です。

- テーブル名: `setting_clanbattle`（固定）
- 主キー: `id`（integer）
  - 常に `id = 0` の1件のみを保持（CHECK制約で固定）
- 想定カラム:
- `id` integer（固定値 `0`）
  - `yearmonth` text（例: `202606`）
  - `bossname` text[]
  - `bossHp` integer[]（未入力要素は null 許容）
  - `startDate` date
  - `endDate` date

作成SQLは `document/supabase_createtable.sql` の `setting_clanbattle` を使用してください。

注意:
- 現在の保存APIは camelCase カラム名（`bossHp`, `startDate`, `endDate`）で保存します。
- PostgreSQL で camelCase を使う場合はダブルクォートが必要です。

## 4. セキュリティ注意

- `SUPABASE_SECRET_KEY` はサーバ専用です。ブラウザへ渡さないでください。
- `.env.local` はコミットしないでください。
- ログにキー全文を出さないでください。
- 本アプリでは `ensureAdmin` を通過したユーザーのみ保存APIを実行できます。

## 5. 設定画面プロフィールテーブル要件（schema準拠）

設定画面API（`GET /api/settings/profile/current`, `POST /api/settings/profile/save`）が期待するテーブル要件です。

- テーブル名: `setting_userprofile`（固定）
- 主キーまたは一意制約: `googleUserId`
- 想定カラム（`schema/userProfile.schema.json` 準拠）:
  - `googleUserId` text
  - `discordId` text null
  - `discordServer` text null
  - `displayName` text
  - `createdAt` bigint

所持キャラは `setting_user_owned_character` に分離して保存します（`schema/userOwnedCharacter.schema.json` 準拠）。

- テーブル名: `setting_user_owned_character`（固定）
- 想定カラム:
  - `googleUserId` text
  - `officialName` text
  - `nickname` text
  - `owned` boolean
  - `connectRank` integer
- 主キー:
  - `("googleUserId", "officialName")`

作成SQLは `document/supabase_createtable.sql` の `setting_userprofile` / `setting_user_owned_character` を使用してください。

## 6. 動作確認手順

1. `web-app-ts/.env.local` を設定
2. Supabase SQL Editor で `document/supabase_createtable.sql` を実行し、3テーブルを作成
3. web-app-ts を起動
4. `/settings` を開いてログイン
5. 表示名変更を保存し、`setting_userprofile` の対象 `googleUserId` 行が insert/update されることを確認
6. 所持キャラ更新を保存し、`setting_user_owned_character` の対象 `googleUserId` 行が delete/insert されることを確認
7. `/clanbattle-settings` を開いて保存し、`setting_clanbattle` の `id=0` 行が insert/update されることを確認

## 7. よくある問題

### 502 Failed to save clanbattle settings to Supabase
- 原因例: テーブル未作成、`id` 主キー/`id=0` CHECK制約の不一致、カラム名不一致
- 対処: テーブル定義とカラム名を本ドキュメントに合わせる

### 503 Supabase is not configured
- 原因: `SUPABASE_URL` または `SUPABASE_SECRET_KEY` 未設定
- 対処: `.env.local` を設定してサーバ再起動

### 403 管理者のみ閲覧できます
- 原因: 保存APIは `ensureAdmin` 保護
- 対処: Firebase 側 `userRoles/{uid}.role = "admin"` を確認
