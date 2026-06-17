# web-app-ts 向け Google 認証（Firebase）設定手順

このドキュメントは、`web-app-ts` で Google ログインが正常に通るように、Google 側（Firebase / Google Cloud）で必要な設定をまとめたものです。

## 前提

- Firebase プロジェクトID: `yukarisan-f3b06`
- 開発URL: `http://localhost:3000`
- 認証基盤: Firebase Authentication（Google プロバイダ）

`.env.local` の設定値から、上記プロジェクトを利用している前提です。

## 1. Firebase Authentication で Google プロバイダを有効化

1. [Firebase Console](https://console.firebase.google.com/) を開く
2. プロジェクト `yukarisan-f3b06` を選択
3. 左メニューから `Authentication` を開く
4. `Sign-in method` タブを開く
5. `Google` を選択して `有効化`
6. サポートメールを選択して保存

ポイント:
- ここが無効だと、アプリ側コードが正しくても Google ログインは失敗します。

## 2. 認証ドメイン（Authorized domains）を追加

1. 同じく `Authentication` の `Settings` タブを開く
2. `Authorized domains` に以下を登録
   - `localhost`（ローカル開発用）
   - 本番ドメイン（例: `your-domain.com`）

注意:
- ポート番号は不要です（`localhost:3000` ではなく `localhost`）。
- ドメインが未登録だと `auth/unauthorized-domain` エラーになります。

## 3. Google Cloud 側の OAuth 同意画面を確認

Firebase で Google ログインを使う場合でも、内部的には Google Cloud の OAuth 設定が利用されます。

1. [Google Cloud Console](https://console.cloud.google.com/) を開く
2. Firebase と同じプロジェクト `yukarisan-f3b06` を選択
3. `API とサービス` -> `OAuth 同意画面`
4. 以下を確認
   - アプリ名
   - サポートメール
   - 公開ステータス

運用時の目安:
- 開発中は `テスト` でも可
- 本番公開時は `本番環境` へ公開を検討

## 4. OAuth のテストユーザー設定（必要な場合）

OAuth 同意画面が `テスト` の場合、ログインできるGoogleアカウントは制限されます。

1. Google Cloud Console の `OAuth 同意画面` を開く
2. `テストユーザー` にログイン許可したい Gmail を追加

症状:
- 追加していないアカウントでログインすると、アクセス拒否画面になります。

## 5. （必要時）承認済みリダイレクトURIを確認

通常、Firebase標準の Google ログインでは手動設定不要ですが、
Google Cloud の OAuth クライアントを独自利用している場合は、次のようなURIが必要です。

- `https://yukarisan-f3b06.firebaseapp.com/__/auth/handler`

独自ドメインを使う場合:
- `https://<独自ドメイン>/__/auth/handler` も追加

## 6. アプリ設定値との整合確認

`web-app-ts/.env.local` と Firebase プロジェクトが一致していることを確認します。

- `FIREBASE_PROJECT_ID=yukarisan-f3b06`
- `FIREBASE_AUTH_DOMAIN=yukarisan-f3b06.firebaseapp.com`
- `FIREBASE_API_KEY=...`

注意:
- 別プロジェクトの値が混在すると、ログインは成功しても想定外プロジェクトに接続されます。

## 7. 動作確認手順

1. `web-app-ts` を起動
2. ブラウザで `http://localhost:3000` を開く
3. Google ログインを実行
4. 成功後、以下を確認
   - エラーが出ない
   - セッションや画面表示がログイン状態になる

## よくあるエラーと対処

### `auth/unauthorized-domain`
- 原因: `Authorized domains` に現在のドメインが未登録
- 対処: Firebase Authentication のドメイン設定に追加

### `Error 403: access_denied`（OAuth画面）
- 原因: OAuth 同意画面がテスト状態で、対象アカウントがテストユーザー未登録
- 対処: テストユーザー追加、または本番公開

### `redirect_uri_mismatch`
- 原因: OAuth クライアントのリダイレクトURIと実際のURIが不一致
- 対処: 承認済みリダイレクトURIに正しいハンドラURIを登録

## チェックリスト

- [ ] Firebase Authentication の Google プロバイダを有効化した
- [ ] `Authorized domains` に `localhost` を追加した
- [ ] 本番ドメインを登録した（本番運用時）
- [ ] OAuth 同意画面の設定を完了した
- [ ] テスト運用時は対象アカウントをテストユーザーに追加した
- [ ] `.env.local` の Firebase 値が `yukarisan-f3b06` と一致している
