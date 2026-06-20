# web-app-ts 向け Firebase DB（Firestore）設定手順

このドキュメントは、web-app-ts で利用している Firebase Database（Cloud Firestore）の設定手順をまとめたものです。

## 前提

- Firebase プロジェクトID: yukarisan-f3b06
- 開発URL: http://localhost:3000
- 利用DB: Cloud Firestore（Native mode）
- 主な保存先コレクション:
  - userProfiles
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

- FIREBASE_API_KEY
- FIREBASE_AUTH_DOMAIN
- FIREBASE_PROJECT_ID
- FIREBASE_STORAGE_BUCKET
- FIREBASE_MESSAGING_SENDER_ID
- FIREBASE_APP_ID
- FIREBASE_MEASUREMENT_ID

注意:
- FIREBASE_PROJECT_ID が別プロジェクトになっていると、別DBへ保存されます。

## 3. Firestore セキュリティルールを設定

最低限の推奨ルール例です。

- 未ログインユーザーは書き込み不可
- userProfiles は自分の uid ドキュメントのみ読み書き可
- clanBattles は誰でも読み取り可、書き込みはログインユーザーのみ可

Firebase Console の Firestore Database -> ルール で以下を設定してください。

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /userProfiles/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    match /clanBattles/{yearmonth} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

運用メモ:
- clanBattles の編集権限を管理者のみにしたい場合は、カスタムクレームや allow 条件を追加してください。

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
