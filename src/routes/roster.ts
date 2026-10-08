import { Hono } from 'hono'
import { readConfig } from '../config'
import { getRoster, putRoster } from '../datastore'
import { AppError } from '../errors'
import type { AuthVars } from '../middleware/auth'
import { putRosterSchema } from '../schemas'

/**
 * 名簿（先生のみ。routes/index.ts で requireAuth('teacher') が掛かる）。
 *   GET /v1/roster              { students, updatedAt }
 *   PUT /v1/roster  { students } 全置換。CSV の解釈はフロントで行い、ここは配列だけ受ける
 */

/** 1 アイテム 350KB の上限に対する安全側の目安 */
const MAX_ITEM_BYTES = 300 * 1024

export function rosterRoutes(): Hono<AuthVars> {
  const r = new Hono<AuthVars>()

  r.get('/', async (c) => {
    const roster = await getRoster(readConfig().tenantId)
    return c.json({ students: roster?.students ?? [], updatedAt: roster?.updatedAt ?? null })
  })

  r.put('/', async (c) => {
    const input = putRosterSchema.parse(await c.req.json())
    const bytes = Buffer.byteLength(JSON.stringify(input.students), 'utf8')
    if (bytes > MAX_ITEM_BYTES) {
      throw new AppError('BAD_REQUEST', 413, '名簿が大きすぎます（氏名を短くするか人数を減らしてください）', { bytes })
    }
    const saved = await putRoster(readConfig().tenantId, input.students)
    return c.json({ count: saved.students.length, updatedAt: saved.updatedAt })
  })

  return r
}
