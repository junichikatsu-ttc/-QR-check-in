import type { Checkin, EventId, StudentId, TenantId } from '../schemas'
import { getDataStoreClient } from './client'
import { queryAll } from './query'
import { runGet, runOp } from './run'
import { resolveTableId } from './tables'

/**
 * チェックイン。1 スキャン = 1 アイテム。
 *
 * 複数の先生が別々のバスで同時にスキャンするため、イベント 1 アイテムにまとめる設計は
 * 読み書きの競合で記録が消える。アイテムを分けて putItem だけで完結させる。
 *
 * mainKey は `${tenantId}:${eventId}`（テナントを含める。constraints.md キー設計の原則）
 * subKey は studentId（文字列。時系列ではないので number にしない）
 */

const TABLE = 'checkins' as const

export type EventKey = string & { readonly __brand: 'EventKey' }

export function toEventKey(tenantId: TenantId, eventId: EventId): EventKey {
  return `${tenantId}:${eventId}` as EventKey
}

export interface CheckinRecord extends Checkin {
  eventKey: EventKey
}

export async function getCheckin(eventKey: EventKey, studentId: StudentId): Promise<CheckinRecord | undefined> {
  const client = getDataStoreClient()
  // 未チェックインは「無い」= 正常系（pitfalls 6）
  const res = await runGet(() => client.getItem({ tableId: resolveTableId(TABLE), key: { eventKey, studentId } }))
  return res?.params?.Item as CheckinRecord | undefined
}

export async function putCheckin(eventKey: EventKey, checkin: Checkin): Promise<CheckinRecord> {
  const client = getDataStoreClient()
  const item: CheckinRecord = { eventKey, ...checkin }
  await runOp('putItem', () => client.putItem({ tableId: resolveTableId(TABLE), item }))
  return item
}

/** イベントのチェックイン全件。100 件/ページ × 最大 30 ページ（3000 人分） */
export async function listCheckins(eventKey: EventKey): Promise<CheckinRecord[]> {
  const client = getDataStoreClient()
  return queryAll<CheckinRecord>(client, {
    tableId: resolveTableId(TABLE),
    expression: '#eventKey = :eventKey',
    values: { eventKey },
    order: 'asc',
    pageSize: 100,
    maxPages: 30,
  })
}

export async function deleteCheckin(eventKey: EventKey, studentId: StudentId): Promise<void> {
  const client = getDataStoreClient()
  await runOp('deleteItem', () => client.deleteItem({ tableId: resolveTableId(TABLE), key: { eventKey, studentId } }))
}
