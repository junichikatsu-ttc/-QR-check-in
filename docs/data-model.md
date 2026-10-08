# データモデル

enebular データストアはメインキー + サブキーの JSON アイテムストア（JOIN・二次インデックス・集計なし）。
テーブルは **enebular コンソールで次のキー名・型のとおりに作る**（`src/datastore/tables.ts` と一致させる）。

| テーブル | 環境変数 | メインキー | サブキー | 1 アイテム |
| :--- | :--- | :--- | :--- | :--- |
| roster | `DS_TABLE_ROSTER` | `tenantId` (string) | `key` (string) | 学校の名簿まるごと |
| events | `DS_TABLE_EVENTS` | `tenantId` (string) | `createdAt` (number) | イベント 1 件 |
| checkins | `DS_TABLE_CHECKINS` | `eventKey` (string) | `studentId` (string) | チェックイン 1 件 |

`tenantId` は `TENANT_ID`（既定 `default`）。1 校 1 デプロイなら触らない。
複数校で 1 つのデプロイを共有する場合に備えて、全テーブルのメインキーの先頭に入れてある。

## roster

```jsonc
{
  "tenantId": "default",
  "key": "roster",
  "students": [
    { "studentId": "2024001", "name": "山田 太郎", "className": "1-A" },
    { "studentId": "2024002", "name": "鈴木 花子", "className": "1-A" }
  ],
  "updatedAt": 1759900000000
}
```

- 常に `key = "roster"` の 1 アイテム。`PUT /v1/roster` は**全置換**
- 上限 2000 人・直列化 300KB（1 アイテム約 350KB の制限に対する安全側）
- `studentId` は `[A-Za-z0-9_-]{1,32}`、`name` は 64 文字、`className` は 32 文字まで（空可）
- 実行コンテナ内で 30 秒キャッシュ。更新時は同じコンテナのキャッシュだけ無効化される

## events

```jsonc
{
  "tenantId": "default",
  "createdAt": 1759900000000,     // = eventId（API では "1759900000000" の文字列）
  "name": "10/8 帰りのバス",
  "classNames": ["1-A", "1-B"],   // 空配列なら名簿全員が対象
  "createdBy": "山田"
}
```

- 一覧は `tenantId` で query、`createdAt` 降順（新しい順）。`EVENT_LIST_LIMIT`（既定 50）件
- 削除はこのアイテムだけ。紐づく checkins は残るが、`eventKey` からしか引けないので参照されない
  （消すなら人数分の `deleteItem` が要るため、アクセス数を考えて残している）

## checkins

```jsonc
{
  "eventKey": "default:1759900000000",   // `${tenantId}:${eventId}`
  "studentId": "2024001",
  "checkedInAt": 1759900123456,
  "point": "バス1",                      // 先生が端末ごとに設定した読み取り地点（空可）
  "method": "qr",                        // "qr" | "manual"
  "by": "山田"                           // ログイン時に入れた先生の表示名
}
```

- 「済みか」は `getItem(eventKey, studentId)`、「誰が済みか」は `eventKey` で query（100 件/ページ）
- 取り消しは `deleteItem`。再スキャンすると新しい時刻で記録される

## アクセスパターンと回数

| 操作 | データストア呼び出し |
| :--- | :--- |
| 生徒ログイン | getItem(roster) ×1（キャッシュ命中時 0） |
| QR 取得（5 分ごと） | 0（署名のみ） |
| スキャン / 手動 | getItem(checkin) ×1 + putItem ×1（名簿・イベントはキャッシュ） |
| 一覧表示 | query ×ceil(人数/100)（+ キャッシュ切れ時 getItem ×2） |
| イベント作成 | putItem ×1 |
| 名簿保存 | putItem ×1 |

見積りの例は [operations.md](operations.md)。
