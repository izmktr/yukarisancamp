# sample: setting_clanbattle event watcher

`setting_clanbattle_events` の最新行を監視し、更新通知を検知したら `setting_clanbattle` の最新 1 件（`yearmonth` 降順）を表示するサンプルです。

## 準備

1. `sample/.env.local` に以下を設定

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

2. Supabase 側に以下テーブルがあること

- `setting_clanbattle`
- `setting_clanbattle_events`

## 実行

```powershell
cd discord-bot-py
python sample/watch_setting_clanbattle_event.py
```

## 動作

- 5秒ごとに `setting_clanbattle_events` の最新行を確認
- 新しいイベントIDを検知したときだけ、`setting_clanbattle` を再取得して内容を表示
