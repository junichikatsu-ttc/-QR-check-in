import { DataStoreConfigError } from './errors'

/**
 * テーブル定義。キー属性名は enebular コンソールでテーブルを作るときに **この名前・型で** 指定する。
 * テーブル ID は環境変数から解決し、コードに書かない（constraints.md「キー設計の原則」）。
 *
 * アクセスパターン:
 *   roster    学校の名簿 1 件（tenantId, 'roster'）。生徒ログイン・チェックイン時に名前を引く
 *   events    イベント一覧を新しい順に（tenantId で query、createdAt 降順）
 *   checkins  「このイベントで誰がチェックイン済みか」（eventKey で query）
 *             「この生徒はチェックイン済みか」（eventKey + studentId で getItem）
 *
 * ★ テーブルを足すときはここに 1 行足し、.env.example と .env.deploy.example にも同じ env 名を足す。
 *   - mainKey の先頭に所有者・テナントを入れる（他人のデータはキーが一致せず 0 件になる）
 *   - 時系列の subKey は必ず number にする（string だと辞書順になり桁が変わった時点で壊れる）
 */
export const TABLES = {
  roster: { env: 'DS_TABLE_ROSTER', mainKey: 'tenantId', subKey: 'key', subKeyType: 'string' },
  events: { env: 'DS_TABLE_EVENTS', mainKey: 'tenantId', subKey: 'createdAt', subKeyType: 'number' },
  checkins: { env: 'DS_TABLE_CHECKINS', mainKey: 'eventKey', subKey: 'studentId', subKeyType: 'string' },
} as const

export type TableName = keyof typeof TABLES
export const TABLE_NAMES = Object.keys(TABLES) as TableName[]

/** .env.example の雛形値。設定済みとみなさない */
const PLACEHOLDER_RE = /^0{8}-0{4}-0{4}-0{4}-0{12}$/

type Resolver = (name: TableName) => string | undefined
let override: Resolver | undefined

/** ローカル（memory）やテストで、環境変数を介さずテーブル ID を決める */
export function setTableIdResolver(fn: Resolver | undefined): void {
  override = fn
}

/** 環境変数から読む。呼び出しのたびに読む（モジュール読み込み時に固めない） */
export function tableIdFromEnv(name: TableName): string | undefined {
  const raw = process.env[TABLES[name].env]?.trim()
  if (!raw || PLACEHOLDER_RE.test(raw)) return undefined
  return raw
}

export function resolveTableId(name: TableName): string {
  const id = override ? override(name) : tableIdFromEnv(name)
  if (!id) throw new DataStoreConfigError(name)
  return id
}

/** 設定漏れ検出用。未設定のテーブル名を返す */
export function missingTableEnvs(): TableName[] {
  if (override) return []
  return TABLE_NAMES.filter((n) => tableIdFromEnv(n) === undefined)
}
