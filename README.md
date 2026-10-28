# ユカリさん△

プリンセスコネクト！Re:Dive のクランバトル（クラバト）を、WebアプリとDiscordボットで支援するモノレポです。

Webとボットは同じSupabase上の凸データ・ボス状態を共有します。ログインはGoogle（Firebase Authentication）です。

## ディレクトリ構成

- `web-app-ts/`: TypeScript製Webアプリケーション（Express + EJS）
- `discord-bot-py/`: Python製Discordボット（nextbot）
- `schema/`: 共有データスキーマ（JSON Schema）
- `document/`: セットアップ・運用ドキュメント
- `deploy/nginx/`: 本番用nginx設定

## 役割分担

| 役割 | 使うもの |
| --- | --- |
| ログイン | Firebase Authentication（Google） |
| 管理者権限（admin） | Firestore の `userRoles` |
| アプリデータ（掲示板、クラン、クラバト設定、プロフィールなど） | Supabase |
| Webサーバー | Express（開発時は `http://localhost:3000`） |
| Discordボット | discord.py。既定の入力チャンネル名は `凸報告` |

## セットアップ手順

### Webアプリケーション

1. **Webアプリのディレクトリに移動します:**
   ```bash
   cd web-app-ts
   ```

2. **環境変数ファイルを用意します:**
   `web-app-ts/.env_sample` を `.env.local` にコピーし、値を埋めます。必須項目は次のとおりです。
   - `SESSION_SECRET`（32文字以上の乱数）
   - Firebase クライアント設定（`FIREBASE_API_KEY` など）
   - `FIREBASE_ADMIN_SDK_KEY`（admin判定用。サービスアカウントJSONへのパス）
   - `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / `SUPABASE_PUBLISHABLE_KEY`
   - `DISCORD_LINK_SECRET_KEY`
   - `YUKALINK_COMMON_KEY`（ボット側と同じ値）

3. **依存関係をインストールします:**
   ```bash
   npm install
   ```

4. **スキーマから型定義ファイルを生成します:**
   ```bash
   npm run generate-types
   ```

5. **開発サーバーを起動します:**
   ```bash
   npm run dev
   ```

ブラウザで `http://localhost:3000` を開きます。localhost では Googleログインの代わりに開発ログインも使えます。詳細は [`document/dev-login.md`](document/dev-login.md) を参照してください。

### Discordボット

1. **ボットのディレクトリに移動します:**
   ```bash
   cd discord-bot-py
   ```

2. **依存関係をインストールします:**
   ```bash
   pip install -r requirements.txt
   ```

3. **環境変数を設定します:**
   `src/nextbot/.env.local` に次を設定します。
   - `DISCORD_TOKEN`（または `DISCORD_BOT_TOKEN`）
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `YUKALINK_COMMON_KEY`（Web側と同じ値）

   入力チャンネル名を変える場合は `NEXTBOT_INPUT_CHANNEL` を設定します（未設定時は `凸報告`）。

4. **Discordボットを起動します:**
   ```bash
   python src/main.py
   ```

## 主な画面

| 画面 | URL | アクセス |
| --- | --- | --- |
| 情報 | `/`, `/info` | 誰でも |
| 掲示板 | `/board` | 閲覧は誰でも。投稿・編集はログイン後 |
| 設定 | `/settings` | ログインユーザー |
| クラン（凸管理） | `/clan` | Discordサーバー連携済み |
| クランデータ | `/clan-data` | Discordサーバー連携済み |
| プラン | `/clan-plan` | Discordサーバー連携済み |
| クラン管理 | `/clan-management` | Discordサーバー連携済み（マスター／サブマスター／代理） |
| キャラ確認 | `/chara-check` | admin |
| クラン一覧 | `/clanlist` | admin |
| クラバト設定 | `/clanbattle-settings` | admin |

クランタブの凸履歴はメンバーごとの表で表示します。「修正」から周回数・ボス・ダメージ・状態を編集し、「確定」で保存、「破棄」で変更を取り消せます。ダメージはカンマ付きでも入力でき、空欄は未入力として保存します。

クランタブのボス一覧は「すべて」「攻撃中」「自分」で切り替えられます。「すべて」は全5ボス、「攻撃中」は誰かが攻撃しているボス、「自分」は本人または代理操作できるメンバーが攻撃しているボスを表示します。選択した表示モードは保存されます。本人または代理操作できるメンバーがいる場合、攻撃中かどうかにかかわらず各ボスの「変更」からHPを修正できます。

プラン画面の上部では、5体のボスを列にした表で現在の進行・平均・予想着地・前日予定・本日済み・残り見込みを比較できます。ボス5の右には合計を表示します（現在・予想着地は対象外）。平均の合計は各ボスの丸め前の値を足し、算出できないボスがあれば「算出不可」とします。長いボス名は小さめの文字で折り返し、スマートフォンでも画面幅に収めて表示します。

