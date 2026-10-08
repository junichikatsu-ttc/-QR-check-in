# QRチェックイン

学校の集団行動（修学旅行・遠足など）で、**バスに全員乗っているか**をスマートフォンだけで確認するアプリ。

- **生徒**: 学籍番号でログインすると自分の QR が表示される（5 分ごとに自動更新）
- **先生**: パスワードでログインし、イベント（「10/8 帰りのバス」など）を作って QR をカメラで読む。
  誰が済み・誰が未かがクラスごとに一覧で分かる。QR を出せない生徒は学籍番号の手入力でもチェックインできる

enebular クラウド実行環境（ZIP / Node.js 22.x）にデプロイし、API と画面を**同じ ZIP・同一オリジン**で配信する。
スマートフォンのブラウザ（iOS Safari / Android Chrome）で動く。アプリのインストールは不要。

```
qr-checkin/
├── build.mjs          ZIP ビルド（web → 関数 → ZIP。処理順を変えない）
├── deploy.mjs         enebular CLI ラッパ（check / init / config / deploy / smoke）
├── zip-package.json   ZIP に同梱する package.json（"type": "module" を書かない）
├── src/               関数側（Hono）
│   ├── app.ts           3 通りマウント。ここは触らない
│   ├── static.ts        静的配信と ?v= 置換
│   ├── config.ts        環境変数の設定漏れ検出（throw しない）
│   ├── schemas.ts       API 契約（Zod）。ブランド型 TenantId / StudentId / EventId
│   ├── lib/token.ts     HMAC 署名トークン（ログイン・QR）
│   ├── lib/cache.ts     名簿・イベントのコンテナ内キャッシュ（アクセス数削減）
│   ├── middleware/      requireAuth（役割つき）/ basic-auth（任意）
│   ├── routes/          auth / me / roster / events / health / static
│   └── datastore/       enebular データストアのラッパと 3 つのリポジトリ
├── web/               フロントエンド（フレームワークなし・esbuild のみ）
│   ├── src/main.js      生徒画面
│   ├── src/teacher/     先生画面（main.js / scanner.js）
│   └── public/          index.html / teacher.html / styles.css（app.js / teacher.js は生成物）
├── test/              enebular 固有の挙動と主要導線を固定するテスト
└── docs/              構成・データモデル・API・運用
```

## 画面

| URL | 誰が | 何をする |
| :--- | :--- | :--- |
| `/<トリガー>/` | 生徒 | 学籍番号を入れて QR を表示する |
| `/<トリガー>/teacher.html` | 先生 | 名簿の登録、イベント作成、スキャン、一覧、CSV 書き出し |

先生の初回手順: ログイン → **名簿** に Excel から「学籍番号・氏名・クラス」を貼り付けて保存 →
**イベント** を作成（対象クラスを選べる）→ **スキャン**。
生徒は名簿にある学籍番号でしかログインできないので、名簿が先。

## ローカル開発

```bash
npm install
cp .env.example .env     # SESSION_SECRET / TEACHER_PASSWORD の開発用の値が入っている

npm run dev:web    # 別ターミナル。web の監視ビルド
npm run dev        # http://localhost:8787  先生画面は /teacher.html（パスワード: teacher）
```

データストアは**ローカルで代替できない**（接続情報を実行環境が注入するため）。
`DATASTORE_MODE=memory` のときはインメモリ実装に切り替わる。**再起動すると名簿もイベントも消える。**
通しの確認は `test/checkin.test.ts`（fake に差し替えた統合テスト）で行う。

カメラは https か localhost でしか起動しない。実機で試すときは enebular にデプロイするのが早い。

```bash
npm run typecheck && npm test
npm run build       # qr-checkin-function.zip ができる
```

## enebular へのデプロイ

初回だけコンソールでの作業がある。

1. コンソールでプロジェクトを作る → `ENEBULAR_PROJECT_ID`
2. コンソールでデータストアのテーブルを **3 つ** 作る（[docs/data-model.md](docs/data-model.md) のキー名・型と一致させる）→ テーブル ID
3. `cp .env.deploy.example .env.deploy` して 1・2 の値、アクセスキー、`FN_SESSION_SECRET`（ランダム 32 文字以上）、
   `FN_TEACHER_PASSWORD` を入れる
4. `npm run enebular:init` — ZIP を作ってファイルアセットを登録し、`ENEBULAR_FILE_ASSET_ID` を書き戻す
5. コンソールでクラウド実行環境を作る（そのアセット / ランタイム Node.js 22.x）→ `ENEBULAR_CLOUD_ID`
6. `npm run enebular:config` — HTTP トリガー・タイムアウト・`connectDataStore`・環境変数を一括設定
7. トリガー URL を `ENEBULAR_HTTP_TRIGGER_URL` に入れる

以降は `npm run enebular:deploy` だけ。ビルド → 差し替え → デプロイ → バージョン記録 →
スモークテスト（`/v1/health` の `commit` が今回のビルドと一致するか）まで通す。

```bash
npm run enebular:check              # 設定の確認（値はマスク表示）
npm run enebular:deploy --dry-run   # enebular を呼ばずに手順だけ確認
npm run enebular:smoke              # デプロイ済みの環境を確認
```

> `.env.deploy` には API キーと署名鍵が入るのでコミットしない。
> `FN_*` は関数の環境変数になる（`FN_` を外して送られる）。**送った内容で置き換わる**ので、
> `FN_*` を消すと実行環境からもそのキーが消える。

運用上の注意（アクセス数の目安、QR の有効期限、名簿の更新が反映されるまでの時間）は
[docs/operations.md](docs/operations.md)。

## 増やすときの手順

| やること | 触るファイル |
| :--- | :--- |
| API を足す | `src/routes/` に 1 本足し、`src/routes/index.ts` でマウント（認証もそこで掛ける） |
| 画面を足す | `web/public/*.html` / `web/build.mjs` の entries / `src/static.ts` の `STATIC_ASSET_NAMES` / `build.mjs` の `STATIC_ASSETS` / `src/routes/static-routes.ts` |
| テーブルを足す | `src/datastore/tables.ts` / `.env.example` / `.env.deploy.example` / `deploy.mjs` の `REQUIRED_FN`。リポジトリは `checkins-repo.ts` を写す |
| 環境変数を足す | `src/config.ts`（モードに応じた必須はコードで持つ） / `.env.example` / `.env.deploy.example` |

設計の理由と落とし穴は `enebular-app` スキルの `references/` と [docs/architecture.md](docs/architecture.md) にある。
`test/app.test.ts` と `test/frontend-guard.test.ts` は enebular 固有の挙動を固定しているので消さない。
