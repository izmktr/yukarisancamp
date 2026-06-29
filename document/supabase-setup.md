# Supabase接続設定手順（web-app-ts）

このプロジェクトで掲示板データをSupabaseへ保存する準備として、まず環境変数を設定します。

## 1. 追加した環境変数

web-app-ts/.env.local に以下を追加しました。

SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_JWKS_URL=

## 2. 値の取得場所

Supabaseダッシュボードから取得します。

- SUPABASE_URL
  - Project Settings > API > Project URL
- SUPABASE_PUBLISHABLE_KEY
  - Project Settings > API > Project API keys > publishable
- SUPABASE_SECRET_KEY
  - Project Settings > API > Project API keys > secret
- SUPABASE_JWKS_URL
  - Project Settings > API > JWT Settings > JWKS URL

## 3. セキュリティ注意

- SECRET_KEY はサーバ専用です。ブラウザ側コードへ渡さないでください。
- PUBLISHABLE_KEY は公開用ですが、サーバ側で使っても問題ありません。
- JWKS_URL は Supabase のJWT検証用公開鍵エンドポイントです。
- .env.local の値はリポジトリにコミットしない運用を推奨します。
- ログ出力時にキー全文を表示しないようにしてください。

## 4. 次の実装ステップ（最小）

1. web-app-ts で Supabase クライアントをサーバ用として初期化する。
2. 既存の掲示板保存処理（ローカルJSON）をリポジトリ層に切り出す。
3. リポジトリ層を Supabase 実装へ差し替える。
4. 既存 data/board の JSON を一括移行するスクリプトを追加する。

## 5. 動作確認の目安

- サーバ起動時に SUPABASE_URL が未設定なら警告を出す。
- 保存処理で接続エラー時に、エラーメッセージをサーバログに出す。
- まずは「一覧取得」「詳細取得」から切り替えると安全です。
