# web-app-ts 本番環境PM2導入手順

VPS(Linux, systemd利用可)上で `web-app-ts` を PM2 により常時稼働・自動再起動させるための手順。

Discordボットを同じPM2で常時起動する場合は [`pm2-discord-bot-setup.md`](./pm2-discord-bot-setup.md) を参照する。`pm2 save` すればWebとボットの両方がOS再起動後に復元される。

## 前提

- Node.js / npm がインストール済みであること
- リポジトリを `git clone` 済みで、`web-app-ts/` ディレクトリで作業すること

## 1. PM2のインストール

```bash
npm install -g pm2
```

## 2. アプリのビルド

```bash
cd web-app-ts
npm install
npm run build
```

## 3. PM2でアプリを起動

`web-app-ts/ecosystem.config.js` の設定でプロセスを起動する。

```bash
npm run pm2:start
```

`pm2 list` で `status` が `online` になっていることを確認する。

## 4. OS再起動時の自動起動設定

```bash
pm2 startup
```

表示されたコマンド（`sudo env PATH=... pm2 startup systemd -u <user> --hp <home>` 等）をコピーしてそのまま実行し、systemd unit を生成する。

```bash
pm2 save
```

現在起動中のプロセス一覧を保存する。以降、VPS再起動時にも `pm2 save` した状態が自動的に復元される。

## 5. ログローテーションの導入

PM2の標準ログはサイズ無制限で肥大化するため、`pm2-logrotate` を導入する。

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

## 運用コマンド

| 用途 | コマンド |
| --- | --- |
| プロセス一覧確認 | `pm2 list` |
| ログ確認 | `npm run pm2:logs` または `pm2 logs web-app-ts` |
| 再起動 | `npm run pm2:restart` |
| 停止 | `npm run pm2:stop` |
| ログローテーション設定確認 | `pm2 conf pm2-logrotate` |

## デプロイ更新時の手順

コードを更新した場合は以下を実行する。

```bash
git pull
cd web-app-ts
npm install
npm run build
pm2 restart web-app-ts
```

## 動作確認

- `pm2 list` の `status` が `online` であること
- プロセスをkillした場合に自動的に再起動され、`↺`（再起動回数）が増加すること
- `pm2 conf pm2-logrotate` で `max_size=10M`, `retain=7`, `compress=true` になっていること
