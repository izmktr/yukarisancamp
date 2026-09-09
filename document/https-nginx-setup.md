# VPS常時稼働化: nginx + Let's Encrypt によるHTTPS化手順

`http://yukarisan.mydns.jp:3000/` で直接アクセスしていたのを、`https://yukarisan.mydns.jp/` でアクセスできるようにするための手順。

## 背景

Firebase Authentication（Google ログイン）の `signInWithPopup` は、`localhost` を除き HTTPS（secure context）でないと正常に動作しない。VPS上でHTTP直アクセスのままだと `auth/network-request-failed` が発生する。

## 構成

```
ブラウザ ──HTTPS(443)──> nginx (TLS終端) ──HTTP(内部, 127.0.0.1:3000)──> Node/Express (PM2管理)
```

Node/Express自体はポート3000のままローカルの待受のみとし、外部からの直接アクセス（3000番）は塞ぐ。外部公開はnginx経由の80/443番のみとする。

## 前提

- OS: Rocky Linux 10（`dnf`/`firewalld`/SELinux enforcing が標準）
- ドメイン `yukarisan.mydns.jp` がVPSのグローバルIPを指すよう設定済み（mydns.jp側の設定）
- ルーターで80番・443番のポートフォワーディングが設定済み
- 3000番ポートは外部に公開しない（ルーター側で閉じる）

## 1. nginx / certbot のインストール

Rocky LinuxにはEPELリポジトリからcertbotを入れる。

```bash
sudo dnf install -y nginx
sudo dnf install -y epel-release
sudo dnf install -y certbot python3-certbot-nginx
sudo systemctl enable --now nginx
```

## 2. リバースプロキシ設定の配置

Rocky Linux(RHEL系)のnginxは `sites-available`/`sites-enabled` 方式ではなく、`/etc/nginx/conf.d/*.conf` を直接読み込む構成になっている（`nginx.conf` 内の `include /etc/nginx/conf.d/*.conf;` を参照）。

このリポジトリの [deploy/nginx/yukarisan.mydns.jp.conf](../deploy/nginx/yukarisan.mydns.jp.conf) を配置する。

```bash
sudo cp deploy/nginx/yukarisan.mydns.jp.conf /etc/nginx/conf.d/yukarisan.mydns.jp.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 3. firewalld でポートを開放

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## 4. SELinuxの設定（nginxからNode/Expressへのプロキシ許可）

SELinuxがenforcingの場合、デフォルトではnginxからバックエンド（127.0.0.1:3000）への接続がブロックされるため、以下を許可する。

```bash
sudo setsebool -P httpd_can_network_connect 1
```

配置した設定ファイルには443番の`server`ブロックを含めていない（証明書取得前に443ブロックがあると`nginx -t`が証明書ファイル不在エラーで失敗するため）。次のcertbot実行時に443番ブロックが自動追記される。

## 5. Let's Encrypt証明書の取得

```bash
sudo certbot --nginx -d yukarisan.mydns.jp
```

- 対話式でメールアドレスなどを入力する
- HTTPからHTTPSへのリダイレクトを追加するか聞かれた場合は「有効化する」を選択する
- 成功すると `/etc/letsencrypt/live/yukarisan.mydns.jp/` に証明書一式が生成され、nginx設定にも自動反映される

## 6. 自動更新の確認

Let's Encryptの証明書は90日で失効するため、自動更新を確認する。

```bash
sudo certbot renew --dry-run
```

certbotインストール時に自動更新用のsystemdタイマー（`certbot.timer`）またはcronが登録されるため、通常は追加設定不要。

## 7. Firebase側の設定変更

Firebase Console → Authentication → Settings → Authorized domains に `yukarisan.mydns.jp`（ポート番号なし）を追加する。詳細は [google-auth-setup.md](./google-auth-setup.md#2-認証ドメインauthorized-domainsを追加) を参照。

## 8. 3000番ポートの外部公開を停止

ルーター/ファイアウォールの設定で、3000番ポートのポートフォワーディングを削除・無効化する。Node/Expressプロセス自体は引き続き `127.0.0.1:3000` でリッスンし、nginxからのみアクセスされる状態にする。

## 動作確認

- [ ] `http://yukarisan.mydns.jp/` にアクセスすると `https://yukarisan.mydns.jp/` へ301リダイレクトされる
- [ ] `https://yukarisan.mydns.jp/` がブラウザの証明書エラーなしで表示される
- [ ] `https://yukarisan.mydns.jp/` からGoogleログインが成功する（`auth/network-request-failed` が出ない）
- [ ] 外部から `http://yukarisan.mydns.jp:3000/` にアクセスできない（3000番が遮断されている）
- [ ] `sudo certbot renew --dry-run` が成功する
