# Supabase接続設定手順（web-app-ts）

このドキュメントは、web-app-ts の「クラバト設定の保存」を Supabase に向けるために必要なサーバ設定をまとめたものです。

現状の仕様:
- 読み込み: Firebase（Firestore）
- 保存: Supabase（サーバAPI経由）

## 1. 必須環境変数

web-app-ts/.env.local に以下を設定します。

```env
SUPABASE_URL=
SUPABASE_SECRET_KEY=
SUPABASE_CLAN_BATTLE_TABLE=clan_battles

# 既存で利用中（今回の保存APIでは未使用）
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_JWKS_URL=
```

補足:
- `SUPABASE_CLAN_BATTLE_TABLE` 未設定時は `clan_battles` を使用します。
- 保存APIはサーバ側で `SUPABASE_SECRET_KEY` を使って Supabase REST API に `upsert` します。

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

- テーブル名: `SUPABASE_CLAN_BATTLE_TABLE`（デフォルト `clan_battles`）
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
create table if not exists public.clan_battles (
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

## 5. 動作確認手順

1. `web-app-ts/.env.local` を設定
2. Supabase に `clan_battles` テーブル（または指定テーブル）を作成
3. web-app-ts を起動
4. `/clanbattle-settings` を開いてログイン（管理者ユーザー）
5. 値を変更して保存
6. Supabase 側テーブルに `yearmonth` 行が insert/update されることを確認

## 6. よくある問題

### 502 Failed to save clanbattle settings to Supabase
- 原因例: テーブル未作成、`yearmonth` の一意制約不足、カラム名不一致
- 対処: テーブル定義とカラム名を本ドキュメントに合わせる

### 503 Supabase is not configured
- 原因: `SUPABASE_URL` または `SUPABASE_SECRET_KEY` 未設定
- 対処: `.env.local` を設定してサーバ再起動

### 403 管理者のみ閲覧できます
- 原因: 保存APIは `ensureAdmin` 保護
- 対処: Firebase 側 `userRoles/{uid}.role = "admin"` を確認
