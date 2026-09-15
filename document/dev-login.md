# localhost 専用の開発ログイン

Googleログインなしで、ログイン後画面（タブ・クラバト設定など）を確認するための機能です。

## 前提

- ブラウザから `http://localhost:3000`（または `127.0.0.1`）でアクセスしていること
- 本番ドメインや LAN IP では `/dev/login` は 404 になります
- Host が localhost でも、接続元が loopback 以外なら拒否します

## 使い方

1. ヘッダー右の「開発ログイン」から選ぶ
   - 一般ユーザー
   - admin
   - admin + クラン（`DEV_DISCORD_SERVER` が必要）
2. または直接 URL を開く

```text
http://localhost:3000/dev/login?role=user
http://localhost:3000/dev/login?role=admin
http://localhost:3000/dev/login?role=admin&withDiscord=1
http://localhost:3000/dev/login?role=admin&discordServer=123456789012345678&redirect=/clanbattle-settings
```

ログアウトは通常の「ログアウト」か `/dev/logout` です。

## 環境変数（任意）

`web-app-ts/.env.local`:

```env
DEV_DISCORD_SERVER=123456789012345678
```

`withDiscord=1` のとき、この値をセッションの `discordServer` に入れます。クラン / クランデータタブの確認に使います。

## できること / できないこと

できること:
- ログイン必須タブの表示確認
- admin 画面（クラバト設定など）の表示・保存（セッション admin のため）
- Discord Server 付きならクラン系ページの表示

できないこと:
- Firebase ID トークンが必要な操作（設定のプロフィール保存、Discord 連携開始など）

設定画面は開発ログイン中は閲覧のみで、保存・連携ボタンは使えません。
