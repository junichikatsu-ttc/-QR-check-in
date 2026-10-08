import { cached, invalidate } from '../lib/cache'
import type { Student, TenantId } from '../schemas'
import { getDataStoreClient } from './client'
import { runGet, runOp } from './run'
import { resolveTableId } from './tables'

/**
 * 名簿。学校ごとに 1 アイテム（1 論理単位 = 1 アイテム。constraints.md E4）。
 * 2000 人 × 100 バイト ≒ 200KB で、1 アイテム 350KB の上限に収まる。
 *
 * 生徒ログイン・チェックインのたびに読むので、コンテナ内で 30 秒キャッシュする。
 */

const TABLE = 'roster' as const
const KEY = 'roster'
const CACHE_TTL_MS = 30_000

export interface RosterRecord {
  tenantId: TenantId
  key: typeof KEY
  students: Student[]
  updatedAt: number
}

const cacheKey = (tenantId: TenantId) => `roster:${tenantId}`

export async function getRoster(tenantId: TenantId): Promise<RosterRecord | undefined> {
  return cached(cacheKey(tenantId), CACHE_TTL_MS, async () => {
    const client = getDataStoreClient()
    // 初回は必ず無い。"Not found" は正常系（pitfalls 6）
    const res = await runGet(() => client.getItem({ tableId: resolveTableId(TABLE), key: { tenantId, key: KEY } }))
    return res?.params?.Item as RosterRecord | undefined
  })
}

export async function putRoster(tenantId: TenantId, students: Student[]): Promise<RosterRecord> {
  const client = getDataStoreClient()
  const item: RosterRecord = { tenantId, key: KEY, students, updatedAt: Date.now() }
  await runOp('putItem', () => client.putItem({ tableId: resolveTableId(TABLE), item }))
  invalidate(cacheKey(tenantId))
  return item
}

/** 名簿から 1 人引く。キャッシュ済みの名簿を使うのでデータストアには当たらないことが多い */
export async function findStudent(tenantId: TenantId, studentId: string): Promise<Student | undefined> {
  const roster = await getRoster(tenantId)
  return roster?.students.find((s) => s.studentId === studentId)
}
