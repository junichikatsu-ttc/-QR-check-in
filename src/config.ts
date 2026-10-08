import { dataStoreKind, missingTableEnvs, TABLES } from './datastore'
import { log } from './log'
import { tenantIdSchema } from './schemas'
import type { TenantId } from './schemas'

/**
 * 環境変数の読み取りと設定漏れ検出。
 * - 呼び出しのたびに読む（モジュール読み込み時に固めない）
 * - .env.example の雛形値は未設定と同じ扱い
 * - ここでは throw しない。設定不足で起動を止めると /v1/health すら返らなくなる（pitfalls 8）
 */

const PLACEHOLDERS = new Set(['', 'change-me', '00000000-0000-0000-0000-000000000000'])

function env(name: string): string | undefined {
  const v = process.env[name]?.trim()
  if (v === undefined || PLACEHOLDERS.has(v)) return undefined
  return v
}

function envInt(name: string, fallback: number): number {
  const v = Number(env(name))
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

const DEFAULT_TENANT = tenantIdSchema.parse('default')

export interface AppConfig {
  /** 学校単位の識別子。全テーブルのメインキーの先頭に入る */
  tenantId: TenantId
  /** セッショントークンと QR の署名鍵 */
  sessionSecret: string | undefined
  /** 先生のログインパスワード */
  teacherPassword: string | undefined
  /** QR の有効秒数。短いほどスクリーンショットの使い回しが効かない */
  qrTtlSec: number
  /** ログインの有効時間 */
  sessionTtlHours: number
  /** デモ公開時の簡易ガード。両方そろったときだけ HTML に BASIC 認証を掛ける */
  basicAuthUser: string | undefined
  basicAuthPassword: string | undefined
  eventListLimit: number
}

export function readConfig(): AppConfig {
  const tenant = tenantIdSchema.safeParse(env('TENANT_ID') ?? 'default')
  return {
    tenantId: tenant.success ? tenant.data : DEFAULT_TENANT,
    sessionSecret: env('SESSION_SECRET'),
    teacherPassword: env('TEACHER_PASSWORD'),
    qrTtlSec: envInt('QR_TTL_SEC', 300),
    sessionTtlHours: envInt('SESSION_TTL_HOURS', 168),
    basicAuthUser: env('BASIC_AUTH_USER'),
    basicAuthPassword: env('BASIC_AUTH_PASSWORD'),
    eventListLimit: envInt('EVENT_LIST_LIMIT', 50),
  }
}

export function basicAuthEnabled(): boolean {
  const cfg = readConfig()
  return Boolean(cfg.basicAuthUser && cfg.basicAuthPassword)
}

/**
 * 動作モードに応じた必須キーのうち、未設定のもの。/v1/health には件数だけ出す。
 * ★ 外部サービスを足したら、ここに「モードに応じた必須」を足す。手作業のチェックリストにしない。
 */
export function missingConfigKeys(): string[] {
  const missing: string[] = []
  const cfg = readConfig()
  if (dataStoreKind() === 'cloud') for (const t of missingTableEnvs()) missing.push(TABLES[t].env)
  if (!cfg.sessionSecret) missing.push('SESSION_SECRET')
  if (!cfg.teacherPassword) missing.push('TEACHER_PASSWORD')
  if (env('TENANT_ID') && !tenantIdSchema.safeParse(env('TENANT_ID')).success) missing.push('TENANT_ID')
  // 片方だけ設定されている BASIC 認証は事故なので不足として扱う
  if (Boolean(cfg.basicAuthUser) !== Boolean(cfg.basicAuthPassword)) missing.push('BASIC_AUTH_USER/PASSWORD')
  return missing
}

/** コールドスタート時に 1 回だけ。キー名はここにしか出さない。値はどこにも出さない */
export function logConfigIssues(): void {
  const missing = missingConfigKeys()
  if (missing.length > 0) log.warn('config missing', { keys: missing })
}

/** 実際に効いている上限値。/v1/health に出す */
export function effectiveLimits(): Record<string, number> {
  const cfg = readConfig()
  return { qrTtlSec: cfg.qrTtlSec, sessionTtlHours: cfg.sessionTtlHours, eventListLimit: cfg.eventListLimit }
}
