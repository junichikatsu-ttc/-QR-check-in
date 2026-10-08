# API

すべて `/<トリガーのパス>/v1/...`。フロントは `location.pathname` からベースを求めるので、
トリガーのパスを環境変数で持たない。リクエスト・レスポンスは JSON。
入力は `src/schemas.ts` の Zod で検証し、違反は `400 VALIDATION` と `details[]`（`path` / `message`）で返る。

認証は `authorization: Bearer <token>`。トークンは `POST /v1/auth/*` が返す（有効期限 `SESSION_TTL_HOURS`、既定 7 日）。

| 区分 | エンドポイント |
| :--- | :--- |
| 認証不要 | `GET /v1/health`、`POST /v1/auth/student`、`POST /v1/auth/teacher`、静的ファイル |
| ログイン済み | `GET /v1/me`、`GET /v1/me/qr` |
| 先生のみ | `/v1/roster`、`/v1/events`、`/v1/events/*` |

## エラー形式

```json
{ "error": { "code": "QR_EXPIRED", "message": "QR の有効期限切れです。...", "details": {} } }
```

| code | status | 意味 |
| :--- | :--- | :--- |
| `VALIDATION` | 400 | 入力が契約に合わない |
| `BAD_REQUEST` | 400 / 413 | JSON が壊れている、名簿が大きすぎる |
| `QR_INVALID` | 400 | このアプリの QR ではない（署名不一致・セッショントークンを読ませた） |
| `QR_EXPIRED` | 400 | QR の有効期限切れ。生徒の画面を更新してもらう |
| `UNAUTHORIZED` | 401 | トークン無し・期限切れ・パスワード違い・名簿に無い学籍番号 |
| `FORBIDDEN` | 403 | 生徒のトークンで先生の API を呼んだ |
| `NOT_FOUND` | 404 | イベント・生徒・チェックインが無い |
| `CONFIG_MISSING` | 500 | `SESSION_SECRET` / `TEACHER_PASSWORD` / テーブル ID が未設定 |
| `DATASTORE` | 503 | データストア操作の失敗（`details.operation` / `kind`） |

## 認証

### `POST /v1/auth/student`

```jsonc
// req
{ "studentId": "2024001" }
// res 200
{ "token": "...", "student": { "studentId": "2024001", "name": "山田 太郎", "className": "1-A" } }
```

名簿に無い学籍番号は 401。

### `POST /v1/auth/teacher`

```jsonc
// req
{ "password": "...", "name": "山田" }   // name は任意。チェックイン記録の by に入る
// res 200
{ "token": "...", "teacher": { "name": "山田" } }
```

## 自分

### `GET /v1/me`

生徒: `{ "role": "student", "student": {...} }`。名簿から外されていれば 401。
先生: `{ "role": "teacher", "teacher": { "name": "山田" } }`

### `GET /v1/me/qr`（生徒のみ）

```jsonc
{ "qr": "eyJrIjoicSIs....pEEN_kEv", "expiresAt": 1759900300000, "ttlSec": 300 }
```

`qr` をそのまま QR コードにする。データストアには当たらない。

## 名簿（先生）

### `GET /v1/roster`

```jsonc
{ "students": [ { "studentId": "...", "name": "...", "className": "..." } ], "updatedAt": 1759900000000 }
```

### `PUT /v1/roster`

```jsonc
// req（全置換。1〜2000 人。学籍番号の重複は VALIDATION）
{ "students": [ { "studentId": "2024001", "name": "山田 太郎", "className": "1-A" } ] }
// res 200
{ "count": 120, "updatedAt": 1759900000000 }
```

## イベント（先生）

### `GET /v1/events`

```jsonc
{ "events": [ { "eventId": "1759900000000", "name": "帰りのバス", "classNames": ["1-A"], "createdAt": 1759900000000, "createdBy": "山田" } ] }
```

### `POST /v1/events`

```jsonc
// req
{ "name": "帰りのバス", "classNames": ["1-A", "1-B"] }   // classNames 省略 or [] で全員
// res 201
{ "event": { ... } }
```

### `GET /v1/events/:eventId`

```jsonc
{
  "event": { ... },
  "students": [
    { "studentId": "2024001", "name": "山田 太郎", "className": "1-A",
      "checkin": { "studentId": "2024001", "checkedInAt": 1759900123456, "point": "バス1", "method": "qr", "by": "山田" } },
    { "studentId": "2024002", "name": "鈴木 花子", "className": "1-A" }
  ],
  "extra": [ { "studentId": "...", "name": "...", "className": "...", "checkin": { ... } } ],
  "summary": { "total": 2, "checkedIn": 1, "remaining": 1 },
  "rosterUpdatedAt": 1759900000000
}
```

`students` は対象クラスの生徒だけ（`classNames` が空なら名簿全員）。`extra` は対象外のチェックイン。

### `DELETE /v1/events/:eventId` → 204

## チェックイン（先生）

### `POST /v1/events/:eventId/checkins`

```jsonc
// req（qr か studentId のどちらか一方）
{ "qr": "<QR の中身>", "point": "バス1" }
{ "studentId": "2024001", "point": "バス1" }     // 手動。名簿に無ければ 404
// res 201（新規） / 200（すでに済み）
{
  "already": false,
  "checkin": { "studentId": "2024001", "checkedInAt": 1759900123456, "point": "バス1", "method": "qr", "by": "山田" },
  "student": { "studentId": "2024001", "name": "山田 太郎", "className": "1-A" },   // 名簿に無ければ null
  "inTarget": true                                                                   // 対象クラスか
}
```

### `DELETE /v1/events/:eventId/checkins/:studentId` → 204（未チェックインなら 404）

## 運用

### `GET /v1/health`

```jsonc
{
  "status": "ok", "version": "0.1.0", "commit": "<git sha>", "builtAt": "...",
  "basicAuth": false, "datastore": "cloud",
  "configOk": true, "configMissing": 0,
  "limits": { "qrTtlSec": 300, "sessionTtlHours": 168, "eventListLimit": 50 }
}
```

`configMissing` は件数のみ。キー名は実行環境の起動ログにだけ出る。