集計の日付は「対象日」として表示し、クランバトル期間中のみ開始日を1日目とした「（n日目）」を日付の後ろに付けます。対象日の日本時間5時切り替えの処理は変更しません。

残り見込みは、いずれかのボスで赤チェック（予定超過）があるメンバーを除外し、残ったメンバーのボスごとの未消化予定を合算します。予想着地にもこの残り見込みを使います。残り見込みの合計セルは、1段目に凸数、2段目に「(不明:12凸)」の形式で前日の全周回の本凸数−（当日の全周回の消化済み本凸＋残り見込み合計）を表示します。前日・当日とも22周目以前も含め、持ち越しは従来の本凸選択ルールで重複計上しません。前日の本凸数が少ない場合など、不明が負数になってもそのまま表示します。ボス別の予定・実績・平均・残り見込みは従来どおり23周目以降を対象とします。不明が0の場合は2段目を空間ごと非表示にして高さを詰め、合計列の幅は変えません。

ボス画像は、キャラ確認で同じボス名に登録した画像を掲示板と共通の名前照合処理で表示します。未登録・画像未設定・画像読み込み失敗の場合は、同じ大きさのボス番号入り代替枠を表示し、ボス名は画像の下に残します。通常の見出しにボス番号は表示せず、項目・合計列をコンパクトにしてボス列の幅を確保します。

プラン画面の「メンバー」は全メンバーを名前・ボス1〜5の表で、1人1行に表示します。予定は前日、実績は当日の本凸です。1凸ごとに、未消化の予定は四角枠、予定分の実績は四角枠＋緑チェック、予定超過分は枠なしの赤チェックのSVGで表示します。操作できるチェックボックスではなく、凸履歴からの自動表示です。1個なら48px、複数ならセル幅に合わせて縮小します。狭い画面では表内の横スクロールで1個の視認性を維持します。予定・実績とも0凸なら—、開催初日は比較できないため実績の数値のみ、期間外は算出不可として—を表示します。

プランのモバイル表示（画面幅600px以下）では、進行状況表のボス名を非表示にし、画像だけを表示します。画像がない場合のボス番号入り代替枠は残し、読み上げ用のボス名も維持します。PC表示ではボス名も表示します。

メンバー表は緑・赤チェックの合計（当日の本凸）が3つ以上のメンバーを灰色の背景で下側に表示します。未消化の四角枠は数えず、各グループ内では元の並び順を維持します。開催期間外にはこの判定を行いません。

## 権限管理（admin ロール）

- ユーザーの権限は Firestore の `userRoles` コレクションのみで管理します
- プロフィール本体（表示名、Discord連携など）は Supabase の `setting_userprofile` に保存します
- admin 付与は Firebase Console で `userRoles/{uid}` ドキュメントを作成し、`role: "admin"` を設定してください
- 詳細は [`document/firebase-db-setup.md`](document/firebase-db-setup.md) を参照してください

## テスト

Webアプリ:

```bash
cd web-app-ts
npm test
```

Discordボット:

```bash
cd discord-bot-py
python -m unittest test.test_nextbot_attack
```

## 関連ドキュメント

- [`document/google-auth-setup.md`](document/google-auth-setup.md) — Googleログイン（Firebase Authentication）
- [`document/firebase-db-setup.md`](document/firebase-db-setup.md) — Firestore（adminロール）
- [`document/supabase-setup.md`](document/supabase-setup.md) — Supabase接続とテーブル
- [`document/dev-login.md`](document/dev-login.md) — localhost専用の開発ログイン
- [`document/pm2-deploy-setup.md`](document/pm2-deploy-setup.md) — Webアプリの本番PM2起動
- [`document/pm2-discord-bot-setup.md`](document/pm2-discord-bot-setup.md) — Discordボットの本番PM2起動
- [`document/https-nginx-setup.md`](document/https-nginx-setup.md) — nginx + HTTPS
- [`discord-bot-py/src/nextbot/bot.md`](discord-bot-py/src/nextbot/bot.md) — ボット仕様

## 開発時の注意点

- Webの環境変数は `web-app-ts/.env.local`、ボットは `discord-bot-py/src/nextbot/.env.local` に置きます。どちらもコミットしません
- Discord連携を動かすには、Webとボットで `YUKALINK_COMMON_KEY` を揃えてください
- アプリデータはSupabase、管理者判定だけFirestore、という分担です
- テーブル作成SQLは [`document/supabase_createtable.sql`](document/supabase_createtable.sql) にまとめています
