# web-app-ts 向け Firebase DB（Firestore）設定手順

このドキュメントは、web-app-ts で利用している Firebase Database（Cloud Firestore）の設定手順をまとめたものです。

## 前提

- Firebase プロジェクトID: yukarisan-f3b06
- 開発URL: http://localhost:3000
- 利用DB: Cloud Firestore（Native mode）
- 主な保存先コレクション:
  - userProfiles
  - userRoles
  - clanBattles

## 1. Firestore を有効化

1. Firebase Console を開く
2. プロジェクト yukarisan-f3b06 を選択
3. 左メニュー Build -> Firestore Database を開く
4. データベースを作成 を押す
5. モードは Native mode を選択
6. ロケーションを選択して作成

ポイント:
- 本アプリは Firestore を前提に実装されているため、Realtime Database ではなく Firestore を有効化します。

## 2. Web アプリ設定値を確認

web-app-ts/.env.local の設定値が、対象 Firebase プロジェクトと一致していることを確認します。

- SESSION_SECRET（32文字以上の乱数。ソースに直書きしない）
- FIREBASE_API_KEY
- FIREBASE_AUTH_DOMAIN
- FIREBASE_PROJECT_ID
- FIREBASE_STORAGE_BUCKET
- FIREBASE_MESSAGING_SENDER_ID
- FIREBASE_APP_ID
- FIREBASE_MEASUREMENT_ID

注意:
- FIREBASE_PROJECT_ID が別プロジェクトになっていると、別DBへ保存されます。

## 2.5. Firebase Admin SDK を設定（role 管理の場合）

role フィールドを活用するには、Firebase Admin SDK でサーバー側から Firestore にアクセスする必要があります。

### 2.5.1 サービスアカウント JSON を生成

1. [Firebase Console](https://console.firebase.google.com/) を開く
2. プロジェクト yukarisan-f3b06 を選択
3. ⚙️ 設定 -> プロジェクトの設定
4. サービスアカウント タブを開く
5. **新しい秘密鍵を生成** を押す
6. JSON ファイルがダウンロードされます（例: `yukarisan-f3b06-firebase-adminsdk-xxxxx.json`）

### 2.5.2 web-app-ts に配置

ダウンロードした JSON ファイルを以下の場所に配置します：

```
web-app-ts/
  serviceAccountKey.json  ← ここに配置
```

**⚠️ 重要: `.gitignore` に追加して git で管理しない**

```gitignore
# web-app-ts/.gitignore に追加
serviceAccountKey.json
```

### 2.5.3 .env.local に設定

web-app-ts/.env.local に以下を追加します：

```env
FIREBASE_ADMIN_SDK_KEY=../web-app-ts/serviceAccountKey.json
```

相対パスは web-app-ts/src/index.ts からの相対パスです。

## 3. Firestore セキュリティルールを設定

最低限の推奨ルール例です。

- 未ログインユーザーは書き込み不可
- userProfiles は自分の uid ドキュメントのみ読み書き可
- userRoles はクライアントから読み書き不可（Admin SDK / Console のみ）
- clanBattles は誰でも読み取り可、書き込みは admin ユーザーのみ可

Firebase Console の Firestore Database -> ルール で以下を設定してください。

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /userProfiles/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update: if request.auth != null && request.auth.uid == userId;
    }

    match /userRoles/{userId} {
      allow read, write: if false;
    }

    match /clanBattles/{yearmonth} {
      allow read: if true;
      allow write: if request.auth != null
        && exists(/databases/$(database)/documents/userRoles/$(request.auth.uid))
        && get(/databases/$(database)/documents/userRoles/$(request.auth.uid)).data.role == 'admin';
    }
  }
}
```

**セキュリティ対応の説明:**
- `userProfiles` には権限フィールドを持たせず、表示名などのプロフィール情報のみ保持します。
- `userRoles` は権限専用コレクションです。クライアントからは read/write ともに不可です。
- サーバーは `/api/user/session` 時に `userRoles/{uid}` を読み込み、`role` が `"admin"` のときのみ管理者扱いにします。
- `userRoles/{uid}` が存在しないユーザーは `role: "user"` として扱われます（通常ユーザーはレコードなし運用）。
- Firestore 側でも `clanBattles` への書き込みは `userRoles/{uid}.role == "admin"` のユーザーだけ許可されます。

**admin ロール付与方法:**
1. Firebase Console の Firestore Database -> userRoles コレクションを開く
2. 対象ユーザーの uid をドキュメントIDにして新規作成（既存なら開く）
3. `role` フィールドを `"admin"` で保存
5. ユーザーが次にログインするとき、自動的に admin 権限が反映されます

運用メモ:
- clanBattles の編集権限を管理者のみにしたい場合は、カスタムクレームや allow 条件を追加してください。
- サーバーの Admin SDK 初期化に失敗した場合、全ユーザーは `role: 'user'` で扱われます。コンソールログで確認してください。

## 4. 本アプリのデータ構造

### userProfiles コレクション

ドキュメントID:
- Google ログインユーザーの uid

主なフィールド:
- googleUserId: string
- displayName: string
- discordId: string | null
- discordServer: string | null
- createdAt: number（UNIXミリ秒）

### userRoles コレクション

ドキュメントID:
- Google ログインユーザーの uid

主なフィールド:
- role: string（`admin` のみ作成。通常ユーザーはドキュメントを作成しない）

### clanBattles コレクション

ドキュメントID:
- yearmonth（YYYYMM、6桁）

主なフィールド:
- yearmonth: string（例: 202606）
- bossname: string[5]
- bossHp: integer[5]（未入力は null 許容）
- startDate: string（date 形式、例: 2026-06-25）
- endDate: string（date 形式、例: 2026-06-30）

動作仕様:
- クラバト設定ページを開くと、当月 yearmonth を対象に読み込み
- 当月ドキュメントが無ければ前月ドキュメントをコピーして当月を作成
- 前月も無ければ空データで当月を作成

## 5. ローカル動作確認

1. web-app-ts でビルド
2. サーバー起動
3. ブラウザで /clanbattle-settings を開く
4. Google ログイン
5. 保存を実行し、Firestore の clanBattles/{YYYYMM} に反映されることを確認

## 6. よくある問題と対処

### Missing or insufficient permissions
- 原因: Firestore ルールで書き込みが拒否されている
- 対処: ルールを見直し、ログイン状態とアクセス先パスを確認

### Firebase 設定不足エラー
- 原因: .env.local の必須キー不足
- 対処: FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_APP_ID を確認

### 期待する month のデータが表示されない
- 原因: サーバー/ブラウザ時刻の月ズレ、または別プロジェクト接続
- 対処: 端末時刻・FIREBASE_PROJECT_ID・対象ドキュメントID（YYYYMM）を確認

## チェックリスト

- [ ] Firestore を Native mode で作成した
- [ ] web-app-ts/.env.local が対象プロジェクトと一致している
- [ ] Firestore ルールをデプロイした
- [ ] userProfiles と clanBattles の保存を確認した
- [ ] /clanbattle-settings で当月データの読み書きを確認した
