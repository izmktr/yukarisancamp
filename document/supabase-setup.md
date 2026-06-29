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
- テーブル名は `setting_clanbattle` と `setting_userprofile` の固定です。
- APIはサーバ側で `SUPABASE_SECRET_KEY` を使って Supabase REST API に `upsert` します。

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
- 主キーまたは一意制約: `yearmonth`
  - `upsert` の重複解決に必要
- 想定カラム:
  - `yearmonth` text（例: `202606`）
  - `bossname` text[]
  - `bossHp` integer[]（未入力要素は null 許容）
  - `startDate` date
  - `endDate` date

以下は作成例です。

```sql
create table if not exists public.setting_clanbattle (
  yearmonth text primary key,
  bossname text[] not null,
  "bossHp" integer[] not null,
  "startDate" date not null,
  "endDate" date not null,
  updated_at timestamptz not null default now()
);
```

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
  - `ownedCharacters` jsonb

`ownedCharacters` の要素は以下の構造を想定します。

```json
{
  "officialName": "string",
  "nickname": "string",
  "owned": true,
  "connectRank": 0
}
```

作成例:

```sql
create table if not exists public.setting_userprofile (
  "googleUserId" text primary key,
  "discordId" text null,
  "discordServer" text null,
  "displayName" text not null,
  "createdAt" bigint not null,
  "ownedCharacters" jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
```

## 6. 動作確認手順

1. `web-app-ts/.env.local` を設定
2. Supabase に `setting_clanbattle` と `setting_userprofile` テーブルを作成
3. web-app-ts を起動
4. `/settings` を開いてログイン
5. 表示名変更を保存し、`setting_userprofile` の対象 `googleUserId` 行が insert/update されることを確認
6. `/clanbattle-settings` を開いて保存し、`setting_clanbattle` の `yearmonth` 行が insert/update されることを確認

## 7. よくある問題

### 502 Failed to save clanbattle settings to Supabase
- 原因例: テーブル未作成、`yearmonth` の一意制約不足、カラム名不一致
- 対処: テーブル定義とカラム名を本ドキュメントに合わせる

### 503 Supabase is not configured
- 原因: `SUPABASE_URL` または `SUPABASE_SECRET_KEY` 未設定
- 対処: `.env.local` を設定してサーバ再起動

### 403 管理者のみ閲覧できます
- 原因: 保存APIは `ensureAdmin` 保護
- 対処: Firebase 側 `userRoles/{uid}.role = "admin"` を確認
