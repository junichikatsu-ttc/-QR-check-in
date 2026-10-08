import { cached, invalidate } from '../lib/cache'
import { eventIdSchema } from '../schemas'
import type { EventId, EventSummary, TenantId } from '../schemas'
import { getDataStoreClient } from './client'
import { queryAll } from './query'
import { runGet, runOp } from './run'
import { resolveTableId } from './tables'

/**
 * イベント（引率の 1 回分。「10/8 修学旅行 帰りのバス」など）。
 * 主キー: tenantId + createdAt(number)。新しい順の一覧は createdAt 降順の query 1 回。
 * eventId は createdAt を 10 進文字列にしたもの。
 */

const TABLE = 'events' as const
const CACHE_TTL_MS = 60_000

export interface EventRecord {
  tenantId: TenantId
  createdAt: number
  name: string
  classNames: string[]
  createdBy: string
}

export function toEventId(createdAt: number): EventId {
  return eventIdSchema.parse(String(createdAt))
}

export function toSummary(rec: EventRecord): EventSummary {
  return {
    eventId: toEventId(rec.createdAt),
    name: rec.name,
    classNames: rec.classNames,
    createdAt: rec.createdAt,
    createdBy: rec.createdBy,
  }
}

const cacheKey = (tenantId: TenantId, eventId: EventId) => `event:${tenantId}:${eventId}`

export async function createEvent(
  tenantId: TenantId,
  input: { name: string; classNames: string[]; createdBy: string },
): Promise<EventRecord> {
  const client = getDataStoreClient()
  const rec: EventRecord = { tenantId, createdAt: Date.now(), ...input }
  await runOp('putItem', () => client.putItem({ tableId: resolveTableId(TABLE), item: rec }))
  return rec
}

export async function getEvent(tenantId: TenantId, eventId: EventId): Promise<EventRecord | undefined> {
  return cached(cacheKey(tenantId, eventId), CACHE_TTL_MS, async () => {
    const client = getDataStoreClient()
    const res = await runGet(() =>
      client.getItem({ tableId: resolveTableId(TABLE), key: { tenantId, createdAt: Number(eventId) } }),
    )
    return res?.params?.Item as EventRecord | undefined
  })
}

/** 新しい順 */
export async function listEvents(tenantId: TenantId, limit: number): Promise<EventRecord[]> {
  const client = getDataStoreClient()
  const rows = await queryAll<EventRecord>(client, {
    tableId: resolveTableId(TABLE),
    expression: '#tenantId = :tenantId',
    values: { tenantId },
    order: 'desc',
    pageSize: Math.min(limit, 100),
    maxPages: 1,
  })
  // 実環境では order 指定どおりに並ばないことがあったので、ここで必ず新しい順に揃える
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

export async function deleteEvent(tenantId: TenantId, eventId: EventId): Promise<void> {
  const client = getDataStoreClient()
  await runOp('deleteItem', () =>
    client.deleteItem({ tableId: resolveTableId(TABLE), key: { tenantId, createdAt: Number(eventId) } }),
  )
  invalidate(cacheKey(tenantId, eventId))
}
