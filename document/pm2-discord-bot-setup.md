# discord-bot-py 本番環境PM2導入手順

VPS(Linux, systemd利用可)上で nextbot（`discord-bot-py`）を PM2 により常時稼働・自動再起動させるための手順。

Webアプリと **同じPM2デーモン** で管理する。すでに `web-app-ts` を PM2 起動している場合は、ボットを追加して `pm2 save` すればOS再起動時も両方立ち上がる。

## 前提

- Python 3.11 以上がインストール済みであること（`python3 --version` で確認）
- リポジトリを `git clone` 済みであること
- `discord-bot-py/src/nextbot/.env.local` に以下が設定済みであること
  - `DISCORD_TOKEN` または `DISCORD_BOT_TOKEN`
  - `SUPABASE_URL`
  - `SUPABASE_SECRET_KEY`
  - `YUKALINK_COMMON_KEY`

## 1. PM2のインストール

未導入ならインストールする。Web側ですでに入れている場合は不要。

```bash
npm install -g pm2
```

## 2. Python依存関係のインストール

```bash
cd discord-bot-py
python3 -m pip install -r requirements.txt
```

venv を使う場合は、作成・有効化してから `pip install` し、`ecosystem.config.js` の `interpreter` を venv の Python パスに変更する。

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

`interpreter` の例: `/home/<user>/yukarisancamp/discord-bot-py/venv/bin/python`

## 3. PM2でボットを起動

`discord-bot-py/ecosystem.config.js` の設定でプロセスを起動する。

```bash
cd discord-bot-py
mkdir -p logs
pm2 start ecosystem.config.js
```

`pm2 list` で `discord-bot-py` の `status` が `online` になっていることを確認する。

ログは次で確認できる。

```bash
pm2 logs discord-bot-py
```

## 4. OS再起動時の自動起動設定

Web側で未設定なら、先に startup を有効化する。

```bash
pm2 startup
```

表示されたコマンド（`sudo env PATH=... pm2 startup systemd -u <user> --hp <home>` 等）をコピーしてそのまま実行し、systemd unit を生成する。

Web・ボットの両方を起動した状態で保存する。

```bash
pm2 save
```

以降、VPS再起動時にも `pm2 save` したプロセス（web-app-ts と discord-bot-py）が自動復元される。

## 5. ログローテーション

PM2の標準ログはサイズ無制限で肥大化するため、`pm2-logrotate` を導入する。Web側ですでに設定済みなら不要。

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
| ログ確認 | `pm2 logs discord-bot-py` |
| 再起動 | `pm2 restart discord-bot-py` |
| 停止 | `pm2 stop discord-bot-py` |
| 自動起動リストの保存 | `pm2 save` |

## デプロイ更新時の手順

コードを更新した場合は以下を実行する。

```bash
git pull
cd discord-bot-py
python3 -m pip install -r requirements.txt
pm2 restart discord-bot-py
```

## 動作確認

- `pm2 list` の `discord-bot-py` が `online` であること
- `pm2 logs discord-bot-py` に `ログインしました` が出ること
- プロセスをkillした場合に自動的に再起動され、`↺`（再起動回数）が増加すること
- VPSを再起動したあと、`pm2 list` で `discord-bot-py` が再び `online` になること
