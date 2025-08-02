# Voice Chat Timer Discord Bot

Discord上でボイスチャットの参加時間を計測し、累積時間に応じてロールを自動付与するBotです。

## 機能

- **ボイスチャット時間計測**: ユーザーのボイスチャンネル参加時間を自動的に記録
- **AFKチャンネル除外**: 休止チャンネル（AFKチャンネル）での時間は計測対象外
- **自動ロール付与**: 設定した累積時間に達するとロールを自動付与
- **DM通知**: ロール獲得時にユーザーにダイレクトメッセージで報酬通知を送信
- **ランキング表示**: 通話時間のランキング表示（10位ずつページネーション）
- **個人統計**: 各ユーザーの通話時間と次のロール報酬までの時間を表示
- **データリセット**: 全ユーザーの通話時間を一括リセット
- **スケジュールリセット**: 指定した日時に自動リセットを実行（定期実行対応）

## セットアップ

### 1. 依存関係のインストール
```bash
npm install
```

### 2. 設定ファイルの編集
`config.json`を編集して、ボットトークンとギルドIDを設定してください：

```json
{
  "token": "YOUR_BOT_TOKEN_HERE",
  "guildId": "YOUR_GUILD_ID_HERE"
}
```

- `token`: DiscordのDeveloper Portalで取得したボットトークン
- `guildId`: ボットを使用するサーバーのID（省略可能、グローバルコマンドとして登録する場合）

### 3. ボットの起動
```bash
npm start
```

## スラッシュコマンド

### ロール報酬管理
- `/role-reward add <時間> <ロール>` - ロール報酬を追加
- `/role-reward remove <時間>` - ロール報酬を削除
- `/role-reward list` - 設定されたロール報酬一覧を表示

### AFKチャンネル管理
- `/afk-channel add <チャンネル>` - AFKチャンネルを追加
- `/afk-channel remove <チャンネル>` - AFKチャンネルを削除
- `/afk-channel list` - 設定されたAFKチャンネル一覧を表示

### 統計・ランキング
- `/ranking [ページ]` - 通話時間ランキングを表示
- `/my-time` - 自分の通話時間を表示

### データ管理
- `/reset-time confirm` - 全ユーザーの通話時間をリセット（付与されたロールも削除）

### スケジュールリセット管理（管理者のみ）
- `/schedule-reset add <日時> [繰り返し]` - スケジュールされたリセットを追加
- `/schedule-reset list` - スケジュールされたリセット一覧を表示
- `/schedule-reset cancel <ID>` - スケジュールされたリセットをキャンセル

## 使用例

### ロール報酬の設定
```
/role-reward add 1 @灰
/role-reward add 10 @銅
/role-reward add 30 @銀
/role-reward add 100 @金
```

### AFKチャンネルの設定
```
/afk-channel add #待機部屋
```

### スケジュールリセットの設定
```
# 一回限りのリセット
/schedule-reset add 2025-08-03 02:00

# 毎日午前2時にリセット
/schedule-reset add 2025-08-03 02:00 recurring:daily

# 毎週日曜日午前0時にリセット
/schedule-reset add 2025-08-04 00:00 recurring:weekly

# 毎月1日午前0時にリセット
/schedule-reset add 2025-09-01 00:00 recurring:monthly
```

## データ構造

データは`data.json`ファイルに保存されます：

```json
{
  "voiceTime": {
    "userId": {
      "totalTime": 3600000,
      "sessions": [...]
    }
  },
  "roleRewards": [
    {
      "hours": 1,
      "roleId": "roleId",
      "roleName": "灰"
    }
  ],
  "afkChannels": ["channelId1", "channelId2"]
}
```

## 必要な権限

ボットには以下の権限が必要です：
- メッセージを送信
- スラッシュコマンドを使用
- ロールを管理
- ボイスチャンネルの状態を表示

## 注意事項

- ボット再起動時、進行中のセッションは失われます
- AFKチャンネルでの時間は計測されません
- ロールの付与には適切な権限が必要です
- データはJSONファイルで管理されるため、定期的なバックアップを推奨します
